---
title: "Restoring the isolated VAPT stack means recreating its database, not loading the dump over it"
author: Tom
date: 2026-11-20
branch: fix/mutation-stale-cached-tests
cost: { minutes: 1, tokens: 2760 }
id: l-682e6bf5
scope: repo
status: active
src: agent
touches:
  - ".claude/agents/vapt.md"
---

In the code: `.claude/agents/vapt.md` (step 3), baseline `../turbo-ea-vapt/instance/backup_pre-licensing-vapt_2026-11-19.sql`, container `turboea-vapt-db-1`.

## Decided
The baseline dump has no DROP statements, so a restore stops the backend, runs `DROP DATABASE turboea WITH (FORCE)` and `CREATE DATABASE turboea` in `turboea-vapt-db-1`, loads the dump with `psql -U turboea turboea`, then starts the backend so Alembic runs. Images are built as `turboea-vapt-<svc>:local`.

## Tried and ruled out
Loading the dump over the existing database (it leaves the data of the last run behind). Picking the newest backup in that folder: the other two were taken in the middle of a test and are not clean.

## Watch out
`turboea-fork-*` tags and `turbo-ea-conf` are the user's real instance: never build or restore there. `accounts.md` describes the real instance and holds its passwords, so the agent does not read it and creates its own `vapt-<role>@example.com` users each run.
