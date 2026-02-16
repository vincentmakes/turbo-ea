"""Permission key registry — single source of truth for all valid permission keys."""

from __future__ import annotations

# ---------------------------------------------------------------------------
# App-level permissions (stored in roles.permissions JSONB)
# ---------------------------------------------------------------------------

APP_PERMISSIONS: dict[str, dict] = {
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
    "subscriptions": {
        "label": "Subscriptions",
        "permissions": {
            "subscriptions.view": "View who is subscribed to a fact sheet",
            "subscriptions.manage": "Add or remove subscriptions on any fact sheet",
        },
    },
    "comments": {
        "label": "Comments",
        "permissions": {
            "comments.view": "View comments",
            "comments.create": "Post new comments",
            "comments.manage": "Edit or delete any comment (not just own)",
        },
    },
    "documents": {
        "label": "Documents",
        "permissions": {
            "documents.view": "View document links",
            "documents.manage": "Add or remove documents on any fact sheet",
        },
    },
    "diagrams": {
        "label": "Diagrams",
        "permissions": {
            "diagrams.view": "View free-draw diagrams",
            "diagrams.manage": "Create, edit, and delete diagrams",
        },
    },
    "bpm": {
        "label": "BPM",
        "permissions": {
            "bpm.view": "View process diagrams, elements, and published flows",
            "bpm.edit": "Edit process diagrams and elements",
            "bpm.manage_drafts": "Create, edit, and delete BPMN flow drafts",
            "bpm.approve_flows": "Approve or reject submitted BPMN flow versions",
            "bpm.assessments": "Create, edit, and delete process assessments",
        },
    },
    "reports": {
        "label": "Reports",
        "permissions": {
            "reports.ea_dashboard": "View EA dashboard and reports",
            "reports.bpm_dashboard": "View BPM dashboard and reports",
            "reports.portfolio": "View portfolio and cost reports",
        },
    },
    "surveys": {
        "label": "Surveys",
        "permissions": {
            "surveys.respond": "Respond to surveys",
            "surveys.manage": "Create, edit, and delete surveys, view results",
        },
    },
    "soaw": {
        "label": "SoAW",
        "permissions": {
            "soaw.view": "View SoAW documents",
            "soaw.manage": "Create and edit SoAW documents",
            "soaw.sign": "Sign and approve SoAW documents",
        },
    },
    "tags": {
        "label": "Tags",
        "permissions": {
            "tags.manage": "Create, edit, and delete tag groups and tags",
        },
    },
    "bookmarks": {
        "label": "Bookmarks",
        "permissions": {
            "bookmarks.manage": "Manage own bookmarks",
        },
    },
    "eol": {
        "label": "End of Life",
        "permissions": {
            "eol.view": "View EOL data",
            "eol.manage": "Run EOL searches, link EOL data to fact sheets",
        },
    },
    "web_portals": {
        "label": "Web Portals",
        "permissions": {
            "web_portals.view": "View published web portals",
            "web_portals.manage": "Create, edit, and delete web portals",
        },
    },
    "notifications": {
        "label": "Notifications",
        "permissions": {
            "notifications.manage": "Manage own notifications",
        },
    },
    "admin": {
        "label": "Admin",
        "permissions": {
            "admin.users": "Manage users (create, edit roles, deactivate)",
            "admin.roles": "Manage role definitions and permissions",
            "admin.metamodel": "Manage fact sheet types, fields, and relation types",
            "admin.settings": "Manage app settings (email, logo, SSO)",
            "admin.events": "View audit trail and event stream",
        },
    },
}

# Flat set for quick validation
ALL_APP_PERMISSION_KEYS: set[str] = set()
for group in APP_PERMISSIONS.values():
    ALL_APP_PERMISSION_KEYS.update(group["permissions"].keys())

# ---------------------------------------------------------------------------
# Fact-sheet-level permissions (stored in subscription_role_definitions.permissions)
# ---------------------------------------------------------------------------

