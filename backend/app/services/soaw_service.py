"""Statements of Architecture Work (SoAW): revision chains, the review lock and labels.

The chain reading itself lives in :mod:`app.services.revision_chain`, shared
with the decision register; this module only turns SoAW rows into
:class:`~app.services.revision_chain.RevisionNode` values and the answers into
payload fields. SoAWs have no effective dates (a signed SoAW is in effect at
once) and are chained by ``parent_id`` alone.

Plain functions so the mutation gate reaches them; nothing here commits.
"""

from __future__ import annotations

import copy
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.soaw import SoAW
from app.services import document_collab
from app.services import revision_chain as rc

#: The one field a PATCH may still change while a SoAW is in review: the
#: initiative it is filed under is filing, not content.
REVIEW_EDITABLE_FIELDS: frozenset[str] = frozenset({"initiative_id"})

IN_REVIEW = "in_review"
SIGNED = "signed"
DRAFT = "draft"


@dataclass(frozen=True)
class SoAWRow:
    """The light columns chain reading and revision payloads need."""

    id: Any
    parent_id: Any
    revision_number: int
    status: str
    created_at: datetime
    name: str
    signed_at: datetime | None = None


@dataclass(frozen=True)
class SoAWChains:
    """Every SoAW row and the chain each belongs to."""

    rows: dict[Any, SoAWRow]
    chains: dict[Any, rc.Chain]

    def chain(self, soaw_id: Any) -> rc.Chain | None:
        return self.chains.get(soaw_id)


def build(rows: Iterable[SoAWRow]) -> SoAWChains:
    """Chains over ``rows`` (pure). Dangling parents and forks are handled by
    :func:`~app.services.revision_chain.build_chains`."""
    by_id = {r.id: r for r in rows}
    nodes = [
        rc.RevisionNode(
            id=r.id,
            parent_id=r.parent_id,
            revision_number=r.revision_number,
            status=r.status,
            created_at=r.created_at,
            group_key=None,
            effective_from=None,
        )
        for r in by_id.values()
    ]
    # ``today`` only matters for effective dates, which SoAWs do not have.
    chains = rc.build_chains(nodes, today=datetime.now(timezone.utc).date())
    return SoAWChains(rows=by_id, chains=chains)


async def load_chains(db: AsyncSession) -> SoAWChains:
    """Every SoAW's chain, from one light query over the whole table."""
    result = await db.execute(
        select(
            SoAW.id,
            SoAW.parent_id,
            SoAW.revision_number,
            SoAW.status,
            SoAW.created_at,
            SoAW.name,
            SoAW.signed_at,
        )
    )
    return build(
        SoAWRow(
            id=r.id,
            parent_id=r.parent_id,
            revision_number=r.revision_number,
            status=r.status,
            created_at=r.created_at,
            name=r.name,
            signed_at=r.signed_at,
        )
        for r in result.all()
    )


# --- payload fields -----------------------------------------------------------


def _ref(row: SoAWRow) -> dict[str, Any]:
    return {"id": str(row.id), "name": row.name, "revision_number": row.revision_number}


def chain_fields(chains: SoAWChains, soaw_id: Any) -> dict[str, Any]:
    """``is_current``, ``is_earlier_revision``, ``superseded_by`` and ``open_revision``.

    ``superseded_by`` names the chain's current revision, on an earlier
    revision only; ``open_revision`` names the unsigned revision being worked
    on after the current one, on the current revision only.
    """
    chain = chains.chain(soaw_id)
    if chain is None:
        return {
            "is_current": True,
            "is_earlier_revision": False,
            "superseded_by": None,
            "open_revision": None,
        }
    role = chain.role(soaw_id)
    superseded_by = None
    if role == "earlier":
        superseded_by = _ref(chains.rows[chain.current.id])
    open_revision = None
    if role == "current" and chain.open_revision is not None:
        row = chains.rows[chain.open_revision.id]
        open_revision = {**_ref(row), "status": row.status}
    return {
        "is_current": role == "current",
        "is_earlier_revision": role == "earlier",
        "superseded_by": superseded_by,
        "open_revision": open_revision,
    }


def revisions_payload(chains: SoAWChains, soaw_id: Any) -> list[dict[str, Any]]:
    """The SoAW's chain in order: ``[{id, name, revision_number, status, signed_at}]``."""
    chain = chains.chain(soaw_id)
    if chain is None:
        return []
    out = []
    for node in chain.nodes:
        row = chains.rows[node.id]
        out.append(
            {
                **_ref(row),
                "status": row.status,
                "signed_at": row.signed_at.isoformat() if row.signed_at else None,
            }
        )
    return out


