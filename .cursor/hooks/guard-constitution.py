#!/usr/bin/env python3
"""Block new constitution violations in tests/ and pages/ sources."""

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")

GUARDED_FILE = re.compile(r"(?:^|/)(?:tests|pages)/.+\.[jt]sx?$")
SPEC_FILE = re.compile(r"(?:^|/)tests/.+\.(?:spec|test)\.[jt]sx?$")
XPATH_LOCATOR = re.compile(r"""locator\(\s*(['"`])//""")
ANY_TYPE = re.compile(r": any\b|as any\b|<any>|Array<any>")
FILL_EMAIL = re.compile(r"""\.fill\(\s*(['"`])[^'"`\n]*@[^'"`\n]*\1""")
CREDENTIAL = re.compile(
    r"""(?i)\b(password|secret|api_key|token)\b\s*[:=]\s*(['"`])([^'"`\n]{4,})\2"""
)
DESCRIBE_TAG = re.compile(
    r"""test\.describe\s*\(\s*(?:(['"`])(?:\\.|(?!\1).)*?\1\s*,\s*)?\{[^}]*?\btag\s*:""",
    re.DOTALL,
)

PATTERN_REASONS = (
    ".waitForTimeout(",
    "XPath locator",
    "any type",
    "hardcoded credential",
    "tag on test.describe",
)


def fail_invalid(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(1)


def count_active_expects(text: str) -> int:
    """Count expect( calls that are not commented out."""
    total = 0
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        comment_at = stripped.find("//")
        code = stripped if comment_at == -1 else stripped[:comment_at]
        total += code.count("expect(")
    return total


def code_for_patterns(text: str) -> str:
    """Drop comments, but keep // that sits inside a quoted locator or string."""
    kept: list[str] = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        quote = ""
        cut = len(stripped)
        index = 0
        while index < len(stripped):
            char = stripped[index]
            if quote:
                if char == "\\" and quote != "`":
                    index += 2
                    continue
                if char == quote:
                    quote = ""
                index += 1
                continue
            if stripped.startswith("//", index):
                cut = index
                break
            if char in "'\"`":
                quote = char
            index += 1
        kept.append(stripped[:cut])
    return "\n".join(kept)


def pattern_reasons(text: str) -> set[str]:
    code = code_for_patterns(text)
    found: set[str] = set()
    if ".waitForTimeout(" in code:
        found.add(".waitForTimeout(")
    if XPATH_LOCATOR.search(code):
        found.add("XPath locator")
    if ANY_TYPE.search(code):
        found.add("any type")
    if FILL_EMAIL.search(code) or CREDENTIAL.search(code):
        found.add("hardcoded credential")
    if DESCRIBE_TAG.search(code):
        found.add("tag on test.describe")
    return found


def load_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        fail_invalid("guard-constitution: empty hook input")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail_invalid(f"guard-constitution: invalid JSON: {exc}")
    if not isinstance(payload, dict):
        fail_invalid("guard-constitution: hook payload is not an object")
    return payload


def validated_edits(payload: dict) -> list:
    edits = payload.get("edits", [])
    if edits is None:
        return []
    if not isinstance(edits, list):
        fail_invalid("guard-constitution: edits is not a list")
    for index, edit in enumerate(edits):
        if not isinstance(edit, dict):
            fail_invalid(f"guard-constitution: edits[{index}] is not an object")
        old = edit.get("old_string")
        new = edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str):
            fail_invalid(
                f"guard-constitution: edits[{index}] needs string old_string and new_string"
            )
    return edits


def reverse_edits(after: str, edits: list) -> str | None:
    """Undo edits from last to first. None when a new_string is missing or ambiguous."""
    content = after
    for edit in reversed(edits):
        new_string = edit["new_string"]
        if new_string == "" or content.count(new_string) != 1:
            return None
        content = content.replace(new_string, edit["old_string"], 1)
    return content


def introduced_patterns(edits: list) -> list[str]:
    introduced: set[str] = set()
    for edit in edits:
        introduced.update(pattern_reasons(edit["new_string"]) - pattern_reasons(edit["old_string"]))
    return [reason for reason in PATTERN_REASONS if reason in introduced]


def block(file_path: str, reasons: list[str]) -> None:
    message = f"Blocked: constitution violation in {file_path} — " + "; ".join(reasons)
    json.dump({"user_message": message, "agent_message": message}, sys.stdout)
    sys.stdout.write("\n")
    print(message, file=sys.stderr)
    sys.exit(2)


def main() -> None:
    payload = load_payload()
    file_path = payload.get("file_path")
    if not isinstance(file_path, str) or not file_path.strip():
        fail_invalid("guard-constitution: missing file_path")

    normalized = file_path.replace("\\", "/")
    if GUARDED_FILE.search(normalized) is None:
        sys.exit(0)

    edits = validated_edits(payload)
    try:
        after = Path(file_path).read_text(encoding="utf-8")
    except OSError as exc:
        fail_invalid(f"guard-constitution: cannot read {file_path}: {exc}")

    reasons: list[str] = []
    before = reverse_edits(after, edits)
    if before is None:
        reasons.extend(introduced_patterns(edits))
        if SPEC_FILE.search(normalized):
            after_count = count_active_expects(after)
            delta = sum(
                count_active_expects(edit["old_string"]) - count_active_expects(edit["new_string"])
                for edit in edits
            )
            before_count = after_count + delta
            if after_count < before_count:
                reasons.append(f"active expect( count {before_count} -> {after_count}")
    else:
        reasons.extend(
            reason
            for reason in PATTERN_REASONS
            if reason in pattern_reasons(after) - pattern_reasons(before)
        )
        if SPEC_FILE.search(normalized):
            before_count = count_active_expects(before)
            after_count = count_active_expects(after)
            if after_count < before_count:
                reasons.append(f"active expect( count {before_count} -> {after_count}")

    if reasons:
        block(file_path, reasons)

    print(f"guard-constitution: OK — {file_path}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
