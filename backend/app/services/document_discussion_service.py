"""The discussion of a decision or a SoAW: threads, replies, resolve, mentions.

A thread belongs to the revision it was started on (``DocumentComment`` has
exactly one owner, a decision or a SoAW revision). A reply points at a
top-level comment of the same document; replies are one level deep.

Who may do what (pure rules below, evaluated on the comment's own revision):

* read — the document's view permission (``adr.view`` / ``soaw.view``);
* post, reply, resolve, reopen — the comment permission (``adr.comment`` /
  ``soaw.comment``) or being a signatory of that revision: named in its
  current ``signatories`` or in the ``signatories`` of any
  ``sent_for_review`` timeline row of THAT revision, so a recall or a
  rejection does not take the right away;
* edit — the author, on a plain ``comment`` that is not deleted;
* delete (soft: ``deleted_at`` set, body blanked) — the author, or a holder of
  the edit permission (``adr.manage`` / ``soaw.manage``) on a plain
  ``comment``; a ``rejection`` is resolved, never deleted by a moderator.

A thread whose top-level comment is deleted is *closed*: it stays listed with
its replies, but nobody replies to it (409, :func:`reply_refusal`), resolves it
or reopens it.

Three kinds: ``comment`` (written by a person), ``rejection`` (opened by a
rejection, carrying the reason) and ``sign_note`` (a signer's note, never
open). A thread is open when it is top-level, unresolved, not deleted and of
kind ``comment`` or ``rejection``.

Bodies are short rich text, restricted at write time (:func:`comment_html`):
every tag is escaped except a few attribute-less ones, http(s)/mailto links
and canonical mention spans (cards, decisions, people). Mentions are scoped to
the COMMENT: a restricted chip's token is computed over the comment's id, and
a save restores tokens only against that comment's stored body (a new comment
restores nothing).

Every function flushes and never commits: the route owns the transaction.
Notifications are not created here: a write returns them as
:class:`Delivery` batches, which the route hands to
``notification_service.deliver_notification_batch`` once it has committed
(:func:`schedule_deliveries`), so no SMTP round-trip runs inside the request's
transaction and nothing is announced for a comment that was not stored.

Every pattern that reads a body runs in linear time, and the raw body's
length is checked before any of them runs.
"""

from __future__ import annotations

import html as html_lib
import re
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_person import ArchitectureDecisionPerson
from app.models.document_comment import DocumentComment
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.models.user import User
from app.services import adr_service, mention_service, notification_service, soaw_service
from app.services import decision_standing as ds
from app.services import document_collab as collab
from app.services.card_read_scope import CardReadScope
from app.services.event_bus import event_bus
from app.services.mention_markup import MENTION_SPAN_RE, iter_mentions
from app.services.permission_service import PermissionService

COMMENT = "comment"
SIGN_NOTE = "sign_note"
REJECTION = "rejection"
COMMENT_KINDS: tuple[str, ...] = (COMMENT, SIGN_NOTE, REJECTION)
#: The kinds a thread can be open in (a signing note never is).
OPEN_KINDS: tuple[str, ...] = (COMMENT, REJECTION)
#: What a comment may mention.
MENTION_KINDS: tuple[str, ...] = ("card", "decision", "user")

#: The sections a decision's thread can be tagged to.
DECISION_SECTIONS: tuple[str, ...] = (
    "general",
    "context",
    "decision",
    "consequences",
    "alternatives_considered",
)
#: A SoAW section key: the built-in ones are numbered (``1.1``, ``2.3``), the
#: custom ones ``custom_<n>``; ``general`` for the document as a whole.
SOAW_SECTION_RE = re.compile(r"[a-z0-9_.]{1,64}")

#: The longest stored body a person may write.
BODY_MAX_LENGTH = 20_000
#: The longest body a write accepts BEFORE anything reads it: the stored cap
#: plus room for the labels the editor writes inside mention spans (stripped
#: on save). Checked first, so no pattern ever runs over more than this.
RAW_BODY_MAX_LENGTH = 2 * BODY_MAX_LENGTH
TOO_LONG = f"A comment is longer than {BODY_MAX_LENGTH} characters"

DOCUMENT = "document"
CHAIN = "chain"
SCOPES: tuple[str, ...] = (DOCUMENT, CHAIN)


@dataclass(frozen=True)
class DocPermissions:
    view: str
    comment: str
    manage: str


PERMISSIONS: dict[str, DocPermissions] = {
    collab.ADR: DocPermissions(view="adr.view", comment="adr.comment", manage="adr.manage"),
    collab.SOAW: DocPermissions(view="soaw.view", comment="soaw.comment", manage="soaw.manage"),
}

#: The persisted event of a new comment, per document kind.
ADDED_EVENTS: dict[str, str] = {
    collab.ADR: "adr.comment_added",
    collab.SOAW: "soaw.comment_added",
}

NOT_FOUND = "Comment not found"
MAY_NOT_COMMENT = "You may not comment on this document"
THREAD_CLOSED = "This thread's first comment was deleted"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _value(obj: Any, key: str) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key)
    return getattr(obj, key, None)


def _same(a: Any, b: Any) -> bool:
    return a is not None and b is not None and str(a) == str(b)


# --- pure rules -------------------------------------------------------------------


