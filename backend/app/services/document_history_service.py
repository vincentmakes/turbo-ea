"""The edit history of decisions and SoAWs: saved versions, view and restore.

A *version* is a ``document_history`` row of a content kind
(:data:`CONTENT_KINDS`) carrying a snapshot of the document's content in
``content`` (:func:`snapshot_of`). Content is what an author writes, nothing
that is filing:

* a decision — ``title``, the four text sections (``context``,
  ``decision``, ``consequences``, ``alternatives_considered``, in their
  stored canonical mention form), ``decided_on`` / ``effective_from`` /
  ``valid_until`` (ISO dates or ``None``), ``change_summary`` and the people,
  ``decision_makers`` / ``participants`` as ``[{user_id | None, name}]``;
* a SoAW — ``name``, ``document_info``, ``version_history`` and ``sections``.

Never links, linked cards, the initiative, files, signatories, extension
attributes or an e-mail.

When rows are written:

* ``created`` / ``revised`` — by the shared writers through
  ``document_collab.on_workflow``, carrying the initial content;
* ``save`` — :func:`record_save`, from ``document_collab.after_save``, when a
  DRAFT (for a SoAW, any status whose content may be edited, see
  ``soaw_service.content_editable``) was saved and its content differs
  (:func:`differs`) from the latest version. A document that has no version
  yet (its ``created`` row was backfilled by migration 171, without content)
  first gets a ``baseline`` row holding the state captured BEFORE the save;
* ``restored`` — :func:`restore`, forward only: the restored content becomes
  a new version whose ``note`` is the id of the version it came from.

A save in review (only filing fields can change) records nothing. Every
helper flushes and never commits: the caller owns the transaction.
"""

from __future__ import annotations

import copy
import functools
import re
import uuid
from collections.abc import Iterable, Mapping
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.models.user import User
from app.services import (
    adr_service,
    decision_people_service,
    document_collab,
    mention_service,
    soaw_service,
)
from app.services.card_read_scope import CardReadScope

#: Timeline kinds that may carry a snapshot.
CONTENT_KINDS: tuple[str, ...] = ("created", "baseline", "save", "restored", "revised")

#: The text fields of a decision snapshot.
ADR_TEXT_FIELDS: tuple[str, ...] = mention_service.text_fields_of(document_collab.ADR)
#: The date fields of a decision snapshot (ISO strings or ``None``).
ADR_DATE_FIELDS: tuple[str, ...] = ("decided_on", "effective_from", "valid_until")
#: The people of a decision snapshot, one list per part.
PEOPLE_FIELDS: tuple[str, ...] = tuple(decision_people_service.PAYLOAD_KEYS.values())

#: Every key of a snapshot, per document kind, in payload order.
SNAPSHOT_FIELDS: dict[str, tuple[str, ...]] = {
    document_collab.ADR: (
        "title",
        *ADR_TEXT_FIELDS,
        *ADR_DATE_FIELDS,
        "change_summary",
        *PEOPLE_FIELDS,
    ),
    document_collab.SOAW: ("name", "document_info", "version_history", "sections"),
}

NOT_A_VERSION = "History entry not found"

# Rich text an emptied editor leaves behind: nothing but paragraphs, breaks and spaces.
_BLANK_HTML = re.compile(r"(?:\s|&nbsp;|<p>|</p>|<br\s*/?>)*")


def has_content(kind: str) -> bool:
    """Whether a timeline row of ``kind`` may carry a snapshot."""
    return kind in CONTENT_KINDS


# --- snapshots (pure) ---------------------------------------------------------------


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _person(entry: Mapping[str, Any]) -> dict[str, Any]:
    """``{user_id, name}`` from a stored person or a people payload entry
    (whose name is under ``display_name``)."""
    name = entry["name"] if "name" in entry else entry.get("display_name")
    user_id = entry.get("user_id")
    return {"user_id": str(user_id) if user_id else None, "name": name}


