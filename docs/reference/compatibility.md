# Compatibility policy

From version `1.0.0` onwards, Turbo EA commits to documented backwards compatibility within a major version line. This page is the contract: it describes what stays stable, what may change, and how deprecations work, so operators can plan upgrades without surprises.

The policy applies to `1.x`. A future `2.x` line may revise it; if so, a migration guide will ship with the `2.0.0` release notes.

---

## What's covered

### Database schema (Alembic migrations)

Within `1.x`:

- Migrations are **additive** or **backwards-compatible-on-upgrade**.
- New columns may be added at any time.
- Existing columns will not be dropped without going through a deprecation cycle.
- Existing columns will not be renamed without a deprecation cycle (a rename is implemented as add-new-column → backfill → deprecate-old-column → drop-in-next-major).
- Type changes are limited to widening (e.g. `varchar(80)` → `varchar(255)`); narrowing changes go through deprecation.
- Foreign-key constraints will not become stricter (e.g. `ON DELETE SET NULL` becoming `ON DELETE CASCADE`) without a deprecation cycle.

Operators can roll forward with confidence; the auto-migration on backend startup is safe to run on production data.

### Built-in metamodel

Within `1.x`, the metamodel that ships in `backend/app/services/seed.py` is stable:

- Built-in card type keys (`Application`, `Initiative`, `BusinessCapability`, etc.) will not be renamed or removed.
- Built-in field keys on those types will not be removed without a deprecation cycle.
- Built-in relation type keys will not be renamed or removed without a deprecation cycle.
- Default subtypes shipped with built-in types are stable.

Operators' own customisations (custom card types, custom fields added via the admin UI, custom relation types) are owned by the operator and are not covered by this policy.

### REST API (`/api/v1/`)

Within `1.x`:

- Endpoints under `/api/v1/` will not be removed without a deprecation cycle.
- Existing request and response field names will not be renamed without a deprecation cycle.
- Field types will not change incompatibly (e.g. string → array).
- New optional request fields and new response fields are non-breaking and may land in any minor.
- New endpoints are non-breaking and may land in any minor.
- Authentication semantics (`Bearer` JWT, the `/auth/login` payload shape) are stable.
- HTTP status code semantics are stable for documented success and error paths.

Behaviour beyond the documented surface (undocumented headers, internal error message text, ordering when no `sort_by` is specified) is not covered.

### Permission keys

Permission keys defined in `backend/app/core/permissions.py` are stable within `1.x`. New keys may be added; existing keys will not be renamed or removed without a deprecation cycle.

The set of permissions granted **by default** to the seeded roles (`admin`, `bpm_admin`, `member`, `viewer`) may change between minor releases, with a CHANGELOG callout. Operators who have customised role permissions in their deployment are unaffected.

### Configuration (environment variables)

Existing environment variables documented in `CLAUDE.md` and `README.md` are stable within `1.x`. New variables may be added with sensible defaults. Default values may change with a CHANGELOG callout when the change is operator-relevant (e.g. a new default port).

### Encrypted-at-rest secrets

The `enc:` prefix marker and Fernet-derived key in `backend/app/core/encryption.py` are stable within `1.x`. Operators do not need to re-encrypt secrets across minor upgrades.

---

## Deprecation cycle

When something covered by this policy needs to be removed:

1. **Mark deprecated in minor `N`.** The CHANGELOG entry includes a `Deprecated` section calling out the change. For API endpoints, the deprecated route emits a `Deprecation: true` response header (RFC 8594) and a `Sunset` header indicating the earliest removal target.
2. **Continue to support in minor `N+1`.** Removal cannot land in the same minor as deprecation. The deprecated form keeps working.
3. **Earliest removal in minor `N+2` or in `2.0`** (whichever comes first). Removal lands with a `Removed` section in the CHANGELOG and a migration note.

For data-shape changes (Alembic migrations), the same N → N+1 cadence applies, expressed as add-new → backfill → drop-old.

---

## What's not covered

These are explicitly out of scope and may change at any time:

- The **internal Python module layout** under `backend/app/`. Imports of `app.models`, `app.services`, etc. are not part of the public API. Plugins or scripts that depend on internal imports should pin a specific Turbo EA version.
- The **structure of JSONB blobs** stored on built-in tables (`fields_schema`, `section_config`, `attributes`, `lifecycle`) beyond what is read by the documented REST API. The on-disk JSON shape may evolve to support new features.
- **Frontend internals**: component file paths, prop signatures of components in `frontend/src/`, the contents of `frontend/src/types/index.ts`, and the styling of MUI components. Operators using the bundled frontend are insulated; anyone embedding components from the source tree is on their own.
- **Operator-introduced metamodel customisations.** If you add a custom card type or field via the admin UI, you own the migration story when you change it.
- **Demo and seed data** (`SEED_DEMO=true`). The demo dataset is allowed to evolve freely between releases.
- **Bundled third-party services**: DrawIO version, Ollama bundled image, the embedded swagger-ui-dist version. These may be upgraded at any time.
- **Behaviour with non-default configurations** that are explicitly flagged as experimental in CHANGELOG entries.

---

## What "1.0.0" actually changes

Compared to the `0.x` series, `1.0.0` itself is not a feature release — it's the point at which the commitments above start applying. Code shipping in `1.0.0` is the same code that shipped in `0.71.0`, plus the supply-chain hardening and contributor-flow changes documented in the [`1.0.0` CHANGELOG entry](https://github.com/TurboEA/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

Pre-`1.0` releases were not covered by this policy. Migrations between `0.x` versions could and did include schema drops, renames, and breaking metamodel changes. From `1.0.0` onwards, those go through the deprecation cycle.
