# Changelog

All notable changes to Turbo EA are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.12.0] - 2026-05-14

The TurboLens CVE scanner has been removed. The Security tab is now Compliance-only, and the on-demand regulation gap analysis remains fully intact.

### Removed
- **TurboLens CVE scanner, NVD integration, and CVE findings registry.** The `turbolens_cve_findings` table, the NVD REST client (`services/turbolens_nvd.py`), the CVE scan orchestrator (`run_cve_scan`, AI prioritisation pass, risk-matrix aggregator), and every CVE-related API route (`POST /security/cve-scan`, `GET/PATCH /security/findings`, `GET /security/findings/{id}`, `GET /security/export.csv`) are gone. The CVE → Risk promotion path (`POST /risks/promote/cve/{id}` and the supporting `promote_cve_finding` service helper) is also removed; `RiskSourceType` no longer carries `security_cve`. Migration `084_remove_cve_scanner` drops the table, purges promoted CVE-derived risks (and their card joins + owner Todos), and clears `security_cve` analysis-run history. The `NVD_API_KEY` environment variable is no longer read.
- **CVE UI surface.** The TurboLens Security tab is rebranded to Compliance: the inner CVE sub-tab, the CVE findings table, the clickable 5×5 probability × severity risk matrix, the CVE finding drawer, the "Top critical findings" overview block, and the CSV export button are removed. The Create Risk dialog's CVE-promote branch and the CVE-flavoured i18n keys (severity / priority / probability / status / drawer / patch / matrix labels) are deleted across all 8 locales.
- **CVE demo seed data.** `seed_demo_security.py` no longer ships the 8 fictitious `CVE-2025-9XXXX` rows; only the 12 compliance findings remain. The `seed_demo.py` sample risk with `source_type: "security_cve"` is removed. The matching test suites (`test_turbolens_nvd`, `test_turbolens_security_cve_scan`) are deleted and `test_turbolens_security` / `test_seed_demo_security` keep only the compliance assertions.

### Changed
- **Permission descriptions.** `security_compliance.view` / `security_compliance.manage` keys are kept (the compliance scanner still uses them) but their descriptions now reference compliance only. The permission group label is renamed from "Security & Compliance" to "Compliance".

## [1.11.5] - 2026-05-14

First expansion of the MCP server toolset since its creation. The server now exposes 26 read-only tools (up from 8), covering the major backend modules that have shipped over the last two weeks.

### Added
- **18 new MCP tools across five clusters.** GRC: `list_risks`, `get_risk`, `get_risk_metrics`, `get_card_risks`, `list_cve_findings`, `list_compliance_findings`, `get_security_overview`. Governance & Delivery: `list_principles`, `list_adrs`, `get_adr`, `list_soaws`. Reports: `get_portfolio_report`, `get_cost_treemap`, `get_capability_heatmap`, `get_data_quality_report`. Card context: `get_card_stakeholders`, `get_card_comments`, `get_card_documents`. Every tool is a read-only `GET` shim — the user's JWT is passed straight through to the backend so RBAC is enforced server-side without any per-tool permission checks on the MCP side. The Risk Register filters match the existing UI sidebar; a `_compact()` helper drops `None` / empty filters so URLs stay clean. 20 new unit tests in `mcp-server/tests/test_server.py` (mocked `TurboEAClient.get` + path/params assertions) round out the coverage. Tool reference in `docs/admin/mcp.md` (+ 7 locales) refreshed.

### Fixed
- **MCP HTTP transport now uses Streamable HTTP, served at the right path, and trusts its public hostname.** Six coupled bugs that made the public deployment unreachable from Claude Desktop's custom connector:
  1. The server was wired to `mcp.sse_app()`, the older two-endpoint SSE transport (`GET /sse` stream + `POST /messages/?session_id=…`). Modern MCP clients speak Streamable HTTP — POST JSON-RPC directly to the protocol endpoint with an optional SSE upgrade — so the handshake silently failed. Switched to `mcp.streamable_http_app()`.
  2. The streamable app was mounted inside an outer Starlette at `/mcp`, which pushed the protocol route to `/mcp/mcp` on the upstream and triggered a 307 for clients hitting `/mcp` without a trailing slash. The streamable app is now the top-level ASGI app with the OAuth + well-known + health routes attached directly to it, so nginx's `/mcp/` strip lines up with the upstream's `/mcp`, `/.well-known/*`, and `/oauth/*` routes.
  3. FastMCP's built-in DNS-rebinding protection only accepts `localhost` / `127.0.0.1` by default, so any reverse-proxied request through a real hostname got a `421 Misdirected Request`. We now derive `allowed_hosts` and `allowed_origins` from `MCP_PUBLIC_URL` + `TURBO_EA_PUBLIC_URL` at startup and pass them to `TransportSecuritySettings`, keeping the localhost entries for stdio/local development.
  4. After the handshake worked, every tool call still returned "Not authenticated". Streamable HTTP keeps a long-lived session task that handles tool dispatch, and `contextvars` set in an ASGI middleware on the request task don't propagate into it. Reworked the auth helper to resolve the Bearer JWT on demand from `mcp.server.lowlevel.server.request_ctx` — the low-level MCP server sets that contextvar on the session task right before invoking a handler, with the HTTP `Request` attached, so the Authorization header is always reachable from inside a tool. The old `AuthMiddleware` is gone; tools now `await _get_current_token()` which does a (cached) OAuth resolution per tool call. Stdio mode still short-circuits to the `_stdio_token` global.
  5. Unauth'd MCP requests were silently accepted, so clients never realised they needed to authenticate and just kept sending unauthenticated calls. Added a `RequireBearerForMcp` ASGI middleware that returns `401 + WWW-Authenticate: Bearer resource_metadata="…/oauth-protected-resource"` for any `/mcp*` request without a Bearer header, kicking off the connector's OAuth flow per the MCP spec. The OAuth and well-known routes themselves remain public.
  6. Some MCP connectors probe `/.well-known/openid-configuration` (OIDC discovery) instead of `/.well-known/oauth-authorization-server` (RFC 8414) to find the auth endpoints after reading the protected-resource metadata. Added the OIDC path as an alias serving the same metadata payload so both discovery styles resolve.

## [1.11.4] - 2026-05-14

Small quality-of-life addition for the Card Detail page.

### Added
- **"Open in new tab" and "Copy link" shortcuts in the Card kebab menu.** Both items live above the existing Favorite / Archive / Delete actions (with a divider between the navigation actions and the destructive ones). "Open in new tab" opens `/cards/<id>` in a new browser tab; "Copy link" copies the absolute URL to the clipboard and surfaces a transient confirmation toast. If the Clipboard API is unavailable (older browsers, insecure contexts) the action falls back to a manual-copy `prompt`. Permission-free — both shortcuts are visible on every card. i18n keys added to `common.json` in all 8 locales.

## [1.11.3] - 2026-05-14

A first-time evaluator opening `SEED_DEMO=true` used to land on an empty **GRC → Compliance** tab — the only way to populate it was to configure an LLM provider and trigger a real scan. This release ships a hand-curated set of demo findings so the tab is usable out of the box.

### Added
- **Seeded demo CVE and Compliance findings.** A new `seed_demo_security.py` seeder runs on `SEED_DEMO=true` (or on demand via `SEED_SECURITY=true`) and inserts 8 example CVE findings (across critical / high / medium / low severities and the full `open → acknowledged → in_progress → mitigated → accepted` lifecycle) and 12 Compliance findings (covering all six built-in regulations — EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001 — with a mix of card-scoped and landscape entries spanning every compliance lifecycle state). CVE IDs are deliberately fictitious (`CVE-2025-9XXXX` block) so they cannot collide with real-world advisories; the seeded findings carry the same `(card_id, cve_id)` and `finding_key` natural keys as scanned findings, so a later real scan upserts cleanly without duplication. The seeder is idempotent (skips if any finding row already exists) and silently skips findings whose target card isn't present in the install. A new `test_seed_demo_security.py` validates that every referenced card name exists in `seed_demo.py`, every regulation key is a built-in, and every lifecycle state is valid.

## [1.11.2] - 2026-05-14

Two follow-ups on the Compliance grid: a fix for duplicate findings the LLM was minting on every re-scan, and a new bulk-action toolbar so admins can edit or delete many findings at once.

### Added
- **Multi-select + bulk delete / bulk edit on the Compliance grid.** AG Grid's filter-aware "select all" header checkbox + a sticky toolbar that surfaces when ≥1 row is selected. Two actions: **Edit decision** (bulk-transition every selected row to a single new lifecycle state, with optional review note; required when the target is "accepted") and **Delete**. Backed by new `PATCH` and `DELETE /api/v1/turbolens/security/compliance-findings/bulk` endpoints (gated by `security_compliance.manage`). Partial-success contract — rows where the lifecycle transition is illegal, where an open Risk holds the row at `risk_tracked`, or that no longer exist are reported in a result dialog instead of failing the whole batch. i18n added in all 8 locales.

### Fixed
- **Compliance re-scans no longer mint duplicate findings.** The upsert key used to hash a 200-char prefix of the LLM-emitted `requirement` text — and the LLM rephrases that body on every run, so each re-scan inserted a brand-new row for the same logical finding. The new key is `(scope, card, regulation, normalised article)` only; `requirement` and the rest of the body fields are scanner content, not identity. The article identifier is also normalised so `Art. 6` / `Article 6` / `art 6` / `§ 6` / `§6` all collapse to the same hash. Migration `083_compliance_finding_dedup` rebuilds the key for existing rows and consolidates duplicate groups by keeping the most user-touched row (priority: linked Risk > non-default decision > reviewer > most recent), merging any user state from the losers onto the keeper before deleting them.

## [1.11.1] - 2026-05-14