def signatory_ids(doc_signatories: Iterable[Any] | None, history_rows: Iterable[Any]) -> set[str]:
    """Every user id that is a signatory of one revision: in its current
    ``signatories`` or in a ``sent_for_review`` row of its timeline
    (``history_rows`` must be that revision's rows only)."""
    found: set[str] = set()

    def _add(entries: Iterable[Any] | None) -> None:
        for entry in entries or ():
            if isinstance(entry, Mapping) and entry.get("user_id"):
                found.add(str(entry["user_id"]))

    _add(doc_signatories)
    for row in history_rows:
        if _value(row, "kind") == "sent_for_review":
            _add(_value(row, "signatories"))
    return found


def is_signatory(
    user_id: Any, doc_signatories: Iterable[Any] | None, history_rows: Iterable[Any]
) -> bool:
    """Whether ``user_id`` is a signatory of the revision (see :func:`signatory_ids`)."""
    return str(user_id) in signatory_ids(doc_signatories, history_rows)


def can_comment(*, holds_comment: bool, signatory: bool) -> bool:
    """Post, reply, resolve and reopen: the comment permission, or a signatory."""
    return holds_comment or signatory


def can_moderate(*, holds_manage: bool) -> bool:
    """Delete another person's plain comment: the document's edit permission."""
    return holds_manage


def post_refusal(*, may_comment: bool) -> tuple[int, str] | None:
    if not may_comment:
        return 403, MAY_NOT_COMMENT
    return None


def reply_refusal(parent: Any, *, may_comment: bool) -> tuple[int, str] | None:
    """``(status, message)`` when a reply to the thread ``parent`` (its
    top-level comment) is refused, else ``None``: the comment right first,
    then a closed thread (its first comment deleted) is 409."""
    if not may_comment:
        return 403, MAY_NOT_COMMENT
    if thread_closed(parent):
        return 409, THREAD_CLOSED
    return None


def thread_closed(top: Any) -> bool:
    """Whether a thread is closed: its top-level comment is deleted."""
    return top.deleted_at is not None


def edit_refusal(comment: Any, user_id: Any, *, may_comment: bool) -> tuple[int, str] | None:
    """``(status, message)`` when ``user_id`` may not edit ``comment``, else ``None``."""
    if comment.deleted_at is not None:
        return 409, "This comment has been deleted"
    if comment.kind != COMMENT:
        return 403, "A signing note or a rejection reason cannot be edited"
    if not _same(comment.author_id, user_id):
        return 403, "Only the author may edit a comment"
    if not may_comment:
        return 403, MAY_NOT_COMMENT
    return None


def delete_refusal(comment: Any, user_id: Any, *, moderate: bool) -> tuple[int, str] | None:
    """``(status, message)`` when ``user_id`` may not delete ``comment``, else ``None``."""
    if comment.deleted_at is not None:
        return 409, "This comment has already been deleted"
    if _same(comment.author_id, user_id):
        return None
    if moderate and comment.kind == COMMENT:
        return None
    if moderate and comment.kind == REJECTION:
        return 403, "A rejection reason is resolved, not deleted"
    return 403, "Only the author or an editor may delete a comment"


def resolve_refusal(comment: Any, *, may_comment: bool) -> tuple[int, str] | None:
    """``(status, message)`` when the thread may not be resolved or reopened."""
    if not may_comment:
        return 403, MAY_NOT_COMMENT
    if comment.parent_id is not None:
        return 400, "Only a thread can be resolved or reopened"
    if comment.kind == SIGN_NOTE:
        return 400, "A signing note is not a thread to resolve"
    if comment.deleted_at is not None:
        return 409, "This comment has been deleted"
    return None


def may_edit(comment: Any, user_id: Any, *, may_comment: bool = True) -> bool:
    return edit_refusal(comment, user_id, may_comment=may_comment) is None


def may_delete(comment: Any, user_id: Any, moderate: bool) -> bool:
    return delete_refusal(comment, user_id, moderate=moderate) is None


def may_resolve(comment: Any, *, may_comment: bool) -> bool:
    return resolve_refusal(comment, may_comment=may_comment) is None


def is_open(comment: Any) -> bool:
    """Top-level, unresolved, not deleted, and a ``comment`` or ``rejection``."""
    return (
        comment.parent_id is None
        and comment.deleted_at is None
        and comment.resolved_at is None
        and comment.kind in OPEN_KINDS
    )


def open_count(threads: Iterable[Any]) -> int:
    """How many of ``threads`` (comments of one document) are open."""
    return sum(1 for comment in threads if is_open(comment))


def validate_section(doc_kind: str, section: str | None) -> str | None:
    """``section`` when it may tag a thread of a ``doc_kind`` document (400 otherwise)."""
    if doc_kind not in PERMISSIONS:
        raise ValueError(f"Unknown document kind {doc_kind!r}")
    if section is None:
        return None
    if doc_kind == collab.ADR:
        if section not in DECISION_SECTIONS:
            raise HTTPException(400, "Unknown section")
    elif SOAW_SECTION_RE.fullmatch(section) is None:
        raise HTTPException(400, "Unknown section")
    return section


# --- comment HTML -----------------------------------------------------------------

