"""Mentions of cards and decisions in decision and SoAW text: the server's side.

The span grammar is :mod:`app.services.mention_markup`'s; this module decides
what a mention MEANS for a writer and for a reader.

Stored form (written here, never trusted from the client)::

    <span data-type="mention" data-kind="card" data-id="<uuid>"></span>

No label is stored, so a rename never reads as an edit and stored text never
holds a name.

Write (:func:`normalise_for_write`, called by ``document_collab.before_save``
from every writer): a restricted chip the editor sends back as a token is
mapped to the mention it stands for, by recomputing the token over the
mentions ALREADY STORED on that document (an unknown or foreign token is
dropped: "keep the links the caller never saw"); every span is canonicalised;
each mention that is new compared with the stored text is checked — a card
must exist and be readable by the writer in module mode (404 "Card not
found" otherwise, so the answer never confirms a hidden card), a decision
must exist and the writer hold ``adr.view``. A system writer (extension
bridge, TurboLens commit) is checked for existence only; a copy (revision,
duplicate) is canonicalised only — a 404 there would be an existence oracle.

Read (:func:`resolve_for_reader`, called by ``document_collab.render_doc``
once per response): one batch over every text field of every payload. No
mention marker anywhere → zero queries, the payloads come back untouched.
Otherwise one card query, the reader's scope, and the decision register;
each span is rendered for the reader (:func:`render`):

* resolved — ``data-id`` kept and the label filled in (``@Card name``, or
  ``ADR-012 · Rev 2 Title`` from the CURRENT revision of the decision's
  chain); ``data-archived="true"`` on an archived card;
* restricted — a card hidden from the reader (even an archived one), or any
  decision for a reader without ``adr.view``: no id and no text, only an
  opaque token scoped to the document (:func:`token_for`);
* missing — the target no longer exists: id kept, no text.

Restricted and missing spans stay EMPTY so the frontend writes the words in
the reader's language (``fillMentionLabels``). Attribute order follows the
editor's ``renderHTML`` (``mentionSpanAttributes``), so a load/save round
trip is byte-stable.

"Mentioned in" (:func:`mentioned_in_card`, :func:`mentioned_in_decision`)
searches the stored canonical marker with the ORM — no index table — and
parses every row it finds before it counts, so text that merely contains the
marker's characters lists nothing. A decision or SoAW is listed once per
revision chain, when the mention is in the chain's CURRENT revision or in its
open draft, and the entry names the revision that holds it; a mention left
only in an earlier revision lists nothing.
"""

from __future__ import annotations

import functools
import hashlib
import hmac
import html as html_lib
import re
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Text, case, cast, column, exists, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.document_comment import DocumentComment
from app.models.soaw import SoAW
from app.models.user import User
from app.services import adr_service, soaw_service
from app.services import decision_standing as ds
from app.services.card_read_scope import CardReadScope
from app.services.mention_markup import (
    MENTION_SPAN_RE,
    canonical_span,
    for_reading,
    has_hint,
    iter_mentions,
    mention_of,
    normalise,
    parse_attributes,
    text_of,
)
from app.services.permission_service import PermissionService

#: The substring every canonical mention span carries.
MARKER = 'data-type="mention"'

#: What a decision or SoAW text may mention (people are mentioned in comments only).
DOCUMENT_KINDS: tuple[str, ...] = ("card", "decision")

#: The fields of each document kind that carry rich text.
_TEXT_FIELDS: dict[str, tuple[str, ...]] = {
    "adr": ("context", "decision", "consequences", "alternatives_considered"),
    "soaw": ("sections",),
}

RESOLVED = "resolved"
RESTRICTED = "restricted"
MISSING = "missing"

Mention = tuple[str, str]


# --- pure ------------------------------------------------------------------------


@dataclass(frozen=True)
class MentionState:
    """What one mention is for one reader: ``resolved`` (with its label and
    whether the card is archived), ``restricted`` (with the reader's token) or
    ``missing``."""

    status: str
    label: str = ""
    archived: bool = False
    token: str = ""


def resolved(label: str, *, archived: bool = False) -> MentionState:
    return MentionState(RESOLVED, label=label, archived=archived)


def restricted(token: str = "") -> MentionState:
    return MentionState(RESTRICTED, token=token)


MISSING_STATE = MentionState(MISSING)


class MentionRefused(HTTPException):
    """A new mention the writer may not make (unknown or hidden target)."""