def snapshot_of(
    doc_kind: str, doc: Any, people: Mapping[str, Iterable[Mapping[str, Any]]] | None = None
) -> dict[str, Any]:
    """The content of ``doc`` as a version stores it (see the module doc).

    ``people`` is the decision's ``{decision_makers, participants}`` (entries
    ``{user_id, name}`` or ``{user_id, display_name}``); absent parts are
    empty. JSON values are deep-copied, so the snapshot never aliases the row.
    """
    if doc_kind == document_collab.SOAW:
        return {
            "name": doc.name,
            "document_info": copy.deepcopy(doc.document_info or {}),
            "version_history": copy.deepcopy(doc.version_history or []),
            "sections": copy.deepcopy(doc.sections or {}),
        }
    if doc_kind != document_collab.ADR:
        raise ValueError(f"Unknown document kind {doc_kind!r}")
    people = people or {}
    return {
        "title": doc.title,
        **{field: getattr(doc, field) for field in ADR_TEXT_FIELDS},
        **{field: _iso(getattr(doc, field)) for field in ADR_DATE_FIELDS},
        "change_summary": doc.change_summary,
        **{field: [_person(p) for p in people.get(field) or ()] for field in PEOPLE_FIELDS},
    }


def _blank(value: Any) -> bool:
    """``None``, ``False``, a string holding no text (``""``, ``"<p></p>"``),
    or a list / map of blanks."""
    if value is None or value is False:
        return True
    if isinstance(value, str):
        return _BLANK_HTML.fullmatch(value) is not None
    if isinstance(value, Mapping):
        return all(_blank(v) for v in value.values())
    if isinstance(value, list | tuple):
        return all(_blank(v) for v in value)
    return False


def _sorted(value: Any) -> Any:
    """A JSON value with every map's keys in order."""
    if isinstance(value, Mapping):
        return {k: _sorted(value[k]) for k in sorted(value)}
    if isinstance(value, list | tuple):
        return [_sorted(v) for v in value]
    return value


def _text(value: Any) -> Any:
    """Rich text in its canonical mention form; blank text is ``None``."""
    if not isinstance(value, str):
        return value
    if _blank(value):
        return None
    return mention_service.canonicalise(value, mention_service.DOCUMENT_KINDS)


def _section(section: Any) -> Any:
    """One SoAW section without its blank keys (a table's ``columns`` are the
    template's, so a table whose rows are all blank is blank)."""
    if not isinstance(section, Mapping):
        return section
    out: dict[str, Any] = {}
    for key in sorted(section):
        value = section[key]
        if key == "content":
            value = _text(value)
        probe = value
        if key == "table_data" and isinstance(value, Mapping):
            probe = {k: v for k, v in value.items() if k != "columns"}
        if not _blank(probe):
            out[key] = _sorted(value)
    return out


def _sections(sections: Any) -> Any:
    if not isinstance(sections, Mapping):
        return sections
    out = {}
    for key in sorted(sections):
        section = _section(sections[key])
        if section != {}:
            out[key] = section
    return out


def normalise(content: Any) -> Any:
    """A comparable form of a snapshot (a decision's or, holding ``sections``,
    a SoAW's): keys in order, mention spans canonical, blank text ``None``.

    A SoAW additionally drops what the editor fills in from its template on
    load (``soawStateFromLoaded``): blank ``document_info`` keys, blank
    ``version_history`` rows, and in each section every blank key (a table
    counted blank when all its rows are) and then every section left empty —
    so loading a document and saving it unchanged is no change.
    """
    if not isinstance(content, Mapping):
        return content
    out = {key: _sorted(content[key]) for key in sorted(content)}
    if "sections" in content:
        info = content.get("document_info")
        if isinstance(info, Mapping):
            out["document_info"] = {
                k: _sorted(v) for k, v in out["document_info"].items() if not _blank(v)
            }
        rows = content.get("version_history")
        if isinstance(rows, list):
            out["version_history"] = [_sorted(r) for r in rows if not _blank(r)]
        out["sections"] = _sections(content["sections"])
        return out
    for field in ADR_TEXT_FIELDS:
        if field in out:
            out[field] = _text(out[field])
    if "change_summary" in out and _blank(out["change_summary"]):
        out["change_summary"] = None
    return out


def differs(a: Any, b: Any) -> bool:
    """Whether two snapshots differ once normalised (:func:`normalise`)."""
    return bool(normalise(a) != normalise(b))


def _date(value: Any) -> date | None:
    return date.fromisoformat(value) if value else None