#: Tags kept when written without attributes.
PLAIN_TAGS: frozenset[str] = frozenset(
    {"p", "br", "strong", "em", "s", "code", "ul", "ol", "li", "blockquote"}
)
_TAG_RE = re.compile(r"<[^<>]*+>")
_SIMPLE_TAG_RE = re.compile(r"<(/?)([A-Za-z][A-Za-z0-9]*)\s*(/?)>")
_LINK_OPEN_RE = re.compile(r"<a(\s[^>]*)>", re.IGNORECASE)
_LINK_ATTRIBUTE_RE = re.compile(
    r"""\s+([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?"""
)
_SAFE_HREF_RE = re.compile(r"(?:https?://|mailto:)", re.IGNORECASE)
_UNSAFE_HREF_CHARS_RE = re.compile(r"[\x00-\x20\x7f]")


def _text(segment: str) -> str:
    """Text as stored: entities read, then ``& < >`` escaped."""
    return html_lib.escape(html_lib.unescape(segment), quote=False)


def safe_href(attrs: str) -> str | None:
    """The ``href`` of a link's attribute string when it is an http(s) or
    mailto URL, else ``None`` (also for a malformed attribute string or a
    repeated ``href``)."""
    href: str | None = None
    pos = 0
    # One pair at a time from where the last one ended (never searched for:
    # a search would rescan the rest of the string from every position).
    while (match := _LINK_ATTRIBUTE_RE.match(attrs, pos)) is not None:
        pos = match.end()
        if match.group(1).lower() != "href":
            continue
        if href is not None:
            return None
        raw = next((g for g in match.group(2, 3, 4) if g is not None), "")
        href = html_lib.unescape(raw).strip()
    if attrs[pos:].strip(" \t\n/"):
        return None
    if not href or _UNSAFE_HREF_CHARS_RE.search(href) or not _SAFE_HREF_RE.match(href):
        return None
    return href


@dataclass
class _Links:
    open: int = 0


def _tag(tag: str, links: _Links) -> str:
    simple = _SIMPLE_TAG_RE.fullmatch(tag)
    if simple is not None:
        closing, name, self_closing = simple.group(1), simple.group(2).lower(), simple.group(3)
        if name == "br":
            if not closing:
                return "<br>"
        elif name in PLAIN_TAGS and not self_closing:
            return f"</{name}>" if closing else f"<{name}>"
        elif name == "a" and closing and not self_closing and links.open > 0:
            links.open -= 1
            return "</a>"
    link = _LINK_OPEN_RE.fullmatch(tag)
    if link is not None:
        href = safe_href(link.group(1))
        if href is not None:
            links.open += 1
            return f'<a href="{html_lib.escape(href, quote=True)}">'
    return _text(tag)


def _markup(fragment: str, links: _Links) -> str:
    out: list[str] = []
    pos = 0
    for match in _TAG_RE.finditer(fragment):
        out.append(_text(fragment[pos : match.start()]))
        out.append(_tag(match.group(0), links))
        pos = match.end()
    out.append(_text(fragment[pos:]))
    return "".join(out)


def is_blank(html: str) -> bool:
    """No mention and no visible text."""
    if iter_mentions(html):
        return False
    return not html_lib.unescape(_TAG_RE.sub("", html)).strip()


def check_raw_length(body: str) -> None:
    """400 for a raw body over :data:`RAW_BODY_MAX_LENGTH`: run before any
    pattern reads the body."""
    if len(body) > RAW_BODY_MAX_LENGTH:
        raise HTTPException(400, TOO_LONG)


def comment_html(body: str, *, allow_empty: bool = False) -> str:
    """A comment body as stored (R8): every tag escaped except attribute-less
    :data:`PLAIN_TAGS`, ``<a>`` with an http(s)/mailto ``href`` (its other
    attributes dropped) and canonical mention spans of a card, a decision or a
    person (no label; a span a browser reads as a mention in any case or
    quoting is first made canonical or reduced to its text). 400 when the raw
    body is over :data:`RAW_BODY_MAX_LENGTH` (before anything reads it), the
    stored one over :data:`BODY_MAX_LENGTH` or, unless ``allow_empty``, blank."""
    check_raw_length(body)
    body = mention_service.canonicalise(body, MENTION_KINDS)
    links = _Links()
    out: list[str] = []
    pos = 0
    for match in MENTION_SPAN_RE.finditer(body):
        out.append(_markup(body[pos : match.start()], links))
        out.append(mention_service.canonicalise(match.group(0), MENTION_KINDS))
        pos = match.end()
    out.append(_markup(body[pos:], links))
    out.append("</a>" * links.open)
    html = "".join(out)
    if len(html) > BODY_MAX_LENGTH:
        raise HTTPException(400, TOO_LONG)
    if not allow_empty and is_blank(html):
        raise HTTPException(400, "A comment needs some text")
    return html


def plain_to_html(text: str | None) -> str:
    """Plain text as escaped paragraphs, one per non-blank line (``""`` for none)."""
    return "".join(
        f"<p>{html_lib.escape(line, quote=False)}</p>"
        for line in (text or "").splitlines()
        if line.strip()
    )


# --- notifications (pure) ---------------------------------------------------------


