"""Shared builder for the Process House (process map) and its published flows.

Both the authenticated ``GET /reports/bpm/process-map`` route and the
account-less ``/web-portals/public/{slug}/bpm/*`` endpoints render the same
Process Navigator component, so they are built here rather than in either route
module. Keeping one builder is what stops the two paths drifting — a field added
for the authenticated page can never quietly appear on the public one, because
the public shape is produced by an explicit, opt-in projection
(``to_public_process_map`` / ``to_public_flow``) rather than by subtracting
fields from the internal one. See ``app/schemas/bpm_public.py`` for what that
projection withholds and why.

Nothing in this module knows about authentication. Permission checks stay in the
route layer; the public endpoints' redaction is expressed as data
(``BpmPortalConfig``), exactly as ``ppm_portfolio_service`` does it.

``scoped_process_query`` is the load-bearing piece. It is the single definition
of "which processes does this portal publish?", and both the map builder and
``process_in_scope`` derive from it. Writing the predicate twice is how a portal
scoped to one subtree ends up serving every other process's BPMN to anyone
holding an id — and ids are handed out freely by other portals' maps.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Sequence

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.process_element import ProcessElement
from app.models.process_flow_version import ProcessFlowVersion
from app.models.relation import Relation
from app.models.tag import CardTag
from app.schemas.bpm_public import (
    PUBLIC_PROCESS_ATTRIBUTES,
    BpmPublicFlow,
    BpmPublicProcess,
    BpmPublicProcessMap,
    BpmPublicRef,
    BpmPublicStep,
)

PROCESS_TYPE = "BusinessProcess"
APPLICATION_TYPE = "Application"
DATA_OBJECT_TYPE = "DataObject"
ORGANIZATION_TYPE = "Organization"
BUSINESS_CONTEXT_TYPE = "BusinessContext"

# No relation-type constants here on purpose: the map reads by ENDPOINT card type,
# so every relation type connecting BusinessProcess to Application / DataObject /
# Organization / BusinessContext is included. The canonical keys a *write* path
# creates (relProcessToApp, relProcessToDataObj, …) live in
# ``element_relation_sync.ELEMENT_LINK_RELATION_MAP``, which has to choose one.

DEFAULT_ROW_ORDER = ["management", "core", "support"]


# ── Scope ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProcessScope:
    """Which processes are in scope.

    The default (all fields ``None``) is every ACTIVE BusinessProcess — what the
    authenticated navigator has always shown. A web portal narrows it with the
    same preset filters every other portal uses, which is how an administrator
    publishes one branch of the house rather than all of it.

    Scope is applied **flat**: a descendant of an in-scope process is not
    implicitly in scope. That matches ``PortfolioScope``, it keeps "may this id
    be published?" answerable with the same ``WHERE``, and the client's
    ``buildTree`` already re-roots a node whose parent is missing.
    """

    subtypes: tuple[str, ...] | None = None
    tag_ids: tuple[uuid.UUID, ...] | None = None
    approval_statuses: tuple[str, ...] | None = None

    @classmethod
    def from_portal_filters(cls, filters: dict | None) -> "ProcessScope":
        """Build a scope from a ``WebPortal.filters`` blob.

        Malformed values are ignored rather than raised — this feeds a public
        endpoint, and a bad preset must never surface as a 500.
        """
        f = filters or {}
        if not isinstance(f, dict):
            return cls()

        def _strs(key: str) -> tuple[str, ...] | None:
            raw = f.get(key)
            if not isinstance(raw, list) or not raw:
                return None
            vals = tuple(str(v) for v in raw if isinstance(v, (str, int)))
            return vals or None

        tag_ids: tuple[uuid.UUID, ...] | None = None
        raw_tags = f.get("tag_ids")
        if isinstance(raw_tags, list) and raw_tags:
            parsed: list[uuid.UUID] = []
            for tid in raw_tags:
                try:
                    parsed.append(uuid.UUID(str(tid)))
                except (ValueError, AttributeError, TypeError):
                    continue
            tag_ids = tuple(parsed) or None

        return cls(
            subtypes=_strs("subtypes"),
            tag_ids=tag_ids,
            approval_statuses=_strs("approval_statuses"),
        )


def scoped_process_query(scope: ProcessScope) -> Select:
    """The one definition of "which processes does this scope cover?".

    Every caller that answers that question — the map builder and the
    per-process scope check the flow endpoint runs — must derive from this, or
    the two can disagree and the disagreement is a data leak.
    """
    q = select(Card).where(Card.type == PROCESS_TYPE, Card.status == "ACTIVE")
    if scope.subtypes:
        q = q.where(Card.subtype.in_(scope.subtypes))
    if scope.approval_statuses:
        q = q.where(Card.approval_status.in_(scope.approval_statuses))
    if scope.tag_ids:
        tagged = select(CardTag.card_id).where(CardTag.tag_id.in_(scope.tag_ids))
        q = q.where(Card.id.in_(tagged))
    return q


async def load_processes(db: AsyncSession, scope: ProcessScope) -> list[Card]:
    """Every ACTIVE BusinessProcess matching ``scope``, ordered by name."""
    result = await db.execute(scoped_process_query(scope).order_by(Card.name))
    return list(result.scalars().all())


async def process_in_scope(db: AsyncSession, scope: ProcessScope, process_id: uuid.UUID) -> bool:
    """Whether one process is inside a portal's published set.

    This is what stops a navigator portal filtered to one subtree from serving
    every other process's BPMN. It re-runs the *same* predicate the map used
    rather than trusting an id the client sends back.
    """
    q = scoped_process_query(scope).where(Card.id == process_id)
    result = await db.execute(select(func.count()).select_from(q.subquery()))
    return bool(result.scalar_one())


# ── Map builder ─────────────────────────────────────────────────────────


@dataclass
class ProcessMapData:
    """Everything both renderings of the Process House are built from."""

    processes: list[Card] = field(default_factory=list)
    organizations: list[Card] = field(default_factory=list)
    business_contexts: list[Card] = field(default_factory=list)
    # process id (str) → payload
    proc_apps: dict[str, list[dict]] = field(default_factory=dict)
    proc_data: dict[str, list[dict]] = field(default_factory=dict)
    proc_orgs: dict[str, set[str]] = field(default_factory=dict)
    proc_ctxs: dict[str, set[str]] = field(default_factory=dict)
    # Processes carrying a PUBLISHED flow version, and their step counts.
    published_ids: set[str] = field(default_factory=set)
    element_counts: dict[str, int] = field(default_factory=dict)


async def build_process_map(
    db: AsyncSession, scope: ProcessScope, *, include_landscape: bool = True
) -> ProcessMapData:
    """Load the process landscape: hierarchy plus related apps, data, orgs, contexts.

    ``include_landscape=False`` skips the Application, DataObject and
    BusinessContext queries entirely, keeping only the Organization links the
    house's filter needs. The public Process Navigator portal publishes none of
    that data, so loading every Application card in the instance on every
    anonymous page load would be work done purely to throw away.
    """
    processes = await load_processes(db, scope)
    if not processes:
        return ProcessMapData()

    proc_ids = [p.id for p in processes]

    async def _active(type_key: str) -> list[Card]:
        result = await db.execute(
            select(Card).where(Card.type == type_key, Card.status == "ACTIVE").order_by(Card.name)
        )
        return list(result.scalars().all())

    apps = await _active(APPLICATION_TYPE) if include_landscape else []
    data_objects = await _active(DATA_OBJECT_TYPE) if include_landscape else []
    orgs = await _active(ORGANIZATION_TYPE)
    contexts = await _active(BUSINESS_CONTEXT_TYPE) if include_landscape else []

    app_map = {a.id: a for a in apps}
    do_map = {d.id: d for d in data_objects}

    all_entity_ids = proc_ids + [o.id for o in orgs] + [c.id for c in contexts]
    rels_result = await db.execute(
        select(Relation).where(
            or_(
                Relation.source_id.in_(all_entity_ids),
                Relation.target_id.in_(all_entity_ids),
            )
        )
    )
    rels = rels_result.scalars().all()

    proc_id_set = {str(p.id) for p in processes}
    app_id_set = {str(a.id) for a in apps}
    do_id_set = {str(d.id) for d in data_objects}
    org_id_set = {str(o.id) for o in orgs}
    ctx_id_set = {str(c.id) for c in contexts}

    proc_apps: dict[str, list[dict]] = {pid: [] for pid in proc_id_set}
    proc_data: dict[str, list[dict]] = {pid: [] for pid in proc_id_set}
    proc_orgs: dict[str, set[str]] = {pid: set() for pid in proc_id_set}
    proc_ctxs: dict[str, set[str]] = {pid: set() for pid in proc_id_set}

    def _app_payload(card: Card, rel: Relation) -> dict:
        return {
            "id": str(card.id),
            "name": card.name,
            "subtype": card.subtype,
            "attributes": card.attributes or {},
            "lifecycle": card.lifecycle or {},
            "rel_attributes": rel.attributes or {},
        }

    # Dispatch on the ENDPOINTS' card types, not on a hardcoded relation-type key:
    # any number of relation types may connect BusinessProcess to Application /
    # DataObject / Organization / BusinessContext, and every one of them belongs on
    # the process map. The `REL_PROCESS_TO_*` constants remain the canonical keys the
    # *write* paths create (element_relation_sync), but reads must not be blind to a
    # second type an admin has added.
    #
    # A process may reach the same card through several relation types, so the
    # card-keyed collections dedupe by card id — sorting by (type, id) first makes
    # the surviving `rel_attributes` a stable choice rather than query order.
    seen_app: dict[str, set[str]] = {pid: set() for pid in proc_id_set}
    seen_do: dict[str, set[str]] = {pid: set() for pid in proc_id_set}

    def _link_app(proc_id: str, card: Card, rel: Relation) -> None:
        card_id = str(card.id)
        if card_id in seen_app[proc_id]:
            return
        seen_app[proc_id].add(card_id)
        proc_apps[proc_id].append(_app_payload(card, rel))

    def _link_do(proc_id: str, card: Card) -> None:
        card_id = str(card.id)
        if card_id in seen_do[proc_id]:
            return
        seen_do[proc_id].add(card_id)
        proc_data[proc_id].append({"id": card_id, "name": card.name})

    for r in sorted(rels, key=lambda rel: (rel.type or "", str(rel.id))):
        sid, tid = str(r.source_id), str(r.target_id)

        if sid in proc_id_set and tid in app_id_set:
            _link_app(sid, app_map[r.target_id], r)
        elif tid in proc_id_set and sid in app_id_set:
            _link_app(tid, app_map[r.source_id], r)

        elif sid in proc_id_set and tid in do_id_set:
            _link_do(sid, do_map[r.target_id])
        elif tid in proc_id_set and sid in do_id_set:
            _link_do(tid, do_map[r.source_id])

        elif sid in proc_id_set and tid in org_id_set:
            proc_orgs[sid].add(tid)
        elif tid in proc_id_set and sid in org_id_set:
            proc_orgs[tid].add(sid)

        elif sid in proc_id_set and tid in ctx_id_set:
            proc_ctxs[sid].add(tid)
        elif tid in proc_id_set and sid in ctx_id_set:
            proc_ctxs[tid].add(sid)

    published_ids, element_counts = await load_flow_coverage(db)

    return ProcessMapData(
        processes=processes,
        organizations=orgs,
        business_contexts=contexts,
        proc_apps=proc_apps,
        proc_data=proc_data,
        proc_orgs=proc_orgs,
        proc_ctxs=proc_ctxs,
        published_ids=published_ids,
        element_counts=element_counts,
    )


async def load_flow_coverage(db: AsyncSession) -> tuple[set[str], dict[str, int]]:
    """Which processes have a published flow, and how many elements each has.

    Two set-based queries, deliberately not per-process: this feeds an endpoint
    one page-load away from an anonymous visitor.
    """
    diag_result = await db.execute(
        select(ProcessFlowVersion.process_id)
        .where(ProcessFlowVersion.status == "published")
        .distinct()
    )
    published_ids = {str(row[0]) for row in diag_result}

    elem_result = await db.execute(
        select(ProcessElement.process_id, func.count(ProcessElement.id).label("cnt")).group_by(
            ProcessElement.process_id
        )
    )
    element_counts = {str(row.process_id): row.cnt for row in elem_result}
    return published_ids, element_counts


def total_app_cost(linked_apps: Sequence[dict]) -> float:
    """Sum of the linked applications' annual cost, tolerating either key."""
    return sum(
        (
            a.get("attributes", {}).get("costTotalAnnual", 0)
            or a.get("attributes", {}).get("totalAnnualCost", 0)
            or 0
        )
        for a in linked_apps
    )


