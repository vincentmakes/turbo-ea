"""Add standard Initiative actual dates and migrate the legacy ActualEnd key.

Revision ID: 201
Revises: 200

The canonical value wins if both spellings exist. A different legacy value is
kept under ActualEnd for recovery. Downgrade leaves data and field keys intact.
"""

import ast

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "201"
down_revision = "200"
branch_labels = None
depends_on = None

LEGACY = "ActualEnd"
CANONICAL = "actualEnd"

card_types = sa.table(
    "card_types",
    sa.column("key", sa.String),
    sa.column("fields_schema", JSONB),
    sa.column("subtypes", JSONB),
    sa.column("section_config", JSONB),
)
cards = sa.table(
    "cards",
    sa.column("id", sa.Uuid),
    sa.column("type", sa.String),
    sa.column("attributes", JSONB),
)
settings = sa.table(
    "app_settings",
    sa.column("id", sa.String),
    sa.column("general_settings", JSONB),
)
calculations = sa.table(
    "calculations",
    sa.column("id", sa.Uuid),
    sa.column("target_type_key", sa.String),
    sa.column("target_field_key", sa.String),
    sa.column("formula", sa.Text),
)
snow_mappings = sa.table(
    "servicenow_mappings", sa.column("id", sa.Uuid), sa.column("card_type_key", sa.String)
)
snow_fields = sa.table(
    "servicenow_field_mappings",
    sa.column("mapping_id", sa.Uuid),
    sa.column("turbo_field", sa.String),
)
portals = sa.table(
    "web_portals",
    sa.column("id", sa.Uuid),
    sa.column("card_type", sa.String),
    sa.column("display_fields", JSONB),
    sa.column("card_config", JSONB),
    sa.column("filters", JSONB),
)


def _rename_formula(formula):
    output = []
    for line in formula.splitlines(keepends=True):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            output.append(line)
            continue
        try:
            tree = ast.parse(stripped)
        except SyntaxError:
            output.append(line)
            continue
        encoded = line.encode("utf-8")
        prefix = len(line[: len(line) - len(line.lstrip())].encode("utf-8"))
        edits = []
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id == "data"
                and node.attr == LEGACY
            ):
                end = prefix + node.end_col_offset
                edits.append((end - len(LEGACY), end, CANONICAL.encode()))
            elif (
                isinstance(node, ast.Subscript)
                and isinstance(node.value, ast.Name)
                and node.value.id == "data"
                and isinstance(node.slice, ast.Constant)
                and node.slice.value == LEGACY
            ):
                start = prefix + node.slice.col_offset
                end = prefix + node.slice.end_col_offset
                literal = encoded[start:end]
                quote = b'"' if literal.startswith(b'"') else b"'"
                edits.append((start, end, quote + CANONICAL.encode() + quote))
        for start, end, replacement in sorted(edits, reverse=True):
            encoded = encoded[:start] + replacement + encoded[end:]
        output.append(encoded.decode("utf-8"))
    return "".join(output)


def _rename_field_list(value, preserve_legacy=False):
    if not isinstance(value, list):
        return value
    if preserve_legacy:
        return [*value, CANONICAL] if LEGACY in value and CANONICAL not in value else value
    return [CANONICAL if item == LEGACY else item for item in value]


def _rename_layout(value, preserve_legacy=False):
    if not isinstance(value, dict):
        return value
    result = dict(value)
    for key, section in result.items():
        if not isinstance(section, dict):
            continue
        section = dict(section)
        for field_list in ("hidden_fields", "field_order"):
            if field_list in section:
                section[field_list] = _rename_field_list(section[field_list], preserve_legacy)
        result[key] = section
    return result


def _rename_subtypes(value, preserve_legacy=False):
    if not isinstance(value, list):
        return value
    result = []
    for subtype in value:
        if isinstance(subtype, dict):
            subtype = dict(subtype)
            if "hidden_fields" in subtype:
                subtype["hidden_fields"] = _rename_field_list(
                    subtype["hidden_fields"], preserve_legacy
                )
        result.append(subtype)
    return result