def comment_recipients(
    *,
    creator_id: Any,
    signatories: Iterable[Any],
    people: Iterable[Any],
    commenters: Iterable[Any],
    actor_id: Any,
    mentioned: Iterable[Any],
) -> set[str]:
    """Who hears of a new comment (before the view-permission filter): the
    document's creator, its signatories, its decision makers and participants
    who are users, and earlier commenters; minus the actor and minus the people
    sent a mention notification for the same comment. A signatory entry
    whose id is not a user id (the demo's and some imported documents' named
    signatories without an account) is nobody to notify."""
    candidates = {creator_id, *signatories, *people, *commenters}
    excluded = {str(actor_id), *(str(m) for m in mentioned)}
    return {str(c) for c in candidates if _user_id(c)} - excluded


def _user_id(value: Any) -> bool:
    """Whether ``value`` can be a user's id (a UUID)."""
    if value is None:
        return False
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def new_user_mentions(stored_html: str | None, new_html: str, *, actor_id: Any) -> list[str]:
    """The people mentioned in ``new_html`` and not in ``stored_html``, in
    order of first mention, the actor left out."""
    before = {mid for kind, mid in iter_mentions(stored_html or "") if kind == "user"}
    out: list[str] = []
    for kind, mid in iter_mentions(new_html):
        if kind == "user" and mid not in before and mid not in out and mid != str(actor_id):
            out.append(mid)
    return out


def document_label(doc_kind: str, doc: Any) -> str:
    """How a notification names the document."""
    if doc_kind == collab.ADR:
        return adr_service.decision_label(doc)
    return soaw_service.soaw_label(doc.name, doc.revision_number)


def thread_link(doc_kind: str, doc_id: Any, thread_id: Any) -> str:
    """The document's preview, opened on the thread."""
    return f"/ea-delivery/{doc_kind}/{doc_id}/preview?thread={thread_id}"


def notification_texts(
    kind: str, *, doc_label: str, actor_name: str, reply: bool
) -> tuple[str, str]:
    """``(title, message)`` of a ``document_comment`` or ``document_mention``
    notification: the document and the actor, never the comment's text."""
    if kind == "document_mention":
        return (
            f'Mentioned on "{doc_label}"',
            f'{actor_name} mentioned you in the discussion of "{doc_label}"',
        )
    if reply:
        return f'New reply on "{doc_label}"', f'{actor_name} replied on "{doc_label}"'
    return f'New comment on "{doc_label}"', f'{actor_name} commented on "{doc_label}"'


# --- payloads (pure) --------------------------------------------------------------


def _person(user_id: Any, names: Mapping[str, str]) -> dict[str, str] | None:
    if user_id is None or str(user_id) not in names:
        return None
    return {"id": str(user_id), "display_name": names[str(user_id)]}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def comment_payload(
    comment: Any,
    *,
    revision_number: int,
    names: Mapping[str, str],
    body: str,
    can: Mapping[str, bool],
) -> dict[str, Any]:
    """One comment on the wire; a deleted one has an empty body."""
    deleted = comment.deleted_at is not None
    return {
        "id": str(comment.id),
        "kind": comment.kind,
        "section": comment.section,
        "revision_id": str(collab_owner_id(comment)),
        "revision_number": revision_number,
        "author": _person(comment.author_id, names),
        "author_name": comment.author_name,
        "body": "" if deleted else body,
        "created_at": _iso(comment.created_at),
        "edited_at": _iso(comment.edited_at),
        "deleted": deleted,
        "resolved_at": _iso(comment.resolved_at),
        "resolved_by": _person(comment.resolved_by, names),
        "can": dict(can),
    }


def collab_owner_id(comment: Any) -> Any:
    """The decision or SoAW revision the comment belongs to."""
    return comment.architecture_decision_id or comment.soaw_id


def comment_can(
    comment: Any, user_id: Any, *, may_comment: bool, moderate: bool
) -> dict[str, bool]:
    """``{edit, delete, resolve}`` for one comment and one reader."""
    return {
        "edit": may_edit(comment, user_id, may_comment=may_comment),
        "delete": may_delete(comment, user_id, moderate),
        "resolve": may_resolve(comment, may_comment=may_comment),
    }


def build_threads(
    comments: Sequence[Any],
    *,
    user_id: Any,
    revision_numbers: Mapping[str, int],
    may_comment: Mapping[str, bool],
    moderate: bool,
    names: Mapping[str, str],
    render: Callable[[Any], str],
) -> list[dict[str, Any]]:
    """Threads in the order of ``comments`` (top-level first in their own
    order, each with its replies in theirs). A reply whose thread is not in
    ``comments`` is left out."""
    replies: dict[str, list[Any]] = {}
    for comment in comments:
        if comment.parent_id is not None:
            replies.setdefault(str(comment.parent_id), []).append(comment)

    def _one(comment: Any) -> dict[str, Any]:
        revision = str(collab_owner_id(comment))
        return comment_payload(
            comment,
            revision_number=revision_numbers[revision],
            names=names,
            body=render(comment),
            can=comment_can(comment, user_id, may_comment=may_comment[revision], moderate=moderate),
        )

    return [
        {**_one(top), "replies": [_one(r) for r in replies.get(str(top.id), [])]}
        for top in comments
        if top.parent_id is None
    ]


# --- reads ------------------------------------------------------------------------


def _owner(doc_kind: str):
    return getattr(DocumentComment, collab.OWNER_COLUMNS[doc_kind])


def _history_owner(doc_kind: str):
    return getattr(DocumentHistoryEntry, collab.OWNER_COLUMNS[doc_kind])


