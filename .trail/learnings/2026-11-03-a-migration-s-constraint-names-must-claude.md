---
title: "A migration's constraint names must match what the models create on a fresh install, or rolling it back fails"
author: Claude
date: 2026-11-03
branch: claude/confident-cerf-e9wmey
cost: { minutes: 4, tokens: 45572 }
id: l-a6e4cb47
scope: repo
status: active
src: agent
touches:
  - backend/alembic/versions/163_ea_principle_reference.py
  - backend/app/models/ea_principle.py
  - ".github/workflows/ci.yml"
---

## Decided
- The Migration Rollback Test CI job builds the schema with `Base.metadata.create_all`, stamps head, then runs `alembic downgrade -1` and `upgrade head`. On a fresh install, every constraint therefore carries the name SQLAlchemy/PostgreSQL gives it from the model, not the name a migration chose.
- When a migration adds a unique column, declare `unique=True` on the column in the migration exactly as the model does. PostgreSQL then names it `<table>_<column>_key` on both paths, and the downgrade just drops the column, which takes the constraint with it.

## Tried and ruled out
- `op.create_unique_constraint("uq_<table>_<col>", ...)` while the model keeps `unique=True` on the column. The upgrade works on an existing install, but the downgrade on a fresh one fails with `constraint "uq_..." does not exist`. There is no naming_convention on Base to reconcile the two names.

## Watch out
- This only shows up in CI's rollback job. conftest builds the test schema with create_all and never runs migrations, so the local suite stays green.
- Reproduce locally: create_all on an empty DB, `alembic stamp head`, then `alembic downgrade -1`.

In the code: backend/alembic/versions/163_ea_principle_reference.py, backend/app/models/ea_principle.py, .github/workflows/ci.yml (Migration Rollback Test job)
