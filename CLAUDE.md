# Turbo EA

Self-hosted Enterprise Architecture Management platform that creates a **digital twin of a company's IT landscape**. Fully admin-configurable metamodel — card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all data, not code.

**Current version**: see `/VERSION` (single source of truth for backend + frontend).

## Quick Start

```bash
cp .env.example .env          # Edit secrets and DB credentials
docker compose pull
docker compose up -d          # Starts db + backend + frontend + edge nginx
```

The first user to register automatically gets the `admin` role. Set `SEED_DEMO=true` to pre-populate with the NexaTech Industries demo dataset. Add `--profile ai` to include the bundled Ollama container for AI description suggestions.

---

## AI Assistant Guidelines

When working on this codebase, follow these conventions:

### General Principles
- **Data-driven metamodel**: Card types, fields, subtypes, relations, stakeholder roles, and calculated fields are all stored as data (JSONB) in the database, not hardcoded. Never add new card types or fields in code — add them via the seed or admin API.
- **One relation type per card-type pair — model finer distinctions as relation attributes, not extra relation types.** The metamodel allows at most one relation type between a given ordered `(source_type_key, target_type_key)` pair, enforced at the application layer in `create_relation_type` / `update_relation_type` / `restore_relation_type` (`backend/app/api/v1/metamodel.py`). To express variants of a relationship (e.g. an Organization that *owns* vs *uses* an Application), add a `single_select` field to the relation type's `attributes_schema` and set it per relation — see `usageType` on `relOrgToApp` and `flowDirection` on `relAppToInterface`, edited via `RelationAttributesEditor` (`frontend/src/features/cards/sections/RelationAttributesEditor.tsx`). Do **not** relax the pair-uniqueness rule: the inventory grid keys relation columns by the *related card type* (not the relation type) and the dependency/landscape reports dedup edges by card pair, so multiple relation types per pair silently collapse/lose data and create edge cases that are difficult to address.
- **Cards, not fact sheets**: The codebase was fully renamed from "fact sheets" to "cards". Never introduce the old terminology.
- **Permission checks are mandatory — for reads too, not just mutations**: Every mutating endpoint must call `PermissionService.require_permission()` or use the `require_permission()` dependency. A **read** endpoint that returns sensitive or privileged data — user PII beyond `{id, display_name}`, secrets, the RBAC permission matrix, audit/event data, another user's data, or admin-only config — must also gate **or shape** its response to the caller's permissions. Never rely on `Depends(get_current_user)` alone (authenticated ≠ authorized) for sensitive data.
- **Authorization must match RBAC and the UI**: Every endpoint's effective authorization must match what RBAC intends and what the UI exposes for that role — if the UI only shows a field/action to admins, the API must not return/allow it for non-admins. When non-privileged UI genuinely needs a read (owner/stakeholder/signer pickers, role chips, the real-time event stream), return a **least-privilege payload** or **filter per-subscriber** rather than blocking the endpoint outright. Canonical patterns: `_user_response` vs `_user_response_lite` (`backend/app/api/v1/users.py`), the `full=` trim on `_role_response` (`roles.py`), and per-subscriber SSE filtering via `_event_visible_to` (`events.py` + `EventBus.subscribe` in `services/event_bus.py`).
- **No raw SQL**: Use SQLAlchemy ORM for all database queries. Alembic for all schema changes.

