#!/usr/bin/env bash
#
# Check and rebuild the user manual inside Linux containers.
#
# Usage (from anywhere inside the repository, in Git Bash / bash):
#   scripts/docs/docker-docs.sh check              mkdocs build --strict (the CI build is not strict)
#   scripts/docs/docker-docs.sh images             manual <-> scripts/screenshots/pages.ts contract
#   scripts/docs/docker-docs.sh capture [ARGS...]  build this tree, start an isolated stack with the demo
#                                                  data, retake screenshots (ARGS go to capture.ts,
#                                                  e.g. --locale en --only 26,27), then check
#   scripts/docs/docker-docs.sh all                check + images
#   scripts/docs/docker-docs.sh down               stop the capture stack and remove its volumes
#
# The capture stack is its own compose project (tea-docs) on its own ports, with a throwaway
# database seeded with the demo data (SEED_DEMO=true): it never touches your own instance, and no
# real data is ever in a screenshot. Screenshots are written into docs/assets/img/.
#
# Anonymising an instance that holds real data is deliberately not done here: capture only the demo
# stack. If a shot ever has to come from a real instance, rewrite names in the page with
# page.evaluate before the screenshot, never in the database.
set -euo pipefail

export MSYS_NO_PATHCONV=1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_REPO="$(cd "$REPO" && (pwd -W 2>/dev/null || pwd))"

PY_IMAGE="${DOCS_PY_IMAGE:-python:3.12}"
NODE_IMAGE="${DOCS_NODE_IMAGE:-node:22-bookworm}"
PROJECT="tea-docs"
HOST_PORT_DOCS="${DOCS_HOST_PORT:-18920}"
TLS_PORT_DOCS="${DOCS_TLS_PORT:-18443}"

usage() { sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }
[ $# -ge 1 ] || usage
MODE="$1"
shift

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }

stack() {
    POSTGRES_PASSWORD=docs_throwaway SECRET_KEY=docs_throwaway_secret_key_not_for_real_use_0123456789 \
        SEED_DEMO=true HOST_PORT="$HOST_PORT_DOCS" TLS_HOST_PORT="$TLS_PORT_DOCS" \
        docker compose -p "$PROJECT" -f "$HOST_REPO/docker-compose.yml" -f "$HOST_REPO/scripts/docs/docker-compose.docs.yml" "$@"
}

run_check() {
    echo "==> mkdocs build --strict ($PY_IMAGE)"
    docker run --rm -v "$HOST_REPO:/src:ro" -v tea-docs-pip:/root/.cache/pip "$PY_IMAGE" bash -c '
        set -e
        pip install --quiet -r /src/requirements-docs.txt
        cd /src && mkdocs build --strict -d /tmp/site'
}

run_images() {
    echo "==> manual <-> pages.ts contract"
    docker run --rm -v "$HOST_REPO:/src:ro" "$PY_IMAGE" python /src/scripts/docs/check_doc_images.py
}

run_capture() {
    for svc in db backend frontend nginx mcp-server; do
        echo "==> docker build --target $svc"
        docker build -q --target "$svc" -t "turboea-docs-$svc:local" "$HOST_REPO"
    done
    echo "==> Starting the isolated stack on port $HOST_PORT_DOCS (demo data)"
    stack up -d
    echo "==> Waiting for the backend"
    for _ in $(seq 1 120); do
        curl -fsS "http://localhost:$HOST_PORT_DOCS/api/health" >/dev/null 2>&1 && break
        sleep 5
    done
    curl -fsS "http://localhost:$HOST_PORT_DOCS/api/health" >/dev/null || { echo "stack did not become healthy"; stack logs --tail 50 backend; exit 1; }
    echo "==> Capturing"
    docker run --rm -v "$HOST_REPO:/work" \
        -v tea-docs-shots-nm:/work/scripts/screenshots/node_modules \
        -v tea-docs-pw:/root/.cache/ms-playwright \
        -e BASE_URL="http://host.docker.internal:$HOST_PORT_DOCS" \
        --add-host=host.docker.internal:host-gateway \
        "$NODE_IMAGE" bash -c '
            set -e
            cd /work/scripts/screenshots
            npm ci --silent
            npx playwright install --with-deps chromium
            npx tsx capture.ts "$@"' _ "$@"
}

case "$MODE" in
    check) run_check ;;
    images) run_images ;;
    all | capture)
        # Run both checks even when the first fails, so one run reports everything.
        [ "$MODE" = "capture" ] && run_capture "$@"
        rc=0
        run_check || rc=1
        run_images || rc=1
        exit "$rc"
        ;;
    down) stack down -v ;;
    *) usage ;;
esac