FS_PERMISSIONS: dict[str, str] = {
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

ALL_FS_PERMISSION_KEYS: set[str] = set(FS_PERMISSIONS.keys())

# ---------------------------------------------------------------------------
# Mapping: app-level permission → fact-sheet-level equivalent
# When checking a FS action, the app-level perm also grants access.
# ---------------------------------------------------------------------------

APP_TO_FS_PERMISSION_MAP: dict[str, str] = {
    "inventory.edit": "fs.edit",
    "inventory.delete": "fs.delete",
    "inventory.quality_seal": "fs.quality_seal",
    "subscriptions.manage": "fs.manage_subscriptions",
    "relations.manage": "fs.manage_relations",
    "documents.manage": "fs.manage_documents",
    "comments.manage": "fs.manage_comments",
    "comments.create": "fs.create_comments",
    "bpm.edit": "fs.bpm_edit",
    "bpm.manage_drafts": "fs.bpm_manage_drafts",
    "bpm.approve_flows": "fs.bpm_approve",
}

# Reverse: fs-level → app-level (for check_permission convenience)
FS_TO_APP_PERMISSION_MAP: dict[str, str] = {v: k for k, v in APP_TO_FS_PERMISSION_MAP.items()}

# ---------------------------------------------------------------------------
# Default permission sets for seeded roles
# ---------------------------------------------------------------------------

ADMIN_PERMISSIONS: dict[str, bool] = {"*": True}

BPM_ADMIN_PERMISSIONS: dict[str, bool] = {
    "inventory.view": True,
    "inventory.create": True,
    "inventory.edit": True,
    "inventory.delete": True,
    "inventory.export": True,
    "inventory.quality_seal": True,
    "inventory.bulk_edit": True,
    "relations.view": True,
    "relations.manage": True,
    "subscriptions.view": True,
    "subscriptions.manage": True,
    "comments.view": True,
    "comments.create": True,
    "documents.view": True,
    "documents.manage": True,
    "diagrams.view": True,
    "diagrams.manage": True,
    "bpm.view": True,
    "bpm.edit": True,
    "bpm.manage_drafts": True,
    "bpm.approve_flows": True,
    "bpm.assessments": True,
    "reports.ea_dashboard": True,
    "reports.bpm_dashboard": True,
    "reports.portfolio": True,
    "surveys.respond": True,
    "soaw.view": True,
    "soaw.manage": True,
    "soaw.sign": True,
    "tags.manage": True,
    "bookmarks.manage": True,
    "eol.view": True,
    "eol.manage": True,
    "web_portals.view": True,
    "web_portals.manage": False,
    "notifications.manage": True,
    "admin.users": False,
    "admin.roles": False,
    "admin.metamodel": False,
    "admin.settings": False,
    "admin.events": False,
}

MEMBER_PERMISSIONS: dict[str, bool] = {
    "inventory.view": True,
    "inventory.create": True,
    "inventory.edit": True,
    "inventory.delete": True,
    "inventory.export": True,
    "inventory.quality_seal": True,
    "inventory.bulk_edit": True,
    "relations.view": True,
    "relations.manage": True,
    "subscriptions.view": True,
    "subscriptions.manage": True,
    "comments.view": True,
    "comments.create": True,
    "documents.view": True,
    "documents.manage": True,
    "diagrams.view": True,
    "diagrams.manage": True,
    "bpm.view": True,
    "bpm.edit": True,
    "bpm.manage_drafts": True,
    "bpm.approve_flows": False,
    "bpm.assessments": True,
    "reports.ea_dashboard": True,
    "reports.bpm_dashboard": True,
    "reports.portfolio": True,
    "surveys.respond": True,
    "surveys.manage": False,
    "soaw.view": True,
    "soaw.manage": True,
    "soaw.sign": True,
    "tags.manage": True,
    "bookmarks.manage": True,
    "eol.view": True,
    "eol.manage": True,
    "web_portals.view": True,
    "web_portals.manage": False,
    "notifications.manage": True,
    "admin.users": False,
    "admin.roles": False,
    "admin.metamodel": False,
    "admin.settings": False,
    "admin.events": False,
}

VIEWER_PERMISSIONS: dict[str, bool] = {
    "inventory.view": True,
    "inventory.create": False,
    "inventory.edit": False,
    "inventory.delete": False,
    "inventory.export": True,
    "inventory.quality_seal": False,
    "inventory.bulk_edit": False,
    "relations.view": True,
    "relations.manage": False,
    "subscriptions.view": True,
    "subscriptions.manage": False,
    "comments.view": True,
    "comments.create": False,
    "comments.manage": False,
    "documents.view": True,
    "documents.manage": False,
    "diagrams.view": True,
    "diagrams.manage": False,
    "bpm.view": True,
    "bpm.edit": False,
    "bpm.manage_drafts": False,
    "bpm.approve_flows": False,
    "bpm.assessments": False,
    "reports.ea_dashboard": True,
    "reports.bpm_dashboard": True,
    "reports.portfolio": True,
    "surveys.respond": True,
    "surveys.manage": False,
    "soaw.view": True,
    "soaw.manage": False,
    "soaw.sign": False,
    "tags.manage": False,
    "bookmarks.manage": True,
    "eol.view": True,
    "eol.manage": False,
    "web_portals.view": True,
    "web_portals.manage": False,
    "notifications.manage": True,
    "admin.users": False,
    "admin.roles": False,
    "admin.metamodel": False,
    "admin.settings": False,
    "admin.events": False,
}

# ---------------------------------------------------------------------------
# Default subscription-role permission sets
# ---------------------------------------------------------------------------

RESPONSIBLE_FS_PERMISSIONS: dict[str, bool] = {
    "fs.view": True,
    "fs.edit": True,
    "fs.delete": True,
    "fs.quality_seal": True,
    "fs.manage_subscriptions": True,
    "fs.manage_relations": True,
    "fs.manage_documents": True,
    "fs.manage_comments": True,
    "fs.create_comments": True,
    "fs.bpm_edit": True,
    "fs.bpm_manage_drafts": True,
    "fs.bpm_approve": False,
}

OBSERVER_FS_PERMISSIONS: dict[str, bool] = {
    "fs.view": True,
    "fs.edit": False,
    "fs.delete": False,
    "fs.quality_seal": False,
    "fs.manage_subscriptions": False,
    "fs.manage_relations": False,
    "fs.manage_documents": False,
    "fs.manage_comments": False,
    "fs.create_comments": True,
    "fs.bpm_edit": False,
    "fs.bpm_manage_drafts": False,
    "fs.bpm_approve": False,
}

PROCESS_OWNER_FS_PERMISSIONS: dict[str, bool] = {
    "fs.view": True,
    "fs.edit": True,
    "fs.delete": False,
    "fs.quality_seal": True,
    "fs.manage_subscriptions": True,
    "fs.manage_relations": True,
    "fs.manage_documents": True,
    "fs.manage_comments": False,
    "fs.create_comments": True,
    "fs.bpm_edit": True,
    "fs.bpm_manage_drafts": True,
    "fs.bpm_approve": True,
}

TECH_APP_OWNER_FS_PERMISSIONS: dict[str, bool] = {
    "fs.view": True,
    "fs.edit": True,
    "fs.delete": False,
    "fs.quality_seal": False,
    "fs.manage_subscriptions": False,
    "fs.manage_relations": True,
    "fs.manage_documents": True,
    "fs.manage_comments": False,
    "fs.create_comments": True,
    "fs.bpm_edit": False,
    "fs.bpm_manage_drafts": False,
    "fs.bpm_approve": False,
}

BIZ_APP_OWNER_FS_PERMISSIONS: dict[str, bool] = {
    "fs.view": True,
    "fs.edit": True,
    "fs.delete": False,
    "fs.quality_seal": False,
    "fs.manage_subscriptions": False,
    "fs.manage_relations": True,
    "fs.manage_documents": True,
    "fs.manage_comments": False,
    "fs.create_comments": True,
    "fs.bpm_edit": False,
    "fs.bpm_manage_drafts": False,
    "fs.bpm_approve": False,
}

# Map subscription role key → default permissions
DEFAULT_FS_PERMISSIONS_BY_ROLE: dict[str, dict[str, bool]] = {
    "responsible": RESPONSIBLE_FS_PERMISSIONS,
    "observer": OBSERVER_FS_PERMISSIONS,
    "process_owner": PROCESS_OWNER_FS_PERMISSIONS,
    "technical_application_owner": TECH_APP_OWNER_FS_PERMISSIONS,
    "business_application_owner": BIZ_APP_OWNER_FS_PERMISSIONS,
}