def text_fields_of(doc_kind: str) -> tuple[str, ...]:
    """The fields of a ``doc_kind`` document that carry rich text."""
    if doc_kind not in _TEXT_FIELDS:
        raise ValueError(f"Unknown document kind {doc_kind!r}")
    return _TEXT_FIELDS[doc_kind]


def token_for(scope_id: Any, kind: str, target_id: Any) -> str:
    """The opaque stand-in for a mention the reader may not see: the first 16
    hex of HMAC-SHA256 (key ``SECRET_KEY``) over ``scope:kind:target``. Scoped
    to the document, so a token copied into another document means nothing."""
    message = f"{str(scope_id).lower()}:{kind}:{str(target_id).lower()}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), message, hashlib.sha256).hexdigest()[:16]


def escaped_text(inner_html: str) -> str:
    """The text of a span's content, escaped: tags dropped, entities read."""
    return text_of(inner_html)


def canonicalise(html: Any, allowed_kinds: Iterable[str]) -> Any:
    """Every mention span in its stored form: no label, no reader flag.

    Every span a browser would read as a mention (any case, quoting or
    attribute order: :func:`~app.services.mention_markup.normalise`) becomes
    the canonical nameless span when it names a valid kind and id; one that is
    malformed, of an unknown kind or of a kind not in ``allowed_kinds`` (a
    person in a document) collapses to its escaped text. A fixed point:
    canonicalising the result again changes nothing. Anything that is not a
    string, or holds no ``data-type`` at all, comes back as it is.
    """
    return normalise(html, allowed_kinds)


def restore_tokens(
    html: Any, stored_ids: Iterable[Mention], token_of: Callable[[str, str], str]
) -> Any:
    """Map each restricted span (a token, no id) back to its mention.

    The token is recomputed (``token_of(kind, id)``) over ``stored_ids``, the
    mentions already stored on the document; a span whose token and kind match
    one becomes its canonical span, any other token span is dropped. Spans that
    carry an id are left for :func:`canonicalise`.
    """
    if not isinstance(html, str) or MARKER not in html or "data-token=" not in html:
        return html
    by_token = {token_of(kind, mid): (kind, mid) for kind, mid in stored_ids}

    def _sub(match: re.Match[str]) -> str:
        attrs = parse_attributes(match.group(1))
        if attrs is None or "data-token" not in attrs or "data-id" in attrs:
            return match.group(0)
        target = by_token.get(attrs["data-token"])
        if target is None or target[0] != attrs.get("data-kind"):
            return ""
        return canonical_span(*target)

    return MENTION_SPAN_RE.sub(_sub, html)


def render_span(kind: str, mention_id: str, state: MentionState) -> str:
    """One mention as a reader receives it (attribute order: type, kind, id,
    restricted, token, missing, archived)."""
    head = f'<span data-type="mention" data-kind="{kind}"'
    if state.status == RESTRICTED:
        return f'{head} data-restricted="true" data-token="{state.token}"></span>'
    if state.status == MISSING:
        return f'{head} data-id="{mention_id}" data-missing="true"></span>'
    archived = ' data-archived="true"' if state.archived else ""
    label = html_lib.escape(state.label, quote=False)
    return f'{head} data-id="{mention_id}"{archived}>{label}</span>'


def render(html: Any, resolve: Callable[[str, str], MentionState]) -> Any:
    """``html`` with every mention rendered through ``resolve(kind, id)``.

    A malformed span collapses to its escaped text (its attributes, whatever
    they name, never reach the reader), and a span outside the grammar is
    read through :func:`~app.services.mention_markup.normalise` first, so no
    label a writer typed is ever returned for a mention.
    """
    if not has_hint(html):
        return html

    def _sub(match: re.Match[str]) -> str:
        mention = mention_of(match.group(1))
        if mention is None:
            return escaped_text(match.group(2))
        kind, mention_id = mention
        return render_span(kind, mention_id, resolve(kind, mention_id))

    return MENTION_SPAN_RE.sub(_sub, for_reading(html))


def walk_soaw_sections(sections: Any, fn: Callable[[str], Any]) -> Any:
    """A NEW sections dict with ``fn`` applied to each section's ``content``
    when it is a string (custom sections included). Tables and TOGAF cells are
    plain text and stay as they are; the input is never mutated."""
    if not isinstance(sections, Mapping):
        return sections
    out: dict[str, Any] = {}
    for key, section in sections.items():
        if isinstance(section, Mapping) and isinstance(section.get("content"), str):
            out[key] = {**section, "content": fn(section["content"])}
        else:
            out[key] = section
    return out


