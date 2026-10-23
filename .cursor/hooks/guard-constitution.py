#!/usr/bin/env python3
"""Block new constitution violations in tests/ and pages/ sources."""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Callable
from pathlib import Path

from guard_common import count_active_expects

sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")

GUARDED_FILE = re.compile(r"(?:^|/)(?:tests|pages)/.+\.[jt]sx?$")
SPEC_FILE = re.compile(r"(?:^|/)tests/.+\.(?:spec|test)\.[jt]sx?$")
XPATH_LOCATOR = re.compile(r"""locator\(\s*(['"`])//""")
ANY_TYPE = re.compile(r":\s*any\b|as\s+any\b|<any>|Array<any>")
FILL_EMAIL = re.compile(r"""\.fill\(\s*(['"`])[^'"`\n]*@[^'"`\n]*\1""")
CREDENTIAL = re.compile(
    r"""(?i)\b(password|secret|api_key|token)\b\s*[:=]\s*(['"`])([^'"`\n]{4,})\2"""
)
DESCRIBE_TAG = re.compile(
    r"""test\.describe\s*\(\s*(?:(['"`])(?:\\.|(?!\1).)*?\1\s*,\s*)?\{[^}]*?\btag\s*:""",
    re.DOTALL,
)


def fail_invalid(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(1)


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


def count_wait_for_timeout(content: str) -> int:
    return code_for_patterns(content).count(".waitForTimeout(")


def count_pattern(content: str, pattern: re.Pattern[str]) -> int:
    return len(pattern.findall(code_for_patterns(content)))


def check_increase(
    label: str,
    before: str,
    after: str,
    counter: Callable[[str], int],
) -> str | None:
    before_n = counter(before)
    after_n = counter(after)
    if after_n > before_n:
        return f"{label} introduced ({before_n} -> {after_n})"
    return None


def check_delta_increase(
    label: str,
    old_s: str,
    new_s: str,
    counter: Callable[[str], int],
) -> str | None:
    if counter(new_s) > counter(old_s):
        return f"{label} introduced in edit"
    return None


def pattern_checks() -> list[tuple[str, Callable[[str], int]]]:
    return [
        (".waitForTimeout(", count_wait_for_timeout),
        (
            "XPath locator (locator('//…'))",
            lambda s: count_pattern(s, XPATH_LOCATOR),
        ),
        ("TypeScript any", lambda s: count_pattern(s, ANY_TYPE)),
        (
            "Hardcoded email in .fill()",
            lambda s: count_pattern(s, FILL_EMAIL),
        ),
        (
            "Hardcoded password/secret/api_key/token",
            lambda s: count_pattern(s, CREDENTIAL),
        ),
        (
            "tag on test.describe()",
            lambda s: count_pattern(s, DESCRIBE_TAG),
        ),
    ]


def collect_file_violations(before: str, after: str, *, is_spec: bool) -> list[str]:
    reasons: list[str] = []
    for label, counter in pattern_checks():
        reason = check_increase(label, before, after, counter)
        if reason:
            reasons.append(reason)
    if is_spec:
        before_e = count_active_expects(before)
        after_e = count_active_expects(after)
        if before_e > after_e:
            reasons.append(f"active expect( count dropped ({before_e} -> {after_e})")
    return reasons


def collect_delta_violations(old_s: str, new_s: str, *, is_spec: bool) -> list[str]:
    reasons: list[str] = []
    for label, counter in pattern_checks():
        reason = check_delta_increase(label, old_s, new_s, counter)
        if reason:
            reasons.append(reason)
    if is_spec:
        if count_active_expects(new_s) < count_active_expects(old_s):
            reasons.append("active expect( removed or commented in edit")
    return reasons


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

    is_spec = SPEC_FILE.search(normalized) is not None
    reasons: list[str] = []
    before = reverse_edits(after, edits)
    if before is not None:
        reasons = collect_file_violations(before, after, is_spec=is_spec)
    else:
        for edit in edits:
            reasons.extend(
                collect_delta_violations(
                    edit["old_string"],
                    edit["new_string"],
                    is_spec=is_spec,
                ),
            )
        if is_spec and not any("expect(" in r for r in reasons):
            after_count = count_active_expects(after)
            delta = sum(
                count_active_expects(edit["old_string"])
                - count_active_expects(edit["new_string"])
                for edit in edits
            )
            before_count = after_count + delta
            if before_count > after_count:
                reasons.append(
                    f"active expect( count dropped ({before_count} -> {after_count})"
                )

    if reasons:
        block(file_path, reasons)

    print(f"guard-constitution: OK — {file_path}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