def _portal_values(row):
    display_fields = _rename_field_list(row["display_fields"])
    config = (
        dict(row["card_config"]) if isinstance(row["card_config"], dict) else row["card_config"]
    )
    if isinstance(config, dict) and isinstance(config.get("toggles"), dict):
        toggles = dict(config["toggles"])
        if "field:ActualEnd" in toggles:
            legacy = toggles.pop("field:ActualEnd")
            canonical = toggles.get("field:actualEnd")
            if isinstance(legacy, dict) and isinstance(canonical, dict):
                toggles["field:actualEnd"] = {
                    **canonical,
                    "card": bool(legacy.get("card")) and bool(canonical.get("card")),
                    "detail": bool(legacy.get("detail")) and bool(canonical.get("detail")),
                }
            else:
                toggles.setdefault("field:actualEnd", legacy)
        config["toggles"] = toggles
    filters = dict(row["filters"]) if isinstance(row["filters"], dict) else row["filters"]
    if isinstance(filters, dict) and isinstance(filters.get("attributes"), dict):
        attributes = dict(filters["attributes"])
        if LEGACY in attributes:
            legacy = attributes.pop(LEGACY)
            attributes.setdefault(CANONICAL, legacy)
        filters["attributes"] = attributes
    return display_fields, config, filters


