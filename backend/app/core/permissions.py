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
            "diagrams.publish": ("Publish a diagram as a read-only public link for embedding"),
        },
    },
    "bpm": {
        "label": "BPM",
        "permissions": {
            "bpm.view": "View process diagrams, elements, and published flows",
            "bpm.edit": "Edit process diagrams and elements",
            "bpm.manage_drafts": "Create, edit, and delete BPMN flow drafts",
            "bpm.approve_flows": "Approve or reject submitted BPMN flow versions",
            "bpm.withdraw_flows": "Withdraw (unpublish) a published BPMN flow version",
            "bpm.assessments": "Create, edit, and delete process assessments",
        },
    },
    "ppm": {
        "label": "PPM",
        "permissions": {
            "ppm.view": "View PPM dashboard, Gantt chart, and initiative reports",
            "ppm.manage": "Create and manage status reports and tasks",
        },
    },
    "reports": {
        "label": "Reports",
        "permissions": {
            "reports.ea_dashboard": "View EA dashboard and reports",
            "reports.bpm_dashboard": "View BPM dashboard and reports",
            "reports.ppm_dashboard": "View PPM dashboard and reports",
            "reports.portfolio": "View the portfolio reports",
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
    "adr": {
        "label": "Architecture Decisions",
        "permissions": {
            "adr.view": "View architecture decision records",
            "adr.manage": "Create, edit, and duplicate architecture decisions",
            "adr.sign": "Sign architecture decisions",
            "adr.delete": "Delete architecture decisions",
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
            "bookmarks.share": "Share bookmarks with other users or make public",
            "bookmarks.odata": "Enable OData feed on bookmarks",
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
    "servicenow": {
        "label": "ServiceNow",
        "permissions": {
            "servicenow.view": "View ServiceNow integration settings and sync history",
            "servicenow.manage": "Manage ServiceNow connections, mappings, and trigger syncs",
        },
    },
    "turbolens": {
        "label": "TurboLens",
        "permissions": {
            "turbolens.view": "View TurboLens analysis results and vendor insights",
            "turbolens.manage": "Manage TurboLens connections and trigger analyses",
        },
    },
    "compliance": {
        "label": "Compliance",
        "permissions": {
            "compliance.view": "View compliance reports",
            "compliance.manage": "Trigger compliance scans and update finding status",
        },
    },
    "risks": {
        "label": "Risks",
        "permissions": {
            "risks.view": "View the risk register and risks on cards",
            "risks.manage": "Create, edit, promote, and resolve risks",
        },
    },
    "grc": {
        "label": "GRC",
        "permissions": {
            "grc.view": (
                "View the GRC module (Governance, Risk, Compliance). "
                "Risk and Compliance subtabs additionally honour risks.view "
                "and compliance.view."
            ),
            "grc.manage": (
                "Manage Governance content (AI risk classifications, ownership, principles)"
            ),
        },
    },
    "ai": {
        "label": "AI",
        "permissions": {
            "ai.suggest": "Use AI-powered metadata suggestions when creating or editing cards",
            "ai.portfolio_insights": "Generate AI-driven insights on the portfolio report",
        },
    },
    "costs": {
        "label": "Costs",
        "permissions": {
            "costs.view": (
                "View cost fields on cards and cost reports "
                "(stakeholders see costs on their own cards regardless)"
            ),
        },
    },
    "users": {
        "label": "Users",
        "permissions": {
            "users.invite": (
                "Invite a new user from a stakeholder or owner picker. "
                "Invitees are restricted to non-privileged roles (member, viewer); "
                "elevated roles still require admin.users."
            ),
        },
    },
    "admin": {
        "label": "Admin",
        "permissions": {
            "admin.users": "Manage users (create, edit roles, deactivate)",
            "admin.roles": "Manage role definitions and permissions",
            "admin.metamodel": "Manage card types, fields, and relation types",
            "admin.settings": "Manage app settings (email, logo, SSO)",
            "admin.mcp": "Manage MCP integration settings (AI tool access)",
            "admin.events": "View audit trail and event stream",
            "admin.todos": "View and manage other users' todos (not just your own)",
            "admin.migrate": (
                "Run platform migration imports (e.g., LeanIX workspace snapshot). "
                "Lets the holder extend the metamodel and bulk-create cards, "
                "users, relations, tags, stakeholders, and documents in a "
                "single staged + reviewable operation."
            ),
            "admin.impersonate": (
                "Start a role-impersonation session — temporarily view the app "
                "as another role to verify what non-admin users see. The "
                "impersonator's real user id is captured on every event "
                "emitted during the session for audit."
            ),
            "admin.export_workspace": (
                "Export the full workspace (metamodel, configuration, settings, "
                "and inventory) to a portable bundle. Secrets (SMTP/SSO/AI "
                "credentials) are always excluded."
            ),
            "admin.import_workspace": (
                "Import a full-workspace bundle into this instance — upserts the "
                "metamodel, configuration, settings, users, cards, and relations. "
                "A dry-run preview is shown before anything is written."
            ),
            "admin.manage_extensions": (
                "Manage the Extension Store: upload and install vendor-signed "
                "extension bundles, apply their content, upload license files, "
                "and enable/disable or uninstall extensions."
            ),
        },
    },
}

# Flat set for quick validation
ALL_APP_PERMISSION_KEYS: set[str] = set()
for group in APP_PERMISSIONS.values():
    ALL_APP_PERMISSION_KEYS.update(group["permissions"].keys())

# ---------------------------------------------------------------------------
# Legacy app-level permission keys
# ---------------------------------------------------------------------------
#
# The pre-024 names that migration 033 renamed inside ``roles.permissions``.
# 033 repairs the rows an install already had, so on any instance that ran it
# the table is clean — this map exists for the maps that arrive *afterwards*,
# which no migration is watching: a workspace bundle exported from an instance
# that never ran 033 is written straight onto the model by the transfer
# applier, bypassing the validators below.
#
# Unlike the card-level keys, these are RENAMED, not dropped. Each one maps to
# a permission that still exists and still means the same thing, so the stored
# ``true`` is a grant somebody deliberately made; dropping it would silently
# revoke access, where renaming preserves exactly what the role had.
LEGACY_APP_PERMISSION_RENAMES: dict[str, str] = {
    "subscriptions.view": "stakeholders.view",
    "subscriptions.manage": "stakeholders.manage",
    "inventory.quality_seal": "inventory.approval_status",
}


def migrate_legacy_app_permissions(permissions: dict) -> dict:
    """Rename pre-024 app permission keys to their modern equivalents.

    Mirrors migration 033's semantics: the modern key wins when both are
    present, so a deliberate newer value is never clobbered by a stale one.
    Keys outside the map are untouched — an unknown key stays unknown, for the
    caller to reject.
    """
    if not isinstance(permissions, dict):
        return permissions
    if not LEGACY_APP_PERMISSION_RENAMES.keys() & permissions.keys():
        return permissions
    migrated: dict = {}
    for key, value in permissions.items():
        new_key = LEGACY_APP_PERMISSION_RENAMES.get(key)
        if new_key is None:
            migrated[key] = value
        elif new_key not in permissions:
            migrated[new_key] = value
    return migrated


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
    "card.bpm_withdraw": "Withdraw (unpublish) a published BPMN flow version",
    "card.manage_adr_links": "Link or unlink architecture decisions on this card",
    "card.manage_diagram_links": "Link or unlink diagrams on this card",
}

ALL_CARD_PERMISSION_KEYS: set[str] = set(CARD_PERMISSIONS.keys())

# ---------------------------------------------------------------------------
# Legacy card permission keys
# ---------------------------------------------------------------------------
#
# Migration 024 renamed the ``fs.`` prefix to ``card.`` inside
# ``stakeholder_role_definitions.permissions`` but never applied the *semantic*
# half of the same rename, so ``fs.quality_seal`` became ``card.quality_seal``
# rather than ``card.approval_status``. Migration 033 repaired the equivalent
# app-level keys in ``roles.permissions`` and stopped there, leaving every
# install upgraded through 024 carrying keys this catalogue does not contain.
#
# That made the stakeholder-role editor unusable: the admin UI renders only the
# keys in ``CARD_PERMISSIONS`` yet round-trips the stored map verbatim, so every
# save resent the stale keys and was rejected — taking the colour, label and
# translations down with it.
#
# They are DROPPED, never remapped. ``get_effective_card_permissions`` only ever
# reads the modern names, so these keys have granted nothing since 024; removing
# them is behaviour-preserving, whereas remapping would silently *grant*
# approve/reject and stakeholder-management rights to every holder of the role.
LEGACY_CARD_PERMISSION_KEYS: frozenset[str] = frozenset(
    {"card.quality_seal", "card.manage_subscriptions"}
)


def strip_legacy_card_permissions(permissions: dict) -> dict:
    """Drop known-stale card permission keys from a permissions map.

    Only forgives keys this codebase itself once wrote. Genuinely unknown keys
    are left in place for the caller to reject, so this stays a targeted repair
    rather than a hole in the validator.
    """
    if not isinstance(permissions, dict):
        return permissions
    return {k: v for k, v in permissions.items() if k not in LEGACY_CARD_PERMISSION_KEYS}


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
    "bpm.withdraw_flows": "card.bpm_withdraw",
    "adr.manage": "card.manage_adr_links",
    "diagrams.manage": "card.manage_diagram_links",
}

# Reverse: card-level → app-level (for check_permission convenience)
CARD_TO_APP_PERMISSION_MAP: dict[str, str] = {v: k for k, v in APP_TO_CARD_PERMISSION_MAP.items()}

# ---------------------------------------------------------------------------
# Per-card-type permission overrides
# ---------------------------------------------------------------------------
# A card type may override these four app-level permissions per role, so an
# admin can say "members may not create Organizations" or "viewers may create
# Initiatives" without minting a role per type. Deliberately a *subset* of
# ``inventory.*`` and NOT new permission keys: the override map reuses the keys
# below, so ``ALL_APP_PERMISSION_KEYS`` and every default role dict are
# untouched. ``inventory.view`` is excluded on purpose — hiding a type from a
# role would have to reach every list, report, relation and graph endpoint,
# which is a different feature.
TYPE_SCOPED_APP_PERMISSIONS: frozenset[str] = frozenset(
    {
        "inventory.create",
        "inventory.edit",
        "inventory.archive",
        "inventory.delete",
    }
)


def validate_type_role_permissions(
    raw: object,
    *,
    known_role_keys: set[str],
    wildcard_role_keys: set[str],
) -> dict[str, dict[str, bool]]:
    """Validate and normalise a ``card_types.role_permissions`` map.

    Shape: ``{role_key: {app_permission: bool}}``. Only *explicitly overridden*
    cells are stored — an absent key means "inherit the role's global grant",
    which is why empty inner dicts are dropped rather than persisted.

    Raises ``ValueError`` (route layer converts to 400) when the payload names
    an unknown role, a wildcard role (admin can never be overridden — that is
    the escape hatch that keeps an instance recoverable), a permission outside
    ``TYPE_SCOPED_APP_PERMISSIONS``, or a non-boolean value.

    Archived roles are accepted: their overrides are inert but a round-trip of
    a stored map must never start failing because a role was archived.
    """
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("role_permissions must be an object")

    out: dict[str, dict[str, bool]] = {}
    for role_key, cells in raw.items():
        if not isinstance(role_key, str):
            raise ValueError("role_permissions keys must be role keys")
        if role_key not in known_role_keys:
            raise ValueError(f"Unknown role key: {role_key}")
        if role_key in wildcard_role_keys:
            raise ValueError(
                f"Role '{role_key}' has full access and cannot be overridden per card type"
            )
        if not isinstance(cells, dict):
            raise ValueError(f"role_permissions['{role_key}'] must be an object")

        clean: dict[str, bool] = {}
        for perm_key, value in cells.items():
            if perm_key not in TYPE_SCOPED_APP_PERMISSIONS:
                raise ValueError(
                    f"Permission '{perm_key}' cannot be set per card type "
                    f"(allowed: {', '.join(sorted(TYPE_SCOPED_APP_PERMISSIONS))})"
                )
            if not isinstance(value, bool):
                raise ValueError(f"role_permissions['{role_key}']['{perm_key}'] must be a boolean")
            clean[perm_key] = value

        # An empty override map is the same as no entry at all.
        if clean:
            out[role_key] = clean
    return out


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
    "comments.manage": True,
    "documents.view": True,
    "documents.manage": True,
    "diagrams.view": True,
    "diagrams.manage": True,
    "diagrams.publish": False,
    "bpm.view": True,
    "bpm.edit": True,
    "bpm.manage_drafts": True,
    "bpm.approve_flows": True,
    # Withdrawing a published flow is a separate authority from approving one.
    # Off even for BPM Admin — an admin must grant it deliberately.
    "bpm.withdraw_flows": False,
    "bpm.assessments": True,
    "ppm.view": True,
    "ppm.manage": True,
    "reports.ea_dashboard": True,
    "reports.bpm_dashboard": True,
    "reports.ppm_dashboard": True,
    "reports.portfolio": True,
    "surveys.respond": True,
    "surveys.manage": False,
    "soaw.view": True,
    "soaw.manage": True,
    "soaw.sign": True,
    "adr.view": True,
    "adr.manage": True,
    "adr.sign": True,
    "adr.delete": False,
    "tags.manage": True,
    "bookmarks.manage": True,
    "bookmarks.share": True,
    "bookmarks.odata": True,
    "saved_reports.create": True,
    "eol.view": True,
    "eol.manage": True,
    "web_portals.view": True,
    "web_portals.manage": False,
    "servicenow.view": False,
    "servicenow.manage": False,
    "turbolens.view": True,
    "turbolens.manage": False,
    "compliance.view": True,
    "compliance.manage": False,
    "risks.view": True,
    "risks.manage": True,
    "grc.view": True,
    "grc.manage": True,
    "ai.suggest": True,
    "ai.portfolio_insights": True,
    "costs.view": True,
    "notifications.manage": True,
    "users.invite": True,
    "admin.users": False,
    "admin.roles": False,
    "admin.metamodel": False,
    "admin.settings": False,
    "admin.mcp": False,
    "admin.events": False,
    "admin.todos": False,
    "admin.migrate": False,
    "admin.impersonate": False,
    "admin.export_workspace": False,
    "admin.import_workspace": False,
    "admin.manage_extensions": False,
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
    "comments.manage": False,
    "documents.view": True,
    "documents.manage": True,
    "diagrams.view": True,
    "diagrams.manage": True,
    "diagrams.publish": False,
    "bpm.view": True,
    "bpm.edit": True,
    "bpm.manage_drafts": True,
    "bpm.approve_flows": False,
    "bpm.withdraw_flows": False,
    "bpm.assessments": True,
    "ppm.view": True,
    "ppm.manage": True,
    "reports.ea_dashboard": True,
    "reports.bpm_dashboard": True,
    "reports.ppm_dashboard": True,
    "reports.portfolio": True,
    "surveys.respond": True,
    "surveys.manage": False,
    "soaw.view": True,
    "soaw.manage": True,
    "soaw.sign": True,
    "adr.view": True,
    "adr.manage": True,
    "adr.sign": True,
    "adr.delete": False,
    "tags.manage": True,
    "bookmarks.manage": True,
    "bookmarks.share": True,
    "bookmarks.odata": True,
    "saved_reports.create": True,
    "eol.view": True,
    "eol.manage": True,
    "web_portals.view": True,
    "web_portals.manage": False,
    "servicenow.view": False,
    "servicenow.manage": False,
    "turbolens.view": True,
    "turbolens.manage": False,
    "compliance.view": True,
    "compliance.manage": False,
    "risks.view": True,
    "risks.manage": True,
    "grc.view": True,
    "grc.manage": True,
    "ai.suggest": True,
    "ai.portfolio_insights": True,
    "costs.view": True,
    "notifications.manage": True,
    "users.invite": False,
    "admin.users": False,
    "admin.roles": False,
    "admin.metamodel": False,
    "admin.settings": False,
    "admin.mcp": False,
    "admin.events": False,
    "admin.todos": False,
    "admin.migrate": False,
    "admin.impersonate": False,
    "admin.export_workspace": False,
    "admin.import_workspace": False,
    "admin.manage_extensions": False,
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
    "diagrams.publish": False,
    "bpm.view": True,
    "bpm.edit": False,
    "bpm.manage_drafts": False,
    "bpm.approve_flows": False,
    "bpm.withdraw_flows": False,
    "bpm.assessments": False,
    "ppm.view": True,
    "ppm.manage": False,
    "reports.ea_dashboard": True,
    "reports.bpm_dashboard": True,
    "reports.ppm_dashboard": True,
    "reports.portfolio": True,
    "surveys.respond": True,
    "surveys.manage": False,
    "soaw.view": True,
    "soaw.manage": False,
    "soaw.sign": False,
    "adr.view": True,
    "adr.manage": False,
    "adr.sign": False,
    "adr.delete": False,
    "tags.manage": False,
    "bookmarks.manage": True,
    "bookmarks.share": False,
    "bookmarks.odata": False,
    "saved_reports.create": False,
    "eol.view": True,
    "eol.manage": False,
    "web_portals.view": True,
    "web_portals.manage": False,
    "servicenow.view": False,
    "servicenow.manage": False,
    "turbolens.view": False,
    "turbolens.manage": False,
    "compliance.view": True,
    "compliance.manage": False,
    "risks.view": True,
    "risks.manage": False,
    "grc.view": True,
    "grc.manage": False,
    "ai.suggest": False,
    "ai.portfolio_insights": False,
    "costs.view": False,
    "notifications.manage": True,
    "users.invite": False,
    "admin.users": False,
    "admin.roles": False,
    "admin.metamodel": False,
    "admin.settings": False,
    "admin.mcp": False,
    "admin.events": False,
    "admin.todos": False,
    "admin.migrate": False,
    "admin.impersonate": False,
    "admin.export_workspace": False,
    "admin.import_workspace": False,
    "admin.manage_extensions": False,
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
    "card.bpm_withdraw": False,
    "card.manage_adr_links": True,
    "card.manage_diagram_links": True,
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
    "card.bpm_withdraw": False,
    "card.manage_adr_links": False,
    "card.manage_diagram_links": False,
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
    # Off by default even for the Process Owner: withdrawing a published flow is
    # opt-in, granted deliberately in Admin → Metamodel → Stakeholder roles.
    "card.bpm_withdraw": False,
    "card.manage_adr_links": True,
    "card.manage_diagram_links": True,
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
    "card.bpm_withdraw": False,
    "card.manage_adr_links": True,
    "card.manage_diagram_links": True,
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
    "card.bpm_withdraw": False,
    "card.manage_adr_links": True,
    "card.manage_diagram_links": True,
}

IT_PROJECT_MANAGER_CARD_PERMISSIONS: dict[str, bool] = {
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
    "card.bpm_edit": False,
    "card.bpm_manage_drafts": False,
    "card.bpm_approve": False,
    "card.bpm_withdraw": False,
    "card.manage_adr_links": True,
    "card.manage_diagram_links": True,
}

# Map stakeholder role key → default permissions
DEFAULT_CARD_PERMISSIONS_BY_ROLE: dict[str, dict[str, bool]] = {
    "responsible": RESPONSIBLE_CARD_PERMISSIONS,
    "observer": OBSERVER_CARD_PERMISSIONS,
    "processOwner": PROCESS_OWNER_CARD_PERMISSIONS,
    "technicalApplicationOwner": TECH_APP_OWNER_CARD_PERMISSIONS,
    "businessApplicationOwner": BIZ_APP_OWNER_CARD_PERMISSIONS,
    "itProjectManager": IT_PROJECT_MANAGER_CARD_PERMISSIONS,
}
