# Project Master List financials implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the plan task by task. Follow the repository's designated agent ownership. Track completion with the checkboxes.

**Goal** — Ship Project Master List with nested budget, cost and invoice tracking rows, configurable financial fields, an Initiative invoiced total, and shared planned and actual timelines.

**Architecture** — Extend the existing initiative financial records with explicit same-initiative links. Read authoritative invoice totals and field values from a private financial-tree service shared by the PML tab, project print and Initiative card. Keep the Initiative metamodel as the source of schedule dates and expose actual dates separately through the authenticated Portfolio.

**Tech stack** — FastAPI, Pydantic, SQLAlchemy ORM, PostgreSQL, Alembic, React, TypeScript, MUI, i18next, pytest, Vitest and Playwright.

**Spec** — [Project Master List financials](../specs/2026-11-23-pml-budget-costs-invoicing-design.md)

**Status** — Implementation plan for the approved specification.

## Global constraints

- Use Project Master List and PML on the user surface. Preserve `/ppm` routes, permission keys, internal module identifiers and existing public Portfolio response shape.
- Use the primary checkout at `C:/Users/tommaso.chiarella/chatgpt-work/software/turbo-ea` for implementation on `feat/pml-financials`, based on updated `origin/main`. Compare API and migration head on that base before assigning migration filenames. Use the next available Alembic revision.
- The finance tree is Budget → Cost Item → Invoice entry inside one Initiative. Older Cost Items may have no budget. New creates require a budget reference. Actual Invoiced records the date, document ID and net amount of an existing invoice. The invoice amount accepts zero and rejects negative values. Budget and Cost Item input constraints stay as they are. Preserve the recorded decimals when calculating totals and showing amounts. Invoice issuance, tax calculation, credit notes and payment workflows are outside the first release.
- Budget hierarchy subtotals use the budget fiscal year and category. Existing Actual cost charts use the Cost Item's own category and existing date semantics. Actual Invoiced is separate from existing additive Cost Report inputs.
- Enforce CardReadScope and existing permissions on every applicable entry point. Invoice data and its visible derivatives require `ppm.view` and per-Initiative cost visibility; mutations also require `ppm.manage`. Authenticate before checking invoice-dependent guards.
- Read the scoped project rules before implementing the associated paths, especially `ppm.md`, `frontend-patterns.md`, `settings-and-seed.md`, `workspace-transfer.md`, `public-access.md`, `db-sessions-events-audit.md`, `api-contracts.md`, `testing-ci.md` and `i18n-locales.md`. Use the project workflows for tests, locale parity, manuals, VAPT and review. Run backend Ruff format and lint before each authorized commit. Mutation testing runs in CI.

## Confirmed scope

Provider applies to Planned Budget and Cost Items. Invoice entries carry their Cost Item link, date, document ID, net amount and configured row-local fields. Provider assignment, reconfiguration and invoice reassignment follow their own rules. Existing public Initiative card portals retain their field visibility when a date is mapped. The anonymous Portfolio shows only Plan.

Workspace transfer follows the existing delegation in `backend/app/api/v1/workspace.py`. The dedicated export and import grants authorize complete backup and restore, including invoice entries. Interactive PML uses its per-Initiative cost controls.

## Execution order and merge boundaries

### Before starting implementation

- [ ] From the primary checkout, inspect the current branch and local changes. Preserve existing files and changes, fetch the fork's `main` and create `feat/pml-financials` in that same checkout from the updated ref. Copy the approved spec, this plan and the mockup together from the planning checkout and verify all three before starting Task 1.
- [ ] Record the base SHA, `VERSION`, Alembic head and disposable database revision. Run `alembic heads` from `backend/` with the primary checkout's backend environment active. If there is more than one head, resolve the base dependency before allocating new revisions.
- [ ] Run `bash scripts/test.sh --serial tests/api/test_ppm.py tests/api/test_ppm_reports.py tests/api/test_cards_bulk_create.py tests/services/test_workspace_io_roundtrip.py` from the primary checkout. From `frontend/`, run `npm run test:run -- src/features/ppm/PpmCostTab.test.tsx src/features/ppm/PpmPortfolioView.test.tsx src/components/licensing/PairBars.test.tsx src/components/licensing/pairBarsOption.test.ts`. Save counts and failures by suite before changing code. Check the OpenAPI contract for existing budget and cost writes and search their callers in the UI, demo seed and integration entry points.

| Checkpoint | Tasks and prerequisite | Evidence to carry forward |
|---|---|---|
| Finance data and operator workflow | Tasks 1 → 2 → 3 → 6 | The migration keeps old rows readable. A budget can gain a cost and tracking entries through the normal UI. Provider, totals, print and legacy assignment agree. |
| Schedule and settings | Task 4 follows Task 3. Task 7 follows Tasks 4 and 6. Task 8 follows Tasks 4 and 7. | The Aruba mapping works without adding fields. The same authorized dates appear on the card, Portfolio, Overview and print. |
| Workspace transfer | Task 5 follows Tasks 1–4. | A new workspace can restore the records and their settings. Partial imports into a populated workspace keep existing invoice associations when a candidate conflicts. |
| Release verification | Task 9 follows Tasks 5–8. | A browser test exercises the integrated workflow. API, manual, locales and review evidence describe the same source revision. |

Work on one feature branch. Tasks 1–4 own the shared settings, API schemas and migration chain in sequence. Once Task 4 is integrated, Task 5 can proceed alongside frontend work. Within the frontend, integrate Tasks 6 → 7 → 8 in order because the tasks share locale keys, types and print components. Keep the cost creation contract in Task 1 and the new call site in Task 6 in the same deployable revision. Apply the remaining tasks before opening the single feature PR.

Every task's handoff includes changed paths, the contract produced, the pre-change failure, the post-change passing count and any compatibility finding. The owning session runs the red test after the test edit and before the production edit. For the backend, use paths relative to `backend/` with `bash scripts/test.sh --serial` from the repository root and confirm at least one test was collected. For the frontend, run Vitest from `frontend/`. Review each task with a fresh agent before starting its dependents.

### Design references for frontend work

Use the [interactive PML mockup](../specs/2026-11-23-pml-budget-costs-invoicing-design-assets/mockups.html) for Tasks 6–8. The specification defines behavior. The mockup illustrates placement, labels and states.

