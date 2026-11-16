# Licensing metrics — configurable metrics and types, a per-year pair model, a reworked report and card section

**Status:** approved by the user 2026-11-16 ("vai con il piano"). **Branch:** `docs/licensing-refinements-spec` (off `main`). **Builds on:** [`2026-11-05-licensing-core-design.md`](2026-11-05-licensing-core-design.md) (shipped; its rules stay unless this document changes them) and `.claude/rules/licensing-items.md`.

## Intent

Licensing in core has two fixed **metrics** (`users`, `installations`, constants in `license_status.py` and `licenses.ts`) and a flat catalogue of license **types** that is not tied to any metric. The same "Admin" type is offered under Users and Installations, a card says which metrics it tracks through a protected multiple-select field (`licensingModel`), and the report mixes everything in one chart. The user wants the structure of licenses to follow how they are really contracted:

- A **metric** is something licenses are counted in (Users, Installations, anything the admin adds). Each metric has its own **types** (Users: Business, Admin; Installations: Prod, No-Prod). Metrics and types are catalogue data, edited in one place.
- A card does not "track a metric". It has the **pairs Metric:Type** the user added to it, **for each year**. The card section and the report show the pairs that exist in the **selected year**.
- Counts of different metrics are never mixed: users are compared with users, installations with installations.

## Goals

1. One admin panel, the existing **License types** button in Metamodel configuration → Card types, manages **metrics and their types** (create, rename, translate, reorder, archive; never delete).
2. Counts stay keyed `metric → type → {licensed, actual}` in `card_licenses.items`, so stored data keeps its shape.
3. The card's **Add licensing** picks a metric (configured, not archived) and then a type of that metric (configured, not archived); it adds the pair to the **selected year**.
4. The Licensing report is reworked as the user described (below).
5. The card's Licensing section is reworked as the user described (below).
6. The **mass import** and the **workspace transfer** carry metrics, types-per-metric and the pairs, and keep importing the bundles and files written before this change.

## Non-goals and anti-goals

- No cross-metric totals or cross-metric charts: nothing ever adds users to installations. Where a total exists it is per metric.
- No new status maths: a status is still decided only in `services/license_status.py` (per type, no compensation between types, `over` when actual > licensed, `approaching` from 80 %, priority `over` > `approaching` > `no_actual_data` > `compliant`, no status in the Forecast year). **One deliberate change**: a card with no pair in the selected year is `no_actual_data` (today `card_status([])` and a metric-less `year_licenses` give `compliant`); the report, the card section and the tiles all follow it.
- No second per-card list of tracked pairs (the removed `licensingModel` is not replaced by another field, see Approaches).
- No new permissions; `licenses.view` / `licenses.edit` and the per-card gating are unchanged.
- No extension, no SDK change (the UI SDK and backend SDK versions stay frozen).

## What the user sees

Indicative mockups of every screen below (License types dialog, card section, report, import, workspace transfer): [`2026-11-16-licensing-metrics-design-assets/mockups.html`](2026-11-16-licensing-metrics-design-assets/mockups.html). Where it and this text differ, the text wins.

### Metamodel → Card types → **License types** (admin)
The dialog lists **metrics**; each metric lists its **types**. For both: add (key fixed at creation), edit label and translations, reorder, **archive / restore**, never delete. An archived metric or type cannot be chosen for a new cell but stays shown, named and counted wherever a year already holds data for it. A type is created inside a metric and never moves to another. Writes need `admin.metamodel`; reads are open to any signed-in user, as today.

### Card → section **Licensing**
- The year control is the existing `FiscalYearTimeTravel`. Everything below is for the selected year.
- **One horizontal bar per pair** `Metric: Type` that has a cell in the selected year, the bars stacked one under the other and **grouped by metric** (a group header per metric), so users are only compared with users and installations with installations. In each bar **Licensed and Actual overlap**: Licensed is the wide pale bar behind, Actual the narrower solid bar in front, coloured by the type's hue (`costColors`, order = `sort_order` within the metric); the consumption (`actual / licensed`, status colour) is written at the end of the bar. A pair with a cell but no values reads "no data". (The Costs section has no Licensed/Actual overlap to copy; this is a new bar, drawn with the same ECharts layer.)
- Clicking a pair opens its **history**: a chart over the years of the section window (`current-4 … current+1`, Forecast included, licensed only) for that single pair, the other pairs dimmed (the same opacity trick as the Costs section, which dims the other *years*; here it dims the other pairs). The history chart appears **below the bars** (it does not replace them), with the chosen pair highlighted and the others dimmed. Clicking the pair again, or another pair, closes or switches it.
- **Add licensing** (and the edit dialog) offers metric first, then the types of that metric; it writes the cell in the **selected year**. A pair is removed from a year by clearing its cell (existing delete), which does not touch other years.
- Status per pair and per metric as today; the section no longer has a horizontal chart per metric.

