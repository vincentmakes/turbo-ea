# TODO

## Goal
Add a `MIGRATE_ARCHIMATE_UNIQUE` flag that, when set to true at startup (or triggered from the admin settings UI), deletes all non-ArchiMate demo cards/relations (the standard Turbo EA seed data) and hides their card types, leaving only the ArchiMate metamodel + demo data visible. This makes the instance "ArchiMate-only".

## Tasks

### 1. Add `MIGRATE_ARCHIMATE_UNIQUE` env var to backend config
- [x] Add `MIGRATE_ARCHIMATE_UNIQUE: bool` to `backend/app/config.py` (reads from env, same pattern as `SEED_ARCHIMATE`)
- [x] Add to `.env.example` with a comment explaining the flag

### 2. Create the migration service function
- [x] In `backend/app/plugins/archimate/migrate_unique.py`, create `migrate_archimate_unique(db)` that:
  - Deletes all `cards` where the `type` does NOT start with `arch_` (i.e., non-ArchiMate cards)
  - Deletes all `relations` where either source or target card type doesn't start with `arch_`
  - Deletes all `card_types` where `plugin_id != 'archimate'`
  - Deletes all `relation_types` where `plugin_id != 'archimate'`
  - Leaves ArchiMate card types, relation types, cards, and relations intact
  - DB-level CASCADE handles related rows (comments, tags, stakeholders, events, etc.)

### 3. Wire into startup lifecycle in `main.py`
- [x] After the ArchiMate seed block in `backend/app/main.py`, check `settings.MIGRATE_ARCHIMATE_UNIQUE` and call the migration function
- [x] Should run after `SEED_ARCHIMATE` has finished seeding data

### 4. Add admin settings API endpoint to trigger migration
- [x] In `backend/app/api/v1/settings.py`, add `POST /settings/archimate-migrate-unique`
- [x] Requires `archimate.manage` permission
- [x] Returns count of deleted items: `{cards_deleted, relations_deleted, card_types_deleted, relation_types_deleted}`

### 5. Add frontend UI button in ArchiMate admin panel
- [x] In `frontend/src/features/admin/ArchiMateAdmin.tsx`, add a "Migrate to ArchiMate-only" button section with warning styling
- [x] Show a confirmation dialog before executing
- [x] Show a snackbar with the result counts
- [x] Disable the button when ArchiMate is disabled or migration is in progress

### 6. Update E2E tests
- [x] Add test for the migration endpoint in `e2e/tests/archimate/demo-data.spec.ts` — verifies standard types exist before, migration deletes them, ArchiMate types survive

## Notes
- The migration is destructive — it removes all standard Turbo EA (non-ArchiMate) data. Users should be warned.
- `MIGRATE_ARCHIMATE_UNIQUE` only takes effect at startup. The API endpoint is for admin-triggered runs at runtime.
- Standard Turbo EA seed (SEED_DEMO) still runs first. Then the ArchiMate seed runs. Then the migration flag is checked — this ordering ensures ArchiMate data exists before the purge.
- For the admin button: since this deletes a lot of stuff, we should add a confirmation dialog with the counts preview before executing.