def restore_fields(doc_kind: str, content: Mapping[str, Any]) -> dict[str, Any]:
    """What a restore of ``content`` writes: every snapshot field, dates as
    ``date`` values, people as ``[{user_id | None, name}]``, JSON deep-copied."""
    if doc_kind == document_collab.SOAW:
        return {
            "name": content.get("name"),
            "document_info": copy.deepcopy(content.get("document_info") or {}),
            "version_history": copy.deepcopy(content.get("version_history") or []),
            "sections": copy.deepcopy(content.get("sections") or {}),
        }
    if doc_kind != document_collab.ADR:
        raise ValueError(f"Unknown document kind {doc_kind!r}")
    return {
        "title": content.get("title"),
        **{field: content.get(field) for field in ADR_TEXT_FIELDS},
        **{field: _date(content.get(field)) for field in ADR_DATE_FIELDS},
        "change_summary": content.get("change_summary"),
        **{
            field: [_person(p) for p in content.get(field) or () if isinstance(p, Mapping)]
            for field in PEOPLE_FIELDS
        },
    }


def people_entries(
    people: Iterable[Mapping[str, Any]], live_user_ids: Iterable[str]
) -> list[dict[str, Any]]:
    """A restored part as ``replace_people`` takes it: ``{user_id}`` for a user
    who still exists, ``{name}`` otherwise (a vanished user keeps the name)."""
    live = set(live_user_ids)
    return [
        {"user_id": p["user_id"]} if p.get("user_id") in live else {"name": p.get("name")}
        for p in people
    ]


# --- a timeline rebuilt from what a document stores (pure) --------------------------

#: The ``via`` of a timeline row rebuilt from a document's stored columns —
#: by migration 171 on an upgraded install, by :func:`backfill_timelines` for
#: the documents the demo seeder inserts as plain rows — so the two read the
#: same and migration 171's downgrade removes both.
BACKFILL_VIA = "migration:171"

# Where a step sorts against another step of the same document at the same
# instant: created, sent for review, a signature, signed, recorded.
_BACKFILL_RANK = {
    "created": 0,
    "revised": 0,
    "sent_for_review": 1,
    "signature": 2,
    "signed": 3,
    "recorded": 4,
}

_Step = tuple[datetime, str, "uuid.UUID | None", "str | None"]


def _stored_uuid(value: Any) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value.strip())
    except ValueError:
        return None


def _stored_time(value: Any) -> datetime | None:
    """A timezone-aware instant from a datetime or an ISO string (naive = UTC)."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _stored_actor(
    value: Any, users: Mapping[uuid.UUID, str]
) -> tuple[uuid.UUID | None, str | None]:
    uid = _stored_uuid(value)
    if uid is None or uid not in users:
        return None, None
    return uid, users[uid]


def _stored_signatures(signatories: Any, users: Mapping[uuid.UUID, str]) -> list[_Step]:
    """One ``signature`` step per signed entry with a readable ``signed_at``,
    named by the entry's display name (the actor only when the user exists)."""
    steps: list[_Step] = []
    if not isinstance(signatories, list):
        return steps
    for entry in signatories:
        if not isinstance(entry, dict) or entry.get("status") != "signed":
            continue
        at = _stored_time(entry.get("signed_at"))
        if at is None:
            continue
        uid = _stored_uuid(entry.get("user_id"))
        name = entry.get("display_name")
        steps.append(
            (
                at,
                "signature",
                uid if uid in users else None,
                name if isinstance(name, str) and name.strip() else None,
            )
        )
    return steps


def _sent_at(
    created_at: datetime | None, updated_at: datetime | None, signed: Iterable[datetime]
) -> datetime | None:
    """When an open review round was sent: the earliest of the last update and
    the signatures given so far, never before the document was created."""
    candidates = [t for t in (updated_at, *signed) if t is not None]
    if not candidates:
        return created_at
    sent = min(candidates)
    return max(sent, created_at) if created_at is not None else sent


