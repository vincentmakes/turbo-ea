# Turbo EA — Role-Based Access Control (RBAC) Specification

## 1. Executive Summary

Replace the current hardcoded role system (`admin`, `bpm_admin`, `member`, `viewer` stored as a string on `User.role`) with a fully configurable, two-tier permission model:

- **Tier 1 — App-Level Roles**: Admin-defined roles with granular permissions across all application modules (inventory, BPM, reports, diagrams, admin, etc.). Admins can create, edit, and archive custom roles.
- **Tier 2 — Fact-Sheet-Level Roles**: Admin-defined subscription roles (per fact sheet type) with granular permissions controlling what a user can do on a specific fact sheet they are subscribed to (view, edit, delete, manage quality seal, manage subscriptions, etc.). Admins can create, edit, and archive subscription roles.

Both tiers work together: a user's effective permission on any resource is the **union** of their app-level role permissions and any fact-sheet-level subscription permissions they hold.

**Lifecycle**: Roles at both tiers are never hard-deleted. They are **archived** (soft-deleted), which preserves audit trails and prevents orphaned references. Archived roles are hidden from assignment UIs but remain visible in historical data.

---

## 2. Current State Analysis

### 2.1 App-Level Roles (Today)

| Role | Storage | Enforcement |
|------|---------|-------------|
| `admin` | `User.role` string column (max 20 chars) | `require_admin()` in `deps.py`, inline `if user.role != "admin"` in ~15 route files |
| `bpm_admin` | Same | `require_bpm_admin()` in `deps.py`, inline checks in `bpm_workflow.py` |
| `member` | Same | Implicit — anything not guarded by admin/bpm_admin |
| `viewer` | Same | Implicit — SSO default role, some BPM draft visibility checks |

**Problems**: No granular permissions, hardcoded role names, no custom roles, inconsistent enforcement across routes, no UI-level permission gating, no ability to restrict specific modules.

### 2.2 Fact-Sheet-Level Roles (Today)

| Concept | Storage | Enforcement |
|---------|---------|-------------|
| Subscription roles | `Subscription.role` string, configurable per `FactSheetType.subscription_roles` JSONB | Only in `bpm_workflow.py` (6 helper functions). No enforcement on core CRUD routes (`fact_sheets.py`, `comments.py`, `documents.py`, `subscriptions.py`). |

**Problems**: Subscription roles exist but only gate BPM workflow actions (view drafts, edit drafts, approve). They do not restrict who can edit a fact sheet, delete it, manage its quality seal, or manage its subscriptions.

---

## 3. Target Architecture

### 3.1 Data Model

#### 3.1.1 New Table: `roles`

Stores admin-defined app-level roles. Replaces the hardcoded string enum.

```
Table: roles
├── id              UUID, PK, default uuid4
├── key             VARCHAR(50), UNIQUE, NOT NULL     -- e.g. "admin", "architect", "viewer"
├── label           VARCHAR(200), NOT NULL             -- e.g. "Administrator", "Enterprise Architect"
├── description     TEXT, nullable                     -- Purpose of this role
├── is_system       BOOLEAN, default false             -- true for "admin" (cannot be archived/renamed)
├── is_default      BOOLEAN, default false             -- assigned to new users (exactly one role should be default)
├── is_archived     BOOLEAN, default false             -- soft-delete: hidden from assignment, preserved in history
├── color           VARCHAR(20), default "#757575"     -- UI badge color
├── permissions     JSONB, NOT NULL, default '{}'      -- app-level permission map (see §3.2)
├── sort_order      INTEGER, default 0                 -- display ordering
├── created_at      TIMESTAMPTZ, server_default now()
├── updated_at      TIMESTAMPTZ, server_default now(), onupdate now()
├── archived_at     TIMESTAMPTZ, nullable              -- when the role was archived
├── archived_by     UUID, FK → users.id, nullable      -- who archived it
```

**Constraints**:
- `key` is immutable for system roles (`is_system = true`).
- Exactly one role has `is_default = true` (enforced at the application level).
- The system `admin` role cannot be archived or have its permissions reduced.
- Role keys follow the pattern `^[a-z][a-z0-9_]{1,48}[a-z0-9]$`.
- Archived roles are excluded from all assignment dropdowns (user creation, user edit, SSO invitations, default role).
- Archived roles remain valid FK targets — users assigned to an archived role keep it until an admin reassigns them. The UI shows a warning badge on users with archived roles.
- Archiving a role that is currently `is_default = true` is not allowed (admin must reassign default first).

**Seed data** (migration): Create rows for the four current roles, migrating the hardcoded strings.

| key | label | is_system | is_default | permissions |
|-----|-------|-----------|------------|-------------|
| `admin` | Administrator | `true` | `false` | `{ "*": true }` (wildcard: all permissions) |
| `bpm_admin` | BPM Administrator | `false` | `false` | See §3.2 for default mapping |
| `member` | Member | `false` | `true` | See §3.2 for default mapping |
| `viewer` | Viewer | `false` | `false` | See §3.2 for default mapping |

#### 3.1.2 New Table: `subscription_role_definitions`

Replaces the current `FactSheetType.subscription_roles` JSONB array with a proper table. Each row defines a subscription role for a given fact sheet type, with its permissions and archive state.

```
Table: subscription_role_definitions
├── id                  UUID, PK, default uuid4
├── fact_sheet_type_key VARCHAR(100), FK → fact_sheet_types.key ON DELETE CASCADE, NOT NULL
├── key                 VARCHAR(50), NOT NULL           -- e.g. "responsible", "observer", "data_steward"
├── label               VARCHAR(200), NOT NULL          -- e.g. "Responsible", "Data Steward"
├── description         TEXT, nullable                  -- Purpose of this subscription role
├── color               VARCHAR(20), default "#757575"  -- UI badge color
├── permissions         JSONB, NOT NULL, default '{}'   -- fact-sheet-level permission map (see §3.3)
├── is_archived         BOOLEAN, default false          -- soft-delete: hidden from assignment, preserved in history
├── sort_order          INTEGER, default 0              -- display ordering
├── created_at          TIMESTAMPTZ, server_default now()
├── updated_at          TIMESTAMPTZ, server_default now(), onupdate now()
├── archived_at         TIMESTAMPTZ, nullable           -- when the role was archived
├── archived_by         UUID, FK → users.id, nullable   -- who archived it
└── UNIQUE(fact_sheet_type_key, key)
```

**Constraints**:
- `key` must match `^[a-z][a-z0-9_]{1,48}[a-z0-9]$` and be unique within a given `fact_sheet_type_key`.
- `key` is immutable after creation.
- Archived subscription roles are excluded from subscription assignment dropdowns.
- Existing subscriptions referencing an archived role remain valid. The UI shows these with a muted/strikethrough badge.
- Archiving is not allowed if the role is used in an active BPM approval workflow (optional — can be relaxed to just show a warning).

**Seed data** (migration): Migrate from the existing `FactSheetType.subscription_roles` JSONB. For each fact sheet type, each `{key, label}` object becomes a row with default permissions (see §3.3).

