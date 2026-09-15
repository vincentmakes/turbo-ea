#!/usr/bin/env bash
# postCreateCommand for Codespaces — runs once when the codespace is created.
# Generates .env, builds the images, and brings up the demo stack.
#
# This script always exits 0. The intent is "set up the demo as far as you
# can, then surface diagnostics" — not "fail the codespace creation if
# anything went wrong." Failing the postCreateCommand makes Codespaces
# show a red cross and discourages the user from continuing, even when
# the underlying issue is a transient network blip during a docker build.
set -u +e

cd "$(dirname "$0")/.."

log()  { echo "[setup] $*"; }
warn() { echo "[setup] WARNING: $*"; }
fail() { echo "[setup] ERROR: $*"; }

log "======================================"
log "  Turbo EA Demo — Setting up..."
log "======================================"

# Generate .env if missing. Re-running the script preserves existing secrets
# so cached JWTs continue to validate.
if [ ! -f .env ]; then
  SECRET_KEY=$(openssl rand -base64 48)
  POSTGRES_PASSWORD=$(openssl rand -base64 24)
  cat > .env <<EOF
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
SECRET_KEY=${SECRET_KEY}
ACCESS_TOKEN_EXPIRE_MINUTES=1440
ENVIRONMENT=development
ALLOWED_ORIGINS=*
HOST_PORT=8920
SEED_DEMO=true
SEED_PPM=true
EOF
  log "Generated .env with demo configuration."
else
  log "Existing .env detected — keeping current secrets."
fi

COMPOSE="docker compose -f docker-compose.yml"

# Nginx mounts ${TLS_CERTS_DIR:-./certs} read-only; the directory must exist
# even when TLS is disabled, otherwise the bind mount fails on container start.
mkdir -p ./certs

# Pull published images with one retry. We deliberately do NOT layer the
# dev/docker-compose.dev.yml override here — a demo codespace should mirror
# what a real user gets from `docker compose pull`, not rebuild every image
# from source (which takes 5–10 minutes and exercises the dev path instead
# of the published one).
log "Pulling Turbo EA images from GHCR..."
if ! $COMPOSE pull; then
  warn "Initial pull failed, retrying after 10s..."
  sleep 10
  if ! $COMPOSE pull; then
    fail "Pull failed twice. Diagnostics:"
    $COMPOSE ps || true
    docker images || true
    fail "Re-run manually:  $COMPOSE pull"
    exit 0
  fi
fi
log "Images ready."

# Bring up the stack.
log "Starting containers..."
if ! $COMPOSE up -d; then
  fail "docker compose up failed. Diagnostics:"
  $COMPOSE ps || true
  $COMPOSE logs --tail=100 || true
  exit 0
fi

# Wait for the full chain (Codespaces forward → nginx :8920 → backend → db)
# to respond. Hitting the forwarded port from the host validates exactly
# what the user's browser hits, so a healthy result here means port 8920
# will not 502 when opened. 8-minute budget for first-run SEED_DEMO=true
# on the 4-core machine `hostRequirements` asks for -- the pull and the
# demo seed together are what consume it, not the container start.
log "Waiting for Turbo EA on http://localhost:8920 ..."
ready=0
for i in $(seq 1 240); do
  if curl -sf -o /dev/null -m 3 "http://localhost:8920/api/health"; then
    ready=1
    log "Backend is responding via the frontend proxy after $((i * 2))s."
    break
  fi
  if [ $((i % 15)) -eq 0 ]; then
    log "  ... still waiting ($((i * 2))s elapsed)"
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  warn "Turbo EA did not respond on port 8920 within 8 minutes."
  warn "Container status:"
  $COMPOSE ps || true
  warn "Recent backend logs:"
  $COMPOSE logs --tail=80 backend 2>/dev/null || true
  warn "Recent frontend logs:"
  $COMPOSE logs --tail=40 frontend 2>/dev/null || true
  warn "The stack may still finish starting in the background — refresh the"
  warn "forwarded port in a minute or two. If it stays broken:"
  warn "  $COMPOSE ps"
  warn "  $COMPOSE logs --tail=200"
  exit 0
fi

log ""
log "======================================"
log "  Turbo EA Demo is running!"
log "======================================"
log ""
log "  Open the forwarded port 8920 in your browser."
log ""
log "  Login credentials:"
log "    Email:    admin@turboea.demo"
log "    Password: TurboEA!2025"
log ""
log "  Useful commands:"
log "    $COMPOSE logs -f       # View logs"
log "    $COMPOSE down          # Stop demo"
log "    $COMPOSE restart       # Restart"
log ""
exit 0
