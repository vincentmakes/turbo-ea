"""The card-plus-context payload the portfolio-style reports filter on.

``GET /reports/app-portfolio`` (Application and Flexible Portfolio) and
``GET /reports/roadmap`` (the Lifecycle report, once a card type is chosen)
both hand the client every card of one type together with what the shared
filter section reads: its relations on each side, its tags, the relation types
reaching the type, the related cards as filter options (with the ancestor
closure that nested grouping and the *Include sub-cards* filter walk) and the
tag groups that apply. One builder, so the two reports cannot drift on what a
filter can see.

Reads only; never commits. The caller owns the permission check and passes its
``CardReadScope``, so every card read here stays inside the reader's scope.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.tag import CardTag, Tag, TagGroup
from app.services.card_read_scope import CardReadScope
from app.services.lifecycle import lifecycle_in_effect


async def build_portfolio_payload(
    db: AsyncSession,
    read_scope: CardReadScope,
    card_type: CardType,
    all_types: Sequence[CardType],
) -> dict:
    """Every ACTIVE card of ``card_type`` the reader may see, with its context.

    Returns ``{items, fields_schema, relation_types, groupable_types,
    organizations, tag_groups}``; each item carries ``relations`` (one entry
    per side it sits on), ``org_ids`` and ``tag_ids``.
    """
    type_key = card_type.key
    readable = read_scope.where(Card, mode="module")

    # 1. Get all active cards of the requested type
    apps_result = await db.execute(
        select(Card).where(Card.type == type_key, Card.status == "ACTIVE", *readable)
    )
    apps = apps_result.scalars().all()
    app_ids = [a.id for a in apps]
    app_id_set = {str(a.id) for a in apps}

    # 2. Get all relations touching those cards
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id.in_(app_ids)) | (Relation.target_id.in_(app_ids))
        )
    )
    rels = rels_result.scalars().all()

    # Collect all related card IDs
    related_ids: set[str] = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in app_id_set:
            related_ids.add(tid)
        else:
            related_ids.add(sid)
    related_ids -= app_id_set

    # 3. Fetch related cards in bulk. The portfolio's own cards are seeded
    # first: a self-referencing relation type links two portfolio cards, and
    # excluding them from `related_map` used to drop that relation entirely —
    # neither branch of the loop below could resolve its far end.
    related_map: dict[str, dict] = {
        str(a.id): {
            "id": str(a.id),
            "name": a.name,
            "type": a.type,
            "parent_id": str(a.parent_id) if a.parent_id else None,
        }
        for a in apps
    }
    if related_ids:
        rel_result = await db.execute(
            select(Card).where(
                Card.id.in_(list(related_ids)),
                Card.status == "ACTIVE",
                *readable,
            )
        )
        for card in rel_result.scalars().all():
            related_map[str(card.id)] = {
                "id": str(card.id),
                "name": card.name,
                "type": card.type,
                "parent_id": str(card.parent_id) if card.parent_id else None,
            }

    # 4. Build card -> relations lookup. Each entry carries the card's side
    # (`direction`): for a self-referencing type the same row is outgoing on
    # one portfolio card and incoming on the other, and the report's facets
    # split the two verbs on it. `if`/`if`, not `elif` — such a row must land
    # on BOTH cards.
    app_relations: dict[str, list[dict]] = {str(a.id): [] for a in apps}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in app_id_set and tid in related_map:
            app_relations[sid].append(_relation_entry(r, "outgoing", related_map[tid]))
        if tid in app_id_set and sid in related_map:
            app_relations[tid].append(_relation_entry(r, "incoming", related_map[sid]))

    # 4b. Ancestor closure for hierarchical related types: nested grouping needs
    # the full parent chain of every related member, including ancestors that
    # have no direct relation to any portfolio card. Added members are flagged
    # ancestor_only so the client can exclude them from direct-relation filters.
    hierarchical_type_keys = {t.key for t in all_types if t.has_hierarchy and not t.is_hidden}
    pending = {
        m["parent_id"]
        for m in related_map.values()
        if m["type"] in hierarchical_type_keys
        and m["parent_id"]
        and m["parent_id"] not in related_map
    }
    for _ in range(10):  # hierarchy depth is capped well below this
        if not pending:
            break
        anc_result = await db.execute(
            select(Card).where(Card.id.in_(list(pending)), Card.status == "ACTIVE", *readable)
        )
        pending = set()
        for card in anc_result.scalars().all():
            cid = str(card.id)
            if cid in related_map:
                continue
            parent_id = str(card.parent_id) if card.parent_id else None
            related_map[cid] = {
                "id": cid,
                "name": card.name,
                "type": card.type,
                "parent_id": parent_id,
                "ancestor_only": True,
            }
            if parent_id and parent_id not in related_map:
                pending.add(parent_id)

    # A parent the reader may not see was never loaded; drop the dangling
    # pointer so the member renders as a root instead of naming a hidden card.
    if not read_scope.is_unrestricted(mode="module"):
        for member in related_map.values():
            if member.get("parent_id") and member["parent_id"] not in related_map:
                member["parent_id"] = None

    # 5. Get relation types for label resolution
    rt_result = await db.execute(select(RelationType).where(RelationType.is_hidden.is_(False)))
    relation_types_list = rt_result.scalars().all()
    # One entry per relation type touching this card type. Several may share an
    # ``other_type_key`` (the metamodel allows any number of relation types per
    # ordered card-type pair); the grid groups them into a single column per related
    # type, so the payload must carry them all or the extra types become invisible.
    rel_type_defs = []
    for rt in relation_types_list:
        other = None
        if rt.source_type_key == type_key:
            other = rt.target_type_key
        elif rt.target_type_key == type_key:
            other = rt.source_type_key
        if other and read_scope.type_readable(other, mode="module"):
            rel_type_defs.append(
                {
                    "key": rt.key,
                    "label": rt.label,
                    "reverse_label": rt.reverse_label,
                    "source_type_key": rt.source_type_key,
                    "target_type_key": rt.target_type_key,
                    "other_type_key": other,
                    "translations": rt.translations or {},
                    "attributes_schema": rt.attributes_schema or [],
                }
            )

    # 6. Get card types (schema + visibility)
    visible_type_keys = {t.key for t in all_types if not t.is_hidden}
    fields_schema = card_type.fields_schema or []

    # 7. Get all organizations for org filter options (backwards-compat)
    orgs_result = await db.execute(
        select(Card)
        .where(Card.type == "Organization", Card.status == "ACTIVE", *readable)
        .order_by(Card.name)
    )
    orgs = orgs_result.scalars().all()

    # Build org mapping from relations
    org_ids = {str(o.id) for o in orgs}
    app_orgs: dict[str, set[str]] = {}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in org_ids and tid in app_id_set:
            app_orgs.setdefault(tid, set()).add(sid)
        elif tid in org_ids and sid in app_id_set:
            app_orgs.setdefault(sid, set()).add(tid)

    # Tag assignments + tag groups applicable to the requested card type
    app_tag_ids: dict[str, list[str]] = {}
    if app_ids:
        ct_rows = await db.execute(select(CardTag).where(CardTag.card_id.in_(app_ids)))
        for ct in ct_rows.scalars().all():
            app_tag_ids.setdefault(str(ct.card_id), []).append(str(ct.tag_id))

    tg_rows = await db.execute(select(TagGroup).order_by(TagGroup.name))
    tag_groups_payload = []
    for tg in tg_rows.scalars().all():
        if tg.restrict_to_types and type_key not in tg.restrict_to_types:
            continue
        t_rows = await db.execute(select(Tag).where(Tag.tag_group_id == tg.id).order_by(Tag.name))
        tag_groups_payload.append(
            {
                "id": str(tg.id),
                "name": tg.name,
                "mode": tg.mode,
                "tags": [
                    {"id": str(t.id), "name": t.name, "color": t.color}
                    for t in t_rows.scalars().all()
                ],
            }
        )

    # 8. Build response items
    items = []
    for a in apps:
        aid = str(a.id)
        items.append(
            {
                "id": aid,
                "name": a.name,
                "subtype": a.subtype,
                "attributes": a.attributes,
                "lifecycle": a.lifecycle,
                "relations": app_relations.get(aid, []),
                "org_ids": sorted(app_orgs.get(aid, set())),
                "tag_ids": app_tag_ids.get(aid, []),
            }
        )

    # 9. Collect groupable related types (visible only, with linked apps)
    groupable_types: dict[str, list[dict]] = {}
    for fs_data in related_map.values():
        ft = fs_data["type"]
        if ft not in visible_type_keys:
            continue
        if ft not in groupable_types:
            groupable_types[ft] = []
        groupable_types[ft].append(fs_data)
    # Sort members within each type
    for members in groupable_types.values():
        members.sort(key=lambda x: x["name"])

    organizations = [{"id": str(o.id), "name": o.name} for o in orgs]

    return {
        "items": items,
        "fields_schema": fields_schema,
        "relation_types": rel_type_defs,
        "groupable_types": groupable_types,
        "organizations": organizations,
        "tag_groups": tag_groups_payload,
    }


def _relation_entry(r: Relation, direction: str, related: dict) -> dict:
    """One side of one relation as a portfolio card sees it.

    Carries the relation's own ``lifecycle`` only when it has dates — absent
    means always in effect — so the time-travel reports can tell which related
    card a card is linked to at the travelled date, and the current-state
    surfaces built on this payload can keep only what is in effect today.
    """
    entry = {
        "relation_type": r.type,
        "direction": direction,
        "related_id": related["id"],
        "related_name": related["name"],
        "related_type": related["type"],
        "attributes": r.attributes or {},
    }
    if r.lifecycle:
        entry["lifecycle"] = r.lifecycle
    return entry


def relations_in_effect_now(relations: Sequence[dict], *, today: date | None = None) -> list[dict]:
    """A card's ``relations`` entries (``_relation_entry`` shape) as a
    current-state surface needs them: only the relations in effect ``today``
    (default: today, UTC) by their own dates, each without its ``lifecycle`` —
    a surface with no time travel has nothing to spend the dates on.

    Shared by every consumer of this payload that shows the landscape now (the
    Lifecycle report's filters, the PPM board's filters); the time-travel
    reports read the dates themselves and keep every entry.
    """
    return [
        {k: v for k, v in rel.items() if k != "lifecycle"}
        for rel in relations
        if lifecycle_in_effect(rel.get("lifecycle"), on=today)
    ]


def has_timeline_dates(lifecycle: dict | None, attributes: dict | None) -> bool:
    """Whether a card has anything the Lifecycle report can draw: a lifecycle
    phase date, or a ``startDate`` / ``endDate`` attribute for the date-range
    view."""
    attrs = attributes or {}
    return any((lifecycle or {}).values()) or bool(attrs.get("startDate") or attrs.get("endDate"))


async def dated_relations_by_card(
    db: AsyncSession, read_scope: CardReadScope, *, type_key: str | None
) -> dict[str, list[dict]]:
    """Every relation with its own lifecycle dates, listed on each card it
    belongs to — the Lifecycle report's relation sub-rows.

    All-time on purpose: the report draws planned and ended relations on its
    time axis, so a relation not in effect today is listed like any other.
    Both ends must be ACTIVE and inside the reader's scope (module mode), and
    neither the relation type nor either card type may be hidden; a relation
    whose far end the reader may not see does not exist for them. With
    ``type_key``, only relations touching a card of that type, listed on
    those cards.

    Each entry is ``{relation_type, direction, related_id, related_name,
    related_type, lifecycle}`` from the listing card's side. No
    ``attributes``: a relation attribute may be a cost, and this list is not
    redacted for cost. A self-referencing row lands on both of its cards,
    once per side. Each card's list is sorted by the other card's name
    (case-insensitive), then relation type, direction and id.
    """
    src = aliased(Card, name="dated_rel_source")
    tgt = aliased(Card, name="dated_rel_target")
    hidden_types = select(CardType.key).where(CardType.is_hidden.is_(True))
    q = (
        select(
            Relation.type,
            Relation.lifecycle,
            src.id,
            src.name,
            src.type,
            tgt.id,
            tgt.name,
            tgt.type,
        )
        .join(src, src.id == Relation.source_id)
        .join(tgt, tgt.id == Relation.target_id)
        .join(RelationType, RelationType.key == Relation.type)
        .where(
            Relation.lifecycle != {},
            RelationType.is_hidden.is_(False),
            src.status == "ACTIVE",
            tgt.status == "ACTIVE",
            src.type.not_in(hidden_types),
            tgt.type.not_in(hidden_types),
            *read_scope.where(src, mode="module"),
            *read_scope.where(tgt, mode="module"),
        )
    )
    if type_key is not None:
        q = q.where(or_(src.type == type_key, tgt.type == type_key))
    rows = (await db.execute(q)).all()

    out: dict[str, list[dict]] = {}

    def add(card_id, direction: str, rel_type: str, lifecycle: dict, oid, oname, otype) -> None:
        out.setdefault(str(card_id), []).append(
            {
                "relation_type": rel_type,
                "direction": direction,
                "related_id": str(oid),
                "related_name": oname,
                "related_type": otype,
                "lifecycle": lifecycle,
            }
        )

    for rel_type, lifecycle, sid, sname, stype, tid, tname, ttype in rows:
        if not any((lifecycle or {}).values()):
            continue
        if type_key is None or stype == type_key:
            add(sid, "outgoing", rel_type, lifecycle, tid, tname, ttype)
        if type_key is None or ttype == type_key:
            add(tid, "incoming", rel_type, lifecycle, sid, sname, stype)
    for entries in out.values():
        entries.sort(
            key=lambda e: (
                e["related_name"].casefold(),
                e["relation_type"],
                e["direction"],
                e["related_id"],
            )
        )
    return out


def roadmap_rows(
    cards: Sequence[Card],
    redact: dict,
    relation_lifecycles: dict[str, list[dict]],
) -> list[dict]:
    """The type-less roadmap's rows (*All types*, or a type the reader cannot
    use): every card the report can draw — its own dates, or dated relations
    (``relation_lifecycles``, added only when non-empty) — with the cost
    attributes ``redact`` names (``card_cost_redaction_map``) stripped."""
    items = []
    for card in cards:
        lc = card.lifecycle or {}
        attrs = card.attributes or {}
        dated = relation_lifecycles.get(str(card.id), [])
        if not (has_timeline_dates(lc, attrs) or dated):
            continue
        strip = redact.get(card.id)
        if strip:
            attrs = {k: v for k, v in attrs.items() if k not in strip}
        row: dict = {
            "id": str(card.id),
            "name": card.name,
            "type": card.type,
            "subtype": card.subtype,
            "lifecycle": lc,
            "attributes": attrs,
        }
        if dated:
            row["relation_lifecycles"] = dated
        items.append(row)
    return items


def roadmap_from_portfolio(
    payload: dict, type_key: str, relation_lifecycles: dict[str, list[dict]]
) -> dict:
    """The Lifecycle report's view of a portfolio payload: only the cards it
    can draw, each stamped with its ``type`` like the type-less roadmap's rows,
    plus everything its filter section reads. ``organizations`` and per-card
    ``org_ids`` are the portfolio's legacy organisation filter and stay out.

    ``relation_lifecycles`` (``dated_relations_by_card``) adds each card's
    dated relations as ``relation_lifecycles`` — only when it has any — and
    keeps a card with no dates of its own when it has some, so its relations
    can be drawn beneath it."""
    items = []
    for item in payload["items"]:
        dated = relation_lifecycles.get(item["id"], [])
        if not (has_timeline_dates(item["lifecycle"], item["attributes"]) or dated):
            continue
        row = {
            "id": item["id"],
            "name": item["name"],
            "type": type_key,
            "subtype": item["subtype"],
            "lifecycle": item["lifecycle"] or {},
            "attributes": item["attributes"] or {},
            # The Lifecycle report has no time travel: it filters the portfolio
            # as it is today, so a relation matches only while it is in effect.
            "relations": relations_in_effect_now(item["relations"]),
            "tag_ids": item["tag_ids"],
        }
        if dated:
            row["relation_lifecycles"] = dated
        items.append(row)
    return {
        "items": items,
        "fields_schema": payload["fields_schema"],
        "relation_types": payload["relation_types"],
        "groupable_types": payload["groupable_types"],
        "tag_groups": payload["tag_groups"],
    }
