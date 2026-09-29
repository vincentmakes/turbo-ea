"""LeanIX Integration API bundle writer — the format LeanIX itself ingests.

LeanIX has no self-service import of its own *Full Snapshot* workbook
(SAP clones a snapshot on a support ticket), so the reverse of the
importer cannot be "the workbook back". The one bulk path an admin can
drive alone is the **Integration API**: an LDIF document (LeanIX Data
Interchange Format, plain JSON) processed by a *processor
configuration* that says how each content item becomes a fact sheet,
a relation, a tag, a subscription or a document. Both are pasted into
Administration → Integration API and executed with *Test run* (a dry
run) or *Run*, or sent over REST.

This module turns a :class:`MigrationSnapshot` built from the Turbo EA
inventory (:func:`app.services.migration.export_snapshot.build_export_snapshot`)
into a ``.zip`` holding:

- ``ldif.json`` — the data: one content item per card (``type`` = the
  LeanIX fact-sheet type, ``id`` = the card id, ``data`` = fields,
  lifecycle, tags, subscriptions, documents, parent) and one per
  relation (``type`` = the LeanIX relation name, ``data.from`` /
  ``data.to`` = card ids), hierarchy as ``relToParent`` items.
- ``processors.json`` — the matching processor configuration, generated
  from the metamodel actually exported so every content type has a
  processor and every field the cards carry has an update.
- ``comments.json`` — comments, which the Integration API cannot
  import; kept for reference.
- ``README.md`` — how to load the bundle, what LeanIX will require of
  the target meta model, and what to trim.

Names are translated through the export tables in ``mappings.py``
(``EXPORT_TYPE_MAPPING``, ``EXPORT_RELATION_API_MAPPING``,
``EXPORT_FLIP_DIRECTION``); an admin-created card or relation type
keeps its Turbo EA key, which LeanIX accepts only once the same type
exists in its meta model — the README says so.

Two conventions the processors rely on and the tests pin:

- **Identity is the card id, stored as the fact sheet's ``externalId``.**
  Every ``identifier`` / ``from`` / ``to`` is
  ``{"external": {"id": …, "type": "externalId"}}``, so a re-run of the
  same bundle updates rather than duplicates, and relations resolve
  without knowing LeanIX's internal ids.
- **Field updates keep the existing value when the item has none.**
  Every update reads ``${data.<x> != null ? data.<x> : lx.factsheet.<x>}``
  so ``processingMode: "partial"`` never blanks a field the export did
  not carry.
"""

from __future__ import annotations

import json
import zipfile
from collections import defaultdict
from datetime import date, datetime
from io import BytesIO
from typing import Any

from app.services.migration.snapshot import (
    MetamodelField,
    MigrationSnapshot,
    Relation,
    SourceEntity,
)
from app.services.migration.sources.leanix.mappings import (
    EXPORT_FLIP_DIRECTION,
    EXPORT_RELATION_API_MAPPING,
    EXPORT_TYPE_MAPPING,
)

CONNECTOR_TYPE = "turbo-ea-export"
CONNECTOR_ID = "turbo-ea"
CONNECTOR_VERSION = "1.0.0"
LX_VERSION = "1.0.0"
PARENT_RELATION = "relToParent"

LDIF_FILE = "ldif.json"
PROCESSORS_FILE = "processors.json"
COMMENTS_FILE = "comments.json"
README_FILE = "README.md"

_LIFECYCLE_PHASES = ("plan", "phaseIn", "active", "phaseOut", "endOfLife")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_bundle(snapshot: MigrationSnapshot) -> bytes:
    """Serialise ``snapshot`` as a LeanIX Integration API bundle (zip bytes)."""
    plan = _Plan(snapshot)
    ldif = build_ldif(snapshot, plan)
    processors = build_processors(snapshot, plan)
    comments = build_comments(snapshot, plan)
    readme = build_readme(snapshot, plan, ldif, processors)

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(README_FILE, readme)
        zf.writestr(LDIF_FILE, _dumps(ldif))
        zf.writestr(PROCESSORS_FILE, _dumps(processors))
        zf.writestr(COMMENTS_FILE, _dumps(comments))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Plan — lookups shared by the three documents