### Reports → **Licensing**
- **Card type**: Application, IT Component or both, with the same control and rules as the cost report. Metrics tiles, rows and the scope filter follow it.
- **Metric**: `All metrics` plus one entry per metric of the catalogue (archived ones only if the selected year has data for them).
- **License type**: follows the metric. Under a metric it lists that metric's types; under `All metrics` it lists every type labelled `Metric: Type`. Every label inside the report is `Metric: Type`.
- The **By license type** view is removed. What stays is the **Utilisation** view (below) and the **Table** view.
- **Utilisation view = a list with one collapsible row per card.** Left: the card-type icon (Application / IT Component), the card's image (logo), its name and its alias. Right: its status label (Compliant, Approaching, Over-licensed or No actual data). With `All metrics` the status is the worst across all the card's pairs in the selected year; with a metric or type selected it is the worst of that selection. **Expanded, a row shows what the card's Licensing section shows**: one horizontal bar per pair, Licensed and Actual overlapped, grouped by metric, with the consumption, for the selected year (no history).
- **Which cards are rows.** With `All metrics`, every card of the selected card type(s) inside the scope filter, **including a card with no pair in the selected year, which shows No actual data**. With a **metric or a license type selected**, only the cards that have at least one pair of that selection in the selected year (so "No actual data" then counts cards that have a cell without consumption, not every application). For the current year the usual `is_live_in_fiscal_year` and non-archived rules decide, as in the cost report; for any other year only cards with a stored row in that year are listed (a card that was not licensed that year is not a row). The Platform aggregate keeps its rule (direct links only, readable, non-archived) and its rows keep no status, as in the earlier spec; the tiles are not shown for a Platform.
- **Metric tiles** (Compliant, Approaching, Over-licensed, No actual data) count **rows**, one per card. **Clicking a tile** dims the other tiles and keeps only the cards with that status; clicking it again clears.
- **History appears only when a card and a pair are both chosen**: expanding a row and clicking one of its pair bars opens that pair's history (as in the card section). With nothing chosen there is no chart on the page, and the trend chart above the views is removed.
- **Table view**: one row per card (same rows as above); a column group per pair present in the scope for the selected year (licensed / actual / %), a status column, per-metric totals only; same Columns menu, XLSX and print as today.
- Left click opens the card in the side panel and right click drills, as today. Saved reports keep working: a saved metric or license-type parameter that no longer exists falls back to `All`.

### Mass import (Reports → Licensing → Import)
Same long format, `Component | Metric | License type | Year | Licensed | Actual`, validated and applied on the same bytes:
- `Metric` matches a **metric of the catalogue** by key or by label, case-insensitive. The legacy `user` / `users` / `installation` / `installations` spellings still map to the metrics whose key is `users` / `installations` when the catalogue has them.
- `License type` must be a type **of that metric** (by key or label, case-insensitive). A type that exists but belongs to another metric is skipped with a new reason `type_not_in_metric`; an unknown metric keeps the existing `invalid_metric`. Both have translation keys like the existing reason codes.
- A row writes the cell of that pair in that year (the cell is created if the pair was not there, which is how a pair gets added by import). An empty value leaves the stored value alone, and a row with **both** values empty stays skipped (`nothing_to_write`): a pair is added from the card, or by a row that carries a value. An archived metric or type cannot create a new cell but updates an existing one (it "keeps counting").
- The import never creates or edits a metric or a type, and never edits anything on the card type.
- The preview and its skipped-rows table show `Metric: Type`.