**Deprecation**: After migration, the `FactSheetType.subscription_roles` JSONB column becomes **read-only / deprecated**. All subscription role management is done via the new table. The column can be dropped in a future migration once all code references are updated, or kept as a denormalized cache that is synced on writes.

#### 3.1.3 Modified Table: `users`

```diff
 class User:
-    role: str  # "admin" / "bpm_admin" / "member" / "viewer"
+    role_key: str  # FK → roles.key, NOT NULL, default "member"
```

- Rename column `role` → `role_key` (or keep as `role` if migration is simpler — see §6).
- Add FK constraint to `roles.key`.
- Migration: existing `role` values map 1:1 to the seeded role keys.

#### 3.1.4 Unchanged: `subscriptions`

The existing `Subscription` model stays as-is. Its `role` column continues to hold the subscription role key (e.g. `"responsible"`), validated against the `subscription_role_definitions` table (only non-archived roles are valid for new assignments). The `subscription_role_definitions` table provides both the role metadata and the permission semantics.

#### 3.1.5 Deprecated: `fact_sheet_types.subscription_roles`

This JSONB array of `{key, label}` objects is replaced by the `subscription_role_definitions` table. During migration, existing data is copied to the new table. The column is kept temporarily as a read-only cache for backward compatibility and can be dropped in a subsequent migration. All new code must read from `subscription_role_definitions` instead.

---

### 3.2 App-Level Permissions

The `roles.permissions` JSONB stores a flat map of permission keys → boolean values.

```typescript
// TypeScript type for the permissions object
type AppPermissions = {
  // Wildcard (admin only)
  "*"?: boolean;

  // --- Inventory Module ---
  "inventory.view": boolean;          // View fact sheet lists and detail pages
  "inventory.create": boolean;        // Create new fact sheets
  "inventory.edit": boolean;          // Edit any fact sheet (overrides subscription-level)
  "inventory.delete": boolean;        // Delete / archive fact sheets
  "inventory.export": boolean;        // Export CSV / Excel
  "inventory.quality_seal": boolean;  // Approve / reject / reset quality seal on any FS
  "inventory.bulk_edit": boolean;     // Bulk update fact sheets

  // --- Relations ---
  "relations.view": boolean;          // View relations between fact sheets
  "relations.manage": boolean;        // Create / edit / delete relations

  // --- Subscriptions ---
  "subscriptions.view": boolean;      // View who is subscribed to a fact sheet
  "subscriptions.manage": boolean;    // Add / remove subscriptions on any fact sheet

  // --- Comments ---
  "comments.view": boolean;           // View comments
  "comments.create": boolean;         // Post new comments
  "comments.manage": boolean;         // Edit / delete any comment (not just own)

  // --- Documents ---
  "documents.view": boolean;          // View document links
  "documents.manage": boolean;        // Add / remove documents on any fact sheet

  // --- Diagrams ---
  "diagrams.view": boolean;           // View free-draw diagrams
  "diagrams.manage": boolean;         // Create / edit / delete diagrams

  // --- BPM Module ---
  "bpm.view": boolean;                // View process diagrams, elements, published flows
  "bpm.edit": boolean;                // Edit process diagrams and elements
  "bpm.manage_drafts": boolean;       // Create / edit / delete BPMN flow drafts
  "bpm.approve_flows": boolean;       // Approve / reject submitted BPMN flow versions
  "bpm.assessments": boolean;         // Create / edit / delete process assessments

  // --- Reports ---
  "reports.ea_dashboard": boolean;    // View EA dashboard & reports
  "reports.bpm_dashboard": boolean;   // View BPM dashboard & reports
  "reports.portfolio": boolean;       // View portfolio / cost reports

  // --- Surveys ---
  "surveys.respond": boolean;         // Respond to surveys
  "surveys.manage": boolean;          // Create / edit / delete surveys, view results

  // --- SoAW (Statement of Architecture Work) ---
  "soaw.view": boolean;               // View SoAW documents
  "soaw.manage": boolean;             // Create / edit SoAW documents
  "soaw.sign": boolean;               // Sign / approve SoAW documents

  // --- Tags ---
  "tags.manage": boolean;             // Create / edit / delete tag groups and tags

  // --- Bookmarks ---
  "bookmarks.manage": boolean;        // Always true — users manage own bookmarks

  // --- EOL (End of Life) ---
  "eol.view": boolean;                // View EOL data
  "eol.manage": boolean;              // Run EOL searches, link EOL data to fact sheets

  // --- Web Portals ---
  "web_portals.view": boolean;        // View published web portals
  "web_portals.manage": boolean;      // Create / edit / delete web portals

  // --- Notifications ---
  "notifications.manage": boolean;    // Always true — users manage own notifications

  // --- Admin ---
  "admin.users": boolean;             // Manage users (create, edit roles, deactivate)
  "admin.roles": boolean;             // Manage role definitions and permissions
  "admin.metamodel": boolean;         // Manage fact sheet types, fields, relation types
  "admin.settings": boolean;          // Manage app settings (email, logo, SSO)
  "admin.events": boolean;            // View audit trail / event stream
};
```

**Default permission sets for migrated roles**:

| Permission | admin | bpm_admin | member | viewer |
|-----------|:-----:|:---------:|:------:|:------:|
| `*` (wildcard) | ✅ | — | — | — |
| `inventory.view` | — | ✅ | ✅ | ✅ |
| `inventory.create` | — | ✅ | ✅ | — |
| `inventory.edit` | — | ✅ | ✅ | — |
| `inventory.delete` | — | ✅ | ✅ | — |
| `inventory.export` | — | ✅ | ✅ | ✅ |
| `inventory.quality_seal` | — | ✅ | ✅ | — |
| `inventory.bulk_edit` | — | ✅ | ✅ | — |
| `relations.view` | — | ✅ | ✅ | ✅ |
| `relations.manage` | — | ✅ | ✅ | — |
| `subscriptions.view` | — | ✅ | ✅ | ✅ |
| `subscriptions.manage` | — | ✅ | ✅ | — |
| `comments.view` | — | ✅ | ✅ | ✅ |
| `comments.create` | — | ✅ | ✅ | — |
| `comments.manage` | — | — | — | — |
| `documents.view` | — | ✅ | ✅ | ✅ |
| `documents.manage` | — | ✅ | ✅ | — |
| `diagrams.view` | — | ✅ | ✅ | ✅ |
| `diagrams.manage` | — | ✅ | ✅ | — |
| `bpm.view` | — | ✅ | ✅ | ✅ |
| `bpm.edit` | — | ✅ | ✅ | — |
| `bpm.manage_drafts` | — | ✅ | ✅ | — |
| `bpm.approve_flows` | — | ✅ | — | — |
| `bpm.assessments` | — | ✅ | ✅ | — |
| `reports.ea_dashboard` | — | ✅ | ✅ | ✅ |
| `reports.bpm_dashboard` | — | ✅ | ✅ | ✅ |
| `reports.portfolio` | — | ✅ | ✅ | ✅ |
| `surveys.respond` | — | ✅ | ✅ | ✅ |
| `surveys.manage` | — | — | — | — |
| `soaw.view` | — | ✅ | ✅ | ✅ |
| `soaw.manage` | — | ✅ | ✅ | — |
| `soaw.sign` | — | ✅ | ✅ | — |
| `tags.manage` | — | ✅ | ✅ | — |
| `bookmarks.manage` | — | ✅ | ✅ | ✅ |
| `eol.view` | — | ✅ | ✅ | ✅ |
| `eol.manage` | — | ✅ | ✅ | — |
| `web_portals.view` | — | ✅ | ✅ | ✅ |
| `web_portals.manage` | — | — | — | — |
| `admin.users` | — | — | — | — |
| `admin.roles` | — | — | — | — |
| `admin.metamodel` | — | — | — | — |
| `admin.settings` | — | — | — | — |
| `admin.events` | — | — | — | — |

