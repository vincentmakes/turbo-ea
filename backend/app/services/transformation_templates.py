"""Predefined transformation templates and implied impact generation.

Each template defines:
  - name, description, target fact sheet type
  - implied_impacts_schema: list of impact blueprints that use placeholder keys
    referencing template_fields (e.g. "$target", "$organization")
  - required_fields: what the user must supply when creating from this template

When a transformation is created from a template, the service resolves
placeholders against the user-supplied template_fields dict and generates
concrete Impact rows.
"""
from __future__ import annotations

import uuid

from app.models.impact import Impact

# ── Action execution order mapping ──────────────────────────────

ACTION_ORDER: dict[str, int] = {
    "create_fact_sheet": 10,
    "set_field": 20,
    "copy_field": 30,
    "create_relation": 40,
    "set_relation_field": 50,
    "set_relation_validity": 60,
    "remove_relation": 70,
    "remove_all_relations": 80,
    "add_tag": 90,
    "remove_tag": 91,
    "replace_tags": 92,
    "archive_fact_sheet": 100,
}

# ── Predefined templates ────────────────────────────────────────

PREDEFINED_TEMPLATES: list[dict] = [
    {
        "name": "Introduce Application",
        "description": (
            "Introduce a new application into the landscape. "
            "Creates a new Application fact sheet and links it to the "
            "specified organizations and business capabilities."
        ),
        "target_fact_sheet_type": "Application",
        "implied_impacts_schema": [
            {
                "impact_type": "introduction",
                "action": "create_fact_sheet",
                "description": "Create the new Application fact sheet",
                "target_field": "$target",
                "field_name": "lifecycle",
                "field_value": {"plan": "$completion_date"},
            },
            {
                "impact_type": "introduction",
                "action": "set_field",
                "description": "Set lifecycle to Plan phase",
                "target_field": "$target",
                "field_name": "lifecycle",
                "field_value": {"plan": "$completion_date"},
            },
            {
                "impact_type": "introduction",
                "action": "create_relation",
                "description": "Link to target organization",
                "target_field": "$target",
                "source_field": "$organization",
                "relation_type": "relAppToOrg",
                "condition": "$organization",
            },
            {
                "impact_type": "introduction",
                "action": "create_relation",
                "description": "Link to target business capability",
                "target_field": "$target",
                "source_field": "$business_capability",
                "relation_type": "relAppToBC",
                "condition": "$business_capability",
            },
        ],
        "required_fields": [
            {
                "key": "target_name",
                "label": "Application Name",
                "type": "text",
                "required": True,
            },
            {
                "key": "organization",
                "label": "Target Organization",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Organization",
                "required": False,
            },
            {
                "key": "business_capability",
                "label": "Business Capability",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "BusinessCapability",
                "required": False,
            },
        ],
    },
    {
        "name": "Decommission Application",
        "description": (
            "Fully decommission an existing application. "
            "Sets lifecycle to End of Life and removes all relations."
        ),
        "target_fact_sheet_type": "Application",
        "implied_impacts_schema": [
            {
                "impact_type": "decommissioning",
                "action": "set_field",
                "description": "Set lifecycle to End of Life",
                "target_field": "$target",
                "field_name": "lifecycle",
                "field_value": {"endOfLife": "$completion_date"},
            },
            {
                "impact_type": "decommissioning",
                "action": "remove_all_relations",
                "description": "Remove all relations",
                "target_field": "$target",
                "relation_type": "*",
            },
            {
                "impact_type": "decommissioning",
                "action": "archive_fact_sheet",
                "description": "Archive the application",
                "target_field": "$target",
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "Application to Decommission",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Application",
                "required": True,
            },
        ],
    },
    {
        "name": "Decommission Interface",
        "description": (
            "Decommission an existing interface. "
            "Sets lifecycle to End of Life and removes relations."
        ),
        "target_fact_sheet_type": "Interface",
        "implied_impacts_schema": [
            {
                "impact_type": "decommissioning",
                "action": "set_field",
                "description": "Set lifecycle to End of Life",
                "target_field": "$target",
                "field_name": "lifecycle",
                "field_value": {"endOfLife": "$completion_date"},
            },
            {
                "impact_type": "decommissioning",
                "action": "remove_all_relations",
                "description": "Remove all relations",
                "target_field": "$target",
                "relation_type": "*",
            },
            {
                "impact_type": "decommissioning",
                "action": "archive_fact_sheet",
                "description": "Archive the interface",
                "target_field": "$target",
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "Interface to Decommission",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Interface",
                "required": True,
            },
        ],
    },
    {
        "name": "Rollout Application",
        "description": (
            "Extend an existing application to additional organizations or regions."
        ),
        "target_fact_sheet_type": "Application",
        "implied_impacts_schema": [
            {
                "impact_type": "rollout",
                "action": "create_relation",
                "description": "Link to additional organization",
                "target_field": "$target",
                "source_field": "$organization",
                "relation_type": "relAppToOrg",
                "condition": "$organization",
            },
            {
                "impact_type": "rollout",
                "action": "create_relation",
                "description": "Link to additional business capability",
                "target_field": "$target",
                "source_field": "$business_capability",
                "relation_type": "relAppToBC",
                "condition": "$business_capability",
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "Application to Roll Out",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Application",
                "required": True,
            },
            {
                "key": "organization",
                "label": "Target Organization",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Organization",
                "required": False,
            },
            {
                "key": "business_capability",
                "label": "Business Capability",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "BusinessCapability",
                "required": False,
            },
        ],
    },
    {
        "name": "Discontinue Application",
        "description": (
            "Mark an existing application as discontinued (End of Life)."
        ),
        "target_fact_sheet_type": "Application",
        "implied_impacts_schema": [
            {
                "impact_type": "discontinuation",
                "action": "set_field",
                "description": "Set lifecycle to End of Life",
                "target_field": "$target",
                "field_name": "lifecycle",
                "field_value": {"endOfLife": "$completion_date"},
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "Application to Discontinue",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Application",
                "required": True,
            },
        ],
    },
    {
        "name": "Withdraw Application",
        "description": (
            "Remove an application from specific organizations or capabilities."
        ),
        "target_fact_sheet_type": "Application",
        "implied_impacts_schema": [
            {
                "impact_type": "withdrawal",
                "action": "remove_relation",
                "description": "Remove relation to organization",
                "target_field": "$target",
                "source_field": "$organization",
                "relation_type": "relAppToOrg",
                "condition": "$organization",
            },
            {
                "impact_type": "withdrawal",
                "action": "remove_relation",
                "description": "Remove relation to business capability",
                "target_field": "$target",
                "source_field": "$business_capability",
                "relation_type": "relAppToBC",
                "condition": "$business_capability",
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "Application",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Application",
                "required": True,
            },
            {
                "key": "organization",
                "label": "Organization to Withdraw From",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Organization",
                "required": False,
            },
            {
                "key": "business_capability",
                "label": "Business Capability to Withdraw From",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "BusinessCapability",
                "required": False,
            },
        ],
    },
    {
        "name": "Replace Application",
        "description": (
            "Replace one application with another. Introduces a successor "
            "and decommissions the predecessor."
        ),
        "target_fact_sheet_type": "Application",
        "implied_impacts_schema": [
            {
                "impact_type": "replacement",
                "action": "create_fact_sheet",
                "description": "Create successor application",
                "target_field": "$successor",
                "condition": "$successor_name",
            },
            {
                "impact_type": "replacement",
                "action": "set_field",
                "description": "Set predecessor lifecycle to End of Life",
                "target_field": "$target",
                "field_name": "lifecycle",
                "field_value": {"endOfLife": "$completion_date"},
            },
            {
                "impact_type": "replacement",
                "action": "archive_fact_sheet",
                "description": "Archive predecessor",
                "target_field": "$target",
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "Application to Replace (Predecessor)",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Application",
                "required": True,
            },
            {
                "key": "successor_name",
                "label": "Successor Application Name",
                "type": "text",
                "required": False,
            },
        ],
    },
    {
        "name": "Introduce Interface",
        "description": (
            "Add a new interface and link it to provider/consumer applications."
        ),
        "target_fact_sheet_type": "Interface",
        "implied_impacts_schema": [
            {
                "impact_type": "introduction",
                "action": "create_fact_sheet",
                "description": "Create the new Interface fact sheet",
                "target_field": "$target",
            },
            {
                "impact_type": "introduction",
                "action": "create_relation",
                "description": "Link to provider application",
                "target_field": "$target",
                "source_field": "$provider",
                "relation_type": "relInterfaceToApp",
                "condition": "$provider",
            },
        ],
        "required_fields": [
            {
                "key": "target_name",
                "label": "Interface Name",
                "type": "text",
                "required": True,
            },
            {
                "key": "provider",
                "label": "Provider Application",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "Application",
                "required": False,
            },
        ],
    },
    {
        "name": "Upgrade Technology",
        "description": (
            "Upgrade an IT Component to a new version."
        ),
        "target_fact_sheet_type": "ITComponent",
        "implied_impacts_schema": [
            {
                "impact_type": "upgrade",
                "action": "set_field",
                "description": "Update version field",
                "target_field": "$target",
                "field_name": "technicalVersion",
                "field_value": "$new_version",
                "condition": "$new_version",
            },
        ],
        "required_fields": [
            {
                "key": "target",
                "label": "IT Component to Upgrade",
                "type": "fact_sheet_ref",
                "fact_sheet_type": "ITComponent",
                "required": True,
            },
            {
                "key": "new_version",
                "label": "New Version",
                "type": "text",
                "required": False,
            },
        ],
    },
    {
        "name": "Custom Transformation",
        "description": (
            "User-defined transformation. No impacts are auto-generated; "
            "define all impacts manually."
        ),
        "target_fact_sheet_type": "*",
        "implied_impacts_schema": [],
        "required_fields": [],
    },
]


