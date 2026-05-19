# Platform Migration (LeanIX)

The platform-migration importer (**Admin → Settings → Migration**) ingests a complete LeanIX workspace and lands it as Turbo EA cards, relations, tags, stakeholders, documents, comments, and a fully-fleshed-out metamodel in one staged, reviewable operation.

## Who is this for?

Customers moving from LeanIX (SAP LeanIX) to Turbo EA. The importer accepts **two snapshot formats**:

- **`.xlsx` Full Export** (default for most customers) — the multi-sheet workbook produced by LeanIX's *Reports → Full Export* function. One sheet per fact-sheet type, one sheet per relation type, plus `TagGroups`, `Tags`, `Documents`, `Comments`, `Types`, and a `ReadMe` reference sheet. Any LeanIX user can produce it; no admin access required.
- **Gzipped JSON Workspace Snapshot** (`workspace-<id>-<date>.json.gz`) — the tenant-cloning snapshot produced via **Administration → Workspace → Conduct a Data Snapshot**. Admin-only.

Both formats land on the same internal model — the parser auto-detects which one was uploaded based on the file content (it sniffs the ZIP magic `PK\x03\x04` for xlsx and the gzip magic `\x1f\x8b` for the JSON snapshot), so a mis-named extension still routes correctly.

## How to obtain the export

- **xlsx Full Export** — In LeanIX, **Reports → … → Full Export** produces a workbook named like `20260518_snapshot_demo.xlsx`. The file contains every active fact sheet, every relation, the tag / document / comment metadata, and a `ReadMe` sheet describing every column and its allowed values.
- **JSON Workspace Snapshot** — In LeanIX, **Administration → Workspace → Conduct a Data Snapshot** triggers the tenant-clone snapshot. The output file is named like `workspace-<id>-<date>.json.gz`. You will need admin access in LeanIX to trigger this export.

If you do not have admin access in LeanIX but have a tenant-level API token, the GraphQL `allFactSheets` query plus `subscriptions`, `relations`, and `documents` queries together produce a JSON dataset that matches the snapshot shape — the importer accepts that too.

## The workflow

1. **Upload** the snapshot at **Settings → Migration → New migration**. The file stays on the server's disk; the database only holds metadata. Parsing runs in the background and the status moves through `uploaded → parsed` automatically.

2. **Review** each entity kind in the per-tab view. Every staged row carries an action:
    - `create` — will be added to Turbo EA
    - `update` — exists already; diff-fields will be merged
    - `skip` — exists already with no changes
    - `conflict` — endpoint missing, type unmapped, or built-in collision — see the *Note* column for the reason

    The **New types**, **Custom fields**, and **New relations** tabs surface tenant-customised metamodel from your LeanIX workspace. By default, these are accepted as-is and create matching non-built-in card types / fields / relation types in Turbo EA. For finer control, edit the proposed key/label/type in the staged-record JSON before applying.

3. **Apply** when you are satisfied. The apply pipeline runs 12 dependency-ordered passes inside individual savepoints — one failing row does not poison the rest of the import. Status moves through `applying → applied` (or `failed` if errors cross the safety threshold).

## What gets imported

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Direct 1:1 card-type mapping |
| User Group | Organization with subtype `team`, tagged `leanix_origin=UserGroup` |
| Lifecycle phases (plan / phaseIn / active / phaseOut / endOfLife) | Carried verbatim onto `cards.lifecycle` |
| Hierarchy (`childParentRelation`) | Folded into `Card.parent_id` |
| Successor / predecessor edges (`*SuccessorRelation`) | Stored as relations; the new tenant card types have `has_successors=true` so the lineage view renders |
| Relations (50+ default LeanIX edge types, both xlsx-style `applicationITComponentRelation` and GraphQL-style `relApplicationToITComponent` names) | Native Turbo EA relations with edge attributes |
| Tenant-defined relation types (Server↔Application, lxSystem*, lxDora*, microservice*, ESG*, etc.) | New non-built-in `relation_types` rows, created automatically in the same import pass so every edge actually lands |
| Tags (single / multi groups) | Tag groups + tags + per-card joins |
| Subscriptions (one per RESPONSIBLE / OBSERVER role) | Stakeholder rows; users auto-created as deactivated (`is_active=false`) |
| Documents (URL) | Document attachments |
| Comments (top-level + replies, flattened) | Comment rows |
| Tenant-custom fact-sheet types (e.g. `ESGCapability`, `Server`, `System`, `TechPlatform`, `TechnicalStack`) | New non-built-in card types with `has_hierarchy=true`, `has_successors=true`, and an `Imported from LeanIX` field section pre-populated |
| Tenant-custom fields | Appended to the target type's `fields_schema` under a synthetic `Imported from LeanIX` section. Field type and **complete** enum option list are lifted from the workbook's `ReadMe` reference sheet — so `currentMaturity` lands as a single-select with all 5 values (`adHoc, repeatable, defined, managed, optimized`) even when the data uses only one |
| Tenant-custom relation types | New non-built-in relation types, endpoint types translated through the LX↔TEA type map (`UserGroup → Organization`, etc.) |