def field_texts(doc_kind: str, field: str, value: Any) -> list[str]:
    """The rich-text strings held by one field's value."""
    if doc_kind == "soaw":
        if not isinstance(value, Mapping):
            return []
        return [
            section["content"]
            for section in value.values()
            if isinstance(section, Mapping) and isinstance(section.get("content"), str)
        ]
    return [value] if isinstance(value, str) else []


def map_field(doc_kind: str, value: Any, fn: Callable[[str], Any]) -> Any:
    """One field's value with ``fn`` applied to each of its rich-text strings."""
    if doc_kind == "soaw":
        return walk_soaw_sections(value, fn)
    return fn(value) if isinstance(value, str) else value


def has_marker(doc_kind: str, values: Mapping[str, Any]) -> bool:
    """Whether any text field in ``values`` may hold a mention span (cheap)."""
    return any(
        has_hint(text)
        for field in text_fields_of(doc_kind)
        if field in values
        for text in field_texts(doc_kind, field, values[field])
    )


def mentions_of(doc_kind: str, values: Mapping[str, Any]) -> set[Mention]:
    """Every well-formed mention in the text fields of ``values``."""
    return {
        mention
        for field in text_fields_of(doc_kind)
        if field in values
        for text in field_texts(doc_kind, field, values[field])
        for mention in iter_mentions(text)
    }


def stored_mentions(doc_kind: str, doc: Any) -> set[Mention]:
    """The mentions stored on ``doc`` (a decision or SoAW row; ``None`` → none)."""
    if doc is None:
        return set()
    return mentions_of(doc_kind, {f: getattr(doc, f, None) for f in text_fields_of(doc_kind)})


def decision_label(reference_number: str, revision_number: int | None, title: str) -> str:
    """``ADR-012 · Rev 2 Title`` (the revision from 2 on): a decision's chip text."""
    return f"{adr_service.reference_label(reference_number, revision_number)} {title}"


# --- write ----------------------------------------------------------------------


async def check_new_mentions(
    db: AsyncSession,
    mentions: Iterable[Mention],
    *,
    user: User | None,
    read_scope: CardReadScope | None,
    system: bool,
) -> None:
    """Refuse (404) a new mention whose target does not exist or, for a user
    writer, that the writer may not read (a card in module mode; a decision
    without ``adr.view``). A person must exist. One query per kind present."""
    card_ids = {uuid.UUID(mid) for kind, mid in mentions if kind == "card"}
    decision_ids = {uuid.UUID(mid) for kind, mid in mentions if kind == "decision"}
    if card_ids:
        rows = (await db.execute(select(Card.id, Card.type).where(Card.id.in_(card_ids)))).all()
        if len(rows) != len(card_ids):
            raise MentionRefused(404, "Card not found")
        if not system:
            assert user is not None
            scope = read_scope if read_scope is not None else await CardReadScope.load(db, user)
            if any(not scope.readable(cid, ctype, mode="module") for cid, ctype in rows):
                raise MentionRefused(404, "Card not found")
    if decision_ids:
        # The permission first: a writer who may not read decisions learns
        # nothing about which ids exist.
        if not system:
            assert user is not None
            if not await PermissionService.check_permission(db, user, "adr.view"):
                raise MentionRefused(404, "Decision not found")
        found = set(
            (
                await db.execute(
                    select(ArchitectureDecision.id).where(ArchitectureDecision.id.in_(decision_ids))
                )
            )
            .scalars()
            .all()
        )
        if found != decision_ids:
            raise MentionRefused(404, "Decision not found")
    user_ids = {uuid.UUID(mid) for kind, mid in mentions if kind == "user"}
    if user_ids:
        # People are mentioned in comments only; anyone may name any user.
        people = set(
            (await db.execute(select(User.id).where(User.id.in_(user_ids)))).scalars().all()
        )
        if people != user_ids:
            raise MentionRefused(404, "User not found")