# ── Published flow ──────────────────────────────────────────────────────


async def load_published_version(
    db: AsyncSession, process_id: uuid.UUID
) -> ProcessFlowVersion | None:
    """The currently published flow version, or ``None``.

    ``status == "published"`` only — never ``draft``, ``pending``, ``archived``
    or ``withdrawn``, and never the legacy ``process_diagrams`` table, which has
    no approval state at all. A withdrawn revision is *deliberately* unpublished,
    so it must not reappear through a portal.
    """
    result = await db.execute(
        select(ProcessFlowVersion)
        .where(
            ProcessFlowVersion.process_id == process_id,
            ProcessFlowVersion.status == "published",
        )
        .order_by(ProcessFlowVersion.revision.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def load_elements(db: AsyncSession, process_id: uuid.UUID) -> list[ProcessElement]:
    """Extracted BPMN elements for one process, in causal (``sequence_order``) order."""
    result = await db.execute(
        select(ProcessElement)
        .options(
            selectinload(ProcessElement.application),
            selectinload(ProcessElement.data_object),
            selectinload(ProcessElement.it_component),
            selectinload(ProcessElement.organizations),
        )
        .where(ProcessElement.process_id == process_id)
        .order_by(ProcessElement.sequence_order)
    )
    return list(result.scalars().all())


async def load_row_order(db: AsyncSession) -> list[str]:
    """The admin-configured Process House row order."""
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    order = general.get("bpmRowOrder")
    return list(order) if isinstance(order, list) and order else list(DEFAULT_ROW_ORDER)


# ── Public (account-less) projection ────────────────────────────────────


@dataclass(frozen=True)
class BpmPortalConfig:
    """What a Process Navigator portal is allowed to publish.

    Read from ``WebPortal.card_config["bpm"]``. Anything missing or malformed
    falls back to the defaults below rather than raising — this parses
    admin-authored JSONB on a public request path.

    Only ``show_element_links`` is a server-side concern; the portal's other
    ``bpm`` keys (``default_level``, ``default_overlay``, ``default_columns``)
    are opening state the client reads straight off ``card_config``, exactly as
    the PPM board's ``default_group_by`` / ``default_subtype`` are.
    """

    show_element_links: bool = False

    @classmethod
    def from_card_config(cls, card_config: dict | None) -> "BpmPortalConfig":
        cfg = (card_config or {}).get("bpm") if isinstance(card_config, dict) else None
        if not isinstance(cfg, dict):
            return cls()
        d = cls()
        v = cfg.get("show_element_links", d.show_element_links)
        return cls(show_element_links=v if isinstance(v, bool) else d.show_element_links)


def _public_attributes(attributes: dict | None) -> dict:
    """The whitelisted subset of a process's attributes (see the schema module)."""
    attrs = attributes or {}
    if not isinstance(attrs, dict):
        return {}
    return {k: attrs[k] for k in PUBLIC_PROCESS_ATTRIBUTES if k in attrs}


def to_public_process_map(
    data: ProcessMapData,
    row_order: Sequence[str],
) -> BpmPublicProcessMap:
    """Project the internal map onto the account-less shape.

    Organizations become opaque per-response tokens: the House's organization
    filter matches them client-side within one payload, so a real card id would
    be published for nothing. Applications, data objects, costs and business
    contexts are dropped entirely — see the schema module's docstring.
    """
    org_tokens: dict[str, str] = {}
    organizations: list[BpmPublicRef] = []
    for org in data.organizations:
        oid = str(org.id)
        token = f"o{len(org_tokens)}"
        org_tokens[oid] = token
        organizations.append(BpmPublicRef(token=token, name=org.name))

    items: list[BpmPublicProcess] = []
    for p in data.processes:
        pid = str(p.id)
        has_flow = pid in data.published_ids
        items.append(
            BpmPublicProcess(
                id=pid,
                name=p.name,
                subtype=p.subtype,
                parent_id=str(p.parent_id) if p.parent_id else None,
                description=p.description,
                lifecycle=p.lifecycle or {},
                attributes=_public_attributes(p.attributes),
                org_tokens=sorted(
                    org_tokens[oid] for oid in data.proc_orgs.get(pid, set()) if oid in org_tokens
                ),
                has_flow=has_flow,
                # Gated on a published version, not on the elements table: the
                # legacy diagram save writes elements with no approval involved.
                step_count=data.element_counts.get(pid, 0) if has_flow else 0,
            )
        )

    # Only the organizations some published process actually references are
    # worth shipping — the filter offers nothing for the rest.
    used = {t for it in items for t in it.org_tokens}
    return BpmPublicProcessMap(
        row_order=list(row_order),
        organizations=[o for o in organizations if o.token in used],
        items=items,
    )


def to_public_flow(
    version: ProcessFlowVersion | None,
    elements: Sequence[ProcessElement],
    *,
    cfg: BpmPortalConfig,
) -> BpmPublicFlow:
    """Project a published flow onto the account-less shape.

    ``version is None`` yields an empty flow whatever ``elements`` holds — that
    is the guard which keeps an unapproved flow's steps unpublished even though
    the legacy diagram path populates ``process_elements`` for it.
    """
    if version is None:
        return BpmPublicFlow()

    steps: list[BpmPublicStep] = []
    for e in elements:
        step = BpmPublicStep(
            bpmn_element_id=e.bpmn_element_id,
            element_type=e.element_type,
            name=e.name,
            documentation=e.documentation,
            lane_name=e.lane_name,
            is_automated=bool(e.is_automated),
            sequence_order=e.sequence_order or 0,
        )
        if cfg.show_element_links:
            step.application_name = e.application.name if e.application else None
            step.data_object_name = e.data_object.name if e.data_object else None
            step.it_component_name = e.it_component.name if e.it_component else None
            step.organizations = [
                BpmPublicRef(token=f"eo{i}", name=o.name)
                for i, o in enumerate(e.organizations or [])
            ]
        steps.append(step)

    return BpmPublicFlow(
        revision=version.revision,
        published_at=version.approved_at.isoformat() if version.approved_at else None,
        bpmn_xml=version.bpmn_xml,
        svg_thumbnail=version.svg_thumbnail,
        steps=steps,
    )