---

### 3.3 Fact-Sheet-Level Permissions

The `subscription_role_definitions.permissions` JSONB stores a flat map of fact-sheet-scoped permission keys → boolean values. These permissions only apply when a user has a subscription with the corresponding role on a specific fact sheet.

```typescript
type FactSheetPermissions = {
  "fs.view": boolean;             // View this fact sheet's detail page
  "fs.edit": boolean;             // Edit this fact sheet's fields, name, description, lifecycle
  "fs.delete": boolean;           // Delete / archive this fact sheet
  "fs.quality_seal": boolean;     // Approve / reject / reset quality seal
  "fs.manage_subscriptions": boolean; // Add / remove other users' subscriptions
  "fs.manage_relations": boolean; // Add / remove relations on this fact sheet
  "fs.manage_documents": boolean; // Add / remove document links
  "fs.manage_comments": boolean;  // Delete any comment (not just own)
  "fs.create_comments": boolean;  // Post comments on this fact sheet
  "fs.bpm_edit": boolean;         // Edit BPM diagram / elements (process types only)
  "fs.bpm_manage_drafts": boolean;// Create / edit / submit BPMN flow drafts
  "fs.bpm_approve": boolean;      // Approve / reject submitted BPMN flow versions
};
```

**Default permission sets for migrated subscription roles**:

| Permission | responsible | observer | process_owner | technical_application_owner | business_application_owner |
|-----------|:-----------:|:--------:|:-------------:|:--------------------------:|:--------------------------:|
| `fs.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `fs.edit` | ✅ | — | ✅ | ✅ | ✅ |
| `fs.delete` | ✅ | — | — | — | — |
| `fs.quality_seal` | ✅ | — | ✅ | — | — |
| `fs.manage_subscriptions` | ✅ | — | ✅ | — | — |
| `fs.manage_relations` | ✅ | — | ✅ | ✅ | ✅ |
| `fs.manage_documents` | ✅ | — | ✅ | ✅ | ✅ |
| `fs.manage_comments` | ✅ | — | — | — | — |
| `fs.create_comments` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `fs.bpm_edit` | ✅ | — | ✅ | — | — |
| `fs.bpm_manage_drafts` | ✅ | — | ✅ | — | — |
| `fs.bpm_approve` | — | — | ✅ | — | — |

---

### 3.4 Permission Resolution Logic

When checking if a user can perform an action on a resource, the system evaluates **two tiers** and returns `true` if **either** grants access:

```
can_user_do(user, action, fact_sheet?) → boolean:

  1. Check app-level role permissions:
     role = load_role(user.role_key)
     if role.permissions["*"] == true → return true        // admin wildcard
     if role.permissions[action] == true → return true     // direct app-level grant

  2. If fact_sheet is provided, check fact-sheet-level permissions:
     subscriptions = load_subscriptions(user.id, fact_sheet.id)
     for each subscription:
       fs_perms = load_subscription_role_definition(fact_sheet.type, subscription.role)
       if fs_perms.permissions[fs_action] == true → return true

  3. return false
