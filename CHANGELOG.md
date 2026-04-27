# Changelog

All notable changes to Turbo EA are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