### Workspace transfer (export / import of a whole workspace)
This is a first-class part of the change, not a follow-up:
- **Export (new format).** Two config sheets, in this order: `LicenseMetrics` (columns `key`, `label`, `sort_order`, `archived`, `translations`, natural key `key`) then `LicenseTypes` (the same columns plus `metric_key`, natural key `(metric_key, key)`), both applied before the `CardLicenses` entity sheet. `CardLicenses` is unchanged (it holds no ids: `items` is keyed by metric key and type key). `licensingModel` is no longer in the exported card types. `FORMAT_VERSION` does **not** move: the importer compares it by exact equality and `schema.py` says a new sheet or column is deliberately not a bump, so an "old" bundle is recognised by its shape (no `LicenseMetrics` sheet, no `metric_key` column).
- **Import of a new-format bundle.** Metrics and types are upserted by natural key; a type whose `metric_key` is not in the bundle's metrics nor on the target is reported and skipped (its cells then fall under the existing "unknown type" handling); `CardLicenses` rows go through the same remap rules as today.
- **Import of a bundle written before this change** (no `LicenseMetrics` sheet, `LicenseTypes` without `metric_key`, card types still carrying `licensingModel`): the importer reproduces what the migration does. It creates the default metrics (`users`, `installations`) if the target lacks them; assigns each old type to the metric(s) under which the bundle's own `CardLicenses` holds data for it, duplicating the type per metric when it is used under both and attaching a type with no data to both; it **removes `licensingModel` from the card types it adopts** and never re-adds it (the restore of that field, `move_model_field` in the applier, is deleted).
- **Dedicated applier.** `LicenseMetrics` and `LicenseTypes` are not applied by the generic config applier (it fails any row with a `None` part of its natural key, and overwrites `archived` and `sort_order`): a dedicated applier upserts them, fills `metric_key` for old-format rows, and **never changes `archived` or `sort_order` of a row the target already has when the row was derived from an old bundle**; rows of a new-format bundle follow the existing config-section merge. A cell of `CardLicenses` whose metric or type exists in neither the bundle nor the target is **skipped and reported**, never imported. The old bundle's cards also lose their `attributes.licensingModel` values, as the migration does.
- **Target already has a catalogue.** Rows are matched by natural key; a target type with the same key under a different metric is a different row; labels and archive flags follow the bundle only where the existing merge rules say so for config sections.
- **A new-format bundle into an older instance** is not specially refused (the version is the same); the older instance ignores the sheets it does not know. Documented in the user manual, not enforced.
- The mandatory workspace-transfer checklist (`workspace-transfer.md`) is applied to the new table, the new column and the dropped field: `schema.py`, `sections.py`, the id-bearing-columns guard (`metric_key` is a key, not an id), the unit tests of the sheets, and the user docs of workspace transfer.

## Data model

- **New table `license_metrics`** with the shape of the other catalogues (`id`, `key` unique, `label`, `sort_order`, `archived`, `translations`, timestamps with `server_default=now()`); created and seeded (`users`, `installations`) by the migration. Served and written through `services/item_catalogue.py` like cost item types and license types.
- **The catalogue service and routes are scoped by metric.** `item_catalogue` (keyed by `key` alone today) gets a metric parameter for types; types are written through `POST /metamodel/license-metrics/{metric_key}/types` and `PATCH /metamodel/license-metrics/{metric_key}/types/{key}`; metrics through `POST /metamodel/license-metrics` and `PATCH /metamodel/license-metrics/{key}`; the read stays open to signed-in users.
- **`license_types` gains `metric_key`** (String(64), not null) and its uniqueness moves from `key` to `(metric_key, key)`; `metric_key` is immutable. Keys keep the existing slug rule.
- **`card_licenses.items` is unchanged**: `{metric_key: {type_key: {licensed, actual}}}`. The pairs of a year are the cells of that year's row. A pair added without values is the cell `{licensed: 0, actual: null}` (the form `merge_cell` already builds); a Forecast cell still refuses an `actual`.
- **Removed**: the `METRICS` / `LICENSE_METRICS` constants (backend and `lib/licenses.ts`) become catalogue lookups (`LICENSE_TYPES`, the set of card types that hold licenses, stays); the `licensingModel` field, its protected `Licensing` section, the 400 `license_field_required` guard in the metamodel route, its restore in the workspace importer, and its place in `seed.py`. `licensing_migration.move_model_field` and `LICENSING_MODEL_FIELD` stay in place, frozen, because migrations 178 and 179 import them; only their other callers go.
- Year resolution is unchanged: the current year with no row carries the latest earlier row's cells with `licensed` only, `confirmed=false`; the pairs shown follow the carried cells.

## Migration (new, after 191)

One Alembic migration, guarded and idempotent:
1. Create `license_metrics`; insert `users` and `installations`.
2. Add `license_types.metric_key`; for each existing type, look at `card_licenses.items` across all cards and years: a type with data under one metric belongs to that metric, a type with data under both is **duplicated** (one row per metric, same key, same label and translations, same `archived`), a type with no data is created under **both** metrics (the admin archives what they do not need). Then drop the old unique constraint and add `(metric_key, key)`.
3. Strip `licensingModel` and the `Licensing` section from both card types' `fields_schema`, clear the stored `cards.attributes.licensingModel` values without moving `cards.updated_at` (`derived_maintenance`), list the calculations that cite the field (`citing_calculations`) in the report, and bump the data-quality rescore marker as migration 179 did. Data of a metric that a card did not track (stored but ignored until now) **is kept** and now shows, because the pair exists in its year.
4. Write a report like `licensing_migration_report` (types duplicated, types attached to both metrics, cards whose previously ignored metric data now shows), capped at 200 lines.
5. The migration is forward-only in practice: the downgrade drops the column and the table only when no type is duplicated, and refuses otherwise (almost every instance will have a duplicated type, which is accepted).