def chain_ids(chains: SoAWChains, soaw_id: Any) -> list[Any]:
    """The ids of the SoAW's chain in order (just the SoAW when unknown)."""
    chain = chains.chain(soaw_id)
    if chain is None:
        return [soaw_id]
    return [n.id for n in chain.nodes]


def keep_in_list(fields: dict[str, Any], *, include_earlier: bool) -> bool:
    """Whether a list row survives ``include_earlier``: only earlier revisions drop."""
    return include_earlier or not fields["is_earlier_revision"]


# --- refusals -----------------------------------------------------------------


def revise_refusal(chains: SoAWChains, soaw_id: Any) -> tuple[int, Any] | None:
    """``(status_code, detail)`` when the SoAW may not be revised, else ``None``."""
    chain = chains.chain(soaw_id)
    reason = rc.revise_refusal(chain, soaw_id) if chain is not None else "not_locked"
    if reason == "not_locked":
        return 400, "Only signed documents can be revised"
    if reason == "open_revision_exists":
        assert chain is not None
        open_node = chain.open_revision or next(
            n for n in chain.nodes if not rc.is_locked(n) and n.id != soaw_id
        )
        return 409, {"error": "open_revision_exists", "revision_id": str(open_node.id)}
    if reason == "not_latest":
        return 409, {"error": "not_revisable", "reason": "not_latest"}
    return None


def content_editable(status: str) -> bool:
    """Whether a SoAW in ``status`` may have its content edited: every status
    but in review and signed (a draft, and the legacy ``approved``). The one
    predicate behind the PATCH lock (:func:`update_refusal`), whether a save
    is recorded as a version and whether a version may be restored."""
    return status not in (IN_REVIEW, SIGNED)


def update_refusal(
    current_status: str, new_status: str | None, fields_set: Iterable[str]
) -> tuple[int, str] | None:
    """``(status_code, message)`` when a PATCH must be refused, else ``None``.

    A signed SoAW refuses every edit. The status moves that have their own
    endpoint keep their 400s. In review, only the filing fields may change.
    """
    if current_status == SIGNED:
        return 403, "Cannot edit a signed document. Create a new revision instead."
    if new_status is not None:
        if new_status == SIGNED:
            return 400, "Use the sign endpoint to sign a document"
        if new_status == IN_REVIEW:
            return 400, "Use the request-signatures endpoint to send for review"
        if new_status == DRAFT and current_status == IN_REVIEW:
            return 400, "Use the recall-signatures endpoint to reset to draft"
    if not content_editable(current_status) and set(fields_set) - REVIEW_EDITABLE_FIELDS:
        return 403, ("A document in review is locked. Recall the signature requests to edit it.")
    return None


def request_refusal(status: str) -> tuple[int, Any] | None:
    """``(status_code, detail)`` when signatures may not be requested, else ``None``."""
    if status == SIGNED:
        return 400, "Document is already signed"
    if status == IN_REVIEW:
        return 409, {"error": "not_requestable"}
    return None


def delete_refusal(status: str) -> tuple[int, str] | None:
    """Only a draft SoAW can be deleted."""
    if status != DRAFT:
        return 400, "Only draft documents can be deleted"
    return None


# --- labels -------------------------------------------------------------------


def soaw_label(name: str, revision_number: int | None) -> str:
    """``"Name (Rev 2)"``: how notifications and to-dos name a SoAW; the
    revision is shown only from 2 on."""
    if revision_number is not None and revision_number > 1:
        return f"{name} (Rev {revision_number})"
    return name


def soaw_link(soaw_id: uuid.UUID | str) -> str:
    """The in-app path of a SoAW; also what its sign to-dos link to and are matched by."""
    return f"/ea-delivery/soaw/{soaw_id}"


# --- writes -------------------------------------------------------------------


async def create_revision(
    db: AsyncSession, source: SoAW, *, created_by: uuid.UUID | None, chains: SoAWChains
) -> SoAW:
    """A new draft revision of ``source``: numbered after the chain's highest
    revision, content copied (its mentions as they are), its timeline opened
    with a ``revised`` row. Flushed, not committed."""
    chain = chains.chain(source.id)
    number = rc.next_revision_number(chain) if chain is not None else source.revision_number + 1
    text = await document_collab.before_save(
        db,
        document_collab.SOAW,
        None,
        {"sections": copy.deepcopy(source.sections)},
        user=None,
        read_scope=None,
        copy=True,
    )
    revision = SoAW(
        name=source.name,
        initiative_id=source.initiative_id,
        status=DRAFT,
        document_info=copy.deepcopy(source.document_info),
        version_history=copy.deepcopy(source.version_history),
        sections=text["sections"],
        created_by=created_by,
        revision_number=number,
        parent_id=source.id,
    )
    db.add(revision)
    await db.flush()
    await document_collab.on_workflow(
        db, document_collab.SOAW, revision, "revised", user=created_by
    )
    return revision
