#!/usr/bin/env bash
# Generate a pinned lockfile from pyproject.toml using pip-compile.
#
# Usage:
#   ./scripts/lock-deps.sh            # Generate backend/requirements.lock
#   ./scripts/lock-deps.sh --upgrade  # Upgrade all deps to latest compatible
#
# The lockfile should be committed. CI can validate it hasn't drifted by running:
#   pip-compile --quiet --strip-extras -o /tmp/fresh.lock backend/pyproject.toml
#   diff backend/requirements.lock /tmp/fresh.lock
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if ! command -v pip-compile &>/dev/null; then
    echo "pip-compile not found. Install it: pip install pip-tools"
    exit 1
fi

pip-compile \
    --quiet \
    --strip-extras \
    --output-file "$PROJECT_ROOT/backend/requirements.lock" \
    "$@" \
    "$PROJECT_ROOT/backend/pyproject.toml"

echo "Lockfile written to backend/requirements.lock"
echo "Commit this file to ensure reproducible builds."
