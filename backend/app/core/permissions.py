"""Permission key registry — single source of truth for all valid permission keys."""

from __future__ import annotations

# ---------------------------------------------------------------------------
# App-level permissions (stored in roles.permissions JSONB)
# ---------------------------------------------------------------------------

APP_PERMISSIONS: dict[str, dict] = {
    "inventory": {
        "label": "Inventory",
        "permissions": {
            "inventory.view": "View card lists and detail pages",
            "inventory.create": "Create new cards",
            "inventory.edit": "Edit any card (overrides stakeholder-level)",
            "inventory.archive": "Archive and restore cards",
            "inventory.delete": "Permanently delete cards (admin)",
            "inventory.export": "Export CSV or Excel data",
            "inventory.approval_status": "Approve, reject, or reset approval status on any card",
            "inventory.bulk_edit": "Bulk update multiple cards",
        },
    },
    "relations": {
        "label": "Relations",
        "permissions": {
            "relations.view": "View relations between cards",
            "relations.manage": "Create, edit, and delete relations",
        },
    },
    "stakeholders": {
        "label": "Stakeholders",
        "permissions": {
            "stakeholders.view": "View who is assigned to a card",
            "stakeholders.manage": "Add or remove stakeholders on any card",
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
            "documents.manage": "Add or remove documents on any card",
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
    "saved_reports": {
        "label": "Saved Reports",
        "permissions": {
            "saved_reports.create": "Create and manage saved reports",
        },
    },
    "eol": {
        "label": "End of Life",
        "permissions": {
            "eol.view": "View EOL data",
            "eol.manage": "Run EOL searches, link EOL data to cards",
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
            "admin.metamodel": "Manage card types, fields, and relation types",
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
# Card-level permissions (stored in stakeholder_role_definitions.permissions)
# ---------------------------------------------------------------------------

CARD_PERMISSIONS: dict[str, str] = {
    "card.view": "View this card's detail page",
    "card.edit": "Edit this card's fields, name, description, lifecycle",
    "card.archive": "Archive or restore this card",
    "card.delete": "Permanently delete this card (admin)",
    "card.approval_status": "Approve, reject, or reset approval status",
    "card.manage_stakeholders": "Add or remove other users' stakeholder assignments",
    "card.manage_relations": "Add or remove relations on this card",
    "card.manage_documents": "Add or remove document links",
    "card.manage_comments": "Delete any comment (not just own)",
    "card.create_comments": "Post comments on this card",
    "card.bpm_edit": "Edit BPM diagram and elements (process types only)",
    "card.bpm_manage_drafts": "Create, edit, and submit BPMN flow drafts",
    "card.bpm_approve": "Approve or reject submitted BPMN flow versions",
}

ALL_CARD_PERMISSION_KEYS: set[str] = set(CARD_PERMISSIONS.keys())

# ---------------------------------------------------------------------------
# Mapping: app-level permission → card-level equivalent
# When checking a card action, the app-level perm also grants access.
# ---------------------------------------------------------------------------

APP_TO_CARD_PERMISSION_MAP: dict[str, str] = {
    "inventory.edit": "card.edit",
    "inventory.archive": "card.archive",
    "inventory.delete": "card.delete",
    "inventory.approval_status": "card.approval_status",
    "stakeholders.manage": "card.manage_stakeholders",
    "relations.manage": "card.manage_relations",
    "documents.manage": "card.manage_documents",
    "comments.manage": "card.manage_comments",
    "comments.create": "card.create_comments",
    "bpm.edit": "card.bpm_edit",
    "bpm.manage_drafts": "card.bpm_manage_drafts",
    "bpm.approve_flows": "card.bpm_approve",
}

# Reverse: card-level → app-level (for check_permission convenience)
CARD_TO_APP_PERMISSION_MAP: dict[str, str] = {v: k for k, v in APP_TO_CARD_PERMISSION_MAP.items()}

# ---------------------------------------------------------------------------
# Default permission sets for seeded roles
# ---------------------------------------------------------------------------

ADMIN_PERMISSIONS: dict[str, bool] = {"*": True}

BPM_ADMIN_PERMISSIONS: dict[str, bool] = {
    "inventory.view": True,
    "inventory.create": True,
    "inventory.edit": True,
    "inventory.archive": True,
    "inventory.delete": False,
    "inventory.export": True,
    "inventory.approval_status": True,
    "inventory.bulk_edit": True,
    "relations.view": True,
    "relations.manage": True,
    "stakeholders.view": True,
    "stakeholders.manage": True,
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
    "saved_reports.create": True,
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
    "inventory.archive": True,
    "inventory.delete": False,
    "inventory.export": True,
    "inventory.approval_status": True,
    "inventory.bulk_edit": True,
    "relations.view": True,
    "relations.manage": True,
    "stakeholders.view": True,
    "stakeholders.manage": True,
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
    "saved_reports.create": True,
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
    "inventory.archive": False,
    "inventory.delete": False,
    "inventory.export": True,
    "inventory.approval_status": False,
    "inventory.bulk_edit": False,
    "relations.view": True,
    "relations.manage": False,
    "stakeholders.view": True,
    "stakeholders.manage": False,
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
    "saved_reports.create": False,
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
# Default stakeholder-role permission sets
# ---------------------------------------------------------------------------

RESPONSIBLE_CARD_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.edit": True,
    "card.archive": True,
    "card.delete": False,
    "card.approval_status": True,
    "card.manage_stakeholders": True,
    "card.manage_relations": True,
    "card.manage_documents": True,
    "card.manage_comments": True,
    "card.create_comments": True,
    "card.bpm_edit": True,
    "card.bpm_manage_drafts": True,
    "card.bpm_approve": False,
}

OBSERVER_CARD_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.edit": False,
    "card.archive": False,
    "card.delete": False,
    "card.approval_status": False,
    "card.manage_stakeholders": False,
    "card.manage_relations": False,
    "card.manage_documents": False,
    "card.manage_comments": False,
    "card.create_comments": True,
    "card.bpm_edit": False,
    "card.bpm_manage_drafts": False,
    "card.bpm_approve": False,
}

PROCESS_OWNER_CARD_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.edit": True,
    "card.archive": False,
    "card.delete": False,
    "card.approval_status": True,
    "card.manage_stakeholders": True,
    "card.manage_relations": True,
    "card.manage_documents": True,
    "card.manage_comments": False,
    "card.create_comments": True,
    "card.bpm_edit": True,
    "card.bpm_manage_drafts": True,
    "card.bpm_approve": True,
}

TECH_APP_OWNER_CARD_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.edit": True,
    "card.archive": False,
    "card.delete": False,
    "card.approval_status": False,
    "card.manage_stakeholders": False,
    "card.manage_relations": True,
    "card.manage_documents": True,
    "card.manage_comments": False,
    "card.create_comments": True,
    "card.bpm_edit": False,
    "card.bpm_manage_drafts": False,
    "card.bpm_approve": False,
}

BIZ_APP_OWNER_CARD_PERMISSIONS: dict[str, bool] = {
    "card.view": True,
    "card.edit": True,
    "card.archive": False,
    "card.delete": False,
    "card.approval_status": False,
    "card.manage_stakeholders": False,
    "card.manage_relations": True,
    "card.manage_documents": True,
    "card.manage_comments": False,
    "card.create_comments": True,
    "card.bpm_edit": False,
    "card.bpm_manage_drafts": False,
    "card.bpm_approve": False,
}

# Map stakeholder role key → default permissions
DEFAULT_CARD_PERMISSIONS_BY_ROLE: dict[str, dict[str, bool]] = {
    "responsible": RESPONSIBLE_CARD_PERMISSIONS,
    "observer": OBSERVER_CARD_PERMISSIONS,
    "process_owner": PROCESS_OWNER_CARD_PERMISSIONS,
    "technical_application_owner": TECH_APP_OWNER_CARD_PERMISSIONS,
    "business_application_owner": BIZ_APP_OWNER_CARD_PERMISSIONS,
}