# ---------------------------------------------------------------------------


class _Plan:
    def __init__(self, snapshot: MigrationSnapshot) -> None:
        self.entity_by_id: dict[str, SourceEntity] = {e.source_id: e for e in snapshot.entities}
        self.tag_by_id = {t.source_id: t for t in snapshot.tags}
        self.fields_by_type: dict[str, list[MetamodelField]] = {
            mt.name: list(mt.fields) for mt in snapshot.metamodel_types
        }
        self.subscriptions_by_entity: dict[str, list] = defaultdict(list)
        for sub in snapshot.subscriptions:
            self.subscriptions_by_entity[sub.entity_id].append(sub)
        self.documents_by_entity: dict[str, list] = defaultdict(list)
        for doc in snapshot.documents:
            self.documents_by_entity[doc.entity_id].append(doc)

        # LeanIX fact-sheet type → the Turbo EA types that land on it, in
        # metamodel order, entities-bearing types only.
        metamodel_order = [mt.name for mt in snapshot.metamodel_types]
        used = {e.type for e in snapshot.entities}
        ordered_types = [t for t in metamodel_order if t in used] + sorted(
            used - set(metamodel_order)
        )
        self.tea_types_by_lx_type: dict[str, list[str]] = {}
        for tea_type in ordered_types:
            self.tea_types_by_lx_type.setdefault(lx_type_name(tea_type), []).append(tea_type)

        # LeanIX relation name → Turbo EA relation keys, relation-bearing only.
        rel_order = [rt.name for rt in snapshot.metamodel_relation_types]
        used_rels = {r.type for r in snapshot.relations}
        ordered_rels = [k for k in rel_order if k in used_rels] + sorted(used_rels - set(rel_order))
        self.tea_rels_by_lx_rel: dict[str, list[str]] = {}
        for key in ordered_rels:
            self.tea_rels_by_lx_rel.setdefault(lx_relation_name(key), []).append(key)
        self.has_hierarchy = any(
            e.parent_id and e.parent_id in self.entity_by_id for e in snapshot.entities
        )

    # ---- per LeanIX type -----------------------------------------------

    def field_keys_for(self, lx_type: str) -> list[str]:
        """Attribute keys the exported cards of this type carry: schema order first."""
        tea_types = self.tea_types_by_lx_type.get(lx_type, [])
        used: set[str] = set()
        for entity in self.entity_by_id.values():
            if entity.type in tea_types:
                used.update(k for k in entity.custom_fields if k not in ("externalId", "alias"))
        ordered: list[str] = []
        for tea_type in tea_types:
            for f in self.fields_by_type.get(tea_type, []):
                if f.key in used and f.key not in ordered:
                    ordered.append(f.key)
        ordered.extend(sorted(used - set(ordered)))
        return ordered

    def lifecycle_phases_for(self, lx_type: str) -> list[str]:
        tea_types = self.tea_types_by_lx_type.get(lx_type, [])
        used: set[str] = set()
        for entity in self.entity_by_id.values():
            if entity.type in tea_types:
                used.update(entity.lifecycle)
        return [p for p in _LIFECYCLE_PHASES if p in used] + sorted(used - set(_LIFECYCLE_PHASES))

    def entities_of(self, lx_type: str) -> list[SourceEntity]:
        tea_types = set(self.tea_types_by_lx_type.get(lx_type, []))
        return [e for e in self.entity_by_id.values() if e.type in tea_types]

    def has_subtype(self, lx_type: str) -> bool:
        return any(e.category for e in self.entities_of(lx_type))

    def has_tags(self, lx_type: str) -> bool:
        return any(e.tags for e in self.entities_of(lx_type))

    def has_subscriptions(self, lx_type: str) -> bool:
        return any(self.subscriptions_by_entity.get(e.source_id) for e in self.entities_of(lx_type))

    def has_documents(self, lx_type: str) -> bool:
        return any(self.documents_by_entity.get(e.source_id) for e in self.entities_of(lx_type))


