import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mdPath = join(root, 'docs', 'project-diagram.md');
const pdfPath = join(root, 'docs', 'project-diagram.pdf');

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function markdownToHtml(markdown: string): string {
  const chunks: Array<{ type: 'md' | 'mermaid'; body: string }> = [];
  const re = /```mermaid\r?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    if (match.index > last) {
      chunks.push({ type: 'md', body: markdown.slice(last, match.index) });
    }
    chunks.push({ type: 'mermaid', body: match[1].trim() });
    last = re.lastIndex;
  }
  if (last < markdown.length) {
    chunks.push({ type: 'md', body: markdown.slice(last) });
  }

  let html = '';
  for (const chunk of chunks) {
    if (chunk.type === 'mermaid') {
      html += `<div class="diagram"><pre class="mermaid">${chunk.body}</pre></div>\n`;
      continue;
    }

    const lines = chunk.body.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        i += 1;
        continue;
      }
      if (line.startsWith('# ')) {
        html += `<h1>${inlineMarkdown(line.slice(2).trim())}</h1>\n`;
        i += 1;
        continue;
      }
      if (line.startsWith('## ')) {
        html += `<h2>${inlineMarkdown(line.slice(3).trim())}</h2>\n`;
        i += 1;
        continue;
      }
      if (line.startsWith('### ')) {
        html += `<h3>${inlineMarkdown(line.slice(4).trim())}</h3>\n`;
        i += 1;
        continue;
      }
      if (line.startsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          tableLines.push(lines[i]);
          i += 1;
        }
        const rows = tableLines
          .filter((row) => !/^\|\s*[-:]+\s*\|/.test(row))
          .map((row) =>
            row
              .split('|')
              .slice(1, -1)
              .map((cell) => cell.trim()),
          );
        if (rows.length === 0) continue;
        html += '<table><thead><tr>';
        for (const cell of rows[0]) {
          html += `<th>${inlineMarkdown(cell)}</th>`;
        }
        html += '</tr></thead><tbody>';
        for (const row of rows.slice(1)) {
          html += '<tr>';
          for (const cell of row) {
            html += `<td>${inlineMarkdown(cell)}</td>`;
          }
          html += '</tr>';
        }
        html += '</tbody></table>\n';
        continue;
      }
      html += `<p>${inlineMarkdown(line.trim())}</p>\n`;
      i += 1;
    }
  }
  return html;
}

function buildDocument(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>P2P API Practicum — project diagram</title>
  <style>
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #111;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 32px 48px;
    }
    h1 { font-size: 22pt; margin: 0 0 12px; page-break-after: avoid; }
    h2 { font-size: 14pt; margin: 28px 0 10px; page-break-after: avoid; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    h3 { font-size: 12pt; margin: 20px 0 8px; page-break-after: avoid; }
    p { margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 10pt; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
    .diagram {
      margin: 16px 0 24px;
      page-break-inside: avoid;
      display: flex;
      justify-content: center;
    }
    .mermaid { margin: 0; background: transparent; }
  </style>
</head>
<body>
${bodyHtml}
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
</script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const markdown = readFileSync(mdPath, 'utf8');
  const bodyHtml = markdownToHtml(markdown);
  const html = buildDocument(bodyHtml);
  const mermaidCount = (markdown.match(/```mermaid/g) ?? []).length;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof (window as unknown as { mermaid?: unknown }).mermaid !== 'undefined');
    await page.evaluate(async () => {
      await (window as unknown as { mermaid: { run: () => Promise<void> } }).mermaid.run();
    });
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.mermaid svg').length >= expected,
      mermaidCount,
      { timeout: 60_000 },
    );
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
    });
  } finally {
    await browser.close();
  }

  console.log(`Wrote ${pdfPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
