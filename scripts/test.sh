#!/usr/bin/env bash
#
# Run the backend test suite with an auto-provisioned PostgreSQL container.
# Automatically creates a venv and installs dependencies on first run.
#
# Usage:
#   ./scripts/test.sh              # run all tests
#   ./scripts/test.sh -k security  # only tests matching "security"
#   ./scripts/test.sh --unit       # only unit tests (no database needed)
#   ./scripts/test.sh --cov        # with coverage report
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_DIR="$BACKEND_DIR/venv"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.test.yml"
COMPOSE_PROJECT="turboea-test"

# Parse our custom flags; pass everything else to pytest
UNIT_ONLY=false
WITH_COV=false
PYTEST_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --unit)
            UNIT_ONLY=true
            ;;
        --cov)
            WITH_COV=true
            ;;
        *)
            PYTEST_ARGS+=("$arg")
            ;;
    esac
done

if $WITH_COV; then
    PYTEST_ARGS+=("--cov=app" "--cov-report=term-missing")
fi

# ── Ensure venv exists and is activated ──────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "==> Creating virtual environment at backend/venv..."
    python3 -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

if ! python -c "import pytest" 2>/dev/null; then
    echo "==> Installing dev dependencies..."
    pip install -e "$BACKEND_DIR[dev]" -q
fi

# ── Unit-only mode: skip Docker entirely ──────────────────────────────
if $UNIT_ONLY; then
    echo "==> Running unit tests only (no database)"
    cd "$BACKEND_DIR"
    python -m pytest tests/core/ tests/services/test_calculation_engine.py tests/services/test_bpmn_parser.py "${PYTEST_ARGS[@]}" 2>/dev/null || \
    python -m pytest tests/core/ "${PYTEST_ARGS[@]}"
    exit $?
fi

# ── Full mode: start test database ────────────────────────────────────
cleanup() {
    echo "==> Stopping test database..."
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Starting test database..."
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d --wait

echo "==> Running tests..."
cd "$BACKEND_DIR"

export POSTGRES_HOST=localhost
export POSTGRES_PORT=5433
export POSTGRES_USER=turboea
export POSTGRES_PASSWORD=turboea
export TEST_POSTGRES_DB=turboea_test

python -m pytest "${PYTEST_ARGS[@]}"
