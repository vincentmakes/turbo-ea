---
title: "In a cloud session, install the frontend with npm 11 and run Postgres from the postgres user's home"
author: Claude
date: 2026-10-28
branch: claude/busy-sagan-7kbwf1
cost: { minutes: 1, tokens: 2785 }
id: l-65b84911
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/admin/metamodel/relationValueErrors.test.ts
  - CHANGELOG.md
  - VERSION
  - backend/alembic/versions/158_fix_arabic_relation_verbs.py
  - backend/app/api/v1/metamodel.py
  - backend/app/services/seed.py
  - backend/tests/api/test_metamodel.py
  - backend/tests/services/test_alembic_158_arabic_relation_verbs.py
  - backend/tests/services/test_i18n_seed.py
  - backend/tests/services/test_seed.py
---

## Decided
To run the frontend tests and the database-backed backend tests in a cloud (web) session, which has no Docker daemon for `scripts/test.sh`:
- Install the frontend with npm 11 (`npx -y npm@11 ci`). CI runs Node 24 and the lockfile is written by npm 11.
- Run the Postgres 16 that is installed on the machine. Create its data directory under the postgres user's home, start it on port 5433, and create the `turboea` role and the `turboea_test` database by hand.

## Tried and ruled out
- `npm ci` with the machine's npm 10.9 (Node 22): it refuses with "package.json and package-lock.json are not in sync" (`@babel/core@8` in the lock).
- `npm install --no-save --package-lock=false`: it crashes with "Cannot read properties of null (reading 'edgesOut')".
- `initdb` in the session scratchpad: the postgres user cannot traverse the scratchpad's parent directories, so it fails with "Permission denied".

## Watch out
- `pkill -f "<pattern>"` or `pgrep -f` in the same Bash call also matches the shell running it, and kills that call (exit 144). Find the PIDs with `ps -eo pid,args | grep "[u]vicorn"` and kill those.
- The demo seed creates users first, so a newly registered account is a `member`, not the first-user admin. On a throwaway database, promote it with SQL.

In the code:
- Database: `D=/var/lib/postgresql/turbo-test; mkdir -p $D && chown postgres $D; su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres && /usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 5433 -k /tmp' -l $D/log start"`.
- Role and database: `CREATE ROLE turboea LOGIN SUPERUSER PASSWORD 'turboea'; CREATE DATABASE turboea_test OWNER turboea;`.
- Run tests with `POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=turboea POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test TEST_DB_REQUIRED=1 python -m pytest …`.
- Backend dependencies: `cd backend && pip install -e ".[dev]"`.