```

**Mapping from app-level to fact-sheet-level actions** (when both apply):

| App-Level Permission | Fact-Sheet-Level Equivalent | Effect |
|---------------------|---------------------------|--------|
| `inventory.edit` | `fs.edit` | App-level grants edit on ALL fact sheets |
| `inventory.delete` | `fs.delete` | App-level grants delete on ALL fact sheets |
| `inventory.quality_seal` | `fs.quality_seal` | App-level grants seal on ALL fact sheets |
| `subscriptions.manage` | `fs.manage_subscriptions` | App-level grants subscription management on ALL |
| `relations.manage` | `fs.manage_relations` | App-level grants relation management on ALL |
| `documents.manage` | `fs.manage_documents` | App-level grants document management on ALL |
| `comments.manage` | `fs.manage_comments` | App-level grants comment management on ALL |
| `comments.create` | `fs.create_comments` | App-level grants commenting on ALL |
| `bpm.edit` | `fs.bpm_edit` | App-level grants BPM editing on ALL processes |
| `bpm.manage_drafts` | `fs.bpm_manage_drafts` | App-level grants draft management on ALL |
| `bpm.approve_flows` | `fs.bpm_approve` | App-level grants approval on ALL |

---

## 4. Backend Implementation

### 4.1 New Model: `Role` (`backend/app/models/role.py`)

```python
class Role(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "roles"

    key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    color: Mapped[str] = mapped_column(String(20), default="#757575")
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
```

### 4.2 New Model: `SubscriptionRoleDefinition` (`backend/app/models/subscription_role_definition.py`)

```python
class SubscriptionRoleDefinition(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "subscription_role_definitions"
    __table_args__ = (
        UniqueConstraint("fact_sheet_type_key", "key"),
    )

    fact_sheet_type_key: Mapped[str] = mapped_column(
        String(100), ForeignKey("fact_sheet_types.key", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(20), default="#757575")
    permissions: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
```

### 4.3 Permission Service (`backend/app/services/permission_service.py`)

Create a centralized service that all routes use for authorization. This replaces the scattered `require_admin()`, `require_bpm_admin()`, and inline role checks.

```python
class PermissionService:
    """Centralized permission checking. All route handlers should use this."""

    @staticmethod
    async def load_role(db: AsyncSession, role_key: str) -> Role:
        """Load role with caching (cache invalidated on role update)."""
        ...

    @staticmethod
    async def has_app_permission(db: AsyncSession, user: User, permission: str) -> bool:
        """Check if user's app-level role grants the given permission."""
        role = await PermissionService.load_role(db, user.role_key)
        if role.permissions.get("*"):
            return True
        return role.permissions.get(permission, False)

    @staticmethod
    async def has_fs_permission(
        db: AsyncSession, user: User, fact_sheet_id: UUID, permission: str
    ) -> bool:
        """Check if user has permission on a specific fact sheet via subscription."""
        subs = await db.execute(
            select(Subscription.role).where(
                Subscription.fact_sheet_id == fact_sheet_id,
                Subscription.user_id == user.id,
            )
        )
        fs_type = await db.execute(
            select(FactSheet.type).where(FactSheet.id == fact_sheet_id)
        )
        type_key = fs_type.scalar_one_or_none()
        if not type_key:
            return False

        for (sub_role,) in subs.all():
            srd = await db.execute(
                select(SubscriptionRoleDefinition.permissions).where(
                    SubscriptionRoleDefinition.fact_sheet_type_key == type_key,
                    SubscriptionRoleDefinition.key == sub_role,
                    SubscriptionRoleDefinition.is_archived == False,  # archived roles grant no permissions
                )
            )
            perms = srd.scalar_one_or_none()
            if perms and perms.get(permission, False):
                return True
        return False

    @staticmethod
    async def check_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        fact_sheet_id: UUID | None = None,
        fs_permission: str | None = None,
    ) -> bool:
        """Combined check: returns True if app-level OR fact-sheet-level grants access."""
        if await PermissionService.has_app_permission(db, user, app_permission):
            return True
        if fact_sheet_id and fs_permission:
            return await PermissionService.has_fs_permission(
                db, user, fact_sheet_id, fs_permission
            )
        return False

    @staticmethod
    async def require_permission(
        db: AsyncSession,
        user: User,
        app_permission: str,
        fact_sheet_id: UUID | None = None,
        fs_permission: str | None = None,
    ) -> None:
        """Raise 403 if permission check fails."""
        if not await PermissionService.check_permission(
            db, user, app_permission, fact_sheet_id, fs_permission
        ):
            raise HTTPException(403, f"Insufficient permissions")
```

### 4.4 FastAPI Dependencies (`backend/app/api/deps.py`)

Update to use the new permission service. Keep backward-compatible helpers during migration.

```python
# New: generic permission dependency factory
def require_permission(app_perm: str):
    """Dependency that checks a single app-level permission."""
    async def _check(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
        await PermissionService.require_permission(db, user, app_perm)
        return user
    return _check

# Backward-compatible (mark as deprecated, remove after full migration):
async def require_admin(user: User = Depends(get_current_user), db = Depends(get_db)):
    await PermissionService.require_permission(db, user, "admin.users")

# New: fact-sheet-scoped permission check (used as a utility, not a dependency)
# Route handlers call PermissionService.require_permission() directly with the fact_sheet_id.
```

### 4.5 New API Routes: Role Management (`backend/app/api/v1/roles.py`)

```
GET    /api/v1/roles                          → List all roles (any authenticated user)
                                                 Query params: include_archived=false (default)
GET    /api/v1/roles/{key}                    → Get role details + permissions
POST   /api/v1/roles                          → Create custom role (requires admin.roles)
PATCH  /api/v1/roles/{key}                    → Update role label, description, color, permissions
POST   /api/v1/roles/{key}/archive            → Archive a role (soft-delete, requires admin.roles)
POST   /api/v1/roles/{key}/restore            → Restore an archived role (requires admin.roles)
GET    /api/v1/roles/permissions-schema        → Return the full permission key catalog with labels/descriptions
```

**Create role request body**:
```json
{
  "key": "ea_architect",
  "label": "Enterprise Architect",
  "description": "Can manage all EA inventory but not admin functions",
  "color": "#2196F3",
  "permissions": {
    "inventory.view": true,
    "inventory.create": true,
    "inventory.edit": true,
    "inventory.delete": true,
    "inventory.export": true,
    "inventory.quality_seal": true,
    "relations.view": true,
    "relations.manage": true,
    "reports.ea_dashboard": true,
    "reports.portfolio": true,
    "diagrams.view": true,
    "diagrams.manage": true
  }
}
```

**Validation rules**:
- `key` must match `^[a-z][a-z0-9_]{1,48}[a-z0-9]$` and be unique.
- `key` is immutable after creation.
- Cannot archive a system role (`is_system = true`). Return 403.
- Cannot archive the current default role (`is_default = true`). Admin must reassign default first. Return 409.
- Cannot remove the `"*"` permission from the `admin` role.
- Setting `is_default = true` clears `is_default` on all other roles.
- Archiving sets `is_archived = true`, `archived_at = now()`, `archived_by = current_user.id`.
- Restoring sets `is_archived = false`, `archived_at = null`, `archived_by = null`.
- Archive response includes `affected_users_count` — how many users currently hold this role. The UI can use this to show a warning.

**Archive behavior**:
- Archived roles are excluded from all assignment dropdowns (user creation, user edit, SSO invitations).
- Users assigned to an archived role **keep it** and retain their permissions. This prevents accidental access revocation.
- The Users Admin page shows a warning badge (e.g. "⚠ Archived role") next to users with archived roles, prompting the admin to reassign.
- Archived roles appear in the Roles Admin list with a visual indicator (muted, strikethrough, or "Archived" badge) and can be filtered via `include_archived` query param.

### 4.6 New API Routes: Subscription Role Management (`backend/app/api/v1/subscription_roles.py`)

Full CRUD for fact-sheet-level subscription roles. Replaces the current approach of managing `{key, label}` objects inside the `FactSheetType.subscription_roles` JSONB via the metamodel patch endpoint.

```
GET    /api/v1/metamodel/types/{type_key}/subscription-roles
         → List subscription roles for a fact sheet type (with permissions)
           Query params: include_archived=false (default)

GET    /api/v1/metamodel/types/{type_key}/subscription-roles/{role_key}
         → Get a single subscription role with full permissions

POST   /api/v1/metamodel/types/{type_key}/subscription-roles
         → Create a new subscription role for a fact sheet type (requires admin.metamodel)

PATCH  /api/v1/metamodel/types/{type_key}/subscription-roles/{role_key}
         → Update label, description, color, permissions, sort_order

POST   /api/v1/metamodel/types/{type_key}/subscription-roles/{role_key}/archive
         → Archive a subscription role (requires admin.metamodel)

POST   /api/v1/metamodel/types/{type_key}/subscription-roles/{role_key}/restore
         → Restore an archived subscription role (requires admin.metamodel)

GET    /api/v1/subscription-roles/permissions-schema
         → Return the full FS-level permission key catalog with labels/descriptions
```

**Create subscription role request body**:
```json
{
  "key": "data_steward",
  "label": "Data Steward",
  "description": "Responsible for data quality and completeness",
  "color": "#4CAF50",
  "permissions": {
    "fs.view": true,
    "fs.edit": true,
    "fs.quality_seal": true,
    "fs.manage_relations": true,
    "fs.manage_documents": true,
    "fs.create_comments": true
  }
}
```

**Validation rules**:
- `key` must match `^[a-z][a-z0-9_]{1,48}[a-z0-9]$` and be unique within the fact sheet type.
- `key` is immutable after creation.
- Cannot archive a subscription role if there is no other active role on the type (at least one active role must exist per type).
- Archiving sets `is_archived = true`, `archived_at = now()`, `archived_by = current_user.id`.
- Archive response includes `affected_subscriptions_count` — how many active subscriptions use this role.
- Permission keys are validated against the `FS_PERMISSIONS` registry. Unknown keys are rejected.

**Archive behavior**:
- Archived subscription roles are excluded from the subscription assignment dropdown on fact sheet detail pages.
- Existing subscriptions with an archived role **remain valid** — the user retains their permissions until the subscription is manually removed or the role is reassigned.
- The fact sheet detail page shows subscriptions with archived roles using a muted/strikethrough badge.
- The subscription roles list in Metamodel Admin shows archived roles with a visual indicator.

**Backward compatibility**: The existing `GET /subscription-roles` and `POST /fact-sheets/{fs_id}/subscriptions` routes in `subscriptions.py` must be updated to read from `subscription_role_definitions` instead of `FactSheetType.subscription_roles` JSONB, and must filter out archived roles from the available roles list.

### 4.7 New API Route: User Effective Permissions

```
GET /api/v1/auth/me                     → Extend to include resolved permissions
GET /api/v1/auth/me/permissions          → Return full resolved permission set
GET /api/v1/fact-sheets/{fs_id}/my-permissions → Return user's effective permissions on a specific FS
```

**`GET /api/v1/auth/me` extended response**:
```json
{
  "id": "...",
  "email": "...",
  "display_name": "...",
  "role_key": "ea_architect",
  "role_label": "Enterprise Architect",
  "role_color": "#2196F3",
  "is_active": true,
  "permissions": {
    "inventory.view": true,
    "inventory.create": true,
    "inventory.edit": true,
    "...": "..."
  }
}
```

**`GET /api/v1/fact-sheets/{fs_id}/my-permissions` response**:
```json
{
  "app_level": {
    "inventory.edit": true,
    "inventory.delete": false
  },
  "subscription_roles": ["responsible"],
  "fs_level": {
    "fs.view": true,
    "fs.edit": true,
    "fs.delete": true,
    "fs.quality_seal": true
  },
  "effective": {
    "can_view": true,
    "can_edit": true,
    "can_delete": true,
    "can_quality_seal": true,
    "can_manage_subscriptions": true,
    "can_manage_relations": true,
    "can_manage_documents": true,
    "can_manage_comments": true,
    "can_create_comments": true,
    "can_bpm_edit": true,
    "can_bpm_manage_drafts": true,
    "can_bpm_approve": false
  }
}
```

### 4.8 Caching Strategy

Role permissions are read on every request. Implement in-memory caching with invalidation:

```python
# In PermissionService:
_role_cache: dict[str, tuple[Role, float]] = {}  # key → (role, timestamp)
CACHE_TTL = 300  # 5 minutes

@staticmethod
async def load_role(db: AsyncSession, role_key: str) -> Role:
    now = time.time()
    cached = PermissionService._role_cache.get(role_key)
    if cached and (now - cached[1]) < PermissionService.CACHE_TTL:
        return cached[0]
    role = await db.execute(select(Role).where(Role.key == role_key))
    role = role.scalar_one_or_none()
    if role:
        PermissionService._role_cache[role_key] = (role, now)
    return role

@staticmethod
def invalidate_cache(role_key: str | None = None):
    if role_key:
        PermissionService._role_cache.pop(role_key, None)
    else:
        PermissionService._role_cache.clear()
```

Call `invalidate_cache()` in the role PATCH/archive/restore handlers. Similarly, maintain a `_subscription_role_cache` with the same pattern, invalidated on subscription role CRUD operations.

### 4.9 Route Migration Checklist

Every route handler must be updated to use the new permission service. Below is the mapping from current enforcement to new permission keys:

| File | Current Check | New Permission Key |
|------|---------------|-------------------|
| `fact_sheets.py` — `GET /` | `get_current_user` (any auth) | `inventory.view` |
| `fact_sheets.py` — `POST /` | `get_current_user` | `inventory.create` |
| `fact_sheets.py` — `PATCH /{id}` | `get_current_user` | `inventory.edit` OR `fs.edit` |
| `fact_sheets.py` — `DELETE /{id}` | `get_current_user` | `inventory.delete` OR `fs.delete` |
| `fact_sheets.py` — `PATCH /bulk` | `get_current_user` | `inventory.bulk_edit` |
| `fact_sheets.py` — `POST /{id}/quality-seal` | `get_current_user` | `inventory.quality_seal` OR `fs.quality_seal` |
| `fact_sheets.py` — `POST /fix-hierarchy-names` | **NO AUTH** ⚠️ | `admin.metamodel` |
| `fact_sheets.py` — `GET /export/csv` | `get_current_user` | `inventory.export` |
| `relations.py` — `POST /` | `get_current_user` | `relations.manage` |
| `relations.py` — `DELETE /{id}` | `get_current_user` | `relations.manage` |
| `comments.py` — `GET /` | `get_current_user` | `comments.view` |
| `comments.py` — `POST /` | `get_current_user` | `comments.create` OR `fs.create_comments` |
| `comments.py` — `PATCH /{id}` | Own comment only | Own comment OR `comments.manage` OR `fs.manage_comments` |
| `comments.py` — `DELETE /{id}` | Own comment only | Own comment OR `comments.manage` OR `fs.manage_comments` |
| `documents.py` — `GET /` | **NO AUTH** ⚠️ | `documents.view` |
| `documents.py` — `POST /` | `get_current_user` | `documents.manage` OR `fs.manage_documents` |
| `documents.py` — `DELETE /{id}` | `get_current_user` | `documents.manage` OR `fs.manage_documents` |
| `subscriptions.py` — `GET /` | No auth | `subscriptions.view` |
| `subscriptions.py` — `POST /` | `get_current_user` | `subscriptions.manage` OR `fs.manage_subscriptions` |
| `subscriptions.py` — `DELETE /{id}` | `get_current_user` | `subscriptions.manage` OR `fs.manage_subscriptions` |
| `diagrams.py` — `GET /` | `get_current_user` | `diagrams.view` |
| `diagrams.py` — `POST /` | `get_current_user` | `diagrams.manage` |
| `diagrams.py` — `PATCH /{id}` | `get_current_user` | `diagrams.manage` |
| `diagrams.py` — `DELETE /{id}` | `get_current_user` | `diagrams.manage` |
| `bpm.py` — all routes | `get_current_user` | `bpm.view` / `bpm.edit` as appropriate |
| `bpm_workflow.py` — all routes | Custom subscription checks | Migrate to `PermissionService` with both tiers |
| `bpm_assessments.py` — all routes | `get_current_user` | `bpm.assessments` |
| `bpm_reports.py` — all routes | **NO AUTH** ⚠️ | `reports.bpm_dashboard` |
| `reports.py` — all routes | **NO AUTH** ⚠️ | `reports.ea_dashboard` / `reports.portfolio` |
| `metamodel.py` — all routes | **NO AUTH** ⚠️ | `admin.metamodel` |
| `events.py` — all routes | **NO AUTH** ⚠️ | `admin.events` |
| `settings.py` — all routes | `require_admin` | `admin.settings` |
| `users.py` — CRUD | `require_admin` for create/update/delete | `admin.users` |
| `users.py` — list/get | `get_current_user` | Any authenticated user (for user pickers) |
| `soaw.py` — view routes | `get_current_user` | `soaw.view` |
| `soaw.py` — edit routes | `get_current_user` | `soaw.manage` |
| `soaw.py` — sign routes | `get_current_user` | `soaw.sign` |
| `surveys.py` — respond | `get_current_user` | `surveys.respond` |
| `surveys.py` — manage | `get_current_user` | `surveys.manage` |
| `tags.py` — all routes | `get_current_user` | `tags.manage` |
| `web_portals.py` — view | `get_current_user` / public | `web_portals.view` (or public) |
| `web_portals.py` — manage | `require_admin` | `web_portals.manage` |
| `eol.py` — view | No auth | `eol.view` |
| `eol.py` — manage | No auth | `eol.manage` |
| `bookmarks.py` — all | `get_current_user` | `bookmarks.manage` (always own) |

---

## 5. Frontend Implementation

### 5.1 Permission Context (`frontend/src/hooks/usePermissions.ts`)

Create a React context/hook that loads the user's resolved permissions on login and makes them available throughout the app.

```typescript
interface PermissionContext {
  // App-level permissions (from /auth/me response)
  permissions: Record<string, boolean>;

  // Check a single permission
  can: (permission: string) => boolean;

  // Check if user can perform action on a specific fact sheet
  // (requires loading FS-level permissions)
  canOnFs: (fsId: string, permission: string) => Promise<boolean>;

  // Preloaded FS permissions (cached after first load per FS)
  fsPermissions: Record<string, FactSheetEffectivePermissions>;
  loadFsPermissions: (fsId: string) => Promise<void>;
}
```

### 5.2 UI Permission Gating

Use the `can()` helper to conditionally render UI elements.

```tsx
// Example: Fact Sheet Detail page
const { can, fsPermissions, loadFsPermissions } = usePermissions();

useEffect(() => { loadFsPermissions(fsId); }, [fsId]);

const fsPerms = fsPermissions[fsId];

return (
  <>
    {/* Edit button only if user has app-level OR fs-level edit */}
    {(can("inventory.edit") || fsPerms?.can_edit) && (
      <Button onClick={handleEdit}>Edit</Button>
    )}

    {/* Quality seal only if permitted */}
    {(can("inventory.quality_seal") || fsPerms?.can_quality_seal) && (
      <QualitySealControls />
    )}

    {/* Delete button */}
    {(can("inventory.delete") || fsPerms?.can_delete) && (
      <Button color="error" onClick={handleDelete}>Delete</Button>
    )}

    {/* Comment input */}
    {(can("comments.create") || fsPerms?.can_create_comments) && (
      <CommentInput />
    )}
  </>
);
```

### 5.3 Navigation / Sidebar Gating

Hide sidebar items and admin routes based on app-level permissions:

```typescript
const navItems = [
  { label: "Inventory", path: "/inventory", permission: "inventory.view" },
  { label: "Reports", path: "/reports", permission: "reports.ea_dashboard" },
  { label: "BPM", path: "/bpm", permission: "bpm.view" },
  { label: "Diagrams", path: "/diagrams", permission: "diagrams.view" },
  { label: "Surveys", path: "/surveys", permission: "surveys.respond" },
].filter(item => can(item.permission));

const adminItems = [
  { label: "Users", path: "/admin/users", permission: "admin.users" },
  { label: "Roles", path: "/admin/roles", permission: "admin.roles" },
  { label: "Metamodel", path: "/admin/metamodel", permission: "admin.metamodel" },
  { label: "Settings", path: "/admin/settings", permission: "admin.settings" },
  { label: "Audit Log", path: "/admin/events", permission: "admin.events" },
].filter(item => can(item.permission));
```

### 5.4 Admin UI: Role Management Page (`/admin/roles`)

**New page: `frontend/src/features/admin/RolesAdmin.tsx`**

Design as a two-panel layout:

- **Left panel**: List of roles (sortable, with color badges). Add Role button at top.
- **Right panel**: Selected role details + permission editor.

**Permission editor layout**: Group permissions by module, display as a matrix of checkboxes. Include archive/restore controls.

```
┌──────────────────────────────────────────────────────────────┐
│ Roles                                        [+ New Role]    │
├────────────────┬─────────────────────────────────────────────┤
│ ████ Admin     │ Role: Enterprise Architect          [Save]  │
│ ████ BPM Admin │ Key: ea_architect (read-only after create)  │
│ ████ Member    │ Label: [Enterprise Architect             ]  │
│ ████ Viewer    │ Description: [Can manage all EA inven... ]  │
│ ████ EA Arch.  │ Color: ████ [#2196F3]  │  Default: ☐       │
│ ░░░░ Contrib.  │                                             │
│   (archived)   │ Status: ● Active           [Archive Role]   │
│                ├─────────────────────────────────────────────┤
│ ☑ Show archived│                                             │
│                │ ▼ Inventory                  [Toggle All]    │
│                │   ☑ View        ☑ Create    ☑ Edit          │
│                │   ☑ Delete      ☑ Export    ☑ Quality seal   │
│                │   ☑ Bulk edit                                │
│                │                                             │
│                │ ▼ BPM                        [Toggle All]    │
│                │   ☑ View        ☐ Edit      ☐ Manage drafts │
│                │   ☐ Approve     ☐ Assessments               │
│                │                                             │
│                │ ▼ Reports                    [Toggle All]    │
│                │   ☑ EA Dashboard ☑ BPM Dash ☑ Portfolio     │
│                │                                             │
│                │ ▼ Admin                      [Toggle All]    │
│                │   ☐ Users  ☐ Roles  ☐ Metamodel             │
│                │   ☐ Settings  ☐ Audit log                   │
│                │                                             │
│                │ ──────────────────────────────               │
│                │ Users with this role: 12                     │
│                │ (warning if archived + users still assigned) │
└────────────────┴─────────────────────────────────────────────┘
```

When viewing an **archived** role, the right panel shows:
- Status: `● Archived on 2026-02-14 by John Doe` with a `[Restore Role]` button.
- Permission checkboxes are read-only (greyed out).
- A warning: "3 users still have this role assigned. Reassign them to remove the warning."
```

### 5.5 Admin UI: Fact Sheet Type — Subscription Role Management

Extend the existing Metamodel Admin page. Replace the current simple `{key, label}` add/remove UI with a full subscription role management panel, including creation, permission editing, and archiving.

**New page section: `MetamodelAdmin.tsx` → Subscription Roles tab per type**

```
┌──────────────────────────────────────────────────────────────┐
│ Application — Subscription Roles              [+ New Role]   │
├──────────────┬───────────────────────────────────────────────┤
│              │                                               │
│ ████ Respons.│ Role: Technical Application Owner     [Save]  │
│ ████ Observer│ Key: technical_application_owner (read-only)  │
│ ████ Tech Ow.│ Label: [Technical Application Owner       ]  │
│ ████ Biz Own.│ Description: [Manages technical aspects.. ]  │
│ ████ Proc Ow.│ Color: ████ [#FF9800]                        │
│ ░░░░ Legacy  │                                               │
│  (archived)  │ Status: ● Active        [Archive Role]       │
│              ├───────────────────────────────────────────────┤
│ ☑ Show arch. │                                               │
│              │ Permissions:                                  │
│              │   ☑ View              ☑ Edit                  │
│              │   ☐ Delete            ☐ Quality Seal          │
│              │   ☐ Manage Subs       ☑ Manage Relations      │
│              │   ☑ Manage Docs       ☐ Manage Comments       │
│              │   ☑ Create Comments   ☐ BPM Edit              │
│              │   ☐ BPM Drafts        ☐ BPM Approve           │
│              │                                               │
│              │ ─────────────────────────────────              │
│              │ Active subscriptions using this role: 47      │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

**Permission matrix view** (alternative — toggled via a "Matrix View" button at the top):

Shows all subscription roles for a type side-by-side in a grid:

```
┌──────────────────────────────────────────────────────────────┐
│ Application — Subscription Role Permissions    [Matrix View] │
├──────────────┬───────┬────────┬──────┬─────────┬────────────┤
│ Permission   │Respons│Observer│Tech  │Business │Process     │
│              │ible   │        │Owner │Owner    │Owner       │
├──────────────┼───────┼────────┼──────┼─────────┼────────────┤
│ View         │  ☑    │   ☑   │  ☑   │   ☑    │     ☑      │
│ Edit         │  ☑    │   ☐   │  ☑   │   ☑    │     ☑      │
│ Delete       │  ☑    │   ☐   │  ☐   │   ☐    │     ☐      │
│ Quality Seal │  ☑    │   ☐   │  ☐   │   ☐    │     ☑      │
│ Manage Subs  │  ☑    │   ☐   │  ☐   │   ☐    │     ☑      │
│ Manage Rels  │  ☑    │   ☐   │  ☑   │   ☑    │     ☑      │
│ Manage Docs  │  ☑    │   ☐   │  ☑   │   ☑    │     ☑      │
│ Manage Cmts  │  ☑    │   ☐   │  ☐   │   ☐    │     ☐      │
│ Create Cmts  │  ☑    │   ☑   │  ☑   │   ☑    │     ☑      │
│ BPM Edit     │  ☑    │   ☐   │  ☐   │   ☐    │     ☑      │
│ BPM Drafts   │  ☑    │   ☐   │  ☐   │   ☐    │     ☑      │
│ BPM Approve  │  ☐    │   ☐   │  ☐   │   ☐    │     ☑      │
└──────────────┴───────┴────────┴──────┴─────────┴────────────┘
  Archived roles are hidden in matrix view (or shown muted if "Show archived" is checked)
```

**Create subscription role dialog** (triggered by `[+ New Role]` button):

```
┌────────────────────────────────────────────┐
│ Create Subscription Role for "Application" │
├────────────────────────────────────────────┤
│ Key:         [data_steward              ]  │
│ Label:       [Data Steward              ]  │
│ Description: [Responsible for data...   ]  │
│ Color:       ████ [#4CAF50]                │
│                                            │
│ Start from template:                       │
│   ○ Blank (no permissions)                 │
│   ○ Copy from: [Responsible         ▼]    │
│                                            │
│              [Cancel]  [Create & Configure] │
└────────────────────────────────────────────┘
```

After creation, the admin is taken to the permission editor for the new role.

### 5.6 Updated User Type

```typescript
export interface User {
  id: string;
  email: string;
  display_name: string;
  role_key: string;           // was: role
  role_label: string;         // new: resolved from roles table
  role_color: string;         // new: for UI badges
  is_active: boolean;
  permissions: Record<string, boolean>;  // new: resolved app-level permissions
}
```

### 5.7 User Admin Page Updates

In `UsersAdmin.tsx`, replace the hardcoded role dropdown with a dynamic list fetched from `GET /api/v1/roles`:

```tsx
// Before:
<MenuItem value="admin">Admin</MenuItem>
<MenuItem value="bpm_admin">BPM Admin</MenuItem>
<MenuItem value="member">Member</MenuItem>
<MenuItem value="viewer">Viewer</MenuItem>

// After:
{roles.map(role => (
  <MenuItem key={role.key} value={role.key}>
    <Chip size="small" sx={{ bgcolor: role.color, color: '#fff', mr: 1 }} label={role.key} />
    {role.label}
  </MenuItem>
))}
```

---

## 6. Database Migration

### 6.1 Alembic Migration Script

```python
"""Add RBAC: roles table, subscription_role_definitions table, migrate user roles.

Revision ID: xxxx
"""

def upgrade():
    # 1. Create roles table (with archive support)
    op.create_table("roles", ...)

    # 2. Seed system/default roles with permission maps
    op.execute("""
        INSERT INTO roles (id, key, label, is_system, is_default, is_archived, color, permissions, sort_order)
        VALUES
        (gen_random_uuid(), 'admin', 'Administrator', true, false, false, '#d32f2f',
         '{"*": true}'::jsonb, 0),
        (gen_random_uuid(), 'bpm_admin', 'BPM Administrator', false, false, false, '#7B1FA2',
         '{"inventory.view": true, "inventory.create": true, ...}'::jsonb, 1),
        (gen_random_uuid(), 'member', 'Member', false, true, false, '#1976d2',
         '{"inventory.view": true, "inventory.create": true, ...}'::jsonb, 2),
        (gen_random_uuid(), 'viewer', 'Viewer', false, false, false, '#757575',
         '{"inventory.view": true, "inventory.export": true, ...}'::jsonb, 3);
    """)

    # 3. Create subscription_role_definitions table (with archive support)
    op.create_table("subscription_role_definitions", ...)

    # 4. Migrate existing subscription roles from FactSheetType JSONB → subscription_role_definitions
    # For each fact sheet type, each {key, label} object becomes a row with default permissions
    op.execute("""
        INSERT INTO subscription_role_definitions
            (id, fact_sheet_type_key, key, label, color, permissions, is_archived, sort_order)
        SELECT
            gen_random_uuid(),
            fst.key,
            role_obj->>'key',
            role_obj->>'label',
            '#757575',
            CASE role_obj->>'key'
                WHEN 'responsible' THEN '{"fs.view": true, "fs.edit": true, "fs.delete": true,
                    "fs.quality_seal": true, "fs.manage_subscriptions": true,
                    "fs.manage_relations": true, "fs.manage_documents": true,
                    "fs.manage_comments": true, "fs.create_comments": true,
                    "fs.bpm_edit": true, "fs.bpm_manage_drafts": true}'::jsonb
                WHEN 'observer' THEN '{"fs.view": true, "fs.create_comments": true}'::jsonb
                WHEN 'process_owner' THEN '{"fs.view": true, "fs.edit": true,
                    "fs.quality_seal": true, "fs.manage_subscriptions": true,
                    "fs.manage_relations": true, "fs.manage_documents": true,
                    "fs.create_comments": true, "fs.bpm_edit": true,
                    "fs.bpm_manage_drafts": true, "fs.bpm_approve": true}'::jsonb
                WHEN 'technical_application_owner' THEN '{"fs.view": true, "fs.edit": true,
                    "fs.manage_relations": true, "fs.manage_documents": true,
                    "fs.create_comments": true}'::jsonb
                WHEN 'business_application_owner' THEN '{"fs.view": true, "fs.edit": true,
                    "fs.manage_relations": true, "fs.manage_documents": true,
                    "fs.create_comments": true}'::jsonb
                ELSE '{"fs.view": true}'::jsonb
            END,
            false,
            (row_number() OVER (PARTITION BY fst.key ORDER BY role_obj->>'key'))::int
        FROM fact_sheet_types fst,
             jsonb_array_elements(fst.subscription_roles) role_obj
        WHERE fst.subscription_roles IS NOT NULL
          AND jsonb_array_length(fst.subscription_roles) > 0;
    """)

    # 5. Add FK from users.role to roles.key
    op.alter_column("users", "role", new_column_name="role_key")
    op.create_foreign_key("fk_users_role", "users", "roles", ["role_key"], ["key"])

def downgrade():
    op.drop_constraint("fk_users_role", "users", type_="foreignkey")
    op.alter_column("users", "role_key", new_column_name="role")
    op.drop_table("subscription_role_definitions")
    op.drop_table("roles")
```

### 6.2 Migration Safety

- **Zero-downtime**: The migration adds new tables and a FK. Existing `user.role` values already match the seeded role keys.
- **Rollback**: Downgrade reverses the FK and renames the column back. No data loss.
- **Column rename consideration**: If renaming `role` → `role_key` is too risky (breaks in-flight requests), keep the column as `role` and update only the model attribute name via `mapped_column("role", ...)`.

---

## 7. Permission Key Registry

Create a constant registry that serves as the single source of truth for all valid permission keys. Used for validation, the admin UI schema endpoint, and documentation.

```python
# backend/app/core/permissions.py

APP_PERMISSIONS = {
    "inventory": {
        "label": "Inventory",
        "permissions": {
            "inventory.view": "View fact sheet lists and detail pages",
            "inventory.create": "Create new fact sheets",
            "inventory.edit": "Edit any fact sheet (overrides subscription-level)",
            "inventory.delete": "Delete or archive fact sheets",
            "inventory.export": "Export CSV or Excel data",
            "inventory.quality_seal": "Approve, reject, or reset quality seal on any fact sheet",
            "inventory.bulk_edit": "Bulk update multiple fact sheets",
        },
    },
    "relations": {
        "label": "Relations",
        "permissions": {
            "relations.view": "View relations between fact sheets",
            "relations.manage": "Create, edit, and delete relations",
        },
    },
    # ... all other groups
}

FS_PERMISSIONS = {
    "fs.view": "View this fact sheet's detail page",
    "fs.edit": "Edit this fact sheet's fields, name, description, lifecycle",
    "fs.delete": "Delete or archive this fact sheet",
    "fs.quality_seal": "Approve, reject, or reset quality seal",
    "fs.manage_subscriptions": "Add or remove other users' subscriptions",
    "fs.manage_relations": "Add or remove relations on this fact sheet",
    "fs.manage_documents": "Add or remove document links",
    "fs.manage_comments": "Delete any comment (not just own)",
    "fs.create_comments": "Post comments on this fact sheet",
    "fs.bpm_edit": "Edit BPM diagram and elements (process types only)",
    "fs.bpm_manage_drafts": "Create, edit, and submit BPMN flow drafts",
    "fs.bpm_approve": "Approve or reject submitted BPMN flow versions",
}
```

---

## 8. JWT Token Changes

### 8.1 Token Payload Update

The JWT token currently embeds `role` as a string. Update to embed `role_key`:

```python
def create_access_token(user_id: UUID, role_key: str = "member") -> str:
    payload = {
        "sub": str(user_id),
        "role": role_key,  # Keep claim name as "role" for backward compat
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "iss": "turbo-ea",
        "aud": "turbo-ea",
    }
```

**Do NOT embed permissions in the JWT**. Permissions should be resolved server-side from the `roles` table. This ensures that permission changes take effect immediately without waiting for token refresh.

---

## 9. Implementation Order

### Phase 1: Foundation (Backend)
1. Create `Role` model and `SubscriptionRoleDefinition` model.
2. Write and run the Alembic migration (seed data + migrate from JSONB).
3. Implement `PermissionService` with caching.
4. Create `roles.py` API routes (CRUD + archive/restore for app-level roles).
5. Create `subscription_roles.py` API routes (CRUD + archive/restore for FS-level roles).
6. Update `deps.py` with new `require_permission()` factory.
7. Update `auth.py` — extend `/me` response with resolved permissions.

### Phase 2: Route Migration (Backend)
8. Migrate all route files to use `PermissionService` (see §4.9 checklist).
9. Update `users.py` to accept custom role keys instead of hardcoded strings.
10. Update `subscriptions.py` to read from `subscription_role_definitions` table.
11. Update `bpm_workflow.py` to use `PermissionService` instead of custom helpers.
12. Add `GET /fact-sheets/{fs_id}/my-permissions` endpoint.
13. Deprecate `FactSheetType.subscription_roles` JSONB reads in favor of new table.

### Phase 3: Frontend
14. Create `usePermissions` hook and context provider.
15. Update `User` type to include `role_key`, `role_label`, `role_color`, `permissions`.
16. Build `RolesAdmin.tsx` page (create, edit, archive/restore, permission matrix).
17. Extend `MetamodelAdmin.tsx` with subscription role management panel (create, edit, archive/restore, permission matrix and per-role editor).
18. Update `UsersAdmin.tsx` to use dynamic role list (filter archived), show warning badges.
19. Update `FactSheetDetail.tsx` subscription panel to use new API, filter archived roles from assignment dropdown.
20. Gate all UI elements using `can()` / `canOnFs()`.
21. Update sidebar/navigation with permission-based visibility.

### Phase 4: Testing & Hardening
22. Write backend tests for `PermissionService` (all tier 1 + tier 2 combinations).
23. Test role creation, editing, archive/restore edge cases.
24. Test subscription role creation, archive, and permission enforcement.
25. Test archived role behavior (users keep permissions, no new assignments).
26. Test migration rollback.
27. Verify no regression in BPM workflow permissions.

---

## 10. Security Considerations

1. **Always check permissions server-side.** Frontend gating is UX only — never trust the client.
2. **Admin role protection**: The `admin` system role must always retain the `"*"` wildcard. It cannot be archived. Prevent self-demotion (admin cannot change their own role away from admin if they are the last admin).
3. **Last admin guard**: Prevent role change of the last remaining admin user. There must always be at least one active user with the `admin` role.
4. **Permission inheritance is additive only**: A user's effective permissions are the union of their app-level role and all their fact-sheet subscriptions. There is no "deny" mechanism. This keeps the model simple and predictable.
5. **Archived roles still grant permissions**: Users assigned to an archived app-level role retain their permissions. Subscriptions with archived fact-sheet-level roles also retain their permissions. Archiving only prevents **new assignments**. This is by design — it prevents accidental mass access revocation. Admins should reassign users/subscriptions before or after archiving.
6. **Cache invalidation**: When an admin updates a role's permissions or archives/restores a role, all cached role data must be invalidated. Users will see updated permissions on their next API call.
7. **Audit trail**: Log all permission changes (role creation, role edits, role archive/restore, subscription role creation, permission changes) via the existing event system. Store the before/after state for accountability.
8. **Input validation**: Validate all permission keys against the registry (`APP_PERMISSIONS`, `FS_PERMISSIONS`). Reject unknown keys to prevent schema drift.
9. **Archive immutability**: Once a role is archived, its permissions become read-only in the UI. To modify permissions, an admin must first restore the role. This prevents confusion about whether archived roles' permissions are "live" or not.
10. **System role protection**: System roles (`is_system = true`) cannot be archived, renamed, or have their key changed. Only their permissions, label, description, and color can be modified (except for the admin wildcard which is locked).