# ---------------------------------------------------------------------------
# ldif.json
# ---------------------------------------------------------------------------


def build_ldif(snapshot: MigrationSnapshot, plan: _Plan | None = None) -> dict[str, Any]:
    plan = plan or _Plan(snapshot)
    content: list[dict[str, Any]] = []

    for lx_type in plan.tea_types_by_lx_type:
        for entity in plan.entities_of(lx_type):
            content.append(
                {"type": lx_type, "id": entity.source_id, "data": _fact_sheet_data(entity, plan)}
            )

    for entity in snapshot.entities:
        if entity.parent_id and entity.parent_id in plan.entity_by_id:
            content.append(
                {
                    "type": PARENT_RELATION,
                    "id": f"{PARENT_RELATION}:{entity.source_id}",
                    "data": {"from": entity.source_id, "to": entity.parent_id, "attributes": {}},
                }
            )

    for rel in snapshot.relations:
        item = _relation_item(rel, plan)
        if item is not None:
            content.append(item)

    return {
        "connectorType": CONNECTOR_TYPE,
        "connectorId": CONNECTOR_ID,
        "connectorVersion": CONNECTOR_VERSION,
        "lxVersion": LX_VERSION,
        "description": "Turbo EA workspace export",
        "processingDirection": "inbound",
        "processingMode": "partial",
        "customFields": {},
        "content": content,
    }


def _fact_sheet_data(entity: SourceEntity, plan: _Plan) -> dict[str, Any]:
    fields = {
        k: _json_value(v)
        for k, v in entity.custom_fields.items()
        if k not in ("externalId", "alias") and v not in (None, "")
    }
    tags: list[dict[str, str]] = []
    for tag_id in entity.tags:
        tag = plan.tag_by_id.get(tag_id)
        if tag and tag.group_name:
            tags.append({"group": tag.group_name, "name": tag.name})
    subscriptions = [
        {
            "email": sub.user_email,
            "type": sub.role_type or "RESPONSIBLE",
            "role": sub.role_name or "",
        }
        for sub in plan.subscriptions_by_entity.get(entity.source_id, [])
        if sub.user_email
    ]
    documents = [
        {"name": doc.name, "url": doc.url}
        for doc in plan.documents_by_entity.get(entity.source_id, [])
        if doc.url
    ]
    data: dict[str, Any] = {
        "name": entity.name,
        "displayName": entity.display_name or entity.name,
        "description": entity.description or "",
        "category": entity.category,
        "status": entity.status or "ACTIVE",
        "lifecycle": {k: v for k, v in entity.lifecycle.items() if v},
        "fields": fields,
        "parentId": entity.parent_id if entity.parent_id in plan.entity_by_id else None,
        "tags": tags,
        "subscriptions": subscriptions,
        "documents": documents,
    }
    if entity.custom_fields.get("externalId"):
        data["sourceExternalId"] = entity.custom_fields["externalId"]
    if entity.custom_fields.get("alias"):
        data["alias"] = entity.custom_fields["alias"]
    return data


def _relation_item(rel: Relation, plan: _Plan) -> dict[str, Any] | None:
    if rel.from_entity_id not in plan.entity_by_id or rel.to_entity_id not in plan.entity_by_id:
        return None
    src, tgt = rel.from_entity_id, rel.to_entity_id
    if rel.type in EXPORT_FLIP_DIRECTION:
        src, tgt = tgt, src
    return {
        "type": lx_relation_name(rel.type),
        "id": rel.source_id,
        "data": {
            "from": src,
            "to": tgt,
            "attributes": {k: _json_value(v) for k, v in (rel.attributes or {}).items()},
        },
    }


# ---------------------------------------------------------------------------
# processors.json
# ---------------------------------------------------------------------------