def _resolve_value(
    value: str | dict | list | None,
    template_fields: dict,
    completion_date: str | None,
) -> str | dict | list | None:
    """Resolve $-prefixed placeholders in a value."""
    if value is None:
        return None
    if isinstance(value, str) and value.startswith("$"):
        key = value[1:]
        if key == "completion_date":
            return completion_date
        return template_fields.get(key)
    if isinstance(value, dict):
        return {
            k: _resolve_value(v, template_fields, completion_date)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_resolve_value(v, template_fields, completion_date) for v in value]
    return value


def _extract_fs_id(value: str | dict | None) -> uuid.UUID | None:
    """Extract a UUID from a template field value.

    The frontend sends FSRef objects ``{id, type, name}`` for
    ``fact_sheet_ref`` fields.  Plain UUID strings are also accepted.
    """
    if value is None:
        return None
    if isinstance(value, dict):
        raw = value.get("id")
        if raw:
            return uuid.UUID(str(raw))
        return None
    if isinstance(value, str) and value:
        try:
            return uuid.UUID(value)
        except ValueError:
            return None
    return None


def generate_implied_impacts(
    transformation_id: uuid.UUID,
    impacts_schema: list[dict],
    template_fields: dict,
    completion_date: str | None = None,
) -> list[Impact]:
    """Generate Impact ORM objects from a template's implied_impacts_schema.

    Placeholder values like ``$target``, ``$organization`` are resolved
    against the user-supplied *template_fields* dict.
    """
    impacts: list[Impact] = []

    for schema_item in impacts_schema:
        # Skip items whose condition field is not satisfied
        condition = schema_item.get("condition")
        if condition and isinstance(condition, str) and condition.startswith("$"):
            cond_key = condition[1:]
            if not template_fields.get(cond_key):
                continue

        target_ref = schema_item.get("target_field", "")
        target_id = None
        if isinstance(target_ref, str) and target_ref.startswith("$"):
            raw_target = template_fields.get(target_ref[1:])
            target_id = _extract_fs_id(raw_target)

        source_ref = schema_item.get("source_field", "")
        source_id = None
        if isinstance(source_ref, str) and source_ref.startswith("$"):
            raw_source = template_fields.get(source_ref[1:])
            source_id = _extract_fs_id(raw_source)

        action = schema_item["action"]
        field_name = schema_item.get("field_name")
        field_value = _resolve_value(
            schema_item.get("field_value"), template_fields, completion_date
        )
        relation_type = schema_item.get("relation_type")

        impact = Impact(
            transformation_id=transformation_id,
            impact_type=schema_item["impact_type"],
            action=action,
            source_fact_sheet_id=source_id,
            target_fact_sheet_id=target_id,
            field_name=field_name,
            field_value=field_value,
            relation_type=relation_type,
            is_implied=True,
            execution_order=ACTION_ORDER.get(action, 50),
        )
        impacts.append(impact)

    return impacts
