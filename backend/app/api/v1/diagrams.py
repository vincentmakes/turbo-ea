from __future__ import annotations

import re
import secrets
import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.auth import _is_secure_request
from app.core.rate_limit import limiter
from app.core.security import (
    create_portal_token,
    decode_portal_token,
    portal_token_matches,
)
from app.database import get_db
from app.models.archimate_viewpoint import (
    ArchimateViewpoint,
    ArchimateViewpointExample,
    ArchimateViewpointObject,
    ArchimateViewpointTabCard,
)
from app.models.card import Card
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_favorite import DiagramFavorite
from app.models.diagram_group import diagram_group_members
from app.models.enterprise_object import EnterpriseObject, EnterpriseObjectCardMapping
from app.models.user import User
from app.services import audit_log
from app.services.archimate.taxonomy import TAB_LAYERS
from app.services.archimate.validate import validate_exchange
from app.services.card_read_scope import CardReadScope, require_card_readable
from app.services.diagram_legend import build_public_legend
from app.services.drawio_refs import extract_card_refs
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService
from app.services.public_access import (
    PUBLIC_ACCESS_COOKIE,
    build_sso_gate_config,
    normalise_access_mode,
    normalise_email_domains,
    resolve_sso_visitor_email,
    set_access_cookie,
)

router = APIRouter(prefix="/diagrams", tags=["diagrams"])

# The cardId pattern lives in a service module: workspace transfer rewrites the
# same ids when cards land under new ones on another instance.
_extract_card_refs = extract_card_refs


# Turbo EA's own bookkeeping attributes on DrawIO cells. They are what make a
# shape a *card* rather than a rectangle, and they are stripped before a diagram
# is served publicly: a published diagram is a picture, not a queryable slice of
# the inventory. Without this the "no drill-through" decision would be enforced
# only by the UI, while the raw XML still handed every visitor the card UUIDs
# and the relation graph behind the picture.
_PRIVATE_CELL_ATTRS = (
    "cardId",
    "cardName",
    "cardDetail",
    # Only ever on a still-pending cell: the description typed in the editor's
    # Create-card dialog, held until Sync posts it (#1210). Not part of the
    # picture any more than the name stamp is.
    "cardDescription",
    "cardSubtype",
    "cardType",
    "relationId",
    "relationType",
    "parentGroupCell",
    "childCellIds",
    "expanded",
)
_PRIVATE_ATTR_RE = re.compile(
    r"\s(?:" + "|".join(_PRIVATE_CELL_ATTRS) + r')="[^"]*"',
)


def sanitise_public_xml(xml: str | None) -> str:
    """Strip Turbo EA attributes from diagram XML for public rendering.

    Labels, geometry and styling survive untouched — that is the picture the
    publisher chose to share, including any attribute rows they chose to render
    under a card's name. What leaves with this is the internal identity of every
    shape.

    ``cardName`` is stripped along with the ids even though a card's name is
    normally its label: once a shape carries detail rows the label is composed
    HTML, and a hand-renamed shape's label no longer matches ``cardName`` at
    all — so the attribute can hold a name the published picture deliberately
    does not show.
    """
    if not xml:
        return ""
    return _PRIVATE_ATTR_RE.sub("", xml)


def _public_cookie_path(slug: str) -> str:
    return f"/api/v1/diagrams/public/{slug}"


async def _load_published_diagram(slug: str, db: AsyncSession) -> Diagram:
    result = await db.execute(
        select(Diagram).where(
            Diagram.public_slug == slug,
            Diagram.is_published.is_(True),
            # Defence in depth: an ArchiMate row never serves publicly, even
            # if it arrives published (e.g. via a workspace import).
            Diagram.kind == "drawio",
        )
    )
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    return d


