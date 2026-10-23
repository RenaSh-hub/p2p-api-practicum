#!/usr/bin/env python3
"""Block agent edits that reduce the number of active expect( calls in a spec."""

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")

TEST_FILE = re.compile(r"(?:^|/)tests/.+\.(?:spec|test)\.[jt]sx?$")


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


def load_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        fail_invalid("guard-test-assertions: empty hook input")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail_invalid(f"guard-test-assertions: invalid JSON: {exc}")
    if not isinstance(payload, dict):
        fail_invalid("guard-test-assertions: hook payload is not an object")
    return payload


def validated_edits(payload: dict) -> list:
    edits = payload.get("edits", [])
    if edits is None:
        return []
    if not isinstance(edits, list):
        fail_invalid("guard-test-assertions: edits is not a list")
    for index, edit in enumerate(edits):
        if not isinstance(edit, dict):
            fail_invalid(f"guard-test-assertions: edits[{index}] is not an object")
        old = edit.get("old_string")
        new = edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str):
            fail_invalid(
                f"guard-test-assertions: edits[{index}] needs string old_string and new_string"
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


def main() -> None:
    payload = load_payload()
    file_path = payload.get("file_path")
    if not isinstance(file_path, str) or not file_path.strip():
        fail_invalid("guard-test-assertions: missing file_path")

    normalized = file_path.replace("\\", "/")
    if TEST_FILE.search(normalized) is None:
        sys.exit(0)

    edits = validated_edits(payload)
    try:
        after = Path(file_path).read_text(encoding="utf-8")
    except OSError as exc:
        fail_invalid(f"guard-test-assertions: cannot read {file_path}: {exc}")

    after_count = count_active_expects(after)
    before = reverse_edits(after, edits)
    if before is None:
        delta = sum(
            count_active_expects(edit["old_string"]) - count_active_expects(edit["new_string"])
            for edit in edits
        )
        before_count = after_count + delta
    else:
        before_count = count_active_expects(before)

    if after_count < before_count:
        message = (
            f"Blocked: test assertions weakened in {file_path} — "
            f"active expect( count {before_count} -> {after_count}. "
            "Do not delete or comment out assertions to make tests pass. "
            "Fix the app, locator, or test data instead."
        )
        json.dump({"user_message": message, "agent_message": message}, sys.stdout)
        sys.stdout.write("\n")
        print(message, file=sys.stderr)
        sys.exit(2)

    print(
        f"guard-test-assertions: OK — {after_count} active expect( preserved",
        file=sys.stderr,
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