def build_processors(snapshot: MigrationSnapshot, plan: _Plan | None = None) -> dict[str, Any]:
    plan = plan or _Plan(snapshot)
    processors: list[dict[str, Any]] = []

    for lx_type in plan.tea_types_by_lx_type:
        processors.append(_fact_sheet_processor(lx_type, plan))

    if plan.has_hierarchy:
        processors.append(_relation_processor(PARENT_RELATION, "Hierarchy (child → parent)"))
    for lx_rel in plan.tea_rels_by_lx_rel:
        processors.append(_relation_processor(lx_rel, f"Relation {lx_rel}"))

    for lx_type in plan.tea_types_by_lx_type:
        if plan.has_tags(lx_type):
            processors.append(_tag_processor(lx_type))
        if plan.has_subscriptions(lx_type):
            processors.append(_subscription_processor(lx_type))
        if plan.has_documents(lx_type):
            processors.append(_document_processor(lx_type))

    return {
        "connectorType": CONNECTOR_TYPE,
        "connectorId": CONNECTOR_ID,
        "connectorVersion": CONNECTOR_VERSION,
        "processingDirection": "inbound",
        "processingMode": "partial",
        "processors": processors,
    }


def _identifier(id_expr: str) -> dict[str, Any]:
    return {"external": {"id": {"expr": id_expr}, "type": {"expr": "externalId"}}}


def _keep_existing(data_path: str, factsheet_path: str) -> str:
    """EL that writes the exported value and keeps LeanIX's when there is none."""
    return f"${{{data_path} != null ? {data_path} : lx.factsheet.{factsheet_path}}}"


def _update(key: str, expr: str) -> dict[str, Any]:
    return {"key": {"expr": key}, "values": [{"expr": expr}]}


def _fact_sheet_processor(lx_type: str, plan: _Plan) -> dict[str, Any]:
    updates = [
        _update("name", "${data.name}"),
        _update("description", _keep_existing("data.description", "description")),
    ]
    if plan.has_subtype(lx_type):
        updates.append(_update("category", _keep_existing("data.category", "category")))
    if any(e.custom_fields.get("alias") for e in plan.entities_of(lx_type)):
        updates.append(_update("alias", _keep_existing("data.alias", "alias")))
    for phase in plan.lifecycle_phases_for(lx_type):
        updates.append(
            _update(
                f"lifecycle.{phase}",
                _keep_existing(f"data.lifecycle.{phase}", f"lifecycle.{phase}"),
            )
        )
    for key in plan.field_keys_for(lx_type):
        updates.append(_update(key, _keep_existing(f"data.fields.{key}", key)))
    return {
        "processorType": "inboundFactSheet",
        "processorName": f"Fact sheets: {lx_type}",
        "processorDescription": (
            f"Creates or updates {lx_type} fact sheets; the Turbo EA card id is the externalId."
        ),
        "type": lx_type,
        "filter": {"type": lx_type},
        "identifier": _identifier("${content.id}"),
        "run": 0,
        "updates": updates,
        "enabled": True,
        "logLevel": "warning",
    }


def _relation_processor(lx_rel: str, name: str) -> dict[str, Any]:
    return {
        "processorType": "inboundRelation",
        "processorName": name,
        "processorDescription": f"Creates {lx_rel} relations between the exported fact sheets.",
        "type": lx_rel,
        "filter": {"type": lx_rel},
        "from": _identifier("${data.from}"),
        "to": _identifier("${data.to}"),
        "run": 1,
        "enabled": True,
        "logLevel": "warning",
    }


def _tag_processor(lx_type: str) -> dict[str, Any]:
    return {
        "processorType": "inboundTag",
        "processorName": f"Tags: {lx_type}",
        "processorDescription": f"Assigns the exported tags to {lx_type} fact sheets.",
        "filter": {"type": lx_type},
        "identifier": _identifier("${content.id}"),
        "forEach": "${data.tags}",
        "run": 1,
        "updates": [
            _update("group.name", "${integration.valueOfForEach.group}"),
            _update("name", "${integration.valueOfForEach.name}"),
        ],
        "enabled": True,
        "logLevel": "warning",
    }


