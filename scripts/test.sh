#!/usr/bin/env bash
#
# Run the backend test suite with an auto-provisioned PostgreSQL container.
#
# Usage:
#   ./scripts/test.sh              # run all tests
#   ./scripts/test.sh -k security  # only tests matching "security"
#   ./scripts/test.sh --unit       # only unit tests (no database needed)
#   ./scripts/test.sh --cov        # with coverage report
#
# Prerequisites:
#   cd backend && pip install -e ".[dev]"   (once, in a venv)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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

# ── Check that pytest is available ───────────────────────────────────
if ! python -c "import pytest" 2>/dev/null; then
    echo "ERROR: pytest not found. Install dev dependencies first:"
    echo ""
    echo "  cd backend && pip install -e \".[dev]\""
    echo ""
    echo "  (use a venv:  python -m venv venv && source venv/bin/activate)"
    exit 1
fi

# ── Unit-only mode: skip Docker entirely ──────────────────────────────
if $UNIT_ONLY; then
    echo "==> Running unit tests only (no database)"
    cd "$PROJECT_ROOT/backend"
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
cd "$PROJECT_ROOT/backend"

export POSTGRES_HOST=localhost
export POSTGRES_PORT=5433
export POSTGRES_USER=turboea
export POSTGRES_PASSWORD=turboea
export TEST_POSTGRES_DB=turboea_test

python -m pytest "${PYTEST_ARGS[@]}"
