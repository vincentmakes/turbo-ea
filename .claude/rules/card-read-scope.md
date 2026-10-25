---
paths:
  - "backend/app/api/v1/**"
  - "backend/app/api/deps.py"
  - "backend/app/services/card_read_scope.py"
  - "backend/app/services/card_type_delete.py"
  - "backend/app/services/permission_service.py"
  - "backend/app/core/permissions.py"
  - "frontend/src/hooks/usePermissions.ts"
  - "frontend/src/features/admin/Roles*"
  - "frontend/src/features/admin/metamodel/DeleteTypeDialog*"
---

# Card read scope, RBAC and role impersonation

> Loaded when you touch `backend/app/api/v1/**`, `backend/app/api/deps.py`, `backend/app/services/card_read_scope.py`, `backend/app/services/card_type_delete.py`, … (full list in the frontmatter). Moved verbatim from `CLAUDE.md`; edit it here.

- **A card read has one scope: `CardReadScope` (`backend/app/services/card_read_scope.py`). Every endpoint that returns cards, or anything naming a card, applies it.** The per-card-type **View** cell (`inventory.view` in `TYPE_SCOPED_APP_PERMISSIONS`, added 2.151.0) lets an admin hide a type from a role, and the user-confirmed rule is *omit entirely*: a card the caller may not read does not exist for them — no row, no relation, no graph node, no count, no id in an event payload. It is enforced on every surface, and `CardReadScope.load(db, user)` (or the `get_card_read_scope` dependency) is the one way to ask. Rules:
  - **Two modes, and `mode=` is a required keyword so no call site can drift into the wrong one.** `"inventory"` is for what was gated on `inventory.view` (lists, search, counts, the card detail read gate, resolve-refs, the OData feed): a type is readable when its cell is Allow, or absent and the role holds the global grant. `"module"` is for surfaces gated on their own permission (reports, BPM, PPM, risks, ADR, diagrams, TurboLens, sub-resources, exports): readable unless the cell is an explicit Deny — so a reports-only role without `inventory.view` keeps its reports, which is the no-regression half. A card's own sub-reads — hierarchy, relation summary, descendant relations, history — are module mode too, like `GET /relations`: their gate (`_require_card_read`) admits a card through `ppm.view` or a stakeholder role, and inventory mode showed such a reader an empty tree. In both modes a card on which the user holds a stakeholder role granting `card.view` stays readable — a type deny removes the landscape-wide grant, never a per-card one.
  - **The fast path is load-bearing.** `clause()` returns `None` for the wildcard role and for any role with no View cell, so an install that never sets one runs byte-identical SQL. `where(card, mode=)` returns a tuple to splat into `.where(*...)`; `ref_clause(type_expr, id_expr, mode=)` is the same predicate over an event payload's `(type, id)` pair.
  - **A single hidden card is 404, not 403** (`require_card_readable`), so the answer never confirms it exists; a list endpoint replaces its `inventory.view` gate with `require_inventory_browse`, which admits a role whose only grant is an Allow cell.
  - **An explicit View deny removes every landscape-wide grant on the type** (`type_cell_decision` in `core/permissions.py`, mirrored by the frontend `hasTypePermission`): write implies read, so Create/Edit/Archive/Delete/comments/`ppm.view` all answer False for that type, and the panel shows those cells locked while keeping their stored values. `check_permission("inventory.view", card, "card.view")` — and therefore the SDK's `check_card_permission` — became type-aware with no change of its own.
  - **A write that replaces a link set keeps the links the caller never saw** — `keep_hidden` / `hidden_card_ids` on ADR `linked_card_ids`, diagram `card_ids`, BPM element organisations and draft links. "Hidden" means *exists and is unreadable*; a deleted card is neither, so a clear of a dangling link still takes.
  - **Payloads, not just rows.** Event feeds (dashboard recent activity, `/events/my-cards`, card history) filter through `event_read_filters` and scrub id lists with `scrub_event_payloads`; notifications about hidden cards drop out of the list and the counts; `GET /cards?ids=` returns `withheld_ids` so the diagram stale check can tell *hidden* from *deleted* and not flag every hidden cell as removed.
  - **Out of scope by design**: public portals and published diagrams (publications), the extension data bridge (system-level), `admin.events` / `GET /events`, workspace export, surveys an admin addressed, stored diagram XML and SoAW/ADR free text, calculated-field values and metamodel usage counts. The TurboLens Architecture AI reasons over the whole landscape, so `_require_whole_landscape` refuses it to any restricted reader rather than feeding a partial one to the model.
  - `GET /metamodel/types` returns `role_permissions` to `admin.metamodel` holders only — once it records which types a role cannot see it is RBAC matrix data (see the rule above).
  Guard tests: `tests/services/test_card_read_scope.py` (SQL ↔ Python ↔ single-card guard ↔ `check_permission` parity over every cell × grant × stakeholder × mode combination), `test_card_read_scope_guard.py` (any `api/v1` module reading cards must reference the scope or sit in `NOT_A_USER_READ` with a reason; stale entries fail), `tests/api/test_read_scope_sentinel_sweep.py` (every GET route called as a restricted reader must not contain a seeded hidden card's name or id, with a non-vacuity control as admin), `tests/api/test_cards_type_read_permissions.py`. A new endpoint that returns cards takes the scope, or the static scan fails it.

- **A built-in card type is only ever hidden; a custom one can be deleted for good, dependants included.** `DELETE /metamodel/types/{key}` hides a built-in type (the seed restores it) and refuses a custom type that still has cards with **409 `cards_present`** unless called with `delete_cards=true`, which additionally requires `inventory.delete` — deleting the cards is a permanent inventory delete, not a metamodel edit. The deletion itself lives in `backend/app/services/card_type_delete.py` (`type_delete_impact` for the counts the confirmation dialog and the 409 carry, `delete_type_dependents` for the removal, `leaves_first` for the parent-before-child ordering the self-FK needs): cards (publishing one `card.deleted` event each with `db=`, so the History and the Modified column agree, as the rule above requires), the relation types touching the type with their rows, the calculations targeting it, and the stakeholder role definitions by database cascade. The frontend offers it only from the type editor's header (`DeleteTypeDialog`), with the impact listed and the type key typed before the button unlocks; the button is rendered locked on a built-in type so the admin sees why. Guard tests: `tests/api/test_metamodel_delete_type.py`, `frontend/src/features/admin/metamodel/DeleteTypeDialog.test.tsx`.

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

**App-level permissions** (27 groups, 72 keys; five of them — `inventory.view` / `create` / `edit` / `archive` / `delete` — can be overridden per card type and role through `card_types.role_permissions`, see *A card read has one scope* above): `inventory.*`, `relations.*`, `stakeholders.*`, `comments.*`, `documents.*`, `diagrams.*`, `bpm.*`, `ppm.*`, `reports.*`, `surveys.*`, `soaw.*`, `adr.*`, `tags.*`, `bookmarks.*`, `saved_reports.*`, `eol.*`, `web_portals.*`, `notifications.*`, `servicenow.*`, `turbolens.*`, `compliance.*` (view + manage for the GRC Compliance scanner — the CVE half of the old "Security & Compliance" tab was removed), `risks.*` (view + manage for the EA Risk Register), `grc.*`, `costs.*`, `ai.*`, `users.*`, `admin.*` (includes `admin.export_workspace` / `admin.import_workspace` for the Workspace Transfer tool)

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