def _subscription_processor(lx_type: str) -> dict[str, Any]:
    return {
        "processorType": "inboundSubscription",
        "processorName": f"Subscriptions: {lx_type}",
        "processorDescription": (
            f"Subscribes the exported stakeholders to {lx_type} fact sheets "
            "(users must exist in the workspace)."
        ),
        "filter": {"type": lx_type},
        "identifier": _identifier("${content.id}"),
        "forEach": "${data.subscriptions}",
        "run": 1,
        "updates": [
            _update("user", "${integration.valueOfForEach.email}"),
            _update("subscriptionType", "${integration.valueOfForEach.type}"),
            {
                "key": {"expr": "subscriptionRoles"},
                "values": [
                    {"map": [{"key": "roleName", "value": "${integration.valueOfForEach.role}"}]}
                ],
            },
        ],
        "enabled": True,
        "logLevel": "warning",
    }


def _document_processor(lx_type: str) -> dict[str, Any]:
    return {
        "processorType": "inboundDocument",
        "processorName": f"Resources: {lx_type}",
        "processorDescription": f"Adds the exported links as resources on {lx_type} fact sheets.",
        "filter": {"type": lx_type},
        "identifier": _identifier("${content.id}"),
        "forEach": "${data.documents}",
        "run": 1,
        "updates": [
            _update("name", "${integration.valueOfForEach.name}"),
            _update("url", "${integration.valueOfForEach.url}"),
        ],
        "enabled": True,
        "logLevel": "warning",
    }


# ---------------------------------------------------------------------------
# comments.json + README.md
# ---------------------------------------------------------------------------


def build_comments(snapshot: MigrationSnapshot, plan: _Plan | None = None) -> list[dict[str, Any]]:
    plan = plan or _Plan(snapshot)
    out: list[dict[str, Any]] = []
    for c in snapshot.comments:
        entity = plan.entity_by_id.get(c.entity_id)
        if entity is None:
            continue
        out.append(
            {
                "factSheetId": entity.source_id,
                "factSheetType": lx_type_name(entity.type),
                "factSheet": entity.display_name or entity.name,
                "author": c.author_email,
                "createdAt": c.created_at.isoformat() if c.created_at else None,
                "message": c.body,
            }
        )
    return out


