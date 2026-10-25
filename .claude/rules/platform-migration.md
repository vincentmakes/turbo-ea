---
paths:
  - "backend/app/services/migration/**"
  - "backend/app/api/v1/migration.py"
  - "backend/app/models/migration.py"
  - "frontend/src/features/admin/Migration*"
  - "docs/admin/migration*.md"
---

# The third-party platform migration importer / exporter

> Loaded when you touch `backend/app/services/migration/**`, `backend/app/api/v1/migration.py`, `backend/app/models/migration.py`, `frontend/src/features/admin/Migration*`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

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

5. **i18n** — no new keys required. The picker uses the adapter's `label` directly; the staging/apply UI is source-agnostic and uses the existing `migration.*` keys in all 10 locales.

6. **Docs** — update `docs/admin/migration.md` (+ 7 locale variants `.de`/`.fr`/`.es`/`.it`/`.pt`/`.zh`/`.ru`) to add the new source to the **Supported sources** table at the top. If the new source has format-specific guidance (e.g. how to obtain the export), add a short subsection like the existing LeanIX one. Keep the workflow / re-running / permissions sections generic.

7. **Database schema** — **no Alembic migration**. The three tables (`migrations`, `staged_records`, `migration_identity_map`) are source-uniform; the only per-source DB knowledge is the `source_type` value, which is just a string. Adding a Postgres CHECK constraint on `source_type` would be tempting but is intentionally avoided — the registry is the source of truth and the route layer rejects unknown keys before any insert.

8. **Permissions** — no change. All sources share the single `admin.migrate` permission. Splitting into per-source permissions (`admin.migrate.<key>`) is deferred until a customer actually requests it (the registry already knows the key, so splitting later is a five-minute change).

#### Exporting to a source platform (the reverse direction)

The same page also runs in reverse: **Export workspace** (gated on `admin.export_workspace`, the workspace bundle export's permission — the file is the whole landscape, so it is not a per-card-type read and sits outside `CardReadScope` like `build_bundle`) calls `GET /migration/export?source_key=<key>&include_archived=`. The shape mirrors the import pipeline: `build_export_snapshot(db)` (`services/migration/export_snapshot.py`, source-agnostic) reads the inventory into the **same** `MigrationSnapshot` dataclasses the parsers produce, in Turbo EA vocabulary (card-type keys, relation keys, `displayName` = hierarchy path joined with `" / "`, stakeholders as `Subscription` rows whose `role_name` is the role definition's label), and the adapter's optional, **duck-typed** `export(snapshot) -> bytes` hook (`export_extension` / `export_media_type` beside it; deliberately not on the `MigrationSource` protocol until a second adapter needs it — the route and `GET /migration/sources`' `supports_export` both check `callable(getattr(source, "export", None))`) writes a file **the platform itself ingests**. That last clause is the rule, and for LeanIX it is not the Full Snapshot workbook the importer reads: LeanIX has no self-service import of its own snapshot (SAP clones one on a support ticket), and no LeanIX import takes a zip. The one bulk import a LeanIX admin can run alone is the **Integration API**, so `sources/leanix/ldif_exporter.py` writes a `.zip` holding `ldif.json` (one content item per card typed as the LeanIX fact-sheet type, one per relation typed as the LeanIX relation name, hierarchy as `relToParent`), `processors.json` (the matching processor configuration, generated from the metamodel actually exported: one `inboundFactSheet` per type writing only the fields the cards carry, one `inboundRelation` per relation type, `inboundTag` / `inboundSubscription` / `inboundDocument` iterating `forEach` over the item's sub-collections), `comments.json` (not importable through the API, kept for reference) and a `README.md` with the load steps (browser and REST) and the meta-model prerequisites. Two conventions the processors rely on: identity is the **card id stored as the fact sheet's `externalId`** (every identifier / `from` / `to` is `{"external": {"id", "type": "externalId"}}`, so a re-run updates rather than duplicates and relations resolve without LeanIX's internal ids), and every update reads `${data.x != null ? data.x : lx.factsheet.x}` so `processingMode: "partial"` never blanks a field the export did not carry. Names go through the **explicit inverse tables** `EXPORT_TYPE_MAPPING` / `EXPORT_RELATION_API_MAPPING` (the `rel<From>To<To>` form the API uses, not the workbook's `<from><To>Relation` form) / `EXPORT_FLIP_DIRECTION` in `mappings.py` — explicit because the import tables are many-to-one — and `test_migration_leanix_ldif_exporter.py` pins that every export value routes back to its own key through the import tables (which is how the missing `dataObjectSuccessorRelation` import entry was found), that every content type has a processor, and that every relation endpoint exists. A new adapter that wants export adds the hook and its inverse tables; nothing above the adapter changes.

**Guardrails when writing an adapter**:

- **Mapping dicts on the adapter, not inlined**. Module-level constants in `mappings.py` keep the LX/Ardoq-specific knowledge in one obvious place. Resist the temptation to special-case in `staging.py`.
- **Source-specific quirks belong in `post_build_card_payload`**, not in the staging pipeline. If a source needs more than a simple mapping (e.g. force a subtype, rewrite an attribute, tag the origin), express it as a payload mutation in the hook. The hook is allowed to be empty for adapters that don't need it.
- **Don't expand the `MigrationSource` Protocol** without a second adapter actually needing the new method. YAGNI applies — `post_build_card_payload` + `map_subscription_role` covered every LeanIX quirk; the next adapter likely needs the same two, possibly nothing more.
- **Identity map is keyed by `(source_id, entity_kind, source_type)`**. Two sources can legitimately share an external id; the schema reflects that and the staging pipeline's identity-resolution queries already filter by `source_type` via `migration.source_type`. Never strip the `source_type` filter from a query.
- **Snapshot dataclasses are source-neutral** — don't add source-specific fields to `SourceEntity` / `Relation` / etc. Stuff source-specific data into `raw` or `custom_fields` instead.
- **The apply pipeline is source-agnostic**. It walks `entity_kind` rows by action; it never reads the adapter. If you find yourself wanting to dispatch on `source_type` in `apply.py`, push the logic into a per-source extension hook on the adapter instead.
- **Hierarchy edges go on `SourceEntity.parent_id`** at parse time (via the optional `HIERARCHY_RELATIONS` set + a parser pass). Never let a hierarchy edge surface as a Turbo EA relation.
