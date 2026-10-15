"""What a survey field reads from a card and what applying an answer writes.

A survey field row in ``Survey.fields`` is one of four kinds:

* **attribute** (no ``kind``, or ``"attribute"``) — a key in ``card.attributes``;
* **relation** (``kind="relation"``) — the set of cards linked through one
  relation type on one side;
* **lifecycle** (``kind="lifecycle"``, ``phase``) — one phase date in
  ``card.lifecycle``;
* **stakeholder** (``kind="stakeholder"``, ``role``) — the people holding one
  stakeholder role on the card.

Applying a response routes every attribute and lifecycle answer through
``card_write_service.update_card`` — the write path ``PATCH /cards/{id}`` uses —
so a survey answer is validated, recalculated, rescored and recorded exactly
like an edit made on the card, and the History tab and the audit log's rollback
both read its ``card.updated`` event. Every event an apply emits carries the
survey it came from (``provenance``), so a card's history can say *via which
survey* and *answered by whom*, not merely that an admin made the edit.

Services must not import from ``app.api``; the routes in ``api/v1/surveys.py``
import from here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.user import User
from app.services import stakeholder_service
from app.services.lifecycle import PHASE_CHRONOLOGICAL, parse_lifecycle_date
from app.services.relation_orientation import direction_for

FIELD_KINDS = ("attribute", "relation", "lifecycle", "stakeholder")


class SurveyFieldError(ValueError):
    """A field row or an answer the survey cannot accept."""


# ── Field kinds ─────────────────────────────────────────────────────────────


def is_relation_field(field_def: object) -> bool:
    """A survey field describes a relation (rather than a card attribute) when
    it carries ``kind == "relation"`` plus a relation type + direction."""
    return (
        isinstance(field_def, dict)
        and field_def.get("kind") == "relation"
        and bool(field_def.get("relation_type_key"))
        and field_def.get("direction") in ("outgoing", "incoming")
    )


def is_lifecycle_field(field_def: object) -> bool:
    """One lifecycle phase date: ``kind == "lifecycle"`` and a known phase."""
    return (
        isinstance(field_def, dict)
        and field_def.get("kind") == "lifecycle"
        and field_def.get("phase") in PHASE_CHRONOLOGICAL
    )


def is_stakeholder_field(field_def: object) -> bool:
    """The holders of one stakeholder role: ``kind == "stakeholder"`` + role."""
    return (
        isinstance(field_def, dict)
        and field_def.get("kind") == "stakeholder"
        and isinstance(field_def.get("role"), str)
        and bool(field_def.get("role"))
    )


async def validate_field_rows(db: AsyncSession, target_type_key: str, fields: list) -> None:
    """Refuse a field row whose ``kind`` the survey could not read or apply.

    Attribute and relation rows are stored as the builder sends them (that has
    always been the contract). The two kinds that name something outside the
    card's own columns are checked: a lifecycle row must name a real phase, a
    stakeholder row a role the target type defines — a role that does not exist
    would collect answers no apply could ever write.
    """
    role_keys: set[str] | None = None
    for row in fields or []:
        if not isinstance(row, dict):
            raise SurveyFieldError("Each survey field must be an object")
        kind = row.get("kind")
        if kind is not None and kind not in FIELD_KINDS:
            raise SurveyFieldError(f"Unknown survey field kind: {kind}")
        if kind == "lifecycle" and not is_lifecycle_field(row):
            raise SurveyFieldError(f"Unknown lifecycle phase: {row.get('phase')}")
        if kind == "stakeholder":
            if role_keys is None:
                role_keys = {
                    str(r["key"])
                    for r in await stakeholder_service.roles_for_type(db, target_type_key)
                    if isinstance(r, dict) and r.get("key")
                }
            if not is_stakeholder_field(row) or row["role"] not in role_keys:
                raise SurveyFieldError(
                    f"Unknown stakeholder role for {target_type_key}: {row.get('role')}"
                )


# ── Current values ──────────────────────────────────────────────────────────


async def relation_field_peers(db: AsyncSession, card_id: uuid.UUID, field_def: dict) -> list[dict]:
    """Resolve the related cards currently linked to ``card_id`` for a relation
    survey field. Returns ``[{id, name}]`` of the peer cards on the configured
    side. ``direction == "outgoing"`` means the surveyed card is the relation
    *source* (peers are targets); ``"incoming"`` means it is the *target*."""
    rtk = field_def.get("relation_type_key")
    direction = field_def.get("direction")
    if not rtk or direction not in ("outgoing", "incoming"):
        return []

    if direction == "outgoing":
        q = (
            select(Card.id, Card.name)
            .join(Relation, Relation.target_id == Card.id)
            .where(
                Relation.type == rtk,
                Relation.source_id == card_id,
                Card.status == "ACTIVE",
            )
        )
    else:
        q = (
            select(Card.id, Card.name)
            .join(Relation, Relation.source_id == Card.id)
            .where(
                Relation.type == rtk,
                Relation.target_id == card_id,
                Card.status == "ACTIVE",
            )
        )

    rows = await db.execute(q.order_by(Card.name))
    return [{"id": str(rid), "name": name} for rid, name in rows.all()]


async def stakeholder_holders(db: AsyncSession, card_id: uuid.UUID, role: str) -> list[dict]:
    """The **active** people holding ``role`` on the card, as
    ``[{id, display_name}]`` sorted by name.

    Deactivated holders are left out on purpose: the respondent's picker lists
    active users only, so an inactive holder could only ever appear to have been
    removed. ``apply_stakeholder_change`` leaves such holders in place for the
    same reason.
    """
    rows = await db.execute(
        select(User.id, User.display_name)
        .join(Stakeholder, Stakeholder.user_id == User.id)
        .where(
            Stakeholder.card_id == card_id,
            Stakeholder.role == role,
            User.is_active.is_(True),
        )
        .order_by(User.display_name)
    )
    return [{"id": str(uid), "display_name": name} for uid, name in rows.all()]


async def current_value(db: AsyncSession, card: Card, field_def: dict) -> object:
    """What the card holds today for one survey field."""
    if is_relation_field(field_def):
        return await relation_field_peers(db, card.id, field_def)
    if is_lifecycle_field(field_def):
        return (card.lifecycle or {}).get(field_def["phase"])
    if is_stakeholder_field(field_def):
        return await stakeholder_holders(db, card.id, field_def["role"])
    return (card.attributes or {}).get(field_def.get("key"))


def normalise_lifecycle_answer(value: object) -> str | None:
    """A lifecycle answer as the ``YYYY-MM-DD`` the card stores, ``""`` for an
    explicit clear, or ``None`` for no answer. Anything else is refused."""
    if value is None:
        return None
    if value == "":
        return ""
    parsed = parse_lifecycle_date(value)
    if parsed is None:
        raise SurveyFieldError(f"Not a date: {value}")
    return parsed.isoformat()


def ref_ids(new_value: object) -> set[uuid.UUID]:
    """Parse a proposed set of cards or people into UUIDs.

    Accepts a list of ``{id, …}`` refs or bare id strings — the two shapes the
    response form writes. Anything else is **refused**, never trimmed: a
    stakeholder answer that is not a list, or that carries an id no UUID can be
    read from, is not a shorter list of people — it is an answer nobody gave,
    and applying what survived the trim would empty a role on the strength of
    a malformed payload. Only ``submit_response`` and the apply call this, so
    both halves refuse the same thing.
    """
    if not isinstance(new_value, list):
        raise SurveyFieldError("Expected a list of references")
    ids: set[uuid.UUID] = set()
    for ref in new_value:
        rid = ref.get("id") if isinstance(ref, dict) else ref
        try:
            ids.add(uuid.UUID(str(rid)))
        except (ValueError, TypeError, AttributeError):
            raise SurveyFieldError(f"Not a reference: {rid!r}") from None
    return ids


def snapshot_ids(value: object) -> set[uuid.UUID] | None:
    """The ids a response's ``current_value`` snapshot named, or ``None`` when
    the response carries no usable snapshot (a row written before the snapshot
    existed, or one whose snapshot is not a list)."""
    if not isinstance(value, list):
        return None
    try:
        return ref_ids(value)
    except SurveyFieldError:
        return None


# ── Provenance ──────────────────────────────────────────────────────────────


def provenance(survey: Survey, resp: SurveyResponse, respondent: User | None) -> dict:
    """The keys stamped on every event an apply emits.

    The event's actor stays the admin who applied the answer — that is who
    made the write. Who *answered* travels here, under ``respondent_*``, never
    ``user_id``: a stakeholder event's ``user_id`` names the stakeholder, and the
    SSE stream routes on it. The survey's name is copied so the entry still
    reads correctly once the survey has been deleted.
    """
    return {
        "source": "survey_response",
        "survey_id": str(survey.id),
        "survey_name": survey.name,
        "response_id": str(resp.id),
        "respondent_id": str(resp.user_id),
        "respondent_name": respondent.display_name if respondent else None,
    }


# ── Writers ─────────────────────────────────────────────────────────────────


async def apply_relation_change(
    db: AsyncSession,
    card: Card,
    field_def: dict,
    new_value: object,
    actor_id: uuid.UUID,
    extra: dict | None = None,
) -> bool:
    """Sync the surveyed card's relations of one type to the respondent's
    proposed set: create the links they added, delete the ones they removed.
    Emits relation events for both endpoints (audit parity with the relations
    API) and recalculates calculated fields on every touched card. A malformed
    answer (not a list, or an id no UUID can be read from) is refused through
    ``ref_ids``; a well-formed id whose card is gone or archived is skipped,
    since a card can legitimately leave between the answer and the apply.
    Returns True when anything changed."""
    # Local imports keep this module importable from card_write_service's
    # import graph without a cycle.
    from app.services.calculation_engine import run_calculations_for_card
    from app.services.card_write_service import _emit_relation_events

    rtk = field_def["relation_type_key"]
    # The field's direction is the builder's; the relation type is the
    # authority on which end this card sits at, so a stale or hand-edited field
    # can never look up — or write — a relation the wrong way round (#1140).
    rt = (
        await db.execute(select(RelationType).where(RelationType.key == rtk))
    ).scalar_one_or_none()
    direction = direction_for(rt, card.type, field_def["direction"])
    desired_ids = ref_ids(new_value)

    if direction == "outgoing":
        q = select(Relation).where(Relation.type == rtk, Relation.source_id == card.id)
    else:
        q = select(Relation).where(Relation.type == rtk, Relation.target_id == card.id)
    existing = (await db.execute(q)).scalars().all()
    current: dict[uuid.UUID, Relation] = {}
    for rel in existing:
        peer = rel.target_id if direction == "outgoing" else rel.source_id
        current[peer] = rel

    to_add = desired_ids - set(current.keys())
    to_remove = set(current.keys()) - desired_ids
    if not to_add and not to_remove:
        return False

    touched: set[uuid.UUID] = set()
    event_extra = extra or {"source": "survey_response"}
    source_card: Card | None
    target_card: Card | None

    for peer_id in sorted(to_add):
        peer_card = await db.get(Card, peer_id)
        # Only link to active peers; skip stale ids the respondent may carry.
        if not peer_card or peer_card.status != "ACTIVE":
            continue
        if direction == "outgoing":
            rel = Relation(type=rtk, source_id=card.id, target_id=peer_id)
            source_card, target_card = card, peer_card
        else:
            rel = Relation(type=rtk, source_id=peer_id, target_id=card.id)
            source_card, target_card = peer_card, card
        db.add(rel)
        await db.flush()
        await _emit_relation_events(
            db,
            event_type="relation.created",
            rel=rel,
            source_card=source_card,
            target_card=target_card,
            actor_id=actor_id,
            extra=event_extra,
        )
        touched.add(peer_id)

    for peer_id in sorted(to_remove):
        rel = current[peer_id]
        peer_card = await db.get(Card, peer_id)
        if direction == "outgoing":
            source_card, target_card = card, peer_card
        else:
            source_card, target_card = peer_card, card
        await _emit_relation_events(
            db,
            event_type="relation.deleted",
            rel=rel,
            source_card=source_card,
            target_card=target_card,
            actor_id=actor_id,
            extra=event_extra,
        )
        await db.delete(rel)
        touched.add(peer_id)

    await run_calculations_for_card(db, card)
    for cid in touched:
        peer_card = await db.get(Card, cid)
        if peer_card is not None:
            await run_calculations_for_card(db, peer_card)

    return bool(touched)


async def apply_stakeholder_change(
    db: AsyncSession,
    card: Card,
    role: str,
    new_value: object,
    actor_id: uuid.UUID,
    extra: dict | None = None,
    snapshot: object = None,
) -> bool:
    """Apply the respondent's edit to the holders of ``role`` on the card.

    The answer is read as a **diff against what the respondent saw** — the
    ``current_value`` snapshot the form stored with it — not as the complete
    holder list: the people they added are added, the people they removed are
    removed, and a holder who joined between the answer and the apply (another
    respondent's answer, an assignment on the card) stays. Two respondents'
    answers to the same role therefore compose instead of the second
    overwriting the first. A response with no snapshot falls back to making
    the active holders exactly the listed people.

    Both halves are then checked against the live rows, so nothing is added
    twice or removed twice. Publishes ``stakeholder.added`` /
    ``stakeholder.removed`` for each change (so rollback and the History tab
    treat them like any other assignment) and rescores the card once. A listed
    id that matches **no user** refuses the answer — on another instance, or
    after a hand edit, that is a different list of people, not a shorter one. A
    deactivated person is skipped rather than added, and a deactivated holder
    is never removed, since the respondent could not see them. Returns True
    when anything changed.
    """
    roles = await stakeholder_service.roles_for_type(db, card.type)
    labels = stakeholder_service.role_labels([r for r in roles if isinstance(r, dict)])
    if role not in labels:
        raise SurveyFieldError(f"Unknown stakeholder role for {card.type}: {role}")
    role_label = labels[role] or role

    wanted = ref_ids(new_value)
    known: dict[uuid.UUID, User] = {}
    if wanted:
        rows = await db.execute(select(User).where(User.id.in_(wanted)))
        known = {u.id: u for u in rows.scalars().all()}
    unknown = wanted - set(known)
    if unknown:
        raise SurveyFieldError(
            f"{len(unknown)} of the people listed for {role_label} match no user"
        )

    holder_rows = await db.execute(
        select(Stakeholder, User)
        .join(User, User.id == Stakeholder.user_id)
        .where(Stakeholder.card_id == card.id, Stakeholder.role == role)
    )
    current: dict[uuid.UUID, tuple[Stakeholder, User]] = {
        sh.user_id: (sh, u) for sh, u in holder_rows.all()
    }

    seen = snapshot_ids(snapshot)
    if seen is None:
        add_ids = wanted - set(current)
        remove_ids = set(current) - wanted
    else:
        add_ids = wanted - seen
        remove_ids = seen - wanted

    to_add = [uid for uid in add_ids if uid not in current and known[uid].is_active]
    to_remove = [uid for uid in remove_ids if uid in current and current[uid][1].is_active]
    if not to_add and not to_remove:
        return False

    for uid in sorted(to_add):
        person = known[uid]
        sh = Stakeholder(card_id=card.id, user_id=uid, role=role)
        db.add(sh)
        await db.flush()
        await stakeholder_service.publish_stakeholder_event(
            db,
            "stakeholder.added",
            sh,
            role_label=role_label,
            user_display_name=person.display_name,
            actor_id=actor_id,
            extra=extra,
        )

    for uid in sorted(to_remove):
        sh, person = current[uid]
        await stakeholder_service.publish_stakeholder_event(
            db,
            "stakeholder.removed",
            sh,
            role_label=role_label,
            user_display_name=person.display_name,
            actor_id=actor_id,
            extra=extra,
        )
        await db.delete(sh)

    await db.flush()
    await stakeholder_service.rescore_after_stakeholder_change(db, card.id)
    return True


async def apply_response(
    db: AsyncSession,
    survey: Survey,
    resp: SurveyResponse,
    card: Card,
    actor: User,
    *,
    can_manage_stakeholders: bool = True,
    deferred_notifications: list[dict] | None = None,
) -> bool:
    """Write one completed response onto its card. Flushes, never commits.

    An answer is written when the respondent did not merely confirm it and
    gave a value (``new_value is not None``) — the rule surveys have always
    used. Relation and stakeholder answers are applied first (each emits its
    own events); attribute and lifecycle answers are then merged onto the
    card's **live** values — a relation edit may have recomputed a calculated
    field that a pre-loop snapshot would clobber — and written in one
    ``update_card`` call. A validation failure there raises ``HTTPException``;
    the caller runs each response in its own savepoint. Returns True when the
    card changed.

    ``can_manage_stakeholders`` is the applier's answer to ``stakeholders.manage``
    (or the card-level ``card.manage_stakeholders``) on this card: a stakeholder
    answer is a role assignment, and ``surveys.manage`` alone must not hand out
    what the Stakeholders tab would refuse, so without it such a response is
    refused as a whole. ``deferred_notifications`` is handed to ``update_card``
    so the subscriber nudges are collected for delivery after the commit
    instead of emailed inline on the request's session.
    """
    from app.services.card_write_service import WriteActor, update_card

    field_defs = {f.get("key"): f for f in (survey.fields or []) if isinstance(f, dict)}
    respondent = await db.get(User, resp.user_id)
    extra = provenance(survey, resp, respondent)

    attr_updates: dict[str, object] = {}
    lifecycle_updates: dict[str, str] = {}
    changed = False

    for field_key, field_data in (resp.responses or {}).items():
        if not isinstance(field_data, dict):
            continue
        if field_data.get("confirmed", False):
            continue
        new_value = field_data.get("new_value")
        if new_value is None:
            continue

        field_def = field_defs.get(field_key) or {}
        if is_relation_field(field_def):
            changed |= await apply_relation_change(db, card, field_def, new_value, actor.id, extra)
        elif is_stakeholder_field(field_def):
            if not can_manage_stakeholders:
                raise SurveyFieldError(
                    "Applying a stakeholder answer requires stakeholders.manage on the card"
                )
            changed |= await apply_stakeholder_change(
                db,
                card,
                field_def["role"],
                new_value,
                actor.id,
                extra,
                snapshot=field_data.get("current_value"),
            )
        elif is_lifecycle_field(field_def):
            answer = normalise_lifecycle_answer(new_value)
            if answer is not None:
                lifecycle_updates[field_def["phase"]] = answer
        else:
            attr_updates[field_key] = new_value

    updates: dict[str, object] = {}
    if attr_updates:
        updates["attributes"] = {**(card.attributes or {}), **attr_updates}
    if lifecycle_updates:
        lifecycle = dict(card.lifecycle or {})
        for phase, answer in lifecycle_updates.items():
            if answer:
                lifecycle[phase] = answer
            else:
                lifecycle.pop(phase, None)
        updates["lifecycle"] = lifecycle

    if updates:
        changed |= await update_card(
            db,
            WriteActor.from_user(actor),
            card,
            updates,
            event_extra=extra,
            deferred_notifications=deferred_notifications,
        )
    return changed