def _model(doc_kind: str) -> type[ArchitectureDecision] | type[SoAW]:
    return ArchitectureDecision if doc_kind == collab.ADR else SoAW


async def review_rows(
    db: AsyncSession, doc_kind: str, doc_ids: Iterable[Any]
) -> dict[str, list[DocumentHistoryEntry]]:
    """The ``sent_for_review`` timeline rows of each document (one query)."""
    owner = _history_owner(doc_kind)
    rows = await db.execute(
        select(DocumentHistoryEntry).where(
            owner.in_(list(doc_ids)), DocumentHistoryEntry.kind == "sent_for_review"
        )
    )
    out: dict[str, list[DocumentHistoryEntry]] = {}
    for row in rows.scalars().all():
        out.setdefault(str(getattr(row, collab.OWNER_COLUMNS[doc_kind])), []).append(row)
    return out


async def signatory_of(db: AsyncSession, doc_kind: str, doc: Any, user_id: Any) -> bool:
    """Whether ``user_id`` is a signatory of ``doc`` (no query when its current
    signatories name them)."""
    if is_signatory(user_id, doc.signatories, ()):
        return True
    rows = (await review_rows(db, doc_kind, [doc.id])).get(str(doc.id), [])
    return is_signatory(user_id, None, rows)


@dataclass(frozen=True)
class Access:
    """What one reader may do in one document's discussion."""

    comment: bool
    moderate: bool
    holds_comment: bool = field(default=False, compare=False)

    def can(self) -> dict[str, bool]:
        return {"comment": self.comment, "moderate": self.moderate}


async def access(db: AsyncSession, doc_kind: str, doc: Any, user: User) -> Access:
    """The reader's rights on ``doc``'s discussion."""
    perms = PERMISSIONS[doc_kind]
    holds = await PermissionService.check_permission(db, user, perms.comment)
    signatory = False if holds else await signatory_of(db, doc_kind, doc, user.id)
    manage = await PermissionService.check_permission(db, user, perms.manage)
    return Access(
        comment=can_comment(holds_comment=holds, signatory=signatory),
        moderate=can_moderate(holds_manage=manage),
        holds_comment=holds,
    )


async def open_document(
    db: AsyncSession, doc_kind: str, doc_id: str, user: User
) -> tuple[Any, Access]:
    """The document and the reader's rights on its discussion: 403 without the
    view permission, then 404 for an unknown document."""
    await PermissionService.require_permission(db, user, PERMISSIONS[doc_kind].view)
    doc = await collab.load_document(db, doc_kind, doc_id)
    return doc, await access(db, doc_kind, doc, user)


async def _names(db: AsyncSession, comments: Iterable[Any]) -> dict[str, str]:
    ids = {
        user_id
        for comment in comments
        for user_id in (comment.author_id, comment.resolved_by)
        if user_id is not None
    }
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.display_name).where(User.id.in_(ids)))
    return {str(uid): name for uid, name in rows.all()}


async def _renderer(
    db: AsyncSession,
    comments: Sequence[Any],
    *,
    user: User,
    read_scope: CardReadScope | None,
    register: ds.Register | None,
) -> Callable[[Any], str]:
    """``comment → body`` for the reader, every mention resolved in ONE batch;
    each restricted token is scoped to its comment's id."""
    live = [c for c in comments if c.deleted_at is None]
    mentions = {m for c in live for m in iter_mentions(c.body)}
    if not mentions:
        return lambda comment: comment.body
    states = await mention_service.mention_states(
        db, mentions, user=user, read_scope=read_scope, register=register
    )
    return lambda comment: mention_service.render_for(comment.body, states, comment.id)


async def _revisions(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    scope: str,
    register: ds.Register | None,
) -> tuple[dict[str, int], ds.Register | None]:
    """``{revision id: revision number}`` of the documents in scope, in chain
    order, and the register when one was loaded."""
    if scope == DOCUMENT:
        return {str(doc.id): doc.revision_number}, register
    if doc_kind == collab.ADR:
        reg = register if register is not None else await ds.load_register(db)
        if doc.id not in reg:
            return {str(doc.id): doc.revision_number}, reg
        return {str(n.id): n.revision_number for n in reg.chain(doc.id).nodes}, reg
    chains = await soaw_service.load_chains(db)
    chain = chains.chain(doc.id)
    if chain is None:
        return {str(doc.id): doc.revision_number}, register
    return {str(n.id): n.revision_number for n in chain.nodes}, register


async def _may_comment_per_revision(
    db: AsyncSession, doc_kind: str, revision_ids: list[str], user: User, *, holds: bool
) -> dict[str, bool]:
    """Whether the reader may comment on each revision (two queries at most)."""
    if holds:
        return {rid: True for rid in revision_ids}
    model = _model(doc_kind)
    ids = [uuid.UUID(rid) for rid in revision_ids]
    result = await db.execute(select(model.id, model.signatories).where(model.id.in_(ids)))
    current: dict[Any, Any] = {row_id: signatories for row_id, signatories in result.all()}
    rounds = await review_rows(db, doc_kind, ids)
    return {
        rid: is_signatory(user.id, current.get(uuid.UUID(rid)), rounds.get(rid, []))
        for rid in revision_ids
    }


