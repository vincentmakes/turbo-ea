---
title: "Deleting a custom card type: where the pieces live and how to test it in a web session"
author: Claude
date: 2026-10-19
branch: claude/delete-custom-card-types-mnrul5
cost: { minutes: 26, tokens: 453522 }
touches:
  - CHANGELOG.md
  - CLAUDE.md
  - VERSION
  - backend/app/api/v1/metamodel.py
  - backend/app/services/card_type_delete.py
  - backend/tests/api/test_metamodel.py
  - backend/tests/api/test_metamodel_delete_type.py
  - docs/admin/metamodel.ar.md
  - docs/admin/metamodel.da.md
  - docs/admin/metamodel.de.md
---

## Decided
- `DELETE /metamodel/types/{key}` already hard-deleted a custom type; the gap was the UI (only Hide) and the 400 on a type with cards. Kept the one endpoint, added `?delete_cards=true` and a `delete-impact` read instead of a new route family.
- The removal lives in `backend/app/services/card_type_delete.py`, not the route handler: mutmut never mutates a decorated function, so ordering (`leaves_first`) and the cascade had to be plain functions to carry a mutation score.
- Cards are deleted leaves-first exactly like `bulk_delete_cards` and publish `card.deleted` with `db=`; relation rows are deleted by type key as well as by card cascade; calculations by `target_type_key`; stakeholder role definitions cascade at the DB (`ondelete="CASCADE"` on `card_types.key`).
- Deleting the cards requires `inventory.delete` on top of `admin.metamodel`; a role with only the metamodel permission can still delete an empty type.
- A custom type with cards and no flag answers 409 `{error: "cards_present"}` (was 400), matching `delete_relation_type`'s shape. Two existing tests in `test_metamodel.py` pinned the 400 and the audit context shape — grep for `status_code == 400` near delete tests, not for the message text.

## Tried and ruled out
- Offering delete from the type card on the Metamodel grid: kept it in the drawer header only, next to Hide, so it cannot be hit by accident.
- `mockApi.fail(..., 403, "detail")` and asserting the detail text: the mock's message is `DELETE <path> failed`, assert `/failed/` like the drawer's own visibility test does.
- `user.click` on a disabled MUI IconButton: user-event throws on `pointer-events: none`; assert `toBeDisabled()` only.

## Watch out
- Web sessions ship no Python or Node deps. `pip install -e ".[dev]"` in `backend/` and a local PostgreSQL 16 cluster exist: `pg_ctlcluster 16 main start`, then create role `turboea`/`turboea` (superuser) and db `turboea_test`; run pytest with `POSTGRES_HOST=localhost POSTGRES_PORT=5432 TEST_DB_REQUIRED=1`.
- The container's npm 10.9 refuses `npm ci` on the committed lockfile ("@babel/traverse@8.0.6 does not satisfy 8.0.7") and `npm install --package-lock=false` crashes with `edgesOut`; `npx -y npm@11 ci` installs cleanly and leaves `package-lock.json` untouched. Without local deps, `npx tsc` resolves a global TypeScript 6 and fails on `baseUrl`.
- `scripts/dump_openapi.py` is at the repo root, run from the root, after the backend deps are installed.
- Audit `context` values must be scalars or flat lists; relation types removed are listed by label, sorted.