def _upgrade_data(connection):
    current = (
        connection.execute(sa.select(card_types).where(card_types.c.key == "Initiative"))
        .mappings()
        .first()
    )
    if current is None:
        return

    schema = current["fields_schema"] or []
    # A portal may expose either key implicitly or differently in list and
    # detail. Preserve each key whenever an Initiative portal already exists.
    protect_legacy = (
        connection.execute(
            sa.select(portals.c.id).where(portals.c.card_type == "Initiative").limit(1)
        ).first()
        is not None
    )
    portal_date_conflict = protect_legacy or any(
        isinstance(attrs, dict) and CANONICAL in attrs and attrs.get(LEGACY) != attrs[CANONICAL]
        for attrs in connection.execute(
            sa.select(cards.c.attributes).where(cards.c.type == "Initiative")
        ).scalars()
    )
    entries = [
        field
        for section in schema
        if isinstance(section, dict)
        for field in (section.get("fields") or [])
        if isinstance(field, dict)
    ]
    by_key = {field.get("key"): field for field in entries}
    for key in ("actualStart", CANONICAL):
        field = by_key.get(key)
        if field and field.get("type") != "date":
            raise RuntimeError(f"Initiative field {key} exists and is not a date")
    canonical_preexisting = CANONICAL in by_key
    legacy = by_key.get(LEGACY)
    if legacy and legacy.get("type") != "date":
        raise RuntimeError("Initiative field ActualEnd exists and is not a date")

    if legacy and portal_date_conflict and CANONICAL not in by_key:
        canonical = {**legacy, "key": CANONICAL, "built_in": True}
        for section in schema:
            if isinstance(section, dict) and legacy in (section.get("fields") or []):
                section["fields"].append(canonical)
                break
        by_key[CANONICAL] = canonical
    elif legacy and portal_date_conflict:
        pass
    elif legacy and CANONICAL not in by_key:
        legacy["key"] = CANONICAL
        by_key[CANONICAL] = legacy
    elif legacy:
        for section in schema:
            if isinstance(section, dict):
                section["fields"] = [
                    field
                    for field in (section.get("fields") or [])
                    if not isinstance(field, dict) or field.get("key") != LEGACY
                ]
    for key, label in (("actualStart", "Actual Start"), (CANONICAL, "Actual End")):
        existing = by_key.get(key)
        if existing:
            existing["built_in"] = True
            continue
        target = next(
            (
                section
                for section in schema
                if isinstance(section, dict)
                and any(
                    isinstance(field, dict) and field.get("key") in {"startDate", "endDate"}
                    for field in (section.get("fields") or [])
                )
            ),
            None,
        )
        if target is None:
            target = next(
                (
                    section
                    for section in schema
                    if isinstance(section, dict)
                    and section.get("section") in {"Timeline", "Cost & Timeline"}
                ),
                None,
            )
        if target is None:
            target = {"section": "Timeline", "fields": []}
            schema.append(target)
        if target.get("fields") is None:
            target["fields"] = []
        target["fields"].append(
            {"key": key, "label": label, "type": "date", "weight": 0, "built_in": True}
        )

    connection.execute(
        card_types.update()
        .where(card_types.c.key == "Initiative")
        .values(
            fields_schema=schema,
            subtypes=_rename_subtypes(current["subtypes"], portal_date_conflict),
            section_config=_rename_layout(current["section_config"], portal_date_conflict),
        )
    )
    for row in connection.execute(
        sa.select(cards.c.id, cards.c.attributes).where(
            cards.c.type == "Initiative", cards.c.attributes.has_key(LEGACY)
        )
    ).mappings():
        attrs = dict(row["attributes"] or {})
        if LEGACY not in attrs:
            continue
        if CANONICAL not in attrs and not protect_legacy:
            attrs[CANONICAL] = attrs.pop(LEGACY)
        elif not protect_legacy and CANONICAL in attrs and attrs[CANONICAL] == attrs[LEGACY]:
            attrs.pop(LEGACY)
        connection.execute(cards.update().where(cards.c.id == row["id"]).values(attributes=attrs))

    raw = connection.execute(
        sa.select(settings.c.general_settings).where(settings.c.id == "default")
    ).scalar_one_or_none()
    timeline = (raw or {}).get("pml.timeline")
    if isinstance(timeline, dict):
        updated = dict(timeline)
        for key in ("actual_start_key", "actual_end_key"):
            if updated.get(key) == LEGACY and not protect_legacy:
                updated[key] = CANONICAL
        if updated != timeline:
            connection.execute(
                settings.update()
                .where(settings.c.id == "default")
                .values(
                    general_settings=settings.c.general_settings.op("||")(
                        sa.literal({"pml.timeline": updated}, type_=JSONB)
                    )
                )
            )
    if not protect_legacy:
        for row in connection.execute(
            sa.select(calculations).where(calculations.c.target_type_key == "Initiative")
        ).mappings():
            formula = _rename_formula(row["formula"])
            target = CANONICAL if row["target_field_key"] == LEGACY else row["target_field_key"]
            if formula != row["formula"] or target != row["target_field_key"]:
                connection.execute(
                    calculations.update()
                    .where(calculations.c.id == row["id"])
                    .values(target_field_key=target, formula=formula)
                )
        connection.execute(
            snow_fields.update()
            .where(
                snow_fields.c.mapping_id.in_(
                    sa.select(snow_mappings.c.id).where(
                        snow_mappings.c.card_type_key == "Initiative"
                    )
                ),
                snow_fields.c.turbo_field == "attributes.ActualEnd",
            )
            .values(turbo_field="attributes.actualEnd")
        )
    for row in connection.execute(
        sa.select(portals).where(portals.c.card_type == "Initiative")
    ).mappings():
        if portal_date_conflict:
            display_fields = row["display_fields"]
            filters = row["filters"]
            config = dict(row["card_config"]) if isinstance(row["card_config"], dict) else {}
            toggles = dict(config.get("toggles") or {})
            if not canonical_preexisting and "field:actualEnd" not in toggles:
                toggles["field:actualEnd"] = {"card": False, "detail": False}
            config["toggles"] = toggles
        else:
            display_fields, config, filters = _portal_values(row)
        if (display_fields, config, filters) != (
            row["display_fields"],
            row["card_config"],
            row["filters"],
        ):
            connection.execute(
                portals.update()
                .where(portals.c.id == row["id"])
                .values(display_fields=display_fields, card_config=config, filters=filters)
            )


def upgrade():
    _upgrade_data(op.get_bind())


def downgrade():
    pass
