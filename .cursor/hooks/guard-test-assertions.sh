#!/usr/bin/env bash
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
exec python3 "$dir/guard-test-assertions.py"