async def normalise_for_write(
    db: AsyncSession,
    *,
    doc_kind: str,
    doc: Any,
    incoming: dict[str, Any],
    user: User | None,
    read_scope: CardReadScope | None,
    system: bool = False,
    copy: bool = False,
    kept: Iterable[Mention] = (),
) -> dict[str, Any]:
    """The text fields to store (see the module doc). ``doc`` is the stored
    document (``None`` on a create: nothing is restored). ``kept`` are
    mentions that count as already stored on ``doc`` besides its current text
    — a restored version's, which were stored on the document once and are
    therefore not new. ``incoming`` comes back as the same object when none
    of its fields holds a mention."""
    fields = [f for f in text_fields_of(doc_kind) if f in incoming]
    if not has_marker(doc_kind, incoming):
        return incoming
    if user is None and not (system or copy):
        raise ValueError("A user writer needs its user")
    stored = stored_mentions(doc_kind, doc) | set(kept)

    def token_of(kind: str, mention_id: str) -> str:
        return token_for(doc.id, kind, mention_id)

    def clean(text: str) -> Any:
        return canonicalise(restore_tokens(text, stored, token_of), DOCUMENT_KINDS)

    out = dict(incoming)
    for field in fields:
        out[field] = map_field(doc_kind, incoming[field], clean)
    if not copy:
        new = mentions_of(doc_kind, out) - stored
        await check_new_mentions(db, new, user=user, read_scope=read_scope, system=system)
    return out


# --- read -----------------------------------------------------------------------


async def mention_states(
    db: AsyncSession,
    mentions: Iterable[Mention],
    *,
    user: User,
    read_scope: CardReadScope | None,
    register: ds.Register | None = None,
) -> dict[Mention, MentionState]:
    """Each mention's state for ``user`` (restricted ones without a token: it is
    per document). One query per kind present; the scope and the register are
    loaded only when needed and not passed."""
    wanted = set(mentions)
    states: dict[Mention, MentionState] = {}
    card_ids = {mid for kind, mid in wanted if kind == "card"}
    if card_ids:
        rows = (
            await db.execute(
                select(Card.id, Card.name, Card.type, Card.status).where(
                    Card.id.in_([uuid.UUID(mid) for mid in card_ids])
                )
            )
        ).all()
        scope = read_scope if read_scope is not None else await CardReadScope.load(db, user)
        for row in rows:
            if not scope.readable(row.id, row.type, mode="module"):
                states[("card", str(row.id))] = restricted()
            else:
                states[("card", str(row.id))] = resolved(
                    f"@{row.name}", archived=row.status == "ARCHIVED"
                )
    decision_ids = {mid for kind, mid in wanted if kind == "decision"}
    if decision_ids:
        if not await PermissionService.check_permission(db, user, "adr.view"):
            for mid in decision_ids:
                states[("decision", mid)] = restricted()
        else:
            reg = register if register is not None else await ds.load_register(db)
            for mid in decision_ids:
                key = uuid.UUID(mid)
                if key in reg:
                    current = reg.row(reg.chain(key).current.id)
                    states[("decision", mid)] = resolved(
                        decision_label(
                            current.reference_number, current.revision_number, current.title
                        )
                    )
    user_ids = {mid for kind, mid in wanted if kind == "user"}
    if user_ids:
        people = await db.execute(
            select(User.id, User.display_name).where(
                User.id.in_([uuid.UUID(mid) for mid in user_ids])
            )
        )
        for uid, name in people.all():
            states[("user", str(uid))] = resolved(f"@{name}")
    return states


def render_for(html: Any, states: Mapping[Mention, MentionState], scope_id: Any) -> Any:
    """``html`` rendered from precomputed ``states``; a restricted mention
    takes the token of (``scope_id``, kind, id), an unknown one is missing."""

    def resolve(kind: str, mention_id: str) -> MentionState:
        state = states.get((kind, mention_id), MISSING_STATE)
        if state.status == RESTRICTED:
            return restricted(token_for(scope_id, kind, mention_id))
        return state

    return render(html, resolve)


async def resolve_for_reader(
    db: AsyncSession,
    *,
    doc_kind: str,
    payloads: list[dict[str, Any]],
    user: User,
    read_scope: CardReadScope | None,
    register: ds.Register | None = None,
) -> list[dict[str, Any]]:
    """The response payloads with every mention rendered for ``user``, in one
    batch (see the module doc). Each payload's ``id`` is its document's id —
    the scope of its tokens. No mention anywhere: ``payloads`` itself, no
    query."""
    if not any(has_marker(doc_kind, payload) for payload in payloads):
        return payloads
    mentions: set[Mention] = set()
    for payload in payloads:
        mentions |= mentions_of(doc_kind, payload)
    states = await mention_states(db, mentions, user=user, read_scope=read_scope, register=register)
    out = []
    for payload in payloads:
        if not has_marker(doc_kind, payload):
            out.append(payload)
            continue
        render_text = functools.partial(render_for, states=states, scope_id=payload["id"])
        rendered = dict(payload)
        for field in text_fields_of(doc_kind):
            if field in payload:
                rendered[field] = map_field(doc_kind, payload[field], render_text)
        out.append(rendered)
    return out