## Approaches considered

- **Where the pairs of a card live.** (A) **Derived from each year's cells** — chosen by the user: one source, no field to keep in step, the year decides what shows; the cost is that a pair with no cell does not exist, and removing a pair from a year clears that year's cell only. (B) An explicit per-card list (field or table): keeps a pair visible without data, but is a second source for the card section, the import and the workspace transfer. Rejected.
- **Where the catalogue lives.** (A) **Tables** (`license_metrics`, `license_types.metric_key`) — chosen, as today's types are a table, as for costs, and as the workspace transfer already treats them. (B) One JSON setting holding metrics and types: simpler to read, but it would not match any other catalogue, would need its own transfer and key-uniqueness code, and would lose the shared `item_catalogue` service.
- **Type identity.** (A) **`(metric_key, key)`** — chosen: `items` keeps its shape and a "Prod" can exist under two metrics. (B) A single global key such as `installations.prod`: would rewrite every stored key and import column for no gain.

## Fresh installs

A fresh database is created by `create_all` and stamped at head, so no migration runs. `seed.py` therefore seeds the two default metrics (`users`, `installations`), insert-only, and no types (the type catalogue is empty on a fresh install, as today). The demo seed adds types and data behind its `seed_markers` entry.

## Agent's calls (decided by the builder check, correct any)

- Which cards are rows, history years, FORMAT_VERSION, migrations 178/179 helpers, the `licensingModel` values, the catalogue routes and the downgrade: decided in the sections above.
- A new cell is written as `{licensed: 0, actual: null}` (the form `merge_cell` already builds); the status is `no_actual_data` either way.
- Removing `test_license_model_guard_api.py`, `test_alembic_179_licensing_section.py` and the `licensingModel` cases removes guard tests: the `Guard Ratchet` check fails until the maintainer applies `guard-change-approved` (an agent never does). The plan carries this up front.
- The report keeps two views, Utilisation (the list) and Table.
- The user's answers in the second round: a card with no pair in the year is a row ("No actual data") under `All metrics`, and leaves the list when a metric or type is selected.

## Constraints

- No raw SQL; services never commit; writes lock the year row (`yearly_rows.py`); every route applies `CardReadScope` and the cost-style gating; events carry keys only (`card.licenses_updated` now carries `metric:type`, never counts) and every feed goes through `redact_cost_events`.
- User-facing English text says "license"; strings use translation keys (English only in the implementation session, `/translate` before the PR); an admin metric or type label is an entity label resolved with the metamodel resolvers, never the key as fallback.
- A new or changed route means a regenerated `docs/api/openapi.json`; migration numbering is sequential after 191; `/VERSION` minor bump and a `CHANGELOG.md` entry that says what the migration does.
- The shared year control, `ReportShell`, `CardScopeFilter`, `EChart`, `costColors` and `CardDetailSidePanel` are reused, not rebuilt; the dim-others behaviour is the Costs one.

## Left to the builder

Exact payload shapes of the new and changed endpoints; the metric/type admin dialog layout; the colour assignment of pairs inside a metric; the migration's SQL and its test fixtures; how `merge_cell` expresses an empty cell; the wording and translation keys of the new reason codes; the demo seed (`seed_demo_licensing.py`) rewritten for metrics and types; user manual pages (card details, reports, admin metamodel, workspace transfer) and the screenshots `103_report_licensing` / `104_card_licensing`, which must be retaken on the new screens (the current ones have an overlapping top bar at 1280 px).

## Files this touches (from the code, for the plan)

Backend: `models/license_type.py`, new `models/license_metric.py`, `services/{card_licenses,license_status,license_report,license_import,license_types,licensing_migration,item_catalogue,seed,seed_demo_licensing,rollback_service,audit_labels}.py`, `api/v1/{card_licenses,license_types,reports,saved_reports,metamodel,cards}.py`, `schemas/licenses.py`, `services/workspace_io/{schema,sections,applier,exporter,bundle}.py`, one new Alembic migration. Frontend: `features/cards/sections/{LicensingSection,LicenseItemDialog,licensingBarOption}`, `features/reports/{LicensingReport,LicensingTable,LicensingImportDialog,licensingUtilisationOption}` (and the removal of `licensingByTypeOption.ts`), `features/admin/metamodel/*` (the license types dialog), `features/cards/{sectionConfig,CardDetailContent,dataQualityJump}.ts(x)`, `lib/licenses.ts`, `types/index.ts`. Docs and `.claude/rules/licensing-items.md` (updated after the reviews, with the user's yes).