### Why the ReadMe sheet matters

The first sheet of the xlsx (`ReadMe`) is LeanIX's authoritative field reference: every column documented with its type (`String`, `Integer`, `Percent`, `Datetime`, `Boolean`, `String list`) and, where applicable, its full enum constraint (`Possible values: one of A, B, C.`). The importer reads this sheet first and uses it as the primary source of truth for field metadata — falling back to the in-data `Types` sheet only when the ReadMe doesn't cover a column. This is the difference between an imported field that's a free-text input and one that's a proper dropdown with the right options.

## What does **not** get imported

The snapshot does not carry these — the importer surfaces what is missing in the per-row `Note` column:

- **Document binaries** — only URLs are in the snapshot; the importer creates link-style Document rows. Re-upload binaries by hand.
- **Comment threading** — replies are flattened to top-level comments to preserve the prose; thread parents would require LeanIX UI metadata that isn't in the snapshot.
- **User passwords and SSO bindings** — auto-created users land deactivated. Invite them or bind them to SSO afterwards.
- **Audit history** prior to the import — Turbo EA's history starts at the apply timestamp.
- **Diagrams / poster views / dashboards / saved searches / notification preferences / API tokens / webhooks** — no equivalent in Turbo EA, or no analog in the snapshot.

## Re-running an import

Idempotency is built in. The `leanix_identity_map` table records the LeanIX → Turbo EA UUID for every entity that has been imported. A re-upload of the same snapshot (or an updated snapshot from the same workspace) detects existing entities and writes `update` / `skip` staged rows rather than duplicate `create`s. The card's `external_id` carries the LeanIX `factSheetId` so the link survives even if the identity map is wiped.

If you need to redo an import (e.g. you bulk-deleted the imported cards in the UI and want to land them fresh), use the trash icon on the migration row to delete it, then re-upload. `applied` migrations are deletable; doing so releases the file-hash idempotency lock so the same snapshot can be uploaded again. Dangling `leanix_identity_map` rows that point at cards that no longer exist are auto-pruned on the next staging pass, so a manual cleanup of the identity map is never required.

## Permission

This page is gated by the `admin.migrate` permission. Only the **admin** role holds it by default; grant it explicitly to other roles in **Settings → Roles** if you want a non-admin to drive the migration.

## Limitations to plan for

- **One in-progress migration per file hash.** Re-uploading the exact same bytes while a migration for that hash is still active returns the existing migration record (the SHA-256 hash is the natural idempotency key). Delete the migration record first if you really want a fresh ingest of the same file.
- **Large workspaces** (10k+ fact sheets): the parser is streaming, but the apply pipeline writes rows in one transaction per pass. Plan ~15 minutes for very large imports.
- **Custom fields, values, and tags are tolerated, not pre-mapped.** Any LeanIX column that isn't in Turbo EA's built-in metamodel lands on the imported card's `attributes` map verbatim and is surfaced in the **Custom fields** tab so an admin can promote it. Same for tenant-defined tag groups and for relation types LeanIX customers have added (e.g. `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — they appear in the **New types** / **New relations** tabs unchanged, ready for an admin decision.

## Cleanup

Deleting a migration record (Settings → Migration → trash icon) removes both the database rows for that migration (staged records cascade) and the snapshot file on disk. `uploaded`, `parsed`, `previewed`, `failed`, `aborted`, and `applied` migrations are all deletable; an `applying` migration must finish (or fail) before it can be removed.