async def require_public_diagram(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Diagram:
    """Resolve a published diagram and enforce its access mode.

    Public diagrams pass straight through. SSO-gated ones require a session
    cookie bound to *this* diagram; otherwise a machine-readable
    ``401 portal_locked`` so the embed page shows the sign-in gate rather than a
    generic error (the frontend gate component is shared with web portals).
    """
    d = await _load_published_diagram(slug, db)
    if normalise_access_mode(d.access_mode) == "public":
        return d

    token = request.cookies.get(PUBLIC_ACCESS_COOKIE, "")
    claims = decode_portal_token(token) if token else None
    if not portal_token_matches(claims, "diagram", d.id):
        raise HTTPException(401, detail="portal_locked")
    return d


ARCHIMATE_FORMAT = "archimate-exchange-3.1"
DIAGRAM_KINDS = ("drawio", "archimate")


async def viewpoint_tabs(db: AsyncSession, viewpoint_key: str) -> set[str]:
    """The ``TAB_LAYERS`` tabs a viewpoint spans: every tab whose layer set holds
    at least one of its allowed objects' ``EnterpriseObject.layer`` -- the same
    rule ``list_viewpoints_for_tab`` uses to place it in a tab's picker."""
    rows = await db.execute(
        select(EnterpriseObject.layer)
        .join(
            ArchimateViewpointObject,
            ArchimateViewpointObject.enterprise_object_key == EnterpriseObject.key,
        )
        .where(ArchimateViewpointObject.viewpoint_key == viewpoint_key)
    )
    layers = {layer for layer in rows.scalars().all() if layer}
    return {tab for tab, tab_layers in TAB_LAYERS.items() if tab_layers & layers}


async def require_archimate_permission(
    db: AsyncSession, user: User, viewpoint_key: str | None, action: str | tuple[str, ...]
) -> None:
    """403 unless ``user`` holds ``archimatediagrams.<tab>.<action>`` (any of the given
    actions) on at least one tab the viewpoint spans. No viewpoint, or one spanning no
    tab (e.g. the implementation-layer ones), needs it on any tab -- the unscoped
    entry point."""
    actions = (action,) if isinstance(action, str) else action
    tabs = await viewpoint_tabs(db, viewpoint_key) if viewpoint_key else set()
    for tab in sorted(tabs or TAB_LAYERS):
        for a in actions:
            if await PermissionService.has_app_permission(db, user, f"archimatediagrams.{tab}.{a}"):
                return
    raise HTTPException(403, "Insufficient permissions")


def check_kind_data(kind: str, data: dict | None) -> None:
    """422 unless ``data`` has the shape its ``kind`` stores."""
    is_archimate = isinstance(data, dict) and data.get("format") == ARCHIMATE_FORMAT
    if kind == "archimate":
        xml = data.get("xml") if isinstance(data, dict) else None
        if not is_archimate or not isinstance(xml, str) or not xml.strip():
            raise HTTPException(
                422,
                f"ArchiMate diagrams need data {{format: '{ARCHIMATE_FORMAT}', "
                "xml: <Exchange XML>}",
            )
    elif is_archimate:
        raise HTTPException(422, "ArchiMate data cannot be stored on a DrawIO diagram")


async def ensure_valid_archimate(kind: str, data: dict | None) -> None:
    """422 with the validator's issues when an ArchiMate diagram's XML is not a valid model.

    Call after ``check_kind_data`` (which guarantees ``data["xml"]`` is a str).
    """
    if kind != "archimate" or not isinstance(data, dict):
        return
    # CPU-bound parse: keep it off the event loop.
    issues = await run_in_threadpool(validate_exchange, data["xml"])
    if issues:
        raise HTTPException(
            422,
            {"message": "Invalid ArchiMate model", "issues": [asdict(i) for i in issues]},
        )


class DiagramCreate(BaseModel):
    name: str
    description: str | None = None
    data: dict | None = None
    card_ids: list[str] | None = None
    kind: str = "drawio"
    viewpoint_key: str | None = None
    # Validate everything (permission, card ids, read scope), then roll back:
    # the MCP `create_diagram` preview is verified by the backend, not guessed.
    dry_run: bool = False


class DiagramUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    data: dict | None = None
    card_ids: list[str] | None = None
    kind: str | None = None
    dry_run: bool = False


# ── helpers ───────────────────────────────────────────────────────────────────


def _xml_of(data: dict | None) -> str:
    """The DrawIO XML a diagram's ``data`` carries ("" when none)."""
    return (data or {}).get("xml") or ""


async def _discard_dry_run(savepoint) -> None:
    """Roll a dry run's savepoint back when the request fails inside it, so a
    preview that raised never leaves a half-written diagram in the session."""
    if savepoint is not None and savepoint.is_active:
        await savepoint.rollback()


async def _get_card_ids(db: AsyncSession, diagram_id: uuid.UUID) -> list[str]:
    """Return card_ids for a single diagram."""
    result = await db.execute(
        select(diagram_cards.c.card_id).where(
            diagram_cards.c.diagram_id == diagram_id,
        )
    )
    return [str(row[0]) for row in result.all()]


async def _readable_card_ids(db: AsyncSession, user: User, card_ids: list[str]) -> list[str]:
    """``card_ids`` minus the cards hidden from ``user`` (order kept)."""
    read_scope = await CardReadScope.load(db, user)
    if read_scope.is_unrestricted(mode="module"):
        return card_ids
    ok = {
        str(c)
        for c in await read_scope.readable_card_ids(
            db, {uuid.UUID(c) for c in card_ids}, mode="module"
        )
    }
    return [c for c in card_ids if c in ok]


async def _existing_card_ids(db: AsyncSession, ids: set[uuid.UUID]) -> set[uuid.UUID]:
    """The subset of ``ids`` that still match a card.

    A diagram's XML can outlive a hard-purged card; its id must not reach
    ``diagram_cards`` (FK) — it is dropped, like a link to a deleted card.
    """
    if not ids:
        return set()
    rows = await db.execute(select(Card.id).where(Card.id.in_(ids)))
    return {r[0] for r in rows.all()}


async def _get_card_ids_bulk(db: AsyncSession) -> dict[str, list[str]]:
    """Return mapping of diagram_id -> [card_id, ...] for all diagrams."""
    result = await db.execute(select(diagram_cards))
    mapping: dict[str, list[str]] = {}
    for row in result.all():
        did = str(row.diagram_id)
        mapping.setdefault(did, []).append(str(row.card_id))
    return mapping


async def _get_group_ids_bulk(db: AsyncSession) -> dict[str, list[str]]:
    """Return mapping of diagram_id -> [group_id, ...] for all diagrams."""
    result = await db.execute(select(diagram_group_members))
    mapping: dict[str, list[str]] = {}
    for row in result.all():
        did = str(row.diagram_id)
        mapping.setdefault(did, []).append(str(row.group_id))
    return mapping


async def _get_favorite_ids(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    """Return the set of diagram_ids the user has favorited."""
    result = await db.execute(
        select(DiagramFavorite.diagram_id)
        .join(Diagram, Diagram.id == DiagramFavorite.diagram_id)
        .where(DiagramFavorite.user_id == user_id, Diagram.kind.in_(DIAGRAM_KINDS))
    )
    return {str(row[0]) for row in result.all()}


async def _get_creator_names(db: AsyncSession, rows: list[Diagram]) -> dict[str, str]:
    """Return mapping of user_id -> display_name for the diagrams' creators."""
    ids = {d.created_by for d in rows if d.created_by}
    if not ids:
        return {}
    result = await db.execute(select(User.id, User.display_name).where(User.id.in_(ids)))
    return {str(uid): name for uid, name in result.all()}


async def _set_card_ids(
    db: AsyncSession,
    diagram_id: uuid.UUID,
    card_ids: list[str],
) -> None:
    """Replace all card links for a diagram."""
    await db.execute(
        delete(diagram_cards).where(
            diagram_cards.c.diagram_id == diagram_id,
        )
    )
    for cid in card_ids:
        await db.execute(
            diagram_cards.insert().values(
                diagram_id=diagram_id,
                card_id=uuid.UUID(cid),
            )
        )


async def _diagram_for(db: AsyncSession, user: User, diagram_id: str, action: str) -> Diagram:
    """Load a diagram behind its kind's permission: ``diagrams.<action>`` for
    DrawIO (checked before the lookup, as always), the per-layer
    ``archimatediagrams.<tab>.<action>`` for ArchiMate."""
    result = await db.execute(
        select(Diagram).where(Diagram.id == uuid.UUID(diagram_id), Diagram.kind.in_(DIAGRAM_KINDS))
    )
    d = result.scalar_one_or_none()
    if d is not None and d.kind == "archimate":
        await require_archimate_permission(db, user, d.viewpoint_key, action)
        return d
    await PermissionService.require_permission(db, user, f"diagrams.{action}")
    if not d:
        raise HTTPException(404, "Diagram not found")
    return d


# ── endpoints ─────────────────────────────────────────────────────────────────


_SORT_COLUMNS = {
    "name": Diagram.name,
    "created_at": Diagram.created_at,
    "updated_at": Diagram.updated_at,
}


@router.get("")
async def list_diagrams(
    card_id: str | None = None,
    search: str | None = None,
    mine: bool = False,
    favorites: bool = False,
    group_id: str | None = None,
    viewpoint_key: str | None = None,
    sort_by: str = "updated_at",
    sort_dir: str = "desc",
    kind: str = "drawio",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if kind == "archimate":
        # The Architecture Studio list: any layer's ArchiMate view or manage key.
        await require_archimate_permission(db, user, None, ("view", "manage"))
    else:
        await PermissionService.require_permission(db, user, "diagrams.view")
    if kind != "all" and kind not in DIAGRAM_KINDS:
        raise HTTPException(422, "kind must be 'drawio', 'archimate' or 'all'")

    stmt = select(Diagram).where(Diagram.kind.in_(DIAGRAM_KINDS))
    if kind != "all":
        # Default drawio: every existing consumer (Diagrams page, card
        # Resources tab, MCP) keeps seeing only DrawIO diagrams.
        stmt = stmt.where(Diagram.kind == kind)
    if viewpoint_key:
        stmt = stmt.where(Diagram.viewpoint_key == viewpoint_key)
    if card_id:
        # Filter: only diagrams linked to this card
        stmt = stmt.join(diagram_cards, diagram_cards.c.diagram_id == Diagram.id).where(
            diagram_cards.c.card_id == uuid.UUID(card_id)
        )
    if mine:
        stmt = stmt.where(Diagram.created_by == user.id)
    if group_id:
        stmt = stmt.join(
            diagram_group_members, diagram_group_members.c.diagram_id == Diagram.id
        ).where(diagram_group_members.c.group_id == uuid.UUID(group_id))

    favorite_ids = await _get_favorite_ids(db, user.id)
    if favorites:
        if not favorite_ids:
            return []
        stmt = stmt.where(Diagram.id.in_({uuid.UUID(fid) for fid in favorite_ids}))

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    if kind in ("all", "archimate"):
        # A mixed listing: plain diagrams.view (checked above) covers every
        # DrawIO row, but an ArchiMate row also needs its own
        # archimatediagrams.<tab>.* permission on at least one tab it spans --
        # silently dropped, like an unreadable linked card, rather than 403ing
        # the whole list over one diagram the user can't see.
        tabs_cache: dict[str | None, set[str]] = {}
        visible_rows = []
        for d in rows:
            if d.kind != "archimate":
                visible_rows.append(d)
                continue
            if d.viewpoint_key not in tabs_cache:
                tabs_cache[d.viewpoint_key] = (
                    await viewpoint_tabs(db, d.viewpoint_key) if d.viewpoint_key else set()
                )
            allowed = False
            for tab in tabs_cache[d.viewpoint_key] or TAB_LAYERS:
                if await PermissionService.has_app_permission(
                    db, user, f"archimatediagrams.{tab}.view"
                ) or await PermissionService.has_app_permission(
                    db, user, f"archimatediagrams.{tab}.manage"
                ):
                    allowed = True
                    break
            if allowed:
                visible_rows.append(d)
        rows = visible_rows

    # Bulk-load supporting data. Linked cards hidden from the reader are left
    # out of `card_ids`, and a hidden card's name never matches a search.
    read_scope = await CardReadScope.load(db, user)
    id_map = await _get_card_ids_bulk(db)
    if not read_scope.is_unrestricted(mode="module"):
        all_linked = {uuid.UUID(c) for ids in id_map.values() for c in ids}
        readable_linked = {
            str(c) for c in await read_scope.readable_card_ids(db, all_linked, mode="module")
        }
        id_map = {did: [c for c in ids if c in readable_linked] for did, ids in id_map.items()}
    group_map = await _get_group_ids_bulk(db)
    creator_names = await _get_creator_names(db, rows)

    # Unified text search: name / description / author / contained-card names.
    if search and search.strip():
        term = search.strip().lower()
        like = f"%{search.strip()}%"
        matching_card_ids = {
            str(row[0])
            for row in (
                await db.execute(
                    select(Card.id).where(
                        Card.name.ilike(like), *read_scope.where(Card, mode="module")
                    )
                )
            ).all()
        }

        def _matches(d: Diagram) -> bool:
            if term in (d.name or "").lower():
                return True
            if d.description and term in d.description.lower():
                return True
            author = creator_names.get(str(d.created_by)) if d.created_by else None
            if author and term in author.lower():
                return True
            # Contained cards = explicit links ∪ cards drawn on the canvas.
            refs = set(id_map.get(str(d.id), [])) | set(_extract_card_refs(d.data))
            return bool(refs & matching_card_ids)

        rows = [d for d in rows if _matches(d)]

    # Sorting (whitelisted columns; default updated_at desc).
    sort_col = sort_by if sort_by in _SORT_COLUMNS else "updated_at"
    reverse = sort_dir != "asc"
    if sort_col == "name":
        rows.sort(key=lambda d: (d.name or "").lower(), reverse=reverse)
    else:
        rows.sort(
            key=lambda d: getattr(d, sort_col) or "",
            reverse=reverse,
        )

    return [
        {
            "id": str(d.id),
            "name": d.name,
            "kind": d.kind,
            "viewpoint_key": d.viewpoint_key,
            "description": d.description,
            "card_ids": id_map.get(str(d.id), []),
            "group_ids": group_map.get(str(d.id), []),
            "thumbnail": (d.data or {}).get("thumbnail"),
            "card_count": len(_extract_card_refs(d.data)),
            "created_by": str(d.created_by) if d.created_by else None,
            "created_by_name": creator_names.get(str(d.created_by)) if d.created_by else None,
            "created_via": d.created_via,
            "updated_via": d.updated_via,
            "is_favorite": str(d.id) in favorite_ids,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in rows
    ]


# ── favorites (per-user) ───────────────────────────────────────────────────────
# NOTE: these must be declared before the ``/{diagram_id}`` routes so that
# ``/diagrams/favorites`` is not captured by the ``{diagram_id}`` path param.


@router.get("/favorites")
async def list_favorite_diagrams(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the set of diagram ids the current user has favorited."""
    await PermissionService.require_permission(db, user, "diagrams.view")
    return sorted(await _get_favorite_ids(db, user.id))


@router.post("/{diagram_id}/favorite", status_code=201)
async def add_diagram_favorite(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add a diagram to favorites. Idempotent."""
    await PermissionService.require_permission(db, user, "diagrams.view")
    d_id = uuid.UUID(diagram_id)
    result = await db.execute(
        select(Diagram).where(Diagram.id == d_id, Diagram.kind.in_(DIAGRAM_KINDS))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Diagram not found")
    existing = await db.execute(
        select(DiagramFavorite).where(
            DiagramFavorite.user_id == user.id,
            DiagramFavorite.diagram_id == d_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"status": "already_favorited"}
    db.add(DiagramFavorite(user_id=user.id, diagram_id=d_id))
    await db.commit()
    return {"diagram_id": str(d_id)}


@router.delete("/{diagram_id}/favorite", status_code=204)
async def remove_diagram_favorite(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove a diagram from favorites."""
    await PermissionService.require_permission(db, user, "diagrams.view")
    result = await db.execute(
        delete(DiagramFavorite).where(
            DiagramFavorite.diagram_id.in_(
                select(Diagram.id).where(Diagram.kind.in_(DIAGRAM_KINDS))
            ),
            DiagramFavorite.user_id == user.id,
            DiagramFavorite.diagram_id == uuid.UUID(diagram_id),
        )
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(404, "Favorite not found")
    await db.commit()


@router.post("", status_code=201)
async def create_diagram(
    body: DiagramCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.kind != "archimate":
        await PermissionService.require_permission(db, user, "diagrams.manage")
    if body.kind not in DIAGRAM_KINDS:
        raise HTTPException(422, "kind must be 'drawio' or 'archimate'")
    if body.kind == "archimate" and not body.viewpoint_key:
        raise HTTPException(422, "viewpoint_key is required for archimate diagrams")
    if body.viewpoint_key:
        vp = await db.execute(
            select(ArchimateViewpoint).where(
                ArchimateViewpoint.key == body.viewpoint_key,
                ArchimateViewpoint.is_hidden == False,  # noqa: E712
            )
        )
        if vp.scalar_one_or_none() is None:
            raise HTTPException(404, "Viewpoint not found")
    if body.kind == "archimate":
        await require_archimate_permission(db, user, body.viewpoint_key, "manage")
    check_kind_data(body.kind, body.data)
    await ensure_valid_archimate(body.kind, body.data)
    # Validate first, write second: a hidden card 404s before anything is
    # added to the session, dry run or not.
    card_ids: list[str] = []
    if body.card_ids:
        read_scope = await CardReadScope.load(db, user)
        wanted = {uuid.UUID(c) for c in body.card_ids}
        if await read_scope.hidden_card_ids(db, wanted, mode="module"):
            raise HTTPException(404, "Card not found")
        # Ids of purged cards are dropped silently (as on PATCH).
        existing = await _existing_card_ids(db, wanted)
        card_ids = [c for c in body.card_ids if uuid.UUID(c) in existing]
    # Dry-run isolation — the same savepoint pattern as `bpm.save_diagram`.
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None
    try:
        d = Diagram(
            name=body.name,
            kind=body.kind,
            description=body.description,
            data=body.data or {},
            created_by=user.id,
            viewpoint_key=body.viewpoint_key,
        )
        db.add(d)
        await db.flush()  # get d.id
        if card_ids:
            await _set_card_ids(db, d.id, card_ids)
    except BaseException:
        await _discard_dry_run(dry_run_savepoint)
        raise

    if body.dry_run:
        assert dry_run_savepoint is not None
        # Built before the rollback: the rolled-back row cannot be read after it.
        preview = {
            "dry_run": True,
            "id": None,
            "name": body.name,
            "card_ids": card_ids,
            "card_refs": _extract_card_refs(body.data),
            "xml_chars": len(_xml_of(body.data)),
        }
        await dry_run_savepoint.rollback()
        return preview

    # Never the XML itself in an event: a canvas can be megabytes.
    await event_bus.publish(
        "diagram.created",
        {"id": str(d.id), "name": d.name, "card_ids": card_ids},
        db=db,
        card_id=None,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(d)
    return {
        "id": str(d.id),
        "name": d.name,
        "kind": d.kind,
        "card_ids": card_ids,
        "created_via": d.created_via,
        "updated_via": d.updated_via,
    }


# ── viewpoint picker (creation dashboard) ──────────────────────────────────────


@router.get("/viewpoints-for-tab")
async def list_viewpoints_for_tab(
    tab: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every non-hidden ArchiMate Viewpoint relevant to one of the three
    diagram-creation dashboard tabs (business/application/technology).

    A viewpoint appears in a tab when at least one of its allowed objects'
    ``EnterpriseObject.layer`` falls in that tab's layer set (``TAB_LAYERS``)
    -- so a viewpoint spanning two tabs' layers (e.g. Implementation and
    Deployment, application + technology) appears in both. Authenticated
    read, like ``GET /metamodel/viewpoints`` -- any user who can create a
    diagram needs this, not just metamodel admins.
    """
    layers = TAB_LAYERS.get(tab)
    if layers is None:
        raise HTTPException(400, f"Unknown tab {tab!r}")

    vp_result = await db.execute(
        select(ArchimateViewpoint)
        .where(ArchimateViewpoint.is_hidden == False)  # noqa: E712
        .order_by(ArchimateViewpoint.sort_order)
    )
    viewpoints = vp_result.scalars().all()

    layer_rows = await db.execute(
        select(ArchimateViewpointObject.viewpoint_key, EnterpriseObject.layer).join(
            EnterpriseObject,
            EnterpriseObject.key == ArchimateViewpointObject.enterprise_object_key,
        )
    )
    layers_by_viewpoint: dict[str, set[str]] = {}
    for viewpoint_key, layer in layer_rows.all():
        if layer is not None:
            layers_by_viewpoint.setdefault(viewpoint_key, set()).add(layer)

    examples_result = await db.execute(select(ArchimateViewpointExample))
    examples_by_viewpoint: dict[str, list[dict]] = {}
    for e in examples_result.scalars().all():
        examples_by_viewpoint.setdefault(e.viewpoint_key, []).append(
            {"id": str(e.id), "name": e.name}
        )

    return [
        {
            "key": v.key,
            "name": v.name,
            "icon": v.icon,
            "description": v.description,
            "examples": examples_by_viewpoint.get(v.key, []),
        }
        for v in viewpoints
        if layers_by_viewpoint.get(v.key, set()) & layers
    ]


@router.get("/viewpoints-for-tab/{viewpoint_key}/suggested-cards")
async def suggested_cards_for_viewpoint_tab(
    viewpoint_key: str,
    tab: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Card types to suggest creating from a viewpoint's card-detail tab, each
    paired with the Enterprise Object (ArchiMate element) type it resolves to
    so a caller can draw a node for a card of that type without a second
    round trip.

    Card types come from the explicit ``(viewpoint_key, tab)`` override
    (``ArchimateViewpointTabCard``) when one exists; otherwise every card
    type mapped to the viewpoint's allowed objects -- the "no override
    needed for single-tab viewpoints" default from spec §5. ``tab`` is
    optional: the override only applies per-tab, but the fallback is
    already tab-independent (every object the viewpoint allows, regardless
    of tab), so the unscoped diagram-creation entry point (no tab at all)
    gets the fallback straight away. Either way, the paired
    ``enterprise_object_key`` always comes from ``EnterpriseObjectCardMapping``
    restricted to this viewpoint's own allowed objects (the override table
    has no element-type column of its own) -- ``None`` when a card type
    isn't actually mapped to any object this viewpoint allows, which only
    an inconsistent override can produce.
    """
    if tab is not None and tab not in TAB_LAYERS:
        raise HTTPException(400, f"Unknown tab {tab!r}")

    vp_result = await db.execute(
        select(ArchimateViewpoint.key).where(ArchimateViewpoint.key == viewpoint_key)
    )
    if not vp_result.scalar_one_or_none():
        raise HTTPException(404, "Viewpoint not found")

    card_type_keys: list[str] = []
    if tab is not None:
        override_result = await db.execute(
            select(ArchimateViewpointTabCard.card_type_key).where(
                ArchimateViewpointTabCard.viewpoint_key == viewpoint_key,
                ArchimateViewpointTabCard.tab_key == tab,
            )
        )
        card_type_keys = list(override_result.scalars().all())

    if not card_type_keys:
        fallback_result = await db.execute(
            select(EnterpriseObjectCardMapping.card_type_key)
            .join(
                ArchimateViewpointObject,
                ArchimateViewpointObject.enterprise_object_key
                == EnterpriseObjectCardMapping.enterprise_object_key,
            )
            .where(ArchimateViewpointObject.viewpoint_key == viewpoint_key)
            .distinct()
        )
        card_type_keys = list(fallback_result.scalars().all())

    if not card_type_keys:
        return []

    eo_result = await db.execute(
        select(
            EnterpriseObjectCardMapping.card_type_key,
            EnterpriseObjectCardMapping.enterprise_object_key,
        )
        .join(
            ArchimateViewpointObject,
            ArchimateViewpointObject.enterprise_object_key
            == EnterpriseObjectCardMapping.enterprise_object_key,
        )
        .where(
            ArchimateViewpointObject.viewpoint_key == viewpoint_key,
            EnterpriseObjectCardMapping.card_type_key.in_(card_type_keys),
        )
    )
    eo_key_by_card_type: dict[str, str] = {}
    for card_type_key, enterprise_object_key in eo_result.all():
        eo_key_by_card_type.setdefault(card_type_key, enterprise_object_key)

    return [
        {"card_type_key": k, "enterprise_object_key": eo_key_by_card_type.get(k)}
        for k in card_type_keys
    ]


@router.get("/viewpoints-for-tab/{viewpoint_key}/examples/{example_id}")
async def get_viewpoint_tab_example(
    viewpoint_key: str,
    example_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The full Exchange XML for one example, to seed a new diagram's starting content.

    ``viewpoints-for-tab`` only returns ``{id, name}`` per example so that list stays
    cheap; the creation dashboard fetches this lazily, only for the example card the
    user actually clicks.
    """
    try:
        example_uuid = uuid.UUID(example_id)
    except ValueError:
        raise HTTPException(404, "Example not found") from None
    result = await db.execute(
        select(ArchimateViewpointExample).where(
            ArchimateViewpointExample.id == example_uuid,
            ArchimateViewpointExample.viewpoint_key == viewpoint_key,
        )
    )
    example = result.scalar_one_or_none()
    if not example:
        raise HTTPException(404, "Example not found")
    return {"id": str(example.id), "name": example.name, "xml": example.exchange_xml}


# ── public (unauthenticated) diagram access ───────────────────────────────────


@router.get("/public/{slug}/gate")
async def get_diagram_gate(slug: str, db: AsyncSession = Depends(get_db)):
    """Always-public gate metadata: the access mode and, for SSO, the config the
    embed page needs to start the IdP redirect. Returns the name and nothing
    else — never the XML, and never anything about the cards behind it."""
    d = await _load_published_diagram(slug, db)
    mode = normalise_access_mode(d.access_mode)
    out: dict = {"access_mode": mode, "name": d.name}
    if mode == "sso":
        sso_out = await build_sso_gate_config(db, context=f"diagram {slug}")
        if sso_out:
            out["sso"] = sso_out
    return out


class DiagramSsoCallbackRequest(BaseModel):
    code: str
    redirect_uri: str


@router.post("/public/{slug}/sso/callback")
@limiter.limit("20/minute")
async def diagram_sso_callback(
    slug: str,
    request: Request,
    response: Response,
    body: DiagramSsoCallbackRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange an SSO authorization code for an account-less diagram session.

    Creates NO user account — it mints a cookie scoped to this one diagram.
    """
    d = await _load_published_diagram(slug, db)
    if normalise_access_mode(d.access_mode) != "sso":
        raise HTTPException(400, "This diagram does not use SSO access")

    email = await resolve_sso_visitor_email(
        db,
        code=body.code,
        redirect_uri=body.redirect_uri,
        allowed_email_domains=d.allowed_email_domains,
        denied_message="Your account is not allowed to access this diagram.",
    )

    token = create_portal_token(d.id, slug, email, resource="diagram")
    # The embed page lives inside another site's iframe, so this cookie must be
    # readable cross-site (see `set_access_cookie`). Portals stay Lax.
    set_access_cookie(
        response,
        token,
        path=_public_cookie_path(slug),
        secure=_is_secure_request(request),
        cross_site=True,
    )
    return {"ok": True}


@router.get("/public/{slug}")
async def get_public_diagram(
    d: Diagram = Depends(require_public_diagram),
    db: AsyncSession = Depends(get_db),
):
    """Return the published picture: a name, sanitised DrawIO XML and its legend.

    Deliberately narrow. No card ids, no relations, no description, no
    lifecycle — see ``sanitise_public_xml``. The XML is enough for the DrawIO
    lightbox to render, pan and zoom it, and nothing more. ``legend`` is the key
    to the colours the picture already shows (``None`` when coloured by card
    type): labels, colours and counts only, never a card's identity or value —
    see ``build_public_legend``.
    """
    return {
        "name": d.name,
        "xml": sanitise_public_xml((d.data or {}).get("xml")),
        "legend": await build_public_legend(db, d.data, _extract_card_refs(d.data)),
    }


@router.get("/{diagram_id}")
async def get_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = await _diagram_for(db, user, diagram_id, "view")
    linked_card_ids = await _readable_card_ids(db, user, await _get_card_ids(db, d.id))
    group_result = await db.execute(
        select(diagram_group_members.c.group_id).where(diagram_group_members.c.diagram_id == d.id)
    )
    group_ids = [str(row[0]) for row in group_result.all()]
    favorite_ids = await _get_favorite_ids(db, user.id)
    creator_names = await _get_creator_names(db, [d])
    return {
        "id": str(d.id),
        "name": d.name,
        "kind": d.kind,
        "description": d.description,
        "viewpoint_key": d.viewpoint_key,
        "data": d.data,
        "card_ids": linked_card_ids,
        "card_refs": _extract_card_refs(d.data),
        "group_ids": group_ids,
        "created_by": str(d.created_by) if d.created_by else None,
        "created_by_name": creator_names.get(str(d.created_by)) if d.created_by else None,
        "created_via": d.created_via,
        "updated_via": d.updated_via,
        "is_favorite": str(d.id) in favorite_ids,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        **_publish_state(d),
    }


@router.patch("/{diagram_id}")
async def update_diagram(
    diagram_id: str,
    body: DiagramUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = await _diagram_for(db, user, diagram_id, "manage")
    if body.kind is not None and body.kind != d.kind:
        raise HTTPException(422, "kind cannot be changed")
    if body.data is not None:
        check_kind_data(d.kind, body.data)
        await ensure_valid_archimate(d.kind, body.data)
    # Validate first, write second: a hidden card 404s before the diagram is
    # touched, dry run or not.
    wanted: set[uuid.UUID] | None = None
    read_scope = None
    old_ids = set(await _get_card_ids(db, d.id))
    current = {uuid.UUID(c) for c in old_ids}
    if body.card_ids is not None:
        read_scope = await CardReadScope.load(db, user)
        wanted = {uuid.UUID(c) for c in body.card_ids}
        # Only a NEW link to a card the saver cannot see is refused: a link that
        # is already there (hidden from them) is not theirs to re-authorise.
        if await read_scope.hidden_card_ids(db, wanted - current, mode="module"):
            raise HTTPException(404, "Card not found")
        # Ids of purged cards (still in the XML) are dropped silently.
        wanted = await _existing_card_ids(db, wanted)
    # Dry-run isolation — the same savepoint pattern as `bpm.save_diagram`.
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None
    try:
        old_xml = _xml_of(d.data)
        new_xml = old_xml
        changes: dict = {}
        if body.name is not None:
            if body.name != d.name:
                changes["name"] = {"old": d.name, "new": body.name}
            d.name = body.name
        if body.description is not None:
            if body.description != d.description:
                changes["description"] = {"old": d.description, "new": body.description}
            d.description = body.description
        if body.data is not None:
            # Store the data and auto-extract card references into it
            new_data = dict(body.data)
            if d.kind == "drawio":
                new_data["card_refs"] = _extract_card_refs(new_data)
            d.data = new_data
            new_xml = _xml_of(new_data)
        if wanted is not None and read_scope is not None:
            # The client was only shown the readable links — keep the hidden ones.
            wanted |= await read_scope.hidden_card_ids(db, current, mode="module")
            await _set_card_ids(db, d.id, [str(c) for c in wanted])
        new_ids = set(await _get_card_ids(db, d.id))
    except BaseException:
        await _discard_dry_run(dry_run_savepoint)
        raise
    # Top-level `*_card_ids` keys, never nested under `changes`: the activity
    # feeds scrub hidden ids from top-level keys only (`scrub_event_payloads`).
    # Neither list can name a card hidden from the caller — wanted ids were
    # checked above and hidden links are kept on both sides.
    added_card_ids = sorted(new_ids - old_ids)
    removed_card_ids = sorted(old_ids - new_ids)
    xml_changed = new_xml != old_xml

    if body.dry_run:
        assert dry_run_savepoint is not None
        # Built before the rollback: the rolled-back row cannot be read after it.
        preview = {
            "dry_run": True,
            "id": str(d.id),
            "name": d.name,
            "card_ids": await _readable_card_ids(db, user, await _get_card_ids(db, d.id)),
            "card_refs": _extract_card_refs(d.data),
            "xml_chars": len(new_xml),
            "xml_changed": xml_changed,
            "changes": changes,
            "added_card_ids": added_card_ids,
            "removed_card_ids": removed_card_ids,
        }
        await dry_run_savepoint.rollback()
        return preview

    # Never the XML itself in an event: a canvas can be megabytes. A PATCH that
    # changed nothing writes no event — the audit log would say "updated"
    # about a diagram whose row SQLAlchemy never touched.
    if changes or added_card_ids or removed_card_ids or xml_changed:
        await event_bus.publish(
            "diagram.updated",
            {
                "id": str(d.id),
                "name": d.name,
                "changes": changes,
                "added_card_ids": added_card_ids,
                "removed_card_ids": removed_card_ids,
                "xml_changed": xml_changed,
                "xml_chars": {"old": len(old_xml), "new": len(new_xml)},
            },
            db=db,
            card_id=None,
            user_id=user.id,
        )
    await db.commit()
    await db.refresh(d)
    linked_card_ids = await _readable_card_ids(db, user, await _get_card_ids(db, d.id))
    return {
        "id": str(d.id),
        "name": d.name,
        "card_ids": linked_card_ids,
        "created_via": d.created_via,
        "updated_via": d.updated_via,
    }


@router.delete("/{diagram_id}", status_code=204)
async def delete_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = await _diagram_for(db, user, diagram_id, "manage")
    deleted = {"id": str(d.id), "name": d.name}
    await db.delete(d)
    await event_bus.publish("diagram.deleted", deleted, db=db, card_id=None, user_id=user.id)
    await db.commit()


# ── publishing ────────────────────────────────────────────────────────────────


class DiagramPublishRequest(BaseModel):
    access_mode: str = "public"
    allowed_email_domains: list[str] | None = None


def _publish_state(d: Diagram) -> dict:
    """The publish half of a diagram's representation."""
    return {
        "is_published": bool(d.is_published),
        "public_slug": d.public_slug,
        "access_mode": normalise_access_mode(d.access_mode),
        "allowed_email_domains": d.allowed_email_domains or [],
    }


def slug_hint(slug: str | None) -> str | None:
    """The first characters of a published diagram's slug, for the audit log.

    A ``public`` diagram's slug *is* its access link, and the audit row is also
    shipped as a JSON log line, so the full value never leaves the instance:
    enough of it to tell links apart, never enough to open one.
    """
    if not slug:
        return None
    return slug[:8] + "…"


@router.post("/{diagram_id}/publish")
async def publish_diagram(
    diagram_id: str,
    body: DiagramPublishRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Publish a diagram as a read-only link, or update how it is shared.

    Gated on ``diagrams.publish`` rather than ``diagrams.manage``: making
    internal architecture readable outside the instance is a different
    authority from editing it, and most installs will want to grant it far
    more narrowly.
    """
    await PermissionService.require_permission(db, user, "diagrams.publish")
    result = await db.execute(
        select(Diagram).where(Diagram.id == uuid.UUID(diagram_id), Diagram.kind.in_(DIAGRAM_KINDS))
    )
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    if d.kind != "drawio":
        raise HTTPException(400, "ArchiMate diagrams cannot be published yet")

    mode = normalise_access_mode(body.access_mode)
    if body.access_mode not in ("public", "sso"):
        raise HTTPException(422, "access_mode must be 'public' or 'sso'")

    # Mint the slug once and keep it: re-publishing after an unpublish would
    # otherwise silently break every link already pasted into a wiki page.
    # `token_urlsafe` because for a `public` diagram the URL *is* the
    # capability — a slug derived from the name would be guessable.
    if not d.public_slug:
        d.public_slug = secrets.token_urlsafe(24)

    was_published = bool(d.is_published)
    d.is_published = True
    d.access_mode = mode
    d.allowed_email_domains = normalise_email_domains(body.allowed_email_domains)
    await audit_log.record(
        db,
        action="admin.diagram.published",
        category="admin",
        actor=user,
        target=("diagram", str(d.id), d.name),
        context={
            "slug_prefix": slug_hint(d.public_slug),
            "access_mode": d.access_mode,
            "allowed_email_domains": d.allowed_email_domains or [],
            "was_published": was_published,
        },
    )
    await db.commit()
    await db.refresh(d)
    return _publish_state(d)


@router.delete("/{diagram_id}/publish")
async def unpublish_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Withdraw a diagram from public view, effective immediately.

    The slug is retained (not cleared) so re-publishing restores the same URL.
    Access stops regardless: every public route filters on ``is_published``, so
    an already-issued SSO cookie stops working the moment this returns.
    """
    await PermissionService.require_permission(db, user, "diagrams.publish")
    result = await db.execute(
        select(Diagram).where(Diagram.id == uuid.UUID(diagram_id), Diagram.kind.in_(DIAGRAM_KINDS))
    )
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    was_published = bool(d.is_published)
    d.is_published = False
    await audit_log.record(
        db,
        action="admin.diagram.unpublished",
        category="admin",
        actor=user,
        target=("diagram", str(d.id), d.name),
        context={
            "slug_prefix": slug_hint(d.public_slug),
            "access_mode": d.access_mode,
            "allowed_email_domains": d.allowed_email_domains or [],
            "was_published": was_published,
        },
    )
    await db.commit()
    await db.refresh(d)
    return _publish_state(d)


# ── card link / unlink endpoints ──────────────────────────────────────────────


def _refuse_archimate_links(d: Diagram) -> None:
    if d.kind == "archimate":
        raise HTTPException(409, "An ArchiMate diagram's card links come from its model")


@router.post("/{diagram_id}/cards", status_code=201)
async def link_card_to_diagram(
    diagram_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Link a card to a diagram."""
    d = await _diagram_for(db, user, diagram_id, "manage")
    _refuse_archimate_links(d)
    card_id = body.get("card_id")
    if not card_id:
        raise HTTPException(400, "card_id is required")

    c_id = uuid.UUID(card_id)
    await require_card_readable(db, user, c_id, mode="module")

    # Check not already linked
    existing = await db.execute(
        select(diagram_cards).where(
            diagram_cards.c.diagram_id == d.id,
            diagram_cards.c.card_id == c_id,
        )
    )
    if existing.first():
        raise HTTPException(409, "Card already linked to this diagram")

    await db.execute(diagram_cards.insert().values(diagram_id=d.id, card_id=c_id))
    await db.commit()
    return {"diagram_id": str(d.id), "card_id": str(c_id)}


@router.delete("/{diagram_id}/cards/{card_id}", status_code=204)
async def unlink_card_from_diagram(
    diagram_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unlink a card from a diagram."""
    d = await _diagram_for(db, user, diagram_id, "manage")
    _refuse_archimate_links(d)
    c_id = uuid.UUID(card_id)
    await require_card_readable(db, user, c_id, mode="module")

    result = await db.execute(
        delete(diagram_cards).where(
            diagram_cards.c.diagram_id == d.id,
            diagram_cards.c.card_id == c_id,
        )
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(404, "Link not found")
    await db.commit()


# ── group membership ──────────────────────────────────────────────────────────


class DiagramGroupsUpdate(BaseModel):
    group_ids: list[str]


@router.put("/{diagram_id}/groups")
async def set_diagram_groups(
    diagram_id: str,
    body: DiagramGroupsUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Replace a diagram's group memberships (multi-group)."""
    await PermissionService.require_permission(db, user, "diagrams.manage")
    d_id = uuid.UUID(diagram_id)
    result = await db.execute(
        select(Diagram).where(Diagram.id == d_id, Diagram.kind.in_(DIAGRAM_KINDS))
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Diagram not found")

    await db.execute(
        delete(diagram_group_members).where(diagram_group_members.c.diagram_id == d_id)
    )
    for sid in dict.fromkeys(body.group_ids):
        await db.execute(
            diagram_group_members.insert().values(
                diagram_id=d_id,
                group_id=uuid.UUID(sid),
            )
        )
    await db.commit()
    return {"diagram_id": str(d_id), "group_ids": list(dict.fromkeys(body.group_ids))}