### Backend Conventions
- All route handlers live in `backend/app/api/v1/`, one file per resource domain.
- New routes must be registered in `backend/app/api/v1/router.py`.
- Use `async def` for all route handlers and database operations.
- Permission checking: use `PermissionService.require_permission(db, user, "permission.key")` or the `require_permission("permission.key")` FastAPI dependency from `deps.py`.
- New permission keys must be added to `backend/app/core/permissions.py` (the single source of truth for all valid permission keys).
- New models go in `backend/app/models/` (one file per table) and must be imported in `backend/app/models/__init__.py`.
- Schema changes require a new Alembic migration in `backend/alembic/versions/` with sequential numbering (e.g., `036_description.py`).
- **Built-in metamodel default changes need a migration too.** `seed.py` only runs when the relevant row is missing on startup, so editing a built-in card type's `color`, `icon`, `label`, etc. has zero effect on existing installs. If you change a built-in default, add a guarded `UPDATE` migration that only rewrites rows still carrying the drifted-from value (so admin customisations and pre-drift defaults are preserved). See `072_restore_business_process_color.py` for the canonical pattern.
- Sensitive values (SSO secrets, SMTP passwords) must use `encrypt_value()`/`decrypt_value()` from `backend/app/core/encryption.py`.
- Ruff linting: line length 100, rules E/F/I/N/W. Run `ruff check .` and `ruff format .`.
- **Before every commit**, run `cd backend && ruff format . && ruff check .` to ensure CI won't fail on formatting or lint errors. This is mandatory — do not skip it.
- **Public API surface is auto-documented**: `docs/api/openapi.json` is generated from `app.main:app` by `scripts/dump_openapi.py` and rendered in the user manual at `/admin/api/` via Swagger UI (loaded from the `swagger-ui-dist` CDN, same UI as FastAPI's `/api/docs`). Do not hand-edit it. The committed spec is **version-agnostic** — `dump_openapi.py` normalises `info.version` to the constant `"latest"` before writing, so VERSION bumps never produce drift. Handling:
  - **VERSION bumps**: nothing to do. The committed spec is version-agnostic, so a VERSION-only diff cannot cause CI drift. The live runtime spec served by the backend at `/api/openapi.json` keeps the real version (it's `app.openapi()` direct).
  - **Route or request/response schema changes**: run `python scripts/dump_openapi.py` and commit the result. There is intentionally no pre-commit hook for this — the script imports the whole backend app and we don't want every `backend/**` commit to pay that cost.
  - CI fails PRs whose spec has drifted; pushes to `main` auto-regenerate it via the `openapi-spec` workflow job, so it's recoverable if you forget.
- **Boot-time public settings belong in `/api/v1/settings/bootstrap`.** When you add a new small public setting that the frontend reads at boot (a feature toggle, a display preference, an enabled-list, etc.), add it to the response of `GET /settings/bootstrap` in `backend/app/api/v1/settings.py` instead of (or in addition to) creating a per-setting `GET` endpoint. The frontend calls bootstrap once after auth and primes hook caches from the result, so anything that lands here costs zero round-trips on subsequent navigations. Per-endpoint reads remain the right choice for selective refresh after admin edits.
- **Static-asset redirects must carry `Cache-Control`.** Any `RedirectResponse` whose target is a static file (the default logo, default favicon, etc.) must include `headers={"Cache-Control": "public, max-age=300"}`. The static target is already cached by nginx, but an un-cached 302 means every page navigation re-does the round-trip.
- **Macro Capabilities are an additive tier above L1** in the Capability Catalogue (consumed from the `turbo-ea-capabilities` wheel ≥ `2026.5.11.505`). Cards land with `type=BusinessCapability`, no subtype, `attributes.capabilityLevel = "Macro"`, and `attributes.catalogueId` prefixed `MC-`. The hierarchy depth limit relaxes from 5 to 6 for macro-rooted chains (`Macro → L1 → L2 → L3 → L4 → L5`); `_sync_capability_level` and `_check_hierarchy_depth` in `cards.py` detect macro roots by walking the parent chain. Macros never match existing cards by name — only by `catalogueId` — to avoid colliding with customer-named cards. Injection of macros into the catalogue payload happens in **one place** (`_resolve_active_catalogue` in `capability_catalogue_service.py`) so the GET endpoint and the import path see the same flat list with rewritten `parent_id`s — otherwise the auto-relink of pre-existing L1s silently no-ops.

### MCP Server Conventions
- The MCP server lives in `mcp-server/` — a separate Python package (`turbo-ea-mcp`) with its own `pyproject.toml` and Dockerfile.
- It provides AI tool access to EA data via the [Model Context Protocol](https://modelcontextprotocol.io/) (FastMCP library).
- **Two transport modes**: HTTP/SSE (production, via Docker `--profile mcp`) and stdio (local testing with Claude Desktop).
- **Authentication**: In HTTP mode, users authenticate via OAuth 2.1 delegated to the Turbo EA SSO provider. The MCP server resolves OAuth tokens to Turbo EA JWTs. In stdio mode, `TURBO_EA_EMAIL`/`TURBO_EA_PASSWORD` env vars are used for direct login. **Redirect-URI validation is enforced**: clients register their `redirect_uris` via RFC 7591 dynamic registration (`POST /oauth/register`), the URIs are persisted in `OAuthStore.clients`, and `authorize()` refuses — with a direct 400, never a redirect — any request whose `redirect_uri` is not an exact match of a registered URI for that `client_id`; the token exchange re-checks `redirect_uri` against the one the code was issued for. **Never redirect an unvalidated `redirect_uri`** — doing so was the auth-code-exfiltration flaw fixed in 1.64.4 (CWE-601/346). Operators fronting the server with a fixed, non-registering integration can whitelist static redirect URIs via `MCP_OAUTH_ALLOWED_REDIRECT_URIS`.
- **Read tools** (30, across eight clusters). **Cards & metamodel**: `search_cards`, `get_card`, `get_card_relations`, `get_card_hierarchy`, `list_card_types`, `get_relation_types`, `resolve_card_refs` (name-to-UUID pre-check), `analyze_impact` (dependency blast-radius for a proposed change). **Dashboards**: `get_dashboard`, `get_landscape`. **GRC (Risk Register)**: `list_risks`, `get_risk`, `get_risk_metrics`, `get_card_risks`. **GRC (Compliance)**: `list_compliance_findings`, `get_compliance_overview`. **Governance & Delivery**: `list_principles`, `list_adrs`, `get_adr`, `list_soaws`. **Reports**: `get_portfolio_report`, `get_cost_treemap`, `get_capability_heatmap`, `get_data_quality_report`. **Card context**: `get_card_stakeholders`, `get_card_comments`, `get_card_documents`. **Diagrams**: `list_diagrams`, `get_diagram`. (`resolve_card_refs` carries a read annotation — it resolves only, it never writes.)
- **Audit & change history** (1, read). `get_change_history(batch_id?, actor_user_id?, tool_name?, origin?, limit?)` surfaces the mutation-batch ledger so agents and admins can reconstruct exactly what a previous MCP commit changed from a single id. Wraps `GET /mutation-batches` and `GET /mutation-batches/{id}/events`.
- **Write tools** (17, annotated additive or destructive). **Additive** (13, `_WRITE_ADDITIVE_ANNOT`): `transition_card_lifecycle`, `create_risks`, `update_risks`, `add_card_comment`, `create_soaw`, `assign_stakeholders`, `update_cards_bulk`, `create_adr`, `update_adr`, `sign_adr`, `create_cards_bulk`, `create_diagram`, `import_bpmn`. **Destructive** (4, `_WRITE_DESTRUCTIVE_ANNOT`): `rollback_batch`, `update_diagram`, `archive_cards`, `upsert_relations_bulk`. The artifact-import subset (`create_cards_bulk` → `POST /cards/bulk-create`; `upsert_relations_bulk` → `POST /relations/bulk`; `create_diagram` → `POST /diagrams`; `import_bpmn` → find-or-create `BusinessProcess` then `PUT /bpm/processes/{id}/diagram`) lands structured rows the agent has read from its own context (spreadsheets, BPMN XML, DrawIO XML, PDFs, images). **Dry-run by default**: every mutating tool defaults to `dry_run=True`, which runs every validator and resolver server-side then rolls the transaction back so the agent can show the user a preview before committing. The backend's mutating endpoints carry the matching `dry_run: bool = False` request flag; `event_bus.publish` calls and side-effect emitters are gated on `not dry_run` so a preview never leaks events. Adding more mutating tools warrants careful security review.
- **All data access respects RBAC**: The user's JWT is passed through to the backend API, so permission checks are enforced server-side. Write tools require the same permissions as the underlying REST routes — e.g. `inventory.create` / `inventory.edit` / `inventory.archive`, `relations.manage`, `diagrams.manage`, `bpm.edit`, `risks.manage`, `comments.create`, `stakeholders.manage`, `soaw.create`, `adr.create` / `adr.sign`.
- **Write-tool guardrails.** Defense in depth so an LLM mishap can't cause mass damage. (a) Per-call size caps on the MCP path — defaults `MCP_MAX_CARDS_PER_CALL=200`, `MCP_MAX_RELATIONS_PER_CALL=500`. The underlying backend bulk endpoints still accept up to 2000/5000 for the legitimate Excel-importer UI, but the MCP tool wrappers reject larger payloads before forwarding. (b) `upsert_relations_bulk` refuses `action: "delete"` ops by default — relations should be removed from the web UI for an auditable trail; flip `MCP_ALLOW_RELATION_DELETE=true` only when an operator explicitly opts in. (c) Kill switch — `MCP_WRITES_ENABLED=false` disables all 17 write tools without a code redeploy; read tools keep working. (d) Audit origin — the MCP server sends `X-Turbo-EA-Origin: mcp` on every backend call; the `capture_request_origin` middleware in `app.main` mirrors it into the `request_origin` contextvar that `event_bus.publish` stamps into the event data payload (`{"origin": "mcp"}`) so admins can filter MCP-driven writes out of the timeline. Header values are whitelisted to `{mcp, web, api}` — any other value is dropped. (e) The toolset deliberately omits **hard card delete** (permanent deletion). Bulk-update and archive *are* exposed (`update_cards_bulk`, `archive_cards`) but archive is recoverable (soft-delete with a 30-day restore window) and both are annotated/dry-run-gated; any future MCP tool that performs an *irreversible* mutation (hard delete, force-purge) needs an RFC discussion first.
- **Mutation batches.** Every MCP write call opens a `mutation_batches` row (`POST /mutation-batches`) before any writes, threads the resulting `batch_id` through every subsequent backend call via the `X-Turbo-EA-Batch` header, and closes the batch on success (`POST /mutation-batches/{id}/commit`). The same middleware that captures `X-Turbo-EA-Origin` mirrors the batch id into the `request_batch_id` contextvar so `event_bus.publish` stamps every event emitted during the request with that id — admins (or the `get_change_history` MCP tool) can then reconstruct the full per-event diff of a single batch from one id. Commits above `MCP_BATCH_CONFIRMATION_THRESHOLD` (default 20 rows) must echo back a one-shot `confirm_token` issued by the prior dry-run; the token has a 15-minute TTL. The MCP wrapper enforces the gate at the agent edge; the backend enforces it again on `POST /mutation-batches/{id}/commit`. The wrapper helper lives in `mcp-server/turbo_ea_mcp/batches.py`; the standardised mutation pattern is documented on its `mutation_batch` async-context-manager. **All 47 MCP tools carry `ToolAnnotations`** (`readOnlyHint` / `destructiveHint` / `idempotentHint`) so connectors can surface destructiveness in their UI.
- **Config** is in `mcp-server/turbo_ea_mcp/config.py` — reads from env vars (`TURBO_EA_URL`, `TURBO_EA_PUBLIC_URL`, `MCP_PUBLIC_URL`, `MCP_PORT`, the six write-guardrail vars `MCP_WRITES_ENABLED`, `MCP_MAX_CARDS_PER_CALL`, `MCP_MAX_RELATIONS_PER_CALL`, `MCP_ALLOW_RELATION_DELETE`, `MCP_BATCH_CONFIRMATION_THRESHOLD`, `MCP_REQUIRE_DRYRUN_FIRST`, plus the OAuth redirect-URI allowlist `MCP_OAUTH_ALLOWED_REDIRECT_URIS`).
- **Tests** live in `mcp-server/tests/` and use `pytest` + `pytest-asyncio`. Run with `cd mcp-server && pip install -e ".[dev]" && pytest`.
- The MCP server shares the `/VERSION` file with backend/frontend for version consistency.

### Platform Migration Conventions

The **Admin → Settings → Migration** importer ingests workspace exports from third-party EA platforms (LeanIX today; Ardoq, Mega HOPEX, BiZZdesign, Avolution Abacus, … in the future) and lands them as Turbo EA cards, relations, tags, stakeholders, documents, comments, and metamodel extensions. The importer is built around an **adapter pattern** so adding a new source platform is a self-contained module — no schema churn, no pipeline rewrites, no route changes.

**Module layout** (`backend/app/services/migration/`):

```
migration/
  __init__.py          # re-exports MigrationSource, SOURCES, MigrationSnapshot, …
  protocol.py          # MigrationSource Protocol — the adapter contract
  registry.py          # SOURCES dict + register_source() + get_source()
  snapshot.py          # source-neutral typed payloads (SourceEntity, Relation,
                       # Subscription, Tag, Document, Comment, UserRef,
                       # MetamodelType/Field/RelationType, MigrationSnapshot)
  staging.py           # source-agnostic staging pipeline (takes MigrationSource arg)
  apply.py             # source-agnostic apply pipeline (12 dependency-ordered passes)
  sources/
    __init__.py        # registers every built-in adapter at import time
    leanix/            # SAP LeanIX adapter
      adapter.py       # LeanixSource implementing MigrationSource
      mappings.py      # TYPE_MAPPING, RELATION_MAPPING, FLIP_DIRECTION,
                       # FIELD_TYPE_MAPPING, SUBSCRIPTION_ROLE_MAPPING,
                       # HIERARCHY_RELATIONS
      xlsx_parser.py   # parser → MigrationSnapshot
```

**DB schema** is uniform across sources (`backend/app/models/migration.py`): `migrations`, `staged_records`, `migration_identity_map` tables, each carrying a `source_type` discriminator column. Identity-map uniqueness is `(source_id, entity_kind, source_type)`; file-hash uniqueness is `(file_hash, source_type)`. Same shape for every source.

**HTTP routes** (`backend/app/api/v1/migration.py`) are source-neutral too: `GET /migration/sources`, `POST /migration/upload` (with `source_key` on the form), `GET /migration`, `GET /migration/{id}`, `GET /migration/{id}/preview`, `POST /migration/{id}/apply`, `DELETE /migration/{id}`. Gated by the single `admin.migrate` permission across all sources.

#### Adding a new source platform

To add an Ardoq / HOPEX / BiZZdesign / etc. adapter, the only surface area is a new subpackage under `sources/` plus one import line. Backend pipeline, DB schema, HTTP routes, frontend UI, and permission gating are all untouched.

1. **Create the adapter subpackage** at `backend/app/services/migration/sources/<key>/`:
   - **`mappings.py`** — five module-level constants the staging pipeline reads via the adapter: `TYPE_MAPPING: dict[str, str]` (native entity-type → TEA card-type key), `RELATION_MAPPING: dict[str, str]` (native relation name → TEA relation-type key, both wire-format flavours if the source has more than one), `FLIP_DIRECTION: frozenset[str]` (native relation types whose direction is the reverse of TEA's convention), `FIELD_TYPE_MAPPING: dict[str, str]` (native field-data-type string → TEA `fields_schema` type), `SUBSCRIPTION_ROLE_MAPPING: dict[str, str]` (lowercased native role-name → TEA stakeholder-role key). Optional: `HIERARCHY_RELATIONS: frozenset[str]` — relations the parser folds into `SourceEntity.parent_id` and that staging must skip.
   - **`<format>_parser.py`** — reads the source's export format off disk and returns a `MigrationSnapshot`. The dataclasses in `snapshot.py` are source-neutral, so the parser stays small and focused. Always read the file via `BytesIO` if you use openpyxl or any extension-checking library — uploads land on disk with a `.bin` suffix.
   - **`adapter.py`** — `class <Source>Source` implementing the `MigrationSource` Protocol (`backend/app/services/migration/protocol.py`). Required attributes/methods: `key`, `label`, `accepted_extensions`, `validate_payload(head: bytes) -> bool` (magic-byte signature check), `parse(path) -> MigrationSnapshot`, the five mapping dicts (re-exported from `mappings.py`), and two extension hooks: `post_build_card_payload(entity, target_type, payload)` (apply source-specific quirks the mapping tables can't express — e.g. LeanIX's `UserGroup → Organization w/ subtype="team"` writes a `source_origin = "<key>:UserGroup"` attribute) and `map_subscription_role(role_name, role_type) -> str` (free-form role-name → TEA role key with a sensible fallback).
   - **`__init__.py`** — `from app.services.migration.registry import register_source; from .adapter import <Source>Source; register_source(<Source>Source())`. Registration happens at import time.

2. **Wire the subpackage into the built-in source list** in `backend/app/services/migration/sources/__init__.py`: add `from app.services.migration.sources import <key>  # noqa: F401`. That's the only place outside the new subpackage that needs to change.

3. **Tests** — mirror the LeanIX layout: `backend/tests/services/test_migration_<key>_parser.py` (parser unit tests with synthetic export payloads built in-memory; never check in real customer data). The staging + apply tests in `test_migration_staging.py` / `test_migration_apply.py` are source-agnostic and don't need duplicates; just make sure the new adapter is covered by the registry contract test in `test_migration_registry.py` (assert `SOURCES["<key>"]` resolves and exposes the expected `label`/`accepted_extensions`).

4. **Frontend** — no changes required. The source picker in `MigrationAdmin.tsx`'s upload dialog reads from `GET /migration/sources`, so the new adapter shows up automatically. The file picker's `accept=` attribute is driven by the adapter's `accepted_extensions`.

5. **i18n** — no new keys required. The picker uses the adapter's `label` directly; the staging/apply UI is source-agnostic and uses the existing `migration.*` keys in all 8 locales.

6. **Docs** — update `docs/admin/migration.md` (+ 7 locale variants `.de`/`.fr`/`.es`/`.it`/`.pt`/`.zh`/`.ru`) to add the new source to the **Supported sources** table at the top. If the new source has format-specific guidance (e.g. how to obtain the export), add a short subsection like the existing LeanIX one. Keep the workflow / re-running / permissions sections generic.

7. **Database schema** — **no Alembic migration**. The three tables (`migrations`, `staged_records`, `migration_identity_map`) are source-uniform; the only per-source DB knowledge is the `source_type` value, which is just a string. Adding a Postgres CHECK constraint on `source_type` would be tempting but is intentionally avoided — the registry is the source of truth and the route layer rejects unknown keys before any insert.

8. **Permissions** — no change. All sources share the single `admin.migrate` permission. Splitting into per-source permissions (`admin.migrate.<key>`) is deferred until a customer actually requests it (the registry already knows the key, so splitting later is a five-minute change).

**Guardrails when writing an adapter**:

- **Mapping dicts on the adapter, not inlined**. Module-level constants in `mappings.py` keep the LX/Ardoq-specific knowledge in one obvious place. Resist the temptation to special-case in `staging.py`.
- **Source-specific quirks belong in `post_build_card_payload`**, not in the staging pipeline. If a source needs more than a simple mapping (e.g. force a subtype, rewrite an attribute, tag the origin), express it as a payload mutation in the hook. The hook is allowed to be empty for adapters that don't need it.
- **Don't expand the `MigrationSource` Protocol** without a second adapter actually needing the new method. YAGNI applies — `post_build_card_payload` + `map_subscription_role` covered every LeanIX quirk; the next adapter likely needs the same two, possibly nothing more.
- **Identity map is keyed by `(source_id, entity_kind, source_type)`**. Two sources can legitimately share an external id; the schema reflects that and the staging pipeline's identity-resolution queries already filter by `source_type` via `migration.source_type`. Never strip the `source_type` filter from a query.
- **Snapshot dataclasses are source-neutral** — don't add source-specific fields to `SourceEntity` / `Relation` / etc. Stuff source-specific data into `raw` or `custom_fields` instead.
- **The apply pipeline is source-agnostic**. It walks `entity_kind` rows by action; it never reads the adapter. If you find yourself wanting to dispatch on `source_type` in `apply.py`, push the logic into a per-source extension hook on the adapter instead.
- **Hierarchy edges go on `SourceEntity.parent_id`** at parse time (via the optional `HIERARCHY_RELATIONS` set + a parser pass). Never let a hierarchy edge surface as a Turbo EA relation.

### Workspace Transfer (Export/Import) Conventions

The **Admin → Settings → Migration → Workspace transfer** tool (added in PR #665) moves an entire Turbo EA workspace — metamodel, configuration, settings, users, the full card inventory, relations, and ~30 card-context / module tables — between Turbo EA instances as a single `.zip` bundle. It is **Turbo EA → Turbo EA** (a faithful round-trip clone), distinct from the Platform Migration importer above, which is **third-party EA platform → Turbo EA**.

> ⚠️ **This feature serializes almost the entire database. Any DB schema change is potentially a workspace-transfer change and MUST be considered as part of that change** — otherwise the new/altered data silently fails to transfer between instances. The checklist below is mandatory whenever you touch a model or migration. There is no CI guard that catches an un-exported table; the round-trip tests only cover what's already wired.

**Bundle layout** — `manifest.json` (format version, app version, timestamp, source URL, section list) + `workspace.xlsx` (one sheet per domain, the source of truth for references) + `assets/` (binary/large payloads: branding, file attachments, diagram + BPMN XML). `FORMAT_VERSION` ("1") lives in `schema.py`; bump it when the on-disk shape changes incompatibly (the importer refuses a bundle whose major version it doesn't understand).

**Module layout** (`backend/app/services/workspace_io/`):

```
workspace_io/
  __init__.py    # re-exports build_bundle / parse_bundle / apply_bundle / diff_bundle / FORMAT_VERSION
  schema.py      # FORMAT_VERSION, sheet names, the card/relation REFERENCE ENCODING (escaped parent_path),
                 #   and CONFIG_SECTIONS (declarative registry of the "simple" config tables)
  secrets.py     # SINGLE source of truth for what never leaves an instance (see below)
  exporter.py    # build_bundle() — bespoke core sheets + column-order constants (CARD_COLUMNS, …)
  applier.py     # apply_bundle() / diff_bundle() — idempotent upsert engine, dry-run via savepoint rollback
  entities.py    # generic introspection-driven export/import engine + EntitySection descriptor
  sections.py    # ENTITY_SECTIONS — the list of module/card-context tables the generic engine drives
  bundle.py      # WorkspaceBundle, zip pack/unpack, workbook (de)serialisation
```

**The bundle is built from two kinds of section:**

- **Bespoke core sections** (`exporter.py` + `applier.py`): metamodel (card/relation types), the `CONFIG_SECTIONS` tables (roles, stakeholder roles, calculations, principles, compliance regulations), tag groups/tags, users, settings, cards, card tags, relations. These need hand-written export/apply logic — built-in protection, secret stripping, the one-relation-type-per-pair rule, topological card ordering, FK remap — so their column lists are **explicit constants** (`CARD_TYPE_COLUMNS`, `RELATION_TYPE_COLUMNS`, `CARD_COLUMNS`, `RELATION_COLUMNS`, …) in `exporter.py`. Adding a column to one of these models does **not** transfer it until you add the column name to the matching constant.
- **Generic entity sections** (`entities.py`, driven by the `ENTITY_SECTIONS` descriptor list in `sections.py`): ~30 card-context / module tables (stakeholders, documents, comments, todos, file attachments, diagrams, BPM, PPM, GRC risks + mitigation tasks/occurrences, ADR/SoAW, saved reports, bookmarks, web portals, surveys). Each is a small declarative `EntitySection`; **value columns are auto-derived by SQLAlchemy introspection**, so adding a plain scalar/JSON column to a covered model transfers with zero changes here. The engine runs *after* the bespoke cards section so every card FK resolves.

**Key design decisions** (don't break these):

- **Module rows preserve their source UUIDs on import; cards do not.** Cards are matched/created by the bespoke cards section (by `external_id`, then `(type, parent, name)`), so their PKs are reassigned. Every other module row keeps its original PK, so every *intra-module* FK (a task's `wbs_id`, an occurrence's `task_id`, a comment's self `parent_id`) resolves verbatim with no remap. Only three things need translation: **card FKs** (encoded `{col}__ref` + `{col}__type`, resolved via `CardResolver`), **user FKs** (encoded `{col}__email`, resolved via the email→id map — instance-local UUIDs are meaningless on the target), and **binary/large assets** (offloaded to `assets/`).
- **Idempotent upsert by natural key throughout** — re-importing the same bundle into the same instance is a true no-op (all-skip). Dry-run preview (`diff_bundle`) runs the *same* engine inside one savepoint that is rolled back, so the preview counts exactly match an apply.
- **Secrets never leave the instance.** `secrets.py` is the single source of truth: SMTP/SSO/AI credentials (`GENERAL_SECRET_PATHS` / `EMAIL_SECRET_PATHS`) are dropped, and any `enc:`-prefixed Fernet value is defensively scrubbed (it's non-portable — derived from the source instance's `SECRET_KEY`). The importer never writes a secret field back; it preserves whatever the target already has. Synthetic (auto-created) users land **deactivated** with no password and a role clamped to `member` if their exported role is unknown.

**Checklist when you change the DB schema** (do the matching step or the data won't transfer):

1. **New module / card-context table** (something a card hangs off, or a feature's own data): add an `EntitySection` to `ENTITY_SECTIONS` in `sections.py`, in **dependency order** (intra-module parents before children). Declare its `card_fk_columns`, `user_fk_columns`, any `asset_columns` / `json_asset_columns`, and `self_parent_column`. Add a round-trip assertion to `test_workspace_io_roundtrip.py`.
2. **New config / metamodel table**: add a `ConfigSection` to `CONFIG_SECTIONS` in `schema.py` (natural key + column list), or wire bespoke logic in `exporter.py`/`applier.py` if it needs built-in protection / FK remap.
3. **New column on a bespoke core model** (CardType, RelationType, Card, Relation, TagGroup, User, …): add the column name to the matching `*_COLUMNS` constant in `exporter.py` (and `*_JSON` if it's JSONB). **This is the easy one to forget** — introspection does *not* cover the bespoke core sections.
4. **New column on an entity-section model**: a plain scalar/JSON column needs nothing. But if it's a **card FK**, add it to `card_fk_columns`; if a **user FK**, add it to `user_fk_columns` (instance-local UUIDs must be remapped by email, never exported raw); if **binary/large/secret**, declare it as an asset or exclude it.
5. **New secret-bearing settings path**: add it to `GENERAL_SECRET_PATHS` / `EMAIL_SECRET_PATHS` in `secrets.py`.
6. **Incompatible on-disk shape change**: bump `FORMAT_VERSION` in `schema.py`.

**Routes** (`backend/app/api/v1/workspace.py`, prefix `/admin/workspace`): `GET /export` (streams the `.zip`, `?include_archived=`), `POST /import` (upload → background dry-run preview), `GET /import/{id}` (poll status + diff/result), `POST /import/{id}/apply` (background apply), `DELETE /import/{id}` (discard). Gated by the dedicated `admin.export_workspace` / `admin.import_workspace` permissions (in `core/permissions.py`). The async preview/apply lifecycle is tracked in the `workspace_transfers` table; the uploaded bundle binary lives on disk under `data/workspace_transfers/{id}.bin`. Frontend: `WorkspaceTransferAdmin.tsx`, surfaced as the second tab of `MigrationHub.tsx`.

### Extension Store Conventions

The **Extension Store** (Admin → Extensions) installs vendor-signed, licensed extensions — content packs, backend plugins, and UI plugins — without changing core ("clean core"). Delivery is file-based (signed `.teax` bundle + signed license text), fully offline/air-gapped capable. The `teax` CLI (build/sign/verify bundles + licenses) lives in `scripts/extension-tools/`; the **extension authoring guide, signing/key custody, release pipeline, and license-issuance runbook live in the vendor's private extensions repo** (not in this public repo). The customer-facing page is `docs/admin/extensions.md`.

**Module layout**: `backend/app/core/extension_signing.py` (Ed25519 verify + baked-in `DEFAULT_VENDOR_PUBLIC_KEY`), `backend/app/services/extensions/` (`license.py`, `registry.py` in-memory singleton, `gate.py` `require_extension()`, `bundle.py` `.teax` verifier, `installer.py`, `content_pack.py`, `sdk.py`, `loader.py`, `migrations.py`, `jobs.py`, `startup.py`), routes in `backend/app/api/v1/extensions.py`, admin UI `frontend/src/features/admin/ExtensionsAdmin.tsx`, UI host `frontend/src/lib/extensionHost.tsx` + `ExtensionRoutesOutlet.tsx`. Tables: `extensions`, `extension_licenses`, `extension_schema_versions`, `extension_installs` (migration 121). Uploads land in `data/extension_installs/`, installed extensions in `data/extensions/{key}/` — both persisted by the `backend_data` docker volume.

**Invariants — do not weaken:**

- **Provenance is anchored to the baked-in vendor keys.** Bundles and licenses verify against the vendor keys baked into `extension_signing.DEFAULT_VENDOR_PUBLIC_KEYS` (`trusted_public_keys()`), and nothing else. Shipping your own extensions means forking — replace the keys in that map and rebuild. Tests inject a throwaway key with `tests/teax_helpers.trust_test_key()`, which replaces the baked map in-process (the same seam a fork edits). The loader re-verifies every installed bundle's `manifest.sig` at each boot, so files dropped on the volume are never trusted. Signatures cover exact bytes (raw `manifest.json`; base64-decoded license payload) — never introduce a JSON-canonicalization step.
- **Two independent gates**: signature = may it be installed/loaded; license entitlement (per-extension, expiry + grace, default 30 days) = may it run. Lapse ⇒ soft-disable via `require_extension` (404 not installed / 403 disabled-or-unlicensed) and per-tick job checks; **data is never deleted** on lapse or uninstall.
- **SDK surface only.** Backend extensions may import exclusively from `app.services.extensions.sdk` (SDK 1.1, major-version checked at load; 1.1 added the route dependencies `get_db` / `get_current_user` / `require_permission` re-exports so extension routes authenticate and authorize without touching core internals — guard test `tests/services/test_extension_sdk.py`). Extension tables are `ext_{key}_*` (tracked in `extension_schema_versions`, never in core Alembic), permission keys `ext.{key}.*` (namespace enforced by the loader), API routes mounted under `/api/v1/ext/{key}/` at import time in `app.main` (**backend**-code install/uninstall ⇒ `needs_restart`; UI-only/content/metamodel bundles install live — `RUNTIME_CAPABILITIES` in `installer.py` is `{"backend"}` only, since `/ext-assets` serves from disk per request and `/extensions/ui-manifest` refreshes from the DB per call).
- **Content packs go through `workspace_io.apply_selected`** (the public facade) and reuse the workspace-transfer engine + guarantees; allowed sheets exclude `Users`/`Roles`/`Settings`. `ext_*` tables are excluded from workspace transfer. A pack may also ship the `Surveys` sheet (but never `SurveyResponses`): `build_content_bundle` clamps every pack survey to `status="draft"` with cleared `sent_at`/`closed_at` (`_enforce_survey_draft`), so an install can never send a survey / email subscribers — the survey lands as a reviewable draft with its fields pre-selected in the builder. Keep `CONTENT_ALLOWED_SHEETS` (`content_pack.py`) in sync with `CONTENT_SHEETS` in `scripts/extension-tools/teax.py`.
- **Manifest field-section contributions (`metamodel` capability) are the ONLY way an extension adds fields to an EXISTING card type.** A content-pack `CardTypes` row whole-column-overwrites `fields_schema` (fine for pack-owned new types, destructive for existing ones), so a manifest may instead declare `"capabilities": [..., "metamodel"]` + `"metamodel": {"field_sections": [{card_type, section, columns?, translations?, fields: [...]}]}` and `apply_field_contributions` (`backend/app/services/extensions/field_contributions.py`) MERGES the section into the target type — stamped `"ext": "<key>"` on section + fields, idempotent, never touching admin/core fields (a conflicting field key is skipped, never hijacked). Contributed field types must be built-in or `ext.{key}.*` (validated in `bundle.py` + `teax lint`). Lifecycle mirrors content-pack soft-hide: install/enable/update re-merge (updates re-sync ext-owned fields and clean retargeted types via the stamp scan, preserving admin-added fields inside the section); disable/uninstall strip the stamped fields **but never the values in `cards.attributes`** — re-enabling restores the section and every value reappears. License lapse does NOT remove contributions (lapse ≠ deactivation; rendering is never gated). Data-quality is recomputed for affected types on apply/remove. Tests: `tests/services/test_extension_field_contributions.py`.
- **UI plugins**: assets served same-origin by `GET /ext-assets/...` (unauthenticated by design — entitlement gating is the authenticated `/extensions/ui-manifest` + the `/ext/{key}/` APIs; CSP stays `'self'`). **Named UI SDK extension points** (nav routes, card tabs, admin panels; since UI SDK 1.1 **custom field types** — `fieldTypes` on `TurboExtensionUI`, a display/editor pair for a namespaced `ext.{key}.*` field type used inside card attribute sections; since UI SDK 1.2 **survey templates** — `surveyTemplates`, a "New from template" shortcut on the Surveys admin page whose `build()` payload is POSTed to `/surveys` (always a draft) and opened in the builder, surfaced by `getExtensionSurveyTemplates` / `useExtensionSurveyTemplates`, additive and ungated; since UI SDK 1.3 two **ADR** points — `adrPanels`, a component rendered on the ADR editor + preview (`ADREditor`/`ADRPreview`, consumed via `useExtensionAdrPanels`, props `{adrId, status, signed, readOnly}`; ADRs are not cards so `cardTabs`/`metamodel` field contributions do not apply to them), and `adrExportSections`, a plain-data builder (`getExtensionAdrExportSections`) whose returned `{heading, paragraphs?, table?}` sections core renders into the ADR DOCX export in `adrExport.ts`; both additive/ungated; and since UI SDK 1.10 **ADR grid columns** — `adrGridColumns`, a plain-data column (`{id, label, align?, width?, minWidth?, value(adr), sortValue?(adr)}`) appended to the shared decisions grid (`AdrGrid`, used by EA Delivery → Decisions AND GRC → Governance → Decisions; optional `width`/`minWidth` px hints default to 150/120). Core builds a native AG Grid `ColDef` from it (`useExtensionAdrGridColumns`), so the column shares theme/sorting/quick-filter with built-in columns; `value()`/`sortValue()` run guarded — a throw yields an empty cell, never a broken grid. Deliberately plain data, NOT a `cellRenderer` — extensions contribute data, core owns the rendering, same philosophy as `adrExportSections`). **Since UI SDK 1.12 the *preferred* way to add a plug point is the generic slot registry, not a new named point.** An extension declares `slots: [{ slot, id, component | build, permission?, appliesTo?, order? }]` on `TurboExtensionUI`; core exposes a location by dropping `<ExtensionSlot name="..." context={...} />` (component slots, rendered inside `ExtensionBoundary` with `context` as props) or calling `getExtensionSlots(name)` and rendering the returned `build(ctx)` data itself (data slots — the `adrGridColumns`/`adrExportSections` philosophy). A contribution must supply exactly one of `component`/`build`; `permission` hides the slot silently (never an access-denied page), `appliesTo` filters on `context.cardType`/`type`, `order` sorts within a slot. The payoff: a **new** plug location no longer needs an SDK type/hook/version change — only a one-line `<ExtensionSlot>` in core with a fresh `slot` string (seeded locations: `card.detail.header` in `CardDetailContent`, `risk.detail.panel` in `RiskDetailPage`, and `adr.header` (the ADR action-button row, alongside Duplicate / New revision) + `adr.signature.footer` in `ADREditor`/`ADRPreview` — the latter the sanctioned home for post-decision, below-signature ADR content, both passing `{adrId, status, signed, attributes}`). The named points above are retained for compatibility; add new locations as slots. Every extension component renders inside `ExtensionBoundary`. `UI_SDK_VERSION` bumps major on breaks, minor on additive points; the host checks the major only. A nav route may carry an optional `navGroup` placement hint (whitelisted by `EXTENSION_NAV_GROUPS`, currently `"reports"`) so its menu entry renders inside a core nav group instead of top-level — this is a hint on the existing routes point, **not** a fourth-plus extension point; the path stays `/ext/{key}/...`, `AppLayout` injects grouped routes into the Reports `children` via `getExtensionRoutesForGroup`, and an unrecognised `navGroup` surfaces nowhere in the nav (still reachable by URL).
- **The SDK is the reuse boundary — expose core UI on `window.TurboEA.sdk`, never make an extension rebuild it.** When an extension needs UI that core already has (a dialog, a picker, a report frame, a drawer), expose the existing core component on `window.TurboEA.sdk`: add the import + sdk entry + a `UI_SDK_VERSION` minor bump + a surface-test assertion, same as `SaveReportDialog` / `CardDetailSidePanel` / `ReportShell` / `FilterSelect`, and — since UI SDK 1.8 — `useCurrency`, `MetricCard`, `ReportLegend`, `UserMultiSelect` (the shared multi-user picker in `frontend/src/components/UserMultiSelect.tsx`), and `loadRecharts` (an async `() => import("recharts")` loader so extension charts reuse core's code-split Recharts chunk — extensions must NOT bundle their own charting library), and — since UI SDK 1.9 — `useChartTheme` (`frontend/src/hooks/useChartTheme.ts`, the theme-aware Recharts chrome — grid stroke, axis ticks, tooltip styling — that keeps extension charts visually identical to core reports; extensions must use it instead of hand-rolling chart chrome), and — since UI SDK 1.13 — the saved-report **localStorage-persistence** passthroughs on `useSavedReport` (`consumeConfig` / `persistConfig` / `resetAll`, re-exported from `useSavedReport.ts`) so an extension report keeps its filters + selection across a refresh exactly like a core report (URL saved report > localStorage > defaults; `useExtensionSavedReport` returns them alongside `config` / `savedReportId` / `name`). A weaker extension re-implementation is a bug, not a workaround. One caveat when adding an entry: if the component pulls a heavy code-split graph or would create a module cycle back into `extensionHost` (e.g. `CardDetailSidePanel` → `CardDetailContent`, `ReportShell` → the xlsx/pptx export engine), expose it as a `React.lazy` wrapper with Suspense handled internally (or an async loader like `loadRecharts` for a bare library) — never a static import that drags the graph into the eager main bundle. Two advanced metamodel field-authoring capabilities live entirely in core but are only *authorable* when an installed, enabled, licensed extension declares the matching grant in its manifest (`"grants": ["metamodel.field_help", "metamodel.custom_field_types"]`, surfaced by `registry.grants_for` / `granted_capabilities` and the `/extensions/status` `grants` field): **field help text** (`FieldDef.help` + `helpTranslations`, rendered as collapsible guidance by `FieldHelp` in `cardDetailUtils.tsx`) and **custom field types** (`FieldDef.type = "ext.*"` + `config`, rendered via the `fieldTypes` registry). The free core ships the *engine* (schema, storage, rendering, the empty registry) but no UI to author these; `_enforce_field_gating` in `backend/app/api/v1/metamodel.py` strips help/`ext.*` types on `create_type`/`update_type` unless the grant is active (checked against `useExtensionCapabilities` on the frontend, `granted_capabilities()` on the backend). **Two invariants:** (1) **rendering is never gated** — `FieldValue`/`FieldEditor` always render an `ext.*` value, degrading to a read-only text view when the extension is missing/disabled/unlicensed, so a lapse never blanks a card or deletes data; (2) **existing values are grandfathered** — the gating strip preserves already-stored help/custom-types verbatim so a lapse can't block an unrelated metamodel edit. Content packs bypass the strip (they write `fields_schema` through `workspace_io`, an extension-delivered path) so a pack can ship help text and custom-typed fields directly. When adding a new gated core capability, follow this shape: inert plumbing + `grants` gate on the *write/authoring* path only + a guard test (`tests/api/test_metamodel_field_gating.py`).
- **ADR extension attributes bag** (`architecture_decisions.attributes`, migration 122). ADRs are **not cards**, so extensions cannot extend them via the `metamodel` field-contribution capability; instead they stash data under `ext.<key>.*` top-level keys in this JSONB bag. `update_adr` shallow-merges the bag, **rejects non-`ext.*` keys** (core owns no native ADR attributes), and a key set to `null` is deleted. It is **frozen automatically once the ADR is signed** (`update_adr` 403s on signed decisions) and **carried into revisions + duplicates**, so figures the signatories approved stay accurate. Surfaced in both `_adr_to_dict` and `_adr_to_summary` (so the list endpoint can power a dashboard without N+1). The column transfers via workspace-transfer introspection (ADR is an `ENTITY_SECTION`); user ids stored *inside* the bag are **not** email-remapped on cross-instance transfer (same caveat as card `attributes`) — a portable extension stores emails or its own `ext_*` tables. Paired with the `adrPanels` (authoring) + `adrExportSections` (DOCX) UI points.
- A broken extension must never block core boot or blank the SPA — quarantine + surface on the admin page.
- **Instance-bound licensing.** Every install mints a checksummed **instance ID** once (`TEA-XXXX-XXXX-XXXX`, Crockford base32 + weighted mod-32 check char — `app/services/extensions/instance_id.py`, persisted in `app_settings.general_settings.instanceId` by `ensure_instance_id()` at startup, surfaced by `GET /admin/extensions/instance` and a copy-chip on ExtensionsAdmin). Licenses carry `payload.instance_id` and core **binds** on it: `_apply_license_text` 400s on mismatch (paste, claim, and auto-renew alike), the registry soft-disables a stored mismatched license at load (`license_problem` → error banner; data untouched), and an **unbound** license is accepted only when `ENVIRONMENT=development` (`teax sign-license` requires `--instance-id`, so production files always carry one). The in-app Buy button appends the ID to Stripe's `client_reference_id` (`<claimToken>-<TEA-…>`, parsed off the end by the store webhook); the renew request sends `instance` alongside the renewal key. **Two invariants:** (1) the ID *identifies*, claim tokens / `renewal_key` *authenticate* — knowing an ID must never allow fetching a license; (2) the ID **travels with workspace transfer** (never add `instanceId` to the secret-strip lists) so host migrations keep licenses valid — binding is to the ID, not hardware. Full design + vendor re-key/self-issue tooling: the private extensions repo's `docs/plans/instance-id-licensing.md`.
- **Multi-key trust**: `DEFAULT_VENDOR_PUBLIC_KEYS` (key_id → base64 key) in `extension_signing.py` is the set of trusted vendor keys; `verify_with_trusted()` selects by the envelope/manifest `key_id` and falls back to trying every trusted key (so pre-`key_id` envelopes still verify). This lets a vendor sign licenses with a key separate from the one used to sign bundles, and lets keys rotate without a format change. `teax pack --key-id` stamps the id into the manifest.
- **In-product Store tab = read-only proxy over public static files — never a store connection, and never configuration.** The catalogue URL (`EXTENSION_STORE_URL` in `config.py`) is a **hard code constant, deliberately NOT an env var** — the store is part of the product on every install, with no opt-in/opt-out knob (repointing it means forking, same posture as the trusted vendor keys; a source-level test in `test_startup.py` guards against reintroducing an env lookup). `GET /admin/extensions/store/catalog` proxies + annotates it (installed version, entitlement state, update available) and `POST /admin/extensions/store/install` downloads the bundle server-side into the SAME verify → dry-run preview → apply pipeline as a manual upload (`_persist_upload` + `_verify_and_preview_job`). Bundle downloads are restricted to the store origin (SSRF guard). There are NO accounts, tokens, redeem codes, or online activation — bundles are inert without a signed license, payment happens in a new browser tab via the catalogue's `payment_link`, and the license is still pasted as a file on the Installed tab. Air-gapped instances need nothing: an unreachable store degrades to a friendly hint and the file-based flow is always fully functional. Anything about how licenses are sold/distributed commercially lives outside this repo, in the vendor's private extensions repo.

### Frontend Conventions
- Route-level pages use `lazy()` imports in `App.tsx` for code splitting.
- Shared hooks in `src/hooks/`, shared components in `src/components/`.
- Feature-specific components go in `src/features/{feature}/`.
- Use `api.get()`, `api.post()`, `api.patch()`, `api.delete()` from `src/api/client.ts` for all API calls.
- JWT token is in `sessionStorage` (not localStorage). Use `setToken()`/`clearToken()` from `client.ts`.
- **Boot-time singleton hooks must use the inflight-promise pattern.** Hooks that fetch a process-wide value once (`useMetamodel`, `useDateFormat`, `useCurrency`, `useBpmEnabled`, `usePpmEnabled`, `useTurboLensReady`, …) keep a module-level `_cache` plus an `_inflight: Promise | null`. The fetch helper checks **both** — if `_cache` has the value, return it; if `_inflight` is non-null, return that promise; only otherwise start a new fetch and store it in `_inflight`, clearing it on settle. The naive `if (_cache === null) _fetch()` pattern races: when several components mount in the same tick they each see an empty cache and each fire their own request. Add an inflight guard to any new singleton hook of this shape.
- **For new boot-time settings, prefer adding to `/settings/bootstrap` over creating a new singleton hook.** The frontend's `primeBootstrap()` (in `src/api/bootstrap.ts`) calls `GET /settings/bootstrap` once after login and pushes each value into the corresponding hook's singleton cache via the hook's top-level `invalidate*(value)` export. Every per-hook GET that fires before bootstrap arrives is a wasted round-trip; every value bootstrap doesn't carry is a duplicate fetch. When you add a settings hook, also add a top-level `invalidate*(value)` export, extend `BootstrapResponse` in `bootstrap.ts`, and call your invalidator from `primeBootstrap()`.
- All TypeScript interfaces live in `src/types/index.ts`.
- Use MUI 6 components — do not introduce other UI libraries.
- Icons use Google Material Symbols via the `MaterialSymbol` component.
- When nesting MUI Dialogs, use `disableRestoreFocus` on inner dialogs.
- **Picking an existing card — always use `CardPicker`.** Any dropdown/autocomplete that selects a card from the inventory (relations, hierarchy parent/child, predecessors/successors, the Create-card parent, vendor/Provider linking, ADR card links, BPM element linking, compliance findings, …) must reuse `frontend/src/components/CardPicker.tsx`. It is a single-select MUI `Autocomplete` built on the app-wide `frontend/src/hooks/useCardSearch.ts` engine and gives every picker the same behaviour for free: **browse on open** (lists cards alphabetically with an empty input — never require typing first), filter-as-you-type (server-side via `GET /cards?search=`), and **infinite scroll** (`pageSize` first page, `loadMore()` on listbox scroll). Pass `types` (one key or an array), controlled `value`/`onChange` (`CardOption = {id,name,type}`), `excludeIds` for client-side exclusions (self, ancestors/descendants, already-linked), and `enabled` to gate fetching to when the picker is actually open. Do **not** hand-roll an `Autocomplete` + debounced `/cards?search=` effect, and never gate results behind a `search.length` check — that reintroduces the search-only friction #702 removed. The only sanctioned exceptions are `VendorField` (needs a freeSolo "create new Provider" affordance, so it consumes `useCardSearch` directly) and the diagram Insert-Cards dialog / left sidebar (a multi-select infinite-scroll grid, also on `useCardSearch`). `useCardSearch` is the shared engine — reuse it directly only for those non-single-select cases; otherwise use `CardPicker`.
- **Design tokens**: All colors, spacing aliases, icon sizes, and typography defaults live in `frontend/src/theme/tokens.ts` (re-exported from `frontend/src/theme/index.ts`). Never hardcode hex codes — import the named token (`STATUS_COLORS.success`, `SEVERITY_COLORS.high`, `LAYER_COLORS["Application & Data"]`, etc.). See [`frontend/UI_GUIDELINES.md`](frontend/UI_GUIDELINES.md) for the full design system, layout patterns, and do's/don'ts.
- **Dependency diagrams — Layered Dependency View (LDV)**: All dependency visualizations (Dependencies Report, Card Detail dependency section, TurboLens Architect target architecture) use Turbo EA's house notation, the **Layered Dependency View**. Cards are grouped into the four EA layers (Strategy & Transformation → Business Architecture → Application & Data → Technical Architecture) as swim lanes; nodes are colored by card type; edges follow metamodel `relation_type` direction with the forward label; proposed/uncommitted cards have a dashed border + green "NEW" badge. Inspired by ArchiMate's layering and the C4 Model's "good defaults" philosophy, but distinct from both — do **not** describe it as "C4" in user-facing strings or documentation. The renderer is `frontend/src/features/reports/C4DiagramView.tsx` + `c4Layout.ts` (file/symbol names retained for compatibility); reuse it for any new dependency view. See `frontend/UI_GUIDELINES.md` § 3.10 for the full spec.
- **DrawIO card shapes carry the card-type icon.** Cards inserted onto a DrawIO diagram (`frontend/src/features/diagrams/drawio-shapes.ts`) render their metamodel icon as a white glyph in the top-left corner via a `shape=label;image=...` style — baked into the single cell so it drags/exports with the shape (no child cells/overlays). The icon is a **vector SVG data-URI**, not the Material Symbols font, because font glyphs can't be reliably rasterised into images (the DrawIO iframe has no access to the app webfont — see `features/reports/reportExport.ts`). Path data lives in the **generated, committed** `frontend/src/features/diagrams/iconPaths.ts`, built from the curated picker set (`src/components/iconCatalog.ts`) by `npm run gen:diagram-icons` (sources: `@material-symbols/svg-400` + `@mui/icons-material` fallback for legacy names; both devDeps). Regenerate and commit `iconPaths.ts` when you add icon names to the catalogue — there is no pre-commit hook. The SVG URI is `encodeURIComponent`-encoded so it has no raw `;`/`=` and survives mxGraph's `;`/`=`-delimited style parser and the view-recolour helpers' `split(";")`.

### Internationalization (i18n)
- **All user-facing strings must use translation keys**, never hardcoded English text. Use `useTranslation()` from `react-i18next` with the appropriate namespace.
- **14 namespaces**: `common`, `auth`, `nav`, `inventory`, `cards`, `reports`, `admin`, `bpm`, `ppm`, `diagrams`, `delivery`, `grc`, `notifications`, `validation`. Use the namespace that matches the feature area.
- **10 supported locales**: `en` (English, baseline), `de` (German), `fr` (French), `es` (Spanish), `it` (Italian), `pt` (Portuguese), `zh` (Chinese Simplified), `ru` (Russian), `da` (Danish), `ar` (Arabic — **right-to-left**; see `RTL_LOCALES` / `isRtlLocale` in `frontend/src/i18n/index.ts`). Components built on third-party widgets that don't inherit the document `dir` (AG Grid, Recharts) must opt into RTL themselves via the `useIsRtl()` hook (`frontend/src/hooks/useIsRtl.ts`).
- **English is the source of truth**. All keys must exist in `frontend/src/i18n/locales/en/{namespace}.json` first. The i18n config uses `fallbackLng: "en"` and `returnEmptyString: false`, so missing or empty translations gracefully fall back to English.
- **Interpolation**: Use `{{variable}}` syntax for dynamic values (e.g., `"Selected {{count}} cards"`). Preserve these placeholders exactly when translating.
- **Plurals**: i18next uses `_one` / `_other` suffixes (e.g., `"count_one": "{{count}} item"`, `"count_other": "{{count}} items"`). All locales need both forms.
- **JSON safety**: Never use unescaped ASCII double quotes `"` inside JSON string values. For Chinese use corner brackets `「」`, for other languages use `«»` or escaped `\"`.
- **Metamodel labels — always resolve with the entity-aware resolvers; NEVER pass `.key` as the fallback.** Card-type, relation-type, field, option, and subtype display names are translated via the `translations` JSONB column on `card_types` / `relation_types` (and inline on fields/options/subtypes). Resolve them with the **entity-aware** helpers from `frontend/src/hooks/useResolveLabel.ts`: `useTypeLabel()` / `typeLabel(entity, locale)` for card types (also portal type info and stakeholder role defs), `useRelationLabel()` / `relationLabel(rt, locale, reverse?)` for relation verbs (pass `reverse=true` for the incoming direction), and `useFieldLabel()` / `useOptionLabel()` / `useSubtypeLabel()` (`fieldLabel` / `optionLabel` / `subtypeLabel(entity, locale)`) for fields, options, and subtypes. Pass the **whole entity** — these compute the correct `entity.label || entity.key` fallback internally. **Do NOT call the low-level `useResolveLabel()` / `useResolveMetaLabel()` (`rl` / `rml`, `resolveLabel` / `resolveMetaLabel`) with `entity.key` as the fallback** (e.g. `rml(type.key, type.translations, "label")`). Admin-created custom entities ship with an **empty `translations` map**, so the fallback is exactly what renders — passing `.key` leaks the internal slug ("itAsset") instead of the display name ("IT Asset"). This bug recurred twice (#661 subtypes, #731 card/relation types) precisely because the `.key`-fallback pattern was copied between call sites; the entity-aware resolvers exist so it cannot recur. Use the low-level primitives only for loose string values that have no entity object, and even then pass the human label, never the key. In non-React code (`excelExport.ts`, `excelImport.ts`, plain helpers) use the pure `typeLabel` / `relationLabel` / `fieldLabel` variants with `i18n.language`.

#### Adding a New Language

The locale code is the ISO 639-1 two-letter code throughout (`da`, not `da-DK`). The recipe touches code in three layers (frontend, backend, docs) plus a one-shot data migration. PR [#623](https://github.com/vincentmakes/turbo-ea/pull/623) (Danish) is the canonical worked example.

1. **Frontend locale files**: copy `frontend/src/i18n/locales/en/` to `frontend/src/i18n/locales/{code}/` and translate the values in all 14 JSON files. Keys, placeholders, and `_one`/`_other` plural variants must match the English source exactly — verify with the JSON-parity check below.
2. **Frontend i18n config** (`frontend/src/i18n/index.ts`): add imports for all 14 namespace files, extend the `resources` object, append the code to the `SUPPORTED_LOCALES` tuple, and add a display label to `LOCALE_LABELS`. The `SupportedLocale` type updates automatically.
3. **Metamodel translations** (`backend/app/services/seed.py`): every `translations` dict on card types, subtypes, fields, sections, options, and relation types (label + reverse_label) needs the new locale. A Python regex pass that walks every leaf `"de":` dict and injects the matching value before the closing brace works well — see PR #623's `/tmp/add_da_seed.py` helper for the pattern.
4. **Backend allow-lists** — extend the hardcoded `SUPPORTED_LOCALES` in **both** places: `backend/app/api/v1/settings.py` (governs the `/settings/enabled-locales` validator and the `/settings/bootstrap` fallback) and `backend/app/api/v1/users.py` (governs the `users.locale` write validator). Keeping them in sync is enforced by convention only — there is no shared constant today.
5. **Test fixtures** — bump the hardcoded locale lists in `backend/tests/services/test_i18n_seed.py` (metamodel translation completeness check) and `frontend/src/i18n/i18n.test.ts` (placeholder/plural parity check). Both are pinned arrays, not imports, so they will not pick up the new locale automatically.
6. **MkDocs config** (`mkdocs.yml`) — **two places**: (a) a new language block under `plugins.i18n.languages` with `locale`, `name`, `build: true`, and a full `nav_translations` map mirroring the existing locales; (b) a matching entry in `theme.alternate` (the header dropdown). Omitting `theme.alternate` builds the `/{code}/` site but leaves users no way to switch into it from the UI. Add the code to `plugins.search.lang` as well — `lunr-languages` supports `da` and the major locales out of the box.
7. **Backend `User.locale`**: no migration needed — the column is `String(10)` with no enum constraint.
8. **Backfill existing installs**: an admin who has touched **Admin → Settings → Languages** at least once has the full locale list persisted as `app_settings.general_settings.enabledLocales` (JSONB). That stored list will not pick up the new locale on its own, so the picker hides it even though the constant exposes it. Ship a small Alembic migration that walks the singleton `app_settings` row and appends the new locale if missing. The canonical implementation is `backend/alembic/versions/099_backfill_danish_enabled_locale.py` — Python-side fetch-mutate-update with a `CAST(:s AS jsonb)` write. Don't use a single SQL `UPDATE … jsonb_set(…) WHERE general_settings ? '...' AND … @> …`; the `?` JSONB key-existence operator interacts badly with SQLAlchemy's `text()` named-parameter scanner and silently rolls back in the migration runner.
9. **Docs translations**: create `.{code}.md` siblings for every English `.md` under `docs/` (top-level index, `getting-started/`, `beginners-guide/`, `guide/`, `admin/`, `reference/`). The site builds without them — mkdocs-static-i18n falls back to English per page — but the language picker existing without translated pages confuses users.
10. **Validate**:
    - `python3 -c "import json, glob; [json.load(open(f)) for f in glob.glob('frontend/src/i18n/locales/{code}/*.json')]"` — JSON validity.
    - A second parity script (en keys == new-locale keys, en placeholders == new-locale placeholders) catches the common omissions.
    - `cd backend && ruff format . && ruff check . && python -m pytest tests/services/test_i18n_seed.py -q`.
    - `cd frontend && npm run build && npm run test:run`.
    - `mkdocs build --strict` (catches broken links in the new docs).

Screenshots can stay in `docs/assets/img/en/` and the new docs can reference `../assets/img/en/...` — translating UI screenshots is a separate, optional pass.

#### Translation Checklist for Code Changes

Every change that introduces user-visible content must include translations. Before marking a task as complete, verify:

- [ ] **New UI strings**: Added translation keys to `frontend/src/i18n/locales/en/{namespace}.json` and all 8 non-English locale files (`de`, `fr`, `es`, `it`, `pt`, `zh`, `ru`, `da`). Never hardcode English text in components.
- [ ] **New metamodel content** (card types, subtypes, fields, options, sections, relation types): Added `"translations"` dicts with all 8 non-English locales in `backend/app/services/seed.py`.
- [ ] **New select options** (in seed data or reusable option arrays): Each option object includes a `"translations"` dict.
- [ ] **New field labels**: Each field in `fields_schema` includes a `"translations"` dict.
- [ ] **New section names**: Each section in `fields_schema` includes a `"translations"` dict.
- [ ] **New subtypes**: Each subtype includes a `"translations"` dict.
- [ ] **Interpolation preserved**: `{{variable}}` placeholders are identical across all locales.
- [ ] **Plurals**: Keys using counts include both `_one` and `_other` variants in all locales.
- [ ] **JSON valid**: No unescaped double quotes in JSON values. Chinese uses `「」`, others use `«»` or `\"`.

### Security Requirements
- Never store plaintext secrets in the database — use `encrypt_value()`.
- Never expose sensitive fields (password hashes, encrypted secrets) in API responses.
- Always validate user input via Pydantic schemas on the backend.
- Use parameterized queries (SQLAlchemy ORM) — never construct SQL strings.
- New endpoints must use `Depends(get_current_user)` or `Depends(require_permission(...))`.
- Rate limiting is applied via `slowapi` — apply `@limiter.limit()` to auth-sensitive endpoints.

### Pull Request Conventions
- **Always use the PR template** at `.github/pull_request_template.md` when creating pull requests. Do not use a custom format — fill in the template sections exactly as defined.
- The PR template has four required sections: **Summary**, **Changes**, **Test Plan**, and **Checklist**. All must be completed.
- **Summary**: 1-3 sentences explaining what the PR does and why.
- **Changes**: Bulleted list of the key changes made.
- **Test Plan**: Describe how you verified the changes work. Always include the three CI checkboxes (all CI checks pass, manually tested, added/updated tests). Check the boxes that apply.
- **Checklist**: Review every item and check all that apply. These enforce the project's core conventions (permission checks, Alembic migrations, async handlers, data-driven metamodel, no exposed secrets). Do not remove unchecked items — leave them unchecked so reviewers can see what was considered.
- PR titles should be concise (under 72 characters) and describe the change, not the implementation.

### Changelog & Versioning Conventions
- **Update `CHANGELOG.md`** for every user-facing change. Add entries under the current version heading (e.g., `## [0.6.0] - 2026-02-22`). Do **not** use an `[Unreleased]` section — this project ships continuously and every change belongs to a concrete version.
- The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Use these categories: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**. Only include categories that apply.
- Each entry should be a single concise line describing the change from the user's perspective, not implementation details.
- **Bump the version once per PR** (not per commit). All commits in a feature branch share one version. Follow [Semantic Versioning](https://semver.org/): bump **patch** (e.g., `0.6.0` → `0.6.1`) for bug fixes, **minor** (e.g., `0.6.0` → `0.7.0`) for new features, **major** for breaking changes.
- The single source of truth for the version is `/VERSION`. When bumping, only update `VERSION` (the backend reads it at runtime via `config.py`, the frontend injects it at build time via `vite.config.ts`). Do **not** edit `backend/pyproject.toml` or `frontend/package.json` — they use a static `"0.0.0"` placeholder to avoid triggering unnecessary CI jobs on version bumps.
- When bumping, add a new heading in `CHANGELOG.md` with the new version and today's date (e.g., `## [0.6.1] - 2026-02-22`), and place new entries under it.
- CI enforces this via `.github/workflows/version-check.yml`: any PR that touches `VERSION` is failed unless `CHANGELOG.md` has a matching `## [<version>]` heading. This prevents the Publish-GitHub-Release workflow from breaking later at tag time.

### Testing Conventions
- **Every new feature or bug fix should include tests.** CI will block PRs that fail lint or tests.
- **Backend tests** live in `backend/tests/` mirroring the source structure (`core/`, `services/`, `api/`).
- **Frontend tests** live next to source files (e.g., `client.ts` → `client.test.ts`).
- Backend integration tests use the savepoint-rollback pattern — each test runs in a transaction that rolls back automatically, so tests never pollute each other.
- The test database engine (`test_engine` in `conftest.py`) is a **sync** session-scoped fixture using `NullPool`. This avoids pytest-asyncio event loop mismatches — each test gets a fresh asyncpg connection on its own loop. Do not convert it to an async fixture.
- **Rate limiting is auto-disabled** in tests via an autouse fixture (`_disable_rate_limiter`). Tests should assert actual business logic status codes, not 429.
- Use the factory helpers in `backend/tests/conftest.py` (`create_user`, `create_card`, `create_card_type`, etc.) rather than inserting raw models. Note: `create_card_type` defaults to `built_in=False`; pass `built_in=True` explicitly when testing built-in type behavior.
- Frontend tests use Vitest + Testing Library. Mock the API client with `vi.mock("@/api/client")`, not the global fetch.
- Pure logic (calculation engine, BPMN parser, encryption, JWT) should have unit tests that need no database.
- **Seed demo data must stay compatible with the metamodel.** `test_seed_demo.py` validates that every card type, subtype, attribute key, select option, and relation type used in `seed_demo.py` and `seed_demo_bpm.py` matches the definitions in `seed.py`. When changing the metamodel, update the demo data or these tests will fail. `test_seed_demo_security.py` does the equivalent for `seed_demo_security.py` — it asserts that every card name referenced by the demo Compliance findings exists in `seed_demo.py`'s Application + IT Component list, and that every regulation key / lifecycle state used by the seed is valid. Rename a NexaTech demo card and these tests will catch the dangling reference.

**Running tests locally:**
```bash
# Backend — unit tests only (no database needed)
cd backend && python -m pytest tests/core/ tests/services/ -q

# Backend — all tests (auto-provisions ephemeral Postgres via Docker)
./scripts/test.sh

# Frontend
cd frontend && npm test          # watch mode
cd frontend && npm run test:run  # single run (CI mode)
```

### User Documentation (User Manual)

Every feature or UI change **must** include updates to the user manual. The user manual lives in `docs/` and is built with **MkDocs Material** + **mkdocs-static-i18n**. It deploys automatically to Cloudflare Pages on every push to `main`. See `CONTRIBUTING.md` for the full documentation guide — the rules below are the mandatory checklist for every change.

#### Documentation Structure

```
docs/
├── index.md / index.{locale}.md          ← Homepage
├── assets/img/{en,es,de,...}/            ← Per-language screenshots
├── getting-started/                      ← Onboarding pages
├── guide/                                ← Feature documentation
├── admin/                                ← Administration guides
└── reference/glossary.md / .{locale}.md  ← Glossary
```

Files use **suffix-based** i18n: `page.md` is English (default), `page.es.md` is Spanish, `page.de.md` is German, etc. Untranslated pages fall back to English automatically.

#### When to Update Docs

| Change Type | Required Doc Update |
|-------------|-------------------|
| **New feature** | Add or update the relevant guide/admin page in **all supported languages** (currently `en` + locale suffixes for `es`, `de`, `fr`, `it`, `pt`, `zh`, `ru`, `da`). |
| **UI change** | Replace affected screenshots in **all locale folders** under `docs/assets/img/`. |
| **New admin setting** | Update the appropriate admin page (e.g., `docs/admin/settings.md`). |
| **New API endpoint** | Document in the relevant guide page if user-facing. |
| **Terminology change** | Update the glossary (`docs/reference/glossary.md` + all locale variants). |
| **New page** | Create `docs/path/page.md` (English) + all locale variants. Add to `nav:` in `mkdocs.yml` including locale-specific nav labels. |

#### Documentation Checklist for Code Changes

Before marking a feature task as complete, verify:

- [ ] **Guide page updated**: The relevant page under `docs/guide/` or `docs/admin/` describes the new/changed behavior in all supported languages.
- [ ] **Screenshots updated**: Any new or changed UI is captured in `docs/assets/img/{locale}/` for all locales. Follow the `NN_short_description.png` naming convention. **Every screenshot added to `scripts/screenshots/pages.ts` MUST also be referenced in the corresponding documentation page** (`docs/guide/` or `docs/admin/`) in ALL 8 locale files — otherwise the screenshot is captured but never displayed.
- [ ] **Screenshot script updated**: New pages/screens are added to `scripts/screenshots/pages.ts` (see section below). **Never add a screenshot to the script without also adding the `![Alt Text](../assets/img/{locale}/{filename}.png)` reference to the matching doc page in all locales.**
- [ ] **Navigation updated**: New pages are added to `nav:` in `mkdocs.yml` with translated labels for all locales.
- [ ] **Glossary updated**: New terms are added to `docs/reference/glossary.md` and all locale variants.
- [ ] **Grammar checked**: All documentation text has correct grammar, spelling, and diacritical marks (accents, umlauts, cedillas, tildes) in every supported language. Do not strip or omit diacritics — use proper characters (e.g., `ä ö ü ß` for German, `é è ê ç à` for French, `á é í ó ú ñ` for Spanish, `è é à ù ò` for Italian, `á â ã ç é ê í ó ô õ ú` for Portuguese).
- [ ] **Docs build passes**: Run `mkdocs build --strict` to verify no broken links or missing files.

#### Previewing Docs Locally

```bash
pip install -r requirements-docs.txt
mkdocs serve
# → http://127.0.0.1:8000
```

### Screenshot Automation

The project includes a **Playwright-based screenshot capture script** at `scripts/screenshots/` that automatically generates all documentation and marketing screenshots. When you add a new page, UI feature, or change existing UI, you **must** update the screenshot definitions so that automated captures stay in sync.

**IMPORTANT**: Screenshots and documentation are a **two-way contract**. Adding a screenshot to `pages.ts` without referencing it in the docs means it will be captured but never displayed. Adding an image reference in a doc without a `pages.ts` entry means it will never be auto-captured. Always update both together:
1. Add/update the entry in `scripts/screenshots/pages.ts` (with `filenames` for all 8 locales)
2. Add the `![Alt Text](../assets/img/{locale}/{filename}.png)` reference in the corresponding doc page in **all 8 locale files** (`.md`, `.de.md`, `.fr.md`, `.es.md`, `.it.md`, `.pt.md`, `.zh.md`, `.ru.md`)

#### How It Works

1. Launches headless Chromium via Playwright at 2x device scale (Retina quality).
2. Authenticates via `POST /api/v1/auth/login` and injects the JWT into `sessionStorage`.
3. Resolves card UUIDs from demo data (e.g., `{{cardId:sampleApp}}` → NexaCore ERP UUID).
4. Switches locale per capture run (EN, ES, etc.) via API + localStorage.
5. Navigates to each configured route, executes pre-capture actions (scroll, click, hover, wait), and saves screenshots to `docs/assets/img/{locale}/`.

#### Configuration

All screenshot definitions live in **`scripts/screenshots/pages.ts`**:

- **`DOC_PAGES`** array: Documentation screenshots (saved to `docs/assets/img/{locale}/`). Each entry has an `id`, `route`, optional `waitFor`/`actions`, and `filenames` per locale.
- **`MARKETING_PAGES`** array: Marketing site screenshots (saved to `marketing-site/assets/screenshots/`).
- **`CARD_LOOKUPS`**: Maps card names to search queries for UUID resolution from demo data.

Example entry:
```typescript
{
  id: "26_admin_settings_ai",
  route: "/admin/settings?tab=ai",
  waitFor: ".MuiPaper-root",
  actions: [{ type: "wait", ms: 600 }],
  filenames: {
    en: "26_admin_settings_ai",
    es: "26_admin_config_ia",
  },
},
```

#### When to Update the Screenshot Script

| Change Type | What to Update in `scripts/screenshots/pages.ts` |
|-------------|--------------------------------------------------|
| **New page/route** | Add a new entry to `DOC_PAGES` with the next sequential `id` number. Include `filenames` for all supported locales (`en`, `es` at minimum). |
| **Changed route path** | Update the `route` field on the affected entry. |
| **New UI section requiring interaction** | Add `actions` (click tab, scroll, wait) to capture the specific state. |
| **New card type in demo data** | Add a `CARD_LOOKUPS` entry if the screenshot needs to navigate to a specific card. |
| **Removed page** | Remove the corresponding entry from `DOC_PAGES` or `MARKETING_PAGES`. |

#### Running the Screenshot Script

```bash
cd scripts/screenshots
npm install && npm run install-browsers

# Prerequisites: Turbo EA running with demo data
# SEED_DEMO=true docker compose up --build -d

npm run capture              # All docs + marketing, all locales
npm run capture:en           # English only
npm run capture:marketing    # Marketing screenshots only
npx tsx capture.ts --only 26 # Specific screenshot by ID prefix
npx tsx capture.ts --dry-run # Preview without saving files
```

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│  Browser                                                  │
│  React 18 + MUI 6 + React Router 7 + Recharts + AG Grid  │
│  Vite dev server (port 5173) / Nginx in production        │
└──────────────────────────┬────────────────────────────────┘
                           │  /api/* (proxy)
┌──────────────────────────▼────────────────────────────────┐
│  FastAPI Backend (Python 3.12, uvicorn, port 8000)        │
│  SQLAlchemy 2 (async) + Alembic migrations                │
│  RBAC permissions + JWT auth (HS256, bcrypt, PyJWT)       │
│  SSE event stream for real-time updates                   │
│  Rate limiting (slowapi) + field encryption (Fernet)      │
│  AI suggestions via Ollama-compatible LLM + web search    │
└──────────────┬───────────────────────┬────────────────────┘
               │                       │  /api/chat, /api/tags
┌──────────────▼──────────────┐  ┌─────▼──────────────────────┐
│  PostgreSQL (asyncpg driver)│  │  Ollama (optional, ai       │
│  Bundled `db` service in    │  │  profile) or external LLM   │
│  the compose network        │  │  provider on port 11434     │
└─────────────────────────────┘  └─────────────────────────────┘
```

**DrawIO** is self-hosted inside the frontend Docker image (cloned at build time from `jgraph/drawio` v26.0.9) and served under `/drawio/` by Nginx.

---

## Terminology

The codebase uses **"cards"** throughout (models, routes, UI). Earlier documentation may reference "fact sheets" — this has been fully renamed. The core entity table is `cards`, the API route is `/api/v1/cards`, and the frontend route is `/cards/:id`.

---

## Project Structure

```
turbo-ea/
├── VERSION                            # SemVer (single source of truth, e.g. "1.36.0")
├── .dockerignore                      # Root-level (both services use root context)
├── docker-compose.yml                 # Full stack including PostgreSQL + edge nginx
├── dev/
│   ├── docker-compose.dev.yml         # Dev-only build file for local source builds
│   └── README.md                      # Explains the dev compose workflow
├── test/
│   ├── docker-compose.test.yml        # Test-only Postgres harness for scripts/test.sh
│   └── README.md                      # Explains the test compose workflow
├── .env.example
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── deps.py                # Auth dependencies (get_current_user, require_permission)
│   │   │   └── v1/
│   │   │       ├── router.py          # Mounts all API routers (50 include_router calls)
│   │   │       ├── auth.py            # /auth (login, register, me, SSO, set-password)
│   │   │       ├── cards.py           # /cards CRUD + hierarchy + approval status + CSV export
│   │   │       ├── metamodel.py       # /metamodel (types + relation types + field/section usage)
│   │   │       ├── relations.py       # /relations CRUD
│   │   │       ├── stakeholders.py    # /cards/{id}/stakeholders (role assignments)
│   │   │       ├── stakeholder_roles.py # /stakeholder-roles (per-type role definitions)
│   │   │       ├── roles.py           # /roles (app-level RBAC management)
│   │   │       ├── calculations.py    # /calculations (computed field formulas)
│   │   │       ├── bpm.py             # /bpm (BPMN diagram CRUD + templates)
│   │   │       ├── bpm_assessments.py # /bpm (process assessments)
│   │   │       ├── bpm_reports.py     # /bpm/reports (maturity, risk, automation)
│   │   │       ├── bpm_workflow.py    # /bpm (process flow version approval)
│   │   │       ├── ppm.py             # /ppm (status reports, costs, budgets, risks, tasks, WBS)
│   │   │       ├── ppm_reports.py     # /reports/ppm (dashboard, gantt, group-options)
│   │   │       ├── diagrams.py        # /diagrams CRUD (DrawIO XML storage)
│   │   │       ├── diagram_groups.py  # /diagram-groups (diagram folders + per-user favorites)
│   │   │       ├── soaw.py            # /soaw (Statement of Architecture Work)
│   │   │       ├── reports.py         # /reports (dashboard, portfolio, matrix, etc.)
│   │   │       ├── saved_reports.py   # /saved-reports (persisted report configs)
│   │   │       ├── tags.py            # /tag-groups + /cards/{id}/tags
│   │   │       ├── comments.py        # /cards/{id}/comments (threaded)
│   │   │       ├── todos.py           # /todos + /cards/{id}/todos
│   │   │       ├── documents.py       # /cards/{id}/documents (link storage)
│   │   │       ├── bookmarks.py       # /bookmarks (saved inventory views)
│   │   │       ├── events.py          # /events + /events/stream (SSE)
│   │   │       ├── users.py           # /users CRUD (admin only)
│   │   │       ├── ai_suggest.py       # /ai (AI description suggestions + status)
│   │   │       ├── settings.py        # /settings (logo, currency, SMTP, favicon, AI)
│   │   │       ├── surveys.py         # /surveys (data-maintenance surveys)
│   │   │       ├── eol.py             # /eol (End-of-Life proxy for endoflife.date)
│   │   │       ├── web_portals.py     # /web-portals (public portal management)
│   │   │       ├── notifications.py   # /notifications (user notifications)
│   │   │       ├── servicenow.py      # /servicenow (CMDB sync integration)
│   │   │       ├── adr.py             # /adr (Architecture Decision Records)
│   │   │       ├── file_attachments.py # /cards/{id}/attachments (file uploads)
│   │   │       ├── risks.py           # /risks + /cards/{id}/risks (TOGAF Risk Register)
│   │   │       ├── risk_mitigation_tasks.py # /risks/{id}/mitigation-tasks (+ recurring occurrences)
│   │   │       ├── favorites.py       # /favorites (per-user favorited cards)
│   │   │       ├── capability_catalogue.py # /capability-catalogue (industry catalogue)
│   │   │       ├── principles_catalogue.py # /principles-catalogue (curated reference set)
│   │   │       ├── process_catalogue.py    # /process-catalogue (industry process reference)
│   │   │       ├── value_stream_catalogue.py # /value-stream-catalogue (value stream reference)
│   │   │       ├── migration.py        # /migration (platform-migration importer — LeanIX etc.)
│   │   │       ├── mutation_batches.py # /mutation-batches (MCP write ledger + per-event diff)
│   │   │       └── workspace.py         # /admin/workspace (full-workspace export/import — TEA↔TEA)
│   │   ├── core/
│   │   │   ├── security.py            # JWT creation/validation (PyJWT HS256), bcrypt
│   │   │   ├── permissions.py         # Permission key registry (single source of truth)
│   │   │   ├── encryption.py          # Fernet symmetric encryption for DB secrets
│   │   │   └── rate_limit.py          # slowapi rate limiter instance
│   │   ├── models/                    # SQLAlchemy ORM models (52 files, see Database section)
│   │   ├── schemas/                   # Pydantic request/response models
│   │   │   ├── auth.py                # Auth schemas
│   │   │   ├── card.py                # Card schemas
│   │   │   ├── common.py              # Shared schemas (pagination, sorting)
│   │   │   ├── relation.py            # Relation schemas
│   │   │   ├── bpm.py                 # BPM schemas
│   │   │   ├── ppm.py                 # PPM schemas
│   │   │   └── ai_suggest.py          # AI suggestion request/response schemas
│   │   ├── services/
│   │   │   ├── event_bus.py           # In-memory pub/sub + SSE streaming
│   │   │   ├── permission_service.py  # RBAC permission checks (5-min cache)
│   │   │   ├── calculation_engine.py  # Safe formula eval (simpleeval sandbox)
│   │   │   ├── ai_service.py          # AI description suggestions (web search + LLM)
│   │   │   ├── bpmn_parser.py         # BPMN 2.0 XML → element extraction
│   │   │   ├── element_relation_sync.py # Link BPMN elements to EA cards
│   │   │   ├── servicenow_service.py  # ServiceNow API client + sync
│   │   │   ├── seed.py                # Default metamodel (13 types, 30+ relations)
│   │   │   ├── seed_demo.py           # NexaTech Industries demo dataset
│   │   │   ├── seed_demo_bpm.py       # Demo BPM processes
│   │   │   ├── seed_demo_ppm.py       # Demo PPM data (status reports, WBS, tasks, budgets, costs, risks)
│   │   │   ├── notification_service.py # In-memory + DB notification management
│   │   │   └── email_service.py       # SMTP-based email sending
│   │   ├── config.py                  # Settings from env vars + APP_VERSION
│   │   ├── database.py                # Async engine + session factory
│   │   └── main.py                    # FastAPI app, lifespan (migrations + seed + purge loop + AI auto-config)
│   ├── alembic/                       # Database migrations (116 versions)
│   ├── tests/
│   └── pyproject.toml
│
├── Dockerfile                         # Root multi-stage build (targets: backend, db, frontend, nginx, ollama, mcp-server)
├── nginx/                             # Edge nginx config + assets (default.conf, assets/)
│
├── frontend/
│   ├── src/
│   │   ├── api/client.ts              # Fetch wrapper with JWT (sessionStorage) + error handling
│   │   ├── types/index.ts             # All TypeScript interfaces
│   │   ├── globals.d.ts               # __APP_VERSION__ type declaration
│   │   ├── print.css                  # Print stylesheet
│   │   ├── hooks/
│   │   │   ├── useAuth.ts             # Login/register/logout + token in sessionStorage
│   │   │   ├── useMetamodel.ts        # Cached metamodel types + relation types
│   │   │   ├── useEventStream.ts      # SSE subscription hook
│   │   │   ├── useCurrency.ts         # Global currency format + symbol cache (singleton)
│   │   │   ├── useDateFormat.ts       # Global date format (singleton)
│   │   │   ├── useEnabledLocales.ts   # Active locale list from settings
│   │   │   ├── useThemeMode.ts        # Light/dark mode preference
│   │   │   ├── useAppTitle.ts         # Tab + browser title from settings
│   │   │   ├── usePermissions.ts      # Effective permissions for current card
│   │   │   ├── useCalculatedFields.ts # Track calculated fields per type
│   │   │   ├── useResolveLabel.ts     # Metamodel label resolver (per-locale translations)
│   │   │   ├── useBpmEnabled.ts       # BPM feature flag (singleton)
│   │   │   ├── usePpmEnabled.ts       # PPM feature flag (singleton)
│   │   │   ├── useGrcEnabled.ts       # GRC feature flag (singleton)
│   │   │   ├── useTurboLensReady.ts   # TurboLens readiness (singleton)
│   │   │   ├── useAiStatus.ts         # AI provider status (singleton)
│   │   │   ├── useComplianceRegulations.ts # Compliance regulation catalogue
│   │   │   ├── useSavedReport.ts      # Saved report caching
│   │   │   ├── useThumbnailCapture.ts # SVG → PNG for report thumbnails
│   │   │   ├── useTimeline.ts         # Process timeline data
│   │   │   ├── useResourceTypes.ts    # Resource type catalogue (metamodel resource types)
│   │   │   ├── useLoginBranding.ts    # Public login-page branding (singleton)
│   │   │   ├── useFileUploadsEnabled.ts # File-attachment feature flag (singleton)
│   │   │   ├── useArchiveRetentionDays.ts # Archived-card purge window (singleton)
│   │   │   ├── useSponsorButtonEnabled.ts # Sponsor affordance toggle (singleton)
│   │   │   └── useCardTabActivity.ts  # Per-card tab unread/activity indicators
│   │   ├── layouts/AppLayout.tsx       # Top nav bar + mobile drawer + badge debounce
│   │   ├── components/
│   │   │   ├── CreateCardDialog.tsx
│   │   │   ├── LifecycleBadge.tsx
│   │   │   ├── ApprovalStatusBadge.tsx
│   │   │   ├── MaterialSymbol.tsx
│   │   │   ├── NotificationBell.tsx
│   │   │   ├── NotificationPreferencesDialog.tsx
│   │   │   ├── EolLinkSection.tsx
│   │   │   ├── VendorField.tsx
│   │   │   ├── AiSuggestPanel.tsx
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ColorPicker.tsx
│   │   │   ├── KeyInput.tsx
│   │   │   └── TimelineSlider.tsx
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── LoginPage.tsx       # Email/password + SSO login
│   │   │   │   ├── SetPasswordPage.tsx # Invited user password setup
│   │   │   │   └── SsoCallback.tsx     # SSO OAuth callback handler
│   │   │   ├── dashboard/Dashboard.tsx
│   │   │   ├── inventory/
│   │   │   │   ├── InventoryPage.tsx        # AG Grid + memoized configs
│   │   │   │   ├── InventoryFilterSidebar.tsx # Filter panel
│   │   │   │   ├── ImportDialog.tsx          # Excel/CSV import
│   │   │   │   ├── RelationCellPopover.tsx   # Relation column popover
│   │   │   │   ├── excelExport.ts            # Excel export logic
│   │   │   │   └── excelImport.ts            # Excel import logic
│   │   │   ├── cards/
│   │   │   │   ├── CardDetail.tsx           # Main container + tab navigation
│   │   │   │   └── sections/               # Modular section components
│   │   │   │       ├── index.ts             # Barrel export
│   │   │   │       ├── cardDetailUtils.tsx   # Shared utilities (DataQualityRing, FieldEditor)
│   │   │   │       ├── DescriptionSection.tsx
│   │   │   │       ├── LifecycleSection.tsx
│   │   │   │       ├── AttributeSection.tsx  # Custom fields per section
│   │   │   │       ├── HierarchySection.tsx
│   │   │   │       ├── RelationsSection.tsx
│   │   │   │       ├── StakeholdersTab.tsx
│   │   │   │       ├── CommentsTab.tsx
│   │   │   │       ├── TodosTab.tsx
│   │   │   │       └── HistoryTab.tsx
│   │   │   ├── bpm/                         # Business Process Management
│   │   │   │   ├── BpmDashboard.tsx
│   │   │   │   ├── ProcessFlowEditorPage.tsx
│   │   │   │   ├── BpmnModeler.tsx          # bpmn-js integration
│   │   │   │   ├── BpmnViewer.tsx
│   │   │   │   ├── BpmnTemplateChooser.tsx
│   │   │   │   ├── ProcessFlowTab.tsx       # Embedded in card detail
│   │   │   │   ├── ProcessAssessmentPanel.tsx
│   │   │   │   ├── ProcessNavigator.tsx
│   │   │   │   ├── ElementLinker.tsx
│   │   │   │   └── BpmReportPage.tsx
│   │   │   ├── ppm/                          # Project Portfolio Management
│   │   │   │   ├── PpmPortfolio.tsx          # Portfolio dashboard with Gantt chart
│   │   │   │   ├── PpmProjectDetail.tsx      # Initiative detail (tabbed)
│   │   │   │   ├── PpmOverviewTab.tsx        # Initiative snapshot
│   │   │   │   ├── PpmReportsTab.tsx         # Status reports with health badges
│   │   │   │   ├── PpmCostTab.tsx            # Budget + cost lines
│   │   │   │   ├── PpmRiskTab.tsx            # Risk matrix + list
│   │   │   │   ├── PpmTaskBoard.tsx          # Kanban board (dnd-kit)
│   │   │   │   ├── PpmTaskCard.tsx           # Task card component
│   │   │   │   ├── PpmTaskDialog.tsx         # Create/edit task dialog
│   │   │   │   ├── PpmGanttTab.tsx           # Timeline view with milestones
│   │   │   │   ├── PpmWbsDialog.tsx          # Create/edit WBS item dialog
│   │   │   │   └── StatusReportDialog.tsx    # Create/edit status report dialog
│   │   │   ├── diagrams/
│   │   │   │   ├── DiagramsPage.tsx         # Gallery with thumbnails
│   │   │   │   ├── DiagramEditor.tsx        # DrawIO iframe editor
│   │   │   │   ├── DiagramSyncPanel.tsx     # Card ↔ diagram sync
│   │   │   │   ├── CardSidebar.tsx          # Card picker sidebar
│   │   │   │   ├── CardPickerDialog.tsx     # Search & select cards
│   │   │   │   ├── CreateOnDiagramDialog.tsx # Create card from diagram
│   │   │   │   ├── RelationPickerDialog.tsx # Relation management
│   │   │   │   └── drawio-shapes.ts         # mxGraph cell helpers
│   │   │   ├── reports/
│   │   │   │   ├── PortfolioReport.tsx      # Bubble/scatter chart
│   │   │   │   ├── CapabilityMapReport.tsx  # Heatmap
│   │   │   │   ├── LifecycleReport.tsx      # Timeline visualization
│   │   │   │   ├── DependencyReport.tsx     # Network graph
│   │   │   │   ├── CostReport.tsx           # Treemap + bar chart
│   │   │   │   ├── MatrixReport.tsx         # Cross-reference grid
│   │   │   │   ├── DataQualityReport.tsx    # Completeness dashboard
│   │   │   │   ├── EolReport.tsx            # End-of-Life status
│   │   │   │   ├── ProcessMapReport.tsx     # Process map visualization
│   │   │   │   ├── SavedReportsPage.tsx     # Saved report gallery
│   │   │   │   ├── ReportShell.tsx          # Shared report layout wrapper
│   │   │   │   ├── MetricCard.tsx           # Reusable KPI card
│   │   │   │   ├── ReportLegend.tsx         # Shared legend component
│   │   │   │   ├── SaveReportDialog.tsx     # Save report config dialog
│   │   │   │   ├── EditReportDialog.tsx     # Edit saved report dialog
│   │   │   │   └── matrixHierarchy.ts       # Matrix hierarchy helpers
│   │   │   ├── ea-delivery/
│   │   │   │   ├── EADeliveryPage.tsx       # SoAW document list
│   │   │   │   ├── SoAWEditor.tsx           # Create/edit SoAW
│   │   │   │   ├── SoAWPreview.tsx          # Read-only preview
│   │   │   │   ├── RichTextEditor.tsx       # TipTap rich text editor
│   │   │   │   ├── EditableTable.tsx        # Inline-editable table
│   │   │   │   ├── soawExport.ts            # DOCX export logic
│   │   │   │   └── soawTemplate.ts          # SoAW section templates
│   │   │   ├── todos/TodosPage.tsx          # Todos + surveys (tabbed)
│   │   │   ├── surveys/
│   │   │   │   ├── SurveyRespond.tsx        # Survey response form
│   │   │   │   └── MySurveys.tsx            # User's pending surveys
│   │   │   ├── web-portals/PortalViewer.tsx # Public portal (no auth)
│   │   │   ├── capability-catalogue/        # Industry capability catalogue browser
│   │   │   │   ├── CapabilityCataloguePage.tsx
│   │   │   │   ├── CapabilityCatalogueBrowser.tsx
│   │   │   │   └── IndustryFilter.tsx
│   │   │   ├── principles-catalogue/        # Curated EA principles reference set
│   │   │   ├── process-catalogue/           # Industry business process reference
│   │   │   ├── value-stream-catalogue/      # Value stream reference set
│   │   │   ├── reference-catalogue/         # Shared catalogue shell + utilities
│   │   │   ├── grc/                         # GRC module — embeds Risk Register, Compliance, Governance
│   │   │   │   ├── GrcPage.tsx              # Tabbed shell (risk / compliance / governance)
│   │   │   │   ├── risk/                    # Risk Register + mitigation tasks (TOGAF Phase G)
│   │   │   │   │   ├── RiskRegisterPage.tsx
│   │   │   │   │   ├── RiskDetailPage.tsx
│   │   │   │   │   ├── RiskMatrix.tsx
│   │   │   │   │   ├── CreateRiskDialog.tsx
│   │   │   │   │   └── mitigation/          # MitigationTasksPanel + dialogs + occurrence history
│   │   │   │   ├── compliance/              # Regulation-driven compliance scanner (no CVE half)
│   │   │   │   │   ├── ComplianceScanner.tsx
│   │   │   │   │   ├── ComplianceGrid.tsx
│   │   │   │   │   ├── ComplianceHeatmap.tsx
│   │   │   │   │   ├── ComplianceLifecycleTimeline.tsx
│   │   │   │   │   ├── FindingDetailDrawer.tsx
│   │   │   │   │   └── CreateComplianceFindingDialog.tsx
│   │   │   │   └── governance/              # Principles + Decisions panels
│   │   │   │       ├── GovernanceTab.tsx
│   │   │   │       ├── PrinciplesPanel.tsx
│   │   │   │       └── DecisionsPanel.tsx
│   │   │   ├── turbolens/                   # AI-powered EA intelligence (see TurboLens section)
│   │   │   └── admin/
│   │   │       ├── MetamodelAdmin.tsx       # Type list + relation graph orchestrator
│   │   │       ├── metamodel/               # Modular metamodel admin components
│   │   │       │   ├── index.ts
│   │   │       │   ├── constants.ts         # FIELD_TYPE_OPTIONS, icons, colors
│   │   │       │   ├── helpers.ts           # Validation, defaults
│   │   │       │   ├── TypeDetailDrawer.tsx  # Type editor + field/section CRUD
│   │   │       │   ├── FieldEditorDialog.tsx # Field config (type, options, weight)
│   │   │       │   ├── StakeholderRolePanel.tsx # Per-type role definitions
│   │   │       │   └── MetamodelGraph.tsx   # Relation type SVG visualization
│   │   │       ├── CardLayoutEditor.tsx      # Section ordering, DnD fields, columns, groups
│   │   │       ├── RolesAdmin.tsx            # App-level role + permission management
│   │   │       ├── CalculationsAdmin.tsx     # Calculated field formula management
│   │   │       ├── TagsAdmin.tsx
│   │   │       ├── UsersAdmin.tsx
│   │   │       ├── SettingsAdmin.tsx
│   │   │       ├── EolAdmin.tsx
│   │   │       ├── SurveysAdmin.tsx
│   │   │       ├── SurveyBuilder.tsx
│   │   │       ├── SurveyResults.tsx
│   │   │       ├── WebPortalsAdmin.tsx
│   │   │       ├── ServiceNowAdmin.tsx
│   │   │       ├── AuthAdmin.tsx          # SSO / Authentication settings
│   │   │       ├── PrinciplesAdmin.tsx    # EA principles CRUD (statement, rationale, implications)
│   │   │       ├── TurboLensAdmin.tsx     # TurboLens analysis settings
│   │   │       ├── AiAdmin.tsx            # AI suggestion settings (provider, model, search)
│   │   │       ├── AuditLogAdmin.tsx      # Audit log over the mutation-batch ledger (+ filter sidebar, batch drawer)
│   │   │       └── ResourceTypesAdmin.tsx # Resource type catalogue management (see metamodel/settings)
│   │   ├── App.tsx                          # Routes + MUI theme (lazy imports)
│   │   └── main.tsx                         # React entry point
│   ├── drawio-config/                       # PreConfig.js, PostConfig.js
│   ├── nginx.conf                           # API proxy + DrawIO + security headers
│   ├── package.json
│   └── vite.config.ts                       # __APP_VERSION__ injection from VERSION file
│
├── mcp-server/
│   ├── turbo_ea_mcp/
│   │   ├── server.py              # FastMCP tools, resources, prompts + ASGI app
│   │   ├── api_client.py          # HTTP client for Turbo EA backend API
│   │   ├── oauth.py               # OAuth 2.1 authorization server (SSO-delegated)
│   │   ├── config.py              # Environment-based config (TURBO_EA_URL, MCP_PORT, etc.)
│   │   └── __main__.py            # CLI entry point
│   ├── tests/
│   │   ├── test_server.py         # MCP tool tests
│   │   └── test_oauth.py          # OAuth flow tests
│   └── pyproject.toml
│
└── (root) Dockerfile is shared across services — see top of tree
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `turboea` | Database name |
| `POSTGRES_USER` | `turboea` | Database user |
| `POSTGRES_PASSWORD` | `turboea` | Database password |
| `SECRET_KEY` | `change-me-in-production` | HMAC key for JWT signing. **Must** be changed in production (app refuses to start with default in non-development environments) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` (24h) | JWT token lifetime |
| `HOST_PORT` | `8920` | Public HTTP port exposed on the host for the bundled edge nginx. Set `80` for direct HTTPS deployments with redirect support. |
| `TLS_HOST_PORT` | `9443` | Public HTTPS port exposed on the host when direct TLS is enabled. Set `443` for standard HTTPS deployments. |
| `RESET_DB` | `false` | Drop all tables and re-create + re-seed on startup |
| `SEED_DEMO` | `false` | Populate NexaTech Industries demo data on startup |
| `SEED_BPM` | `false` | Populate demo BPM processes |
| `SEED_PPM` | `false` | Populate demo PPM data (status reports, WBS, tasks, budgets, costs, risks) |
| `TURBO_EA_TLS_ENABLED` | `false` | Enable direct TLS termination in the bundled edge nginx |
| `TLS_CERTS_DIR` | `./certs` | Host path mounted read-only at `/certs` inside the nginx container |
| `TURBO_EA_TLS_CERT_FILE` | `cert.pem` | Certificate filename inside `TLS_CERTS_DIR` |
| `TURBO_EA_TLS_KEY_FILE` | `key.pem` | Private-key filename inside `TLS_CERTS_DIR` |
| `ENVIRONMENT` | `development` | Runtime environment. Controls: API docs visibility, secret key validation |
| `ALLOWED_ORIGINS` | `http://localhost:8920` | CORS allowed origins (comma-separated) |
| `SMTP_HOST` | *(empty)* | SMTP server hostname (optional) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | *(empty)* | SMTP username |
| `SMTP_PASSWORD` | *(empty)* | SMTP password |
| `SMTP_FROM` | `noreply@turboea.local` | Sender email address |
| `SMTP_TLS` | `true` | Use TLS for SMTP |
| `AI_PROVIDER_URL` | *(empty)* | Ollama-compatible LLM provider URL (e.g., `http://ollama:11434`) |
| `AI_MODEL` | *(empty)* | LLM model name (e.g., `mistral`, `gemma3:4b`, `llama3:8b`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Web search provider for AI context: `duckduckgo`, `google`, or `searxng` |
| `AI_SEARCH_URL` | *(empty)* | Search provider URL: SearXNG URL or `API_KEY:CX` for Google |
| `AI_AUTO_CONFIGURE` | `false` | Auto-enable AI on startup if provider is reachable |
| `OLLAMA_MEMORY_LIMIT` | `4G` | Memory limit for bundled Ollama container (Docker `--profile ai`) |
| `TURBO_EA_URL` | `http://localhost:8000` | (MCP server) Internal backend URL |
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | Public-facing Turbo EA URL for OAuth redirects and bundled nginx hostname/proto derivation |
| `MCP_PUBLIC_URL` | `http://localhost:8001` | (MCP server) Public URL for OAuth metadata |
| `MCP_PORT` | `8001` | (MCP server) Bind port |
| `MCP_WRITES_ENABLED` | `true` | (MCP server) Kill switch for all 17 write tools — set to `false` to put the MCP server into read-only mode without a code redeploy. Read tools keep working. |
| `MCP_MAX_CARDS_PER_CALL` | `200` | (MCP server) Per-call size cap for `create_cards_bulk`. The backend `/cards/bulk-create` endpoint still accepts up to 2000 for the legitimate Excel importer; the MCP wrapper enforces this lower cap so a dry-run preview stays reviewable. |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | (MCP server) Per-call size cap for `upsert_relations_bulk`. Backend accepts up to 5000 from the UI. |
| `MCP_ALLOW_RELATION_DELETE` | `false` | (MCP server) When `false` (default), `upsert_relations_bulk` refuses `action: "delete"` ops — relations must be removed via the web UI for an explicit audit trail. Set `true` only when an operator opts in. |

For local frontend dev without Docker, create `frontend/.env.development`:
```
VITE_DRAWIO_URL=https://embed.diagrams.net
```

---

## Database Schema

All tables use UUID primary keys and `created_at`/`updated_at` timestamps (from `UUIDMixin` + `TimestampMixin` in `backend/app/models/base.py`).

### Core Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `users` | `User` | Email, display_name, password_hash, role_key (FK to roles), is_active, SSO fields, password_reset_token / password_reset_expires_at (local-account forgot-password flow) |
| `card_types` | `CardType` | Metamodel: types with key, label, icon, color, category, subtypes (JSONB), fields_schema (JSONB), section_config (JSONB), stakeholder_roles (JSONB), has_hierarchy, built_in, is_hidden, sort_order |
| `relation_types` | `RelationType` | Metamodel: allowed relations between types with label, reverse_label, cardinality, attributes_schema (JSONB) |
| `cards` | `Card` | The core entity. Type, subtype, name, description, parent_id (hierarchy), lifecycle (JSONB), attributes (JSONB), status, approval_status, data_quality (float 0-100), archived_at |
| `relations` | `Relation` | Links between cards. Type key, source_id, target_id, attributes (JSONB) |

### RBAC Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `roles` | `Role` | App-level roles with key, label, color, permissions (JSONB), is_system, is_default, is_archived, sort_order |
| `stakeholder_role_definitions` | `StakeholderRoleDefinition` | Per-card-type stakeholder role definitions with permissions, is_archived |
| `stakeholders` | `Stakeholder` | User role assignments on specific cards |

### BPM Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `process_diagrams` | `ProcessDiagram` | BPMN 2.0 XML storage linked to BusinessProcess cards |
| `process_elements` | `ProcessElement` | Extracted BPMN elements (tasks, events, gateways, lanes) |
| `process_flow_versions` | `ProcessFlowVersion` | Version history with approval workflow (draft/pending/published/archived) |
| `process_assessments` | `ProcessAssessment` | Process scores: efficiency, effectiveness, compliance |

### PPM Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `ppm_status_reports` | `PpmStatusReport` | Initiative health reports: schedule/cost/scope health, summary, accomplishments, next steps |
| `ppm_cost_lines` | `PpmCostLine` | Actual cost transactions: description, category (capex/opex), planned, actual, date |
| `ppm_budget_lines` | `PpmBudgetLine` | Planned budget per fiscal year: category (capex/opex), amount |
| `ppm_risks` | `PpmRisk` | Initiative risks: probability (1-5), impact (1-5), auto-computed risk_score, mitigation, status |
| `ppm_tasks` | `PpmTask` | Work items: status (todo/in_progress/done/blocked), priority, assignee, tags (JSONB), WBS link |
| `ppm_task_comments` | `PpmTaskComment` | Comments on PPM tasks |
| `ppm_wbs` | `PpmWbs` | Work Breakdown Structure: self-referential hierarchy, completion (auto-rolled up), milestones |
| `ppm_dependencies` | `PpmDependency` | Finish-to-start schedule dependency between two PPM rows (task and/or WBS item), used by the Gantt view |

### Calculation Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `calculations` | `Calculation` | Admin-defined formulas: name, formula, target_type_key, target_field_key, is_active, execution_order |

### Supporting Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `tag_groups` | `TagGroup` | Tag categories with mode (single/multi), mandatory flag, restrict_to_types. Mandatory groups that apply to a card type must be satisfied before the card can be approved and also contribute to the data-quality score |
| `tags` | `Tag` | Individual tags within groups, with optional color |
| `card_tags` | (association) | M:N join table |
| `comments` | `Comment` | Threaded comments on cards (self-referential parent_id) |
| `todos` | `Todo` | Tasks linked to cards, assignable to users, with due dates |
| `documents` | `Document` | URL/link attachments on cards |
| `bookmarks` | `Bookmark` | Saved inventory filter/column/sort views per user |
| `events` | `Event` | Audit trail: event_type + JSONB data, linked to card and user |
| `diagrams` | `Diagram` | DrawIO diagram storage: name, type, data (JSONB with XML + thumbnail) |
| `diagram_initiatives` | (association) | M:N between diagrams and initiative cards |
| `diagram_groups` | `DiagramGroup` | Named folders that organise diagrams in the gallery |
| `diagram_favorites` | `DiagramFavorite` | Per-user favorited diagrams (M:N user × diagram) |
| `resource_types` | `ResourceType` | Admin-managed resource-type catalogue used by the metamodel |
| `statement_of_architecture_works` | `SoAW` | TOGAF SoAW documents linked to initiatives |
| `app_settings` | `AppSettings` | Singleton row: email_settings, general_settings (incl. AI config), custom_logo, custom_favicon |
| `surveys` | `Survey` | Data-maintenance surveys with target_type, filters, actions |
| `survey_responses` | `SurveyResponse` | Per card + user responses |
| `notifications` | `Notification` | Per-user notifications |
| `web_portals` | `WebPortal` | Public portals with slug-based URLs |
| `saved_reports` | `SavedReport` | Persisted report configurations with thumbnails |
| `sso_invitations` | `SsoInvitation` | Pre-assigned SSO invitations |
| `architecture_decisions` | `ArchitectureDecision` | ADR records (status, context, decision, alternatives, consequences) |
| `architecture_decision_cards` | `ArchitectureDecisionCard` | M:N junction between ADRs and cards |
| `ea_principles` | `EAPrinciple` | EA principles (statement, rationale, implications, sort_order, optional `catalogue_id` linking back to the bundled Principles Catalogue) — exposed via `/metamodel/principles`; the curated reference set is browsable at `/principles-catalogue` |
| `kpi_snapshots` | `KpiSnapshot` | Daily KPI snapshots powering the dashboard trend charts |
| `user_favorites` | `UserFavorite` | Per-user favorited cards (M:N user × card) |
| `risks` | `Risk` | EA Risk Register entries (TOGAF Phase G) — see Risk Register section |
| `risk_cards` | `RiskCard` | M:N junction between risks and affected cards |
| `risk_mitigation_tasks` / `risk_mitigation_task_occurrences` | `RiskMitigationTask` / `RiskMitigationTaskOccurrence` | Task-driven mitigation with recurring occurrences — see Risk Register section |
| `compliance_regulations` | `ComplianceRegulation` | Admin-managed regulation catalogue driving the GRC Compliance scanner |
| `turbolens_*` | TurboLens models | Vendor analysis, duplicates, modernizations, analysis runs, compliance findings — see TurboLens section |
| `mutation_batches` | `MutationBatch` | MCP write ledger — every MCP write call opens a batch; each emitted row in the `events` table is stamped with its `batch_id` (see MCP section) |
| `workspace_transfers` | `WorkspaceTransfer` | Async preview/apply lifecycle of an uploaded full-workspace export bundle (`uploaded → parsing → previewed → applying → applied`/`failed`). Bundle binary stored on disk under `data/workspace_transfers/{id}.bin` (see Workspace Transfer Conventions) |

### Migration (Platform Import) Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `migrations` | `Migration` | One row per uploaded third-party EA export (LeanIX, …), with `source_type` discriminator |
| `staged_records` | `StagedRecord` | Source-neutral staged entities/relations/etc. awaiting apply |
| `migration_identity_map` | `IdentityMap` | External-id → TEA-id map, keyed `(source_id, entity_kind, source_type)` |

### ServiceNow Integration Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `snow_connections` | `SnowConnection` | ServiceNow instance connection details |
| `snow_mappings` | `SnowMapping` | Card type ↔ ServiceNow table mappings (with skip_staging flag) |
| `snow_field_mappings` | `SnowFieldMapping` | Field-level mapping rules |
| `snow_sync_runs` | `SnowSyncRun` | Sync execution history |
| `snow_staged_records` | `SnowStagedRecord` | Staged records for review before apply |
| `snow_identity_map` | `SnowIdentityMap` | Persistent ID mapping between systems |

### Migrations

Located in `backend/alembic/versions/` (116 migration files, sequentially numbered `001_` through `116_`). The app auto-runs Alembic on startup:
- Fresh DB: `create_all` + stamp head
- Existing DB without Alembic: stamp head
- Normal: `upgrade head` (run pending migrations)
- `RESET_DB=true`: drop all + recreate + stamp head

---

## API Reference

Base path: `/api/v1`. All endpoints except auth and public portals require `Authorization: Bearer <token>`.

**API docs**: Available at `/api/docs` (Swagger UI) and `/api/openapi.json` in **development mode only** (`ENVIRONMENT=development`). Disabled in production.

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Register (first user gets admin) |
| POST | `/auth/login` | No | Login, returns `{access_token}` |
| GET | `/auth/me` | Yes | Current user info + permissions |
| POST | `/auth/refresh` | Yes | Refresh token |
| GET | `/auth/sso/config` | No | SSO configuration |
| POST | `/auth/sso/callback` | No | SSO OAuth callback |
| POST | `/auth/set-password` | No | Set password via invitation token |
| POST | `/auth/forgot-password` | No | Request a password-reset email (local accounts only; rate-limited) |
| GET | `/auth/validate-reset-token` | No | Check whether a password-reset token is valid and unexpired |
| POST | `/auth/reset-password` | No | Set a new password using a valid reset token |

### Metamodel (`/metamodel`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metamodel/types` | List types. `?include_hidden=true` for soft-deleted |
| GET | `/metamodel/types/{key}` | Get single type |
| POST | `/metamodel/types` | Create custom type |
| PATCH | `/metamodel/types/{key}` | Update type (fields_schema, section_config, stakeholder_roles, etc.) |
| DELETE | `/metamodel/types/{key}` | Soft-delete built-in, hard-delete custom |
| GET | `/metamodel/types/{key}/field-usage` | Count cards using a specific field |
| GET | `/metamodel/types/{key}/section-usage` | Count cards using any field in a section |
| GET | `/metamodel/types/{key}/option-usage` | Count cards using a specific select option |
| GET | `/metamodel/relation-types` | List relation types. `?type_key=X` to filter |
| POST | `/metamodel/relation-types` | Create relation type |
| PATCH | `/metamodel/relation-types/{key}` | Update relation type |
| DELETE | `/metamodel/relation-types/{key}` | Soft-delete / hard-delete |

### Cards (`/cards`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cards` | Paginated list. Query: `type`, `status`, `search`, `parent_id`, `approval_status`, `page`, `page_size`, `sort_by`, `sort_dir` |
| GET | `/cards/counts` | Counts by type / status / approval (lightweight, no card payload) |
| GET | `/cards/my-created` | Cards created by the current user |
| GET | `/cards/my-stakeholder` | Cards on which the current user holds a stakeholder role |
| POST | `/cards` | Create card. Auto-computes data quality, runs calculations |
| GET | `/cards/{id}` | Get card with tags + stakeholders |
| PATCH | `/cards/{id}` | Update. Breaks approval on substantive changes, recalculates quality |
| DELETE | `/cards/{id}` | Permanent delete (hard delete) |
| PATCH | `/cards/bulk` | Bulk update multiple cards |
| POST | `/cards/bulk-archive` | Soft-delete: status=ARCHIVED, sets archived_at. Auto-purged after 30 days |
| POST | `/cards/bulk-restore` | Restore archived cards |
| POST | `/cards/bulk-delete` | Permanent delete of multiple cards |
| POST | `/cards/{id}/archive` | Archive single card (with impact preview) |
| GET | `/cards/{id}/archive-impact` | Preview cards that would be cascade-archived |
| POST | `/cards/{id}/restore` | Restore single archived card |
| GET | `/cards/{id}/restore-impact` | Preview cards that would be cascade-restored |
| GET | `/cards/{id}/hierarchy` | Ancestors, children, computed level |
| GET | `/cards/{id}/history` | Paginated event history |
| GET | `/cards/{id}/relation-summary` | Per-relation-type counts + sample targets |
| GET | `/cards/{id}/my-permissions` | Effective permissions for the current user on this card |
| POST | `/cards/{id}/approval-status` | `?action=approve\|reject\|reset` |
| GET | `/cards/export/csv` | Export as CSV. `?type=X` |
| GET | `/cards/export/json` | Export as JSON |

### RBAC (`/roles`, `/stakeholder-roles`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/roles` | List app-level roles |
| POST | `/roles` | Create role with permissions |
| PATCH | `/roles/{id}` | Update role permissions |
| DELETE | `/roles/{id}` | Delete non-system role |
| GET | `/stakeholder-roles` | List per-type stakeholder role definitions |
| GET | `/cards/{id}/effective-permissions` | Get effective permissions for current user on a card |

### Calculations (`/calculations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/calculations` | List all calculations |
| GET | `/calculations/calculated-fields` | Map of type_key → calculated field_keys |
| POST | `/calculations` | Create calculation formula |
| PATCH | `/calculations/{id}` | Update formula |
| DELETE | `/calculations/{id}` | Delete calculation |
| POST | `/calculations/{id}/run` | Execute calculation on all matching cards |

### BPM (`/bpm`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/bpm/processes/{id}/diagram` | Get BPMN XML for a process |
| PUT | `/bpm/processes/{id}/diagram` | Save BPMN XML (auto-extracts elements) |
| GET | `/bpm/processes/{id}/elements` | List extracted BPMN elements |
| GET | `/bpm/templates` | List BPMN starter templates |
| GET | `/bpm/process-flow-versions` | List versions for a process |
| POST | `/bpm/process-flow-versions` | Create draft version |
| POST | `/bpm/process-flow-versions/{id}/submit` | Submit for approval |
| POST | `/bpm/process-flow-versions/{id}/approve` | Approve and publish |
| POST | `/bpm/process-flow-versions/{id}/reject` | Reject with comment |
| GET | `/bpm/reports/dashboard` | Process maturity KPIs |
| GET | `/bpm/reports/risk` | Risk assessment overview |
| GET | `/bpm/reports/automation` | Automation levels |

### PPM (`/ppm`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ppm/initiatives/{id}/reports` | List status reports for an initiative |
| POST | `/ppm/initiatives/{id}/reports` | Create status report |
| PATCH | `/ppm/reports/{id}` | Update status report |
| DELETE | `/ppm/reports/{id}` | Delete status report |
| GET | `/ppm/initiatives/{id}/costs` | List cost lines |
| POST | `/ppm/initiatives/{id}/costs` | Create cost line (auto-syncs initiative costActual) |
| PATCH | `/ppm/costs/{id}` | Update cost line |
| DELETE | `/ppm/costs/{id}` | Delete cost line |
| GET | `/ppm/initiatives/{id}/budgets` | List budget lines |
| POST | `/ppm/initiatives/{id}/budgets` | Create budget line (auto-syncs initiative costBudget) |
| PATCH | `/ppm/budgets/{id}` | Update budget line |
| DELETE | `/ppm/budgets/{id}` | Delete budget line |
| GET | `/ppm/initiatives/{id}/has-costs` | Check if initiative has budget/cost lines |
| GET | `/ppm/initiatives/{id}/risks` | List risks (ordered by risk_score desc) |
| POST | `/ppm/initiatives/{id}/risks` | Create risk (auto-computes risk_score) |
| PATCH | `/ppm/risks/{id}` | Update risk |
| DELETE | `/ppm/risks/{id}` | Delete risk |
| GET | `/ppm/initiatives/{id}/tasks` | List tasks |
| POST | `/ppm/initiatives/{id}/tasks` | Create task (auto-syncs to system Todo) |
| PATCH | `/ppm/tasks/{id}` | Update task |
| DELETE | `/ppm/tasks/{id}` | Delete task |
| GET | `/ppm/tasks/{id}/comments` | List task comments |
| POST | `/ppm/tasks/{id}/comments` | Create task comment |
| PATCH | `/ppm/task-comments/{id}` | Update comment (author or ppm.manage) |
| DELETE | `/ppm/task-comments/{id}` | Delete comment |
| GET | `/ppm/initiatives/{id}/wbs` | List WBS items with progress |
| POST | `/ppm/initiatives/{id}/wbs` | Create WBS item |
| PATCH | `/ppm/wbs/{id}` | Update WBS (auto-rollup completion) |
| DELETE | `/ppm/wbs/{id}` | Delete WBS item |
| GET | `/ppm/initiatives/{id}/completion` | Overall initiative completion % |
| GET | `/reports/ppm/dashboard` | PPM dashboard KPIs |
| GET | `/reports/ppm/gantt` | Gantt chart data. `?group_by={type_key}` for grouping |
| GET | `/reports/ppm/group-options` | Available card types for Gantt grouping |
| GET | `/settings/ppm-enabled` | Check if PPM module is enabled (public) |
| PATCH | `/settings/ppm-enabled` | Toggle PPM module (admin only) |

### Reports (`/reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/dashboard` | KPIs: counts by type, avg data quality, approvals, events |
| GET | `/reports/landscape` | Cards grouped by a related type |
| GET | `/reports/portfolio` | Bubble chart data: configurable X/Y/size/color axes |
| GET | `/reports/matrix` | Cross-reference grid between two types |
| GET | `/reports/roadmap` | Lifecycle timeline data |
| GET | `/reports/cost` | Cost aggregation (simple bar) |
| GET | `/reports/cost-treemap` | Treemap with optional grouping |
| GET | `/reports/capability-heatmap` | Business capability hierarchy with app counts |
| GET | `/reports/dependencies` | Network graph: nodes + edges with BFS depth limiting |
| GET | `/reports/data-quality` | Completeness dashboard |

### Saved Reports (`/saved-reports`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/saved-reports` | List saved report configs |
| POST | `/saved-reports` | Save report configuration with thumbnail |
| PATCH | `/saved-reports/{id}` | Update saved report |
| DELETE | `/saved-reports/{id}` | Delete saved report |

### ServiceNow (`/servicenow`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/servicenow/connections` | List ServiceNow connections |
| POST | `/servicenow/connections` | Create connection |
| POST | `/servicenow/connections/{id}/test` | Test connectivity |
| GET | `/servicenow/mappings` | List type/field mappings |
| POST | `/servicenow/sync/pull` | Pull records from ServiceNow |
| POST | `/servicenow/sync/push` | Push records to ServiceNow |
| GET | `/servicenow/staged` | List staged records for review |
| POST | `/servicenow/staged/apply` | Apply staged records |

### AI Suggestions (`/ai`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/suggest` | Generate AI description suggestion for a card (requires `ai.suggest` permission) |
| GET | `/ai/status` | Check if AI is enabled, configured, and which types are supported |

### AI Settings (`/settings/ai`) — Admin only

| Method | Path | Description |
|--------|------|-------------|
| GET | `/settings/ai` | Get AI configuration (provider URL, model, search provider, enabled types) |
| PATCH | `/settings/ai` | Update AI settings |
| POST | `/settings/ai/test` | Test LLM provider connectivity, returns available models |

### Other Endpoints

| Category | Key Endpoints |
|----------|--------------|
| **Relations** | `GET/POST /relations`, `PATCH/DELETE /relations/{id}` |
| **Stakeholders** | `GET/POST /cards/{id}/stakeholders`, `PATCH/DELETE /stakeholders/{id}` |
| **Tags** | `GET/POST /tag-groups`, `POST /cards/{id}/tags` |
| **Comments** | `GET/POST /cards/{id}/comments`, `PATCH/DELETE /comments/{id}` |
| **Todos** | `GET/POST /todos`, `GET/POST /cards/{id}/todos` |
| **Documents** | `GET/POST /cards/{id}/documents`, `DELETE /documents/{id}` |
| **Bookmarks** | `GET/POST /bookmarks`, `PATCH/DELETE /bookmarks/{id}` |
| **Diagrams** | `GET/POST /diagrams`, `GET/PATCH/DELETE /diagrams/{id}` |
| **Diagram Groups** | `GET/POST /diagram-groups`, `PATCH/DELETE /diagram-groups/{id}`, favorite toggling |
| **Resource Types** | `GET/POST /metamodel/resource-types`, `PATCH/DELETE /metamodel/resource-types/{id}` |
| **SoAW** | `GET/POST /soaw`, `GET/PATCH/DELETE /soaw/{id}` |
| **Surveys** | Full CRUD + `/surveys/{id}/send`, `/surveys/{id}/respond/{card_id}` |
| **EOL** | `/eol/products`, `/eol/products/fuzzy`, `/eol/mass-search`, `/eol/mass-link` |
| **Web Portals** | CRUD + `/web-portals/public/{slug}` (no auth) |
| **Notifications** | `GET /notifications`, badge counts, mark read |
| **Settings** | Email SMTP, currency, logo upload, favicon upload, AI config |
| **Users** | CRUD (admin only), self-update |
| **Events** | `GET /events`, `GET /events/stream` (SSE) |
| **ADR** | `GET/POST /adr`, `GET/PATCH/DELETE /adr/{id}`, `/adr/{id}/cards`, `/adr/{id}/sign` |
| **File Attachments** | `POST /cards/{id}/attachments`, `GET/DELETE /attachments/{id}` |
| **Capability Catalogue** | `GET /capability-catalogue/*` (industry capability reference, includes Macro tier) |
| **Principles Catalogue** | `GET /principles-catalogue/*` (curated EA principles reference set) |
| **Process Catalogue** | `GET /process-catalogue/*` (industry business process reference) |
| **Value Stream Catalogue** | `GET /value-stream-catalogue/*` (value stream reference set) |
| **OData Feeds** | `GET /bookmarks/{id}/odata` (OData-style JSON feed for saved views) |
| **Workspace Transfer** | `GET /admin/workspace/export` (stream `.zip`), `POST /admin/workspace/import` (upload + dry-run), `GET /admin/workspace/import/{id}`, `POST /admin/workspace/import/{id}/apply`, `DELETE /admin/workspace/import/{id}` — full TEA↔TEA export/import, gated by `admin.export_workspace` / `admin.import_workspace` |
| **Health** | `GET /api/health` (no auth, includes version) |

---

## Frontend Architecture

### Tech Stack
- **React 18** with TypeScript
- **MUI 6** (Material UI) for component library
- **React Router 7** for client-side routing
- **AG Grid** for data tables (inventory page)
- **Recharts** for charts (portfolio, cost, lifecycle reports)
- **bpmn-js** for BPMN 2.0 diagram editing
- **TipTap** for rich text editing (SoAW sections)
- **@dnd-kit** for drag-and-drop (card layout editor)
- **docx** + **file-saver** for DOCX export (SoAW)
- **xlsx** (vendored v0.20.3) for Excel import/export
- **Vite** for build tooling with `@` path alias to `./src`

### Routing (`App.tsx`)

All route-level pages use `lazy()` imports for code splitting. Auth pages (Login, SsoCallback, SetPasswordPage) are eagerly loaded.

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Dashboard` | KPI cards, type breakdown, recent activity |
| `/inventory` | `InventoryPage` | AG Grid table with memoized configs |
| `/cards/:id` | `CardDetail` | Modular detail: sections + tabs |
| `/reports/portfolio` | `PortfolioReport` | Bubble/scatter chart |
| `/reports/flexible-portfolio` | `FlexiblePortfolioReport` | Configurable multi-axis portfolio view |
| `/reports/capability-map` | `CapabilityMapReport` | Heatmap of business capabilities |
| `/reports/lifecycle` | `LifecycleReport` | Timeline visualization |
| `/reports/dependencies` | `DependencyReport` | Network graph |
| `/reports/cost` | `CostReport` | Treemap + bar chart |
| `/reports/matrix` | `MatrixReport` | Cross-reference grid |
| `/reports/data-quality` | `DataQualityReport` | Completeness dashboard |
| `/reports/eol` | `EolReport` | End-of-Life status |
| `/reports/saved` | `SavedReportsPage` | Saved report gallery |
| `/ppm` | `PpmHome` | PPM portfolio dashboard with Gantt chart |
| `/ppm/:id` | `PpmProjectDetail` | Initiative detail (overview, reports, cost, risks, tasks, gantt) |
| `/bpm` | `BpmDashboard` | BPM maturity overview |
| `/bpm/processes/:id/flow` | `ProcessFlowEditorPage` | BPMN editor with approval workflow |
| `/diagrams` | `DiagramsPage` | Diagram gallery with thumbnails |
| `/diagrams/:id` | `DiagramViewer` | DrawIO iframe viewer (read-only) |
| `/diagrams/:id/edit` | `DiagramEditor` | DrawIO iframe editor (edit mode) |
| `/ea-delivery` | redirect → `/reports/ea-delivery` | Backwards-compat redirect |
| `/reports/ea-delivery` | `EaDeliveryReport` | EA delivery dashboard (SoAW + ADR rollup) |
| `/ea-delivery/soaw/new` | `SoAWEditor` | Create new SoAW |
| `/ea-delivery/soaw/:id` | `SoAWEditor` | Edit SoAW |
| `/ea-delivery/soaw/:id/preview` | `SoAWPreview` | Read-only SoAW preview |
| `/ea-delivery/adr/new` | `ADREditor` | Create new ADR |
| `/ea-delivery/adr/:id` | `ADREditor` | Edit ADR |
| `/ea-delivery/adr/:id/preview` | `ADRPreview` | Read-only ADR preview |
| `/grc` | `GrcPage` | GRC tabbed shell (risk / compliance / governance) |
| `/grc/risks/:id` | `RiskDetailPage` | Risk detail page |
| `/turbolens` | `TurboLensPage` | TurboLens AI tabs (dashboard / vendors / resolution / duplicates / architect / assessments / history) |
| `/turbolens/assessments/:id` | `AssessmentViewer` | Read-only architecture-AI assessment |
| `/capability-catalogue` | `CapabilityCataloguePage` | Industry capability reference (with Macro tier) |
| `/principles-catalogue` | `PrinciplesCataloguePage` | Curated EA principles reference |
| `/process-catalogue` | `ProcessCataloguePage` | Industry business process reference |
| `/value-stream-catalogue` | `ValueStreamCataloguePage` | Value stream reference |
| `/todos` | `TodosPage` | Todos + Surveys (tabbed) |
| `/surveys/:surveyId/respond/:cardId` | `SurveyRespond` | Respond to survey |
| `/portal/:slug` | `PortalViewer` | Public portal (no auth) |
| `/auth/callback` | `SsoCallback` | SSO OAuth callback |
| `/auth/set-password` | `SetPasswordPage` | Invited user password setup |
| `/admin/metamodel` | `MetamodelAdmin` | Card types + relations |
| `/admin/users` | `UsersAdmin` | User management |
| `/admin/settings` | `SettingsAdmin` | Logo, currency, SMTP, AI |
| `/admin/eol` | redirect → `/admin/settings?tab=eol` | Mass EOL linking (under settings) |
| `/admin/surveys` | `SurveysAdmin` | Survey management |
| `/admin/surveys/new` | `SurveyBuilder` | Create survey |
| `/admin/surveys/:id` | `SurveyBuilder` | Edit survey |
| `/admin/surveys/:id/results` | `SurveyResults` | View/apply responses |
| `/admin/web-portals` | redirect → `/admin/settings?tab=web-portals` | Portal management (under settings) |
| `/admin/servicenow` | redirect → `/admin/settings?tab=servicenow` | ServiceNow sync config (under settings) |
| `/admin/turbolens` | redirect → `/admin/settings?tab=turbolens` | TurboLens config (under settings) |

### Key Patterns

**API Client** (`src/api/client.ts`): Thin fetch wrapper that auto-injects the JWT from `sessionStorage`. Methods: `api.get()`, `api.post()`, `api.patch()`, `api.put()`, `api.delete()`, `api.upload()`, `api.getRaw()`. Handles 204 empty responses and formats validation errors. Custom `ApiError` class with `status` and `detail` fields.

**Authentication** (`hooks/useAuth.ts`): Token stored in `sessionStorage.token` (cleared on tab close). On load, validates via `GET /auth/me`. SSO callback support via `/auth/callback`. Password setup for invited users via `/auth/set-password`.

**Metamodel Cache** (`hooks/useMetamodel.ts`): Module-level singleton cache. Fetches types + relation types once, shared across all components. `invalidateCache()` forces re-fetch.

**Permissions** (`hooks/usePermissions.ts`): Fetches effective permissions for a card by combining app-level role + stakeholder roles. Used by CardDetail to enable/disable edit controls.

**Calculated Fields** (`hooks/useCalculatedFields.ts`): Fetches `type_key → field_keys[]` map. CardDetail uses this to show "calc" badges and prevent manual editing of computed fields.

**Real-time Updates** (`hooks/useEventStream.ts`): SSE connection to `/events/stream`. Auto-reconnects on error. Badge count refresh debounced at 500ms via `AppLayout.tsx`.

**Currency** (`hooks/useCurrency.ts`): Module-level singleton cache. Provides `fmt()`, `fmtShort()`, and `symbol` for consistent cost display.

**Data Quality Scoring**: Backend auto-computes `data_quality` (0-100%) based on `fields_schema` weights. Approval status auto-breaks to `BROKEN` when approved items are edited.

**Card Detail Sections**: Each section is an independent component in `features/cards/sections/`, wrapped in `ErrorBoundary`. Section ordering is controlled by `section_config.__order` in the metamodel. Custom sections are rendered via `AttributeSection` (fully data-driven from `fields_schema`).

**Report Architecture**: Reports share `ReportShell` for consistent layout, `MetricCard` for KPI display, `ReportLegend` for legends, and `SaveReportDialog`/`EditReportDialog` for save/edit workflows.

**MUI Dialog Nesting**: When dialogs are nested (e.g., TypeDetailDrawer contains FieldEditorDialog), inner dialogs use `disableRestoreFocus` to prevent `aria-hidden` focus warnings.

---

## Metamodel

The default metamodel seeds 13 card types across 4 layers and 30+ relation types. Created on first startup by `backend/app/services/seed.py`.

### Card Types

| Key | Label | Icon | Color | Layer | Hierarchy | Subtypes |
|-----|-------|------|-------|-------|-----------|----------|
| `Objective` | Objective | flag | #c7527d | Strategy & Transformation | No | - |
| `Platform` | Platform | layers | #027446 | Strategy & Transformation | No | Digital, Technical |
| `Initiative` | Initiative | rocket_launch | #33cc58 | Strategy & Transformation | Yes | Idea, Program, Project, Epic |
| `Organization` | Organization | corporate_fare | #2889ff | Business Architecture | Yes | Business Unit, Region, Legal Entity, Team, Customer |
| `BusinessCapability` | Business Capability | account_tree | #003399 | Business Architecture | Yes | - |
| `BusinessContext` | Business Context | swap_horiz | #fe6690 | Business Architecture | Yes | Process, Value Stream, Customer Journey, Business Product, ESG Capability |
| `BusinessProcess` | Business Process | route | #028f00 | Business Architecture | Yes | Core, Support, Management |
| `Application` | Application | apps | #0f7eb5 | Application & Data | Yes | Business Application, Microservice, AI Agent, Deployment |
| `Interface` | Interface | sync_alt | #02afa4 | Application & Data | No | Logical Interface, API, MCP Server |
| `DataObject` | Data Object | database | #774fcc | Application & Data | Yes | - |
| `ITComponent` | IT Component | memory | #d29270 | Technical Architecture | Yes | Software, Hardware, SaaS, PaaS, IaaS, Service, AI Model |
| `TechCategory` | Tech Category | category | #a6566d | Technical Architecture | Yes | - |
| `Provider` | Provider | storefront | #ffa31f | Technical Architecture | No | - |

### Fields Schema Structure

Each type has a `fields_schema` (JSONB array of sections):
```json
[
  {
    "section": "Section Name",
    "columns": 1,
    "groups": ["Group Name"],
    "fields": [
      {
        "key": "fieldKey",
        "label": "Display Label",
        "type": "text|number|cost|boolean|date|url|single_select|multiple_select",
        "options": [{"key": "k", "label": "L", "color": "#hex"}],
        "required": false,
        "weight": 1,
        "readonly": false,
        "column": 0,
        "group": "Group Name"
      }
    ]
  }
]
```

The special section name `__description` feeds extra fields into the Description section. All other sections are rendered as custom `AttributeSection` components.

### Section Config

Each type has an optional `section_config` (JSONB) controlling layout:
```json
{
  "__order": ["description", "eol", "lifecycle", "custom:0", "custom:1", "hierarchy", "relations"],
  "description": { "defaultExpanded": true, "hidden": false },
  "custom:0": { "defaultExpanded": true, "hidden": false }
}
```

### Field Types

| Type | Description | Rendering |
|------|-------------|-----------|
| `text` | Plain text | TextField |
| `number` | Numeric | NumberField |
| `cost` | Numeric with currency formatting | NumberField + currency symbol |
| `boolean` | Toggle | Switch |
| `date` | ISO date | DatePicker |
| `url` | Validated URL (http/https/mailto) | Clickable link input |
| `single_select` | Single choice from options | Select dropdown |
| `multiple_select` | Multiple choices from options | Multi-select chips |

---

## RBAC (Role-Based Access Control)

### Multi-level Permission System

1. **App-level Roles** (`roles` table): System-wide roles like admin, member, viewer, bpm_admin. Each role has a JSONB `permissions` field with granular capability flags. Cached with 5-minute TTL by `PermissionService`. Admin role uses `{"*": true}` wildcard.

2. **Stakeholder Roles** (`stakeholder_role_definitions`): Per-card-type role definitions. Each card type can define custom roles (e.g., Application → "technical_application_owner"). Roles carry per-type permissions.

3. **Stakeholders** (`stakeholders` table): User ↔ card assignments with a specific role. A user can hold multiple stakeholder roles on different cards.

4. **Effective Permissions**: For any user + card combination, the system computes the union of:
   - App-level role permissions (with app→card permission mapping from `core/permissions.py`)
   - All stakeholder role permissions the user holds on that card
   - Result exposed via `GET /cards/{id}/effective-permissions`

### Permission Key Registry (`core/permissions.py`)

Single source of truth for all valid permission keys. Two categories:

**App-level permissions** (27 groups, 72 keys): `inventory.*`, `relations.*`, `stakeholders.*`, `comments.*`, `documents.*`, `diagrams.*`, `bpm.*`, `ppm.*`, `reports.*`, `surveys.*`, `soaw.*`, `adr.*`, `tags.*`, `bookmarks.*`, `saved_reports.*`, `eol.*`, `web_portals.*`, `notifications.*`, `servicenow.*`, `turbolens.*`, `compliance.*` (view + manage for the GRC Compliance scanner — the CVE half of the old "Security & Compliance" tab was removed), `risks.*` (view + manage for the EA Risk Register), `grc.*`, `costs.*`, `ai.*`, `users.*`, `admin.*` (includes `admin.export_workspace` / `admin.import_workspace` for the Workspace Transfer tool)

**Card-level permissions** (15 keys): `card.view`, `card.edit`, `card.archive`, `card.delete`, `card.approval_status`, `card.manage_stakeholders`, `card.manage_relations`, `card.manage_documents`, `card.manage_comments`, `card.create_comments`, `card.bpm_edit`, `card.bpm_manage_drafts`, `card.bpm_approve`, `card.manage_adr_links`, `card.manage_diagram_links`

### Permission Checking (Backend)
```python
# App-level check (raises 403 if denied)
await PermissionService.require_permission(db, user, "admin.metamodel")

# Combined app + card-level check
await PermissionService.require_permission(db, user, "inventory.edit", card_id=card_id, card_permission="card.edit")

# FastAPI dependency (in route decorator)
@router.post("/...", dependencies=[Depends(require_permission("inventory.create"))])

# Check without raising
has_access = await PermissionService.check_permission(db, user, "bpm.edit")
```

### Default Seeded Roles

| Role | Key | Wildcard | Notable Restrictions |
|------|-----|----------|---------------------|
| Admin | `admin` | `{"*": true}` | Full access to everything |
| BPM Admin | `bpm_admin` | No | All BPM permissions + full inventory, no admin.* |
| Member | `member` | No | Full inventory + BPM edit (no approve), no admin.* |
| Viewer | `viewer` | No | View-only across all domains, can respond to surveys |

### Role Impersonation

The **View as role…** entry in the user menu (gated on `admin.impersonate`) lets an admin temporarily act as another role to verify what non-admin users see. The model is intentionally simple and server-enforced:

- **JWT-claim only.** `POST /auth/impersonate {role}` issues a fresh JWT carrying an `impersonated_role` claim; `POST /auth/stop-impersonating` issues one without it. The `users.role` column is never modified — impersonation is transient session state.
- **Effective role lives in a contextvar.** A middleware in `app/main.py` decodes the JWT once per request and stashes `(impersonator_user_id, impersonated_role)` on `request_impersonation` (defined in `app/services/event_bus.py` alongside `request_origin` / `request_batch_id`). `PermissionService._effective_role(user)` reads it and returns the impersonated role for app-level permission checks. **Stakeholder permissions are not stripped** — they're per-card grants tied to `user.id`, so the impersonating admin keeps their own stakeholder access (an admin impersonating "member" still sees what *they personally* would see as a member, not some platonic member ideal).
- **Sensitive endpoints stay strict.** No "real-admin escape hatch" — while impersonating, `admin.users` / `admin.settings` / etc. all evaluate against the impersonated role's permission set, so the impersonating admin loses those powers until they stop. The whole point of the feature is verification; admin work requires stopping the session first.
- **Admin can't be impersonated.** `POST /auth/impersonate` hard-rejects `role: "admin"` so a custom support role with `admin.impersonate` can't step up to the wildcard.
- **Audit fan-out.** `event_bus.publish()` stamps `impersonator_user_id` and `impersonated_role` onto every event emitted while impersonation is active. Reviewers can later answer "who, really, performed this action?" from the event payload alone.

---

## Calculations (Computed Fields)

Admin-defined formulas that automatically compute field values when cards are saved.

### Engine (`calculation_engine.py`)
- Safe sandboxed evaluation using `simpleeval`
- **Built-in functions**: IF, SUM, AVG, MIN, MAX, COUNT, ROUND, ABS, LN, COALESCE, LOWER, UPPER, CONCAT, CONTAINS, PLUCK, FILTER, MAP_SCORE
- **Context variables**: Card attributes, relations data, lifecycle info
- Automatic execution on card save via `run_calculations_for_card()`
- Dependency ordering via `execution_order` field

### Example Formulas
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, 25))
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

---

## BPM (Business Process Management)

### Architecture
- **BusinessProcess** card type with fields: process type, maturity level, automation level, risk level, frequency
- **BPMN 2.0 Editor**: bpmn-js integration with 6 starter templates
- **Element Extraction**: `bpmn_parser.py` extracts tasks, events, gateways, lanes from BPMN XML
- **Element Linking**: `ElementLinker.tsx` connects BPMN elements to Application/DataObject/ITComponent cards
- **Approval Workflow**: Process flows go through draft → pending → published → archived states

### BPM Reports
- Process maturity dashboard
- Risk assessment overview
- Automation level analysis

### Card Detail Integration
BusinessProcess cards show extra tabs in CardDetail:
- **Process Flow** tab: Embedded BPMN viewer/editor
- **Assessments** tab: Process assessment scores

---

## PPM (Project Portfolio Management)

Optional module (toggled via admin settings) for managing Initiative cards as full projects.

### Architecture
- **Scoped to Initiative cards** — All PPM data (reports, WBS, tasks, budgets, costs, risks) is linked to Initiative cards via `initiative_id` FK
- **Feature flag**: `usePpmEnabled()` hook (module-level singleton cache, fetches `GET /settings/ppm-enabled`)
- **Cost sync**: Creating/updating/deleting budget or cost lines auto-syncs the Initiative card's `costBudget` and `costActual` attributes and recalculates data quality
- **WBS rollup**: Task status changes trigger bottom-up completion recalculation through the WBS hierarchy
- **Task-Todo sync**: Assigning a PPM task auto-creates a system Todo (`is_system=true`); clearing assignee deletes it
- **Notifications**: Task assignment sends a `task_assigned` notification
- **Permissions**: `ppm.view` (read) and `ppm.manage` (write), granted to admin, bpm_admin, and member roles

### Frontend Components
- **`PpmPortfolio.tsx`** — Portfolio dashboard with Gantt visualization, KPI cards, grouping by related card type
- **`PpmProjectDetail.tsx`** — Tabbed initiative detail (overview, reports, cost, risks, tasks, gantt, details)
- **`PpmTaskBoard.tsx`** — Kanban board with @dnd-kit drag-drop (todo/in_progress/done/blocked columns)
- **`PpmRiskTab.tsx`** — Risk matrix visualization (probability x impact grid) and risk cards
- **`PpmCostTab.tsx`** — Budget lines (planned by fiscal year) and cost lines (actuals)
- **`PpmGanttTab.tsx`** — Timeline view of WBS items with milestones and completion bars

### Demo Data
`seed_demo_ppm.py` populates PPM data for 6 Initiative cards when `SEED_DEMO=true` or `SEED_PPM=true`. Includes status reports, WBS hierarchies, tasks, budget/cost lines, and risks with varied project health stories.

---

## TurboLens (AI-Powered EA Intelligence)

Native AI analysis module. Provides vendor analysis, duplicate detection, modernization assessment, and architecture AI recommendations using data directly from the `cards` table.

### Architecture
- **No separate container**: All logic runs natively in Turbo EA (FastAPI + PostgreSQL). No proxy layer, no SQLite.
- **AI infrastructure reuse**: Uses the same AI provider config from `app_settings.general_settings.ai` (supports Claude, OpenAI, DeepSeek, Gemini).
- **Background tasks + polling**: Long-running AI operations use FastAPI `BackgroundTasks` + `TurboLensAnalysisRun` status polling.
- **Direct data access**: Queries `cards`, `relations`, and `relation_types` tables via SQLAlchemy — no data copy or intermediate storage.
- **Session persistence**: The Architecture AI wizard saves progress to `sessionStorage` so users can navigate away and return without losing their place.

### Database Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `turbolens_vendor_analysis` | `TurboLensVendorAnalysis` | AI-categorized vendors with category, sub-category, app counts, costs |
| `turbolens_vendor_hierarchy` | `TurboLensVendorHierarchy` | Resolved canonical vendor tree (parent-child, aliases, confidence) |
| `turbolens_duplicate_clusters` | `TurboLensDuplicateCluster` | Functional duplicate groups with evidence, recommendation, status |
| `turbolens_modernization_assessments` | `TurboLensModernization` | Modernization opportunities with effort, priority, current tech |
| `turbolens_analysis_runs` | `TurboLensAnalysisRun` | Analysis execution history (type, status, timestamps, errors, progress JSONB). Used by all TurboLens analyses including the `compliance` compliance scanner. |
| `turbolens_assessments` | `TurboLensAssessment` | Saved Architecture-AI wizard runs — requirement, selected objectives/capabilities, phase answers, chosen option, gaps + dependencies, target architecture payload. Surfaced by the `/turbolens` Assessments tab. |
| `compliance_findings` | `TurboLensComplianceFinding` | Compliance gap / attestation per regulation (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001). Carries article, category, requirement, status, severity, gap, evidence, remediation, `ai_detected` flag for semantically-identified AI cards, and optional `risk_id`. |

### Backend Services

| File | Purpose |
|------|---------|
| `services/turbolens_ai.py` | Shared AI caller + JSON repair (truncation recovery, bracket balancing) |
| `services/turbolens_vendors.py` | Vendor categorization (45+ categories, batch=15) + resolution (batch=60, hierarchy building) |
| `services/turbolens_duplicates.py` | Duplicate detection (union-find merge, batch=40) + modernization assessment (batch=25) |
| `services/turbolens_architect.py` | 5-step architecture AI: objective-driven capability mapping, solution options, gap analysis, dependency analysis, and target architecture rendered with the Layered Dependency View |
| `services/compliance_scanner.py` | Compliance scanner orchestrator. Entry point (`run_compliance_scan`) that emits phase-aware progress to `run.results["progress"]`. Includes the EU AI Act **semantic detector** that flags cards embedding AI regardless of subtype. The legacy `run_security_scan` / `run_cve_scan` entry points have been removed — see `tests/services/test_compliance_scanner.py::test_service_exposes_compliance_scan_entry_point`. |
| `services/compliance_risk_sync.py` | Two-way bridge between compliance findings and the EA Risk Register (promote-to-risk + back-links). |

### Architecture AI Flow

The Architecture AI follows a 5-step guided wizard:

1. **Requirements** (Phase 0) — User enters a business requirement, selects existing Objective cards (autocomplete), and optionally selects or creates Business Capabilities (free-text for new ones).
2. **Business Fit** (Phase 1) — AI generates business clarification questions with typed inputs (text, single-choice, multi-choice with NFR categories).
3. **Technical Fit** (Phase 2) — AI generates technical deep-dive questions.
4. **Solution** (Phase 3) — Three sub-phases:
   - **3a: Options** — AI generates solution option cards (buy/build/extend/reuse) with impact preview (new/modified/retired components, integrations), estimated cost, duration, and complexity.
   - **3b: Gap Analysis** — After selecting an option, AI identifies capability gaps with ranked market product recommendations (gold/silver/bronze). Users select products via checkboxes.
   - **3c: Dependencies** — After selecting products, AI identifies additional infrastructure/platform dependencies needed. Users select dependencies via checkboxes.
5. **Target Architecture** (Phase 5) — Capability mapping with matched capabilities (existing vs new), proposed new cards (typed per metamodel, including new BusinessCapabilities), proposed relations, and an interactive **Layered Dependency View** rendered via `C4DiagramView` (React Flow). Proposed nodes appear with dashed borders and a green "NEW" badge. Backend guardrails automatically enforce: every new Application links to a BusinessCapability, every new BusinessCapability links to selected Objectives, and orphan cards (no relations) are removed.
6. **Commit** — Save assessment, then commit via `CommitInitiativeDialog`: creates Initiative card (name defaults to selected option title, editable), all selected new cards with AI-generated descriptions, relations, and a draft ADR capturing the decision context, selected products, and alternatives. Changing approach resets the assessment for re-saving.

### API Routes (`/turbolens`)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/status` | authenticated | AI config status |
| GET | `/overview` | `turbolens.view` | Dashboard KPIs |
| POST | `/vendors/analyse` | `turbolens.manage` | Trigger vendor categorization (background) |
| GET | `/vendors` | `turbolens.view` | Get vendor analysis results |
| POST | `/vendors/resolve` | `turbolens.manage` | Trigger vendor resolution (background) |
| GET | `/vendors/hierarchy` | `turbolens.view` | Get vendor hierarchy |
| POST | `/duplicates/analyse` | `turbolens.manage` | Trigger duplicate detection (background) |
| GET | `/duplicates` | `turbolens.view` | Get duplicate clusters |
| PATCH | `/duplicates/{id}/status` | `turbolens.manage` | Update cluster status |
| POST | `/duplicates/modernize` | `turbolens.manage` | Trigger modernization assessment (background) |
| GET | `/duplicates/modernizations` | `turbolens.view` | Get modernization results |
| GET | `/architect/objectives` | `turbolens.manage` | Search Objective cards for autocomplete |
| GET | `/architect/capabilities` | `turbolens.manage` | Search BusinessCapability cards |
| GET | `/architect/objective-dependencies` | `turbolens.manage` | BFS depth-1 dependency subgraph for objectives |
| POST | `/architect/phase1` | `turbolens.manage` | Business clarification questions |
| POST | `/architect/phase2` | `turbolens.manage` | Technical deep-dive questions |
| POST | `/architect/phase3/options` | `turbolens.manage` | Generate solution options |
| POST | `/architect/phase3/gaps` | `turbolens.manage` | Gap analysis for selected option |
| POST | `/architect/phase3/deps` | `turbolens.manage` | Dependency analysis for selected products |
| POST | `/architect/phase3` | `turbolens.manage` | Capability mapping (full target architecture) |
| POST | `/architect/commit` | `turbolens.manage` | Commit initiative from assessment (creates cards + relations + ADR) |
| POST | `/assessments` | `turbolens.manage` | Save assessment |
| GET | `/assessments` | `turbolens.view` | List saved assessments |
| GET | `/assessments/{id}` | `turbolens.view` | Get assessment details |
| GET | `/analysis-runs` | `turbolens.view` | Analysis run history |
| GET | `/analysis-runs/{run_id}` | `turbolens.view` | Get specific run with results (or progress while still running) |
| POST | `/compliance/compliance-scan` | `compliance.manage` | Trigger compliance scan with optional `regulations[]` filter (background task) |
| GET | `/compliance/active-runs` | `compliance.view` | Return the currently-running compliance scan so the UI can reattach polling after a refresh |
| GET | `/compliance/overview` | `compliance.view` | KPIs: compliance scores + per-regulation status matrix, last-run metadata |
| GET | `/compliance/compliance` | `compliance.view` | Compliance findings grouped by regulation with per-regulation scores |
| POST | `/compliance/compliance-findings` | `compliance.manage` | Create / upsert a compliance finding |
| PATCH | `/compliance/compliance-findings/{id}` | `compliance.manage` | Update a finding (status, severity, evidence, remediation, …) |
| PATCH | `/compliance/compliance-findings/bulk` | `compliance.manage` | Bulk-update findings |
| DELETE | `/compliance/compliance-findings/{id}` | `compliance.manage` | Delete a single finding |
| DELETE | `/compliance/compliance-findings/bulk` | `compliance.manage` | Bulk-delete findings |
| POST | `/compliance/compliance-findings/{id}/ai-verdict` | `compliance.manage` | Request an AI verdict on a single finding (helper for the human reviewer) |

### Risk Register API (`/risks` + `/cards/{id}/risks`)

TOGAF-aligned Risk Register mounted at `/api/v1/risks`, plus a card sub-route for the Card Detail → Risks tab.

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/risks` | `risks.view` | Paginated, filterable risk list (status, category, level, owner, card_id, source_type, search, overdue) |
| GET | `/risks/metrics` | `risks.view` | KPIs + initial and residual 4×4 matrices |
| GET | `/risks/{id}` | `risks.view` | Single risk + linked cards + owner display name |
| POST | `/risks` | `risks.manage` | Manual risk creation (auto-assigns `R-000123` reference) |
| PATCH | `/risks/{id}` | `risks.manage` | Update fields; recomputes derived levels; enforces status transitions; requires `acceptance_rationale` to move to `accepted` |
| DELETE | `/risks/{id}` | `risks.manage` | Delete risk + clean up the owner's system Todo |
| POST | `/risks/{id}/cards` | `risks.manage` | Link one or more cards (idempotent) |
| DELETE | `/risks/{id}/cards/{card_id}` | `risks.manage` | Unlink a single card |
| POST | `/risks/promote/compliance/{finding_id}` | `risks.manage` + `compliance.view` | Promote a compliance finding to a risk (idempotent — returns existing one if already promoted). Seeds title, description, category, probability/impact, links the finding's card, and **spawns a one-shot mitigation task from the finding's remediation text**. |
| GET | `/cards/{id}/risks` | `risks.view` | All risks linked to a card (used by CardDetail → Risks tab) |
| GET | `/risks/{id}/mitigation-tasks` | `risks.view` | List mitigation tasks for a risk (with full per-task occurrence history). |
| POST | `/risks/{id}/mitigation-tasks` | `risks.manage` | Create a mitigation task. Auto-creates occurrence #1 and a system Todo on the assignee. |
| PATCH | `/mitigation-tasks/{id}` | `risks.manage` | Update title / description / owner / recurrence / due date / is_active. Owner changes propagate to the current open occurrence (and its Todo); past completed occurrences stay frozen. |
| DELETE | `/mitigation-tasks/{id}` | `risks.manage` | Delete a task. Cascades to occurrences and removes the linked system Todos. |
| POST | `/mitigation-tasks/{id}/occurrences/{occ_id}/complete` | `risks.manage` **or** assignee of the occurrence | Mark an occurrence done. Snapshots `owner_at_completion`. For recurring tasks, opens the next occurrence with `due_date = previous_due_date + interval` (calendar-correct) and lands it as `scheduled` or `open` per the lead-time gate. For one-shot tasks, flips `is_active = false`. Returns 409 when called on a `scheduled` cycle ("activate it first"). |
| POST | `/mitigation-tasks/{id}/occurrences/{occ_id}/skip` | `risks.manage` | Skip a cycle (recurring tasks roll forward as usual, subject to the lead-time gate). |
| POST | `/mitigation-tasks/{id}/occurrences/{occ_id}/promote` | `risks.manage` | Manually promote a `scheduled` cycle to `open` immediately — short-circuits the daily promotion loop for the "I want to do the review early" case. Idempotent on already-open cycles. |
| GET | `/mitigation-tasks/{id}/occurrences` | `risks.view` | Full audit history for one task, including `owner_at_completion` snapshots and `activated_at` timestamps. |
| GET | `/risks/mitigation-tasks/export` | `risks.view` | Flat list of every mitigation task on every risk matching the same filter shape as `GET /risks` (status / category / level / owner / source_type / search / overdue / card_id). Used by the Risk Register's two-sheet `.xlsx` export so sheet 2 always matches what the user has on screen. |

Owner assignment on create / patch / promote auto-creates a single `is_system` Todo on the owner's Todos page (description `[Risk R-xxxxxx] title`, link back to the risk, due-date mirrors `target_resolution_date`, auto-done when the risk reaches mitigated / monitoring / accepted / closed) and fires a `risk_assigned` in-app + email-capable notification whenever the owner actually changes (including self-assignment — `risk_assigned` is whitelisted in `notification_service.allow_self_types`).

### Frontend Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/turbolens` | `TurboLensPage` | Tab container: Dashboard, Vendors, Resolution, Duplicates, Architect, Assessments, History. **No Security / Compliance tab** — compliance moved to `/grc?tab=compliance` when the CVE half of the old "Security & Compliance" feature was removed. |
| `/turbolens` (Dashboard tab) | `TurboLensDashboard` | KPI tiles, cards by type, quality tiers (Bronze/Silver/Gold), top issues |
| `/turbolens` (Vendors tab) | `TurboLensVendors` | Vendor analysis with category breakdown, grid/table toggle |
| `/turbolens` (Resolution tab) | `TurboLensResolution` | Canonical vendor hierarchy with confidence scores |
| `/turbolens` (Duplicates tab) | `TurboLensDuplicates` | Duplicate clusters + modernization assessment (sub-tabs) |
| `/turbolens` (Architect tab) | `TurboLensArchitect` | 5-step architecture AI wizard with Layered Dependency View visualization |
| `/turbolens` (Assessments tab) | `TurboLensAssessments` | Saved architecture-AI assessments |
| `/turbolens` (History tab) | `TurboLensHistory` | Analysis run history table |
| `/grc?tab=risk` | `RiskRegisterPage` (embedded in `GrcPage`) | Risk Register — KPIs, Initial/Residual 4×4 matrix toggle, filters, risk table. (`/ea-delivery/risks` 301-redirects here for backwards compatibility.) |
| `/grc?tab=compliance` | `ComplianceScanner` + `ComplianceGrid` / `ComplianceHeatmap` (embedded in `GrcPage`) | On-demand compliance scan with phase-aware progress bar, compliance heatmap, finding grid, and **Create risk** / **Open risk** actions on every finding. **The CVE scan that used to live here has been removed** — compliance is now regulation-driven only (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001). |
| `/grc?tab=governance` | `GovernanceTab` (embedded in `GrcPage`) | Principles + Decisions panels |
| `/grc/risks/:id` | `RiskDetailPage` | Full TOGAF-shaped detail: Identification, Initial assessment, Mitigation & residual (with Owner picker), Affected cards (M:N), Status stepper + primary **Next step** + secondary side actions (Accept / Reopen / Close-early), Audit. (`/ea-delivery/risks/:id` redirects here.) |

### Key Frontend Components

| Component | Purpose |
|-----------|---------|
| `TurboLensArchitect.tsx` | 5-step wizard: requirement input → Q&A → options → gaps → deps → capability mapping |
| `CommitInitiativeDialog.tsx` | Initiative creation dialog with card/relation selection, renaming, and progress tracking |
| `AssessmentViewer.tsx` | Read-only assessment viewer with the Layered Dependency View |
| `C4DiagramView.tsx` | React Flow-based renderer for the **Layered Dependency View** — grouped swim lanes per EA layer with mirrored handles for cross-layer edges (file name retained for backwards compatibility) |
| `c4Layout.ts` | Automatic layout engine for the Layered Dependency View (node positioning, edge routing, handle allocation) |
| `ArchitectureDiagram.tsx` | Mermaid diagram renderer for architecture visualizations |
| `useAnalysisPolling.ts` | Custom hook: polls analysis runs every 3s until completion/failure |
| `utils.ts` | Shared helpers: `formatCost()`, color mappers, `ARCHITECT_STEPS` stepper config |

### Permissions
- **`turbolens.view`**: View analysis results. Granted to admin, bpm_admin, member roles.
- **`turbolens.manage`**: Trigger analyses. Granted to admin role.

---

## EA Risk Register (TOGAF Phase G)

Landscape-level risk register aligned to TOGAF ADM Phase G. Separate from `PpmRisk` (which is initiative-scoped). Lives as a tab inside the **GRC** page (`/grc?tab=risk`) with detail pages at `/grc/risks/:id`. The legacy `/ea-delivery/risks` and `/ea-delivery/risks/:id` paths redirect to the GRC routes.

### Tables

| Table | Model | Purpose |
|-------|-------|---------|
| `risks` | `Risk` | One row per risk. Fields: reference (`R-000123`), title, description, category, source_type / source_ref, initial + residual probability × impact (with derived level), owner_id, target_resolution_date, status, acceptance_rationale + accepted_by + accepted_at, created_by. **No `mitigation` text column** — mitigation is task-driven (see below). |
| `risk_cards` | `RiskCard` | M:N junction between risks and cards (composite PK risk_id + card_id, role defaulting to `affected`) |
| `risk_mitigation_tasks` | `RiskMitigationTask` | Owned mitigation activities attached to a risk. Each row carries a human-readable `reference` (`T-NNNNNN`, monotonic, `String(16)` — same shape as `risks.reference`). One-shot (default) or recurring (`recurrence_unit` = `days`/`weeks`/`months`/`years`, `recurrence_interval` ≥ 1). Carries title, description, current `owner_id`, `is_active` (flips false when a one-shot task completes), and **`lead_time_days`** (how many days before `due_date` the cycle is promoted from `scheduled` to `open` — smart per-unit defaults of 1/2/7/14 for daily/weekly/monthly/yearly, capped at half the cycle). |
| `risk_mitigation_task_occurrences` | `RiskMitigationTaskOccurrence` | One row per scheduled instance of a task. Captures `sequence` (monotonic per task), `due_date`, `assigned_owner_id` (snapshot when the cycle opens), `status` (`scheduled` / `open` / `done` / `skipped`), **`activated_at`** (stamp when a scheduled cycle was promoted to open — NULL on cycles that were never gated), `completed_at` / `completed_by` / **`owner_at_completion`** (snapshot when the cycle closes — may differ from `assigned_owner_id` if the owner was changed mid-cycle), and `completion_notes`. Recurring tasks roll forward calendar-correctly on completion: `next_due = due_date + interval`, day-of-month clamped (Jan 31 + 1 month → Feb 28); the new cycle lands as `scheduled` if today is outside `due_date - lead_time_days`, `open` otherwise. |

The `compliance_findings` table also carries a nullable `risk_id` back-link so findings that have been promoted show **Open risk R-000123** instead of **Create risk** (idempotent promotion). Promoting a finding now spawns a one-shot mitigation task seeded from the finding's `remediation` text instead of writing free-text guidance into the dropped `mitigation` column.

### Backend modules

| File | Purpose |
|------|---------|
| `models/risk.py` | `Risk` + `RiskCard` SQLAlchemy models |
| `schemas/risk.py` | Pydantic I/O models with typed literals for category, level, probability, impact, status |
| `services/risk_service.py` | Pure helpers: `derive_level` (4×4 probability × impact matrix), `validate_status_transition`, `next_reference` (`R-000001` monotonic), `link_cards`, `promote_compliance_finding`, `risk_to_dict`, `compute_metrics`, `build_level_matrix` |
| `services/risk_mitigation_task_service.py` | Mitigation-task lifecycle: `compute_next_due` (calendar-correct month/year math via `_add_months`), `create_task_with_first_occurrence`, `complete_occurrence` / `skip_occurrence` (snapshots `owner_at_completion`, deactivates one-shot tasks, rolls forward recurring tasks), `apply_task_owner_change` (propagates parent-task owner edits to the current open occurrence — past occurrences stay frozen), `sync_occurrence_todo` (mirrors `sync_owner_todo` but keyed per open occurrence), `publish_task_event` (fan-out to linked cards). |
| `api/v1/risks.py` | CRUD + card linking + promote + metrics + `GET /cards/{id}/risks`. Includes `sync_owner_todo()` which creates / updates / deletes an `is_system` Todo on the owner and fires a `risk_assigned` notification whenever the owner changes (self-assignment included — whitelisted in `allow_self_types`). |
| `api/v1/risk_mitigation_tasks.py` | Mitigation-task endpoints. `GET/POST /risks/{id}/mitigation-tasks`, `PATCH/DELETE /mitigation-tasks/{id}`, `POST /mitigation-tasks/{id}/occurrences/{occ_id}/complete` and `/skip`, `GET /mitigation-tasks/{id}/occurrences` (full audit history). Permission: `risks.view` to read; `risks.manage` to mutate; **carve-out** — a user without `risks.manage` who is the `assigned_owner_id` of an open occurrence can complete that occurrence so assignees don't have to escalate just to mark their own control review done. Skip always requires full `risks.manage`. |

### Key behaviour

- **Status workflow** is sequential with explicit side actions. The UI renders one primary **Next step** button per state (Start analysis → Plan mitigation → Start mitigation → Mark mitigated → Start monitoring → Close) plus secondary actions for Accept risk / Resume mitigation / Reopen. Accepting requires a rationale; acceptance user + timestamp are captured on the record.
- **Derived levels** (`initial_level`, `residual_level`) are computed server-side via `derive_level()` and treated as read-only by the API layer.
- **Promote-from-finding** is idempotent — the compliance finding's `risk_id` is populated on promotion and a re-promote returns the existing risk.
- **Owner → Todo → Notification** loop: assignment (from create, patch, or promote) creates a linked Todo on the owner's Todos page and sends an in-app + email-capable `risk_assigned` notification. The Todo auto-marks done when the risk reaches `mitigated` / `monitoring` / `accepted` / `closed`, and is removed when the owner is cleared or the risk is deleted.
- **Task-driven mitigation.** Mitigation is captured as owned tasks under `risk_mitigation_tasks` rather than free-text. Tasks are one-shot by default; setting `recurrence_unit` (`days` / `weeks` / `months` / `years`) plus `recurrence_interval` ≥ 1 makes them recurring controls (e.g. "Check access rights every 6 months"). Recurrence is **completion-driven** — on close (done or skipped) of one occurrence, the next occurrence opens with `due_date = previous_due_date + interval`. Each occurrence snapshots `assigned_owner_id` at open and `owner_at_completion` at close, so the audit answer to "who signed off on the Jan 2024 review?" is preserved even after years of owner rotation. **Lead-time gating** (`lead_time_days` on the task) controls when a cycle becomes visible to the assignee: a new cycle lands as `scheduled` (audit-visible but no Todo, no notification) when today is outside `due_date - lead_time_days`, and is promoted to `open` (Todo created, notification fired) by the **daily `_promote_recurring_tasks_loop()` background task** in `app.main` at 03:00 UTC. `POST /mitigation-tasks/{id}/occurrences/{occ_id}/promote` short-circuits the wait for `risks.manage` holders. Smart defaults per recurrence unit (1/2/7/14 for daily/weekly/monthly/yearly, capped at half the cycle); one-shot tasks default to 0. Per-occurrence system Todos sync to the assignee (link `/ea-delivery/risks/{risk_id}?task={task_id}#occurrence-{occurrence_id}`); a `task_assigned` notification fires on every fresh assignment / promotion (cycle rollover included, whitelisted for self). `risk_mitigation_task.*` events (`created` / `updated` / `activated` / `completed` / `skipped` / `deleted`) fan out to every linked card so the per-card history timeline picks them up; `activated_at` on the occurrence captures the promotion moment for audit. **Residual scoring stays manual** — task completion does **not** auto-adjust the residual matrix; the Risk Detail page surfaces "X/Y open · Z overdue" chips alongside the residual block as context for the human assessment (ISO 31000-aligned). Promoting a TurboLens compliance finding spawns a one-shot mitigation task from the finding's `remediation` text.

### Permissions

- `risks.view` — view the register, metrics, and the Risks tab on cards (admin / bpm_admin / member / viewer).
- `risks.manage` — create, edit, promote, delete, link cards, change status (admin / bpm_admin / member).

### Frontend modules

- `features/grc/risk/RiskMatrix.tsx` — shared 4×4 clickable heatmap used by Register and Detail pages.
- `features/grc/risk/CreateRiskDialog.tsx` — reused for manual create and for promoting compliance findings, including an Owner picker so assignment happens at creation time.
- `features/grc/risk/RiskRegisterPage.tsx` — register list view (embedded as a tab in GRC at `/grc?tab=risk`).
- `features/grc/risk/RiskDetailPage.tsx` — full TOGAF layout: Identification → Initial assessment → **Mitigation tasks panel** (replaces the old free-text field) → Residual assessment (with Owner autocomplete, Target date, residual matrix, task-summary chips for context) → Affected cards (M:N) → Status workflow (primary Next step + secondary side actions + stepper) → Audit.
- `features/grc/risk/mitigation/MitigationTasksPanel.tsx` — task list with per-task expandable history. Add / edit / complete / skip / delete actions.
- `features/grc/risk/mitigation/MitigationTaskDialog.tsx` — create / edit dialog (title, description, owner autocomplete, due date, "Repeats" Switch + unit/interval picker).
- `features/grc/risk/mitigation/CompleteOccurrenceDialog.tsx` — confirm + optional completion notes when marking an occurrence done or skipped.
- `features/grc/risk/mitigation/OccurrenceHistoryList.tsx` — read-only audit list per cycle, including the `owner_at_completion` snapshot.
- `features/grc/risk/mitigation/recurrenceLabel.ts` — pure helper that formats `(unit, interval)` → translation-aware label ("One-shot", "Every 6 months", etc.). Unit-tested.
- `features/cards/sections/RisksTab.tsx` — Card Detail → Risks tab listing all risks linked to that card.

---

## DrawIO Integration

### How It Works
1. **Build time**: Frontend Dockerfile clones `jgraph/drawio` v26.0.9
2. **Runtime**: Nginx serves DrawIO at `/drawio/` (same origin)
3. **Editor**: `DiagramEditor.tsx` loads DrawIO in a same-origin iframe
4. **Communication**: Direct DOM access to iframe's `mxGraph` API. Graph reference stored on `iframe.contentWindow.__turboGraph`

### Shape System (`src/features/diagrams/drawio-shapes.ts`)
Cards are represented as mxGraph cells with custom XML user objects:
```xml
<object label="App Name" factSheetId="uuid" factSheetType="Application" />
```

Key functions: `insertFactSheetIntoGraph()`, `insertPendingFactSheet()`, `markCellSynced()`, `expandFactSheetGroup()`, `scanDiagramItems()`, `stampEdgeAsRelation()`, `extractFactSheetIds()`

### Diagram Feature Components
- `DiagramSyncPanel.tsx` — Sync cards between diagram and EA inventory
- `CardSidebar.tsx` — Browse cards to drag onto diagram
- `CardPickerDialog.tsx` — Search and select cards
- `CreateOnDiagramDialog.tsx` — Create new cards directly from diagram shapes
- `RelationPickerDialog.tsx` — Create/manage relations from diagram edges

---

## ServiceNow Integration

Bi-directional sync between Turbo EA cards and ServiceNow CMDB.

- **Connections**: Multiple ServiceNow instances with credential management (encrypted)
- **Mappings**: Card type ↔ ServiceNow table mappings with field-level rules
- **Sync modes**: Pull (ServiceNow → Turbo), Push (Turbo → ServiceNow)
- **Staging**: Records staged for admin review before applying changes (skip_staging flag available)
- **Identity persistence**: `snow_identity_map` maintains ID mappings across syncs

---

## AI Description Suggestions

Optional feature that uses a local LLM (via Ollama or any Ollama-compatible provider) to generate card description suggestions. The pipeline combines web search context with LLM inference.

### Architecture
- **Two-step pipeline**: Web search (DuckDuckGo/Google/SearXNG) → LLM description generation
- **Description-only**: Suggestions are limited to the `description` field — not arbitrary metadata fields
- **Type-aware prompting**: Search queries and LLM system prompts are customized per card type (e.g., "Application" → "software application", "ITComponent" → "technology product")
- **Confidence scoring**: Each suggestion includes a 0–100% confidence score for user transparency
- **Source attribution**: Web search sources are displayed as clickable links alongside suggestions

### Backend Components
- **`services/ai_service.py`**: Core orchestration — web search dispatch, LLM prompt building, response validation
- **`api/v1/ai_suggest.py`**: FastAPI endpoints (`POST /ai/suggest`, `GET /ai/status`)
- **`schemas/ai_suggest.py`**: Pydantic request/response models
- **Settings stored in**: `app_settings.general_settings.ai` (JSONB) — provider URL, model, search provider, enabled types

### Frontend Components
- **`AiSuggestPanel.tsx`**: Reusable UI showing suggestion with confidence badge, editable description, source links, and apply/dismiss buttons. Used in both `CardDetail` and `CreateCardDialog`
- **`AiAdmin.tsx`**: Admin settings page — toggle, provider URL, model selector, search provider, per-type enablement

### Search Providers
- **DuckDuckGo** (default): Zero-dependency HTML scraping fallback
- **Google Custom Search**: Requires API key + search engine ID (`API_KEY:CX` format)
- **SearXNG**: Self-hosted meta-search engine, JSON API

### Docker Integration
Ollama is available as an opt-in Docker Compose profile:
```bash
docker compose --profile ai up -d   # Starts Ollama alongside backend + frontend
```
The `ollama` service uses a persistent volume (`ollama_models`) and is only accessible internally. Set `AI_AUTO_CONFIGURE=true` to auto-detect and configure on first startup.

### Startup Automation (`main.py`)
- **Auto-configuration**: If `AI_AUTO_CONFIGURE=true` and AI is not yet configured in DB, writes env var values to `app_settings`
- **Model pulling**: Background task checks if the configured model exists in Ollama and pulls it if missing (10-minute timeout, non-blocking)

### Permission
- **`ai.suggest`**: Controls access to AI suggestion functionality. Granted to admin, bpm_admin, and member roles by default. Not available to viewers.

---

## Version Management

Single source of truth: `/VERSION` file at project root.

- **Backend**: `config.py` reads VERSION → exports `APP_VERSION` → exposed in `/api/health`
- **Frontend**: `vite.config.ts` reads VERSION → injects `__APP_VERSION__` global → displayed in user menu (AppLayout)
- **Docker**: Both Dockerfiles `COPY VERSION ./VERSION` before building
- **Local dev**: Frontend checks `../VERSION` (from frontend dir) then `./VERSION` (Docker)
- **Packaging metadata**: `backend/pyproject.toml` and `frontend/package.json` use a static `"0.0.0"` placeholder — do not bump them. This avoids triggering CI path filters on version-only changes.

---

## Security

This section covers the **runtime** security model of a deployed Turbo EA instance. For the **CI / supply-chain** side — what scanners cover what, Trivy/Scout/CodeQL/Dependabot wiring, allowlist procedures, image signing/verification — see [`.github/SECURITY_PIPELINE.md`](.github/SECURITY_PIPELINE.md).

### Startup Security
- App **refuses to start** with default `SECRET_KEY` in non-development environments
- In development mode, logs a warning about default key usage
- OpenAPI/Swagger docs are **disabled in production** (`ENVIRONMENT != "development"`)

### Encryption
- **Fernet symmetric encryption** (`core/encryption.py`) for database-stored secrets (SSO client secrets, SMTP passwords)
- Key derived from `SECRET_KEY` via SHA-256
- Values prefixed with `enc:` to distinguish encrypted from legacy plaintext
- `encrypt_value()` / `decrypt_value()` / `is_encrypted()` utilities

### Rate Limiting
- `slowapi` rate limiter in `core/rate_limit.py`
- Applied to auth-sensitive endpoints (login, register)

### Docker Hardening
- Non-root users: frontend runs as `nginx`, backend as `appuser`
- `cap_drop: ALL` + `no-new-privileges: true`
- Memory limits: backend 512M, frontend 256M
- Backend only exposed via internal Docker network (not to host)

### Nginx Security Headers
- Content-Security-Policy (strict, self-only with font/DrawIO exceptions)
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- Strict-Transport-Security: max-age=31536000
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera/microphone/geolocation disabled
- Request body limit: 5MB

### JWT Implementation
- PyJWT with HS256 algorithm in `core/security.py`
- Payload: `{sub: user_id, role: role_key, iat, exp, iss: "turbo-ea", aud: "turbo-ea"}`
- Issuer and audience validation on decode
- Passwords hashed with bcrypt
- Token sent as `Authorization: Bearer <token>`
- Frontend stores token in `sessionStorage` (not localStorage — cleared on tab close)

### Background Processes
- **Archived card auto-purge**: Background task runs hourly, permanently deletes cards archived for 30+ days (including their relations)
- **Ollama model pull**: On startup (if `AI_AUTO_CONFIGURE=true`), a background task checks if the configured LLM model exists and pulls it if missing (non-blocking, 10-minute timeout)

---

## Development

### Local Development (without Docker)

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
# Ensure PostgreSQL is running with correct credentials
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev    # Vite dev server on port 5173, proxies /api to :8000
```

### Linting & Testing

**Backend:**
```bash
cd backend
ruff check .          # Lint (rules: E, F, I, N, W; line-length: 100)
ruff format .         # Auto-format
pytest                # Run tests (asyncio_mode=auto)
```

**Frontend:**
```bash
cd frontend
npm run lint          # ESLint
npm run build         # TypeScript check + Vite build
```

### Database Reset
Set `RESET_DB=true` to drop all tables and re-seed on next startup.

### Key Libraries

**Backend:**
- FastAPI 0.115+ with Pydantic 2.10+
- SQLAlchemy 2.0+ (async via asyncpg)
- Alembic for migrations
- PyJWT 2.9+ for JWT tokens
- bcrypt for password hashing
- cryptography (Fernet) for field encryption
- simpleeval for safe formula evaluation
- sse-starlette for Server-Sent Events
- slowapi for rate limiting
- httpx for outbound HTTP (ServiceNow, EOL, AI search + LLM)
- defusedxml for safe XML parsing (BPMN)
- ruff for linting (target: Python 3.11+, line-length: 100)

**Frontend:**
- React 18 + TypeScript 5.6
- MUI 6 + Emotion for styling
- AG Grid for data tables
- Recharts for visualizations
- bpmn-js for BPMN editing
- TipTap for rich text editing
- @dnd-kit for drag-and-drop
- docx + file-saver for DOCX generation
- xlsx (vendored 0.20.3) for Excel import/export

---

## Docker Architecture

### docker-compose.yml
Production-only stack with PostgreSQL, backend, frontend, edge nginx, and optional `mcp` / `ai` profiles:
- **db**: pulled from `ghcr.io/vincentmakes/turbo-ea/db:${TURBO_EA_TAG}`, persisted in the `postgres_data` volume
- **backend**: pulled from `ghcr.io/vincentmakes/turbo-ea/backend:${TURBO_EA_TAG}`, exposed only inside the compose network
- **frontend**: pulled from `ghcr.io/vincentmakes/turbo-ea/frontend:${TURBO_EA_TAG}`, exposed only inside the compose network
- **nginx**: pulled from `ghcr.io/vincentmakes/turbo-ea/nginx:${TURBO_EA_TAG}`, public entrypoint on `HOST_PORT`, proxies `/api`, `/mcp`, `/drawio`, and `/` to internal services
- **mcp-server**: optional profile `mcp`, pulled from `ghcr.io/vincentmakes/turbo-ea/mcp-server:${TURBO_EA_TAG}`
- **ollama**: optional profile `ai`, pulled from `ghcr.io/vincentmakes/turbo-ea/ollama:${TURBO_EA_TAG}`, persisted in the `ollama_models` volume

### dev/docker-compose.dev.yml
Development-only override that adds `build:` back to `db`, `backend`, `frontend`, `nginx`, `ollama`, and `mcp-server` using the root `Dockerfile` targets. Use it with:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

### GHCR Image Publishing (opt-in)
- **Workflow**: `.github/workflows/docker-publish.yml` builds and pushes multi-arch (`amd64` + `arm64`) images to `ghcr.io/vincentmakes/turbo-ea/{db,backend,frontend,nginx,mcp-server}` on every push to `main`, every `v*.*.*` tag, and on `workflow_dispatch`. The **ollama** image is intentionally excluded from the matrix because it is just a thin non-root patch over `ollama/ollama:latest`; republish it manually with `docker buildx build --platform linux/amd64,linux/arm64 --target ollama -t ghcr.io/vincentmakes/turbo-ea/ollama:latest --push .` whenever upstream Ollama changes.
- **Compose usage**: production uses `docker compose pull && docker compose up -d`. Development uses the `dev/docker-compose.dev.yml` file to build from source. Pin a version with `TURBO_EA_TAG=0.70.x` (defaults to `latest`).
- **Auth**: workflow uses the auto-provisioned `GITHUB_TOKEN` (`packages: write`); no extra secrets needed. Packages must be flipped to **Public** in GitHub package settings on first publish.

### Ollama Service (opt-in)
- **Profile**: `ai` — started with `docker compose --profile ai up -d`
- **Image**: `ghcr.io/vincentmakes/turbo-ea/ollama:${TURBO_EA_TAG}`, exposes port 11434 internally only
- **Volume**: `ollama_models` for persistent model storage
- **Memory**: Configurable via `OLLAMA_MEMORY_LIMIT` (default 4G)
- **Health check**: Uses `ollama list`

### Root Dockerfile (single file, multiple build targets)
All container images are built from one `/Dockerfile` at the repo root using multi-stage `--target` selection. Each `target` becomes a published GHCR image. Stages:

| Target | Base | Purpose |
|--------|------|---------|
| `backend-build` | `python:3.12-alpine` | Compile-time wheel/deps builder for backend |
| `backend` | `python:3.12-alpine` | Final backend image — copies `VERSION` + `backend/`, runs as non-root `appuser` |
| `db` | `postgres:18-alpine` | Bundled PostgreSQL image |
| `frontend-build` | `node:20-alpine` | Vite build of `frontend/` (consumes `VERSION` for `__APP_VERSION__`) |
| `drawio` | `alpine/git:v2.47.2` | Clones jgraph/drawio v26.0.9 |
| `frontend` | `nginx:alpine` | Final frontend image — built SPA + DrawIO assets, runs as non-root `nginx` |
| `nginx` | `nginx:alpine` | Edge nginx (public entrypoint, proxies `/api`, `/mcp`, `/drawio`, `/`) — config from `nginx/default.conf` |
| `ollama` | `ollama/ollama:latest` | Thin non-root patch over upstream Ollama |
| `mcp-server` | `python:3.12-alpine` | MCP server image — copies `VERSION` + `mcp-server/`, runs as non-root |

### Nginx Configuration
- `/api/*` → proxy to `backend:8000` (with SSE support headers)
- `/drawio/*` → static DrawIO assets (30-day cache, no-transform)
- `/*` → SPA fallback to `index.html`
- Security headers on all responses
- Static assets → 1-year cache with `immutable`