# --- "Mentioned in" -----------------------------------------------------------------


def marker_of(kind: str, target_id: Any) -> str:
    """The canonical substring that names a mention of ``target_id``."""
    return f'data-kind="{kind}" data-id="{str(target_id).lower()}"'


_DECISION_TEXT_COLUMNS = (
    ArchitectureDecision.context,
    ArchitectureDecision.decision,
    ArchitectureDecision.consequences,
    ArchitectureDecision.alternatives_considered,
)

TEXT = "text"
COMMENT = "comment"


def mentions_any(texts: Iterable[Any], wanted: set[Mention]) -> bool:
    """Whether one of ``texts`` holds a real mention (parsed, not a substring)
    of one of ``wanted``: the confirmation of a ``LIKE`` hit."""
    return any(mention in wanted for text in texts for mention in iter_mentions(text))


def pick_revision(
    current: Any, open_revision: Any, hits: Mapping[str, set[Any]]
) -> tuple[Any, str] | None:
    """The revision of one chain a "Mentioned in" entry names, and how.

    Only the chain's ``current`` revision and its ``open_revision`` (the draft
    being written) count: a mention left only in an earlier revision is gone
    from the document. Text before comment, then current before open; ``None``
    when neither holds the mention.
    """
    for how in (TEXT, COMMENT):
        for revision in (current, open_revision):
            if revision is not None and revision in hits[how]:
                return revision, how
    return None


def _sections_of(sections: Any):
    """``SoAW.sections`` when it is a JSON object, else an empty one, so
    ``jsonb_each`` never meets a ``null``, an array or a scalar."""
    return case(
        (func.jsonb_typeof(sections) == "object", sections),
        else_=cast(literal("{}"), JSONB),
    )


def _section_mentions(needle: str):
    """``EXISTS`` a SoAW section whose ``content`` holds ``needle`` (searched
    per section: the JSON text of ``sections`` escapes the quotes)."""
    section = func.jsonb_each(_sections_of(SoAW.sections)).table_valued(
        column("key", Text), column("value", JSONB)
    )
    return exists(
        select(literal(1))
        .select_from(section)
        .where(section.c.value["content"].astext.contains(needle, autoescape=True))
    )


async def _comment_hits(
    db: AsyncSession, owner: Any, needles: list[str], wanted: set[Mention]
) -> set[Any]:
    """The documents (by ``owner`` column) whose live comments mention ``wanted``."""
    rows = await db.execute(
        select(owner, DocumentComment.body).where(
            owner.is_not(None),
            DocumentComment.deleted_at.is_(None),
            or_(*(DocumentComment.body.contains(n, autoescape=True) for n in needles)),
        )
    )
    return {doc_id for doc_id, body in rows.all() if mentions_any([body], wanted)}


async def _decisions_mentioning(
    db: AsyncSession,
    needles: list[str],
    wanted: set[Mention],
    register: ds.Register,
    *,
    skip: set[Any],
) -> list[dict[str, Any]]:
    """Each decision chain whose current or open revision mentions
    ``wanted`` in its text or discussion, once, naming that revision
    (:func:`pick_revision`). ``needles`` only narrow the search: every hit is
    parsed before it counts."""
    rows = await db.execute(
        select(ArchitectureDecision.id, *_DECISION_TEXT_COLUMNS).where(
            or_(
                *(
                    col.contains(needle, autoescape=True)
                    for col in _DECISION_TEXT_COLUMNS
                    for needle in needles
                )
            )
        )
    )
    hits = {
        TEXT: {row[0] for row in rows.all() if mentions_any(row[1:], wanted)},
        COMMENT: await _comment_hits(db, DocumentComment.architecture_decision_id, needles, wanted),
    }
    via: dict[Any, str] = {}
    seen: set[Any] = set()
    for hit in sorted(hits[TEXT] | hits[COMMENT], key=str):
        if hit not in register or hit in skip:
            continue
        chain = register.chain(hit)
        if chain.current.id in seen:
            continue
        seen.add(chain.current.id)
        open_id = chain.open_revision.id if chain.open_revision is not None else None
        picked = pick_revision(chain.current.id, open_id, hits)
        if picked is not None:
            via[picked[0]] = picked[1]
    return mentioned_decision_rows(register, via)


