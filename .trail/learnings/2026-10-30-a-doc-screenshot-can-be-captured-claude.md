---
title: "A doc screenshot can be captured in the cloud session without Docker: local Postgres 16 as the postgres user, backend and Vite dev server, capture against port…"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 13, tokens: 64499 }
id: l-b5b0b266
scope: repo
status: active
src: agent
touches:
  - docs/admin/metamodel.ar.md
  - docs/admin/metamodel.da.md
  - docs/admin/metamodel.de.md
  - docs/admin/metamodel.es.md
  - docs/admin/metamodel.fr.md
  - docs/admin/metamodel.it.md
  - docs/admin/metamodel.pt.md
  - docs/admin/metamodel.ru.md
  - docs/admin/metamodel.zh.md
  - docs/admin/tags.ar.md
---

## Decided
The Docker CLI exists in the cloud container but no daemon runs, so `docker compose` and `scripts/test.sh` are out. The box has PostgreSQL 16 installed, so the app can run natively: start a throwaway cluster as the `postgres` system user (initdb refuses root), run the backend with `SEED_DEMO=true` against it, run the Vite dev server, and point the screenshot script at the dev server. The whole run, seed included, took a few minutes and produced all ten locale PNGs; the strict docs build then passes.

## Tried and ruled out
- Leaving the PNG for the maintainer: the docs page would ship with a broken image, and the strict build fails on the missing target. Capturing locally was cheaper than it looked.
- Running initdb/pg_ctl as root: refused. The data dir must live somewhere the postgres user can traverse (chmod 755 on the scratchpad path, chown the pg dir).

## Watch out
- `pkill -f vite` also kills the shell that runs it (exit 144); kill by pid instead.
- Playwright is pre-installed; set `PLAYWRIGHT_EXECUTABLE_PATH=/opt/pw-browsers/chromium` and `SCREENSHOT_BROWSER_ARGS=--no-sandbox` instead of running `playwright install`.
- Capture after `/translate`, not before: the non-English filenames come from the translator.
- `mkdocs` is not installed by default; `pip install -r requirements-docs.txt` at the repo root, then `mkdocs build --strict`.

In the code:
- `su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D <dir>/data -U turboea --auth=trust && pg_ctl -D <dir>/data -o '-p 5444 -k <dir> -c listen_addresses=localhost' start"`, then `psql -h localhost -p 5444 -U turboea -d postgres -c "CREATE DATABASE turboea;"`
- backend: `POSTGRES_HOST=localhost POSTGRES_PORT=5444 POSTGRES_PASSWORD=turboea SECRET_KEY=<anything long> SEED_DEMO=true ALLOWED_ORIGINS=http://localhost:5173 python -m uvicorn app.main:app --port 8000`
- frontend: `npm run dev -- --port 5173` (proxies /api to 8000)
- `cd scripts/screenshots && npm ci && npx tsx capture.ts --base-url http://localhost:5173 --only <id>`; demo login is the script's default admin.