def plan_backfill(
    rows: Iterable[Mapping[str, Any]], users: Mapping[uuid.UUID, str]
) -> list[dict[str, Any]]:
    """The timeline rows a document gets from what it stores, in chronological
    order — exactly what migration 171's ``plan_history_rows`` plans (it keeps
    its own frozen copy; ``test_document_history_backfill`` holds the two
    together).

    ``rows`` are documents: ``kind`` (``"adr"`` or ``"soaw"``), ``id``,
    ``parent_id``, ``status``, ``created_at``, ``updated_at``, ``created_by``,
    ``signatories``, ``signed_at`` and, for a decision, ``recorded_at`` /
    ``recorded_by``; ``users`` maps every existing user id to its display
    name. Steps: ``created`` / ``revised`` at ``created_at``; for a document
    in review, ``sent_for_review`` with its signatories as
    ``[{user_id, display_name}]`` (:func:`_sent_at`, no actor); one
    ``signature`` per signed entry; ``signed``; ``recorded`` (decisions).
    Each planned row is ``{owner column: id, kind, actor_id, actor_name,
    created_at, via, signatories}``; ties sort by step, then by input order.
    """
    keyed: list[tuple[datetime, int, int, int, dict[str, Any]]] = []
    for doc_index, doc in enumerate(rows):
        owner = document_collab.owner_fields(doc["kind"], doc["id"])
        steps: list[_Step] = []
        created_at = _stored_time(doc.get("created_at"))
        if created_at is not None:
            kind = "revised" if doc.get("parent_id") is not None else "created"
            steps.append((created_at, kind, *_stored_actor(doc.get("created_by"), users)))
        signatures = _stored_signatures(doc.get("signatories"), users)
        if doc.get("status") == soaw_service.IN_REVIEW:
            sent_at = _sent_at(
                created_at, _stored_time(doc.get("updated_at")), (s[0] for s in signatures)
            )
            if sent_at is not None:
                steps.append((sent_at, "sent_for_review", None, None))
        steps.extend(signatures)
        signed_at = _stored_time(doc.get("signed_at"))
        if signed_at is not None:
            steps.append((signed_at, "signed", None, None))
        recorded_at = (
            _stored_time(doc.get("recorded_at")) if doc["kind"] == document_collab.ADR else None
        )
        if recorded_at is not None:
            steps.append((recorded_at, "recorded", *_stored_actor(doc.get("recorded_by"), users)))
        for step_index, (at, kind, actor_id, actor_name) in enumerate(steps):
            signatories = None
            if kind == "sent_for_review":
                raw = doc.get("signatories")
                signatories = document_collab.history_signatories(
                    raw if isinstance(raw, list) else None
                )
            keyed.append(
                (
                    at,
                    _BACKFILL_RANK[kind],
                    doc_index,
                    step_index,
                    {
                        **owner,
                        "kind": kind,
                        "actor_id": actor_id,
                        "actor_name": actor_name,
                        "created_at": at,
                        "via": BACKFILL_VIA,
                        "signatories": signatories,
                    },
                )
            )
    keyed.sort(key=lambda item: item[:4])
    return [item[4] for item in keyed]


# --- the session side ---------------------------------------------------------------


async def current_snapshot(db: AsyncSession, doc_kind: str, doc: Any) -> dict[str, Any]:
    """:func:`snapshot_of` the document as it is now (a decision's people read
    in one query)."""
    if doc_kind != document_collab.ADR:
        return snapshot_of(doc_kind, doc)
    people = (await decision_people_service.people_payload(db, [doc.id]))[doc.id]
    return snapshot_of(doc_kind, doc, people)


def _owner(doc_kind: str) -> Any:
    return getattr(DocumentHistoryEntry, document_collab.OWNER_COLUMNS[doc_kind])


def _is_version(doc_kind: str, doc_id: Any, entry: DocumentHistoryEntry | None) -> bool:
    return bool(
        entry is not None
        and getattr(entry, document_collab.OWNER_COLUMNS[doc_kind]) == doc_id
        and has_content(entry.kind)
        and isinstance(entry.content, dict)
    )