Follow-up fixes after the GRC module landed in 1.11.0. Addresses two correctness regressions on the security & compliance scanners (CVE re-scans were wiping triaged status and Risk back-links; AI verdict cards weren't sticky on re-scan), one stale link to the dissolved EA Delivery route, two scan-picker edge cases, and the docs the original PR deferred.

### Added
- **`/grc` user manual** (English source + 7 locale variants) covering the Governance / Risk / Compliance tabs, deep-link query params, and permissions. The mkdocs nav now lists "GRC" between "EA Delivery" and "Risk Register" in all 8 navs. The Risk Register and TurboLens Security & Compliance pages now point at the new GRC home.

### Fixed
- **CVE re-scan no longer wipes user state.** `run_cve_scan` used to delete every `TurboLensCveFinding` at the start of every run, resetting user-set status (acknowledged / mitigated / etc.) and severing `risk_id` back-links to promoted Risks. It now upserts by `(card_id, cve_id)`: scanner-side fields refresh from NVD, but `status` and `risk_id` are preserved. Vanished rows are deleted only when untouched (`status="open"` and no Risk).
- **User AI verdict is sticky in both directions across re-scans.** The verdict endpoint (`POST /security/compliance-findings/{id}/ai-verdict`) writes `attributes.hasAiFeatures = true` or `false`. `detect_ai_bearing_cards` previously only consulted the subtype, so verdicts in either direction were silently re-evaluated on the next scan. Now: `=true` cards are always in scope (even if the LLM misses them); `=false` cards are always out of scope (even if their subtype matches `AI_SUBTYPES` and even if the LLM would have flagged them). Cards with no verdict still fall through to subtype + LLM detection as before — that is the whole point of the LLM scan.
- **Card Detail → Risks tab "View Risk Register" button** now navigates to `/grc?tab=risk` instead of the dissolved `/ea-delivery?tab=risks` (which redirected to the EA Delivery report and stripped the query param, landing the user on the wrong page).
- **Compliance scan no longer silently widens to all regulations** when the caller-supplied filter resolves to an empty list (typo, or admin disabled the regulation). It returns a no-op summary tagged with `skipped_reason="no_matching_enabled_regulations"` so the run record completes cleanly without an unintended LLM fanout.
- **`ComplianceFindingOut.decision` Pydantic default** is now `"new"` (the post-migration-081 lifecycle starting state) instead of the legacy `"open"`. The accompanying `ComplianceFindingDecisionUpdate` docstring lists the actual lifecycle states with a pointer to `compliance_lifecycle_allowed`.
- **`GET /security/compliance` hides `auto_resolved=True` rows by default** (mirrors the per-card endpoint). Old rows stuck at `auto_resolved=True` from pre-PR-#536 scans no longer surface as live findings until the next scan clears them. Pass `include_auto_resolved=true` to opt into the audit-trail view.
- **Hardcoded hex literals in newly-introduced GRC and Regulations admin files** replaced with the matching theme tokens (`brand.primary`, `SEVERITY_COLORS.high`, `surface.light.paper`, `CARD_TYPE_COLORS`). Removes the duplicate `CARD_TYPE_HEX` map in `ComplianceFilterSidebar`.

## [1.11.0] - 2026-05-13

The fixed list of 6 compliance regulations is gone. Admins can now CRUD compliance frameworks from a new **Regulations** tab under Admin → Metamodel, enable/disable individual frameworks (defaults can be disabled but not deleted), and add their own (internal control policies, sector regulations like HIPAA, etc.). The Compliance register, manual finding entry, and risk promotion now work even when no AI provider is configured.

### Added
- **`/metamodel/compliance-regulations` CRUD** (GET / POST / PATCH / DELETE). Backed by a new `compliance_regulations` table (key, label, description, is_enabled, built_in, sort_order, translations JSONB). Built-in regulations can be edited and disabled but never hard-deleted; custom regulations can be deleted. Read access is open to any authenticated user; writes require `admin.metamodel`. Migration `082_compliance_regulations` creates the table and seeds the 6 historical defaults (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001) with `built_in=True`. `seed_metamodel` mirrors the seed for fresh DBs that come up via `create_all`.
- **Regulations tab under Admin → Metamodel.** Card-list UI with create / edit dialog, enable / disable switch, per-locale label translations, and a "built-in" chip on the protected defaults. The description field is the assessment-scope text that the AI scanner consumes — admins never write raw prompts.
- **`useComplianceRegulations` singleton hook** (inflight-promise pattern, mirrors `useBpmEnabled` etc.) with `enabled` / `byKey` selectors and a top-level `invalidateComplianceRegulations` for bootstrap priming.
- **`/settings/bootstrap` now returns `compliance_regulations`** so the Security tab, manual finding dialog, and compliance register get the dynamic list on first paint, with zero extra round-trips.

### Changed
- **Compliance scanner reads from the DB**, not hard-coded constants. `assess_regulation()` builds its prompt from the regulation's label + description, and `run_compliance_scan()` iterates the union of enabled regulations × the optional request filter. Adding a new regulation in the admin UI is enough to include it in the next scan.
- **`GET /security/compliance` rollup is orphan-tolerant.** It now returns one bundle per (enabled regulation ∪ regulations with findings), carrying `label`, `is_enabled`, and `is_known` flags so the frontend can render disabled regulations and orphan findings under muted tabs. Historical findings are never hidden when a regulation gets disabled or deleted.
- **`POST /turbolens/security/compliance-findings` accepts any DB-known regulation** (enabled or disabled), not just the old 6-key tuple. Adding custom regulations now flows through to manual finding entry automatically.
- **TurboLens Security tab gates the scan triggers on AI being configured**, but the compliance register, manual create-finding dialog, risk promotion, and CSV export remain available without AI. The page now shows an inline notice instead of pretending scans are runnable.
- **Compliance heatmap, scan picker, register tabs, manual-create dialog, finding detail drawer, and card-detail Compliance tab** all resolve regulation labels from the singleton hook with i18n fallback for the 6 built-ins, so custom regulations show their admin-set label and any locale translation.
- **Frontend `RegulationKey` is now a free `string`** instead of a 6-key literal union, reflecting the dynamic nature of the list.

### Removed
- `SUPPORTED_REGULATIONS`, `REGULATION_LABELS`, `REGULATION_PROMPTS` constants from `app/services/turbolens_security.py` and `app/schemas/turbolens.py`. The hard-coded `REGULATIONS` array on three frontend files (`TurboLensSecurity.tsx`, `CreateComplianceFindingDialog.tsx`, and the inline tab list) is gone.

### Fixed
- **Re-scan no longer destroys hand-curated state.** `run_compliance_scan` used to (a) overwrite the body of every re-emitted finding with the new AI output and (b) force-transition every finding the new scan didn't re-emit to `decision="verified"` + `auto_resolved=True` — which silently wiped manual findings, acknowledged decisions, severity overrides, and any handwritten gap / evidence / remediation. Re-scans are now minimal-touch: a re-emitted row only updates `last_seen_run_id` / `run_id`; body and decision are never modified. Verifying / closing remains a user decision via the lifecycle workflow.
- **Re-scan no longer hides findings the LLM didn't re-emit this run.** Previously, any finding absent from the new scan got `auto_resolved=True` and disappeared from the default Compliance grid filter — combined with LLM non-determinism, the visible-finding count silently shrank every scan. The auto-resolve transition is now removed entirely. Every existing row in the scanned regulations is explicitly cleared to `auto_resolved=False` on each scan, which also un-sticks rows stuck at `auto_resolved=True` from older scans run against the previous logic.

## [1.10.0] - 2026-05-12

Full introduction of the **GRC** (Governance, Risk and Compliance) module — a new classically-named top-level home that consolidates governance concerns previously scattered across `/ea-delivery` and TurboLens. The same release dissolves the legacy `/ea-delivery` page, lifts SoAW management onto the Initiative card, relocates the Initiatives workspace under **Reports › EA Delivery**, and makes compliance findings **stateful** with a per-finding decision workflow so reviewer decisions and risk-promotion back-links survive re-scans.

### Added
- **New `/grc` top-level module with three tabs: Governance · Risk · Compliance.** Reachable from the main nav. Each tab is URL-driven (`?tab=…`) so deep links and browser back/forward work. Permission-gated on the new `grc.view` key.
- **Governance subtabs** (URL-driven `?sub=…`): **Principles** (read-only render of active EA Principles, pulled from `/metamodel/principles`), **Decisions** (full ADR grid with the «New decision» button, pulled from `/adr`). Both panels lazy-load and share the same suspense fallback.
- **Risk tab** embeds the existing TOGAF Risk Register (`RiskRegisterPage`) unchanged. New route `/grc/risks/:id` replaces `/ea-delivery/risks/:id` for risk detail; legacy URLs redirect.
- **Compliance tab** embeds the existing CVE + Compliance scanner (formerly TurboLens > Security & Compliance). EU AI Act / GDPR / NIS2 / DORA / SOC 2 / ISO 27001 coverage, semantic AI detection, risk-promotion flow — all unchanged, just relocated to the conceptually correct home. The Compliance tab is gated on an AI provider being configured.
- **SoAW tab on the Initiative card.** Visible on every `card.type === "Initiative"` card detail, slotted right after Card (matches the BPM Process Flow tab pattern). Lists this initiative's SoAWs with title, status chip, revision number and updated-at; per-row Open / Preview / Delete actions. The **New SoAW** button reuses the same `CreateSoAWDialog` as the EA Delivery report, pinned to the current initiative.
- **`CreateSoAWDialog` is now a standalone, reusable component** (`features/ea-delivery/CreateSoAWDialog.tsx`). Lifted out of the deleted EADeliveryPage so the same dialog powers the SoAW tab (pinned via `fixedInitiativeId`) and the EA Delivery report (free choice).
- **EA Delivery Report at `/reports/ea-delivery`.** The hierarchical Initiatives + Diagrams + ADRs + SoAWs workspace lives here now, surfaced from the **Reports** dropdown in the top nav. Same data, same `InitiativesTab` component, leaner shell.
- **New permission group `grc`** with two keys: `grc.view` (gate the module, granted to `viewer`, `member`, `bpm_admin`, `admin`) and `grc.manage` (granted to `member`, `bpm_admin`, `admin`). Risk and Compliance subtabs continue to honour the existing `risks.view` / `risks.manage` / `security_compliance.view` / `security_compliance.manage` permissions on top of `grc.view`. Migration `077_grant_grc_default_roles` follows the canonical `069_grant_costs_view_default_roles` pattern: existing role rows get the new keys merged in via `jsonb_build_object`; custom roles untouched.
- **Decision workflow on every compliance finding.** Each row now carries a `decision` value (`open` / `acknowledged` / `accepted` / `risk_tracked` / `auto_resolved`) plus reviewer, timestamp, and rationale fields. Users can **Acknowledge** (reviewed, no action) or **Accept** (explicit decision not to remediate, rationale required) directly from the finding card. Promoting a finding to a Risk automatically transitions it to `risk_tracked`.
- **Findings survive re-scans.** `run_compliance_scan` now upserts by a stable `finding_key` (hash of scope + card + regulation + article + first-200-chars-of-requirement) instead of deleting and re-inserting. Decisions, reviewer metadata, and `risk_id` back-links are preserved. Findings the new scan no longer reports get flagged `auto_resolved=true` (with the original `risk_id` intact) so the audit trail stays coherent.
- **`PATCH /turbolens/security/compliance-findings/{id}`** — sets the decision and optional review note. `accepted` requires a rationale. `risk_tracked` and `auto_resolved` are not user-settable. Guarded by `security_compliance.manage`.
- **`GET /cards/{id}/compliance-findings`** — list compliance findings scoped to a single card, ordered by severity. Supports `?include_auto_resolved=true` to surface historical rows.
- **Filter bar on the GRC Compliance tab** with toggle chips for compliance status, severity, decision; an *AI-detected only* checkbox; and an *Include auto-resolved* checkbox. Defaults show all active findings per regulation subtab. Heatmap drill-through still works as a transient pre-filter that can be cleared inline.
- **Side card panel** opens when you click a card name in a compliance finding — reuses the existing `CardDetailSidePanel` already used by Inventory, Dependencies, BPM, and most reports. No more leaving the Compliance view to inspect a card.
- **New Compliance tab on the Card Detail page** (gated by `security_compliance.view`). Lists every compliance finding linked to that card with regulation, article, status, severity, decision, and the same Acknowledge / Accept / Create risk / Open risk actions as the GRC tab. Mirrors the existing Risks-on-a-card pattern.
- **Migrations** — `077_grant_grc_default_roles` grants the default GRC role permissions; `078_compliance_finding_durability` adds `finding_key`, `decision`, `reviewed_by`, `reviewed_at`, `review_note`, `last_seen_run_id`, and `auto_resolved` columns to `turbolens_compliance_findings`, backfills `finding_key` for every existing row using the same recipe as the runtime upsert, and marks rows already promoted to a Risk as `decision = "risk_tracked"`.
- **i18n** — new `grc` namespace with full translations across all 8 locales (en/de/fr/es/it/pt/zh/ru). New `reports.eaDelivery` and `cards.tabs.soaw` keys added to `nav.json` and `cards.json` for the relocated surfaces. New compliance decision / filter / action labels added to `admin.json` and the new `compliance.cardTab.*` group plus `tabs.compliance` added to `cards.json`, all replicated across the 7 non-English locales.
- **Compliance findings AG Grid.** The GRC Compliance tab now renders findings in a compact AG Grid (severity, status, article, card, requirement, decision, AI flag) with a **Group by card** toggle that sorts adjacent rows by impacted card and renders a divider between clusters. Row click opens a left-anchored Finding details drawer with full body, evidence, gap, remediation, and inline acknowledge / accept / reopen actions. The drawer's «Open impacted card» button swaps the slot to the existing `CardDetailSidePanel` — only one drawer is ever shown at a time (clicking outside closes it).
- **Right-collapsing filter sidebar on the GRC Compliance tab** (`ComplianceFilterSidebar`) follows the same expandable-rail pattern as `InventoryFilterSidebar`. Hosts the status / severity / decision / card-type chip filters plus *AI-detected only* and *Include auto-resolved* toggles. The previous inline filter Paper was retired.
- **`hasAiFeatures` (Yes/No) attribute** on both **Application** and **IT Component** card types, in the *Application Information* / *Component Information* sections respectively. Translated into all 8 locales via `seed.py`. Migration `079_add_has_ai_features_field` appends the field idempotently to existing `card_types.fields_schema` rows so admin customisations are preserved.
- **`POST /turbolens/security/compliance-findings/{id}/ai-verdict`** captures the user's verdict on the scanner's AI detection: **Confirm** writes `hasAiFeatures=true` on the impacted card, **Reject** writes `false`. Both stamp the finding as `acknowledged` with `AI verdict: confirmed|rejected` as the review note. Requires `security_compliance.manage`. Surfaced in the new finding drawer as two prominent buttons that appear only when `ai_detected=true`.
- **Compliance scanner prompt now explicitly enumerates Applications *and* IT Components.** The semantic AI detector previously read App-centric; the rewritten prompt nudges the LLM to assess SaaS / PaaS / IaaS / software / AI Models / hardware equally, with examples covering LLM libraries, inference SaaS, and vector databases. The scan scope already included IT Components — this is a prompt-wording fix that improves recall on hidden AI inside components.
- **`card_type` on `ComplianceFindingOut`.** The server now returns the impacted card's type alongside `card_name`, enabling the new card-type filter and clearer drill-through. Backfilled in `_load_card_meta` (one query, used by every compliance read endpoint).
- **Compliance finding lifecycle.** Replaces the flat `decision` values with a real 5-state main path — `new → in_review → mitigated → verified` — plus side branches `risk_tracked / accepted / not_applicable`. The lifecycle is rendered inline in the Finding Detail drawer as a horizontal phase timeline (mirroring the Card Lifecycle visual in `LifecycleSection.tsx`): current phase haloed, gradient fill flows through every reached phase, side-branch state shown as an overlay badge, `auto_resolved=True` shown as a separate "Re-scan didn't see it" chip. Allowed forward transitions render as inline action buttons under the timeline.
- **`Risk → Finding` back-propagation.** New `app.services.compliance_risk_sync.propagate_risk_to_findings` is called from `PATCH /risks/{id}` (on status change) and `DELETE /risks/{id}`: when a linked Risk moves to `mitigated`/`monitoring`, the finding becomes `mitigated`; `closed` → `verified`; `accepted` → `accepted` (with the Risk's `acceptance_rationale` copied into the finding's `review_note`); deleting the Risk re-opens the finding to `in_review`. Idempotent and respects the existing 409 guard on direct-edits while a Risk is open.
- **Auto-resolved decoupled from lifecycle.** `run_compliance_scan` now treats `auto_resolved` as a pure boolean flag: when a re-scan no longer reports a finding, the row is flagged `auto_resolved=true` and the lifecycle transitions to `verified` (unless `risk_tracked`, in which case the linked Risk owns closure). A re-surfaced auto-resolved finding flips back to `in_review` so a human re-checks.
- **`COMPLIANCE_LIFECYCLE_COLORS`** added to `frontend/src/theme/tokens.ts` alongside `COMPLIANCE_LIFECYCLE_MAIN_PATH` / `_SIDE_BRANCHES` — the lifecycle visual sources colours from tokens, never hex.
- **Compliance grid: group-by-card on by default + per-user persistence** via a new `turboea_grc_compliance_prefs` localStorage key (mirroring the Inventory page's `loadPrefs/savePrefs` pattern). The Card column is pinned left and emphasised on the first row of each cluster.
- **Compliance filter sidebar: checkboxes, not coloured chips.** Status / Severity / Lifecycle / Card-type filters all render as `List + Checkbox` rows with a small coloured dot before the label — the "selected vs unselected" affordance is now obvious, and the Inventory sidebar's pattern is mirrored exactly.
- **Migration 081** rewrites old `decision` values to the new lifecycle: `open → new`, `acknowledged → in_review`, `auto_resolved → verified`. `accepted` and `risk_tracked` keep their meaning. Idempotent.
- **i18n** — new lifecycle labels + help strings + grid/filter labels across all 8 locales; old `_open` / `_acknowledged` / `_auto_resolved` keys removed.
- **AG Grid parity with Inventory (Risk + Compliance).** The two GRC grids now mirror the Inventory grid's configuration exactly: `defaultColDef = { sortable, filter, resizable }`, no pagination, no row/header height overrides, AG Grid's native `loading` overlay (no centred `CircularProgress`), no custom `overlayNoRowsTemplate`, `getRowId` + `getRowStyle` (closed/accepted risks dim, auto-resolved findings dim), per-user `sortModel` persisted to localStorage. The Risk filter sidebar gains the Filters / Columns tabbed header that the Compliance sidebar already has; locked columns (Reference / Title / Initial level for Risk; Card / Severity / Requirement for Compliance) can't be hidden. Per-grid prefs keys: `turboea_grc_risks_prefs`, `turboea_grc_compliance_prefs`.

### Changed
- **TurboLens loses its Security & Compliance tab.** The tab and its label have been removed from `TurboLensPage.tsx`; the component itself (`TurboLensSecurity.tsx`) is untouched and is now consumed by the GRC Compliance tab. Permissions, API routes (`/api/v1/turbolens/security/*`), and CVE / compliance scan history are unchanged. Bookmarks to `/turbolens?tab=security` will silently land on the default Dashboard tab — point users to `/grc?tab=compliance` instead.
- **`/ea-delivery` page dissolved.** The route now `301`-redirects to `/reports/ea-delivery`. EA Delivery is no longer a top-level nav item; it appears as a child entry under the **Reports** dropdown (`reports.eaDelivery` key in `nav.json`). When PPM is disabled, EA Delivery is promoted back to a top-level nav item to preserve discoverability.
- **Risk components physically moved** from `features/ea-delivery/risks/` to `features/grc/risk/` via `git mv` so blame is preserved. All consumer imports (App.tsx, GrcPage.tsx, GrcPage.test.tsx, RisksTab.tsx, TurboLensSecurity.tsx, security.test.ts) updated. `RiskDetailPage`'s back-navigation switches from `/ea-delivery?tab=risks` to `/grc?tab=risk`.
- **Legacy risk routes redirect** to their GRC successors: `/ea-delivery/risks` → `/grc?tab=risk`, `/ea-delivery/risks/:id` → `/grc/risks/:id` (preserving the id via a small wrapper). Existing bookmarks survive transparently.
- **SoAW and ADR editor routes** (`/ea-delivery/soaw/:id`, `/ea-delivery/adr/:id`) are unchanged. The files still live in `features/ea-delivery/` — they're SoAW / ADR editors, not EA Delivery page artefacts. Moving them was out of scope for this release.
- **`promote_compliance_finding`** now stamps `decision="risk_tracked"`, the reviewing user, and the review timestamp on the finding alongside the existing `risk_id` link. Promotion is still idempotent — a re-promote returns the existing Risk.

### Removed
- **`features/ea-delivery/EADeliveryPage.tsx`** (939 lines) and its 23 test cases have been deleted. The tab-switching shell + principles/decisions/ADR-list code paths are no longer needed (those tabs are now in `/grc`). The Initiatives workspace logic was rewritten lean (~330 lines) as `features/reports/EaDeliveryReport.tsx`.

### Notes
- **Docs and screenshots** for the relocated surface (`/reports/ea-delivery` + the SoAW tab on Initiative cards, plus the new `/grc` module) are deferred to a follow-up — the user-visible end state stabilises with this release, so the docs refresh can land in a single docs-only PR without churn.
- **CVE findings still wipe and re-insert on each scan.** They already have an independent `status` workflow, so risk-promotion loop-back is only partially affected. Applying the same `finding_key` upsert pattern is a clean follow-up; flagged for a later PR rather than expanded here to keep the change focused.

## [1.9.1] - 2026-05-12

### Fixed
- **Pending Invitations list now tracks who has actually accepted the invite** (#539). Pre-fix, the row never went away — every install accumulated stale invitations for active users. The new semantics: an invitation is *pending* until the user signs in for the first time (`users.last_login IS NULL`). Three cooperating changes close the gap:
  1. **`GET /users/invitations` filter** uses `last_login IS NULL` as the «pending» criterion. An admin who has set a password on the user's behalf (`PATCH /users/{id}`) has not *accepted* anything — the row stays on the list so admin can still resend. Once the user signs in, the row disappears.
  2. **`POST /auth/login`** marks the user's `last_login` (existing behavior) and now also drops the matching SsoInvitation row on first login.
  3. **`POST /auth/set-password`** (legacy email-link path) now sets `last_login` in addition to deleting the matching SsoInvitation — set-password effectively logs the user in by returning a token. The SSO callback was already deleting on the relevant branches.

### Changed
- **`PATCH /users/{id}` no longer drops the SsoInvitation when admin sets a password.** Admin setting credentials on the user's behalf is *not* acceptance — the user still has to sign in. The endpoint continues to clear `password_setup_token` so the legacy email setup link can no longer overwrite the admin-chosen password.
- **Password is mandatory when creating a local account** (SSO disabled). `POST /users` now returns 400 if `password` is omitted and SSO is not enabled. The old "leave password blank to send a setup link by email" flow was a footgun: it created a User in a pending-setup state with no clean acceptance path. SSO-enabled installs are unaffected — admins can still invite a user without a password and let them sign in via SSO.
- **Login error no longer points to a non-existent email setup link.** When a local account has no `password_hash`, `POST /auth/login` now returns a generic 401 (instead of *"Password not set yet. Check your email for the setup link."*, which referenced a flow that no longer exists for new accounts).
- **Invite email template simplified.** The branch that sent a "click here to set your password" link is removed — when SSO is enabled the email points users to sign in, when SSO is disabled it confirms the password has been set by the admin.
- **Frontend invite dialog requires a password when SSO is disabled** — the password field is marked required, blocks submit on empty, and the help text reflects the new flow in all 8 supported locales.
- **SSO-mode invites without a password now set `auth_provider="sso"` on the new User** (was `"local"` by default). Without this, the SSO callback's "link existing user" branch refused to attach a `sso_subject_id` with the `auth_provider == "local"` guard, so invited users could never actually accept the invitation. Local-mode invites (password supplied) still get `auth_provider="local"` as before.

### Backend
- **Migration `076_purge_stale_sso_invitations`** — one-shot cleanup that deletes `sso_invitations` rows whose email matches a User who has actually signed in at least once (`last_login IS NOT NULL`). Removes the bloat accumulated by every install that ran on the pre-fix code paths, while keeping invitations visible for users whose accounts admin pre-provisioned but who never logged in. Idempotent (re-running drops nothing the second time); downgrade is a no-op since deleted invitations can't be reconstructed.

## [1.9.0] - 2026-05-12

**Provider / Consumer roles on Application↔Interface relations.** An
Interface is a contract between two Applications — a Provider and a
Consumer (with Bidirectional as the peer case). Turbo EA now models
this explicitly without splitting the metamodel.

### Added
- **Application role attribute** on `relAppToInterface`
  (Provider / Consumer / Bidirectional). Stored in
  `relations.attributes.flowDirection` to keep the storage schema
  neutral; surfaced in the UI as canonical EA role terminology.
- **Role-bucketed relation list** on the Interface card detail:
  `relAppToInterface` relations are split into "Provider Applications"
  and "Consumer Applications" sub-sections (Bidirectional apps appear
  in both). The same split applies in reverse on the Application card
  ("Provided Interfaces" / "Consumed Interfaces"). Unspecified
  relations get their own bucket so existing data isn't hidden.
- **Inline editor** on every relation row: a directional Material
  Symbol (`arrow_forward`, `arrow_back`, `sync_alt`) appears once a
  role is set; an unset dashed placeholder invites the user to assign
  one. Click to edit in a popover.
- **Optional details section** in the Add Relation dialog and in the
  diagram-side Relation Picker — appears only when the chosen relation
  type carries a schema, never blocks creation.
- **Dependency diagram (LDV) honours direction**: each
  Application↔Interface edge renders with arrowheads matching the
  Provider / Consumer / Bidirectional role, and the edge label is
  prefixed with `→`, `←`, or `↔` so the meaning is readable on
  monochrome print.

### Changed
- `relInterfaceToDataObj` no longer carries the flow-direction
  attribute. A DataObject is the payload an Interface transfers, not
  a direction-bearing endpoint.

### Backend
- Migration `074_relation_flow_direction.py` seeds the attribute on
  `relAppToInterface` using the guarded-UPDATE pattern, so
  admin-customised relation types are not overwritten.
- Migration `075_drop_flow_direction_from_interface_dataobj.py`
  reverses the equivalent change on `relInterfaceToDataObj`, again
  guarded so admin additions are preserved.
- `/reports/dependencies` edges now include `attributes` so the LDV
  can read `flowDirection` per edge.

## [1.8.0] - 2026-05-12

Diagramming overhaul — LeanIX-inspired UX on top of the embedded DrawIO editor.

### Added
- **Insert Cards dialog** with type chips, counts, search, and multi-select (with *Insert all* confirm past 50 results).
- **Per-relation-type Expand menu** on every card with three sections: *Show Dependency* (multi-select), *Drill-Down*, *Roll-Up*. Counts come from one `GET /cards/{id}/relation-summary` round-trip.
- **Drill-Down** turns a card into a swimlane container holding its picked children.
- **Roll-Up** wraps the current card + selected siblings inside a new parent container.
- **Right-click actions**: *Change Linked Card*, *Unlink Card*, *Link to Existing Card*, *Convert to Card*, *Convert to Container*.
- **View perspective dropdown** that recolors cells by card type (default), approval status, or any single-select field on the types currently on the canvas. Persists in `diagram.data.view` with a floating legend.
- **Hierarchy on canvas**: drag-in/drag-out of a same-type container prompts to attach/detach via `parent_id`; cross-type drops snap back; confirmed moves queue in a *Hierarchy Changes* bucket in the Sync drawer.
- **Robustness**: beforeunload warning when work is unsynced, local autosave every 5 s with restore prompt on reopen, louder "N unsynced" toolbar pill.
- **Edge-delete confirmation dialog** for edges carrying a real `relationId`. *No* re-inserts the edge in place.

### Changed
- **Card removal is visual-only.** Deleting a card from the canvas no longer prompts to archive; the card stays in inventory and its connected relation-edges silently disappear with it. Hand-drawn arrows are never auto-removed.

### Fixed
- Copy/paste of a synced card now deduplicates reliably.
- Edge deletions between expanded cards now open the confirm dialog.
- Restoring an autosaved draft no longer grey-stubs cards or strips chevron overlays.
- Drill-Down / Roll-Up / Show Dependency skip neighbours already on the canvas instead of duplicating them.
- Roll-up / drill-down are blocked when they would create a duplicate parent container.
- Collapse, restore, and container-delete no longer trigger stray "delete this relation?" dialogs.
- *Link to Existing Card* now works on plain DrawIO shapes drawn from the toolbar.
- *View Card Details* is hidden on unsynced cells.

### Backend
- `GET /cards/{id}/relation-summary` — per-relation-type counts + hierarchy block for the Expand menu.
- `GET /cards/counts` — per-card-type ACTIVE counts for the Insert dialog's type chips.
- `GET /cards?ids=…` — batch fetch by UUID list (used by the view-perspective recolor pass).
- Synced relation edges persist `relationId` so canvas-side deletes can issue the right `DELETE /relations/{id}`.

## [1.7.0] - 2026-05-11

### Added
- **Macro Capabilities — a new executive-level tier above L1.** The Capability Catalogue now consumes the `_macro-capabilities` artefact introduced in [`turbo-ea-capabilities` PR #85](https://github.com/vincentmakes/turbo-ea-capabilities/pull/85) (wheel `2026.5.11.505`). Cross-Industry ships 9 macros (MC-10 … MC-90) that partition its 41 L1s; any industry that adds macros later is picked up automatically. Macros render as a top tier above L1 in the catalogue browser, can be imported into the inventory as parent BusinessCapability cards, and their `capability_ids` rewrite the `parent_id` of the L1s they group so the import lands an instant Macro → L1 → L2 → L3 hierarchy. Existing standalone L1 imports are auto-relinked under the new macro on a subsequent macro import — surfaced in the existing `relinked` bucket of the import response.
- **`Macro` option on the BusinessCapability `capabilityLevel` enum**, with translations for all 8 locales. New imports get `capabilityLevel="Macro"`; pre-existing L1s keep `"L1"` even after relink. Migration `073` adds the option to existing installs.

### Changed
- **`BusinessCapability` hierarchy depth limit is now 6 for macro-rooted chains** (Macro → L1 → L2 → L3 → L4 → L5). Non-macro chains keep the prior 5-level cap unchanged. The macro-aware depth math in `cards._sync_capability_level` and `cards._check_hierarchy_depth` subtracts 1 from the chain depth when the root carries `capabilityLevel="Macro"`, so an L1 reparented under a macro stays `"L1"` and a 5-level descendant subtree under a macro still passes the depth gate.
- **Capability catalogue sort is now prefix-family-aware.** `MC-` ids always sort before `BC-` ids inside the catalogue browser; numeric ordering inside each family is unchanged (`BC-1.10` after `BC-1.9`, `MC-90` before `MC-100`). Without this the old comparator NaN-sorted any non-`BC-` id.
- **`CapabilityMapReport` recognises macros as level-0 roots,** so the "Level 1" / "Level 2" dropdown labels each tier correctly when macros are present (without this, every label would silently shift one slot).
- **Pinned `turbo-ea-capabilities>=2026.5.11.505`** in `backend/pyproject.toml` so installs pick up the macro artefact.

## [1.6.3] - 2026-05-10

### Performance
- **Inventory boot is materially faster — second pass.** Real-world HAR capture revealed that even after the 1.6.1 bootstrap work, navigating to `/inventory` still fanned out to ~13 boot-time GETs. Two follow-up fixes close that:
  - **`/ai/status` is now a singleton hook.** Four components (`CardDetailSidePanel`, `CreateCardDialog`, `CardDetail`, `PortfolioReport`) used to each fire their own `api.get("/ai/status")` from a bare `useEffect`; on Inventory all three concurrent mounts produced three duplicate requests per page load. They now share `useAiStatus()` with the same `_cache` + `_inflight` + `_listeners` pattern as the sibling singleton hooks, so all consumers attach to one fetch. Top-level `invalidateAiStatus(value?)` export mirrors the sibling hooks for cache invalidation after admin edits.
  - **`primeBootstrap()` is now awaited** in `useAuth.loadUser` before the authenticated UI mounts. Previously it was fire-and-forget, so every per-hook fallback fetch (`/settings/date-format`, `/settings/app-title`, `/settings/bpm-enabled`, `/settings/ppm-enabled`, `/settings/enabled-locales`, `/settings/currency`) raced bootstrap and fired its own `GET` because the singleton cache was still empty when the component mounted. Awaiting bootstrap adds one round-trip to first paint after login but eliminates seven redundant boot fetches that race on every page navigation. On a slow-DB instance this is a large net win; on a healthy backend it's invisible.

## [1.6.2] - 2026-05-10

This release is a stress-test pass: shaking out a real-world large-dataset workflow (the bundled 9329-entry capability catalogue plus thousands of demo cards on a real Unraid install) surfaced two unrelated UI regressions where bulk frontend operations fanned out an unbounded number of parallel HTTP requests. Both are fixed here, plus a third unrelated regression to the `BusinessProcess` card-type colour spotted along the way.

### Fixed
- **Catalogue imports no longer crash on large selections.** Importing more than 2000 entries from the Capability / Process / Value Stream catalogue used to fail with a 422 (the backend caps `catalogue_ids` at 2000 per request, and the UI sent everything in one shot — selecting all 9329 capabilities reliably blanked the dialog and tripped the React error boundary). The frontend now batches the selection into chunks of 500 and POSTs them sequentially with a per-batch progress bar; partial failures preserve already-committed batches and report how far the import got.
- **Bulk archive / bulk delete no longer trip Chrome's `ERR_INSUFFICIENT_RESOURCES` or report cascade-race responses as failures.** The Inventory used to dispatch one parallel `POST /cards/{id}/archive` (or `DELETE /cards/{id}`) per selected card; with thousands of cards Chrome's per-origin socket pool exhausted before the requests left the browser. Two intermediate frontend workarounds (a 5-worker queue, then a "treat 400/404 as idempotent" adapter) didn't fully solve it because the per-card endpoints aren't designed to compose into a coherent batch. **New approach: server-side `POST /cards/bulk-archive` and `POST /cards/bulk-delete` endpoints** that take the full id list and process it in a single database transaction — no parallel HTTP fan-out, no cascade race (parent + descendant in the same input both end up in the desired state because they're resolved together), no per-card retry logic on the client. The frontend dialog now makes one round-trip per bulk action instead of N. Skipped items (already-archived, missing, etc.) are reported in a structured `skipped` list rather than as errors.

### Added
- **Mass restore from Inventory.** When viewing archived cards (filter "Show archived") and selecting multiple, a *Restore* button now appears alongside *Permanently delete*. Backed by the new `POST /cards/bulk-restore` endpoint, which mirrors `bulk-archive` for the inverse operation: one transaction, structured `skipped` reporting (`already_active` / `not_found`), idempotent semantics. Works with selections of any size — the bulk endpoint caps each request at 10 000 cards.
- **`BusinessProcess` card type built-in colour restored to `#028f00`.** The seed default had drifted to `#e65100` (orange); existing installs on the original colour were unaffected, but any reseed picked up the wrong default. Migration `072` performs a guarded `UPDATE` on the `card_types` row only if its colour still matches the drifted value, so customers with the original colour or with admin-customised colours are left untouched. Hardcoded `#e65100` / `#8e24aa` fallbacks in `ProcessNavigator` and the dashboard activity stream were realigned to the new token, and the `CLAUDE.md` metamodel reference table (which had been wrong since the relationship-rework commit) plus `frontend/UI_GUIDELINES.md` were corrected.

### Changed
- **Built-in metamodel default convention.** `CLAUDE.md` now documents that editing a built-in card type's `color` / `icon` / `label` in `seed.py` has zero effect on existing installs (the seed only inserts missing rows), and that any such change must be paired with a guarded `UPDATE` migration. `072_restore_business_process_color.py` is the canonical pattern.

## [1.6.1] - 2026-05-10

### Performance
- **App boot is materially faster.** Three independent fixes collapse the per-page-navigation chatter that used to dominate boot time on the inventory and dashboard pages.
  - Module-level singleton hooks (`useMetamodel`, `useDateFormat`, `useCurrency`, `useBpmEnabled`, `usePpmEnabled`, `useTurboLensReady`) had a race where multiple components mounting simultaneously each saw an empty cache and fired their own `GET`. They now share a single inflight promise, so concurrent first-callers attach to one fetch instead of N. The pattern is now documented in `CLAUDE.md` under Frontend Conventions so any new singleton hook follows it from the start.
  - **New `GET /api/v1/settings/bootstrap`** returns currency, date format, app title, BPM/PPM/TurboLens toggles, enabled locales, fiscal-year start, BPM row order, and the principles-tab toggle in one round-trip. The frontend calls it once after login (`useAuth.loadUser`) and primes each per-hook singleton cache via top-level `invalidate*` exports so first-mount components skip their own `GET`. Per-endpoint reads remain for selective refresh after admin edits. New boot-time public settings should be added to bootstrap rather than introducing another per-setting endpoint.
  - **Default-logo / default-favicon redirects now carry `Cache-Control: public, max-age=300`,** so browsers stop re-doing the round-trip on every page navigation. The static target was already cached by nginx; only the redirect step was un-cached.

### Security
- **Removed unused `gosu` binary from the bundled `db` image.** The upstream `postgres:18-alpine` image bundles a `gosu` binary built against an older Go stdlib that Trivy flags for 8 CVEs (`CVE-2026-33811`, `-33814`, `-39820`, `-39823`, `-39825`, `-39826`, `-39836`, `-42499`). `gosu` is only invoked by the entrypoint when running as root to drop privileges; our image runs as a fixed non-root UID, so the binary was never invoked at runtime. Deleting it during image build closes all 8 alerts without changing observable behaviour.

## [1.6.0] - 2026-05-09

### Upgrade notes

- **GHCR image users: pull the new `docker-compose.yml` too, not just the image.** The bundled `turbo-ea-capabilities` wheel grew significantly in this release (now 9329 capabilities + 1273 processes + 64 value streams), and the catalogue browsers exercise it on every visit. The default `BACKEND_MEMORY_LIMIT` was bumped from `512M` → `2G` to accommodate this. If you only run `docker compose pull && docker compose up -d` without also pulling the new compose file (or without removing an explicit `BACKEND_MEMORY_LIMIT=512M` from your `.env`), your container keeps the old 512M cap and may OOM-cycle on first hit to a catalogue page or any large `?page_size=` inventory request. The safe upgrade flow is:
  ```bash
  git pull              # picks up the new docker-compose.yml + .env.example
  docker compose pull   # pulls the new images
  docker compose up -d
  ```
  Symptoms of the old cap on the new image: `docker compose ps` shows `Up Xs (healthy)` flickering, `dmesg | grep oom` shows `Memory cgroup out of memory: Killed process … (uvicorn) anon-rss:5XXMB`, and the browser shows a wave of `502` errors on every endpoint. Bumping the cap to `1G` (or removing the `BACKEND_MEMORY_LIMIT` line entirely so the new `2G` default kicks in) resolves it.

### Added
- **Process Catalogue** at `/process-catalogue` — browse the bundled APQC-PCF business-process tree (Category → Process Group → Process → Activity, ~1200 entries) and import selected entries as `BusinessProcess` cards in bulk. Subtypes are derived from the catalogue level; hierarchy is preserved through `parent_id`. On import, `relProcessToBC` (supports) relations are auto-created to every existing `BusinessCapability` whose ID appears in the process's `realizes_capability_ids` (skipped silently when the target card hasn't been imported yet).
- **Value Stream Catalogue** at `/value-stream-catalogue` — browse the bundled value-stream library (Acquire-to-Retire, Order-to-Cash, Hire-to-Retire, …) and import streams + stages as `BusinessContext` cards (subtype Value Stream). Stages land as children of their parent stream; selecting a stage alone automatically pulls in the parent. On import, `relBizCtxToBC` (stage → capability) and `relProcessToBizCtx` (process → stage) relations are auto-created to every existing target.
- **`POST /process-catalogue/import`**, **`POST /value-stream-catalogue/import`**, plus the matching `GET` payloads and admin `update-status` / `update-fetch` endpoints. The wheel ships all three artefact types in a single download, so any one of the three "Fetch update" admin actions hydrates all three caches at the same time.

### Changed
- **Reference Catalogues section in the user menu is now collapsible** (Capability + Process + Value Stream + Principles) and starts collapsed by default to keep the menu compact. Open/closed state is persisted in `localStorage`. The drop-down now shows a chevron next to the section header.
- **Frontend catalogue UI generalised into `frontend/src/features/reference-catalogue/`** — `<CatalogueBrowser>`, `<CataloguePage>`, `IndustryFilter`, the CSS, and the types are shared across all three catalogues. The accent and selection colours are driven by CSS custom properties (`--tcc-accent`, `--tcc-selection`) so each per-catalogue page passes its brand colour without duplicating the stylesheet.
- **`turbo-ea-capabilities` minimum version bumped to `>=2026.5.10.494`** — first the move to `schema_version=2` (which ships `business-processes.json` + `value-streams.json` alongside `capabilities.json`), then the latest content drops. The bundled wheel now carries 9329 capabilities, **1273 processes** (up from 1211), and 64 value streams across all eight supported locales.
- **Backend catalogue services refactored**: cross-cutting concerns (PyPI fetch + wheel extraction, settings cache, locale resolution, BFS ordering, existing-card lookup) extracted to `backend/app/services/catalogue_common.py` so the three per-catalogue services stay focused on their own import semantics.
- **Backend default memory limit raised from 512M → 2G.** The bundled `turbo-ea-capabilities` wheel + the metamodel + optional demo seed sit around 250–500M at idle on x86 hosts, and request-time spikes (e.g. `?page_size=10000` inventory dumps, large bundled catalogue payloads, long-lived SSE connections) regularly cross the previous 1G ceiling, OOM-killing the backend mid-request under cgroup limits. The `BACKEND_MEMORY_LIMIT` env var is unchanged — set it back to 1G if you've disabled SEED_DEMO/SEED_BPM/SEED_PPM and rarely use the catalogue browsers, or 512M for the most aggressive tightening.

## [1.5.1] - 2026-05-08

### Changed
- **Archiving no longer permanently deletes cross-boundary peer relations.** When a card is archived without cascading to a peer, the `relations` row is now kept in the database and simply hidden from active views (the `GET /relations` filter, dependency reports, capability heatmap, RelationsSection, etc.) for as long as either end is archived. Restoring the card automatically re-exposes the row — no more re-linking by hand. Hard-delete and the 30-day auto-purge still clean up referencing rows, so archived-then-purged cards leave nothing behind. The `card.archived.batch` audit event no longer carries `severed_relation_count` since severance no longer happens.

### Fixed
- **iPhone-width layout regressions on the Card Detail side panel and EA Delivery → Initiatives tab.** The Card Detail side panel header now lets the data-quality / lifecycle / approval badges wrap to a second row on `xs` viewports so the title and subtype no longer truncate to "A…" / "p…". The EA Delivery page header wraps the "New artefact" / "New ADR" button to its own line on narrow viewports instead of overlapping the description text. The Initiatives tab swaps its 320 px sticky sidebar for a left-anchored MUI Drawer on `xs` so the workspace can use the full viewport width; the drawer auto-closes when an initiative is selected.
- **Restore dialog warning narrowed.** The cascade warning previously claimed both parent links *and* peer relationships had to be re-linked manually after restore. Peer relationships now come back automatically, so the copy was misleading; it now only mentions parent links severed by the disconnect / reparent strategies. Re-translated into all 8 supported locales (the previous string was English-in-every-file).
- **Inventory column picker — Type and Name are now always-on.** Deselecting the Type or Name columns broke row identification and downstream features in subtle ways. They now render as checked + disabled (greyed out) with an "Always visible" tooltip, and "Clear all" preserves them. Backwards-compatible: any saved column preferences that omitted them get them merged back in on load.
- **Inventory column picker — Tags column is now in the Default columns set.** The Tags column was rendered unconditionally and missing from the picker entirely, so users couldn't toggle it off and a default-column reset wouldn't bring it back if it had ever been hidden by a custom column profile. It is now exposed under Default columns alongside Type / Name / Path / etc., on by default, and a one-time migration adds it to existing users' saved column selection so they don't lose the column visually.
- **Inventory mass-selection toolbar overflowed on iPhone.** The Mass Edit / Archive / Clear Selection buttons sat in a fixed-gap flex row that wrapped text inside each button on narrow viewports ("Mass Edit" rendered as two stacked lines, etc.). The toolbar now wraps to multiple rows with `flexWrap`, the buttons keep their text on a single line via `whiteSpace: nowrap`, and the desktop layout is unchanged.
- **Inventory filter drawer no longer closes on every keystroke on iPhone.** The mobile drawer was wired to dismiss itself on any filter change, including each character typed into the search field. The drawer now stays open while the user filters; it dismisses via the backdrop, swipe, or the explicit collapse button.

## [1.5.0] - 2026-05-08

### Added
- **Archive and delete dialogs now ask what to do with children and related cards.** When archiving or deleting a card that has children (via `parent_id`), a strategy chooser appears with three options: archive/delete all descendants too (cascade), keep children as root cards (disconnect their `parent_id`), or move children up to the grandparent (reparent — hidden when no grandparent exists). When the card has peer relations, the same dialog lists every linked card grouped by relation type with checkboxes so the user can opt to archive/delete those cards in the same operation. Inventory bulk actions reuse the same dialog with a global toggle to also process every selected card's direct relations.
- **`GET /cards/{id}/archive-impact`** endpoint surfaces the children, grandparent, and peer relations the dialog needs in one round-trip. Hidden card-types and already-archived peers are filtered.
- **Restore dialog cascades back the bubble.** Restoring a card now offers a preview of the children and peer cards that were archived together with it (read from the latest `card.archived.batch` audit event). Each passenger has a checkbox; ticked passengers are flipped back to ACTIVE in the same operation. The same dialog also notes that severed parent links and peer relationships do not come back automatically — they have to be re-linked by hand.
- **`GET /cards/{id}/restore-impact`** endpoint lists the still-archived passengers from the latest archive batch.

### Changed
- **`POST /cards/{id}/archive`** and **`DELETE /cards/{id}`** accept an optional JSON body `{child_strategy, related_card_ids, cascade_all_related}`. The endpoints now return a richer response (`primary` + affected ID lists for archive; `deleted_card_ids` + affected ID lists for delete). Callers who omit the body but have direct children get **409 Conflict** with `{"error": "children_present"}` so they make a deliberate choice. Backwards-compatible when the card has no children.
- **`POST /cards/{id}/restore`** accepts an optional `{also_restore_card_ids: [...]}` body and returns `{primary, restored_passenger_ids}`. Existing callers that send no body still get a single-card flip.
- **APPROVED children whose `parent_id` is mutated by `disconnect` or `reparent` become BROKEN** — same rule as the existing manual `parent_id` edit.
- **Archive now severs every relation that crosses out of the archived set.** Peer rows between the archived card and a card that stays active are deleted. Rows between two cards that were archived together (cascade bubble + ticked peers) survive, so they reappear in the active landscape if both ends are later restored. The existing `disconnect`/`reparent` strategies already cleared `parent_id`; the relations table is now treated symmetrically.

### Fixed
- **Auto-purge no longer fails on cards that still have children pointing at them.** The hourly purge loop now disconnects any stranded children (`parent_id = NULL`) before deleting the parent, fixing a latent FK violation that would have hit historical data created before the new strategy chooser shipped.
- **Hard-deleting a card with children no longer fails with an integrity error.** The new cascade/disconnect/reparent flow handles the `cards.parent_id` self-FK properly.
- **`GET /relations` no longer returns rows whose source or target is archived**, mirroring the existing hidden-type filter. Defends against historical or manually-created rows that the new sever-at-archive rule didn't touch.

## [1.4.0] - 2026-05-08

### Added
- **EA Principles Reference Catalogue.** A curated set of 10 industry-standard EA principles (Reuse before Buy before Build, Prefer fully managed Services, Business value-driven Architecture, One capability One solution, Exit Strategy, TCO, Seamless Integration, Technical Debt, Legal & Regulatory Compliance, Security by Design) is now browsable from the user menu. Admins can multi-select entries and import them into the EA principles register; imports are idempotent — re-running an import skips already-imported entries and survives title edits via a sticky `catalogue_id`.
- **Reference Catalogues section in the user menu.** The Capability Catalogue and the new Principles Catalogue are grouped under a `REFERENCE CATALOGUES` section header in the avatar dropdown, mirroring how the `ADMIN` section is rendered.
- **Demo dataset now ships with 5 EA principles pre-seeded.** Running `SEED_DEMO=true` populates the first 5 catalogue principles so the NexaTech demo has a realistic principles landscape; the remaining 5 stay catalogue-only so users can test the import workflow.

### Changed
- **`ea_principles` table gains a `catalogue_id` column** (nullable, indexed) so principles imported from the catalogue carry a stable, locale-agnostic identifier independent of their display title.

## [1.3.0] - 2026-05-07

### Changed
- **EA Delivery — Initiatives tab redesigned as a two-pane workspace.** The previous vertical stack of expandable cards with a 3-column artefact grid is replaced by a left-side initiative tree (search + Status / Subtype / Artefacts filters + favourites, indented hierarchy with tree guide lines, synthetic "Unlinked artefacts" row at the top) and a right-side workspace that shows the selected initiative's deliverables, child initiatives, and details. The selection is URL-backed (`?initiative=<id>`), so refreshes and shared links preserve context. Cards/list view toggle removed in favour of the two-pane layout.

### Added
- **Single primary "+ New artefact" CTA on the EA Delivery page header**, with a dropdown for SoAW / Diagram / ADR. Each option pre-links to the currently selected initiative. Per-section "+ Add" buttons on empty deliverable groups give the same flow inline.
- **Diagram creation from the Initiatives tab.** Diagrams could previously only be linked from this tab, not created. The `+ New artefact ▾` menu now exposes "New Diagram", which opens the existing Diagrams create dialog (extracted to `CreateDiagramDialog` for reuse) pre-linked to the selected initiative and routes to the editor on save.

### Fixed
- **EA Delivery URL params no longer wipe each other.** Switching tabs preserved the `?tab=` param but the underlying setter was destructive — clicking a tab would silently drop any other query string (now used by the new `?initiative=` param). Replaced with a merge-style `updateParams` helper.

## [1.2.2] - 2026-05-07

### Fixed
- **AI description suggest available in card side panel.** The AI suggest icon in the Description section header was only wired into the full-page card view, so opening a card via the inventory eye-icon side panel hid the feature even when AI was enabled. The side panel now fetches AI status, exposes the suggest button under the same gating (AI enabled, edit permission, not archived, no pending suggestion), and renders the `AiSuggestPanel` above the tabs to apply or dismiss results.

## [1.2.1] - 2026-05-07

### Fixed
- **Demo saved views and saved reports.** Demo `BOOKMARK_DEFS` now use the `Filters` shape the inventory page actually reads (`types`, `subtypes`, `lifecyclePhases`, etc.) and column keys with their `core_` / `attr_` prefixes; demo `SAVED_REPORT_DEFS` configs now use the keys each report component's `consumeConfig` effect reads. Previously both loaded as no-ops because the shapes didn't match anything the frontend recognised. Backed by new `test_seed_demo` checks so future drift fails CI.
- **Survey response acceptance now writes a card.updated audit event.** Applying a survey response would silently update card attributes without leaving any trace in the History tab. The `apply_responses` endpoint now publishes a `card.updated` event with the same payload shape as the regular PATCH path plus a `source: "survey_response"` discriminator and the survey/response IDs.
- **History tab attribute changes now show field labels, not raw keys.** Card History was rendering attribute changes by their internal key (e.g. `attr_costTotalAnnual` for survey-driven updates, `costTotalAnnual` for PATCH updates) instead of the metamodel-defined label. `HistoryTab` now resolves attribute keys against the card type's `fields_schema` so users see "Total Annual Cost" — works for both the new `attr_X` survey payload format and the existing PATCH-attribute-snapshot format.

### Changed
- **Demo saved reports refreshed.** Replaced the Technology Lifecycle and Application Dependencies presets (which needed extra clicks to be useful) with two more interesting examples: **Application Portfolio by Organization** (apps grouped by the owning Organization, coloured by time model) and **Cost by Provider (Apps + IT Components)** (annual cost rolled up by vendor across related applications and IT components). Also fixed the existing **Application Portfolio Overview** preset, which used a bare attribute key for grouping (`businessCriticality`) instead of the prefixed form (`attr:businessCriticality`) the report writes when the user clicks Save — the preset now actually applies.
- **Dependencies view dark-mode readability.** Card-type colors used for node borders, type labels, and swim-lane labels are now lightened in dark mode so darker palette entries (BusinessCapability navy, DataObject purple, etc.) read cleanly against the dark paper. Applies to both the Layered Dependency View and the tree view inside the Dependencies report.
- **Dashboard chart tooltip text in dark mode.** Recharts tooltips now also pass `labelStyle` / `itemStyle` through the theme palette — without those, Recharts kept the default near-black text inside the dark-themed tooltip wrapper, so hover labels were unreadable.
- **ADR register row hover affordance.** Rows in `/ea-delivery` ADR list now show a pointer cursor and a stronger hover background, signalling that rows are clickable.
- **Diagram editor / viewer top toolbar hidden on iPad.** The Back / Edit / Sync bar at the top of the diagram pages was hidden / out of reach on iPad Safari while the URL bar was visible — `100vh` reports the larger layout-viewport size, which let the editor extend past the visible area. Switched the page-level height calc to `100dvh` (with a `@supports` fallback to `vh` for older browsers) so the editor tracks the actual visible viewport. Affects both `DiagramEditor` and `DiagramViewer`.

## [1.2.0] - 2026-05-07

### Added
- **Inventory: pop-out card detail side panel.** Each name cell now has an eye icon that opens a right-anchored side panel showing the card's full detail without leaving the inventory grid. Clicking the name itself still navigates to the full card page.
- **Inventory: separate Name and Path columns.** The Name column now shows just the card's own name; a new Path column shows the breadcrumb to the parent and is shown by default. Both columns can be toggled in the column selector.
- **Inventory column selector: Default columns section.** The previously always-visible columns (Type, Name, Path, Description, Subtype, Lifecycle, Approval Status, Data Quality) are now listed at the top of the column selector and can be deselected — useful for tightening a saved view to just the columns you need.
- **Import: read-only field warning.** Importing rows that supply values for read-only or calculated fields (e.g. `attr_capabilityLevel`) now surfaces a warning per row and skips the value rather than silently passing it through. The import still proceeds.

### Changed
- **Top-nav links open in a new tab on Ctrl/Cmd/middle-click.** Inventory, Reports, BPM, PPM, EA Delivery, the Reports submenu, the brand logo, the user-menu admin items, and a card's name in the Inventory grid now render as real anchors. Plain clicks behave as before.
- **Top-nav Create button.** Clicking Create now opens the Create Card dialog over the user's current screen instead of routing them to `/inventory?create=true` first. The previous URL still works for any saved deep links.
- **Export filenames include time.** XLSX/PPTX/DOCX/CSV exports for inventory, reports, SoAW documents, ADRs, and the cards CSV API now use a `YYYY-MM-DD_HHMM` local-time stamp so multiple same-day exports don't collide.

## [1.1.0] - 2026-05-06

### Added
- **Multi-select export of Architecture Decision Records to Word.** The Decisions tab on EA Delivery now has a checkbox column on the ADR grid; selecting one or more rows reveals an "Export to Word" button that generates a single styled `.docx` with a cover page, a table of contents (when more than one decision is selected), and one section per ADR containing reference, title, status, metadata, Context / Decision / Consequences / Alternatives, linked cards, and signatures. Useful for circulating the decisions taken during an architecture review meeting as a single deliverable.

## [1.0.9] - 2026-05-06

### Changed
- **Excel export/import is now portable across instances.** The export sheet replaces the per-instance `parent_id` UUID with a `parent_path` column (a `" / "`-separated chain of ancestor names, with `\` and `/` both escaped), inspired by LeanIX's LDIF approach. Import resolves the parent by walking that path against the target instance's hierarchy and falls back to the legacy `parent_id` column for same-instance round-trips. A source `id` that doesn't match any local card no longer hard-fails the row — it's demoted to a "create" with a warning so a full-dataset export drops cleanly into a fresh tenant. Empty required attributes on a create are also demoted from a blocking error to a warning, since the backend treats required fields as a data-quality signal rather than a hard constraint — incomplete source data now imports and is reflected in the card's quality score instead of stopping the whole migration. Ambiguous parent paths (siblings with identical names) emit a warning and pick the first match; users can still disambiguate by including the GUID column.

## [1.0.8] - 2026-05-06

### Security
- **Upgraded bundled pip in the `mcp-server` image too.** `1.0.7` patched the `backend` image but missed the optional `mcp-server` image, which is built from the same `python:3.12-alpine` base and shipped its own pip 25.0.1 — Trivy kept flagging `CVE-2025-8869`, `CVE-2026-1703`, and `CVE-2026-6357` against the published `mcp-server` image. The mcp-server stage now upgrades pip past `pip>=26.1` before installing the app, with the same rationale (pip is never invoked at runtime; this is purely scan hygiene).

## [1.0.7] - 2026-05-06

### Security
- **Triaged the second wave of Trivy findings: removed dead Java JARs from the drawio webapp, upgraded bundled pip past three CVEs, and extended the gosu allowlist with sixteen new Go stdlib advisories.** The frontend image is `nginx:alpine` (no JRE), so the upstream `WEB-INF/lib/*.jar` payload bundled by `jgraph/drawio` (commons-fileupload, commons-io, commons-lang3) was unreachable dead weight that Trivy kept re-flagging — it is now stripped during the `frontend` build. The backend image's bundled pip is bumped past `pip>=26.1` to clear `CVE-2025-8869`, `CVE-2026-1703`, and `CVE-2026-6357` even though pip is never invoked at runtime. Sixteen additional Go stdlib CVEs in the upstream `gosu` binary shipped by `postgres:18-alpine` (net/http, net/url, net/mail, net/textproto, html/template, encoding/asn1, encoding/pem, crypto/x509, crypto/tls, archive/tar, os.Root) are added to `.github/trivy-allowlist` with the same "gosu only does setuid+exec" rationale as the existing block — they cannot be rebuilt from this repo and land when postgres rebuilds against Go 1.25.9+ / 1.26.2+.

## [1.0.6] - 2026-05-06

### Changed
- **Deleting a user from the Users admin page now actually removes the row.** The delete handler used to flip `is_active = False` (soft delete), which made the user disappear from the table client-side but reappear on refresh because the list call requests `include_inactive=true`. The handler now hard-deletes; a new Alembic migration (`070_user_fk_ondelete_set_null`) adds `ON DELETE SET NULL` to every author / owner / assignee FK that pointed at `users.id` without an `ondelete` clause so the cascade works at the DB layer (and drops `NOT NULL` on `ppm_status_reports.reporter_id` and `process_assessments.assessor_id` so authorship can outlive the author). Tables already configured with `CASCADE` (stakeholders, comments, bookmarks, favorites, saved reports, notifications, survey responses) are unchanged. The "Disable login" action is unchanged — operators who want to retain an audit author can still deactivate instead of delete. The last active admin can no longer be deleted.

### Fixed
- **Invitation and test emails now use the configured installation name and stop naming the SSO provider.** The "You've been invited to …" subject and body, plus the SMTP test email, were hardcoded to "Turbo EA" instead of the admin-configured app title. The SSO variant additionally said "sign in with Microsoft" (or whichever provider was configured), which is misleading when the deployment is rebranded. All three variants now read from the configured app title and the SSO copy is provider-agnostic ("Click the button below to sign in").
- **SMTP failures during invitation send are no longer silent.** `email_service._send_sync` previously logged the SMTP exception and swallowed it, so `POST /users` always returned 201 even when the invitation never left the building (e.g. wrong `SMTP_USER` / `SMTP_PASSWORD` → `SMTPAuthenticationError`). The send helpers now propagate the underlying exception; the user-invite endpoint catches it, keeps the created user (since the row was already committed), and returns the SMTP error message back in the response under `email_error`. The Users admin page renders that as a warning banner so the admin sees "the account was created but the email could not be sent — fix SMTP and re-send" instead of a misleading success. The `POST /settings/email/test` endpoint now also returns the actual SMTP error message in its 502 body and 400s when SMTP isn't configured at all.

## [1.0.5] - 2026-05-06

### Changed
- **Bundled Ollama now exposes an `OLLAMA_KEEP_ALIVE` sample-env setting.** Operators can keep the selected AI model warm between requests by setting `OLLAMA_KEEP_ALIVE` in `.env` (for example `24h` or `-1` to keep it loaded indefinitely), instead of being limited to the upstream 5-minute default.

## [1.0.4] - 2026-05-06

### Fixed
- **Trivy publish workflow now actually runs.** The allowlist file added in `1.0.2` was named `.github/trivy-allowlist.yaml`, but Trivy 0.65+ infers the ignorefile format from the extension — `.yaml` triggers the YAML schema parser, which fails on bare `CVE-XXXX-YYYYY` lines (`yaml decode error: cannot unmarshal !!str into result.IgnoreConfig`). Trivy aborted before producing the SARIF, breaking the publish for all five images. Renamed to `.github/trivy-allowlist` (no extension → plain-text parser) and added an inline note in the file header so future renames don't regress this.

## [1.0.3] - 2026-05-06

### Fixed
- **Surveys can now target a single specific card.** A new "Specific cards" filter in the Survey Builder lets admins pick one or more exact target cards (filtered to the chosen card type), alongside the existing "Cards related to" relation-based filter. Previously the only card picker was the relation filter, so picking a single card silently excluded it (the resolver looked for cards *related to* it, not the card itself), producing zero recipients.
- **Survey response form now shows translated labels instead of raw keys.** The card type chip, subtype chip, section names and select-option values displayed under "Current value" are now resolved through the metamodel's translations. The backend `respond` endpoint enriches the survey snapshot with the live metamodel translations so existing surveys benefit without re-saving.
- **Demo seed surveys now reference fields that exist on their target card type.** The Application survey no longer asks to maintain the removed `vendor` text field (Applications use the Provider relation instead) and the IT Component survey no longer references the non-existent `supportLevel` field. A new `test_survey_field_keys_match_target_type` test in `tests/services/test_seed_demo.py` prevents this drift in the future.
- **Count badges on the My Tasks tabs (Todos / Surveys) no longer get clipped.** The Tab labels positioned the count Badge with `right: -12` but the parent Tabs/Tab containers had `overflow: hidden`, so the floating badge was clipped on the right edge. Added right padding and forced `overflow: visible` on the tab + scroller.
- **Survey Builder now shows localized field-type labels (e.g. "Single Select", "Sélection unique") instead of raw keys** (`single_select`) in the field-list type chip. Reuses the existing `common:fieldTypes.*` translations already used by the metamodel field editor.

## [1.0.2] - 2026-05-06

### Security
- **Triaged the Trivy baseline and added apk patch-upgrade to every runtime image stage.** Each runtime Dockerfile stage (`backend`, `db`, `frontend`, `nginx`, `mcp-server`) now runs `apk upgrade --no-cache` before installing its app payload, so apk-package CVEs in the pinned alpine bases are picked up automatically when fixes ship in the alpine repo. Findings that cannot be fixed from this repo — build-stage-only CVEs in `alpine/git:v2.47.2` (drawio clone) and `node:20-alpine` (npm dev deps), and upstream Go binaries (`gosu` in `postgres:18-alpine`, the `ollama` binary) — are now captured with rationale in `.github/trivy-allowlist.yaml` and re-evaluated quarterly. The Trivy gate stays non-blocking (`exit-code: 0`) for this release; a follow-up will flip it to enforcing once the apk-upgrade chain has drained the backlog.

## [1.0.1] - 2026-05-06

### Fixed
- **Bundled edge nginx now starts on IPv4-only hosts and defaults to standard public ports in the sample env file.** The generated nginx config no longer forces IPv6 `listen [::]` sockets when the container runtime does not support them, but operators can re-enable them with `NGINX_ENABLE_IPV6=true` on dual-stack hosts. The stock root-only `user` directive is stripped from the nginx main config to avoid non-root startup noise, and `.env.example` now defaults to `HOST_PORT=80` / `TLS_HOST_PORT=443` so direct TLS deployments land on the normal public ports without extra edits.

## [1.0.0] - 2026-05-05

`1.0.0` is a stability declaration, not a feature release. The code shipping here is the same code that shipped in `0.71.0`, plus the supply-chain hardening and contributor-flow changes below. What's actually new is the **commitment** that `1.x` will not break operators within a major version line — see [`docs/reference/compatibility.md`](docs/reference/compatibility.md) for the full contract (Alembic migrations stay additive, the seeded metamodel and `/api/v1/` surface stay stable, permission keys stay stable, and removals go through a deprecation cycle).

### Added — Stability commitment
- **Documented backwards-compatibility policy for the `1.x` line.** New `docs/reference/compatibility.md` spells out what's covered (database schema, REST API under `/api/v1/`, permission keys, the seeded built-in metamodel, encrypted-at-rest secret format) and what's not (internal Python module layout, JSONB blob shapes, frontend internals, operator-introduced metamodel customisations). Every covered change goes through a deprecation cycle: marked in minor `N`, kept working in `N+1`, earliest removal in `N+2` or `2.0`. For deprecated REST endpoints, the response now carries `Deprecation: true` and `Sunset` headers per RFC 8594.
- **Pre-release channel documented.** New `docs/reference/releases.md` covers GHCR tag conventions, when an `-rc.N` is required (breaking-layout minors), the 48–72h bake window, and the maintainer release checklist. The publish workflow's existing `flavor: latest=auto` already excludes prereleases from `:latest` / `:X.Y` / `:X`, so RC tags only ship as `:X.Y.0-rc.N`. On the GitHub Release side the prerelease flag is flipped manually for now (`gh release edit vX.Y.0-rc.N --prerelease`); a future minor will automate that.

### Added — Supply chain
- **Container images on GHCR are signed with cosign keyless OIDC.** Every image in the multi-arch matrix (`db`, `backend`, `frontend`, `nginx`, `mcp-server`) is now signed by digest after build-push. There is no shared signing key — the certificate is issued by Sigstore's Fulcio for the workflow identity and recorded in the public Rekor transparency log. Operators can verify before pulling: `cosign verify --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/vincentmakes/turbo-ea/backend:1.0.0`. The signature applies to the manifest list digest, so one verification covers both `linux/amd64` and `linux/arm64`. Full reference in `docs/admin/supply-chain.md` and the new "Verifying images" subsection of the README Quick Start.
- **Trivy scans every published image for HIGH and CRITICAL CVEs and uploads the result as SARIF to the GitHub Security tab.** The gate is intentionally **non-blocking** at `1.0.0` (`exit-code: 0`) — the alpine bases used by every image carry baseline musl-libc and apk transitive findings that would block all publishes from day one. The scan is informational so findings are visible and triageable; a follow-up release will populate `.github/trivy-allowlist.yaml` with rationale per CVE and flip the gate to enforcing.
- **SBOM generation was already on (`sbom: true` on `docker/build-push-action`)**; this release just makes it discoverable. Buildkit emits an SPDX SBOM as an OCI referrer for every image — pull it with `docker buildx imagetools inspect --format '{{ json .SBOM }}' <image>:<tag>`. Useful as input to operator-side vulnerability scanning or component inventory.

### Changed — CI hardening
- **All GitHub Actions are pinned to 40-character commit SHAs.** Floating major tags like `@v6` silently re-resolve when the upstream maintainer pushes a new release; pinning freezes the action source until Dependabot proposes a deliberate update through the existing monthly `github-actions` ecosystem refresh. The blast radius was largest in `ci.yml`'s `openapi-spec` job, which holds `contents: write` and auto-commits regenerated OpenAPI specs to `main` with `[skip ci]` — pinning closes the path where a compromised upstream account could push to `main` without any diff in this repository. The pin set covers `actions/{checkout,setup-python,setup-node}`, `dorny/paths-filter`, the full `docker/*` stack, and `softprops/action-gh-release` (which previously had a `# TODO: pin to a SHA before merging` comment that is now resolved).

### Added — Contributor flow
- **`SECURITY.md` at the repo root** documents private vulnerability reporting via [GitHub Advisories](https://github.com/vincentmakes/turbo-ea/security/advisories/new) instead of "contact me via my GitHub profile". Includes supported-versions policy (latest minor only), 7-day acknowledgement / 30-day fix-plan SLA, and an explicit out-of-scope list (operator misconfigurations, demo-data deployments, transitive deps without an exploitable path).
- **Issue templates** for bug reports, feature requests, and the SSO / ServiceNow integration-tester volunteer ask. Blank issues are disabled; the chooser routes ideas and questions to Discussions, security reports to the private advisory flow.
- **PR template adds a `Type` checkbox row and a free-text `Test plan` section** above the existing 10-item conventions checklist. The checklist is unchanged — it already covered CLAUDE.md's permission-check, migration, async, i18n, and screenshot requirements.

### Changed
- **README ServiceNow callout updated and linked to the new integration-tester issue template** (the SSO half of the prior callout had already been resolved earlier in the `0.x` line). SSO and ServiceNow are both shipping; the maintainer just has limited access to real-world identity providers and ServiceNow instances, so volunteer testers in those environments are the bottleneck on integration-bug feedback.
- **Rewrote the user-manual installation guide to match the actual deployment.** `docs/getting-started/setup.md` (and all 7 locale variants) had drifted significantly: it documented installation via a non-existent `docker-compose.db.yml` file and pinned `0.65.3` as the version-pinning example. The page now describes the canonical `docker compose pull && docker compose up -d` flow from GHCR images, the `--profile ai` and `--profile mcp` opt-ins, the `SEED_DEMO` / `SEED_BPM` / `SEED_PPM` / `RESET_DB` seed flow, the 0.71.0 direct-HTTPS env vars, and points readers at `docs/admin/supply-chain.md` for cosign verification. The Quick Reference table is rebuilt around the actual commands (no stray `--build` flags in production rows).
- **Expanded the user-manual first page to cover the platform's actual surface.** The Key Concepts table on `docs/index.md` (and all 7 locale variants) now defines Inventory, Reports, PPM, TurboLens, EA Delivery, ADR, Risk Register, Web Portal, MCP Server, and RBAC alongside the existing Card / Card Type / Relationship / Metamodel / Lifecycle / BPM / SoAW rows. Operators landing on the index page can now see what the project ships without having to discover each feature by clicking through the nav.

### Removed
- Two stale internal planning notes (`plan.md`, `docs-internal-tagging-plan.md`) that pre-date the docs/reference/ home for compatibility and release-channel material.

## [0.71.0] - 2026-05-05

### Added
- **Direct HTTPS support in the official docker-compose deployment.** The bundled edge nginx can now terminate TLS itself with no compose override files: set `TURBO_EA_TLS_ENABLED=true`, point `TLS_CERTS_DIR` at your cert directory (for example `../certbot/certs`), and publish both `HOST_PORT=80` and `TLS_HOST_PORT=443`. The image derives `server_name`, forwarded proto, and certificate paths from `.env`, serves both HTTP and HTTPS, and redirects HTTP traffic to HTTPS automatically.

## [0.70.4] - 2026-05-05

### Changed
- **The card side panel opened from a diagram now shows the Layered Dependency View at the bottom**, matching the full Card Detail page. Previously the LDV section was hidden in the side panel; it is now enabled by default since it renders fine even at narrow widths.
- **CI now skips backend, frontend, and MCP jobs that aren't relevant to the changed paths.** `VERSION` was removed from the backend filter (the OpenAPI spec is version-agnostic, so a bump can't drift it) and `.github/workflows/ci.yml` now triggers a dedicated `ci` filter that fans out only when the workflow itself changes. A frontend-only PR (with VERSION + CHANGELOG bump) no longer runs backend tests.
- **Backend integration tests now run in parallel via `pytest-xdist`.** `pytest -n auto` is enabled in the integration job; the existing `conftest.py` already allocates a per-worker Postgres schema (`test_gw0`, `test_gw1`, ...) so workers don't collide on the savepoint-rollback fixture. Expected to roughly halve the integration job wall-clock on the 4-vCPU GitHub-hosted runner.

## [0.70.3] - 2026-05-05

### Added
- **CI safety check that catches `VERSION` ↔ `CHANGELOG.md` drift at PR time.** A new `version-check.yml` workflow runs on PRs that touch the `VERSION` file and fails if `CHANGELOG.md` is missing a matching `## [<version>]` heading. Without the check, bumping the version without a changelog entry causes the Publish-GitHub-Release workflow to fail at tag time with no easy diagnosis.

## [0.70.2] - 2026-05-05

### Fixed
- **Non-root nginx containers now restart cleanly.** The custom `frontend` and edge `nginx` images now grant uid:gid `1000:1000` ownership of the full runtime pid directory instead of only the pid file, fixing `unlink() "/run/nginx.pid" failed (13: Permission denied)` during `docker compose restart`.
- **Bundled edge nginx now derives its public hostname and forwarded scheme from `.env` without an extra mounted hook/config file.** The image renders its built-in config from `TURBO_EA_PUBLIC_URL` at container start, so normal deployments no longer need to mount a separate `nginx/default.conf` just to set `server_name` and public-proto handling.

## [0.70.1] - 2026-05-05

### Changed
- **CI no longer rebuilds the `ollama` image on every `main` push.** The image is just a thin non-root patch over `ollama/ollama:latest` (mkdir + chown + USER), so rebuilding multi-arch on every commit was wasteful. The Dockerfile target stays so operators can still build it locally; republish to GHCR manually when upstream Ollama changes meaningfully.

## [0.70.0] - 2026-05-05

### Changed
- **Breaking change: the Docker stack now runs as uid:gid `1000:1000` across all compose services, including PostgreSQL, edge nginx, and the optional Ollama + MCP profiles.** The stack now uses custom non-root images published from the root multi-target `Dockerfile` for `db`, `backend`, `frontend`, `nginx`, `ollama`, and `mcp-server`. PostgreSQL was converted from a shell-level probe to a real compose boot test and now starts cleanly as `1000:1000`; Ollama model storage moved from `/root/.ollama` to the configurable `OLLAMA_MODELS` path (default `/models`); and the Ollama healthcheck now uses the built-in `ollama list` CLI instead of `curl`, which the image does not ship.
- **Breaking change: persistent Docker volume names changed to avoid reusing old root-owned data automatically.** The PostgreSQL volume is now `postgres_data` and the Ollama models volume is now `ollama_models`. Upgrades from pre-`0.70.0` releases require a manual data migration if you want to retain existing data.
- **Non-root nginx now binds a high internal port instead of relying on privileged port capabilities.** Both nginx containers listen on `8080` internally, the edge service publishes `${HOST_PORT}:8080`, and the Ollama models path is now fixed to `/models` so the named volume cannot be remapped to an unwritable location by accident.

## [0.65.4] - 2026-05-05

### Changed
- **Production and development Docker Compose are now explicitly separated.** The root `docker-compose.yml` is now production-only and pulls published GHCR images without any `build:` sections, while the new `dev/docker-compose.dev.yml` adds local source builds for `backend`, `frontend`, and `mcp-server` only when developers opt in. The Docker publish workflow now builds all three images from the root multi-target `Dockerfile`, and `latest` tagging is delegated to `docker/metadata-action`'s safe automatic semver handling so older hotfix tags can no longer overwrite the current `latest` image.
- **Docker helper files are now grouped by role.** The test-only PostgreSQL harness moved to `test/docker-compose.test.yml`, with a short README beside it, and the Makefile now exposes symmetric production shortcuts (`pull-prod`, `up-prod`, `down-prod`) alongside the existing development helpers.

## [0.65.3] - 2026-05-04

### Changed
- **Diagrams open in a read-only viewer by default.** Opening a diagram (`/diagrams/:id`) now lands you on a read-only canvas with the DrawIO chrome stripped away, so you can read and explore without risk of accidental edits. Click any card on the canvas to pop open a right-side panel showing that card's full details (data quality, lifecycle, attributes, relations, comments, stakeholders, history). Users with the `diagrams.manage` permission see an **Edit** button in the toolbar that switches into the existing DrawIO editor at `/diagrams/:id/edit`; viewers without it never see the button, and direct URL access to the editor route redirects back to the viewer. Closing the editor returns to the viewer rather than the gallery.
- **Card details panel reachable from the editor too.** Right-click any card on the canvas in edit mode and choose **View Card Details…** to open the same side panel that the read-only viewer uses, without leaving the editor. The shortcut only appears when the click landed on a card cell.

### Internal
- **Backend CI tests split into unit + integration jobs.** The previous monolithic `backend-test` job ran ~15 min and was the long pole on most PRs. It's now two jobs: **Backend Unit Tests** runs `tests/core/` + `tests/services/` with no Postgres (~2 min, required for merge), and **Backend Integration Tests** runs `tests/api/` against Postgres with coverage (~15 min, informational — `continue-on-error: true`). PRs are mergeable as soon as the unit suite passes. The integration suite still runs and reports failures so regressions are caught quickly post-merge; flip `continue-on-error: false` in `.github/workflows/ci.yml` to make it required again. **Branch protection note**: if `Backend Tests` was a required check, replace it with `Backend Unit Tests` (the integration job intentionally doesn't gate merge anymore).

## [0.65.2] - 2026-05-04

### Added
- **Pre-built Docker images on GitHub Container Registry.** The `backend`, `frontend`, and `mcp-server` images are now published to `ghcr.io/vincentmakes/turbo-ea/*` on every push to `main` and on every `v*.*.*` tag, in both `linux/amd64` and `linux/arm64`. Operators can skip the local build (5–10 minutes on first run) by running `docker compose pull && docker compose up -d` against the standard compose files. Pin a specific version with `TURBO_EA_TAG=0.65.2`. The original `docker compose up --build` flow is unchanged for everyone else.

## [0.65.1] - 2026-05-04

### Fixed
- **Capability reference catalogue — branch selection now respects active filters.** When you applied a filter (industry, level, search, or the deprecated toggle) and then ticked a branch (e.g. an L1 capability) to import its subtree, the import payload silently included every descendant from the unfiltered catalogue — including the capabilities you had just filtered out — so users were creating cards they never saw. Subtree selection now scopes to the currently-visible part of the tree, matching the existing "Select visible" behaviour. Deselecting a branch under an active filter likewise affects only the visible subtree, leaving any previously-selected hidden descendants intact (clear the filter to see and manage them).

### Internal
- **Committed OpenAPI spec is now version-agnostic, so VERSION bumps no longer cause CI drift.** `scripts/dump_openapi.py` normalises `info.version` to the constant `"latest"` before writing `docs/api/openapi.json`. The previous behaviour embedded the real `VERSION` value, so every PR's version bump produced drift unless the contributor had run `pre-commit install` locally — in practice CI failed on most PRs. The `openapi-regenerate-on-version` pre-commit hook is removed (no longer needed). Backend route and request/response schema changes still require a manual `python scripts/dump_openapi.py` run, which the existing PR-time CI check enforces. The live spec served by a running backend at `/api/openapi.json` keeps the real version (it's produced by `app.openapi()` at runtime).

## [0.65.0] - 2026-05-03

### Fixed
- **PPM module on iPad/tablet.** The Tasks Kanban and the Gantt timeline are now usable on touch devices. On the **Tasks** board, long-press (~250 ms) on a task to pick it up and drag it across columns; a quick tap still opens the task dialog and a vertical swipe still scrolls a long column. The previous build was unusable on touch because `PointerSensor` was claiming the gesture before the long-press delay could fire — `PointerSensor` has been replaced with `MouseSensor` so touch goes exclusively through `TouchSensor`. On the **Gantt**, use **two fingers** to pan the timeline horizontally; one-finger swipes scroll the page vertically as normal, and one-finger drags on a bar / handle / milestone still resize and move tasks via the gantt library. Mouse and trackpad behaviour on desktop is unchanged.
- **PPM Gantt — "Align start" preserves task duration.** When you create a finish-to-start dependency and click **Align start** in the snackbar, the successor's whole bar now shifts so it starts the day after its predecessor finishes — its end / due date moves by the same delta as its start. Previously only the start date was patched, which stretched the task instead of moving it.
- **PPM work-package completion now counts in-progress tasks at 50%.** A WBS's rolled-up completion is the duration-weighted average of its tasks where each task contributes `100% × duration` if `done`, `50% × duration` if `in_progress`, and `0%` otherwise — matching the per-task fill the Gantt has always shown. Previously `in_progress` tasks contributed 0 to the parent, so a work package with all in-progress tasks read 0% even though every task underneath visibly read 50%.

### Changed
- **PPM WBS dates auto-track their tasks (bidirectional).** A work package's `start_date` / `end_date` now equal the exact bounds of its tasks: widen when a task moves outside the range, shrink when tasks move inward or are reassigned / deleted. The change cascades up the WBS hierarchy so parents and grandparents also follow their descendants. A WBS with no tasks (and no children with dates) keeps whatever dates you last set.
- **PPM WBS completion is now duration-weighted across the whole subtree.** A 5-day task that's done now contributes 5x more to its work package's completion than a 1-day task that's done, and parent work packages aggregate the durations across all descendants rather than averaging children's percentages — so a child with one short done task and a sibling with one long open task no longer reports 50% complete at the parent. Tasks without dates default to 1 day so they still count, and a WBS whose subtree contains no tasks at all keeps any manually-typed completion value.

### Internal
- Pre-commit hook regenerates `docs/api/openapi.json` whenever `VERSION` is staged, since the spec embeds `info.version` and CI fails PRs whose committed spec drifts. Install once with `pip install pre-commit && pre-commit install` from the repo root.

## [0.64.2] - 2026-05-03

### Security
- **Capability catalogue update-status no longer echoes PyPI exception details into the response.** `GET /capability-catalogue/update-status` previously returned `f"Could not reach PyPI: {exc}"`, mixing the raw exception string from `httpx.HTTPError` / `ValueError` into the JSON payload (CodeQL alert `py/stack-trace-exposure`). The endpoint is admin-only and the captured exceptions are bounded, so practical risk is low — but the response now returns the constant `"Could not reach PyPI"` and logs the full cause server-side via `logger.exception(...)`, matching the pattern already used by the sibling `update-fetch` endpoint.

## [0.64.1] - 2026-05-03

### Fixed
- **Report PPTX export — pagination, capture and slide layout polish.** The PPTX export of large reports now splits charts across multiple slides only where it's safe to do so, and only for reports that opt in: Lifecycle gantt, Capability Map, Portfolio and Data Quality paginate by their card / row containers, while Matrix, Cost treemap, Dependencies and other single-canvas visualizations always stay on a single slide. The boundary detector is column-aware (a horizontal cut is only used at a Y where no card in any column straddles the line), pages smaller than 25% of the slide chart area are merged with their neighbours so the export no longer alternates with near-empty slides, and trailing tiny slices roll back into the previous page. The chart capture now expands all `overflow: auto/scroll/hidden` descendants to `visible` for the duration of the export, so horizontally scrolling timelines like the Lifecycle gantt are captured at their full content width instead of looking "zoomed in" on the slide. Material Symbols icon spans are filtered out of the capture (their font-ligature names no longer leak through as raw text), and PPTX no longer emits redundant data-table slides — the chart image already covers what's on screen, and XLSX remains the path for raw data export.
- **Report XLSX export from chart view no longer crashes with "Workbook is empty".** Charts that don't currently render any `<table>` (most reports in chart mode) used to throw when invoked from the export menu. The menu now hides "Export to Excel" while a report is in chart view and "Export to PowerPoint" while it's in table view, matching each format to the view that produces meaningful output. As a defensive guard the workbook still falls back to a Summary sheet (title, generation timestamp, active filters) when no data tables are detected, so a future caller can never produce an empty file.

## [0.64.0] - 2026-05-02

### Added
- **PowerPoint (.pptx) and Excel (.xlsx) export on every report.** The "⋮" menu on Portfolio, Capability Map, Lifecycle, Dependencies, Cost, Matrix, Data Quality, EOL, and Process Map now offers **Export to Excel** and **Export to PowerPoint** alongside Print and Copy link. The PPTX deck opens with a combined title-and-chart slide (report title, generation timestamp, active filter summary across the top, the live chart underneath at 2× DPI) followed by one or more data-table slides paginated automatically. The XLSX workbook contains one sheet per data table currently rendered, with auto-sized columns and currency / number formatting preserved. Implementation is handled inside `ReportShell` itself — it captures the chart container as a PNG via `html-to-image` and scrapes any `<table>` rendered inside the chart area, so reports get export for free without per-report glue. Translated into all 8 supported UI locales (`en`, `de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`).

## [0.63.0] - 2026-05-02

### Added
- **`costs.view` permission to gate cost field visibility on cards and reports.** Cost-typed fields (e.g. `costTotalAnnual` on Applications, IT Components and the `relAppToITC` relation; `costBudget`/`costActual` on Initiatives) are now hidden from users who lack the new `costs.view` app-level permission. Stakeholders of a card always see costs on that card regardless — assignment to any stakeholder role is the per-card escape hatch. Granted by default to `admin`, `bpm_admin`, and `member` roles; explicitly **off** for `viewer` so read-only users no longer see landscape-wide cost data. Backend redaction is the source of truth: the `/cards` GET/list/CSV-export endpoints, `/cards` PATCH (cost keys are dropped silently if the user can't see them), `/relations` reads, the OData feed (`/bookmarks/{id}/odata`), and unauthenticated public portals (`/web-portals/public/{slug}` — always strips costs) all enforce the rule. Cost reports (`/reports/cost`, `/reports/cost-treemap`) and the `size_field` axis on `/reports/portfolio` require `costs.view` directly. PPM is **unchanged**: anyone with `ppm.view` keeps full access to `PpmCostLine` / `PpmBudgetLine` and the PPM dashboard. Card Detail renders a "Restricted" placeholder with a lock icon for cost fields a user cannot see. Inventory grid hides cost columns and Excel export omits them when the global permission is missing. Translated into all 8 supported UI locales (`en`, `de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`).

### Changed
- **Cost Analysis Report — removed time-travel slider.** The lifecycle-based timeline slider has been removed from the Cost Report. Cost values reflect a card's current state and are updated on a different cadence than its lifecycle phases, so projecting them backwards via lifecycle dates was misleading. The report now always shows current costs; lifecycle-based "time travel" remains available on the Lifecycle and Roadmap reports where it is meaningful.

### Migrations
- `069_grant_costs_view_default_roles.py` — sets `costs.view: true` on the seeded `bpm_admin` and `member` roles and `costs.view: false` on `viewer`. Custom roles are not modified — administrators must grant the new permission explicitly. Admin (wildcard) is unaffected.

## [0.62.1] - 2026-05-02

### Fixed
- **Swagger UI (`/api/docs`) blocked by CSP.** The strict Content-Security-Policy applied by nginx to the SPA was blocking Swagger UI's CSS and JS bundles from `cdn.jsdelivr.net`, leaving the docs page unstyled and non-functional. Added a dedicated `location = /api/docs` block in `nginx.conf` that proxies to the backend with a relaxed CSP whitelisting `https://cdn.jsdelivr.net` for `script-src` and `style-src`. All other security headers (HSTS, X-Frame-Options, etc.) are preserved on the docs page; the strict CSP for the rest of the SPA is unchanged.

## [0.62.0] - 2026-05-02

### Added
- **Cost Analysis Report — drill down into a rectangle.** When at least one aggregate **Cost Source** is active (e.g. `IT Component · Total Annual Cost` rolled into Applications), the treemap rectangles are now clickable: clicking one replaces the chart with a treemap of the related cards contributing to that rectangle's roll-up, sized by their direct cost — so you can answer "what's driving this number?" without leaving the report. With **multiple cost sources** active, the drilled view shows **one treemap per source side-by-side** (e.g. clicking a Provider with both `Application · Annual cost` and `IT Component · Annual cost` selected gives two independent treemaps for that vendor, each on its own scale and with its own per-panel total) — keeping different card types from being squashed into a single chart. A breadcrumb (`All Applications › NexaCore ERP`) appears above the panels; click any segment to walk back up. Existing filters (timeline slider, cost source) are preserved across the drill, and the drilled-in level is included in saved reports so a saved view re-opens at the same depth. With no aggregate active, clicking a rectangle still opens the card side panel as before. Backend: `/reports/cost-treemap` accepts a new optional `parent_card_id=<uuid>` query parameter that restricts the primary card set to those linked (in either direction) to the parent. Translated into all 8 supported UI locales.

### Changed
- **Cost Analysis Report — snappier treemap animation.** The treemap rectangle re-layout animation runs at `animationDuration=300` ms (down from Recharts' default 1500 ms), so drilling in / popping out / changing filters feels responsive instead of sluggish.

## [0.61.0] - 2026-05-02

### Added
- **Cost Analysis Report — aggregate from related cards (multi-source).** A new **Cost Source** multi-select picker appears whenever the selected card type has at least one relation type pointing to a type that owns a cost field. Each option is a `Type · Field` pair — for example, viewing *Provider* now lets you tick `Application · Total Annual Cost` and `IT Component · Total Annual Cost` together to see a vendor's total spend across both kinds of related card in a single roll-up. The picker is metamodel-driven (relation types and cost fields are discovered at render time) and double-counting is prevented by construction: each (type, field) pair is offered once, parallel relations between the same two cards are de-duped server-side, and different types cannot share cards. Selecting nothing keeps today's *Direct* behaviour. Backend: `/reports/cost-treemap` accepts a new repeatable `aggregate=<typeKey>:<fieldKey>` query parameter with full input validation (unknown type, non-cost field, malformed spec, duplicate pair → `400`). Translated into all 8 supported UI locales.

## [0.60.1] - 2026-05-02

### Fixed
- **PPM Gantt — fan-out dependencies now work; relation dots stay grabbable on bars that already have an arrow.** Each rendered arrow has an invisible 12 px wide transparent click stroke for delete-by-click. It was being painted for the full path length — including the segments that hug the source bar's row, where the lib's relation circle handle sits (at `bar.right + 10`). Hovering near a bar that already had an outgoing dependency landed on our click path instead of the bar wrapper, so the lib's `:hover` rule never fired and the dot stayed at `opacity: 0` and ungrabbable — making the Gantt feel one-to-one. The painted (visible) arrow still draws full-length so its chevron tips into the target bar; the click target now uses a routing-aware "clickSafe" path that (a) insets ~18 px at each end for forward / same-row arrows and (b) skips the entire short exit segment for loop-back arrows (where a small inset would still hug the bar's row). Also added belt-and-suspenders `pointer-events: none` on the lib's hidden `<svg class="ArrowClassName">` and parent `<g class="arrows">` wrappers so they can't intercept hover either.

### Changed
- **PPM Gantt — "Align start" now snaps the successor to the day AFTER the predecessor's end date.** Previously the snackbar's *Align start* action set the successor's `start_date` equal to the predecessor's end date, which made the two bars share a calendar day. With finish-to-start the successor should pick up the next working day, so the action now adds one day before patching the successor (tasks: `start_date`; WBS: `start_date`, plus `end_date` rolled forward when the existing end would now precede the new start, milestones still keep `start == end`). The label and translation key are unchanged.

### Added
- **PPM Gantt — explicit one-to-many / many-to-one dependency tests.** Added integration coverage that verifies a single successor can have multiple predecessors (fan-in: A→C and B→C) and that a single predecessor can drive multiple successors (fan-out: A→B and A→C), so the existing Postgres edge-tuple uniqueness and cycle-detection logic stay correct as the dependency graph evolves.

## [0.60.0] - 2026-05-01

### Added
- **PPM Gantt — Linear-style dependency arrows.** Replaces the Gantt library's hardcoded staircase arrows (sharp 90° corners, no override hooks) with a custom SVG overlay that draws clean orthogonal paths with **rounded SVG arc corners** at every elbow. Forward dependencies (predecessor ends before successor starts) collapse to a 3-segment H–V–H with two corners; loop-back dependencies (overlapping bars) route around to the LEFT of both bars with five segments and four corners; same-row dependencies render as a single horizontal segment. Coordinates are read from each bar's `getBoundingClientRect()` and re-measured on scroll, resize, view-mode change, and any subtree mutation, so arrows track the bars perfectly during drag, zoom and scroll. Per-arrow click-to-delete with confirmation. The library's built-in arrows are hidden via CSS; the drag-preview line for creating new dependencies is preserved.
- **PPM Gantt — Quarter and Year view scales plus +/− zoom controls.** The view-mode picker on the PPM initiative Gantt (`/ppm/:id` → Gantt tab) now offers five scales — Day, Week, Month, **Quarter**, **Year** — instead of the previous three, making it possible to take in multi-year programmes without horizontal scrolling. A pair of zoom-in / zoom-out icon buttons sit next to the picker and step through the same scale one notch at a time (disabled at the boundaries); the chosen scale is persisted to `localStorage` per browser so it survives a refresh. Translated into all 8 supported UI locales.
- **PPM Gantt — finish-to-start dependencies between WBS items and tasks.** The relation handles ("dots") on each side of every Gantt bar are now functional: drag from the right-side dot of one row to the left-side dot of another to create a dependency arrow. Dependencies are any-to-any (WBS↔WBS, WBS↔Task, Task↔Task) and persisted in a new `ppm_dependencies` table with polymorphic endpoints (dual nullable FKs + CHECK constraint, CASCADE on every endpoint so arrows disappear automatically when an endpoint is deleted). Backend rejects cycles (BFS check), self-references, cross-initiative endpoints, and duplicates with friendly error toasts. Double-click an arrow to delete it. Demo data adds 3–4 sample arrows on the SAP S/4HANA Migration initiative. The schema reserves a `kind` column for future SS / FF / SF kinds; only FS is exposed today. New endpoints: `GET/POST /ppm/initiatives/{id}/dependencies`, `DELETE /ppm/dependencies/{id}` — all gated on the existing `ppm.view` / `ppm.manage` permissions. Translated into all 8 supported UI locales.

## [0.59.0] - 2026-05-01

### Added
- **Dashboard — new admin-only "Admin" tab.** Users holding the `admin.users` permission now see a third tab on the Dashboard (next to Overview and My Workspace) showing system-wide governance and adoption signals that don't overlap with the existing Data Quality report. Top of the tab is a KPI strip with four tiles: Active users in the last 30 days vs total active accounts, cards without any stakeholder assignment, system-wide overdue todos (with an unassigned-todo subtotal), and stuck approvals — cards in `DRAFT` / `PENDING` whose `updated_at` is older than 30 days, plus a separate count of `BROKEN` approvals. Below the strip are six section cards: Top contributors over the last 30 days (leaderboard ranked by mutating event count), Stakeholder coverage by card type (per-type missing / total ratio with a colour-coded bar), Idle users (active accounts with no login or > 90 days, plus a count of pending SSO invitations whose email hasn't yet redeemed into a User row), Approval pipeline by card type (stacked DRAFT / PENDING / BROKEN bar per type), Recent system activity (last 50 events, reuses the existing `RecentActivity` component), and Oldest overdue todos with the assignee's display name. A new backend endpoint `GET /reports/admin-dashboard` returns all of this in a single payload and is gated on the existing `admin.users` permission, so non-admins receive 403 and the tab is hidden from the UI (a stale `?tab=admin` URL falls back to the user's pinned default tab). Translated into all 8 supported UI locales (en, de, fr, es, it, pt, zh, ru) with `_one` / `_other` plural variants where counts are displayed.

## [0.58.0] - 2026-05-01

### Added
- **Card Detail — subtype is now editable inline.** The subtype shown next to the card type in the header is now a clickable target on any card whose type defines subtypes. Clicking it opens a small dropdown listing every available subtype (with localised labels resolved from the metamodel `translations` map) plus a *None* option, and the change is persisted via `PATCH /cards/{id}` — the backend already accepted `subtype` updates and treats them as approval-breaking. The control respects the existing `card.edit` permission and is hidden on archived cards. Translated into all 8 supported UI locales.

### Changed
- **Card Detail — AI "suggest description" button moved into the Description section.** The sparkle icon previously lived in the page-level header next to the badges and overflow menu, which separated it from the field it was acting on. It is now rendered inline next to the Description section's edit pencil, so the affordance sits exactly where the generated content will land. Behaviour is unchanged — same `aiEnabled` gate, same `POST /ai/suggest` call, same suggestion panel below.

## [0.57.1] - 2026-05-01

### Changed
- **Card Detail header — quality and subtype redesigned for visual consistency.** The data-quality circular wheel is replaced with a pill-shaped progress bar that matches the height of the Lifecycle and Approval Status pills next to it (24px, outlined, color-coded green / orange / red with an internal fill that visualises the percentage). The subtype, which used to render as a small outlined pill displaying the raw subtype key, is now inline text rendered after a middle-dot separator next to the card type label, both colored with the card type's brand color and resolved through the i18n translation map so it displays the localised label instead of the key.

## [0.57.0] - 2026-05-01

### Added
- **Dashboard — new "My Workspace" tab + pinable default tab.** The Dashboard at `/` is now tabbed: the existing KPI / charts view becomes the **Overview** tab (unchanged), and a new **My Workspace** tab gives every user a personal landing page. Top of the tab is a four-tile metric row (My Favorites, Cards I have a role in, Open todos, Pending surveys), followed by a contextual "Needs my attention" banner that aggregates overdue todos plus cards in `BROKEN` approval status that the user is responsible for, and six section cards: My Favorites, Cards I Have a Role In (with role chips), My Open Todos, My Pending Surveys, Recent Activity on My Cards (events on cards I follow or have favorited, reusing the existing `RecentActivity` component), and Cards I Created. Each section lazy-loads its own list independently so the metric row never waits on the slowest query, and every section has a friendly empty state with a link to the relevant feature page. A small `push_pin` icon embedded in each tab label lets the user pin one of the two tabs as their default — the next time they open Turbo EA, that tab loads first. The pinned preference is stored per-user in a new `users.ui_preferences` JSONB column (so it follows the user across devices) via `PATCH /users/me/ui-preferences`, mirrors the existing `notification_preferences` pattern, and is included in the `/auth/me` payload so the Dashboard knows the preferred tab without an extra round-trip. Explicit `?tab=overview` / `?tab=workspace` URLs always win over the pinned default so deep-links are stable. New backend endpoints: `GET /reports/my-workspace` (six per-user counters), `GET /cards/my-stakeholder` (cards I'm assigned to with aggregated role list), `GET /cards/my-created` (uses the existing `Card.created_by` column), `GET /events/my-cards` (recent activity on favorited + stakeholder cards). All endpoints respect hidden card types and exclude archived cards. Translated into all 8 supported UI locales (en, de, fr, es, it, pt, zh, ru) with `_one` / `_other` plural variants for the "Needs my attention" sentence.
- **Card Detail — favorite (★) toggle in the header.** Every card detail page now has a star button next to the approval status badge: clicking it adds or removes the card from the user's favorites via the existing `/favorites` endpoints. The filled gold variant indicates the card is currently favorited, the outlined variant means it isn't. This is the first generic "mark as favorite" UI in the product — favorites previously only existed on the EA Delivery → Initiatives tab — and is what makes the new Dashboard → My Workspace → My Favorites section actually populate.

### Changed
- **`useAuth` hook now exposes `refreshUser()`** so any component can re-fetch `/auth/me` after mutating user-scoped settings (e.g. the dashboard pin toggle). Backed by a small new `AuthContext` provider so `Dashboard` and `CardDetail` can read the current user / refresh function without re-invoking the hook (which would double-fetch on every page).

## [0.56.0] - 2026-04-30

### Added
- **Inventory mass edit — link / unlink related cards across many cards at once.** The mass-edit modal now exposes every relation type valid for the currently-filtered card type as its own field option, listed under a dedicated **Relations** group beneath **General** and **Attributes** (so attributes and relations can never be confused for each other). Picking a relation reveals an Add link / Remove link toggle and a multi-select autocomplete of candidate target cards (typed search against the correct other-end card type, with the type's brand colour rendered next to each option). Hitting **Apply** then iterates the selection: in **Add** mode every selected card is linked to every chosen target — duplicates are detected up-front via a single `GET /relations?type=…` and skipped, so re-running is idempotent and won't create stacked duplicates; in **Remove** mode every matching link between a selected card and a chosen target is deleted. Self-links are blocked, and self-referential relation types appear twice in the dropdown (once per direction with the verb / reverse_label of each side) so the user can pick the semantically correct direction. Per-card failures surface in the existing partial-summary banner ("X updated, Y blocked") with deep-links back to the offending card, and a soft message explains the no-op cases ("Every selected card is already linked …" / "None of the selected cards are linked …") instead of a hard error. Hidden relation types and relations to hidden card types are filtered out so the option list only ever shows links the user could actually create. Translated into all 8 supported UI locales with proper `_one` / `_other` plural variants on the "this will affect N cards" hint.

## [0.55.3] - 2026-04-30

### Fixed
- **Inventory mass edit — partial successes were hidden behind a generic failure.** Mass-approving (or mass-editing attributes on) a selection where any single card failed used to reject the whole `Promise.all`, leaving the dialog stuck on a one-line "Mass edit failed" banner even though the cards that *did* satisfy the rules had already been committed server-side. The flow now uses `Promise.allSettled`, reloads the grid so successful updates are visible, and replaces the banner with a per-card list ("X updated, Y blocked") that names every blocked card and the exact mandatory relations / tag groups it's still missing — pulled straight from the structured `approval_blocked_mandatory_missing` 400 detail. Each blocked card name is a link to its detail page so the user can fix it in one click. Translated into all 8 supported UI locales.
- **Create Card modal — Provider relation was never created.** Selecting an existing Provider or creating a new one in the Provider linker showed an optimistic "linked" chip but the resulting Application / IT Component had no inbound Provider relation; instead the Provider's name was silently saved as a plain-text `vendor` attribute. The picker now stages the picked / created Provider and the dialog posts the `relProviderToApp` / `relProviderToITC` relation immediately after the card is saved, with the correct source/target direction. The orphan `vendor` text attribute is no longer written.

### Changed
- **Create Card modal — Provider linker is now labelled "Provider"** instead of "Vendor" on Application and IT Component (English UI). The picker has always written to the Provider relation; the old "Vendor" label was a leftover from before that relation existed and confused it with the separate `vendor` text attribute. The other 7 supported locales already used their localised "Provider" term and are unchanged.

### Removed
- **Redundant `vendor` text attribute on Application and IT Component card types.** Provider linkage is now exclusively expressed as the `relProviderToApp` / `relProviderToITC` relation that the Create Card modal already manages. On installs where any card has the attribute populated the field is left intact automatically (per-instance migration check), so existing data is never silently dropped.

## [0.55.2] - 2026-04-30

### Added
- **EOL section — one-click product suggestions on Card Detail.** The EOL accordion on the Card Detail page now mirrors the **Suggested matches** pill pattern that already ships in the Create Card flow: as soon as the user expands the accordion on an Application or IT Component, Turbo EA debounce-fuzzy-searches `endoflife.date` using the card's name and renders the top 5 matches as scored pills (gold border + bold for high-confidence matches with score ≥ 0.7, plain outline for weaker matches). One click on a pill selects the product and immediately surfaces the cycle dropdown — no more manual retyping the card name into the search field. The pills only appear while the search is empty and the card isn't already linked, so they stay out of the way once the user starts typing or has confirmed a link. Reuses the existing `/eol/products/fuzzy` endpoint, the existing `EolProductMatch` type, and the existing `eol.searching` / `eol.suggestedMatches` / `eol.noMatches` translations from the Create Card flow — no new translation keys required.

## [0.55.1] - 2026-04-30

### Fixed
- Capability Catalogue now actually follows the active UI language for users who have a **remote-fetched** catalogue cached. Previously, after an admin clicked **Fetch update**, the cached payload was served as canonical English regardless of the requested locale — language switching looked like a no-op even though `turbo-ea-capabilities` ships translations for all 8 locales. The fetch path now extracts and stores the wheel's `data/i18n/<lang>.json` files alongside the catalogue data, and the serve path applies them. Caches stored before this fix continue to work too: they fall back to the bundled package's translations matched by capability id, so no manual re-fetch is needed to get back into sync.
- Dependencies Report: long-pressing a card to re-centre the Layered Dependency View no longer shows an empty graph (the user previously had to refresh the page to see anything). React Flow's `fitView` prop only fits on the initial render; once the parent navigated to a new centre, the new layout was at different coordinates and rendered off-screen. The view now imperatively re-fits whenever the underlying nodes/edges change. As part of the same investigation, long-press also clears the hover-dimming state — previously the `ldv-hover-active` class persisted because long-press fires `onNodeShiftClick` directly from the pointer-down timer, bypassing the click handler that would normally reset it.

### Changed
- **Layered Dependency View** — Turbo EA's dependency-diagram notation is now formally named the **Layered Dependency View (LDV)**: a layered EA dependency view inspired by ArchiMate's layering and the C4 Model's "good defaults" philosophy, but distinct from both. The Dependencies Report toolbar, the Card Detail dependency section, and the TurboLens Architect target architecture all surface the new label across all 8 supported UI locales. The standard is documented in [`frontend/UI_GUIDELINES.md`](frontend/UI_GUIDELINES.md) § 3.10 and the user manual ([Reports → Layered Dependency View](docs/guide/reports.md)). The renderer was also renamed: `C4DiagramView` → `LayeredDependencyView`, `C4DiagramSection` → `LayeredDependencySection`, `c4Layout` → `layeredDependencyLayout`, plus all internal symbols (`buildC4Flow` → `buildLdvFlow`, `C4_NODE_W/H` → `LDV_NODE_W/H`, `C4Node`/`C4Group`/`C4Edge*` → `LdvNode`/`LdvGroup`/`LdvEdge*`, React Flow node-type strings, CSS class `c4-hover-active` → `ldv-hover-active`, keyframe `c4-lp-ring` → `ldv-lp-ring`, i18n keys `dependency.c4*` → `dependency.ldv*`). The toggle-button / saved-report `chartMode` value `"c4"` is intentionally kept for backwards compatibility with existing saved reports.
- Importing a capability from a localized catalogue view now creates the card in that language. A user browsing the catalogue in French and clicking **Create** lands a card whose `name`, `description`, and `aliases` are French — previously every imported card was written in English regardless of which language the user was reading. Card identity stays locale-agnostic via the immutable `catalogueId` attribute, so the green-tick "already exists" check still survives a language switch and there's no risk of duplicate cards across languages. The locale used at import time is recorded under `attributes.catalogueLocale` for auditing.

## [0.55.0] - 2026-04-29

### Added
- **TurboLens enable/disable toggle** under Admin → Settings → TurboLens. Administrators can now turn the module on or off without having to remove the AI provider configuration; when disabled, the TurboLens menu entry and dashboard link are hidden across the app.
- **Standard third-party data-exchange warning** on the AI and TurboLens settings tabs, prompting administrators to confirm that AI processing of card metadata, descriptions, and portfolio data is aligned with the organisation's IT, security, and data-protection policies before enabling. Translated into all 8 supported UI locales.
- **Module access guard** for the optional modules (BPM, PPM, TurboLens). Direct navigation to `/bpm`, `/ppm`, `/turbolens` (and their sub-routes) when the module is disabled now renders a friendly "module is disabled" placeholder with links back to the dashboard and to the relevant admin settings tab, instead of loading an empty page or firing API calls that would fail. Translated into all 8 supported UI locales.

### Changed
- `GET /turbolens/status` now also returns the `enabled` flag and only reports `ready: true` when both AI is configured and the module is enabled. New public `GET /settings/turbolens-enabled` and admin-only `PATCH /settings/turbolens-enabled` endpoints back the toggle.
- `useBpmEnabled`, `usePpmEnabled`, and `useTurboLensReady` hooks now also expose a `loaded` flag so route guards can wait for the first status fetch to resolve before deciding whether to render the page or the disabled placeholder.

## [0.54.0] - 2026-04-29

### Changed
- Inventory **Lifecycle** column now renders the localized phase label with a phase-specific icon (Plan / Phase In / Active / Phase Out / End of Life) instead of the raw phase key.
- Card Detail **Lifecycle** bar redesigned: phase icons replace plain dots, the connecting line is hidden behind the markers, the reached-phase progress is shown as a coloured gradient, and the current phase gets a soft halo so the active step is unmistakable.
- BPM Process Navigator drawer: the **Open Card** action moved out of the Overview body and into the top banner as an icon next to the process name, so it's always visible regardless of the active tab.

### Added
- BPM **Process Assessments** tab now has a **help icon** next to the title that opens a side panel explaining each dimension (Efficiency, Effectiveness, Compliance, Automation, Overall) with definitions, scoring anchors, and references to APQC PCF, CMMI, Lean Six Sigma, BPMN 2.0, COBIT, ISO 9001, and TOGAF Business Architecture, plus general best-practice scoring guidelines. Translated into all 8 supported UI locales.

### Fixed
- BPM Process Assessments trend chart: smaller x-axis font, better tick spacing, and dates now respect the configured **Date Format** general setting (both in the chart and in the assessments table).

## [0.53.0] - 2026-04-29

### Added
- New **Date Format** preference under General Settings, mirroring the existing currency picker. Five formats are offered — `MM/DD/YYYY` (US), `DD/MM/YYYY` (EU), `YYYY-MM-DD` (ISO), `DD MMM YYYY` (default), and `MMM DD, YYYY` — with a live preview against a sample date. Once changed, all displayed dates across the app update without a page refresh: card lifecycle phases, inventory grid columns, ADR/SoAW signed dates, the Risk Register, PPM tasks/reports/costs, BPM process flow versions, comments and history timestamps, dashboard activity, notifications, the public web portal, and admin pages. Backed by a public `GET /settings/date-format` endpoint and admin-only `PATCH /settings/date-format`. Translated into all 8 supported UI locales.

## [0.52.1] - 2026-04-29

### Fixed
- Capability Catalogue's **Check for update** no longer reports "you're on the latest version" right after a new `turbo-ea-capabilities` package is published to PyPI. The check now queries `https://pypi.org/pypi/turbo-ea-capabilities/json` directly — the source of truth at publish time — instead of the docs site at `capabilities.turbo-ea.org`, which only refreshes when the GitHub Pages deploy completes and could lag a successful publish by many minutes. **Fetch update** likewise pulls the wheel artefact from PyPI and extracts the cached payload from inside it, so a successful fetch reliably matches what the check reports and clears the "update available" badge. Override the index URL with `CAPABILITY_CATALOGUE_PYPI_URL` for airgapped or private-mirror deployments (the previous `CAPABILITY_CATALOGUE_URL` env var no longer applies).

## [0.52.0] - 2026-04-28

### Fixed
- Disabled (`is_active=false`) users no longer appear in owner / assignee / stakeholder pickers across the app. `GET /users` now excludes inactive accounts by default; the Users admin page opts back in via `?include_inactive=true` so admins can still see and re-enable disabled users.
- Dashboard Recent Activity no longer leaks raw translation keys (e.g. `dashboard.activity.action.risk.added`) for the new event types. Added action labels for all stakeholder / relation.updated / risk / document / file events in every supported locale, and gave them dedicated icons + colours (group / report / attachment) instead of falling into the generic "other" bucket. The fallback path is now resilient to the i18n config (`returnEmptyString: false` makes missing keys resolve to themselves), so any future backend event type renders as _"performed {{type}}"_ instead of the raw key. Locked in with a regression test.

### Changed
- Capability Catalogue's filter + action bars and the bulk-import bar at the bottom no longer stick on mobile (`xs` breakpoint). They scroll with the page so they don't eat scarce vertical space on small phones; on tablets and desktops they still stick as before.

### Added
- Card history now records changes to **Stakeholders**, **Relations**, **Risks**, and **Resources** (document links + file attachments), in addition to the existing card-level events. New event types: `stakeholder.added`, `stakeholder.role_changed`, `stakeholder.removed`, `relation.updated`, `risk.added`, `risk.updated`, `risk.removed`, `document.added`, `document.removed`, `file.uploaded`, `file.deleted`, plus a label for `comment.created`. Relations now log on both the source and target card so the change shows up wherever you open history. Each new entry shows a one-line summary (peer card name, role, risk reference + level, etc.) below the actor + timestamp. Translated for all 8 supported UI locales.
- Relation entries in card history now show the human-readable relation label from the metamodel (e.g. _supports_ / _supported by_ instead of the raw key), pick the forward or reverse label depending on which side you're viewing from, and link the peer card name (with its type icon) directly to its detail page. Risk entries link the `R-NNNNNN` reference to the risk register and show a coloured level chip (critical / high / medium / low). Document-link events render the document name as a clickable external link.

## [0.51.0] - 2026-04-28

### Changed
- Capability Catalogue's **filter bar** and **action bar** now stick just below the top navigation as you scroll, so the search field, level chips, industry filter, deprecated toggle, match counters, level stepper, and select-visible / clear-selection buttons stay reachable even when you're deep inside an L1 subtree. A subtle drop-shadow (tuned for both light and dark modes) separates the sticky band from the grid content scrolling underneath.
- Capability Catalogue's **L1 grid** is now grouped under industry headings. The pinned **Cross-Industry** group always renders first; other industries follow alphabetically; capabilities with no industry tag fall into a localised **General** bucket pinned to the bottom. Filtering by industry collapses every other group out of the view.

### Added
- Capability Catalogue gained a floating **back-to-top** button (a circular Material `Fab` with an upward arrow) that fades in once you've scrolled 300 px past the header and smoothly scrolls the page back to the top on click. The button auto-slides up to clear the bulk **Create N capabilities** sticky bar whenever capabilities are selected, so it never overlaps the import action. Translated for all 8 supported UI locales (en/de/fr/es/it/pt/zh/ru).

## [0.50.2] - 2026-04-28

### Fixed
- Creating a new relation type from the Metamodel admin no longer leaves the **Create** button silently disabled. The auto-generated key was being prefilled in `source_to_target` (snake_case) form, which the key validator correctly rejects (no underscores), but the validation error stayed hidden until the user touched the field — so the only visible symptom was a greyed-out button with no explanation. The auto-generated key now follows the same `relSourceToTarget` camelCase convention used by all built-in relation types (e.g. `ApplicationToITComponent`), so the prefilled value is valid by default and the dialog works as expected.
- Key-input helper text now matches what the validator actually accepts. The hint previously said "camelCase (e.g. businessFit)", but the validator allows any letters/digits sequence starting with a letter — so PascalCase keys like `BusinessCapability` or `ApplicationToITComponent` (the same convention used by all built-in card types and the auto-prefilled relation key) are equally valid. Hint reworded to "Letters and digits only, no separators (e.g. businessFit or ApplicationToITComponent)" and translated for all 8 supported UI locales (en/de/fr/es/it/pt/zh/ru).
- Removed snake_case examples from key-input labels and placeholders that contradicted the validator. The Metamodel admin's "Key" field used to show `Key (e.g. my_custom_type)` and the new stakeholder role panel showed `e.g. data_steward` — both contained underscores that the validator rejects. Updated to `myCustomType` and `dataSteward` respectively, in all 8 supported UI locales.

## [0.50.1] - 2026-04-28

### Changed
- Capability Catalogue's **Industry filter** restyled to match the public reference catalogue at `https://capabilities.turbo-ea.org/`. The trigger is now a single rounded button with a bold uppercase **INDUSTRY** label baked in alongside the value (`All`, the industry name, or `{n} selected`) and a chevron. The popover pins **Cross-Industry** at the top above a hairline separator, surfaces a magenta `Clear ({{count}})` row whenever any items are selected, and washes selected rows in soft navy with a filled-navy checkbox. The trigger has a fixed width and the menu's anchor is captured on open so the popover no longer drifts when filtering the catalogue resizes the page (scrollbar appearing/disappearing was reflowing the filter row); the menu remains vertically scrollable when the industry list overflows the viewport. Translated for all 8 supported UI locales (en/de/fr/es/it/pt/zh/ru).

## [0.50.0] - 2026-04-27

### Changed
- Dashboard's **Recent Activity** panel redesigned. Each entry is now a timeline row with a category-coloured icon (created / edited / approved / rejected / archived / deleted / relation / comment / process / ADR / SoAW) sitting on a vertical rail that runs below each dot, a natural-language sentence ("Vincent approved **NexaCore ERP**") with the card name as a clickable link to the card detail, and a relative timestamp ("3 minutes ago") that reveals the absolute time on hover. Approvals and edits now always show the affected card by name — `/reports/dashboard` resolves names server-side via a single batch lookup so legacy events whose payload only carries `card_id` (`card.updated`, `card.approval_status.*`, etc.) still link correctly. Entries are grouped under day separators (Today, Yesterday, Mon Apr 27) and consecutive same-user same-card edits collapse into a single row ("Vincent made 4 edits to NexaCore ERP") — for per-field detail, users open the affected card and consult its History tab. New tab filters at the top of the panel — All / Cards / Approvals / Relations / Comments — let users focus on the activity stream they care about. Translated for all 8 supported UI locales (en/de/fr/es/it/pt/zh/ru).

## [0.49.6] - 2026-04-27

### Added
- **UI guidelines and design tokens**. A new `frontend/src/theme/tokens.ts` module is now the single source of truth for color, spacing, radius, icon-size, and typography values used across the frontend — with semantic names (`STATUS_COLORS.success`, `SEVERITY_COLORS.high`, `APPROVAL_STATUS_COLORS.APPROVED`, `LAYER_COLORS["Application & Data"]`, `CARD_TYPE_COLORS.Application`, `VENDOR_ACCENT.fill`, `TIMELINE_COLORS.past`, etc.) instead of raw hex codes. The MUI theme now wires `success`/`warning`/`error`/`info` palette entries to these tokens so existing `<Chip color="…">` and `<Alert severity="…">` consumers automatically resolve to the canonical values, and a new `frontend/UI_GUIDELINES.md` document codifies layout patterns, button/dialog/form/table conventions, status representation, accessibility, and a full color-token reference table — written from what the app already does, so nothing changes visually.

### Changed
- Refactored duplicated color maps to import from the new tokens module: `APPROVAL_STATUS_COLORS` (Inventory + Dashboard), `DATA_QUALITY_COLORS` and lifecycle phase colors (Dashboard), `MATURITY_COLORS` + `RISK_COLORS` + chart palette (BPM Dashboard), `PRIORITY_COLORS` (PPM task card), `LAYER_COLORS` (C4 layout), `VENDOR_ACCENT` (VendorField), `TIMELINE_COLORS` (TimelineSlider), and the AI suggestion confidence colors (AiSuggestPanel). The hardcoded `gap: "4px"` in ColorPicker now uses the MUI scale (`gap: 0.5`). `SearchDialog` keeps its custom `DialogContent` `p: 0` padding but is now annotated as the documented exception.



### Changed
- Card title is now editable directly at title level on the card detail page. Hovering the title reveals an edit pencil; clicking it swaps the heading for an inline text field with Save / Cancel buttons (Enter saves, Escape cancels). The redundant Name field has been removed from the Description panel's edit form, which now only edits description and extra fields. Permission gating (`card.edit`) and archived-card protection match the rest of the page.

## [0.49.4] - 2026-04-27

### Fixed
- Codespaces demo no longer 502s on the forwarded port. Three independent issues compounded into the same symptom: (1) the bundled `db` service in `docker-compose.db.yml` is `postgres:18-alpine`, and pg18 introduced a multi-version on-disk layout — by default data goes to `/var/lib/postgresql/18/docker` and the entrypoint refuses to start if it sees a non-empty `/var/lib/postgresql/data` (which a fresh Docker named-volume mount always presents, since the mount target is created by Docker before pg ever runs). The container restart-looped on every start, the backend and frontend never came up because they `depends_on` a healthy db, and port 8920 had nothing listening — fixed by setting `PGDATA: /var/lib/postgresql/data` on the db service, which tells pg18 to keep using the legacy data path the compose volume already mounts. This keeps existing pg17→pg18 upgrades seamless (the data path is unchanged for everyone) and unblocks fresh installs. (2) The `postCreateCommand` health-check was calling `curl` inside the backend container, but the `python:3.12-alpine` runtime image doesn't ship `curl`, so the wait loop returned a false negative on every iteration and silently exited 0 — the user opened port 8920 before the stack was actually serving. The check now hits `http://localhost:8920/api/health` from the codespace host, which validates the full chain (nginx → backend → db) the user's browser will hit, with a longer 8-minute budget for first-run `SEED_DEMO=true` builds on 2-core machines. (3) The script aborted with a non-zero exit on any `docker compose up` failure (showing a red cross next to the postCreateCommand step) and produced no diagnostics — it now retries the build once on transient network failures, always exits 0, and prints `docker compose ps` plus recent backend/frontend logs whenever the readiness probe times out so the user can see what to fix instead of staring at an opaque 502. A new `postStartCommand` (`.devcontainer/start-demo.sh`) re-runs `docker compose up -d` whenever the codespace is resumed, so containers come back automatically after a stop/start cycle (the dockerd from the docker-in-docker feature boots fresh each time and `restart: unless-stopped` alone wasn't enough). The `POSTGRES_PASSWORD` is now generated with `openssl rand` instead of using the hard-coded `demo-codespaces`, and re-running the setup script preserves the existing `.env` so cached JWTs stay valid.

## [0.49.3] - 2026-04-27

### Added
- Capability Catalogue browser now follows the active UI language. When the user picks any of the 8 supported UI locales (en/de/fr/es/it/pt/zh/ru), the catalogue renders capability names, descriptions, aliases, and scope notes in that language if the bundled `turbo-ea-capabilities>=2026.4.27` package ships translations for it — falling back silently to English per-field when a translation is missing. The integration is fully locale-agnostic: it feature-detects via `available_locales()` at request time, so any future upstream translation drop (DE/ES/IT/PT/ZH/RU) lights up automatically with just a package version bump — no Turbo EA code change. Today the wheel ships English + French, so the other 6 UI locales render English and the response advertises that explicitly via `active_locale: "en"` in the version metadata. BCP-47 regional tags (`fr-FR`, `pt-BR`, etc.) from `navigator.language` are normalized to their primary subtag so first-time visitors who haven't picked a locale from the menu yet still see the correct translations. Existing-card matching, the import path, and the catalogueId hierarchy all stay on canonical English so a user switching languages mid-session never sees a green tick disappear or imports cards under non-English names. The remote-cached catalogue (`https://capabilities.turbo-ea.org`) is unaffected — it serves English only and is reported as `active_locale: "en"`.

## [0.49.2] - 2026-04-26

### Changed
- Capability Catalogue browser: capability text sizes now match the public reference catalogue at `https://capabilities.turbo-ea.org/`. L1 names go from 15px/700 to 14px/600, L2/L3+ row names from 14px/500 to 13px/500, the L-level pill from 10px/700 to 11px/600, and the detail-modal tree name/description from 13/12px to 14/13px. Cap-count and cap-id badges already matched the reference and are unchanged.

## [0.49.1] - 2026-04-26

### Changed
- Capability Catalogue browser: the selected-state ring and row wash now use the magenta `#D63384` accent from the public reference catalogue at `https://capabilities.turbo-ea.org/`, with the matching pink wash on row backgrounds and a magenta-tinted MUI checkbox. The brand navy `#003399` is kept for the L1 type-icon prefix, the L1 name, and hover — so chrome stays navy and selection visibly pops in pink, mirroring the reference site's convention. Dark mode uses the lifted pink `#f472b6` for the same role on `#1e1e1e` paper.

## [0.49.0] - 2026-04-26

### Added
- **Capability Catalogue** browser, accessible from the user menu (top-right profile icon). Browse the bundled Business Capability reference catalogue (filter by level, industry, search), select any combination of capabilities, and **mass-create** them as `BusinessCapability` cards in one action. Existing capabilities (matched by display name, case-insensitive) show a green tick instead of a checkbox and are skipped on import — re-runs are idempotent. Hierarchy from the catalogue is preserved automatically and is repaired in both directions: when both parent and child are in the same batch, or when one side already exists locally as a top-level card, `parent_id` is wired correctly. Manual nestings (an existing card whose `parent_id` is already set) are never overwritten, and the import response includes a `relinked` count alongside `created` and `skipped`. Card creation goes through the regular `inventory.create` permission.
- Each L1 card on the catalogue browser carries a `−` / `+` stepper pill in its header that walks the subtree one level at a time — `+` opens the next level of descendants, `−` closes the deepest open level. The two buttons are always visible (the inactive direction goes disabled), the action is scoped to that one L1 only so other branches stay put, and the global level stepper at the top of the page is unaffected.
- The catalogue browser has been retuned to align with the rest of the app's hierarchy conventions (`HierarchySection`, `CapabilityMapReport.CapabilityCard`, `PpmTaskCard`): depth is now read from indentation and a typography step-down on neutral paper surfaces, with the brand navy `#003399` reserved for the L1 type-icon prefix (`account_tree`), the L1 name, and the selected-state ring. The earlier per-level blue gradient on row backgrounds has been removed so the page no longer reads as wall-to-wall blue; nested levels are signalled by indent + a faint vertical rail. Names wrap onto multiple lines instead of being truncated. Dark mode mirrors the same neutral approach on `#1e1e1e` paper with lifted-lavender text.
- Existing-card detection (the green tick + the import re-link logic) now matches on `attributes.catalogueId` first, falling back to a case-insensitive display-name match. So a card previously imported through the catalogue and then renamed by hand is still recognised as "already exists" — and still gets re-parented under a newly-created catalogue parent in the same import. The relink walk now applies **unconditionally** when the catalogue parent is created in the same import: every matched child has its `parent_id` set to the new parent regardless of any pre-existing value (NULL, archived, or hand-nested under another card). The catalogue hierarchy is the source of truth on import; users who want a different layout can adjust the card's parent afterwards. The write goes through an explicit SQL UPDATE so the new value lands in the row independent of any session-state quirks.
- L1 checkbox semantics: the tick state now reflects only L1's own membership in the selection. Selecting L1 cascades down (so the subtree gets ticked too), but unticking an L2/L3 leaves the L1 checkbox visibly ticked — it's still in the selection. The indeterminate state is reserved for the case where L1 itself isn't selected but some of its descendants are.
- Selection on the catalogue browser cascades down the subtree in both directions, but never touches ancestors: ticking an unselected capability adds it plus every selectable descendant, unticking a selected capability removes it plus every selectable descendant. So unticking a parent collapses the whole subtree, while unticking a single child leaves its parent and siblings selected — making "L1 + a couple of leaves" achievable by selecting the parent and then pruning intermediate L2/L3 you don't want.
- The catalogue itself ships as a bundled Python dependency (`turbo-ea-capabilities` on PyPI), so the page works offline / in airgapped deployments. Admins (`admin.metamodel`) get **Check for update** and **Fetch update** controls that talk to the public catalogue at `https://capabilities.turbo-ea.org` and cache a newer version into `app_settings.general_settings.capability_catalogue` — a server-side override that wins over the bundled package only when its version is strictly greater. The remote URL is configurable via `CAPABILITY_CATALOGUE_URL`.

## [0.48.1] - 2026-04-23

### Changed
- Risk Register detail: the **Affected cards** picker now lives inside the **Identification** section (linking a card is part of identifying what the risk touches), and the inline card search fires on the first character typed instead of waiting for the second.

## [0.48.0] - 2026-04-22

### Added
- Mandatory relations and mandatory tag groups now gate card approval. Marking a `RelationType` as `source_mandatory` / `target_mandatory`, or a `TagGroup` as `mandatory`, blocks the **Approve** action with a clear in-page list of what's missing until the card has at least one matching relation / tag. The `data_quality` score now also reflects mandatory coverage so the indicator drops when a requirement is unmet.
- "Required" visual cues on the Card Detail: relation types render the existing `Required` chip when the corresponding side is mandatory, mandatory tag groups display a red asterisk in the **Tags** section (with a tooltip), and unsatisfied mandatory tag groups now appear as empty-state rows so users can discover the requirement before they hit Approve. The shared TagPicker dropdown group headers also annotate mandatory groups with `*`.
- `restrict_to_types` is now editable on tag groups via `POST /tag-groups` and `PATCH /tag-groups/{id}` (previously only seedable). The PATCH response also surfaces the current value.

### Removed
- Unused `tag_groups.create_mode` column. It was pre-Alembic scaffolding never written or read by anything in the codebase. Migration `065_drop_tag_groups_create_mode` drops the column with a symmetrical downgrade.

## [0.47.0] - 2026-04-22

### Added
- Card tagging: every card now has a **Tags** section on its detail page, sitting just before Relations on all 14 built-in card types. Users can attach tags via a group-aware picker that respects single-vs-multi mode and `restrict_to_types` scoping, and chips render with the tag's configured colour.
- Tags can also be selected at card creation time from the New Card dialog — they're attached to the new card immediately after it's saved.
- Inventory: new **Tags** column rendering up to three coloured chips with a "+N" overflow, plus a **Tags** filter section in the sidebar (one multi-select per applicable tag group, OR-within-group and AND-across-groups semantics, same as relation filters). Selections persist in saved views / bookmarks automatically.
- Excel import/export round-trips tags through a new `Tags` column formatted as `Group: Tag, Group: Tag`. Unknown tag entries surface as per-row warnings rather than blocking errors.
- Web Portal viewer: one select per tag group in the filter panel, sends the selection as `?tag_ids=...` to the existing public backend query.
- Demo seed: the **Business Domain** tag group now covers Organizations, Business Capabilities, Initiatives and the IoT platform as well as Applications; plus three new groups — **Initiative Theme** (Digital / Growth / Cost-Out / Compliance), **Data Sensitivity** (Public / Internal / Confidential, restricted to Data Objects) and **Provider Tier** (Strategic / Preferred / Commodity, restricted to Providers).

### Changed
- `POST /cards/{id}/tags` and `DELETE /cards/{id}/tags/{tag_id}` now accept **either** `tags.manage` (admin) **or** `card.edit` on the target card, so a normal card editor can tag their own card without admin rights. Tag-group / tag CRUD stays `tags.manage`-only.
- `GET /tag-groups` now also returns `restrict_to_types` so the new picker can scope groups per card type.

## [0.46.0] - 2026-04-22

### Added
- Tag Management admin: tag groups and individual tags can now be renamed, recoloured, and deleted — previously only creation was supported. Deleting a tag group removes its tags from every card; deleting an individual tag removes only that tag from the cards it was assigned to.

## [0.45.0] - 2026-04-22

### Added
- General Settings: new **Application Title** setting, in the same spirit as the custom logo and favicon. The configured title propagates to the browser tab, image `alt` text on the navbar and login page, and the header/footer of outgoing notification emails. A public `GET /settings/app-title` endpoint lets unauthenticated surfaces (login page, browser tab) render the customized title.

### Changed
- Risk Register: the matrix on the register and detail pages now uses the same risk-level color palette as the TurboLens Security risk matrix, derived from the probability × impact level (critical / high / medium / low), with a shared color legend rendered below each matrix.
- Risk Register: the matrix axis caption is now read as **Impact → / Probability ↓** so the horizontal axis is announced first.
- TurboLens Security risk matrix now shares the Risk Register color helper and legend, and the same colors appear on both surfaces.

### Removed
- Risk Register: the **Architect AI** risk source has been removed from the source filter. No feature created risks from this source; the option was misleading and was never written to the database.

## [0.44.1] - 2026-04-22

### Fixed
- BPM: Pre-linking elements in a draft process flow now shows the available Application, Data Object, and IT Component cards immediately when a cell is clicked, instead of requiring the user to type before any options appear

## [0.44.0] - 2026-04-21

### Added
- TurboLens Security & Compliance scan — new on-demand tab that queries the NIST NVD for CVEs affecting every Application and IT Component in the landscape, prioritises each finding with AI (business impact, remediation, priority, probability), and produces a CVSS-standard risk report with a 5×5 probability × severity matrix, filterable table, drawer detail, status workflow (open → acknowledged → in progress → mitigated / accepted), and CSV export
- TurboLens compliance gap analysis against EU AI Act, GDPR, NIS2, DORA, SOC 2 and ISO 27001, with a compliance heatmap, per-regulation scores, and links back to the offending cards
- EU AI Act semantic AI detection — cards that embed AI (LLMs, recommendation engines, fraud / credit scoring, chatbots, predictive analytics) are flagged even when their subtype is not `AI Agent` / `AI Model`, with an "AI-detected" badge on the resulting findings
- Optional `NVD_API_KEY` environment variable to raise NVD rate limits from 5 req/30 s to 50 req/30 s

### Changed
- TurboLens Security & Compliance — the single "Run scan" button is split into **two independent scans**: CVE scan and Compliance scan. Each has its own background task, progress bar (phase + current/total), and status card on the Overview tab. The compliance scan lets the user pick which regulations to include via checkboxes, and never wipes CVE findings (and vice versa).
- Security scan progress now streams into the analysis-run row, so the UI shows a phase-aware progress bar (loading cards → querying NVD → AI prioritisation → saving findings, or loading cards → semantic AI detection → per-regulation check). A page refresh no longer interrupts the scan: on mount the tab queries `/turbolens/security/active-runs` and reattaches the poll loop to any scan still in progress.
- TurboLens risk matrix is now **clickable** — click a probability × severity cell to jump to the CVEs tab filtered to that bucket, and clear with the chip that appears above the table.

### Added (EA Risk Register)
- New **Risk Register** under EA Delivery (`/ea-delivery/risks`) aligned to TOGAF ADM Phase G. Captures the full risk lifecycle: identification → analysis → mitigation planning → residual assessment → monitoring → closure (with a separate accepted branch that requires an explicit rationale).
- Risks are **many-to-many** with Cards: one risk can span multiple Applications / IT Components, and each Card detail page has a new **Risks** tab showing every risk linked to it.
- **Promote a finding to a risk** from any TurboLens CVE drawer or compliance finding — one click creates a risk with prefilled title, description, category, probability, impact, mitigation, and the affected card link. Already-promoted findings flip to **Open risk R-000123** so the relationship stays visible and idempotent.
- Risk matrix on the register header is toggleable between **Initial** and **Residual** views so mitigation progress is visible at a glance.
- Seed-demo data ships five demo risks (identified → analysed → in_progress → mitigated → accepted) so a fresh install has content.

### Security
- New `security_compliance.view` and `security_compliance.manage` permissions; granted to admin by default (view also granted to bpm_admin, member and viewer).
- New `risks.view` and `risks.manage` permissions; view granted to admin, bpm_admin, member, viewer; manage granted to admin, bpm_admin, member.

## [0.43.1] - 2026-04-21

### Fixed
- Card archive and delete confirmation dialogs now correctly render the card name in bold instead of showing literal `<strong>` tags

## [0.43.0] - 2026-04-14

### Added
- Dashboard KPI tiles (Total Cards, Avg Completion, Approved, Broken) now show a coloured trend indicator comparing the current value to a snapshot from up to ~30 days ago, including the absolute change (e.g. "+5") and the comparison window ("vs last 30 days"). Backed by a new daily `kpi_snapshots` capture. On fresh installs the indicator falls back to the oldest available snapshot so trends appear from day 2 instead of waiting a full 30 days, and displays a muted "Collecting trend data…" placeholder until the first prior snapshot is recorded (vincentmakes/turbo-ea#418)

## [0.42.5] - 2026-04-07

### Changed
- Renamed ArchLens to TurboLens across the entire codebase (routes, components, database tables, permissions, translations, documentation)

## [0.42.4] - 2026-03-26

### Added
- GitHub Codespaces support for one-click demo — new `.devcontainer/` config auto-builds and starts a fully seeded demo instance in the browser with zero local installs

## [0.42.3] - 2026-03-24

### Changed
- Replaced the top-bar search field with a compact search icon button that opens a modal dialog (Cmd/Ctrl+K shortcut supported)

## [0.42.2] - 2026-03-17

### Added
- Docs: Embedded YouTube overview video in the Architecture AI section of the TurboLens guide (all 8 locales)

## [0.42.1] - 2026-03-17

### Fixed
- TurboLens: Previously selected solution option is now visually highlighted with a border and "Selected" badge when navigating back to the Solution Options step
- TurboLens: Pointer cursor now correctly appears on all reachable stepper steps, including forward steps when navigating back

### Changed
- Docs: Remove screenshot placeholders from the TurboLens guide pages (all 8 locales) and the screenshot automation script
- Docs: Document clickable stepper navigation and selected option highlighting in the Architecture AI section

## [0.42.0] - 2026-03-16

### Added
- Inventory: Dynamic columns tab in the side panel — choose which attribute, relation, and metadata columns to display in the grid
- Inventory: Metadata columns (Created, Modified, Created by, Modified by) available as optional grid columns
- Inventory: When multiple card types are selected, common fields across all types are offered as column options
- Inventory: Column search and select-all/clear-all controls for efficient column management
- TurboLens: Navigate between phases in the Architecture AI wizard by clicking any previously-reached stepper step — viewing previous answers preserves all downstream progress; data is only cleared when re-submitting a phase

## [0.41.0] - 2026-03-16

### Added
- TurboLens: Resume saved assessments — non-committed assessments can be reopened into the interactive Architecture AI wizard with full state restored (answers, selections, options, gap analysis)
- TurboLens: Resume button on the Assessments list and the read-only Assessment Viewer for quick access
- TurboLens: Re-save assessments after changing approach — PATCH updates the existing assessment instead of creating a new one

### Fixed
- TurboLens: Phase transition from Technical Fit to Solution no longer shows stale gap analysis data from a previous assessment stored in the browser session

## [0.40.0] - 2026-03-15

### Added
- TurboLens: Commit & Create Initiative from Phase 5 target architecture assessment — creates Initiative card, new component cards with AI-generated descriptions, relations, and a draft ADR in one action
- TurboLens: Assessment persistence with save/commit workflow and read-only assessment history viewer
- New Assessments tab in TurboLens navigation for browsing saved and committed architecture assessments
- TurboLens: Phase 5 guardrails enforce Application → Business Capability and Business Capability → Objective relations automatically
- TurboLens: Orphan cards with no relations are automatically removed from architecture proposals
- TurboLens: Initiative name defaults to the selected solution option title
- TurboLens: AI disclaimer banner on Architecture AI wizard informing users that output requires professional review

### Fixed
- TurboLens: ADR decision field now correctly captures selected products and recommendations instead of index references
- TurboLens: Initiative description summarizes the full assessment context instead of generic AI-generated text
- TurboLens: Cross-layer edges (e.g., Application → Business Capability) now render correctly in C4 diagrams
- TurboLens: New Business Capabilities appear in the Proposed New Cards list for selection and renaming before commit
- TurboLens: Changing approach properly re-saves the assessment with updated session data

## [0.39.1] - 2026-03-15

### Added
- Comprehensive user documentation for the TurboLens AI Intelligence module covering all features: dashboard, vendor analysis, vendor resolution, duplicate detection, modernization assessment, and the 5-step Architecture AI wizard — in all 8 supported locales
- Expanded CLAUDE.md TurboLens section with full API route table, Architecture AI flow description, and frontend component reference
- Automated screenshot entries for all 6 TurboLens pages in all 8 locales

## [0.39.0] - 2026-03-15

### Added
- Architecture AI Phase 3a now asks users to select Business Objectives and uses AI to map capabilities, propose new cards, and visualize the dependency impact
- Objective search autocomplete with debounced backend search for existing Objective cards
- Capability mapping AI function that analyzes existing dependencies, identifies relevant Business Capabilities, and proposes new cards fitting the metamodel
- Dependency diagram view using the C4DiagramView component to visualize existing and proposed architecture
- Proposed components shown with dashed borders and green "NEW" badge in dependency diagrams
- New backend endpoints: `GET /turbolens/architect/objectives` and updated `POST /turbolens/architect/phase3/options` with objective-based capability mapping
- Full i18n support for capability mapping UI across all 8 locales

### Changed
- Architecture AI Phase 3a flow replaced option cards with objective-driven capability mapping and dependency visualization
- Architecture diagram layout switched from dagre to deterministic grid for consistent cross-layer rendering

## [0.38.0] - 2026-03-14

### Added
- TurboLens AI Intelligence module — AI-powered vendor analysis, duplicate detection, modernization assessment, and 3-phase architecture AI, ported from [ArchLens](https://github.com/vinod-ea/archlens) (MIT License, by [Vinod](https://github.com/vinod-ea)) and integrated natively into Turbo EA
- Vendor categorisation across 45+ industry categories with AI-driven sub-category and reasoning
- Vendor resolution that groups aliases and product variants into a canonical vendor hierarchy
- Duplicate detection using union-find clustering to identify functionally overlapping cards
- Modernization assessment that evaluates effort, priority, and recommendations per card type
- 3-phase Architecture AI: business clarification, technical deep-dive, and full architecture generation with Mermaid diagrams and landscape cross-referencing
- Multi-page TurboLens UI: Dashboard, Vendors, Resolution, Duplicates, Architect, and History pages
- TurboLens navigation section with sub-items (visible when AI is configured)
- New permissions: `turbolens.view` (granted to admin, bpm_admin, member) and `turbolens.manage` (admin only)
- Background task execution with polling for long-running AI analyses
- Five new database tables: `turbolens_vendor_analysis`, `turbolens_vendor_hierarchy`, `turbolens_duplicate_clusters`, `turbolens_modernization_assessments`, `turbolens_analysis_runs`
- Full i18n support for TurboLens UI across all 8 supported locales
- User documentation for TurboLens module in all 8 supported locales

## [0.37.2] - 2026-03-13

### Fixed
- Edge labels in C4 diagrams now have a semi-opaque background for better readability
- Overlapping edge label clusters are automatically spread apart vertically
- Edge highlighting responds reliably during fast mouse movement between cards

## [0.37.1] - 2026-03-13

### Added
- Hover highlighting of connected cards and edges in C4 diagram view
- Highlight mode toggle button in C4 diagram controls for touch devices (iPad)

## [0.37.0] - 2026-03-13

### Added
- C4 diagram section on card detail page showing dependency neighborhood centered on the current card
- Section appears at bottom of Card tab for all card types with lazy loading on expand
- Full navigation support: shift+click, long press, back/forward arrows, and home button to re-center on current card
- Section hidden in side panel to avoid recursion when opened from dependency report

## [0.36.1] - 2026-03-13

### Changed
- Optimized Docker build context by excluding docs, marketing-site, and scripts directories (~80 MB reduction)
- Backend Dockerfile uses multi-stage build to exclude gcc/musl-dev build tools from final image

## [0.36.0] - 2026-03-12

### Added
- Expanded demo seed data with comments, stakeholders, history events, diagrams, saved reports, surveys, todos, documents, and bookmarks
- Standalone script (`scripts/seed_extras.py`) to populate extra demo data on existing databases
## [0.35.0] - 2026-03-12

### Added
- Navigation bar in C4 diagram view with home, previous, and next buttons for browsing cards
- Home button in tree view for returning to the card picker
- Hover-only C4 navigation icon on cards in picker and tree view to jump directly to C4 diagram

### Changed
- C4 diagram is now the default view in the Dependency Report (was tree view)
- Removed minimap from C4 diagram view for a cleaner display

## [0.34.2] - 2026-03-12

### Added
- UML, C4, Azure, and SAP shape libraries in the DrawIO diagram editor sidebar

## [0.34.1] - 2026-03-12

### Added
- Installation & Setup guide in README and user documentation covering seed demo data (BPM, PPM), Docker Compose options (embedded vs external database), environment configuration, and optional AI/MCP profiles — available in all 8 supported languages

## [0.34.0] - 2026-03-12

### Added
- C4 diagram view toggle in the Dependency Report — switch between the existing tree view and a C4-notation diagram powered by React Flow, with nodes grouped by architectural layer, directional labeled edges, pan/zoom, and minimap

## [0.33.0] - 2026-03-12

### Added
- Signature recall workflow for SoAW and ADR — authors and admins can recall pending signature requests, resetting the document to draft
- Signature rejection workflow for SoAW and ADR — signatories can reject with a comment, resetting the document to draft with an incremented revision number
- Notifications sent to all affected parties on recall and rejection

### Changed
- Status dropdown on SoAW editor no longer shows "In Review" or "Signed" — these states are only reachable via the proper workflow buttons
- Direct status changes to "in_review" or from "in_review" to "draft" via PATCH are now blocked on both SoAW and ADR endpoints

## [0.32.6] - 2026-03-12

### Added
- Demo seed data for 3 SoAW documents and 4 additional ADRs in the EA Delivery module
- Standalone script (`scripts/seed_soaw_adrs.py`) to seed SoAW and ADR demo data on existing databases

### Changed
- Added MCP server conventions, ADR and file attachment routes, and missing env vars to CLAUDE.md
- Fixed DrawIO version in README (v29.5.1 → v26.0.9) and expanded environment variables table
- Added MCP server tests and docs build validation to CI pipeline
- Added version bump, i18n, and docs update reminders to PR template checklist
- Set mkdocs.yml site_url to actual docs domain instead of placeholder
- Updated locale count from seven to eight across all documentation (Russian added in v0.30.0)
- Expanded admin index page from stub to comprehensive overview of all admin pages (all 8 locales)
- Added Fiscal Year Start, PPM Module toggle sections to admin settings docs (all 8 locales)
- Added fiscal year budget grouping reference and WBS completion rollup details to PPM guide (all 8 locales)
- Added metamodel translations section documenting the Translation Dialog (all 8 locales)
- Completed Spanish translation of ServiceNow integration documentation
- Added Fiscal Year, OData Feed, and BPM Row Order terms to glossary (all 8 locales)

## [0.32.5] - 2026-03-11

### Changed
- Renamed navigation label from "Delivery" to "EA Delivery" to distinguish from PPM
- Added page subtitle on the EA Delivery page explaining its TOGAF alignment and purpose

### Fixed
- Stakeholder roles in card details now display translated labels instead of raw keys
- Stakeholder role labels are now included in the metamodel translation management dialog
- Stakeholder role panel in metamodel admin now supports inline label translations

## [0.32.4] - 2026-03-11

### Added
- URL persistence for PPM tab selection, task board filters, and portfolio grouping across page refreshes
- Backend integration tests for all PPM API endpoints (status reports, costs, budgets, risks, tasks, WBS, task comments, completion)
- Backend integration tests for PPM portfolio report endpoints (dashboard, gantt, group-options)
- Frontend unit tests for the `usePpmEnabled` hook
- PPM user guide documentation page in all 8 supported languages
- PPM-related terms added to the glossary in all 8 supported languages
- PPM screenshot definitions added to the automated screenshot capture script

## [0.32.3] - 2026-03-11

### Added
- Gantt table shows start date and end date columns alongside the title for at-a-glance visibility
- Create Task button in Gantt toolbar to add tasks directly from the Gantt view
- Work Package selector now visible when editing tasks from the Gantt tab
- Right-click context menu on Gantt rows for quick edit, add task, mark done, and delete
- Context menu also available on the table list side (right-click on rows)
- Delete confirmation dialogs for both WBS items and tasks to prevent accidental deletion
- Delete button in task edit dialog (previously only available from the Task Board)
- Progress bar dragging on WBS items to adjust completion directly in the Gantt chart
- Task bars use distinct blue color to visually differentiate them from WBS summary bars
- Resizable table columns in Gantt (drag column borders to adjust width)

### Changed
- Gantt bar label text is now white for better contrast on colored bars
- Gantt chart uses full page width for more timeline space
- Date columns use compact format (dd MMM 'yy) to prevent cropping
- Today button in Gantt toolbar now scrolls the chart to the current date
- PPM navigation icon changed to view_kanban

## [0.32.2] - 2026-03-11

### Added
- PPM budget/cost rollup: budget and cost line totals automatically sync to Initiative card attributes (costBudget/costActual)
- Cost fields marked as auto-computed (readonly with badge) in Card Detail when PPM lines exist
- New endpoint `GET /ppm/initiatives/{id}/has-costs` for lightweight PPM cost existence check

### Changed
- Portfolio dashboard group headers use darker background for better visual separation
- Gantt bar resizing no longer jumps to week/month boundaries — custom `roundDate` ensures smooth 1-day snapping

### Fixed
- Gantt bar drag/resize caused bars to snap to week or month boundaries instead of individual days

## [0.32.1] - 2026-03-11

### Changed
- Gantt chart bar resizing is now 1-day granular regardless of zoom level (day/week/month)
- PPM color palette aligned with MUI theme (primary, success, warning, error) across all components
- Financials KPI and Budget/Costs cards merged into a single combined card in project overview
- Card Details tab in PPM project detail now shows full card detail with all tabs (comments, todos, stakeholders, resources, history)

### Removed
- Standalone PpmCardDetailsTab component replaced by reusable CardDetailContent

## [0.32.0] - 2026-03-10

### Added
- Project Portfolio Management (PPM) module with enable/disable toggle in admin settings
- Portfolio dashboard with KPI cards, health pie charts, and status distribution
- Gantt chart with quarterly ticks, timeline bars, RAG health indicators, and budget progress
- Per-initiative detail view with overview, monthly status reports, and task management tabs
- Status reports with RAG health tracking (schedule/cost/scope), cost line items (CapEx/OpEx), and risk register
- AG Grid-based task manager with filter sidebar, inline editing, and assignee management
- New permissions: `ppm.view`, `ppm.manage`, `reports.ppm_dashboard`
- Database tables: `ppm_status_reports`, `ppm_tasks`

## [0.31.0] - 2026-03-10

### Added
- Subtype sub-templates: each subtype can now control field visibility, hiding irrelevant fields from card detail and creation forms
- Hidden fields are excluded from data quality scoring so users are only scored on visible fields
- Subtype template editor in the metamodel admin with per-field visibility toggles
- Last login date/time column on the User Management admin page

## [0.30.0] - 2026-03-10

### Added
- Russian language support for the application and documentation (8th supported locale)

## [0.29.0] - 2026-03-09

### Added
- Artefact filter toggle (with/without artefacts) on Initiatives tab
- Search field in Link Diagrams dialog for quick filtering
- Linked initiative names shown as chips on each diagram in the Link Diagrams dialog

### Changed
- Redesigned Initiatives tab in EA Delivery with cleaner two-row card headers, parent-child hierarchy visualization, and 3-column artefact layout (SoAW / Diagrams / ADRs)
- Streamlined Initiatives list view from 9 columns to 7 with hierarchy indentation and artefact-focused layout
- Decomposed 1750-line EADeliveryPage monolith into 6 focused sub-components for better maintainability
- Responsive artefact grid collapses to single column on narrow screens

## [0.28.0] - 2026-03-09

### Added
- Diagrams section in the Resources tab of card details — link and unlink diagrams from any card type, not just initiatives
- Card-level permission `card.manage_diagram_links` for controlling diagram link management per stakeholder role

### Changed
- Generalized diagram-card linking from initiative-only to all card types (renamed `diagram_initiatives` table to `diagram_cards`)
- API fields renamed from `initiative_ids` to `card_ids` in diagram endpoints

## [0.27.0] - 2026-03-09

### Added
- Architecture Decisions tab now uses AG Grid with a persistent filter sidebar for card types, status, and date ranges
- Link type dropdown (Documentation, Security, Compliance, Architecture, Operations, Support, Other) when adding document links in the Resources tab
- Document category dropdown (Architecture, Security, Compliance, Operations, Meeting Notes, Design, Other) when uploading files in the Resources tab
- Colored pills in ADR listings matching linked card type colors throughout Resources tab and EA Delivery page
- Full-text search and right-click context menu on the ADR grid

### Changed
- Architecture Decisions tab in EA Delivery replaced card-based list with AG Grid table view
- Document link icons now reflect the link type category

## [0.26.2] - 2026-03-08

### Fixed
- ADRs not shown in artifacts column of EA Delivery initiatives table view

## [0.26.1] - 2026-03-08

### Changed
- ADR initiative linking now uses standard card links instead of a dedicated field — initiatives are linked like any other card
- ADR list view now shows all linked cards as chips instead of a single initiative name
- Initiative filter on Decisions tab works via linked cards, supporting ADRs linked to multiple initiatives
- Create ADR and Signature Request dialogs no longer resize when search results appear or disappear

### Removed
- Dedicated initiative dropdown from ADR editor and create dialog (use card linking instead)
- `initiative_id` column from architecture decisions (migrated to card link junction table)

## [0.26.0] - 2026-03-08

### Added
- Architecture Decision Records (ADR) with TOGAF-style approval workflow (draft, in review, signed)
- ADR editor with rich text sections: Context, Decision, Alternatives Considered, Consequences
- ADR reference numbering (ADR-001, ADR-002, ...) with duplication and revision chain support
- Architecture Decisions tab in EA Delivery panel with search, status, and initiative filters
- ADRs linkable to Initiatives in EA Delivery and visible under initiative artefacts
- Resources tab on card detail with three sections: Architecture Decisions, File Attachments, Document Links
- Create ADR with inline card linking from Resources tab, EA Delivery, or initiative context
- Initiative-level create button offers choice between SoAW and ADR
- File attachment uploads (up to 10 MB) stored in database with download support
- Document link management on card detail
- ADR signing workflow reusing SoAW pattern (request signatures, sign, revise)
- Search-based signature request dialog for both SoAW and ADR (replaces flat user list)
- Read-only ADR preview page
- New permissions: adr.view, adr.manage, adr.sign, adr.delete, card.manage_adr_links

## [0.25.2] - 2026-03-04

### Changed
- AI portfolio insights now use an advisory tone — findings are presented as expert EA guidance without severity pills or timeline suggestions
- AI portfolio insights now consider the active grouping and filters displayed in the report
- Insight structure simplified to title, observation, and recommendation

## [0.25.1] - 2026-03-04

### Changed
- EA Principles rationale and implications now render each new line as a bullet point for better readability
- AI portfolio insights now return structured results with title, observation, risk, action, and severity for clearer actionable guidance

### Added
- EA Principles read-only tab in the EA Delivery page showing all active principles to all users

## [0.25.0] - 2026-03-04

### Added
- AI-driven portfolio insights: generate on-demand strategic analysis of the application portfolio using the configured AI provider
- AI provider settings separated from AI description settings — provider configuration is now shared across all AI features
- New `ai.portfolio_insights` permission controlling access to portfolio AI insights
- EA Principles tab in Metamodel Configuration for defining architecture principles (title, statement, rationale, implications)
- Active EA principles are automatically included in AI portfolio insights analysis for principle-compliance evaluation

### Changed
- AI admin settings page reorganised into three sections: Provider Configuration, Description Suggestions, and Portfolio Insights
- AI portfolio insights prompt refined with structured 5-lens EA framework and principle-compliance analysis

## [0.24.0] - 2026-03-03

### Added
- AI suggestions now recommend Commercial Application and Hosting Type fields for Application cards when evidence is found in web search results
- Commercial Application boolean field added to Application card type

## [0.23.3] - 2026-03-03

### Added
- User Manual link in the profile menu that opens the documentation site in a new tab

## [0.23.2] - 2026-02-28

### Added
- MCP Integration admin documentation page with full setup guide, tool reference, security details, and troubleshooting (all 7 locales)
- MCP Server section in README with feature description and project structure entry
- MCP glossary term added to all 7 locale glossaries
- Navigation entry for MCP Integration in mkdocs.yml with translated labels for all 6 non-English locales

### Fixed
- Frontend nginx crash on startup when MCP server is not running — deferred DNS resolution to request time so missing upstream returns 502 instead of crashing

## [0.23.1] - 2026-02-28

### Fixed
- Backend startup hang caused by nested asyncio event loops during Alembic migrations — now passes the existing engine connection directly to Alembic
- Increased Docker health check start_period from 30s to 60s to accommodate slower first-run migrations

## [0.23.0] - 2026-02-28

### Added
- MCP server for AI tool integration — allows Claude, Copilot, Cursor, and other AI tools to query Turbo EA data with per-user RBAC
- SSO-delegated OAuth 2.1 authentication for MCP — users authenticate via their existing corporate SSO provider (Entra ID, Google, Okta, or generic OIDC)
- Automatic token refresh for MCP sessions — users stay connected without re-authentication
- Admin MCP integration settings with enable/disable toggle and setup instructions
- `admin.mcp` permission key for managing MCP settings

## [0.22.6] - 2026-02-28

### Fixed
- Restored missing diacritical marks (accents) in all French and Italian documentation files
- Fixed English language selector link from `/en/` to `/` (root) since English is the default locale

### Added
- Localized navigation menu labels in mkdocs.yml for all 6 non-English languages (Spanish, German, French, Italian, Portuguese, Chinese)

## [0.22.5] - 2026-02-28

### Added
- User manual translations for 5 new languages: French, German, Italian, Portuguese, and Chinese (125 translated documentation files)
- Enabled French, German, Italian, Portuguese, and Chinese in mkdocs i18n plugin, search, and language selector
- Placeholder screenshot directories for all 5 new locales (using English images as baseline)

## [0.22.4] - 2026-02-28

### Added
- Comprehensive user manual rewrite: expanded 4 stub pages (Diagrams, EA Delivery, Tasks, Metamodel) from placeholders to full documentation
- 8 new admin guide pages: General Settings, Calculations, Tags, End-of-Life, Surveys, Web Portals, ServiceNow Integration, Saved Reports
- 2 new user guide pages: Notifications, Saved Reports
- Integrated the ServiceNow admin guide (previously a standalone root-level file) into the documentation site
- TOGAF reference and description added to the SoAW (Statement of Architecture Work) section
- 17 new terms added to the glossary (Approval Status, BPMN, Calculation, Data Quality, Diagram, DrawIO, EOL, Notification, Relation, Saved Report, Section, Survey, Tag, TOGAF, Web Portal, and more)
- Spanish translations for all new and updated documentation pages

### Changed
- Expanded Inventory guide with saved views/bookmarks, advanced filtering (subtypes, relations, attributes), Excel import/export details, AG Grid features, and the System card type
- Expanded Card Details guide with lifecycle phases, custom attribute sections, hierarchy, relations, tags, documents, EOL section, approval workflow, archiving behavior, and process flow tab
- Expanded Reports guide with detailed descriptions of all 9 report types including configurable axes, heatmap coloring, treemap visualization, and cross-reference grids
- Expanded BPM guide with BPMN editor, starter templates, element extraction, element linking, approval workflow, process assessments, and BPM reports
- Expanded Dashboard guide with recent activity feed and quick navigation
- Updated login page with correct language names (added accents, added Italiano)
- Updated introduction page with new key benefits (diagrams, BPM, ServiceNow integration)
- Updated mkdocs.yml navigation to include all new pages
- Updated glossary from 15 to 32 terms, removed hardcoded version from footer
- Fixed docker compose command in AI admin guide (removed incorrect -f flag)

## [0.22.3] - 2026-02-28

### Security
- Updated rollup from 4.57.1 to 4.59.0 to fix arbitrary file write via path traversal (CVE-2026-27606)
- Updated minimatch to 3.1.5 and 9.0.9 to fix ReDoS via matchOne() combinatorial backtracking (CVE-2026-27903)

## [0.22.2] - 2026-02-28

### Added
- AI Description Suggestions documentation page in the user manual (English and Spanish) covering setup, usage, providers, permissions, and troubleshooting
- AI-related terms (AI Suggestion, LLM, Ollama, Confidence Score) added to the glossary

### Changed
- User manual introduction rewritten for all users (architects, analysts, admins) instead of only executives and decision makers
- Expanded AI-powered descriptions benefit to cover commercial LLM providers and confidence scoring
- README AI section updated to list all supported LLM providers and admin controls
- README SSO section updated to list all supported identity providers (Microsoft Entra ID, Google Workspace, Okta, Generic OIDC) and removed outdated untested warning

## [0.22.1] - 2026-02-27

### Fixed
- Auth cookie now detects HTTPS via X-Forwarded-Proto header instead of hardcoding Secure flag based on ENVIRONMENT, fixing login failures on HTTP deployments (e.g. local networks without TLS)

### Added
- Manual OIDC endpoint configuration (authorization, token, JWKS URI) as fallback when the backend cannot reach the provider's discovery document (e.g. Docker networking or self-signed certificates)
- Admin ability to change a user's authentication method (Local / SSO) in the edit dialog, enabling linking of existing local accounts to SSO
- Invitation email now uses the actual configured SSO provider name instead of hardcoded provider references

## [0.22.0] - 2026-02-27

### Added
- Support for multiple SSO identity providers: Google Workspace, Okta, and Generic OIDC, in addition to the existing Microsoft Entra ID
- Dedicated Authentication tab in admin settings for SSO and registration configuration
- Provider-specific login button with appropriate branding on the sign-in page
- Google hosted domain restriction and Okta domain configuration options
- Generic OIDC provider with automatic discovery document support
- Support for commercial LLM providers (OpenAI, Google Gemini, Azure OpenAI, OpenRouter, Anthropic Claude) for AI description suggestions
- Encrypted API key storage for commercial LLM providers
- Provider type selector in AI admin settings with conditional form fields

### Changed
- SSO and self-registration settings moved from the General tab to a new Authentication tab
- SSO login button now shows the configured provider name instead of always displaying Microsoft
- Simplified AI search provider — DuckDuckGo is always used automatically for web context
- AI admin UI now shows provider-specific fields (URL, API key, model placeholders) based on selected provider type

## [0.21.1] - 2026-02-27

### Changed
- AI admin page now uses Ollama-specific terminology instead of generic LLM references, with gemma3:4b recommended as the default model for description generation

## [0.21.0] - 2026-02-26

### Changed
- AI suggestions now generate only a type-aware description instead of populating multiple metadata fields — cleaner, more reliable results
- AI web search queries are type-aware: searches for Applications use "software application", Organizations use "company", Providers use "technology vendor", etc.
- Simplified AI suggestion panel UI to show a single editable description with confidence score and clickable source links

### Removed
- Removed per-field `ai_suggest` flag from the metamodel — no longer needed since only description is suggested

## [0.20.0] - 2026-02-26

### Changed
- AI settings moved to a dedicated tab in the admin settings page, organized under an "AI Cards" section to prepare for additional AI use cases

## [0.19.1] - 2026-02-26

### Added
- Bundled Ollama container as an opt-in Docker Compose profile (`--profile ai`) with a persistent volume for model storage — no model re-download on rebuilds
- AI status endpoint now returns the currently loaded Ollama model, displayed as a chip in the suggestion panel

### Changed
- AI suggestions now skip internal assessment fields (business criticality, technical suitability, costs, maturity, risk level, etc.) that cannot be determined from external sources — only externally verifiable metadata is suggested

## [0.19.0] - 2026-02-26

### Added
- Auto-configuration of AI settings on startup when `AI_AUTO_CONFIGURE=true` is set, so pointing to an external Ollama instance requires only env vars — no manual admin setup
- Background model pull on startup when the configured model is not yet available in Ollama

## [0.18.0] - 2026-02-26

### Added
- AI-powered metadata suggestions for cards: search the web and use a local LLM (Ollama) to propose description, vendor, status, and other field values when creating or editing cards
- Three web search provider options: DuckDuckGo (default, zero-config), Google Custom Search API, and SearXNG (self-hosted)
- Admin settings panel for AI configuration: enable/disable, LLM provider URL, model selection, search provider, and per-card-type enablement
- AI suggest button on card detail page header for populating metadata on existing cards
- New `ai.suggest` permission key for controlling access to AI suggestions

## [0.17.4] - 2026-02-25

### Changed
- Redesigned card detail header badges for a cleaner, more harmonious look: smaller data quality ring, outlined chips with colored dots, and merged approval status badge with action menu into a single interactive chip

## [0.17.3] - 2026-02-25

### Security
- Moved JWT storage from sessionStorage to httpOnly cookies, preventing JavaScript access to authentication tokens (CWE-922)
- Added `POST /auth/logout` endpoint to clear the auth cookie server-side

### Fixed
- Login session no longer lost on page refresh

## [0.17.2] - 2026-02-24

### Security
- Suppressed implicit exception chaining on all ServiceNow endpoint error responses to prevent potential stack trace exposure (CWE-209)

## [0.17.1] - 2026-02-24

### Fixed
- Hidden successor/lineage relation types from admin Card Type drawer, Relation Types tab, and metamodel graph since they are already managed via the Lineage toggle
- Limited the Add Relation dialog on card detail pages to only show relation types not already visible as dedicated sections

## [0.17.0] - 2026-02-24

### Added
- Visible and Mandatory toggles per relation type in the Card Type admin drawer, configurable independently for source and target sides
- Visible/mandatory relation types are always displayed on card detail pages, even when empty
- Inline add button per relation type group on card detail pages for faster relation creation without a generic dialog
- Required badge on mandatory relation types in card detail view

### Changed
- Redesigned Relations section on card detail pages with grouped card-style layout and per-relation-type inline search

## [0.16.2] - 2026-02-24

### Security
- Fixed exception information exposure in ServiceNow integration endpoints — all external service calls now catch exceptions and return sanitized error messages instead of leaking internal details
- Fixed unhandled httpx exception in SSO token exchange that could expose the identity provider URL and tenant ID on network failures

## [0.16.1] - 2026-02-24

### Security
- Fixed remaining information exposure through exceptions in calculation engine, ServiceNow sync, and EOL proxy endpoints — error responses no longer leak internal exception details

## [0.16.0] - 2026-02-24
### Added
- Successor / Predecessor relationships: new `has_successors` toggle on card types enables a dedicated Lineage section on card detail pages
- Built-in successor relation types for Application, IT Component, Initiative, Platform, Business Process, Interface, and Data Object card types
- Admin UI toggle and card layout support for the Lineage section
-
## [0.15.3] - 2026-02-24

### Security
- Fixed incomplete HTML sanitization in PortalViewer and SoAW export — replaced regex-based tag stripping with DOMParser for safe text extraction
- Fixed DOM-based XSS in SoAW PDF export — user-controlled values are now HTML-escaped before interpolation into document.write
- Moved JWT token from sessionStorage to in-memory storage to prevent exfiltration via XSS accessing browser storage APIs
- Fixed ReDoS vulnerability in calculation engine — replaced polynomial regex with string-based assignment parsing
- Fixed path traversal in BPM template endpoint — template keys are now validated and resolved paths are confined to the template directory
- Fixed information exposure in ServiceNow connection test, calculation test, and formula validation endpoints — error responses no longer leak internal exception details

## [0.15.1] - 2026-02-24

### Fixed
- Hardcoded English strings in report filter/legend areas (Portfolio, Capability Map, Lifecycle) now use i18n translation keys
- Report filter dropdowns (group-by, color-by, field filters, option labels, color legends) now resolve metamodel field and option translations for the current locale, falling back to the entity key when no translation exists
- Cost report field and group-by dropdowns now resolve metamodel translations; replaced hardcoded "Unspecified" with localized fallback

## [0.15.0] - 2026-02-24

### Added
- Admin-configurable enabled languages setting under General Settings — controls which locales are available in the language picker and translation dialog
- Alembic migration to backfill English translations from label fields into the translations JSONB
- Seed helper to auto-inject English translations so `en` is treated as a first-class locale

### Changed
- Translation architecture: English is now stored in translations JSONB alongside all other locales, rather than implicitly in the label column
- Metamodel label resolution falls back to the entity key when no translation exists for the current locale, instead of always showing the English label
- TranslationDialog now shows all enabled locales (including English) and uses the entity key as reference instead of the English label
- Metamodel form fields (type label, field label, etc.) now save against the admin's current UI locale
- Removed all inline translation accordions from FieldEditorDialog, CardLayoutEditor, StakeholderRolePanel, and MetamodelAdmin — translations are managed exclusively via the centralized TranslationDialog
- Language picker in the nav bar is filtered to only show admin-enabled locales

### Fixed
- SoAW editor displaying "Part I: Part I: Statement of Architecture Work" — removed duplicate Part prefix from section headers

## [0.14.2] - 2026-02-23

### Added
- Translation checklist in CLAUDE.md to ensure all new content includes i18n translations
- Comprehensive i18n test suites for both frontend (locale file completeness, interpolation, plurals, resolveLabel) and backend (seed data translation coverage for all types, subtypes, sections, fields, options, relations)

### Changed
- Moved "Manage Translations" button to the TypeDetailDrawer header bar for quicker access

### Fixed
- Seed metamodel now merges translations into existing built-in types on upgrade (subtypes, sections, fields, and options were missing translations in pre-existing instances)
- Icon field alignment in TypeDetailDrawer first row

## [0.14.1] - 2026-02-23

### Added
- Dedicated TranslationDialog for managing all metamodel translations (type labels, subtypes, sections, fields, options) in a single focused dialog with locale tabs and completion badges
- Seed translations for all subtypes, section names, field labels, and select option labels across all 6 non-English locales (DE, FR, ES, IT, PT, ZH)

### Changed
- Replaced scattered inline translation accordions in TypeDetailDrawer with a centralized "Manage Translations" button and dialog
- Simplified subtype management UI in TypeDetailDrawer by removing nested translation accordions

### Fixed
- Section names not translated in public web portals (PortalViewer)
- Field and option labels not translated in survey response forms (SurveyRespond)
- Field labels not translated in survey results admin view (SurveyResults)
- Hardcoded English subtype labels in BPM ProcessNavigator replaced with metamodel-driven translation resolution

## [0.14.0] - 2026-02-23

### Added
- Complete translations for all 6 non-English locales (DE, FR, ES, IT, PT, ZH) across all 12 namespaces — 2,014 keys per language, no empty placeholders remaining
- i18n English fallback for missing or empty translations (`returnEmptyString: false`) so untranslated strings show English instead of blank text
- CLAUDE.md documentation for i18n conventions and step-by-step guide for adding new languages

### Fixed
- Invalid JSON in Chinese locale files caused by unescaped double quotes (replaced with CJK corner brackets `「」`)

## [0.13.0] - 2026-02-23

### Added
- Metamodel translation support: card types, relation types, and stakeholder roles now store per-locale translations in a JSONB `translations` column
- Admin UI translation inputs in TypeDetailDrawer, FieldEditorDialog, StakeholderRolePanel, and CardLayoutEditor for managing label translations across all supported locales
- `resolveLabel()` / `useResolveLabel()` / `useResolveMetaLabel()` frontend helpers that resolve translated metamodel labels based on the user's current locale
- All metamodel-driven components (inventory, card detail, reports, diagrams, dashboard, admin) now display type/relation/field/option labels in the user's chosen language
- Seed data includes translations for all 14 built-in card types and 30+ relation types across 6 non-English locales (DE, FR, ES, IT, PT, ZH)

## [0.12.0] - 2026-02-23

### Added
- Full internationalization (i18n) support: all UI strings across the entire frontend are now translatable via react-i18next
- 2,014 translation keys across 12 namespaces covering every page, component, dialog, and error message
- 7 supported locales: English (complete), German, French, Spanish, Italian, Portuguese, Chinese (skeleton files ready for translation)
- Language selector in user menu with server-side locale persistence
- User locale preference stored in the database and synced on login
- All locale skeleton files synchronized with the complete English key set

### Changed
- ErrorBoundary, CardDetailContent, CardDetailSidePanel, EditableTable, FilterSelect, and IconPicker now use translation keys instead of hardcoded strings

## [0.11.0] - 2026-02-23

### Added
- i18n Phase 3: all ~80 feature files now use translation keys via react-i18next
- ~1,900 English translation keys across 12 namespaces (inventory, cards, reports, admin, bpm, diagrams, delivery, common, auth, nav, notifications, validation)
- All inventory pages (grid, filters, import, export, mass edit/archive/delete) fully translatable
- All card detail sections and tabs (description, lifecycle, attributes, hierarchy, relations, stakeholders, comments, todos, history) fully translatable
- All 15 report pages (portfolio, capability map, lifecycle, dependencies, cost, matrix, data quality, EOL, process map, saved reports) fully translatable
- All 18 admin pages (metamodel, roles, users, settings, calculations, tags, card layout, EOL admin, surveys, web portals, ServiceNow) fully translatable
- All 10 BPM pages (dashboard, process flow, assessments, templates, modeler, viewer, element linker, navigator, reports) fully translatable
- All 7 diagram pages (gallery, editor, sync panel, card sidebar/picker, create/relation dialogs) fully translatable
- All other features (EA delivery, SoAW editor/preview/export, todos, surveys, web portals) fully translatable
- German locale skeleton files updated with all 1,983 translation keys (empty values, ready for translation)

## [0.10.0] - 2026-02-23

### Added
- i18n Phase 2: all core UI components now use translation keys (auth pages, dashboard, shared components)
- German (DE) added as the 7th supported locale
- English translation files populated with ~200 keys across 5 namespaces (common, auth, cards, notifications, validation)
- All hardcoded strings in LoginPage, SetPasswordPage, SsoCallback, Dashboard, CreateCardDialog, NotificationBell, NotificationPreferencesDialog, LifecycleBadge, ApprovalStatusBadge, EolLinkSection, VendorField, ColorPicker, KeyInput, and TimelineSlider now use `t()` calls

## [0.9.0] - 2026-02-23

### Added
- Internationalization (i18n) infrastructure: react-i18next with 12 translation namespaces and 7 supported locales (EN, DE, FR, ES, IT, PT, ZH)
- Language switcher in the user menu to change the UI language
- User locale preference stored on the backend and synced on login
- Navigation bar labels, search placeholder, and action buttons now use translation keys

## [0.8.1] - 2026-02-23

### Fixed
- Matrix report dark mode: heatmap cells, dots, highlights, depth controls, and count text now use theme-aware colors instead of hardcoded light-mode values
- Time travel date from a saved report no longer leaks into the regular report view

## [0.8.0] - 2026-02-23

### Added
- All reports and BPM pages now open card details in a right-side panel instead of navigating away, so users can browse cards without losing their current view

### Changed
- Extracted shared card detail rendering into a reusable `CardDetailContent` component used by both the full card page and the new side panel

## [0.7.6] - 2026-02-23

### Fixed
- Portfolio report leaf cards no longer show an incorrect percentage when apps belong to multiple groups

### Changed
- Portfolio report leaf cards now show a 100% stacked bar chart illustrating the color-by distribution instead of a single-color percentage bar
- Version is now only maintained in `/VERSION` — `pyproject.toml` and `package.json` use a static placeholder to avoid triggering unnecessary CI jobs

## [0.7.5] - 2026-02-22

### Changed
- CI workflow now skips backend jobs on frontend-only changes and vice versa, using path-based change detection

## [0.7.4] - 2026-02-22

### Changed
- Settings page tabs now use the standard app tab style (matching Metamodel and other admin pages)
- Settings and Metamodel page tabs are now horizontally scrollable on mobile viewports

## [0.7.3] - 2026-02-22

### Added
- Report filter dropdowns now include an "(empty)" option to filter cards with missing field values or no relations
- Extracted shared FilterSelect component used across Portfolio, Capability Map, and Process Map reports

### Changed
- Filter dropdowns now show all selected values as chips that wrap within the field, expanding downward as needed
- Filter label font reduced for better fit; long labels truncate with ellipsis before the dropdown chevron

## [0.7.2] - 2026-02-22

### Fixed
- CSP inline script violation in BPM process flow print view by replacing inline onclick handlers with addEventListener

## [0.7.1] - 2026-02-22

### Fixed
- Donut chart labels on Dashboard no longer clipped and now show per-segment colors (reverted to Recharts native label positioning)
- BPM Dashboard bar/pie chart hover highlight now adapts to dark mode (aligned with main Dashboard pattern)

## [0.7.0] - 2026-02-22

### Changed
- Settings page now uses a tabbed layout with General, EOL Search, Web Portals, and ServiceNow tabs
- General tab groups existing settings into Appearance, Modules, Authentication, and Email sections
- EOL Search, Web Portals, and ServiceNow admin pages consolidated under Settings
- Old admin routes (/admin/eol, /admin/web-portals, /admin/servicenow) redirect to the new Settings tabs

## [0.6.0] - 2026-02-22

### Added
- Dark theme with toggle in account menu, persisted via localStorage
- Dependabot configuration for pip, npm, and GitHub Actions ecosystems
- Security scanning in CI (pip-audit for Python, npm audit for Node)
- Backend test coverage threshold (40% ratchet — prevents regression)
- Structured JSON logging in production (human-readable in development)
- Python lockfile workflow via pip-compile
- Branch protection recommendations documentation

### Fixed
- Dark theme: replaced all hardcoded light backgrounds, borders, and text colors with theme-aware tokens across 20+ components

### Changed
- CI pipeline now enforces `--cov-fail-under=40` on backend tests

## [0.5.0] - 2025-12-15

### Added
- ServiceNow CMDB bi-directional sync integration
- Web portals with public slug-based URLs
- Survey system for data-maintenance workflows
- Saved report configurations with thumbnails
- End-of-Life (EOL) tracking via endoflife.date proxy
- Notification system with in-app bell and email delivery
- BPM process flow version approval workflow
- Process assessment scoring (efficiency, effectiveness, compliance)
- BPM reports: maturity dashboard, risk overview, automation analysis
- DrawIO diagram sync panel (card-to-diagram linking)
- Statement of Architecture Work (SoAW) editor with DOCX export
- Calculated fields engine with sandboxed formula evaluation
- Multi-level RBAC: app-level roles + per-card stakeholder roles
- AG Grid inventory with Excel import/export
- SSO OAuth support (OIDC)
- Rate limiting on auth endpoints (slowapi)
- Fernet encryption for database-stored secrets
- Docker hardening: non-root users, cap_drop ALL, memory limits

### Security
- JWT tokens now validate issuer and audience claims
- Default SECRET_KEY blocked in non-development environments
- Nginx security headers (CSP, HSTS, X-Frame-Options, etc.)
