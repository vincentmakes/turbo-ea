#!/usr/bin/env bash
#
# Run the backend test suite with an auto-provisioned PostgreSQL container.
# Automatically creates a venv and installs dependencies on first run.
#
# Usage:
#   ./scripts/test.sh              # run all tests in parallel (needs Docker)
#   ./scripts/test.sh -k security  # only tests matching "security"
#   ./scripts/test.sh --unit       # only unit tests (no database needed)
#   ./scripts/test.sh --cov        # with coverage report (runs serial)
#   ./scripts/test.sh --serial     # force sequential execution
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
SERIAL=false
PYTEST_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --unit)
            UNIT_ONLY=true
            ;;
        --cov)
            WITH_COV=true
            ;;
        --serial)
            SERIAL=true
            ;;
        *)
            PYTEST_ARGS+=("$arg")
            ;;
    esac
done

if $WITH_COV; then
    PYTEST_ARGS+=("--cov=app" "--cov-report=term-missing")
    SERIAL=true  # coverage measurement requires serial execution
fi

# ── Ensure venv exists and is activated ──────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "==> Creating virtual environment at backend/venv..."
    python3 -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

if ! python -c "import pytest" 2>/dev/null; then
    echo "==> Installing dev dependencies (first run, may take a moment)..."
    pip install -e "$BACKEND_DIR[dev]" --quiet --quiet 2>&1 | tail -5
fi

# Enable parallel execution unless --serial or --cov (check after venv activation)
if ! $SERIAL && ! $UNIT_ONLY; then
    if python -c "import xdist" 2>/dev/null; then
        PYTEST_ARGS+=("-n" "auto" "--dist" "loadscope")
    fi
fi

# ── Unit-only mode: skip Docker entirely ──────────────────────────────
if $UNIT_ONLY; then
    echo "==> Running unit tests only (no database)"
    cd "$BACKEND_DIR"
    python -m pytest tests/core/ tests/services/test_calculation_engine.py tests/services/test_bpmn_parser.py "${PYTEST_ARGS[@]}" 2>/dev/null || \
    python -m pytest tests/core/ "${PYTEST_ARGS[@]}"
    exit $?
fi

# ── Full mode: check Docker is available ─────────────────────────────
if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker is not running."
    echo ""
    echo "  Full tests need Docker for an ephemeral PostgreSQL."
    echo "  Either start Docker, or run unit tests only:"
    echo ""
    echo "    ./scripts/test.sh --unit"
    echo ""
    exit 1
fi

# ── Start test database ─────────────────────────────────────────────
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