def mentioned_decision_rows(register: ds.Register, via: Mapping[Any, str]) -> list[dict[str, Any]]:
    """The ``decisions`` rows of a "Mentioned in" answer, by reference."""
    rows = []
    for decision_id, how in via.items():
        row = register.row(decision_id)
        standing = register.get(decision_id)
        rows.append(
            {
                "id": str(row.id),
                "reference_number": row.reference_number,
                "revision_number": row.revision_number,
                "title": row.title,
                "status": row.status,
                "standing": standing.standing if standing is not None else None,
                "via": how,
            }
        )
    return sorted(rows, key=lambda r: (r["reference_number"], r["revision_number"]))


async def _soaws_mentioning(
    db: AsyncSession, needles: list[str], wanted: set[Mention]
) -> list[dict[str, Any]]:
    """Each SoAW chain whose current or open revision mentions ``wanted`` in
    its sections or discussion, once, naming that revision. ``needles`` only
    narrow the search: every hit is parsed before it counts."""
    rows = await db.execute(
        select(SoAW.id, SoAW.sections).where(or_(*(_section_mentions(n) for n in needles)))
    )
    hits = {
        TEXT: {
            soaw_id
            for soaw_id, sections in rows.all()
            if mentions_any(field_texts("soaw", "sections", sections), wanted)
        },
        COMMENT: await _comment_hits(db, DocumentComment.soaw_id, needles, wanted),
    }
    if not hits[TEXT] and not hits[COMMENT]:
        return []
    chains = await soaw_service.load_chains(db)
    picked_rows: dict[Any, Any] = {}
    for hit in hits[TEXT] | hits[COMMENT]:
        chain = chains.chain(hit)
        if chain is None:
            continue
        open_id = chain.open_revision.id if chain.open_revision is not None else None
        picked = pick_revision(chain.current.id, open_id, hits)
        if picked is not None:
            picked_rows[picked[0]] = chains.rows[picked[0]]
    return [
        {"id": str(r.id), "name": r.name, "revision_number": r.revision_number, "status": r.status}
        for r in sorted(picked_rows.values(), key=lambda r: (r.name, r.revision_number, str(r.id)))
    ]


async def _mentioned_in(
    db: AsyncSession,
    wanted: set[Mention],
    *,
    user: User,
    may_view_decisions: bool,
    register: ds.Register | None = None,
    skip: Iterable[Any] = (),
) -> dict[str, list[dict[str, Any]]]:
    needles = sorted(marker_of(kind, target) for kind, target in wanted)
    decisions: list[dict[str, Any]] = []
    if may_view_decisions:
        reg = register if register is not None else await ds.load_register(db)
        decisions = await _decisions_mentioning(db, needles, wanted, reg, skip=set(skip))
    soaws: list[dict[str, Any]] = []
    if await PermissionService.check_permission(db, user, "soaw.view"):
        soaws = await _soaws_mentioning(db, needles, wanted)
    return {"decisions": decisions, "soaws": soaws}


async def mentioned_in_card(
    db: AsyncSession, card_id: uuid.UUID, *, user: User
) -> dict[str, list[dict[str, Any]]]:
    """The decisions (with ``adr.view``) and SoAWs (with ``soaw.view``) that
    mention the card. The caller has checked the card is readable."""
    return await _mentioned_in(
        db,
        {("card", str(card_id).lower())},
        user=user,
        may_view_decisions=await PermissionService.check_permission(db, user, "adr.view"),
    )


async def mentioned_in_decision(
    db: AsyncSession, decision_id: uuid.UUID, *, user: User
) -> dict[str, list[dict[str, Any]]]:
    """The decisions and SoAWs that mention any revision of the decision's
    chain; the chain itself is left out. The caller holds ``adr.view``."""
    register = await ds.load_register(db)
    chain_ids = [node.id for node in register.chain(decision_id).nodes]
    return await _mentioned_in(
        db,
        {("decision", str(rid).lower()) for rid in chain_ids},
        user=user,
        may_view_decisions=True,
        register=register,
        skip=set(chain_ids),
    )
