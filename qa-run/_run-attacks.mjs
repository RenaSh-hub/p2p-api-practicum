// Adversary runner. Every HTTP call is curl.exe. Writes only under qa-run/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:8000';
const QA = path.resolve('qa-run');
const REQ = path.join(QA, '_req.json');
const BODY = path.join(QA, '_last-body.json');
const STATUS = path.join(QA, '_last-status.txt');
const LOG = path.join(QA, 'attacks.jsonl');

let phase = 'init';
let skus = [];
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

function curl(method, urlPath, body) {
  const args = ['-s', '-S', '-o', BODY.replace(/\\/g, '/'), '-w', '%{http_code}', '-X', method];
  if (body !== undefined) {
    fs.writeFileSync(REQ, JSON.stringify(body));
    args.push('-H', 'content-type: application/json', '--data-binary', `@${REQ.replace(/\\/g, '/')}`);
  }
  args.push(`${BASE}${urlPath}`);
  let statusText = '';
  let stderr = '';
  try {
    statusText = execFileSync('curl.exe', args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (err) {
    statusText = (err.stdout || '').toString().trim();
    stderr = (err.stderr || '').toString();
    if (!statusText) {
      throw new Error(`curl failed ${method} ${urlPath}: ${stderr || err.message}`);
    }
  }
  fs.writeFileSync(STATUS, statusText);
  const raw = fs.readFileSync(BODY, 'utf8');
  let parsed;
  try {
    parsed = raw.length ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }
  const status = Number(statusText);
  if (!Number.isFinite(status)) {
    throw new Error(`Non-numeric status for ${method} ${urlPath}: ${JSON.stringify(statusText)} ${stderr}`);
  }
  return { status, body: parsed };
}

function setup(res, step) {
  if (res.status >= 400) {
    throw new Error(`SETUP FAILED [${phase}] ${step}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res;
}

function poLine(index, quantity, unitPrice) {
  const sku = skus[index];
  return {
    sku: sku.sku,
    description: sku.description,
    quantity,
    unit_price: unitPrice,
  };
}

function rcv(index, quantity) {
  return { sku: skus[index].sku, quantity };
}

function inv(index, quantity, unitPrice) {
  return { sku: skus[index].sku, quantity, unit_price: unitPrice };
}

function freshVendor(label, active = true) {
  const name = `${label} ${stamp()}`;
  const res = setup(curl('POST', '/vendors', { name, active }), `create vendor ${name}`);
  if (Boolean(res.body.active) !== Boolean(active)) {
    throw new Error(`SETUP FAILED [${phase}] vendor active flag: sent ${active}, got ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

function draftPo(vendorId, lineItems) {
  return setup(curl('POST', '/purchase-orders', { vendor_id: vendorId, line_items: lineItems }), 'create po').body;
}

function submitPo(poId) {
  return setup(curl('POST', `/purchase-orders/${poId}/submit`, {}), 'submit').body;
}

function receivePo(poId, items) {
  return setup(curl('POST', `/purchase-orders/${poId}/receive`, { items }), 'receive').body;
}

function createInvoice(poId, invoiceNumber, lineItems) {
  return setup(
    curl('POST', '/invoices', { po_id: poId, invoice_number: invoiceNumber, line_items: lineItems }),
    'invoice',
  ).body;
}

function matchInvoice(invoiceId) {
  return setup(curl('POST', `/invoices/${invoiceId}/match`, {}), 'match').body;
}

function approveInvoice(invoiceId) {
  return setup(curl('POST', `/invoices/${invoiceId}/approve`, {}), 'approve').body;
}

function orderReceived({ label, poLines, receipts }) {
  const vendor = freshVendor(label, true);
  const po = draftPo(vendor.id, poLines);
  submitPo(po.id);
  const received = receivePo(po.id, receipts);
  return { vendor, po, received };
}

function orderInvoiced({ label, poLines, receipts, invoiceNumber, invoiceLines }) {
  const base = orderReceived({ label, poLines, receipts });
  const invoice = createInvoice(base.po.id, invoiceNumber, invoiceLines);
  return { ...base, invoice };
}

function ruleOf(res) {
  return res.body && typeof res.body === 'object' ? res.body.rule : undefined;
}

function detailOf(res) {
  if (!res.body || typeof res.body !== 'object') return JSON.stringify(res.body);
  const detail = res.body.detail;
  return typeof detail === 'string' ? detail : JSON.stringify(detail ?? res.body);
}

function judgeNamedReject(res, rule) {
  const got = ruleOf(res);
  if (res.status === 400 && got === rule) {
    return { outcome: 'HELD', reason: `Refused with 400 and rule ${rule}. ${detailOf(res)}` };
  }
  if (res.status >= 200 && res.status < 300) {
    return { outcome: 'BREACHED', reason: `Accepted with status ${res.status}. Expected a 400 refusal under ${rule}.` };
  }
  if (got && got !== rule) {
    return {
      outcome: 'BREACHED',
      reason: `Refused with rule ${got}, not ${rule}. Status ${res.status}. ${detailOf(res)}`,
    };
  }
  return {
    outcome: 'BREACHED',
    reason: `Status ${res.status} without rule ${rule}. ${detailOf(res)}`,
  };
}

function judgeUndocumentedLimit(res, what) {
  if (res.status >= 200 && res.status < 300) {
    return {
      outcome: 'BREACHED',
      reason: `Accepted ${what} with status ${res.status}. docs/API.md Purchase orders forbids it (quantity greater than 0, unit_price from 0 to 100,000).`,
    };
  }
  if (res.status >= 400 && res.status < 500) {
    return {
      outcome: 'undocumented',
      reason: `Rejected ${what} with status ${res.status} and rule ${ruleOf(res) || 'absent'}. The Purchase orders section states the numeric limits, and none of the 11 named business rules covers this input. ${detailOf(res)}`,
    };
  }
  return { outcome: 'BREACHED', reason: `Status ${res.status} for ${what}. ${detailOf(res)}` };
}

function judgeZeroPrice(res) {
  const echoed = res.body && Array.isArray(res.body.line_items) ? res.body.line_items[0] : undefined;
  if (res.status === 201 && echoed && echoed.unit_price === 0) {
    return {
      outcome: 'HELD',
      reason: 'Draft purchase order was created with unit_price 0, which is inside the documented range of 0 to 100,000.',
    };
  }
  return {
    outcome: 'BREACHED',
    reason: `Price 0 was not accepted as a draft line. Status ${res.status}, rule ${ruleOf(res) || 'absent'}. ${detailOf(res)}`,
  };
}

function judgeFlag(res, expectedFlag) {
  if (res.status === 200 && res.body && res.body.partial_receipt === expectedFlag) {
    return { outcome: 'HELD', reason: `Match returned partial_receipt ${expectedFlag}.` };
  }
  if (res.status === 200) {
    return {
      outcome: 'BREACHED',
      reason: `partial_receipt is ${JSON.stringify(res.body && res.body.partial_receipt)}, expected ${expectedFlag}.`,
    };
  }
  return {
    outcome: 'BREACHED',
    reason: `Match returned status ${res.status} and rule ${ruleOf(res) || 'absent'}. Expected 200 and partial_receipt ${expectedFlag}. ${detailOf(res)}`,
  };
}

function judgeAllowedOtherVendor(res) {
  if (res.status === 201) {
    return {
      outcome: 'HELD',
      reason: 'The second vendor created an invoice with the same invoice number. Uniqueness is per vendor.',
    };
  }
  return {
    outcome: 'BREACHED',
    reason: `A different vendor was refused with status ${res.status} and rule ${ruleOf(res) || 'absent'}. The same invoice number is allowed on another vendor. ${detailOf(res)}`,
  };
}

function inspectMoney(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, cents: null, dirty: true };
  const cents = Math.round(value * 100);
  const text = String(value);
  const fraction = text.split('.')[1] || '';
  const dirty = /e/i.test(text) || fraction.length > 2 || Math.abs(value * 100 - cents) > 1e-6;
  return { ok: true, cents, dirty };
}

function sumMoney(lines) {
  if (!Array.isArray(lines)) return { cents: null, dirty: true };
  let cents = 0;
  let dirty = false;
  for (const line of lines) {
    const inspected = inspectMoney(line && line.amount);
    if (!inspected.ok) return { cents: null, dirty: true };
    cents += inspected.cents;
    if (inspected.dirty) dirty = true;
  }
  return { cents, dirty };
}

function mathCents(lines) {
  return lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unit_price * 100), 0);
}

function dollars(cents) {
  return (cents / 100).toFixed(2);
}

function judgeExactInvoice(res, expectedCents) {
  if (res.status === 201) {
    const total = inspectMoney(res.body && res.body.total_amount);
    if (total.ok && total.cents === expectedCents && !total.dirty) {
      return {
        outcome: 'HELD',
        reason: `Invoice accepted with total_amount ${res.body.total_amount}, equal to the received value ${dollars(expectedCents)}.`,
      };
    }
    return {
      outcome: 'BREACHED',
      reason: `Invoice was accepted with total_amount ${JSON.stringify(res.body && res.body.total_amount)}, expected ${dollars(expectedCents)} and not above the receipt.`,
    };
  }
  if (res.status === 400 && ruleOf(res) === 'overpayment_protection') {
    return {
      outcome: 'BREACHED',
      reason: `An invoice equal to the received value was refused under overpayment_protection. ${detailOf(res)}`,
    };
  }
  return { outcome: 'BREACHED', reason: `Unexpected status ${res.status}. ${detailOf(res)}` };
}

function judgeGl(res, expectedCents) {
  if (res.status !== 200 || !res.body || !res.body.gl_entry) {
    return {
      outcome: 'BREACHED',
      reason: `Approval did not return a ledger entry. Status ${res.status}. ${detailOf(res)}`,
    };
  }
  const gl = res.body.gl_entry;
  const debits = sumMoney(gl.debits);
  const credits = sumMoney(gl.credits);
  if (
    gl.balanced === true &&
    debits.cents === expectedCents &&
    credits.cents === expectedCents &&
    !debits.dirty &&
    !credits.dirty
  ) {
    return {
      outcome: 'HELD',
      reason: `Debits and credits both equal ${dollars(expectedCents)} and balanced is true.`,
    };
  }
  return {
    outcome: 'BREACHED',
    reason: `balanced=${JSON.stringify(gl.balanced)}, debit cents ${debits.cents}, credit cents ${credits.cents}, expected ${expectedCents}, dirty debit ${debits.dirty}, dirty credit ${credits.dirty}. Entry ${JSON.stringify(gl)}.`,
  };
}

function sameIds(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const left = [...actual].map(String).sort();
  const right = [...expected].map(String).sort();
  return left.every((value, index) => value === right[index]);
}

function judgeExposure(res, { expectedCents, reportedCents, approvedIds }) {
  if (res.status !== 200 || !res.body || typeof res.body !== 'object') {
    return { outcome: 'BREACHED', reason: `Exposure lookup returned status ${res.status}. ${detailOf(res)}` };
  }
  const liability = inspectMoney(res.body.open_ap_liability);
  const idsOk = sameIds(res.body.approved_invoices, approvedIds);
  if (
    liability.ok &&
    !liability.dirty &&
    liability.cents === expectedCents &&
    liability.cents === reportedCents &&
    idsOk
  ) {
    return {
      outcome: 'HELD',
      reason: `open_ap_liability ${res.body.open_ap_liability} equals the approved invoice total ${dollars(expectedCents)}, and approved_invoices lists only those invoices.`,
    };
  }
  return {
    outcome: 'BREACHED',
    reason: `open_ap_liability ${JSON.stringify(res.body.open_ap_liability)} (cents ${liability.cents}), sum of approved total_amount cents ${reportedCents}, mathematical cents ${expectedCents}, approved_invoices ${JSON.stringify(res.body.approved_invoices)}, expected ids ${JSON.stringify(approvedIds)}, dirty ${liability.dirty}.`,
  };
}

function attack(meta, judgeFn) {
  const res = curl(meta.request.method, meta.request.path, meta.request.body);
  const status = Number(fs.readFileSync(STATUS, 'utf8').trim());
  const raw = fs.readFileSync(BODY, 'utf8');
  let body;
  try {
    body = raw.length ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  const response = { status, body };
  const judged = judgeFn(response);
  const entry = {
    rule: meta.rule,
    attack: meta.attack,
    request: meta.request,
    response,
    expected: meta.expected,
    outcome: judged.outcome,
    reason: judged.reason,
  };
  fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
  console.log(`${judged.outcome}\t${meta.rule}\t${meta.attack}`);
  return response;
}

function expectReject(rule, citation) {
  return `400 with rule ${rule}. ${citation}`;
}

function main() {
  fs.writeFileSync(LOG, '');
  phase = 'health';
  const health = curl('GET', '/health');
  if (health.status !== 200) {
    throw new Error(`API is not healthy: ${health.status} ${JSON.stringify(health.body)}`);
  }

  phase = 'skus';
  const listed = curl('GET', '/skus');
  if (listed.status !== 200 || !Array.isArray(listed.body) || listed.body.length < 2) {
    throw new Error(`GET /skus failed: ${listed.status} ${JSON.stringify(listed.body)}`);
  }
  skus = listed.body;
  console.log(`SKUs ${skus.map((sku) => sku.sku).join(', ')}`);

  phase = '1 three_way_match_gate';
  {
    const flow = orderInvoiced({
      label: 'Adv Match Gate',
      poLines: [poLine(0, 4, 4.75)],
      receipts: [rcv(0, 4)],
      invoiceNumber: `INV-Unmatched-${stamp()}`,
      invoiceLines: [inv(0, 4, 4.75)],
    });
    attack(
      {
        rule: 'three_way_match_gate',
        attack: 'approve an invoice that was never matched',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/approve`, body: {} },
        expected: expectReject(
          'three_way_match_gate',
          'docs/API.md Business rules row 4: an invoice cannot be approved until it passed the 3-way match.',
        ),
      },
      (res) => judgeNamedReject(res, 'three_way_match_gate'),
    );
  }

  phase = '2 receive_quantity_limit far over';
  {
    const vendor = freshVendor('Adv Over Receive');
    const po = draftPo(vendor.id, [poLine(0, 4, 4.75)]);
    submitPo(po.id);
    attack(
      {
        rule: 'receive_quantity_limit',
        attack: 'receive 20 units of a line ordered for 4',
        request: {
          method: 'POST',
          path: `/purchase-orders/${po.id}/receive`,
          body: { items: [rcv(0, 20)] },
        },
        expected: expectReject(
          'receive_quantity_limit',
          'docs/API.md Business rules row 2: received quantity never exceeds ordered quantity.',
        ),
      },
      (res) => judgeNamedReject(res, 'receive_quantity_limit'),
    );
  }

  phase = '3 overpayment value';
  {
    const vendor = freshVendor('Adv Over Value');
    const po = draftPo(vendor.id, [poLine(0, 10, 4.75)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 10)]);
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'invoice the received quantity at double the price',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Value-${stamp()}`,
            line_items: [inv(0, 10, 9.5)],
          },
        },
        expected: expectReject(
          'overpayment_protection',
          'docs/API.md Business rules row 3: invoiced total value never exceeds what was received. There is no tolerance.',
        ),
      },
      (res) => judgeNamedReject(res, 'overpayment_protection'),
    );
  }

  phase = '4 inactive_vendor_gate';
  {
    const vendor = freshVendor('Adv Inactive', false);
    const body = { vendor_id: vendor.id, line_items: [poLine(0, 2, 4.75)] };
    attack(
      {
        rule: 'inactive_vendor_gate',
        attack: 'create a purchase order for a vendor created with active false',
        request: { method: 'POST', path: '/purchase-orders', body },
        expected: expectReject(
          'inactive_vendor_gate',
          'docs/API.md Business rules row 1: no purchase order can be created for an inactive vendor.',
        ),
      },
      (res) => judgeNamedReject(res, 'inactive_vendor_gate'),
    );
  }

  phase = '5 one unit over across deliveries';
  {
    const vendor = freshVendor('Adv One Unit');
    const po = draftPo(vendor.id, [poLine(0, 10, 4.75), poLine(1, 4, 11.9)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 10), rcv(1, 1)]);
    attack(
      {
        rule: 'receive_quantity_limit',
        attack: 'second delivery puts the first line one unit over its ordered quantity',
        request: {
          method: 'POST',
          path: `/purchase-orders/${po.id}/receive`,
          body: { items: [rcv(0, 1)] },
        },
        expected: expectReject(
          'receive_quantity_limit',
          'docs/API.md Business rules row 2: the limit holds across all deliveries. The PO is still submitted, so workflow_gate is the wrong rule.',
        ),
      },
      (res) => judgeNamedReject(res, 'receive_quantity_limit'),
    );
  }

  phase = '6 one cent over';
  {
    const vendor = freshVendor('Adv One Cent');
    const po = draftPo(vendor.id, [poLine(0, 1, 10)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 1)]);
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'invoice one cent over the received value',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Cent-${stamp()}`,
            line_items: [inv(0, 1, 10.01)],
          },
        },
        expected: expectReject(
          'overpayment_protection',
          'docs/API.md Business rules row 3: no tolerance, including one cent.',
        ),
      },
      (res) => judgeNamedReject(res, 'overpayment_protection'),
    );
  }

  phase = '7 small percentage over';
  {
    const vendor = freshVendor('Adv Half Percent');
    const po = draftPo(vendor.id, [poLine(0, 100, 10)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 100)]);
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'invoice half a percent over the received value',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Pct-${stamp()}`,
            line_items: [inv(0, 100, 10.05)],
          },
        },
        expected: expectReject(
          'overpayment_protection',
          'docs/API.md Business rules row 3: no tolerance. 1005.00 is 0.5 percent over the 1000.00 received.',
        ),
      },
      (res) => judgeNamedReject(res, 'overpayment_protection'),
    );
  }

  phase = '8 quantity over value under';
  {
    const vendor = freshVendor('Adv Qty Not Value');
    const po = draftPo(vendor.id, [poLine(0, 10, 10)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 10)]);
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'invoice one unit over the receipt at a price that keeps the extended value under the receipt',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Qty-${stamp()}`,
            line_items: [inv(0, 11, 1)],
          },
        },
        expected: expectReject(
          'overpayment_protection',
          'docs/API.md Business rules row 3: per-line quantity cannot exceed what was received, even when the extended value is lower.',
        ),
      },
      (res) => judgeNamedReject(res, 'overpayment_protection'),
    );
  }

  phase = '9 invoice with nothing received';
  {
    const vendor = freshVendor('Adv Nothing Received');
    const po = draftPo(vendor.id, [poLine(0, 4, 10)]);
    submitPo(po.id);
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'invoice a submitted purchase order before any goods are received',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Empty-${stamp()}`,
            line_items: [inv(0, 1, 10)],
          },
        },
        expected: expectReject(
          'overpayment_protection',
          'docs/API.md Business rules row 3 and row 10: a submitted PO may be invoiced, but the invoice cannot exceed the received value of 0.',
        ),
      },
      (res) => judgeNamedReject(res, 'overpayment_protection'),
    );
  }

  phase = '10 two invoices exceed receipt';
  {
    const vendor = freshVendor('Adv Second Invoice');
    const po = draftPo(vendor.id, [poLine(0, 10, 5)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 10)]);
    createInvoice(po.id, `INV-First-${stamp()}`, [inv(0, 6, 5)]);
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'second invoice makes the two invoices together exceed the receipt',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Second-${stamp()}`,
            line_items: [inv(0, 6, 5)],
          },
        },
        expected: expectReject(
          'overpayment_protection',
          'docs/API.md Business rules row 3: everything invoiced on a PO, across invoices, never exceeds what was received.',
        ),
      },
      (res) => judgeNamedReject(res, 'overpayment_protection'),
    );
  }

  phase = '11 prices 0.1 and 0.2 accepted';
  {
    const lines = [inv(0, 1, 0.1), inv(1, 1, 0.2)];
    const vendor = freshVendor('Adv Tenths');
    const po = draftPo(vendor.id, [poLine(0, 1, 0.1), poLine(1, 1, 0.2)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 1), rcv(1, 1)]);
    const body = {
      po_id: po.id,
      invoice_number: `INV-Tenths-${stamp()}`,
      line_items: lines,
    };
    attack(
      {
        rule: 'overpayment_protection',
        attack: 'invoice prices 0.1 and 0.2 that equal the received value',
        request: { method: 'POST', path: '/invoices', body },
        expected:
          '201 with total_amount 0.30. docs/API.md Business rules row 3 forbids only an excess, and Basics rounds money to cents. 0.10 + 0.20 equals the receipt.',
      },
      (res) => judgeExactInvoice(res, mathCents(lines)),
    );
  }

  phase = '12 zero quantity';
  {
    const vendor = freshVendor('Adv Zero Qty');
    const body = { vendor_id: vendor.id, line_items: [poLine(0, 0, 4.75)] };
    attack(
      {
        rule: 'validation_error',
        attack: 'purchase order line with quantity 0',
        request: { method: 'POST', path: '/purchase-orders', body },
        expected:
          'docs/API.md Purchase orders: quantity must be greater than 0. No named business rule covers zero. A 4xx rejection is undocumented; a 2xx is a breach.',
      },
      (res) => judgeUndocumentedLimit(res, 'quantity 0'),
    );
  }

  phase = '13 negative quantity';
  {
    const vendor = freshVendor('Adv Neg Qty');
    const body = { vendor_id: vendor.id, line_items: [poLine(0, -5, 4.75)] };
    attack(
      {
        rule: 'validation_error',
        attack: 'purchase order line with a negative quantity',
        request: { method: 'POST', path: '/purchase-orders', body },
        expected:
          'docs/API.md Purchase orders: quantity must be greater than 0. No named business rule covers a negative quantity. A 4xx rejection is undocumented; a 2xx is a breach.',
      },
      (res) => judgeUndocumentedLimit(res, 'quantity -5'),
    );
  }

  phase = '14 negative price';
  {
    const vendor = freshVendor('Adv Neg Price');
    const body = { vendor_id: vendor.id, line_items: [poLine(0, 1, -1)] };
    attack(
      {
        rule: 'validation_error',
        attack: 'purchase order line with a negative unit price',
        request: { method: 'POST', path: '/purchase-orders', body },
        expected:
          'docs/API.md Purchase orders: unit_price is from 0 to 100,000. No named business rule covers a negative price. A 4xx rejection is undocumented; a 2xx is a breach.',
      },
      (res) => judgeUndocumentedLimit(res, 'unit_price -1'),
    );
  }

  phase = '15 zero price';
  {
    const vendor = freshVendor('Adv Zero Price');
    const body = { vendor_id: vendor.id, line_items: [poLine(0, 1, 0)] };
    attack(
      {
        rule: 'validation_error',
        attack: 'purchase order line with unit price 0',
        request: { method: 'POST', path: '/purchase-orders', body },
        expected:
          '201. docs/API.md Purchase orders allows unit_price from 0 to 100,000, so zero is a valid price.',
      },
      (res) => judgeZeroPrice(res),
    );
  }

  phase = '16 duplicate case';
  {
    const canonical = `INV-Case-${stamp()}`;
    const vendor = freshVendor('Adv Case');
    const po = draftPo(vendor.id, [poLine(0, 10, 5)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 10)]);
    createInvoice(po.id, canonical, [inv(0, 4, 5)]);
    attack(
      {
        rule: 'duplicate_invoice_detection',
        attack: 'second invoice number differs only by letter case',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: canonical.toLowerCase(),
            line_items: [inv(0, 4, 5)],
          },
        },
        expected: expectReject(
          'duplicate_invoice_detection',
          'docs/API.md Business rules row 6: invoice numbers are compared ignoring upper or lower case. The second invoice quantity still fits the receipt.',
        ),
      },
      (res) => judgeNamedReject(res, 'duplicate_invoice_detection'),
    );
  }

  phase = '17 duplicate spaces';
  {
    const canonical = `INV-Space-${stamp()}`;
    const vendor = freshVendor('Adv Spaces');
    const po = draftPo(vendor.id, [poLine(0, 10, 5)]);
    submitPo(po.id);
    receivePo(po.id, [rcv(0, 10)]);
    createInvoice(po.id, canonical, [inv(0, 4, 5)]);
    attack(
      {
        rule: 'duplicate_invoice_detection',
        attack: 'second invoice number differs only by surrounding spaces',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: ` ${canonical} `,
            line_items: [inv(0, 4, 5)],
          },
        },
        expected: expectReject(
          'duplicate_invoice_detection',
          'docs/API.md Business rules row 6: surrounding spaces are ignored. The second invoice quantity still fits the receipt.',
        ),
      },
      (res) => judgeNamedReject(res, 'duplicate_invoice_detection'),
    );
  }

  phase = '18 same number other vendor';
  {
    const shared = `INV-Share-${stamp()}`;
    const first = orderReceived({
      label: 'Adv Share A',
      poLines: [poLine(0, 2, 5)],
      receipts: [rcv(0, 2)],
    });
    createInvoice(first.po.id, shared, [inv(0, 2, 5)]);
    const second = orderReceived({
      label: 'Adv Share B',
      poLines: [poLine(0, 2, 5)],
      receipts: [rcv(0, 2)],
    });
    attack(
      {
        rule: 'duplicate_invoice_detection',
        attack: 'same invoice number on a second vendor',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: second.po.id,
            invoice_number: shared,
            line_items: [inv(0, 2, 5)],
          },
        },
        expected:
          '201. docs/API.md Business rules row 6 and OpenAPI POST /invoices: invoice numbers are unique per vendor, so another vendor may reuse the number.',
      },
      judgeAllowedOtherVendor,
    );
  }

  phase = '19 short line last';
  {
    const flow = orderInvoiced({
      label: 'Adv Short Last',
      poLines: [poLine(0, 8, 5), poLine(1, 6, 5)],
      receipts: [rcv(0, 8), rcv(1, 2)],
      invoiceNumber: `INV-ShortLast-${stamp()}`,
      invoiceLines: [inv(0, 8, 5), inv(1, 2, 5)],
    });
    attack(
      {
        rule: 'partial_receipt_flag',
        attack: 'match when the last purchase-order line is only partly received',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/match`, body: {} },
        expected:
          '200 and partial_receipt true. docs/API.md Business rules row 5: the flag is true when any line of the PO is not fully received.',
      },
      (res) => judgeFlag(res, true),
    );
  }

  phase = '20 short line first';
  {
    const flow = orderInvoiced({
      label: 'Adv Short First',
      poLines: [poLine(0, 8, 5), poLine(1, 6, 5)],
      receipts: [rcv(0, 3), rcv(1, 6)],
      invoiceNumber: `INV-ShortFirst-${stamp()}`,
      invoiceLines: [inv(0, 3, 5), inv(1, 6, 5)],
    });
    attack(
      {
        rule: 'partial_receipt_flag',
        attack: 'match when the first purchase-order line is only partly received',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/match`, body: {} },
        expected:
          '200 and partial_receipt true. docs/API.md Business rules row 5. The short line is first so a check of only the last line would miss it.',
      },
      (res) => judgeFlag(res, true),
    );
  }

  phase = '21 fully received flag false';
  {
    const flow = orderInvoiced({
      label: 'Adv Full Receipt',
      poLines: [poLine(0, 8, 5), poLine(1, 6, 5)],
      receipts: [rcv(0, 8), rcv(1, 6)],
      invoiceNumber: `INV-Full-${stamp()}`,
      invoiceLines: [inv(0, 8, 5), inv(1, 6, 5)],
    });
    attack(
      {
        rule: 'partial_receipt_flag',
        attack: 'match when every purchase-order line is fully received',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/match`, body: {} },
        expected:
          '200 and partial_receipt false. docs/API.md Business rules row 5 sets the flag only when some line is not fully received. The match example shows false for a full receipt.',
      },
      (res) => judgeFlag(res, false),
    );
  }

  phase = '22 receive draft';
  {
    const vendor = freshVendor('Adv Receive Draft');
    const po = draftPo(vendor.id, [poLine(0, 4, 5)]);
    attack(
      {
        rule: 'workflow_gate',
        attack: 'receive goods against a draft purchase order',
        request: {
          method: 'POST',
          path: `/purchase-orders/${po.id}/receive`,
          body: { items: [rcv(0, 1)] },
        },
        expected: expectReject(
          'workflow_gate',
          'docs/API.md Business rules row 10: receive only on a submitted purchase order.',
        ),
      },
      (res) => judgeNamedReject(res, 'workflow_gate'),
    );
  }

  phase = '23 submit twice';
  {
    const vendor = freshVendor('Adv Resubmit');
    const po = draftPo(vendor.id, [poLine(0, 2, 5)]);
    submitPo(po.id);
    attack(
      {
        rule: 'workflow_gate',
        attack: 'submit a purchase order that is already submitted',
        request: { method: 'POST', path: `/purchase-orders/${po.id}/submit`, body: {} },
        expected: expectReject(
          'workflow_gate',
          'docs/API.md Business rules row 10: submit only a draft.',
        ),
      },
      (res) => judgeNamedReject(res, 'workflow_gate'),
    );
  }

  phase = '24 invoice draft';
  {
    const vendor = freshVendor('Adv Invoice Draft');
    const po = draftPo(vendor.id, [poLine(0, 2, 5)]);
    attack(
      {
        rule: 'workflow_gate',
        attack: 'invoice a draft purchase order',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: po.id,
            invoice_number: `INV-Draft-${stamp()}`,
            line_items: [inv(0, 2, 5)],
          },
        },
        expected: expectReject(
          'workflow_gate',
          'docs/API.md Business rules row 10: invoice only a submitted or closed purchase order.',
        ),
      },
      (res) => judgeNamedReject(res, 'workflow_gate'),
    );
  }

  phase = '25 match approved';
  {
    const flow = orderInvoiced({
      label: 'Adv Rematch',
      poLines: [poLine(0, 2, 5)],
      receipts: [rcv(0, 2)],
      invoiceNumber: `INV-Rematch-${stamp()}`,
      invoiceLines: [inv(0, 2, 5)],
    });
    matchInvoice(flow.invoice.id);
    approveInvoice(flow.invoice.id);
    attack(
      {
        rule: 'workflow_gate',
        attack: 'match an invoice that is already approved',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/match`, body: {} },
        expected: expectReject(
          'workflow_gate',
          'docs/API.md Business rules row 10: never match an approved invoice again.',
        ),
      },
      (res) => judgeNamedReject(res, 'workflow_gate'),
    );
  }

  phase = '26 duplicate approval';
  {
    const flow = orderInvoiced({
      label: 'Adv Approve Twice',
      poLines: [poLine(0, 2, 5)],
      receipts: [rcv(0, 2)],
      invoiceNumber: `INV-Twice-${stamp()}`,
      invoiceLines: [inv(0, 2, 5)],
    });
    matchInvoice(flow.invoice.id);
    approveInvoice(flow.invoice.id);
    attack(
      {
        rule: 'duplicate_approval',
        attack: 'approve an invoice a second time',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/approve`, body: {} },
        expected: expectReject(
          'duplicate_approval',
          'docs/API.md Business rules row 9: an invoice can be approved only once.',
        ),
      },
      (res) => judgeNamedReject(res, 'duplicate_approval'),
    );
  }

  phase = '27 sku not on po';
  {
    const flow = orderReceived({
      label: 'Adv Foreign Sku',
      poLines: [poLine(0, 3, 5)],
      receipts: [rcv(0, 3)],
    });
    attack(
      {
        rule: 'invoice_line_validation',
        attack: 'invoice a catalog SKU that is not on the purchase order',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: flow.po.id,
            invoice_number: `INV-Foreign-${stamp()}`,
            line_items: [inv(1, 1, 5)],
          },
        },
        expected: expectReject(
          'invoice_line_validation',
          'docs/API.md Business rules row 8: every invoice line is for a SKU on the PO.',
        ),
      },
      (res) => judgeNamedReject(res, 'invoice_line_validation'),
    );
  }

  phase = '28 duplicate sku on invoice';
  {
    const flow = orderReceived({
      label: 'Adv Dup Sku',
      poLines: [poLine(0, 6, 5)],
      receipts: [rcv(0, 6)],
    });
    attack(
      {
        rule: 'invoice_line_validation',
        attack: 'invoice the same SKU on two lines',
        request: {
          method: 'POST',
          path: '/invoices',
          body: {
            po_id: flow.po.id,
            invoice_number: `INV-DupSku-${stamp()}`,
            line_items: [inv(0, 2, 5), inv(0, 2, 5)],
          },
        },
        expected: expectReject(
          'invoice_line_validation',
          'docs/API.md Business rules row 8: each SKU appears once on the invoice.',
        ),
      },
      (res) => judgeNamedReject(res, 'invoice_line_validation'),
    );
  }

  phase = '29 gl balance';
  {
    const lines = [inv(0, 2, 4.75), inv(1, 1, 2.25)];
    const flow = orderInvoiced({
      label: 'Adv Ledger',
      poLines: [poLine(0, 2, 4.75), poLine(1, 1, 2.25)],
      receipts: [rcv(0, 2), rcv(1, 1)],
      invoiceNumber: `INV-Ledger-${stamp()}`,
      invoiceLines: lines,
    });
    matchInvoice(flow.invoice.id);
    attack(
      {
        rule: 'gl_balance',
        attack: 'approve a matched invoice and check the ledger totals',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/approve`, body: {} },
        expected:
          '200, gl_entry.balanced true, and total debits equal total credits equal 11.75. docs/API.md Business rules row 7 and Basics (money rounded to cents).',
      },
      (res) => judgeGl(res, mathCents(lines)),
    );
  }

  phase = '30 gl 0.1 and 0.2';
  {
    const lines = [inv(0, 1, 0.1), inv(1, 1, 0.2)];
    const flow = orderInvoiced({
      label: 'Adv Ledger Tenths',
      poLines: [poLine(0, 1, 0.1), poLine(1, 1, 0.2)],
      receipts: [rcv(0, 1), rcv(1, 1)],
      invoiceNumber: `INV-LedgerTenths-${stamp()}`,
      invoiceLines: lines,
    });
    matchInvoice(flow.invoice.id);
    attack(
      {
        rule: 'gl_balance',
        attack: 'approve an invoice priced at 0.1 and 0.2 and check the ledger totals',
        request: { method: 'POST', path: `/invoices/${flow.invoice.id}/approve`, body: {} },
        expected:
          '200, balanced true, and debits and credits both 0.30. docs/API.md Business rules row 7. 0.10 + 0.20 must not drift.',
      },
      (res) => judgeGl(res, mathCents(lines)),
    );
  }

  phase = '31 exposure one invoice';
  {
    const lines = [inv(0, 3, 6.4)];
    const flow = orderInvoiced({
      label: 'Adv Exposure One',
      poLines: [poLine(0, 3, 6.4)],
      receipts: [rcv(0, 3)],
      invoiceNumber: `INV-ExpOne-${stamp()}`,
      invoiceLines: lines,
    });
    matchInvoice(flow.invoice.id);
    approveInvoice(flow.invoice.id);
    const reported = inspectMoney(flow.invoice.total_amount);
    attack(
      {
        rule: 'vendor_exposure_math',
        attack: 'exposure after one approved invoice',
        request: { method: 'GET', path: `/vendors/${flow.vendor.id}/exposure` },
        expected:
          '200 and open_ap_liability equal to that invoice total_amount, with that invoice id in approved_invoices. docs/API.md Business rules row 11.',
      },
      (res) =>
        judgeExposure(res, {
          expectedCents: mathCents(lines),
          reportedCents: reported.cents,
          approvedIds: [flow.invoice.id],
        }),
    );
  }

  phase = '32 exposure sum excludes unapproved';
  {
    const firstLines = [inv(0, 2, 10)];
    const secondLines = [inv(1, 3, 7.5)];
    const thirdLines = [inv(0, 1, 100)];
    const first = orderInvoiced({
      label: 'Adv Exposure Sum',
      poLines: [poLine(0, 2, 10)],
      receipts: [rcv(0, 2)],
      invoiceNumber: `INV-ExpA-${stamp()}`,
      invoiceLines: firstLines,
    });
    matchInvoice(first.invoice.id);
    approveInvoice(first.invoice.id);
    const secondPo = draftPo(first.vendor.id, [poLine(1, 3, 7.5)]);
    submitPo(secondPo.id);
    receivePo(secondPo.id, [rcv(1, 3)]);
    const secondInvoice = createInvoice(secondPo.id, `INV-ExpB-${stamp()}`, secondLines);
    matchInvoice(secondInvoice.id);
    approveInvoice(secondInvoice.id);
    const thirdPo = draftPo(first.vendor.id, [poLine(0, 1, 100)]);
    submitPo(thirdPo.id);
    receivePo(thirdPo.id, [rcv(0, 1)]);
    createInvoice(thirdPo.id, `INV-ExpOpen-${stamp()}`, thirdLines);
    const reported =
      inspectMoney(first.invoice.total_amount).cents + inspectMoney(secondInvoice.total_amount).cents;
    attack(
      {
        rule: 'vendor_exposure_math',
        attack: 'exposure sums two approved invoices and ignores an unapproved one',
        request: { method: 'GET', path: `/vendors/${first.vendor.id}/exposure` },
        expected:
          '200 and open_ap_liability 42.50, listing only the two approved invoice ids. docs/API.md Business rules row 11: exposure is the sum of total_amount over approved invoices.',
      },
      (res) =>
        judgeExposure(res, {
          expectedCents: mathCents(firstLines) + mathCents(secondLines),
          reportedCents: reported,
          approvedIds: [first.invoice.id, secondInvoice.id],
        }),
    );
  }

  phase = '33 exposure 0.1 and 0.2';
  {
    const firstLines = [inv(0, 1, 0.1)];
    const secondLines = [inv(1, 1, 0.2)];
    const first = orderInvoiced({
      label: 'Adv Exposure Tenths',
      poLines: [poLine(0, 1, 0.1)],
      receipts: [rcv(0, 1)],
      invoiceNumber: `INV-ExpT1-${stamp()}`,
      invoiceLines: firstLines,
    });
    matchInvoice(first.invoice.id);
    approveInvoice(first.invoice.id);
    const secondPo = draftPo(first.vendor.id, [poLine(1, 1, 0.2)]);
    submitPo(secondPo.id);
    receivePo(secondPo.id, [rcv(1, 1)]);
    const secondInvoice = createInvoice(secondPo.id, `INV-ExpT2-${stamp()}`, secondLines);
    matchInvoice(secondInvoice.id);
    approveInvoice(secondInvoice.id);
    const reported =
      inspectMoney(first.invoice.total_amount).cents + inspectMoney(secondInvoice.total_amount).cents;
    attack(
      {
        rule: 'vendor_exposure_math',
        attack: 'exposure of approved invoices priced at 0.1 and 0.2',
        request: { method: 'GET', path: `/vendors/${first.vendor.id}/exposure` },
        expected:
          '200 and open_ap_liability 0.30 for the two approved invoices. docs/API.md Business rules row 11 and Basics: dollars rounded to cents. 0.10 + 0.20 is 0.30.',
      },
      (res) =>
        judgeExposure(res, {
          expectedCents: mathCents(firstLines) + mathCents(secondLines),
          reportedCents: reported,
          approvedIds: [first.invoice.id, secondInvoice.id],
        }),
    );
  }

  const rows = fs
    .readFileSync(LOG, 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const counts = { HELD: 0, BREACHED: 0, undocumented: 0 };
  for (const row of rows) counts[row.outcome] = (counts[row.outcome] || 0) + 1;
  console.log(`SUMMARY count=${rows.length} HELD=${counts.HELD} BREACHED=${counts.BREACHED} undocumented=${counts.undocumented}`);
  for (const row of rows.filter((row) => row.outcome === 'BREACHED')) {
    console.log(`BROKE ${row.rule}: ${row.attack} :: ${row.reason}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`FAILED during ${phase}`);
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
