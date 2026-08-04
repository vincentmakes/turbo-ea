from __future__ import annotations

import re
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
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
from app.models.card import Card
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_favorite import DiagramFavorite
from app.models.diagram_group import diagram_group_members
from app.models.user import User
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

# Regex to pull cardId values out of DrawIO XML <object> elements.
# Faster than full XML parsing and safe here because the attribute value is a UUID.
_CARD_ID_RE = re.compile(r'cardId="([0-9a-fA-F-]{36})"')


def _extract_card_refs(data: dict | None) -> list[str]:
    """Return deduplicated list of card UUIDs found in diagram XML."""
    xml = (data or {}).get("xml", "")
    if not xml:
        return []
    return list(dict.fromkeys(_CARD_ID_RE.findall(xml)))


# Turbo EA's own bookkeeping attributes on DrawIO cells. They are what make a
# shape a *card* rather than a rectangle, and they are stripped before a diagram
# is served publicly: a published diagram is a picture, not a queryable slice of
# the inventory. Without this the "no drill-through" decision would be enforced
# only by the UI, while the raw XML still handed every visitor the card UUIDs
# and the relation graph behind the picture.
_PRIVATE_CELL_ATTRS = (
    "cardId",
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
    publisher chose to share. Card names are visible either way (they *are* the
    labels); what leaves with this is the internal identity of every shape.
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


class DiagramCreate(BaseModel):
    name: str
    description: str | None = None
    data: dict | None = None
    card_ids: list[str] | None = None


class DiagramUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    data: dict | None = None
    card_ids: list[str] | None = None


# ── helpers ───────────────────────────────────────────────────────────────────


async def _get_card_ids(db: AsyncSession, diagram_id: uuid.UUID) -> list[str]:
    """Return card_ids for a single diagram."""
    result = await db.execute(
        select(diagram_cards.c.card_id).where(
            diagram_cards.c.diagram_id == diagram_id,
        )
    )
    return [str(row[0]) for row in result.all()]


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
        select(DiagramFavorite.diagram_id).where(DiagramFavorite.user_id == user_id)
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
    sort_by: str = "updated_at",
    sort_dir: str = "desc",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.view")

    stmt = select(Diagram)
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

    # Bulk-load supporting data
    id_map = await _get_card_ids_bulk(db)
    group_map = await _get_group_ids_bulk(db)
    creator_names = await _get_creator_names(db, rows)

    # Unified text search: name / description / author / contained-card names.
    if search and search.strip():
        term = search.strip().lower()
        like = f"%{search.strip()}%"
        matching_card_ids = {
            str(row[0])
            for row in (await db.execute(select(Card.id).where(Card.name.ilike(like)))).all()
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
            "description": d.description,
            "card_ids": id_map.get(str(d.id), []),
            "group_ids": group_map.get(str(d.id), []),
            "thumbnail": (d.data or {}).get("thumbnail"),
            "card_count": len(_extract_card_refs(d.data)),
            "created_by": str(d.created_by) if d.created_by else None,
            "created_by_name": creator_names.get(str(d.created_by)) if d.created_by else None,
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
    result = await db.execute(select(Diagram).where(Diagram.id == d_id))
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
    await PermissionService.require_permission(db, user, "diagrams.manage")
    d = Diagram(
        name=body.name,
        description=body.description,
        data=body.data or {},
        created_by=user.id,
    )
    db.add(d)
    await db.flush()  # get d.id

    if body.card_ids:
        await _set_card_ids(db, d.id, body.card_ids)

    await db.commit()
    await db.refresh(d)
    return {
        "id": str(d.id),
        "name": d.name,
        "card_ids": body.card_ids or [],
    }


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
    set_access_cookie(
        response,
        token,
        path=_public_cookie_path(slug),
        secure=_is_secure_request(request),
    )
    return {"ok": True}


@router.get("/public/{slug}")
async def get_public_diagram(
    d: Diagram = Depends(require_public_diagram),
):
    """Return the published picture: a name and sanitised DrawIO XML.

    Deliberately narrow. No card ids, no relations, no description, no
    lifecycle — see ``sanitise_public_xml``. The XML is enough for the DrawIO
    lightbox to render, pan and zoom it, and nothing more.
    """
    return {
        "name": d.name,
        "xml": sanitise_public_xml((d.data or {}).get("xml")),
    }


@router.get("/{diagram_id}")
async def get_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.view")
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    linked_card_ids = await _get_card_ids(db, d.id)
    group_result = await db.execute(
        select(diagram_group_members.c.group_id).where(diagram_group_members.c.diagram_id == d.id)
    )
    group_ids = [str(row[0]) for row in group_result.all()]
    favorite_ids = await _get_favorite_ids(db, user.id)
    creator_names = await _get_creator_names(db, [d])
    return {
        "id": str(d.id),
        "name": d.name,
        "description": d.description,
        "data": d.data,
        "card_ids": linked_card_ids,
        "card_refs": _extract_card_refs(d.data),
        "group_ids": group_ids,
        "created_by": str(d.created_by) if d.created_by else None,
        "created_by_name": creator_names.get(str(d.created_by)) if d.created_by else None,
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
    await PermissionService.require_permission(db, user, "diagrams.manage")
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    if body.name is not None:
        d.name = body.name
    if body.description is not None:
        d.description = body.description
    if body.data is not None:
        # Store the data and auto-extract card references into it
        new_data = dict(body.data)
        new_data["card_refs"] = _extract_card_refs(new_data)
        d.data = new_data
    if body.card_ids is not None:
        await _set_card_ids(db, d.id, body.card_ids)
    await db.commit()
    await db.refresh(d)
    linked_card_ids = await _get_card_ids(db, d.id)
    return {"id": str(d.id), "name": d.name, "card_ids": linked_card_ids}


@router.delete("/{diagram_id}", status_code=204)
async def delete_diagram(
    diagram_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "diagrams.manage")
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    await db.delete(d)
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
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")

    mode = normalise_access_mode(body.access_mode)
    if body.access_mode not in ("public", "sso"):
        raise HTTPException(422, "access_mode must be 'public' or 'sso'")

    # Mint the slug once and keep it: re-publishing after an unpublish would
    # otherwise silently break every link already pasted into a wiki page.
    # `token_urlsafe` because for a `public` diagram the URL *is* the
    # capability — a slug derived from the name would be guessable.
    if not d.public_slug:
        d.public_slug = secrets.token_urlsafe(24)

    d.is_published = True
    d.access_mode = mode
    d.allowed_email_domains = normalise_email_domains(body.allowed_email_domains)
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
    result = await db.execute(select(Diagram).where(Diagram.id == uuid.UUID(diagram_id)))
    d = result.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Diagram not found")
    d.is_published = False
    await db.commit()
    await db.refresh(d)
    return _publish_state(d)


# ── card link / unlink endpoints ──────────────────────────────────────────────


@router.post("/{diagram_id}/cards", status_code=201)
async def link_card_to_diagram(
    diagram_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Link a card to a diagram."""
    await PermissionService.require_permission(db, user, "diagrams.manage")
    card_id = body.get("card_id")
    if not card_id:
        raise HTTPException(400, "card_id is required")

    d_id = uuid.UUID(diagram_id)
    c_id = uuid.UUID(card_id)

    # Check diagram exists
    result = await db.execute(select(Diagram).where(Diagram.id == d_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Diagram not found")

    # Check not already linked
    existing = await db.execute(
        select(diagram_cards).where(
            diagram_cards.c.diagram_id == d_id,
            diagram_cards.c.card_id == c_id,
        )
    )
    if existing.first():
        raise HTTPException(409, "Card already linked to this diagram")

    await db.execute(diagram_cards.insert().values(diagram_id=d_id, card_id=c_id))
    await db.commit()
    return {"diagram_id": str(d_id), "card_id": str(c_id)}


@router.delete("/{diagram_id}/cards/{card_id}", status_code=204)
async def unlink_card_from_diagram(
    diagram_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unlink a card from a diagram."""
    await PermissionService.require_permission(db, user, "diagrams.manage")
    d_id = uuid.UUID(diagram_id)
    c_id = uuid.UUID(card_id)

    result = await db.execute(
        delete(diagram_cards).where(
            diagram_cards.c.diagram_id == d_id,
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
    result = await db.execute(select(Diagram).where(Diagram.id == d_id))
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