async def list_threads(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    *,
    user: User,
    acc: Access | None = None,
    read_scope: CardReadScope | None = None,
    scope: str = DOCUMENT,
    register: ds.Register | None = None,
) -> dict[str, Any]:
    """The discussion as ``user`` reads it: ``{can, open_count, threads}``.

    ``scope`` ``document`` lists the threads of ``doc``; ``chain`` those of
    every revision of its chain (earlier revisions first). ``open_count``
    counts ``doc`` alone. A constant number of queries, whatever the number of
    comments."""
    if scope not in SCOPES:
        raise ValueError(f"Unknown scope {scope!r}")
    if acc is None:
        acc = await access(db, doc_kind, doc, user)
    revisions, register = await _revisions(db, doc_kind, doc, scope, register)
    order = {rid: i for i, rid in enumerate(revisions)}
    rows = (
        (
            await db.execute(
                select(DocumentComment)
                .where(_owner(doc_kind).in_([uuid.UUID(rid) for rid in revisions]))
                .order_by(DocumentComment.created_at, DocumentComment.id)
            )
        )
        .scalars()
        .all()
    )
    comments = sorted(rows, key=lambda c: order[str(collab_owner_id(c))])
    if scope == DOCUMENT:
        may_comment = {str(doc.id): acc.comment}
    else:
        may_comment = await _may_comment_per_revision(
            db, doc_kind, list(revisions), user, holds=acc.holds_comment
        )
    render = await _renderer(db, comments, user=user, read_scope=read_scope, register=register)
    threads = build_threads(
        comments,
        user_id=user.id,
        revision_numbers=revisions,
        may_comment=may_comment,
        moderate=acc.moderate,
        names=await _names(db, comments),
        render=render,
    )
    own = [c for c in comments if _same(collab_owner_id(c), doc.id)]
    return {"can": acc.can(), "open_count": open_count(own), "threads": threads}


async def open_thread_count(db: AsyncSession, doc_kind: str, doc_id: Any) -> int:
    """How many threads of the document are open (one count query)."""
    result = await db.execute(
        select(func.count(DocumentComment.id)).where(
            _owner(doc_kind) == doc_id,
            DocumentComment.parent_id.is_(None),
            DocumentComment.deleted_at.is_(None),
            DocumentComment.resolved_at.is_(None),
            DocumentComment.kind.in_(OPEN_KINDS),
        )
    )
    return int(result.scalar_one())


async def thread_payload(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    top: DocumentComment,
    *,
    user: User,
    acc: Access,
    read_scope: CardReadScope | None = None,
) -> dict[str, Any]:
    """One thread of ``doc`` (``top`` and its replies) as ``user`` reads it."""
    replies = (
        (
            await db.execute(
                select(DocumentComment)
                .where(DocumentComment.parent_id == top.id)
                .order_by(DocumentComment.created_at, DocumentComment.id)
            )
        )
        .scalars()
        .all()
    )
    comments = [top, *replies]
    render = await _renderer(db, comments, user=user, read_scope=read_scope, register=None)
    (thread,) = build_threads(
        comments,
        user_id=user.id,
        revision_numbers={str(doc.id): doc.revision_number},
        may_comment={str(doc.id): acc.comment},
        moderate=acc.moderate,
        names=await _names(db, comments),
        render=render,
    )
    return thread


# --- writes -----------------------------------------------------------------------


def _refuse(refusal: tuple[int, str] | None) -> None:
    if refusal is not None:
        raise HTTPException(refusal[0], refusal[1])


async def load_comment(
    db: AsyncSession, doc_kind: str, doc: Any, comment_id: str
) -> DocumentComment:
    """The comment of ``doc`` named ``comment_id``; 404 for an unknown id, a
    malformed one, or a comment of another document (R12)."""
    try:
        parsed = uuid.UUID(comment_id)
    except (ValueError, TypeError):
        raise HTTPException(404, NOT_FOUND) from None
    comment = await db.get(DocumentComment, parsed)
    if comment is None or not _same(getattr(comment, collab.OWNER_COLUMNS[doc_kind]), doc.id):
        raise HTTPException(404, NOT_FOUND)
    return comment


async def _parent(db: AsyncSession, doc_kind: str, doc: Any, parent_id: str) -> DocumentComment:
    refused = HTTPException(400, "A reply must answer a thread of this document")
    try:
        parsed = uuid.UUID(parent_id)
    except (ValueError, TypeError):
        raise refused from None
    parent = await db.get(DocumentComment, parsed)
    if (
        parent is None
        or not _same(getattr(parent, collab.OWNER_COLUMNS[doc_kind]), doc.id)
        or parent.parent_id is not None
    ):
        raise refused
    return parent


async def _check_mentions(
    db: AsyncSession,
    stored_html: str | None,
    new_html: str,
    *,
    user: User,
    read_scope: CardReadScope | None,
) -> None:
    """404 on a mention new to this comment the writer may not make."""
    new = set(iter_mentions(new_html)) - set(iter_mentions(stored_html or ""))
    if new:
        await mention_service.check_new_mentions(
            db, new, user=user, read_scope=read_scope, system=False
        )


