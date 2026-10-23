"""Shared helpers for Cursor agent guard hooks."""

from __future__ import annotations


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