def build_readme(
    snapshot: MigrationSnapshot,
    plan: _Plan,
    ldif: dict[str, Any],
    processors: dict[str, Any],
) -> str:
    counts: dict[str, int] = defaultdict(int)
    for item in ldif["content"]:
        counts[item["type"]] += 1
    type_rows = "\n".join(
        f"| `{lx}` | {', '.join(f'`{t}`' for t in teas)} | {counts[lx]} |"
        for lx, teas in plan.tea_types_by_lx_type.items()
    )
    rel_rows = "\n".join(
        f"| `{lx}` | {', '.join(f'`{t}`' for t in teas)} | {counts[lx]} |"
        for lx, teas in plan.tea_rels_by_lx_rel.items()
    )
    if plan.has_hierarchy:
        rel_rows = (
            f"| `{PARENT_RELATION}` | hierarchy (`parent_id`) | {counts[PARENT_RELATION]} |\n"
            + (rel_rows)
        )
    unknown_types = [
        lx for lx in plan.tea_types_by_lx_type if lx not in EXPORT_TYPE_MAPPING.values()
    ]
    unknown_rels = [
        lx for lx in plan.tea_rels_by_lx_rel if lx not in EXPORT_RELATION_API_MAPPING.values()
    ]
    return f"""# Turbo EA → SAP LeanIX export

This bundle is a **LeanIX Integration API** import: `ldif.json` holds the data in the
LeanIX Data Interchange Format and `processors.json` holds the processor configuration
that turns it into fact sheets, relations, tags, subscriptions and resources. LeanIX's
own *Full Snapshot* workbook cannot be imported by customers (SAP restores snapshots on
request), so the Integration API is the self-service path.

- Fact sheets: {sum(counts[lx] for lx in plan.tea_types_by_lx_type)}
- Relations: {sum(counts[lx] for lx in plan.tea_rels_by_lx_rel) + counts[PARENT_RELATION]}
- Processors: {len(processors["processors"])}
- Comments (reference only, see `comments.json`): {len(snapshot.comments)}

## Load it in LeanIX

**In the browser**

1. Open **Administration → Integration API** and create a new processor configuration
   with connector type `{CONNECTOR_TYPE}`, connector id `{CONNECTOR_ID}`, connector version
   `{CONNECTOR_VERSION}`, processing direction *inbound*, processing mode *partial*.
2. Paste the contents of `processors.json` as the configuration.
3. Paste the contents of `ldif.json` into the input (LDIF) panel.
4. Click **Test run** first. It writes nothing and lists every problem — most often a field,
   subtype, relation type or user the target workspace does not have (see below).
5. Click **Run**.

**Over REST** (API token with admin rights; replace `{{host}}` and `{{token}}`)

```bash
BASE=https://{{host}}/services/integration-api/v1
curl -X PUT  "$BASE/configurations" -H "Authorization: Bearer {{token}}" \\
     -H "Content-Type: application/json" --data @processors.json
RUN=$(curl -s -X POST "$BASE/synchronizationRuns" -H "Authorization: Bearer {{token}}" \\
     -H "Content-Type: application/json" --data @ldif.json | jq -r .id)
curl -X POST "$BASE/synchronizationRuns/$RUN/start?test=false" -H "Authorization: Bearer {{token}}"
curl "$BASE/synchronizationRuns/$RUN/status" -H "Authorization: Bearer {{token}}"
```

## How the data is mapped

- The Turbo EA card id is written as the fact sheet's **externalId** and every identifier
  in the processors resolves through it, so running the same bundle twice updates the
  fact sheets it created instead of duplicating them.
- `processingMode` is **partial**: nothing in the target workspace is deleted, and every
  update keeps the existing LeanIX value when the exported card has none.
- Lifecycle phases, the subtype (`category`), the description and every attribute a card
  carries are written under their Turbo EA keys. Turbo EA's built-in keys mirror LeanIX's
  (`businessCriticality`, `functionalSuitability`, `costTotalAnnual`, …); a key the target
  meta model does not have makes the Test run report an error for that update — add the
  field in LeanIX or remove that `updates` entry from `processors.json`.
- Hierarchy becomes `relToParent`; lineage relations are written in LeanIX's direction
  (`from` = the older fact sheet). Relation attributes are kept in each relation item's
  `data.attributes` but not applied, because Turbo EA's relation fields do not exist in
  LeanIX by default — add an `updates` entry to the relation processor to map one.
- Tags are created in their tag group when missing. Subscriptions need the user to exist
  in the workspace and the role name to exist as a subscription role.
- Comments cannot be imported through the Integration API; they are in `comments.json`.

### Fact-sheet types

| LeanIX type | Turbo EA type(s) | Fact sheets |
|---|---|---|
{type_rows}

### Relation types

| LeanIX relation | Turbo EA relation(s) | Relations |
|---|---|---|
{rel_rows}

{_unknown_section(unknown_types, unknown_rels)}
The technical names above are LeanIX's default meta model names as they appear in LeanIX
exports. If your workspace uses different technical names (a renamed type, an added
relation), edit the `type` and `filter.type` values in `processors.json` and the matching
`type` of the content items in `ldif.json` before running.
"""


def _unknown_section(unknown_types: list[str], unknown_rels: list[str]) -> str:
    if not unknown_types and not unknown_rels:
        return ""
    lines = ["### Types LeanIX does not have by default", ""]
    lines.append(
        "These come from types added in Turbo EA and are exported under their Turbo EA key. "
        "Create them in the LeanIX meta model (Administration → Meta Model) under the same "
        "technical name before running, or drop their processors and content items."
    )
    lines.append("")
    for t in unknown_types:
        lines.append(f"- fact-sheet type `{t}`")
    for r in unknown_rels:
        lines.append(f"- relation type `{r}`")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def lx_type_name(tea_type: str) -> str:
    return EXPORT_TYPE_MAPPING.get(tea_type, tea_type)


def lx_relation_name(tea_key: str) -> str:
    return EXPORT_RELATION_API_MAPPING.get(tea_key, tea_key)


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [_json_value(v) for v in value]
    return value


def _dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n"