async def _viewers(
    db: AsyncSession, doc_kind: str, user_ids: Iterable[str]
) -> tuple[set[str], dict[str, str]]:
    """``(ids of active users holding the view permission, {id: display name})``
    over ``user_ids`` (one query; permissions from the role cache)."""
    ids = [uuid.UUID(u) for u in set(user_ids)]
    if not ids:
        return set(), {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    names = {str(u.id): u.display_name for u in rows}
    view = PERMISSIONS[doc_kind].view
    allowed = {
        str(u.id)
        for u in rows
        if u.is_active and await PermissionService.has_app_permission(db, u, view)
    }
    return allowed, names


async def _audience(db: AsyncSession, doc_kind: str, doc: Any, *, exclude: Any) -> dict[str, Any]:
    """The document-side inputs of :func:`comment_recipients`."""
    rounds = (await review_rows(db, doc_kind, [doc.id])).get(str(doc.id), [])
    people: list[Any] = []
    if doc_kind == collab.ADR:
        people = list(
            (
                await db.execute(
                    select(ArchitectureDecisionPerson.user_id).where(
                        ArchitectureDecisionPerson.architecture_decision_id == doc.id,
                        ArchitectureDecisionPerson.user_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
    commenters = (
        (
            await db.execute(
                select(DocumentComment.author_id)
                .where(
                    _owner(doc_kind) == doc.id,
                    DocumentComment.author_id.is_not(None),
                    DocumentComment.id != exclude,
                )
                .distinct()
            )
        )
        .scalars()
        .all()
    )
    return {
        "creator_id": doc.created_by,
        "signatories": signatory_ids(doc.signatories, rounds),
        "people": people,
        "commenters": list(commenters),
    }


@dataclass(frozen=True)
class Delivery:
    """One batch of notifications of one type, for
    ``notification_service.deliver_notification_batch`` after the commit."""

    notif_type: str
    recipients: tuple[dict[str, Any], ...]


def deliveries_for(
    *,
    mentioned: Sequence[str],
    audience: Iterable[str],
    texts: Mapping[str, tuple[str, str]],
    link: str,
    data: Mapping[str, str],
) -> tuple[Delivery, ...]:
    """The ``document_mention`` batch (``mentioned``, in order) and the
    ``document_comment`` batch (``audience``, sorted); a type with nobody to
    tell is left out. ``texts`` maps each type to its ``(title, message)``."""
    batches = (("document_mention", list(mentioned)), ("document_comment", sorted(audience)))
    return tuple(
        Delivery(
            notif_type=notif_type,
            recipients=tuple(
                {
                    "user_id": uuid.UUID(recipient),
                    "title": texts[notif_type][0],
                    "message": texts[notif_type][1],
                    "link": link,
                    "data": dict(data),
                }
                for recipient in recipients
            ),
        )
        for notif_type, recipients in batches
        if recipients
    )


def schedule_deliveries(
    background_tasks: BackgroundTasks, deliveries: Iterable[Delivery], *, actor_id: Any
) -> None:
    """Hand each batch to ``deliver_notification_batch`` as a background task:
    Starlette runs it only after the response, i.e. after the route's commit,
    and the helper sends the e-mails with no database session held. Call it
    after ``db.commit()``. Referenced through the module so tests can stand in
    for the delivery."""
    for delivery in deliveries:
        background_tasks.add_task(
            notification_service.deliver_notification_batch,
            list(delivery.recipients),
            notif_type=delivery.notif_type,
            actor_id=actor_id,
        )


async def _notify(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    comment: DocumentComment,
    *,
    user: User,
    mentioned: list[str],
    announce: bool,
) -> tuple[list[dict[str, str]], tuple[Delivery, ...]]:
    """Who hears of ``comment``: ``document_mention`` for each person in
    ``mentioned`` who can view the document and, when ``announce``,
    ``document_comment`` for the rest of the audience. Returns the mentioned
    people who will NOT be notified (they cannot open the document):
    ``[{id, display_name}]``, and the batches to deliver after the commit."""
    thread_id = comment.parent_id or comment.id
    label = document_label(doc_kind, doc)
    reply = comment.parent_id is not None
    data = {
        "doc_kind": doc_kind,
        "doc_id": str(doc.id),
        "comment_id": str(comment.id),
        "thread_id": str(thread_id),
    }
    viewers, names = await _viewers(db, doc_kind, mentioned)
    notified = [m for m in mentioned if m in viewers]
    unnotified = [
        {"id": m, "display_name": names.get(m, "")} for m in mentioned if m not in viewers
    ]
    audience: set[str] = set()
    if announce:
        inputs = await _audience(db, doc_kind, doc, exclude=comment.id)
        candidates = comment_recipients(**inputs, actor_id=user.id, mentioned=notified)
        audience, _ = await _viewers(db, doc_kind, candidates)
    texts = {
        notif_type: notification_texts(
            notif_type, doc_label=label, actor_name=user.display_name, reply=reply
        )
        for notif_type in ("document_mention", "document_comment")
    }
    deliveries = deliveries_for(
        mentioned=notified,
        audience=audience,
        texts=texts,
        link=thread_link(doc_kind, doc.id, thread_id),
        data=data,
    )
    return unnotified, deliveries


@dataclass(frozen=True)
class Written:
    """A write's outcome: the comment touched, its thread's top comment, the
    mentioned people who were not notified, and the notification batches to
    deliver once the route has committed (:func:`schedule_deliveries`)."""

    comment: DocumentComment
    top: DocumentComment
    unnotified: list[dict[str, str]]
    deliveries: tuple[Delivery, ...] = ()


async def add_comment(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    *,
    user: User,
    acc: Access,
    body: str,
    section: str | None = None,
    parent_id: str | None = None,
    read_scope: CardReadScope | None = None,
) -> Written:
    """A new comment or reply by ``user``; publishes the persisted
    ``<kind>.comment_added`` event (no body) and returns the notifications to
    deliver after the commit. Flushed."""
    _refuse(post_refusal(may_comment=acc.comment))
    parent = await _parent(db, doc_kind, doc, parent_id) if parent_id is not None else None
    if parent is not None:
        _refuse(reply_refusal(parent, may_comment=acc.comment))
    section = parent.section if parent is not None else validate_section(doc_kind, section)
    html = comment_html(body)
    await _check_mentions(db, None, html, user=user, read_scope=read_scope)
    comment = DocumentComment(
        **collab.owner_fields(doc_kind, doc.id),
        parent_id=parent.id if parent is not None else None,
        author_id=user.id,
        author_name=user.display_name,
        body=html,
        section=section,
        kind=COMMENT,
        created_at=_now(),
    )
    db.add(comment)
    await db.flush()
    unnotified, deliveries = await _notify(
        db,
        doc_kind,
        doc,
        comment,
        user=user,
        mentioned=new_user_mentions(None, html, actor_id=user.id),
        announce=True,
    )
    await event_bus.publish(
        ADDED_EVENTS[doc_kind],
        {
            "id": str(doc.id),
            "comment_id": str(comment.id),
            "kind": comment.kind,
            "section": comment.section,
            "revision_number": doc.revision_number,
        },
        db=db,
        user_id=user.id,
    )
    return Written(
        comment=comment, top=parent or comment, unnotified=unnotified, deliveries=deliveries
    )


async def _top(db: AsyncSession, comment: DocumentComment) -> DocumentComment:
    if comment.parent_id is None:
        return comment
    parent = await db.get(DocumentComment, comment.parent_id)
    assert parent is not None
    return parent


async def edit_comment(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    comment: DocumentComment,
    *,
    user: User,
    acc: Access,
    body: str,
    read_scope: CardReadScope | None = None,
) -> Written:
    """The author's new body: restricted chips restored against THIS
    comment's stored mentions (R4), new mentions checked, newly mentioned
    people returned to notify after the commit. Flushed."""
    _refuse(edit_refusal(comment, user.id, may_comment=acc.comment))
    check_raw_length(body)
    stored = comment.body

    def token_of(kind: str, mention_id: str) -> str:
        return mention_service.token_for(comment.id, kind, mention_id)

    restored = mention_service.restore_tokens(body, set(iter_mentions(stored)), token_of)
    html = comment_html(restored)
    await _check_mentions(db, stored, html, user=user, read_scope=read_scope)
    comment.body = html
    comment.edited_at = _now()
    await db.flush()
    unnotified, deliveries = await _notify(
        db,
        doc_kind,
        doc,
        comment,
        user=user,
        mentioned=new_user_mentions(stored, html, actor_id=user.id),
        announce=False,
    )
    return Written(
        comment=comment,
        top=await _top(db, comment),
        unnotified=unnotified,
        deliveries=deliveries,
    )


async def delete_comment(
    db: AsyncSession, comment: DocumentComment, *, user: User, acc: Access
) -> None:
    """Soft delete: ``deleted_at`` set and the body blanked; replies stay.
    Deleting a thread's top closes it to replies (:func:`reply_refusal`)."""
    _refuse(delete_refusal(comment, user.id, moderate=acc.moderate))
    comment.deleted_at = _now()
    comment.body = ""
    await db.flush()


async def resolve_thread(
    db: AsyncSession, comment: DocumentComment, *, user: User, acc: Access
) -> DocumentComment:
    """Mark the thread resolved (a resolved thread stays as it was)."""
    _refuse(resolve_refusal(comment, may_comment=acc.comment))
    if comment.resolved_at is None:
        comment.resolved_at = _now()
        comment.resolved_by = user.id
        await db.flush()
    return comment


async def reopen_thread(
    db: AsyncSession, comment: DocumentComment, *, user: User, acc: Access
) -> DocumentComment:
    """Open the thread again."""
    _refuse(resolve_refusal(comment, may_comment=acc.comment))
    comment.resolved_at = None
    comment.resolved_by = None
    await db.flush()
    return comment


SYSTEM_KINDS: tuple[str, ...] = (REJECTION, SIGN_NOTE)


async def add_system_comment(
    db: AsyncSession,
    doc_kind: str,
    doc: Any,
    *,
    kind: str,
    user: User,
    text: str | None,
) -> DocumentComment:
    """The thread a workflow step opens: a ``rejection`` carrying the reason
    (an empty reason gives an empty body) or a ``sign_note``, authored by the
    person who took the step. No notification and no event of its own: the
    step's own (``adr_rejected`` …) already carry it. Flushed."""
    if kind not in SYSTEM_KINDS:
        raise ValueError(f"Not a system comment kind: {kind!r}")
    comment = DocumentComment(
        **collab.owner_fields(doc_kind, doc.id),
        author_id=user.id,
        author_name=user.display_name,
        body=plain_to_html(text),
        kind=kind,
        created_at=_now(),
    )
    db.add(comment)
    await db.flush()
    return comment