async def latest_version(
    db: AsyncSession, doc_kind: str, doc_id: uuid.UUID
) -> DocumentHistoryEntry | None:
    """The document's most recent row carrying content, if any."""
    return (
        await db.execute(
            select(DocumentHistoryEntry)
            .where(_owner(doc_kind) == doc_id)
            .where(DocumentHistoryEntry.kind.in_(CONTENT_KINDS))
            .where(func.jsonb_typeof(DocumentHistoryEntry.content) == "object")
            .order_by(DocumentHistoryEntry.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def backfill_timelines(db: AsyncSession) -> int:
    """Give every decision and SoAW that has no timeline row at all the
    timeline migration 171 would have given it (:func:`plan_backfill`);
    returns the number of rows written. Flushed, not committed.

    For documents written as plain rows after the migration ran — the demo
    seeder's — so a fresh demo install reads like an upgraded one. A
    document with any timeline row is left alone, so a second call writes
    nothing."""
    owned = {
        owner_id
        for pair in (
            await db.execute(
                select(DocumentHistoryEntry.architecture_decision_id, DocumentHistoryEntry.soaw_id)
            )
        ).all()
        for owner_id in pair
        if owner_id is not None
    }
    users = {uid: name for uid, name in (await db.execute(select(User.id, User.display_name)))}
    adr_columns = (
        ArchitectureDecision.id,
        ArchitectureDecision.parent_id,
        ArchitectureDecision.status,
        ArchitectureDecision.created_at,
        ArchitectureDecision.updated_at,
        ArchitectureDecision.created_by,
        ArchitectureDecision.signatories,
        ArchitectureDecision.signed_at,
        ArchitectureDecision.recorded_at,
        ArchitectureDecision.recorded_by,
    )
    soaw_columns = (
        SoAW.id,
        SoAW.parent_id,
        SoAW.status,
        SoAW.created_at,
        SoAW.updated_at,
        SoAW.created_by,
        SoAW.signatories,
        SoAW.signed_at,
    )
    docs: list[dict[str, Any]] = []
    for kind, columns, order in (
        (
            document_collab.ADR,
            adr_columns,
            (ArchitectureDecision.created_at, ArchitectureDecision.id),
        ),
        (document_collab.SOAW, soaw_columns, (SoAW.created_at, SoAW.id)),
    ):
        for row in (await db.execute(select(*columns).order_by(*order))).mappings():
            if row["id"] not in owned:
                docs.append({**row, "kind": kind})
    planned = plan_backfill(docs, users)
    for values in planned:
        fields = {k: v for k, v in values.items() if k != "signatories" or v is not None}
        db.add(DocumentHistoryEntry(**fields))
    await db.flush()
    return len(planned)


async def _write(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    kind: str,
    content: dict[str, Any],
    *,
    user: User | None,
    note: str | None = None,
) -> DocumentHistoryEntry:
    entry = DocumentHistoryEntry(
        **document_collab.owner_fields(doc_kind, doc.id),
        kind=kind,
        actor_id=user.id if user is not None else None,
        actor_name=user.display_name if user is not None else None,
        note=note,
        content=content,
    )
    db.add(entry)
    await db.flush()
    return entry


async def record_save(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    *,
    user: User,
    before: dict[str, Any] | None,
) -> DocumentHistoryEntry | None:
    """Record a draft's save; returns the ``save`` row, or ``None`` when the
    content did not change.

    ``before`` is the snapshot taken before the save touched the row. Without
    any version yet, a ``baseline`` row keeps ``before`` (no actor, no note)
    and the save is compared with it; otherwise with the latest version.
    """
    after = await current_snapshot(db, doc_kind, doc)
    latest = await latest_version(db, doc_kind, doc.id)
    if latest is None:
        if before is None:
            raise ValueError("The first recorded save of a document needs its earlier state")
        await _write(db, doc_kind, doc, "baseline", before, user=None)
        reference: Any = before
    else:
        reference = latest.content
    if not differs(after, reference):
        return None
    return await _write(db, doc_kind, doc, "save", after, user=user)


# --- the timeline -------------------------------------------------------------------


#: The columns a timeline row is read with: everything its payload names, and
#: whether a snapshot is there — never the snapshot itself (a SoAW version is
#: a full copy of the document). A JSON ``null`` counts as no snapshot, as it
#: reads ``None`` on a loaded row.
TIMELINE_COLUMNS: tuple[Any, ...] = (
    DocumentHistoryEntry.id,
    DocumentHistoryEntry.kind,
    DocumentHistoryEntry.actor_id,
    DocumentHistoryEntry.actor_name,
    DocumentHistoryEntry.note,
    DocumentHistoryEntry.created_at,
    (func.coalesce(func.jsonb_typeof(DocumentHistoryEntry.content), "null") != "null").label(
        "has_content"
    ),
)


def timeline_query(doc_kind: str, doc_id: uuid.UUID, *, page: int, page_size: int) -> Select:
    """One page of the document's timeline rows, newest first, with each
    actor's current name (:data:`TIMELINE_COLUMNS` + ``display_name``)."""
    return (
        select(*TIMELINE_COLUMNS, User.display_name)
        .outerjoin(User, User.id == DocumentHistoryEntry.actor_id)
        .where(_owner(doc_kind) == doc_id)
        .order_by(DocumentHistoryEntry.seq.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )


async def timeline(
    db: AsyncSession, doc_kind: str, doc_id: uuid.UUID, *, page: int, page_size: int
) -> tuple[int, list[dict[str, Any]]]:
    """``(total, entries)``: one page of the document's timeline, NEWEST FIRST
    (the order of a card's history), each entry with its actor's current name
    and, on a ``restored`` row, ``restored_from`` — the source version's
    ``{id, kind, created_at}`` (``None`` once it is gone). No snapshot is
    loaded (:func:`timeline_query`)."""
    total = (
        await db.execute(
            select(func.count()).select_from(DocumentHistoryEntry).where(_owner(doc_kind) == doc_id)
        )
    ).scalar_one()
    rows = (
        await db.execute(timeline_query(doc_kind, doc_id, page=page, page_size=page_size))
    ).all()
    sources = await _sources(db, doc_kind, doc_id, rows)
    return total, [
        entry_payload(row, row.display_name, sources, has_content=row.has_content) for row in rows
    ]


def source_id(entry: Any) -> uuid.UUID | None:
    """The id of the version a ``restored`` row came from (its ``note``)."""
    if entry.kind != "restored" or not entry.note:
        return None
    try:
        return uuid.UUID(entry.note)
    except ValueError:
        return None


async def _sources(
    db: AsyncSession, doc_kind: str, doc_id: uuid.UUID, entries: Iterable[Any]
) -> dict[uuid.UUID, dict[str, Any]]:
    wanted = {sid for sid in (source_id(e) for e in entries) if sid is not None}
    if not wanted:
        return {}
    rows = await db.execute(
        select(DocumentHistoryEntry.id, DocumentHistoryEntry.kind, DocumentHistoryEntry.created_at)
        .where(_owner(doc_kind) == doc_id)
        .where(DocumentHistoryEntry.id.in_(wanted))
    )
    return {
        row.id: {"id": str(row.id), "kind": row.kind, "created_at": row.created_at.isoformat()}
        for row in rows.all()
    }


def entry_payload(
    entry: Any,
    actor_display_name: str | None,
    sources: Mapping[uuid.UUID, dict[str, Any]],
    *,
    has_content: bool | None = None,
) -> dict[str, Any]:
    """One timeline row: :func:`document_collab.history_entry_payload` plus
    ``restored_from``."""
    sid = source_id(entry)
    return {
        **document_collab.history_entry_payload(entry, actor_display_name, has_content=has_content),
        "restored_from": sources.get(sid) if sid is not None else None,
    }


# --- one version: view and restore --------------------------------------------------


async def load_version(
    db: AsyncSession, doc_kind: str, doc: Any, entry_id: str
) -> DocumentHistoryEntry:
    """The version ``entry_id`` of ``doc``; 404 when it is malformed, unknown,
    another document's, or a row without content."""
    try:
        parsed = uuid.UUID(entry_id)
    except (ValueError, TypeError):
        raise HTTPException(404, NOT_A_VERSION) from None
    entry = await db.get(DocumentHistoryEntry, parsed)
    if entry is None or not _is_version(doc_kind, doc.id, entry):
        raise HTTPException(404, NOT_A_VERSION)
    return entry


async def version_payload(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    entry: DocumentHistoryEntry,
    *,
    user: User,
    read_scope: CardReadScope | None,
) -> dict[str, Any]:
    """``{entry, content}``: the version's metadata and its content as ``user``
    reads it — every mention resolved for the reader with the DOCUMENT's id
    as the token scope (so a restricted chip maps back on a save), people as
    ``[{user_id, display_name}]`` with the stored name."""
    content = dict(entry.content or {})
    mentions = mention_service.mentions_of(doc_kind, content)
    states = (
        await mention_service.mention_states(db, mentions, user=user, read_scope=read_scope)
        if mentions
        else {}
    )
    render = functools.partial(mention_service.render_for, states=states, scope_id=doc.id)
    for field in mention_service.text_fields_of(doc_kind):
        if field in content:
            content[field] = mention_service.map_field(doc_kind, content[field], render)
    if doc_kind == document_collab.ADR:
        for field in PEOPLE_FIELDS:
            content[field] = [
                {"user_id": p.get("user_id"), "display_name": p.get("name")}
                for p in content.get(field) or ()
                if isinstance(p, Mapping)
            ]
    actor = await db.get(User, entry.actor_id) if entry.actor_id is not None else None
    sources = await _sources(db, doc_kind, doc.id, [entry])
    return {
        "entry": entry_payload(entry, actor.display_name if actor else None, sources),
        "content": content,
    }


async def _live_user_ids(db: AsyncSession, fields: Mapping[str, Any]) -> set[str]:
    wanted: set[uuid.UUID] = set()
    for field in PEOPLE_FIELDS:
        for person in fields[field]:
            try:
                wanted.add(uuid.UUID(str(person["user_id"])))
            except (ValueError, TypeError, KeyError):
                continue
    if not wanted:
        return set()
    found = (await db.execute(select(User.id).where(User.id.in_(wanted)))).scalars().all()
    return {str(uid) for uid in found}


def restore_refusal(doc_kind: str, status: str) -> tuple[int, Any] | None:
    """Only a document whose content may be edited can be restored: 409
    ``not_draft`` otherwise. A decision: a draft. A SoAW: what
    ``soaw_service.content_editable`` allows (a draft, a legacy approved
    SoAW), the same rule as its saves."""
    if doc_kind == document_collab.SOAW:
        editable = soaw_service.content_editable(status)
    else:
        editable = status == "draft"
    if not editable:
        return 409, {"error": "not_draft"}
    return None


async def restore(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    entry_id: str,
    *,
    user: User,
    read_scope: CardReadScope | None,
) -> DocumentHistoryEntry:
    """Bring a version's content back into the draft ``doc``; returns the new
    ``restored`` row.

    409 ``{"error": "not_draft"}`` unless ``doc`` is a draft; 404 unless
    ``entry_id`` is a version of ``doc``. The text goes through
    ``document_collab.before_save`` for ``user``: a mention the version holds
    was stored on this document once, so it is kept even when ``user`` cannot
    read it, while the stored text's restricted chips map back as on a save.
    A decision's dates must pass ``adr_service.check_dates`` (400); a person
    whose user no longer exists comes back as the stored name. Links, linked
    cards, the initiative, files and attributes are never touched.
    """
    refusal = restore_refusal(doc_kind, doc.status)
    if refusal is not None:
        raise HTTPException(refusal[0], refusal[1])
    entry = await load_version(db, doc_kind, doc, entry_id)
    fields = restore_fields(doc_kind, entry.content or {})
    kept = mention_service.mentions_of(doc_kind, entry.content or {})
    if doc_kind == document_collab.ADR:
        adr_service.check_dates(
            *(fields[f] for f in ADR_DATE_FIELDS),
            today=datetime.now(timezone.utc).date(),
        )
        text = await document_collab.before_save(
            db,
            doc_kind,
            doc,
            {field: fields[field] for field in ADR_TEXT_FIELDS},
            user=user,
            read_scope=read_scope,
            kept=kept,
        )
        live = await _live_user_ids(db, fields)
        doc.title = fields["title"]
        for field in ADR_TEXT_FIELDS:
            setattr(doc, field, text[field])
        for field in (*ADR_DATE_FIELDS, "change_summary"):
            setattr(doc, field, fields[field])
        await decision_people_service.replace_people(
            db,
            doc,
            decision_makers=people_entries(fields["decision_makers"], live),
            participants=people_entries(fields["participants"], live),
        )
    else:
        text = await document_collab.before_save(
            db,
            doc_kind,
            doc,
            {"sections": fields["sections"]},
            user=user,
            read_scope=read_scope,
            kept=kept,
        )
        doc.name = fields["name"]
        doc.document_info = fields["document_info"]
        doc.version_history = fields["version_history"]
        doc.sections = text["sections"]
    await db.flush()
    after = await current_snapshot(db, doc_kind, doc)
    return await _write(db, doc_kind, doc, "restored", after, user=user, note=str(entry.id))