| Task | Design reference | States to illustrate |
|---|---|---|
| 6 | [Initiative workspace](../specs/2026-11-23-pml-budget-costs-invoicing-design.md#initiative-workspace) and [worked example](../specs/2026-11-23-pml-budget-costs-invoicing-design.md#worked-example) | Expanded budget → cost item → invoice entries, create with parent context, legacy group, restricted view, expanded print. |
| 7 | [Administration](../specs/2026-11-23-pml-budget-costs-invoicing-design.md#administration) and [Aruba configuration](../specs/2026-11-23-pml-budget-costs-invoicing-design.md#aruba-configuration-example) | Field configuration per row type, ordered calculated rule preview, actual date mapping with existing Aruba fields. |
| 8 | [Card layout](../specs/2026-11-23-pml-budget-costs-invoicing-design.md#cost-timeline-on-the-initiative-card) and [Plan / Actual](../specs/2026-11-23-pml-budget-costs-invoicing-design.md#planned-and-actual-dates-in-the-initiative-plan) | Cost and Timeline groups, Portfolio tracks, one date marker, mobile row with exact dates. |

| Area | Owning files |
|---|---|
| Financial records and endpoints | `backend/app/models/ppm_cost_line.py`, new `ppm_invoice.py`, `backend/app/schemas/ppm.py`, `backend/app/api/v1/ppm.py`, new `backend/app/services/ppm_financials.py` |
| Financial definitions and evaluation | New `backend/app/schemas/ppm_fields.py`, `backend/app/services/ppm_fields.py`, existing `backend/app/api/v1/settings.py` |
| Provider consistency | New `backend/app/services/ppm_providers.py`, financial service and endpoints, existing relation writer |
| Actual schedule sources | New `backend/app/services/ppm_timeline.py`, settings and metamodel routes, card write entry points, `ppm_portfolio_service.py`, `schemas/ppm.py`, existing public projection |
| Workspace transfer | `backend/app/services/workspace_io/{sections,applier,exporter,remap,schema}.py` plus shared financial, settings and Timeline validators |
| PML operator and print | `PpmCostTab.tsx`, `PpmCostTables.tsx`, `PpmProjectDetail.tsx`, `PpmProjectReport.tsx`, new `PpmFinanceTree.tsx`, `PpmFinancialRowForm.tsx`, `usePpmFinancials.ts`, `frontend/src/types/index.ts` |
| Card and Portfolio schedule | `CardDetailContent.tsx`, `sectionConfig.ts`, `PpmPortfolioView.tsx`, `ppmPortfolioModel.ts`, `PpmOverviewTab.tsx`, new `PpmInitiativeTimeline.tsx` and `PpmInitiativeFinancials.tsx` |
| Admin panels and wording | `SettingsAdmin.tsx`, new `PmlFieldSettings.tsx`, `PmlTimelineSettings.tsx`, existing PPM, admin, nav and cards namespaces and manual pages |

## Review focus

| Scenario | Owning regression |
|---|---|
| Provider changes on a cost that has invoices, including a selected budget-only import | Tasks 3 and 5 check the hierarchy, the relation write and preservation of the invoice rows and links. |
| Aruba's exact-case date key or a customized subtype hides Actual End | Tasks 4, 7 and 8 pin preserved values, privacy and placement in every read surface. |
| An unassigned legacy Cost Item already has invoices | Tasks 1, 3, 5 and 6 pin totals, explicit assignment and transfer. |
| A PML editor lacks invoice visibility and attempts a guarded move or deletion | Tasks 1, 3 and 6 pin access before invoice lookup and absence of invoice indicators. |
| A CapEx budget groups an OpEx cost with a fractional invoice | Tasks 1 and 6 pin grouping, exact decimal totals and preservation of existing cost charts. |

## Task 1 — Financial records, commands and authoritative totals

**Owner:** backend-dev.

**Files:** Modify `backend/app/models/ppm_cost_line.py`, `backend/app/models/__init__.py`, `backend/app/schemas/ppm.py` and `backend/app/api/v1/ppm.py`. Create `backend/app/models/ppm_invoice.py`, `backend/app/services/ppm_financials.py`, the next migration `*_pml_financial_rows.py` and `backend/tests/api/test_ppm_financials.py`. Adjust existing route/seed fixtures that create Cost Items. Cover existing reports, editable history and custom Card attributes in the regression suite.

**Existing creators:** Keep the budget-first insert in `backend/app/services/seed_demo_ppm.py` and link each demo cost to an explicit budget fixture from the same Initiative. Update the create requests in `backend/tests/api/test_ppm.py` to supply valid parent IDs, except for cases testing denial and missing parents. Keep deliberately unassigned test data in `backend/tests/conftest.py` and the migration fixtures. Update the web writer in Task 6. Review callers of the published API before releasing the required request field.

**Interfaces:** `PpmCostLineCreate.budget_line_id: UUID`, `PpmCostLineUpdate.budget_line_id: UUID | None` (omitted means retain; null is rejected for an already assigned row), `PpmCostLineOut.budget_line_id: UUID | None`. Add `PpmInvoiceCreate(cost_item_id, invoice_date, invoice_id, amount)`, explicit patch counterparts and `PpmInvoiceOut`. The invoice record holds the decimal amount. Keep Invoice ID textual and use an internal UUID for links.

**Storage and delete rules**

| Entity | Persistence contract |
|---|---|
| `PpmBudgetLine` | Existing amounts and categories. A unique target key on `(initiative_id, id)` supports same-Initiative parent references. |
| `PpmCostLine` | Add nullable `budget_line_id` for legacy rows, with a composite FK to Budget and an index on `(initiative_id, budget_line_id)`. Creation requires a parent. Once assigned a cost can move to another valid budget, while a null update is allowed for a row that was already unassigned. |
| `PpmInvoice` | UUID row ID, owning Initiative, required Cost Item, `invoice_date` as Date, trimmed nonempty textual `invoice_id`, finite nonnegative `amount` as Numeric. Use a composite FK to Cost Item and index `(initiative_id, cost_item_id)`. Document IDs can repeat. |

Keep card-level cascade ownership for all three tables. Add a database constraint that rejects a direct budget or cost deletion with a dependent row and permits the full card cascade. Test the actual migration and ORM delete path in PostgreSQL. The API checks dependencies first and returns a 409 without modifying rows.

Private API under `/ppm`:

| Route | Contract |
|---|---|
| `GET /initiatives/{id}/financials` | `PpmFinancialsOut` with `initiative_id`, `budget_lines`, `budget_subtotals`, `budget_totals`, `cost_items` and `invoice_access`. Emit `invoices`, `actual_invoiced` and `card_comparison` only with invoice read access. Budget totals and fiscal year/category subtotals include the recorded budget amount and `total_cost_items`. Authorized readers also receive `total_invoiced` and `remaining_to_invoice` on those objects and the individual budget and cost rows. `budget_totals` counts linked costs once, while `actual_invoiced` also counts invoices on legacy unassigned costs. Return new invoice and aggregate amounts as decimal strings. |
| `POST /initiatives/{id}/invoices` | Body `{cost_item_id, invoice_date, invoice_id, amount}`. Return `PpmInvoiceOut` with its row `id`, owning `initiative_id` and those four fields. `amount` is serialized as decimal text. |
| `PATCH /invoices/{id}`, `DELETE /invoices/{id}` | PATCH accepts a subset of the create body and returns `PpmInvoiceOut`. Omitted fields keep their values, required fields reject null, and a new `cost_item_id` can move the row within the Initiative. DELETE returns 204. Task 2 extends both write models with configured row-local `field_values`. |
| Existing budget and cost endpoints | Continue as the authoring routes. Budget assignment is explicit in the request. |

Use `CardReadScope(mode="module")` for the Initiative and resolve child IDs within its scope. Return 404 for a missing or hidden Initiative or a parent ID that does not belong to it. Return 422 for invalid input such as a missing parent key or a negative amount. Invoice reads need `ppm.view` and per-card `can_view_costs`. Invoice edits add `ppm.manage`. When invoice access is denied, omit the invoice amounts, presence indicators and comparison fields entirely. Reject unexpected invoice write keys. Gate individual Cost Item deletion before consulting its invoice rows and give the same 403 for either dependency state. Ordinary cost edits and moves retain their established write permissions.

For PATCH and DELETE by invoice ID, check the required module permissions before querying. Resolve the invoice through the caller's readable Initiative and cost scope and return the same 404 for a stale ID and an invoice outside that scope. In contrast, a readable Initiative with denied cost visibility still returns its permitted budget and cost fields from GET financials.

Services expose `load_financials(db, initiative_id, user) -> PpmFinancialsOut`. Shape `card_comparison` as independently derived `budget` and `actual` objects with `total`, `capex`, `opex` and `derived`. Use existing PPM aggregation and `PermissionService.card_ids_with_cost_access` over readable descendants. Keep the ordinary PPM rollup separate. Aggregate exact amounts by Cost Item once, then roll up to budget line and fiscal year/category. Compute the Initiative total over its own invoice entries including legacy unassigned costs.

**Transaction ownership.** The PPM route commits after its service finishes. Move the financial-row commit past the `_sync_initiative_costs` work in `backend/app/api/v1/ppm.py`. The helper flushes and prepares card changes and events without committing. Reuse the existing child-to-parent recalculation order, idempotent events and managed-field exclusions. Invoice changes update their own rows under the same Initiative lock and derive their totals on read. They leave the existing card rollup fields and events driven by budget and recorded cost changes.

Match the lock order in `card_write_service.py`. For Tasks 2–3, identify and orient every automatic relation candidate and acquire the existing relation advisory locks first. Then acquire one UUID-ordered set of card locks for the Initiative, affected ancestors and relation endpoints. Take relation and financial row locks after the card locks. Validate the current parents, relation endpoints and Provider choices again while holding those locks. If a concurrent change means an additional earlier lock would be required, roll back that attempt and return a retryable conflict. A pure invoice or budget write with no relation candidates starts with the card lock set. Use the same order for corresponding PML writes made by the workspace applier.

Use `event_bus.publish(..., deferred_messages=...)` for the touched rollup and relation write paths, following `backend/app/api/v1/card_costs.py`. Persist history within the database transaction and publish buffered messages only after commit succeeds. Forward the buffer through the automatic relation writer in Task 2. Add a commit-failure regression that observes both the rolled-back database state and an empty subscriber queue. Preview and failed writes discard buffered messages.

Keep the existing budget and cost model inputs and response fields. Convert each existing recorded amount to a decimal through its string representation before summing or combining it with invoice amounts. Persist invoice amounts as PostgreSQL `Numeric` and sum exact decimals across parent and subtotal boundaries. Assert that two Cost Items with amounts 0.10 and 0.20 produce a linked-cost total of 0.30. Moving the 2,500 entry from Renewal to Support in the worked example leaves Support's remaining amount at −500 and the budget's invoiced total at 6,500.

- [ ] Write tests `test_linked_financials_and_legacy_costs`, `test_move_and_delete_update_both_summaries`, `test_invoice_access_does_not_leak_amount_or_presence`, `test_invoice_amount_and_residual`, `test_budget_capex_and_cost_opex_keep_their_aggregation_axes` and `test_card_comparison_filters_descendant_costs`. Assert 12,000 planned / 10,000 cost / 6,500 invoiced / 3,500 remaining. Add a 300 invoice on an unassigned legacy cost and assert 6,800 on the Initiative. Assert 100.13 less 30.11 is 70.02 with no premature rounding and negative invoice input fails. Include denied and hidden Initiative reads, cross-Initiative links, zero, deleting the last invoice, dependency rejection and a visible descendant with denied costs contributing zero to the embedded comparison.
- [ ] Write `test_invoiced_projection_stays_out_of_existing_costs_and_card_writes`. A budget of 100 and actual cost of 80 still reports 180 after an invoice of 60. The private projection shows 60. Invoice totals are absent from generic cost-field selectors and editable history. An existing custom Initiative attribute named `pmlActualInvoiced` remains editable and changing it does not change the projection. In `test_financial_parent_deletion_and_split_document`, assert that a single Invoice ID can appear on two allocated invoice rows, a refused parent deletion preserves all references, and deleting the whole Initiative through its usual lifecycle disposes of all three levels in one successful operation.
- [ ] Add `test_financial_write_rolls_back_if_rollup_fails` and `test_invoice_create_and_parent_delete_serialize`. In the first, a failure before commit leaves budget/cost rows, attributes and history unchanged. For concurrency tests, use two connections to `test_engine` with committed fixtures and deterministic synchronization. The default `db` fixture wraps a savepoint and is invisible to the second connection. When invoice creation wins, direct Cost Item deletion returns a dependency conflict. When deletion wins, the invoice write rejects the absent parent. Check the committed state in a fresh session.
- [ ] Run from the root: `bash scripts/test.sh --serial tests/api/test_ppm_financials.py`. Capture the missing-route/field failures.
- [ ] Add the models and migration. Store legacy blank budget references with no backfill. Use scoped FK checks, index parent keys and keep the existing whole-Initiative deletion behavior. Restrict direct parent deletion through the financial service with a database constraint that also permits a full Initiative cascade. Store the entered invoice amounts as exact decimals.
- [ ] Update the existing demo and API creators. For the seed fixture, check that the new link leaves its recorded cost amounts and fiscal/category aggregates intact. Cover a fresh demo setup with linked rows and an upgraded workspace with historical unassigned rows. In the financial regression, assert that an invoice on a legacy cost changes `actual_invoiced` without increasing `budget_totals.total_invoiced`.
- [ ] Add the typed routes, access-filtered DTOs, grouped sums, and serialized mutations. Access to invoice-dependent Cost Item deletion is checked before looking up invoice rows. Use decimal values for the calculations and preserve recorded legacy amounts. Keep existing `costBudget` and `costActual` event/recalculation rules for cost and budget writes. Deliver Actual Invoiced as a live read-only projection outside `Card.attributes`. Give the new presentation its own typed response field and leave existing custom attributes, generic financial reports and cost history operating on their own inputs.
- [ ] Re-run the targeted command plus `bash scripts/test.sh --serial tests/api/test_ppm.py tests/api/test_ppm_ancestor_rollup.py tests/api/test_ppm_recalculation.py`. Require green tests. Verify upgrade and downgrade on disposable PostgreSQL with a pre-change Cost Item; document any invoice-data downgrade limitation in the migration notes.

## Task 2 — Field configuration, value validation and calculations

**Owner:** backend-dev.

**Files:** Create `backend/app/schemas/ppm_fields.py`, `backend/app/services/ppm_fields.py`, `backend/tests/services/test_ppm_fields.py`, `backend/tests/api/test_ppm_field_settings.py`. Modify settings, financial service/schemas and financial models with the next migration for JSONB value maps. Use the minimum focused surface of the existing calculation helpers.

**Interfaces:** `PmlRowKind = Literal["budget", "cost_item", "invoice"]`. `PmlSectionConfig` holds fields and ordered visible columns. `PmlFieldDefinition` includes stable `key`, label, help, kind, required, default, active, options, optional card type, optional relation type and calculation. `PmlCalculation` defines result type, typed row references, expression or ordered rules and fallback. `PmlRowValues` is a key/value map. `validate_field_values(config, submitted, existing, *, creating)` preserves omitted values. `evaluate_row_fields(config, values, context)` returns typed results with per-field errors. Card references use scope-filtered identities and projections.

Admin-only routes: `GET /settings/pml/financial-fields`, `PUT /settings/pml/financial-fields/{section}`, `POST /settings/pml/financial-fields/{section}/preview`. Store each section under its own `pml.financial_fields.<section>` settings key. Issue key-scoped JSONB updates so concurrent saves of different PML sections preserve both edits. Administrators can reference only readable cards in rules and previews. Existing unreadable references are represented without identity and survive an unrelated edit. The private financial response exposes section display definitions and calculated values, with redacted references and without expression text. Store editable values separately from system totals and computed results.

**Settings JSON contract:** The GET returns configurations keyed by row kind. The PUT takes and returns one `PmlSectionConfig` with `fields`, ordered `visible_columns` (including stable keys for the fixed summary columns) and, on Cost Items, optional `provider_source`. For Aruba, Planned Budget has a card-reference field with key `origine_costi`, while Cost Items set `"provider_source": {"budget_field_key": "origine_costi", "allow_child_selection": true}`. Formula inputs reference row fields by their stable keys and use `provider.effective` and `provider.budget` for the resolved Provider IDs. Return display labels only after permission checks. Scope both reserved Provider inputs to Cost Item calculations. For the invoice section, exclude the Provider card type from the editor choices and from references, defaults, formula card constants and automatic relation targets in the common validation used by settings PUT, preview and workspace import. Keep compatible references to other card types.

Use the same two calculation fixtures in the API, evaluator and Task 7 form tests. `inputs` maps expression or predicate aliases to standard fields, active custom/calculated keys or the reserved Cost Item Provider sources. Resolve each source's type from the section and date/amount schemas. Express formulas as a string with those aliases and allowlisted syntax. Rule values are typed literals. Predicates use `{op, input, value}` for comparisons, `{op:"all"|"any", conditions:[...]}` for boolean groups and `{op:"not", condition:...}` for inversion.

```json
{"result_type":"number","inputs":{"d":"invoice_date"},"expression":"YEAR(d)"}
```

```json
{
  "result_type":"text",
  "inputs":{"kind":"tipo_spesa","provider":"provider.effective","budget":"provider.budget"},
  "rules":[
    {"when":{"op":"eq","input":"kind","value":"licenze"},"then":"Licenze"},
    {"when":{"op":"any","conditions":[
      {"op":"eq","input":"provider","value":"11111111-1111-4111-8111-111111111111"},
      {"op":"all","conditions":[
        {"op":"eq","input":"provider","value":"22222222-2222-4222-8222-222222222222"},
        {"op":"eq","input":"budget","value":"11111111-1111-4111-8111-111111111111"}
      ]}
    ]},"then":"Servizi interni"}
  ],
  "fallback":null
}
```

Preview takes `{configuration, field_key, sample_values}`, keyed by source names such as `invoice_date` or `provider.effective`. It returns `{value, errors}` where values use the section's output encoding and errors are keyed by the offending field or input. Assert that a sample date of `"2026-11-10"` yields year `"2026"`, that `{"tipo_spesa":"licenze"}` yields `"Licenze"`, and that the two readable Provider samples in the second fixture yield `"Servizi interni"`. Inspect missing input and type errors and validate that a redacted reference cannot be used for a preview comparison.

**Write semantics**

- Persist editable `field_values` as JSONB on each row. Use strings for dates and UUIDs, stable option IDs for select values, decimal text for numbers and JSON booleans for yes/no. Keep calculated output in `calculated_values` on read responses. Legacy rows start with empty maps.
- On create, fill absent editable, active fields from their configured defaults. On PATCH, absent keys retain stored values. Explicit null clears an optional field. A historical row missing an active required field remains readable and fails its next save until the field is supplied. A stored unreadable value still satisfies the requirement and survives an unrelated edit. Deactivated fields also retain their stored values. Test both the rejected blank historical row and the successful edit with a stored unreadable reference.
- Preserve unreadable references in settings updates by round-tripping the protected definition by its stable key. Return its display metadata and a `protected` flag to the editor with reference-bearing details omitted. The PUT can retain it by `{key, keep_existing: true}`. Accept that replacement marker only for an existing protected definition in the same section. The server keeps the stored definition and checks dependent rules against it. Include a test for deactivation or removal attempts through a forged settings request for a protected definition.
- Build a dependency order from declared typed inputs. Evaluate first-match rules and expressions in that order using the same allowlist on save, preview and read. Propagate an unavailable card reference through the whole dependency chain and omit affected calculated values. A blank source and a source hidden by permission must remain distinct during evaluation so fallback values cannot disclose a protected comparison.

Expose `apply_configured_card_relations(db, actor, initiative, config, old_values, new_values) -> None` for changed references on all three row types. A configured relation type must connect the selected card type and Initiative; use its validated orientation and the existing idempotent relation writer. An unset relation type only stores the card reference. A newly selected Provider child in Task 3 uses the parent's configured relation type. `supports` is the Aruba setup example.

Use the relation writer's create-only behavior for an existing oriented pair. Require `relations.manage` when creating a missing link. Keep existing attributes and description and retain links when financial field values are later removed. Keep configured relations and financial row changes inside the transaction from Task 1. Add a two-session test between an ordinary relation edit and a PML reference edit on the same pair. Require both to finish with one relation and preserved relation data.

- [ ] Write tests for independent sections, stable option IDs on rename, inactive option preservation, safe deactivation, conflicting populated type changes, required/default behavior, input omission, type errors and dependency cycles. Cover date extraction and a field with ordered Licenze/Servizi rules that yields different results for two Cost Items. Assert a hidden Provider removes direct and transitive results from the financial projection and the existing budget/cost GETs. Test an admin with card scope restrictions across settings GET, PUT and preview: no hidden ID in the response, no new hidden constant in a rule, and existing protected references remain after an unrelated save. Include settings permission denial and a save/preview output match. Assert the invoice field editor and matching API validation allow an Organization reference and reject a Provider reference in a field, default or rule. Cover the same restriction in Task 5 import. Test an Organization card reference with a compatible test-defined relation, the same reference with no relation configured, and denial rolling back the financial row.
- [ ] Run `bash scripts/test.sh --serial tests/services/test_ppm_fields.py tests/api/test_ppm_field_settings.py`; verify failing tests for the expected missing behavior.
- [ ] Implement key-scoped settings storage, typed row field validation, bounded formula evaluation and dependency checks. Reject authored system totals, calculated values and unknown keys. Require an active dependent's source to remain compatible. Provide the Task 3 hook for resolving the budget Provider/child as adjacent read-only inputs. Apply configured card relations transactionally on changed reference fields. Keep raw formula text and IDs out of viewer definitions.
- [ ] Re-run the two test files and `tests/api/test_ppm_financials.py` through the same runner. Verify the configuration response, row-write inputs and redaction in API contract examples.

## Task 3 — Budget Provider and Cost Item child selection

**Owner** — backend-dev.

**Files** — Create `backend/app/services/ppm_providers.py`, `backend/tests/services/test_ppm_providers.py` and `backend/tests/api/test_ppm_cost_providers.py`. Extend Tasks 1 and 2 with the nullable Cost Item child reference and its migration. Store the budget Provider in the configured budget value. Reuse `card_write_service.upsert_relation`.

**Interfaces** — `load_provider_choices(db, user, initiative_id, budget_line_id, *, search, page, page_size) -> PmlProviderChoicePage` and `resolve_effective_provider(budget, cost, active_config) -> ProviderIdentity | None`. Resolve an explicit child first, or read the configured budget value when the cost inherits. Preserve explicit unavailable budget or child references by ID. The cost response returns a scope-filtered Provider and whether the child picker is available. Invoice contracts use the Cost Item ID.

Use `GET /ppm/initiatives/{id}/budgets/{budget_id}/provider-children?search=&page=&page_size=` for eligible direct children. Return `{items, total}` with `id`, `name`, `type`, `parent_id` and `alias` for `CardPicker.searchSource`. Check the budget Provider's read scope before lookup or count and filter children before paging. A Cost Item write with `provider_child_id` selects an eligible child, explicit null inherits the budget default, and an omitted PATCH key preserves the explicit selection. A move validates the resulting selection against the destination budget. If an edit to the budget invalidates explicit children, reject with the affected costs and allow the editor to reset their selections before retrying. Handle the budget edit and any relation creation in one transaction.

Store the explicit child as a card UUID that retains its historical value on Provider deletion. Keep the reference unavailable when the card is unreadable or deleted. Archive removes the Provider from new choices and preserves a readable historical selection. Allow a description-only PATCH to keep a previously selected unavailable or reparented child. For a budget/Provider change, return a 409 with the affected Cost Item IDs after Initiative and cost scopes are checked if a submitted selection would no longer be eligible. Reject a newly selected hidden, missing or foreign-budget child without disclosing its metadata.

Require the Provider card type's hierarchy to be enabled for new child choices. With hierarchy disabled, the child picker is unavailable, the choices endpoint returns an empty list and a new explicit child assignment is rejected. Test that a previously selected readable child is still displayed and an unrelated edit preserves it.

- [ ] Write API and service tests for selecting a direct child, clearing it, preserving it on an unrelated edit, adopting a configured budget default, changing a Provider with an invoice present, moving a cost to a budget with a different Provider, and rejecting an ineligible selected child. Include a restricted PML editor who can make a permitted Provider change with or without invoices. Cover hidden budget parent before child lookup/count, wrong parent, archived child, deletion of a referenced Provider and a historical selection after reparenting. Assert each relation is reused and relation denial rolls back the edit.
- [ ] Add an API regression in `test_ppm_financials.py` for moving an invoice between costs using different Providers. Assert updated totals for both costs, stable Initiative total, unchanged document ID/date/amount and no Provider value in the invoice payload. Also assert a cross-Initiative move is rejected.
- [ ] Run `bash scripts/test.sh --serial tests/services/test_ppm_providers.py tests/api/test_ppm_cost_providers.py tests/api/test_ppm_financials.py` and capture expected failures.
- [ ] Implement Provider validation on budget and cost writes and the child picker. Preserve valid stored history, filter unreadable fields and use the Task 2 relation writer transactionally. Reuse the hierarchy validator in Task 5. Re-run the same targeted tests.

## Task 4 — Mapped Initiative dates and internal schedule data

**Owner:** backend-dev.

**Files:** Create `backend/app/services/ppm_timeline.py` and `backend/tests/api/test_ppm_timeline_settings.py`. Modify `backend/app/api/v1/{settings,metamodel,ppm,ppm_reports,cards}.py`, `backend/app/schemas/ppm.py`, `backend/app/services/{card_write_service,ppm_portfolio_service,servicenow_service,rollback_service}.py` and the Platform Migration card apply path `backend/app/services/migration/apply.py`. Add the date regressions to `test_migration_stage_and_apply.py`, `test_servicenow_sync_engine.py`, `test_rollback_apply_exact.py`, `test_ppm_reports.py` and `test_web_portals_ppm.py`.

**Interfaces:** `PmlTimelineMapping(actual_start_key: str | None, actual_end_key: str | None)`; admin `GET /settings/pml/timeline` and `PUT /settings/pml/timeline`; `validate_timeline_mapping(mapping, initiative_type)`; `validate_actual_date_pair(mapping, attributes)`; `visible_actual_dates(mapping, card, type_schema) -> tuple[date | None, date | None]`. Mapping access requires `admin.settings`. The PUT can request a missing default via `create_defaults: list[Literal["start", "end"]]`, empty by default; provisioning also requires `admin.metamodel`. Add only the requested compatible missing field and save its mapping in the same transaction. Report occupied keys and preserve existing schema and values.

**Write entry points.** Put the final date-pair validation in `card_write_service.create_card` and `update_card`, after existing attribute preservation. Both `bulk_update` and spreadsheet `bulk_create_cards` in `backend/app/api/v1/cards.py` write directly, so call the validator on their per-card candidates. Preserve the existing value of an omitted mapped Actual key on partial edits, including when the normal attributes payload is a replacement. An explicit null clears that side. Validate the pair after applying those semantics. Platform Migration and ServiceNow also map incoming keys and write directly. Validate the mapped and merged candidate before either writer persists it, and use the same check in their existing preview or staging validation paths. Return errors through each import's existing reporting mechanism. Guard edits to the Initiative field schema in `metamodel.py` and use the same validator for workspace Cards in Task 5.

In `rollback_service._apply_restore_card_fields`, build the candidate with the current mapping before applying snapshot fields. Validate the restored attributes after the existing locked-field policy so a snapshot predating a mapping change cannot restore an inverted date pair. Use the existing rollback skip reporting and leave that card's fields intact when its inverse operation is invalid.

Seed the built-in Initiative dates `actualStart` and `actualEnd` and use them as the default Timeline mapping. Alembic 201 installs them on existing instances and normalizes Aruba's legacy `ActualEnd` field and its values. Preserve compatible explicit mappings, existing layout and portal visibility. The Metamodel protects both built-in fields against deletion, rename and type changes. Store explicit mapping changes in `pml.timeline` with a key-scoped update.

Add `actual_start_date` / `actual_end_date` to private `PpmGanttItem`; planned `start_date` / `end_date` are unchanged. Give the private Portfolio its own latest-report projection with `cost_health` omitted when the viewer lacks that card's cost read access. Preserve the existing public Portfolio adapter and the full status report contract. For private card, Overview and print, `GET /ppm/initiatives/{id}/schedule` returns `PmlInitiativeScheduleOut` with `initiative_id`, `start_date`, `end_date`, `actual_start_date`, `actual_end_date`, their configured labels, `plan_start_date`, `plan_end_date`, `plan_derived`, and permitted `schedule_health`, `cost_health`, `scope_health`. The first four dates are the Initiative's own values; the two plan endpoints can represent the permitted derived span. Hidden fields are omitted from dates and labels. Filter the effective layout's date sources for the Initiative and descendants before computing individual or inherited Plan bounds.

Gate the schedule on `ppm.view` and module-mode Initiative read scope. Return 404 for a hidden Initiative and 403 for a readable Initiative where the caller lacks module permission. Use `latest_reports` from `ppm_portfolio_service.py` in schedule and Portfolio, descending by report date, creation time and ID. Verify the same row is selected in both when the first two keys tie. Exercise a card where Actual Start is visible and Actual End is hidden. The server sends only the permitted date and omits Actual End and any derived value that could reveal it. The client draws one marker. The public card portal keeps its separately configured visibility.

- [ ] Write tests for exact-case `actualStart` and `ActualEnd` on Aruba layouts, one pre-existing field, provisioning only the missing side, denial with settings-only permission, compatible custom labels, an incompatible pre-existing key, plan key rejection, removing an active field, hiding Actual End for a subtype, and a partial PATCH with invalid pair after merging. Test bulk writes here and workspace import in Task 5. Assert a program gets only its own actual dates and that a hidden descendant planned date cannot expand its visible Plan. Assert `cost_health` is absent from private schedule and Portfolio JSON for a reader denied costs. Assert the public Portfolio omits actual dates even when nonempty. Separately test a pre-existing card portal with `ActualEnd` already visible, then map that field. Assert `ActualEnd` stays detail-only with `card: false, detail: true`, a date with both flags false is absent from the payload, and the portal receives no private PML data. A newly created normal date field keeps the existing publisher defaults. Verify stable report selection when two reports have the same report date.
- [ ] Run `bash scripts/test.sh --serial tests/api/test_ppm_timeline_settings.py tests/api/test_ppm_reports.py tests/api/test_web_portals_ppm.py tests/services/test_migration_stage_and_apply.py tests/services/test_servicenow_sync_engine.py tests/services/test_rollback_apply_exact.py`. Capture expected failing assertions.
- [ ] Implement the mapping, typed date validation and explicit provisioning. Preserve types, stored attributes, case and layout overrides. If a field conflicts, require another compatible field. Apply effective layout visibility before constructing all private projections and derived Plan spans. Keep the existing card portal visibility policy and public Portfolio projection. Apply cost-health redaction on the server before serializing the private Portfolio and schedule read. Validate merged values through the named write entry points. Share latest-report ordering between card and Portfolio. Keep actual dates out of the detailed WBS/task schedule calculation.
- [ ] Re-run the focused suites. Verify private/public schema separation, spreadsheet bulk create and bulk edit, Platform Migration preview/apply and ServiceNow create/update with mapped attributes. Confirm the current Aruba keys can be selected without creating defaults.

## Task 5 — Workspace transfer and data consistency

**Owner:** backend-dev.

**Files:** Modify workspace `sections.py`, `schema.py`, `remap.py`, `applier.py`, `entities.py` and `exporter.py`. Create `backend/tests/services/test_workspace_io_pml.py` and add relevant guard tests in `test_workspace_io_id_bearing_columns.py`.

**Interfaces:** Consume Tasks 1–4 validators. Resolve selected CardTypes first, then prepare the candidate Timeline mapping against the resulting schema before validating card date attributes. Defer applying the financial settings block until the Cards pass has built the destination ID map. Remap card-valued defaults and formula constants before applying financial definitions; then import budgets, costs and invoices in that order. Preserve the financial entity identities used for repeat-import matching. Remap card FKs and JSONB card IDs through the card ID map, resolving financial parent IDs against matched destination entities. Encode historical unavailable Provider identity with distinct opaque keys. Carry exact invoice decimal amounts and rebuild totals from invoice rows.

**Preview and apply:** Extend the common workspace runner `_run` in `applier.py`, used by `diff_bundle`, `apply_bundle` and `apply_selected`. Reuse its rollback boundary for preview. In `sections.py`, order `PpmBudgetLines` before `PpmCostLines`, then the new invoice section. Run the same typed financial validation as the write API against the candidate configuration and matching destination rows before any generic `already_present` shortcut. Validate incoming budget and cost Provider assignments against the resulting hierarchy and normal historical-assignment rules. Existing invoice entries and their cost links do not affect that validation. Use the usual repeat-import match to skip identical existing financial records. A selected invoice section may reference an existing matched Cost Item. For any missing or rejected parent, report the dependent rows that cannot be resolved.

Validate the resulting Initiative schema and active Timeline mapping together before applying either. Use incoming values from selected sections and destination values for sections the user did not select. Commit the coupled changes together. A conflict preserves both last valid values, reports the affected mapping and prevents dependent date writes. Unrelated rows continue under the existing partial-import rules. Test bad pairs with both sheets selected and with only one of CardTypes and Settings selected.

For Settings-only imports, initialize the destination card resolver and the reference remap before finalizing financial definitions even when no entity sheets are selected. Use the existing match logic in `_load_remap_context` against the destination inventory. Report an unresolved nonempty card default or rule constant and preserve the destination definition. Include a fixture with a different target card UUID that resolves via the normal matching rules.

| Transfer state | Import contract |
|---|---|
| Old bundle without invoice sheet and with null or missing budget links | Keep legacy costs unassigned. Preserve destination financial definitions and date mapping when those settings are absent. |
| New bundle into an empty workspace | Resolve CardType definitions and Timeline mapping first. After Cards, rewrite card IDs in field values, defaults and rule constants. Apply definitions, then budget, cost and `PpmInvoices` rows. Serialize invoice amounts as decimal text throughout. |
| Selected sheets into a populated workspace | Resolve parent rows from selected data or a matched destination ID and confirm they belong to the same Initiative. Report an unresolved nonempty reference or incompatible definition before writing its dependent rows. Preview never persists any changes. |
| Repeated bundle | Match financial rows by entity ID, and keep the same parent references. Compare the carried editable values and resolved parents, ignoring bookkeeping stamps. Identical rows are skipped and no invoice is duplicated. A matching ID with conflicting content or parents reports a conflict, keeps the destination row and blocks incoming rows that depend on that rejected match. |

Test import authorization in `backend/tests/api/test_workspace_pml_access.py`. A holder of the dedicated export/import grant can transfer invoice records through the workspace route. A PML editor without the grant cannot. Neither grant changes the checks on interactive invoice routes. Test an invoice amount of `"30.11"`, a leading-zero document reference and a target Cost Item whose Initiative ID was remapped.

- [ ] Reject importing a Provider card-reference definition or constant for the invoice section, and report its dependent rows. Write `test_pml_roundtrip_into_empty_workspace`, `test_partial_import_preserves_destination_invoice_links`, `test_historical_reparented_provider_roundtrip`, `test_restore_keeps_exact_aruba_date_mapping` and `test_invoice_transfer_preserves_recorded_amount`. Cover older bundles without new fields, valid unassigned costs with invoices, a declared historical association with resolved references, rejection of an incompatible new assignment without that state, two deleted identities, admin backup without interactive invoice read, configured field type conflicts, Plan date collision, removing a mapped field through a partial type import, selective imports and a repeated restore. Test the invoice entity and entity order in `backend/tests/services/test_workspace_io_roundtrip.py`. In an empty destination with different card UUIDs, assert that both a Provider default and a formula's selected Provider constant resolve to the new cards. Assert an invoice-only transfer preserves a fractional amount exactly.
- [ ] Run `bash scripts/test.sh --serial tests/services/test_workspace_io_pml.py tests/services/test_workspace_io_id_bearing_columns.py`; capture expected failures.
- [ ] Wire export, import order and references. Keep planning/mapping validation separate from finalizing card-ID-bearing financial settings after Cards. Validate the Provider reference and hierarchy before the existing-identity/skip branch in the entity importer. Keep stable invoice links in a selected budget or cost import. Restore historical taxonomy assignments with explicit reported state, preserving the original identity. Apply date-pair validation and protect active mappings. Rebuild the invoiced projection from invoice rows and preserve unrelated custom Card fields, including a pre-existing `pmlActualInvoiced` attribute in a repeat or empty-target restore test. Handle compatible legacy null links distinctly from unresolved IDs. Preserve recorded invoice amounts and independent settings keys.
- [ ] Re-run `bash scripts/test.sh --serial tests/services/test_workspace_io_pml.py tests/services/test_workspace_io_id_bearing_columns.py tests/services/test_workspace_io_roundtrip.py tests/services/test_workspace_io_id_remap.py tests/api/test_workspace_pml_access.py`. Require successful full/partial and repeat-import assertions and a wipe-and-restore fixture that proves IDs were remapped.

## Task 6 — Operator finance hierarchy and printable view

**Owner:** frontend-dev.

**Files:** Create `PpmFinanceTree.tsx`, `PpmFinancialRowForm.tsx`, `usePpmFinancials.ts` and colocated tests under `frontend/src/features/ppm/`. Modify `PpmCostTab.tsx`, `PpmCostTables.tsx`, `PpmProjectDetail.tsx`, `PpmProjectReport.tsx`, `frontend/src/types/index.ts` and English `ppm.json`.

**Interfaces:** `usePpmFinancials(initiativeId: string)` via `useApiQuery`. Typed `PpmFinancials`, row definitions, and `PpmInvoice` mirror Tasks 1–3. `PpmFinanceTree({data, rollup, readOnly, onChanged})` groups by budget ID and then cost ID. Pass the existing independently derived PPM `PpmRollupOut | null` from `GET /ppm/initiatives/{id}/rollup` to the tab/print tree. Render each side's descendant fallback on the side with no own rows. Its invoicing and linked-cost cells use an em dash. When a program has its own budget and only descendant costs, the own budget's linked-cost total is zero while the read-only descendant Actual fallback can still be shown. `PpmFinancialRowForm` accepts immutable create context with initiative and parent ID; move/assign is a separate action. Use the server's exact aggregate strings for display.

**Authoring and refresh:** Route existing Cost Item create through the contextual form and send `budget_line_id` from that context. Refetch the owning financial query after each successful mutation so both parents update together. Card and print consumers request fresh data when opened. If a view mounts several financial widgets, their parent owns the query and supplies the same result. Use `keepPreviousData: false` and render financial data only when the returned `initiative_id` matches the active one and the request has no error. Apply the same identity boundary to the protected schedule query. In tab, card and print, test switching from a readable Initiative to a denied or failed request while the old request is still in flight. Assert that the previous values are unavailable throughout the transition. Preserve the independent PPM rollup for descendant fallback and consume the protected `card_comparison` only in the embedded card widget. Use the server's budget totals and separate Initiative-wide invoiced amount for both tab and print.

| UI action | Request and success state |
|---|---|
| Add Cost Item from budget | POST the cost to `/ppm/initiatives/{id}/costs` with the context `budget_line_id`. Reopen the budget and display the new row. If the parent is stale, show the error and refresh choices. |
| Record invoice from Cost Item | POST the invoice with context `cost_item_id` and `{invoice_date, invoice_id, amount}`. Send the amount as decimal text and preserve leading zeroes in the document ID. Reopen both parents. |
| Move or assign Cost Item | PATCH `/ppm/costs/{id}` with the selected destination `budget_line_id` and include `provider_child_id` only when changing the selection. Same-Initiative budget choices only. |
| Move invoice | PATCH `/ppm/invoices/{id}` with `{cost_item_id}`. The editor can select legacy unassigned costs and costs under other budgets in the same Initiative. Refresh both parent totals. |
| Open project print | Read the same financial projection. Expand all authorized rows and display fiscal-year subtotals, budget totals and the separate Initiative invoiced total. |

- [ ] Write Vitest regressions `creates a cost within its budget context`, `records an invoice within its cost context`, `shows totals for a collapsed budget and legacy invoices under their own group`, `renders fully expanded print with matching totals`, `omits invoice controls for the restricted editor` and `keeps own budgets and descendant cost fallback independent`. Assert exact request bodies, same-Initiative invoice move choices including a Cost Item with a different Provider, an Aruba child display and em dashes on derived descendant rows. Verify the prompt when there are no budgets, distinct short IDs for identical undescribed budget rows and automatic opening of a parent after its child saves. In the tab and print, assert 30.11 invoiced and 70.02 remaining display the recorded decimals. Verify the invoice form and rows contain date, document reference, net amount and configured row-local fields. In the Cost Item form tests, verify a disabled Provider hierarchy offers no child selector and keeps the existing saved child on unrelated edits.
- [ ] Run in `frontend/`: `npm run test:run -- src/features/ppm/PpmFinanceTree.test.tsx src/features/ppm/PpmFinancialRowForm.test.tsx src/features/ppm/PpmProjectReport.test.tsx`; verify expected failing cases.
- [ ] Implement the expandable budget hierarchy, context controls, shared custom field rendering, legacy assignment and explicit move forms. Preserve the recorded decimals in the new amount views. The invoice form records the document date, reference and net amount. Wire CardPicker's `searchSource(params)` to the Task 3 endpoint on the active budget and pass through its paginated envelope. Render current totals with collapsed rows and server-calculated fiscal/category subtotals. Use read-only, expanded layout in print. Preserve existing chart inputs.
- [ ] Re-run the focused suites and `PpmCostTab.test.tsx`, `PpmCostTables.test.tsx` and `PpmMobileLayout.test.tsx`. Verify keyboard expansion, date/money labels and narrow layouts using tests and a local screenshot.

## Task 7 — Admin configuration and module naming

**Owner:** frontend-dev.

**Files:** Create `PmlFieldSettings.tsx`, `PmlTimelineSettings.tsx` and tests under `frontend/src/features/admin/`. Modify `SettingsAdmin.tsx`, `PpmHome.tsx`, navigation/module strings and English namespaces. Keep the docs wording work with Task 9.

**Interfaces:** Consume Tasks 2 and 4 settings APIs and existing Metamodel field/type data. Show independent editors for Planned Budget, Cost Items and Actual Invoiced and an explicit Timeline mapping control. Reuse the existing select and typed card-picker primitives. Row fields configured with Provider scope reuse the chosen relation from the existing Metamodel.

- [ ] Write Vitest tests `saves one field section without replacing its neighbors`, `previews an ordered rule and displays a dependency error`, `uses the built-in actualStart and actualEnd as defaults` and `creates only a missing actual end when authorized`. Verify editable distinct date options, existing Plan keys excluded, inherited Provider dependency handling and the Project Master List label with the existing PPM navigation destination.
- [ ] Run in `frontend/`: `npm run test:run -- src/features/admin/PmlFieldSettings.test.tsx src/features/admin/PmlTimelineSettings.test.tsx src/features/admin/SettingsAdmin.test.tsx src/features/ppm/PpmHome.test.tsx`; see the red cases.
- [ ] Implement field settings, formula/rule preview, visibility/order and deactivation, Provider/child mapping and the Timeline mapping panel. Update displayed text to PML and Project Master List. Preserve identifiers used for authorization and navigation.
- [ ] Re-run the same suites. Verify an admin can configure the four Aruba fields and the existing date keys from the UI with no code-specific Aruba labels.

## Task 8 — Initiative card summaries and Plan / Actual displays

**Owner:** frontend-dev.

**Files:** Create `PpmInitiativeTimeline.tsx` and `PpmInitiativeFinancials.tsx` with tests under `frontend/src/features/ppm/`. Modify `CardDetailContent.tsx`, `sectionConfig.ts`, `PpmOverviewTab.tsx`, `PpmPortfolioView.tsx`, `ppmPortfolioModel.ts`, `PpmProjectReport.tsx`, private Portfolio types and English labels.

**Interfaces:** `PpmInitiativeTimeline` consumes Task 4's private schedule projection for Card, Overview and print. `PpmInitiativeFinancials` consumes `usePpmFinancials` and its authorized `card_comparison`. The internal Portfolio row model exposes private actual dates separately; public Portfolio callers use the existing public type/renderer configuration.

Share the overlapping chart rendering from `frontend/src/components/licensing/PairBars.tsx` and `pairBarsOption.ts` with `PpmInitiativeFinancials`. Keep Licensing's adapter and pass financial labels and amount formatting through the shared renderer for PML. Map Budget to the wide background bar and Actual Cost to the narrow foreground bar on a shared scale for Total, CapEx and OpEx. The financial adapter supplies exact display amounts, variance as Budget minus Actual Cost and ratio as Actual Cost divided by Budget for positive budgets. Keep Actual Invoiced as a separate amount above the widget.

Gate embedded card requests on the PML module toggle, the viewer's PML access and the configured section visibility. Keep the standard Metamodel-controlled cost and date fields available with their existing view and edit permissions. Test that disabling PML removes both widgets and their requests without disabling those fields. A schedule response carries `initiative_id` and follows the same rendering guard as the financial response from Task 6.

Connect the successful Card edit callback in `CardDetailContent.tsx` to the private schedule query's `refetch` or `refetchKey` for the same Initiative. In the card regression, save an actual date while the section remains mounted. Verify it issues a fresh GET and updates the track from the returned date while keeping the Plan dates.

- [ ] Write regressions for `Cost & Timeline` positioning, Actual Invoiced projection matching the tree and preserving a recorded amount of 30.11, two tracks with date fixed to 2026-07-01, one-date markers, exact actual dates on desktop/mobile group anchors, out-of-window dates, hidden configured end date, readable Program fallbacks, protected Financials and the public-only Plan view. Check Overview and printable parameters against the same exact-case Aruba dates.
- [ ] Add chart assertions for Budget and Actual Cost on the same axis with full overlap, the narrower Actual Cost in front, and correct values and variance for under-budget, over-budget and zero-budget rows. Assert 11,000 on 12,000 displays 92% and +1,000, while 3,000 on zero displays −3,000 with no ratio. Verify the label clears the longer bar and the amounts remain accessible on narrow screens.
- [ ] Run in `frontend/`: `npm run test:run -- src/features/ppm/PpmInitiativeTimeline.test.tsx src/features/ppm/PpmInitiativeFinancials.test.tsx src/features/ppm/PpmPortfolioView.test.tsx src/features/ppm/PpmOverviewTab.test.tsx src/features/ppm/PpmProjectReport.test.tsx src/features/cards/CardDetailContent.test.tsx`. Verify expected failing assertions.
- [ ] Add the embedded read-only amount, shared overlapping Financials widget and Timeline with Plan/Actual under the configured section. Reuse date and chart model functions across card and Portfolio. Use the filtered visible dates for axis bounds, tooltips and printed summaries. Use shared latest-report health statuses, with per-card cost visibility for On Cost and any descendant financial input. Respect hidden/subtype layouts and keep the existing public rendering path Plan-only.
- [ ] Re-run the focused suites plus `ppmPortfolioModel.test.ts` and `PpmMobileLayout.test.tsx`. Run `npm run test:run -- src/components/licensing/PairBars.test.tsx src/components/licensing/pairBarsOption.test.ts` from `frontend/` for the existing Licensing chart. Verify the existing detailed Gantt drag tests and the printable Plan/Actual and Budget hierarchy smoke paths.

## Task 9 — End-to-end verification, documentation and integration

**Owner:** main session coordinates repository agents: `frontend-dev` for browser regression, `translator` for nine locales, `docs-keeper` for manual verification, and independent review agents.

**Files:** Create `frontend/e2e/pml-financials.spec.ts`. Update `docs/guide/ppm.md`, `docs/admin/settings.md`, `docs/reference/glossary.md`, `mkdocs.yml` navigation and translated labels, other manual references, locale siblings, `docs/api/openapi.json`, `VERSION` and `CHANGELOG.md`. Update the capture steps in `scripts/screenshots/pages.ts` for affected documented images.

**Browser fixture.** Use the spec's Platform FY26 budget at 12,000, Renewal cost at 8,000 and Support at 2,000. Record 4,000 and 2,500 against Renewal. Move the 2,500 invoice to Support and check Renewal invoiced 4,000, Support remaining −500, budget invoiced 6,500 and budget remaining 3,500. Add or restore the legacy 300 invoice and check 6,800 on the card and print with the budget still at 6,500. Verify the Financials values stay driven by recorded costs. Use the two date tracks from the spec and confirm the mapped `actualStart` and `actualEnd` values agree in the card, internal Portfolio and print. In the role pass, use an isolated user and verify that the PML view without cost access omits the invoice branch.

- [ ] Write an E2E fixture via the existing authenticated test harness. Create a CapEx budget with an allowed child Provider and an OpEx Cost Item, add two invoices, check the Cost Item, budget and Initiative totals, move an invoice to a Cost Item with a different Provider in the same Initiative, then set Plan and Actual dates and inspect the private Portfolio. Use an isolated disposable dataset and clean up created rows. Include a restricted Viewer check in the isolated VAPT workflow, covering actual-date/public projections, finance visibility, Provider edits and transfer permissions. Use the repository's VAPT rules.
- [ ] Run from the root `python scripts/dump_openapi.py` in the tested backend environment. Verify the generated spec contains the financial routes and private actual-date response only where intended. Build the frontend first with `npm run build` from `frontend/`. Deploy that revision on the isolated demo stack with its migrated backend, then set `E2E_BASE_URL` to that stack and run `npm exec playwright test -- e2e/pml-financials.spec.ts` from `frontend/`. Discard the disposable database afterward, including Metamodel and settings changes. Record the revision and test results.
- [ ] Update the English use instructions and admin setup with the configured Aruba keys, hierarchy, non-VAT field basis, allocation/grouping and transfer behavior. Select the change's minor version from the updated `VERSION`, bump once and add its changelog entry. Translate with the project's translator and run parity before full suites. Have `docs-keeper` capture the affected demo images in all ten locales with `bash scripts/docs/docker-docs.sh capture --only 40_ppm,41_ppm,43_ppm,101_ppm,103_ppm`, then use `bash scripts/docs/docker-docs.sh all` for the final strict checks. Verify links, screenshot contracts and content.
- [ ] Run `ruff format .`, `ruff check .` and `python -m mypy app/` from `backend/` with the backend environment active. Run the full backend suite `bash scripts/test.sh` followed by `npm run test:run` and `npm run build` from `frontend/`. Record exact output, migration state and any scope limitations.
- [ ] Follow the project's pre-PR chain in order: code simplifier, affected tests, code reviewer and fixes/tests, security reviewer and fixes/tests, rules alignment under user approval, learning approval and VAPT evidence. If a fix affects a contract, regenerate OpenAPI before taking the final review receipts. Repeat affected locale, manual, build and browser checks after any changes to those inputs. The main chat reads and records the two static security reviews for the final commit and diff scope. Re-run both passes if the scope changes or the receipts are older than 30 minutes when opening the PR. Complete the template and check CI mutation results once publication is authorized. Use focused conventional commits after their tests and keep the spec and plan with the implementation.

## Coverage and integration check

| Spec contract | Plan task |
|---|---|
| Budget/cost/invoice links, legacy rows, amount rules, aggregation axes | 1, 6, 9 |
| Generic configurable fields, calculations and Aruba setup | 2, 3, 6, 7 |
| Budget and Cost Item Provider hierarchy and role boundaries | 3, 5, 6, 9 |
| Actual dates, Aruba key mapping and public surfaces | 4, 5, 7, 8, 9 |
| Complete/selected transfer and recorded amounts | 5, 9 |
| Initiative card, Portfolio, print and naming | 6, 7, 8, 9 |

The plan delivers one integrated feature branch. The milestone boundaries are test and review checkpoints. Publish after the full chain on the actual implementation commit and the user-authorized PR workflow.

### Evidence for the final reviewed revision

| Check | Record |
|---|---|
| Database upgrade and legacy rows | Before and after migration revisions, existing cost amount and row count, legacy null budget, successful card cascade and blocked direct dependent delete. |
| Financial contracts | OpenAPI diff including required Cost Item parent, new invoice routes and the protected projections. Focused auth and concurrency tests with collection counts. |
| Workspace import | Same-version round trip, older bundle, selected import with unresolved parent, exact reference remapping, unchanged preview state and repeat import. |
| Frontend | E2E revision, test counts, screenshot checks for desktop, mobile, print, the overlaid widget and the admin mappings. |
| Local SDLC and CI | Translation parity, strict manual build, full suite results, simplifier/review reruns, isolated VAPT evidence and security review receipts tied to the final diff. Once authorized to publish, record mutation checks from CI. |

## Agent's calls

- Keep the backend contract change and the updated UI create path in one deployed revision. A newly inserted demo Cost Item receives a budget via its seed fixture. Upgraded data keeps its existing associations.
- Capture each targeted regression's failing run before editing its implementation and its passing run afterward. Verify the command collects tests. The backend runner takes paths relative to `backend/`.
- Source budget hierarchy totals and the Initiative-wide invoiced amount from two explicit server fields. This lets the tree and print preserve the same totals when legacy costs have invoices.
- Finish each PPM budget or cost transaction after its card rollup and history are prepared. Reuse the existing relation locking conventions on writes that add a configured reference. Invoice totals stay derived on read.
- Carry over an omitted mapped Actual date during attribute updates. The existing card flows can replace the attribute object and an explicit null remains the way to clear a date.
- The standard Actual keys are already available on a fresh or upgraded instance. The setup screen supports mapping existing compatible custom date fields.
