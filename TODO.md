# TODO

## Goal
Deploy everything in Docker from local source, recreating from scratch with demo data (including ArchiMate) on port 8920 in development mode, without MCP or Ollama profiles.

## Tasks

### 0. Pull latest source from Git
- [x] Fetch origin, rebase to get 8 latest ArchiMate commits
- [x] Verify on-disk files match origin/claude/archimate-turbo-plugin-nThe2

### 1. Clean up `.env` file
- [x] Remove duplicate `HOST_PORT` lines (keep `8920`)
- [x] Remove duplicate `ENVIRONMENT` lines (keep `development`)
- [x] Set `RESET_DB=true` to force a fresh database on startup
- [x] Set `SEED_DEMO=true`, `SEED_BPM=true`, `SEED_PPM=true` (clean, non-duplicate)
- [x] Keep `MIGRATE_ARCHIMATE_UNIQUE=true` as requested
- [x] Clean up orphaned/bogus comment lines that shadowed actual values

### 2. Tear down existing Docker stack
- [x] Run `docker compose -p turboea down -v` to remove containers and the `postgres_data` volume
- [x] Run `docker compose build --no-cache` to force-fresh images (not cached layers)
- [x] Optionally prune dangling images to reclaim space

### 3. Build and start everything from source
- [x] Run `docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d` (no `--profile` flags)
- [x] Wait for all services (db, backend, frontend, nginx) to become healthy
- [x] Verify fresh image SHAs (frontend: `0130cdc0ed92`, backend: `e2eb50a4a913`)

### 4. Verify the deployment
- [x] Smoke-test `GET http://localhost:8920/api/health` returns version `1.25.0`
- [x] Smoke-test `GET http://localhost:8920` returns the Turbo EA frontend (login page)
- [x] Confirm demo data was seeded (first registered user gets admin role)

## Notes
- Fresh database: `RESET_DB=true` will drop all tables and re-seed on first startup.
- ArchiMate unique mode: after seeding, non-ArchiMate data (standard card types, cards, relations) will be stripped, leaving only ArchiMate elements visible.
- Builder will use the root `Dockerfile` with multi-stage targets (`db`, `backend`, `frontend`, `nginx`).
- No MCP or AI/Ollama profiles will be started — they remain available via `--profile mcp` or `--profile ai` later.
