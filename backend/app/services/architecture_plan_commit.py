"""Architecture-plan commit service — creates the Initiative, proposed cards,
relations, and an optional draft ADR from a manual architecture plan, and
stamps an end-of-life lifecycle date on removed/replaced cards.

Synchronous by design: unlike the TurboLens commit (which is a background task
only because AI description generation is slow) a manual plan commit is a
handful of DB inserts and runs inside a single request/transaction.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.architecture_plan import ArchitecturePlan
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services.data_quality import calc_data_quality
from app.services.turbolens_commit import (
    INITIATIVE_RELATION_MAP,
    _next_adr_reference,
)

logger = logging.getLogger("turboea.arch_plan.commit")


class _RelationTypeIndex:
    """Small cache of relation types keyed by relation-type key."""

    def __init__(self) -> None:
        self._by_key: dict[str, RelationType | None] = {}

    async def get(self, db: AsyncSession, key: str) -> RelationType | None:
        if key not in self._by_key:
            result = await db.execute(
                select(RelationType).where(
                    RelationType.key == key, RelationType.is_hidden.is_(False)
                )
            )
            self._by_key[key] = result.scalar_one_or_none()
        return self._by_key[key]


def _cost_field_keys(fields_schema: list | None) -> list[str]:
    """Cost-field keys of a card type (fields declared ``type == "cost"``)."""
    keys: list[str] = []
    for section in fields_schema or []:
        for field in section.get("fields", []) if isinstance(section, dict) else []:
            if field.get("type") == "cost":
                keys.append(field["key"])
    return keys


class _CardTypeIndex:
    """Small cache of card types keyed by type key (for cost-field lookup)."""

    def __init__(self) -> None:
        self._by_key: dict[str, CardType | None] = {}

    async def get(self, db: AsyncSession, key: str) -> CardType | None:
        if key not in self._by_key:
            result = await db.execute(select(CardType).where(CardType.key == key))
            self._by_key[key] = result.scalar_one_or_none()
        return self._by_key[key]

    async def cost_keys(self, db: AsyncSession, key: str) -> list[str]:
        ct = await self.get(db, key)
        return _cost_field_keys(ct.fields_schema if ct else None)


def _compute_plan_insights(
    baseline: dict, changes: list[dict], cost_keys_by_type: dict[str, list[str]]
) -> dict:
    """Server-side mirror of the frontend planInsights: gap counts, cost delta,
    and capability-coverage gaps computed from the snapshot + change ops, so the
    committed ADR carries the same figures the UI showed. Pure and deterministic.
    """
    nodes: dict[str, dict] = {}
    names: dict[str, str] = {}
    for n in baseline.get("nodes", []):
        if not isinstance(n, dict) or not n.get("id"):
            continue
        nodes[n["id"]] = {
            "type": n.get("type", ""),
            "attributes": n.get("attributes"),
            "changeState": None,
        }
        names[n["id"]] = n.get("name", n["id"])
    baseline_edges = [
        {"source": e.get("source"), "target": e.get("target"), "type": e.get("type")}
        for e in baseline.get("edges", [])
        if isinstance(e, dict)
    ]
    edges = [dict(e, changeState=None) for e in baseline_edges]
    estimates: dict[str, float] = {}
    remove_rel = [c for c in changes if c.get("op") == "remove_relation"]

    def _rel_removed(s: str, t: str, ty: str) -> bool:
        return any(
            r.get("sourceId") == s and r.get("targetId") == t and r.get("relationType") == ty
            for r in remove_rel
        )

    def _add_node(ref: dict, change_state: str) -> str | None:
        proposed = ref.get("proposed")
        if proposed:
            tid = proposed.get("tempId") or f"tmp:{uuid.uuid4()}"
            nodes[tid] = {
                "type": proposed.get("cardTypeKey", ""),
                "attributes": None,
                "changeState": change_state,
            }
            names[tid] = proposed.get("name", tid)
            est = proposed.get("estimatedCost")
            if isinstance(est, (int, float)):
                estimates[tid] = float(est)
            return tid
        existing = ref.get("existingCardId")
        if existing:
            node = nodes.setdefault(existing, {"type": "", "attributes": None, "changeState": None})
            node["changeState"] = change_state
            return existing
        return None

    for c in changes:
        op = c.get("op")
        if op == "add_card":
            _add_node(c.get("card") or {}, "added")
        elif op == "remove_card":
            cid = c.get("cardId")
            if cid in nodes:
                nodes[cid]["changeState"] = "removed"
            for e in edges:
                if e["source"] == cid or e["target"] == cid:
                    e["changeState"] = "removed"
        elif op == "replace_card":
            pid = c.get("predecessorId")
            sid = _add_node(c.get("successor") or {}, "changed")
            if sid:
                for be in baseline_edges:
                    if be["source"] != pid and be["target"] != pid:
                        continue
                    ns = sid if be["source"] == pid else be["source"]
                    nt = sid if be["target"] == pid else be["target"]
                    if _rel_removed(be["source"], be["target"], be["type"]) or _rel_removed(
                        ns, nt, be["type"]
                    ):
                        continue
                    other = be["target"] if be["source"] == pid else be["source"]
                    if nodes.get(other, {}).get("changeState") == "removed":
                        continue
                    edges.append(
                        {"source": ns, "target": nt, "type": be["type"], "changeState": "changed"}
                    )
            if pid in nodes:
                nodes[pid]["changeState"] = "removed"
            for e in edges:
                if (e["source"] == pid or e["target"] == pid) and e["changeState"] is None:
                    e["changeState"] = "removed"
        elif op == "add_relation":
            edges.append(
                {
                    "source": c.get("sourceId"),
                    "target": c.get("targetId"),
                    "type": c.get("relationType"),
                    "changeState": "added",
                }
            )
        elif op == "remove_relation":
            for e in edges:
                if (
                    e["source"] == c.get("sourceId")
                    and e["target"] == c.get("targetId")
                    and e["type"] == c.get("relationType")
                ):
                    e["changeState"] = "removed"

    added = sum(1 for n in nodes.values() if n["changeState"] == "added")
    removed = sum(1 for n in nodes.values() if n["changeState"] == "removed")
    changed = sum(1 for n in nodes.values() if n["changeState"] == "changed")
    retained = sum(1 for n in nodes.values() if n["changeState"] is None)

    before = after = 0.0
    approximate = False
    for nid, n in nodes.items():
        if str(nid).startswith("tmp:"):
            est = estimates.get(nid)
            cost, known = (est or 0.0), est is not None
        else:
            keys = cost_keys_by_type.get(n["type"], [])
            attrs = n["attributes"]
            if attrs is None:
                cost, known = 0.0, len(keys) == 0
            else:
                cost = sum(v for k in keys if isinstance((v := attrs.get(k)), (int, float)))
                known = True
        if not known:
            approximate = True
        cs = n["changeState"]
        if cs is None or cs == "removed":
            before += cost
        if cs is None or cs in ("added", "changed"):
            after += cost

    coverage_gaps: list[tuple[str, int]] = []
    for cid, cnode in nodes.items():
        if cnode["type"] != "BusinessCapability":
            continue
        base_apps: set[str] = set()
        target_apps: set[str] = set()
        for e in edges:
            app_id = (
                e["target"] if e["source"] == cid else e["source"] if e["target"] == cid else None
            )
            if not app_id:
                continue
            an = nodes.get(app_id)
            if not an or an["type"] != "Application":
                continue
            if an["changeState"] != "added" and e["changeState"] != "added":
                base_apps.add(app_id)
            if an["changeState"] != "removed" and e["changeState"] != "removed":
                target_apps.add(app_id)
        if base_apps and not target_apps:
            coverage_gaps.append((names.get(cid, cid), len(base_apps)))

    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "retained": retained,
        "cost_before": before,
        "cost_after": after,
        "cost_delta": after - before,
        "approximate": approximate,
        "coverage_gaps": coverage_gaps,
    }


async def execute_plan_commit(
    db: AsyncSession,
    plan: ArchitecturePlan,
    data: dict[str, Any],
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Commit a plan: Initiative + cards + relations (+ ADR) + end-of-life stamps.

    ``data`` keys: initiative_name, start_date, end_date, objective_ids,
    create_adr, selected_change_indices (None = all), renamed_cards
    (tempId -> name).
    """
    initiative_name: str = data["initiative_name"]
    start_date: str = data["start_date"]
    end_date: str = data["end_date"]
    objective_ids: list[str] = data.get("objective_ids") or []
    create_adr: bool = data.get("create_adr", True)
    renamed_cards: dict[str, str] = data.get("renamed_cards") or {}

    plan_data = plan.plan_data or {}
    baseline = plan_data.get("baseline") or {}
    baseline_nodes: dict[str, dict] = {
        n["id"]: n for n in baseline.get("nodes", []) if isinstance(n, dict) and n.get("id")
    }
    baseline_edges: list[dict] = [e for e in baseline.get("edges", []) if isinstance(e, dict)]
    all_changes: list[dict] = [c for c in plan_data.get("changes", []) if isinstance(c, dict)]

    selected_indices = data.get("selected_change_indices")
    if selected_indices is None:
        changes = list(all_changes)
    else:
        wanted = set(selected_indices)
        changes = [c for i, c in enumerate(all_changes) if i in wanted]

    rel_types = _RelationTypeIndex()
    card_types = _CardTypeIndex()
    # temp_id / existing-card-id -> real UUID
    id_map: dict[str, uuid.UUID] = {}
    # card-type key per plan-local id, for relation endpoint validation
    type_map: dict[str, str] = {nid: n.get("type", "") for nid, n in baseline_nodes.items()}
    # display name per plan-local id (baseline + resolved/created cards)
    name_map: dict[str, str] = {nid: n.get("name", nid) for nid, n in baseline_nodes.items()}

    # ── Step 1: Initiative card + objective links ─────────────────────────
    initiative = Card(
        id=uuid.uuid4(),
        type="Initiative",
        subtype="project",
        name=initiative_name,
        description=plan.description or "",
        attributes={"startDate": start_date, "endDate": end_date},
        lifecycle={},
        status="ACTIVE",
        approval_status="DRAFT",
        created_by=user_id,
        updated_by=user_id,
    )
    initiative.data_quality = await calc_data_quality(db, initiative)
    db.add(initiative)
    await db.flush()

    for oid in objective_ids:
        try:
            obj_uuid = uuid.UUID(oid)
        except (ValueError, TypeError):
            logger.warning("Invalid objective ID: %s", oid)
            continue
        obj = await db.get(Card, obj_uuid)
        if obj and obj.type == "Objective":
            db.add(
                Relation(
                    id=uuid.uuid4(),
                    type="relInitiativeToObjective",
                    source_id=initiative.id,
                    target_id=obj_uuid,
                )
            )

    # ── Step 2: replay changes ────────────────────────────────────────────
    remove_relation_ops = [c for c in changes if c.get("op") == "remove_relation"]

    def _is_relation_removed(source_id: str, target_id: str, rel_type: str) -> bool:
        for rr in remove_relation_ops:
            if (
                rr.get("relationType") == rel_type
                and rr.get("sourceId") == source_id
                and rr.get("targetId") == target_id
            ):
                return True
        return False

    async def _resolve_successor_or_added(
        card_spec: dict,
    ) -> tuple[uuid.UUID | None, str | None, bool]:
        """Resolve an add_card / replace_card successor spec.

        Returns (card_uuid, plan_local_id, created) — created=True when a new
        Card row was inserted.
        """
        proposed = card_spec.get("proposed")
        existing_id = card_spec.get("existingCardId")
        if proposed:
            temp_id = proposed.get("tempId") or f"tmp:{uuid.uuid4()}"
            name = renamed_cards.get(temp_id) or proposed.get("name") or "Unnamed"
            type_key = proposed.get("cardTypeKey", "Application")
            # Carry the planning cost estimate onto the created card's first
            # cost attribute so the roadmap/cost reports reflect the plan.
            attributes: dict[str, Any] = {}
            est = proposed.get("estimatedCost")
            if isinstance(est, (int, float)):
                cost_keys = await card_types.cost_keys(db, type_key)
                if cost_keys:
                    attributes[cost_keys[0]] = est
            new_card = Card(
                id=uuid.uuid4(),
                type=type_key,
                subtype=proposed.get("subtype"),
                name=name,
                description=proposed.get("description") or "",
                attributes=attributes,
                lifecycle={"phaseIn": start_date, "active": end_date},
                status="ACTIVE",
                approval_status="DRAFT",
                created_by=user_id,
                updated_by=user_id,
            )
            new_card.data_quality = await calc_data_quality(db, new_card)
            db.add(new_card)
            await db.flush()
            id_map[temp_id] = new_card.id
            type_map[temp_id] = type_key
            name_map[temp_id] = name
            return new_card.id, temp_id, True
        if existing_id:
            try:
                card_uuid = uuid.UUID(existing_id)
            except (ValueError, TypeError):
                return None, None, False
            card = await db.get(Card, card_uuid)
            if not card:
                logger.warning("Plan commit: existing card %s not found", existing_id)
                return None, None, False
            id_map[existing_id] = card_uuid
            type_map[existing_id] = card.type
            name_map[existing_id] = card.name
            return card_uuid, existing_id, False
        return None, None, False

    async def _link_initiative(card_uuid: uuid.UUID, type_key: str) -> None:
        rel_type_key = INITIATIVE_RELATION_MAP.get(type_key)
        if not rel_type_key:
            return
        if await rel_types.get(db, rel_type_key) is None:
            return
        db.add(
            Relation(
                id=uuid.uuid4(),
                type=rel_type_key,
                source_id=initiative.id,
                target_id=card_uuid,
            )
        )

    async def _stamp_end_of_life(card_id: str) -> Card | None:
        try:
            card_uuid = uuid.UUID(card_id)
        except (ValueError, TypeError):
            return None
        card = await db.get(Card, card_uuid)
        if not card:
            logger.warning("Plan commit: card to retire %s not found", card_id)
            return None
        lifecycle = dict(card.lifecycle or {})
        lifecycle["endOfLife"] = end_date
        card.lifecycle = lifecycle
        card.updated_by = user_id
        flag_modified(card, "lifecycle")
        return card

    created_card_ids: list[uuid.UUID] = []
    retired: list[str] = []  # names, for the ADR + result
    relations_created = 0
    seen_relations: set[tuple[str, uuid.UUID, uuid.UUID]] = set()
    change_lines: list[str] = []  # human-readable ADR decision list

    async def _create_relation(rel_type: str, source: uuid.UUID, target: uuid.UUID) -> bool:
        nonlocal relations_created
        key = (rel_type, source, target)
        if key in seen_relations:
            return False
        if await rel_types.get(db, rel_type) is None:
            return False
        db.add(Relation(id=uuid.uuid4(), type=rel_type, source_id=source, target_id=target))
        seen_relations.add(key)
        relations_created += 1
        return True

    def _resolve_id(plan_local_id: str) -> uuid.UUID | None:
        if plan_local_id in id_map:
            return id_map[plan_local_id]
        try:
            return uuid.UUID(plan_local_id)
        except (ValueError, TypeError):
            return None

    for change in changes:
        op = change.get("op")

        if op == "add_card":
            card_uuid, local_id, _created = await _resolve_successor_or_added(
                change.get("card") or {}
            )
            if card_uuid is None or local_id is None:
                continue
            if _created:
                created_card_ids.append(card_uuid)
            await _link_initiative(card_uuid, type_map.get(local_id, ""))
            change_lines.append(
                f"Introduce {type_map.get(local_id) or 'card'} '{name_map.get(local_id, local_id)}'"
            )

        elif op == "remove_card":
            card_id = change.get("cardId", "")
            card = await _stamp_end_of_life(card_id)
            if card:
                retired.append(card.name)
                change_lines.append(f"Decommission '{card.name}'")

        elif op == "replace_card":
            predecessor_id = change.get("predecessorId", "")
            successor_uuid, successor_local_id, created = await _resolve_successor_or_added(
                change.get("successor") or {}
            )
            if successor_uuid is None or successor_local_id is None:
                continue
            if created:
                created_card_ids.append(successor_uuid)
            successor_type = type_map.get(successor_local_id, "")
            await _link_initiative(successor_uuid, successor_type)

            predecessor = await _stamp_end_of_life(predecessor_id)
            if predecessor:
                retired.append(predecessor.name)

            # Derive inherited relations: every baseline edge touching the
            # predecessor, not explicitly cut, with the successor substituted.
            for edge in baseline_edges:
                src, tgt = edge.get("source", ""), edge.get("target", "")
                rel_type = edge.get("type", "")
                if predecessor_id not in (src, tgt) or not rel_type:
                    continue
                new_src = successor_local_id if src == predecessor_id else src
                new_tgt = successor_local_id if tgt == predecessor_id else tgt
                if _is_relation_removed(src, tgt, rel_type) or _is_relation_removed(
                    new_src, new_tgt, rel_type
                ):
                    continue
                rt = await rel_types.get(db, rel_type)
                if rt is None:
                    continue
                # Endpoint-type validation against the metamodel
                src_type = type_map.get(new_src, "")
                tgt_type = type_map.get(new_tgt, "")
                if rt.source_type_key != src_type or rt.target_type_key != tgt_type:
                    logger.info(
                        "Plan commit: skipping inherited relation %s (%s -> %s): "
                        "endpoint types do not match",
                        rel_type,
                        src_type,
                        tgt_type,
                    )
                    continue
                src_uuid = _resolve_id(new_src)
                tgt_uuid = _resolve_id(new_tgt)
                if src_uuid is None or tgt_uuid is None:
                    continue
                await _create_relation(rel_type, src_uuid, tgt_uuid)

            pred_name = (
                predecessor.name if predecessor else name_map.get(predecessor_id, predecessor_id)
            )
            succ_name = name_map.get(successor_local_id, successor_local_id)
            change_lines.append(f"Replace '{pred_name}' with '{succ_name}'")

        elif op == "add_relation":
            src_uuid = _resolve_id(change.get("sourceId", ""))
            tgt_uuid = _resolve_id(change.get("targetId", ""))
            rel_type = change.get("relationType", "")
            if src_uuid is None or tgt_uuid is None or not rel_type:
                continue
            if await _create_relation(rel_type, src_uuid, tgt_uuid):
                src_local = change.get("sourceId", "")
                tgt_local = change.get("targetId", "")
                change_lines.append(
                    f"Connect '{name_map.get(src_local, src_local)}' "
                    f"to '{name_map.get(tgt_local, tgt_local)}'"
                )

        elif op == "remove_relation":
            # Documented in the ADR only — relations are never deleted at commit.
            src_local = change.get("sourceId", "")
            tgt_local = change.get("targetId", "")
            change_lines.append(
                f"Cut relation '{change.get('relationType', '')}' between "
                f"'{name_map.get(src_local, src_local)}' and '{name_map.get(tgt_local, tgt_local)}'"
            )

    # ── Step 3: optional draft ADR ────────────────────────────────────────
    adr_id: str | None = None
    adr_reference: str | None = None
    if create_adr:
        scope = plan.scope or {}
        scope_names = [name_map[cid] for cid in scope.get("cardIds", []) if cid in baseline_nodes]
        context_parts = []
        if plan.description:
            context_parts.append(plan.description)
        if scope_names:
            context_parts.append("Scope: " + ", ".join(scope_names))
        # Gap analysis + cost/coverage insights, mirroring the plan editor/preview,
        # so the ADR captures the architectural rationale, not just the change list.
        type_keys: set[str] = {n.get("type", "") for n in baseline.get("nodes", [])}
        for c in all_changes:
            spec = c.get("card") or c.get("successor") or {}
            proposed = spec.get("proposed")
            if proposed and proposed.get("cardTypeKey"):
                type_keys.add(proposed["cardTypeKey"])
        cost_keys_by_type = {tk: await card_types.cost_keys(db, tk) for tk in type_keys if tk}
        insights = _compute_plan_insights(baseline, changes, cost_keys_by_type)

        consequences_parts = [
            "Gap analysis — added: {added}, removed: {removed}, "
            "modified: {changed}, retained: {retained}.".format(**insights)
        ]
        est = " (estimated)" if insights["approximate"] else ""
        consequences_parts.append(
            "Estimated annual cost{est}: {before:,.0f} → {after:,.0f} "
            "(delta {delta:+,.0f}).".format(
                est=est,
                before=insights["cost_before"],
                after=insights["cost_after"],
                delta=insights["cost_delta"],
            )
        )
        if retired:
            consequences_parts.append(
                "Cards scheduled for decommissioning (end-of-life "
                f"{end_date}): " + ", ".join(retired)
            )
        for cap_name, base_apps in insights["coverage_gaps"]:
            consequences_parts.append(
                f"Capability coverage gap: '{cap_name}' loses all "
                f"{base_apps} supporting application(s)."
            )

        ref_number = await _next_adr_reference(db)
        adr = ArchitectureDecision(
            id=uuid.uuid4(),
            reference_number=ref_number,
            title=f"Architecture Decision: {initiative_name}",
            status="draft",
            context="\n\n".join(context_parts) or None,
            decision="\n".join(change_lines) or None,
            consequences="\n".join(consequences_parts) or None,
            related_decisions=[{"type": "architecture_plan", "id": str(plan.id)}],
            created_by=user_id,
        )
        db.add(adr)
        await db.flush()
        db.add(ArchitectureDecisionCard(architecture_decision_id=adr.id, card_id=initiative.id))
        for card_uuid in created_card_ids:
            db.add(ArchitectureDecisionCard(architecture_decision_id=adr.id, card_id=card_uuid))
        adr_id = str(adr.id)
        adr_reference = ref_number

    # ── Step 4: finalize plan ─────────────────────────────────────────────
    plan.status = "committed"
    plan.initiative_id = initiative.id
    flag_modified(plan, "status")

    await db.commit()

    return {
        "initiative_id": str(initiative.id),
        "initiative_name": initiative.name,
        "card_count": len(created_card_ids),
        "relation_count": relations_created,
        "retired_count": len(retired),
        "adr_id": adr_id,
        "adr_reference": adr_reference,
    }
