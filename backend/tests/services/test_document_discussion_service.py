"""The pure rules of the discussion of decisions and SoAWs
(``app/services/document_discussion_service.py``): no database.

- who is a signatory of a revision (current entries and every review round,
  a recalled or rejected one included);
- the permission matrix as exact truth tables (post, edit, delete, resolve);
- what counts as an open thread;
- section tags;
- the comment HTML allowlist against hostile input, and system bodies;
- notification recipients, texts and links;
- the thread payload.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import document_discussion_service as svc
from app.services import mention_service, notification_service

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
U2 = uuid.UUID("00000000-0000-4000-8000-000000000002")
U3 = uuid.UUID("00000000-0000-4000-8000-000000000003")
U4 = uuid.UUID("00000000-0000-4000-8000-000000000004")
DOC = uuid.UUID("00000000-0000-4000-8000-0000000000d0")
OTHER = uuid.UUID("00000000-0000-4000-8000-0000000000d1")
CARD = "00000000-0000-4000-8000-0000000000c1"
NOW = datetime(2026, 11, 10, 9, 30, tzinfo=timezone.utc)


def _c(
    *,
    kind: str = "comment",
    author=U1,
    parent=None,
    deleted=None,
    resolved=None,
    resolved_by=None,
    owner=DOC,
    cid=None,
    body="<p>Hi</p>",
    section=None,
    edited=None,
):
    return SimpleNamespace(
        id=cid or uuid.uuid4(),
        kind=kind,
        author_id=author,
        author_name="Snapshot",
        parent_id=parent,
        deleted_at=deleted,
        resolved_at=resolved,
        resolved_by=resolved_by,
        architecture_decision_id=owner,
        soaw_id=None,
        body=body,
        section=section,
        created_at=NOW,
        edited_at=edited,
    )


def _round(*user_ids, kind="sent_for_review"):
    return SimpleNamespace(
        kind=kind, signatories=[{"user_id": str(u), "display_name": "x"} for u in user_ids]
    )


# ---------------------------------------------------------------------------
# Signatories
# ---------------------------------------------------------------------------


class TestSignatories:
    def test_current_entries_and_review_rounds(self):
        current = [{"user_id": str(U1), "status": "pending"}, "junk", {"display_name": "nobody"}]
        rows = [_round(U2), _round(U3, kind="signature"), {"kind": "sent_for_review"}]
        assert svc.signatory_ids(current, rows) == {str(U1), str(U2)}
        assert svc.signatory_ids(None, []) == set()

    def test_a_recalled_round_keeps_the_right(self):
        # Recall cleared the entries; the sent_for_review row is still there.
        rows = [_round(U2), SimpleNamespace(kind="recalled", signatories=None)]
        assert svc.is_signatory(U2, [], rows) is True
        assert svc.is_signatory(U3, [], rows) is False

    def test_a_rejected_round_keeps_the_right(self):
        rows = [
            {"kind": "sent_for_review", "signatories": [{"user_id": str(U3)}]},
            {"kind": "rejected", "signatories": None},
            {"kind": "sent_for_review", "signatories": [{"user_id": str(U4)}]},
        ]
        assert svc.is_signatory(U3, None, rows) is True
        assert svc.is_signatory(U4, None, rows) is True
        assert svc.is_signatory(U1, None, rows) is False

    def test_only_review_rows_name_signatories(self):
        # A row of another kind carrying signatories does not count.
        assert svc.is_signatory(U2, None, [_round(U2, kind="signature")]) is False
        assert svc.is_signatory(str(U1), [{"user_id": str(U1)}], []) is True


# ---------------------------------------------------------------------------
# The permission matrix
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "holds, signatory, expected",
    [(True, True, True), (True, False, True), (False, True, True), (False, False, False)],
)
def test_can_comment(holds, signatory, expected):
    assert svc.can_comment(holds_comment=holds, signatory=signatory) is expected


@pytest.mark.parametrize("holds, expected", [(True, True), (False, False)])
def test_can_moderate(holds, expected):
    assert svc.can_moderate(holds_manage=holds) is expected


def test_post_refusal():
    assert svc.post_refusal(may_comment=True) is None
    assert svc.post_refusal(may_comment=False) == (403, "You may not comment on this document")


# (kind, author is the user, deleted, may_comment) → refusal
EDIT_TABLE = [
    ("comment", True, False, True, None),
    ("comment", True, False, False, (403, "You may not comment on this document")),
    ("comment", False, False, True, (403, "Only the author may edit a comment")),
    ("comment", True, True, True, (409, "This comment has been deleted")),
    ("comment", False, True, True, (409, "This comment has been deleted")),
    (
        "sign_note",
        True,
        False,
        True,
        (403, "A signing note or a rejection reason cannot be edited"),
    ),
    (
        "rejection",
        True,
        False,
        True,
        (403, "A signing note or a rejection reason cannot be edited"),
    ),
    ("rejection", True, True, True, (409, "This comment has been deleted")),
]


@pytest.mark.parametrize("kind, mine, deleted, may_comment, expected", EDIT_TABLE)
def test_edit_truth_table(kind, mine, deleted, may_comment, expected):
    comment = _c(kind=kind, author=U1 if mine else U2, deleted=NOW if deleted else None)
    assert svc.edit_refusal(comment, U1, may_comment=may_comment) == expected
    assert svc.may_edit(comment, U1, may_comment=may_comment) is (expected is None)


def test_a_comment_without_author_is_nobodys_to_edit():
    assert svc.may_edit(_c(author=None), U1) is False
    assert svc.may_edit(_c(author=U1), U1) is True


# (kind, author is the user, moderate, deleted) → refusal
DELETE_TABLE = [
    ("comment", True, False, False, None),
    ("comment", True, True, False, None),
    ("comment", False, True, False, None),
    ("comment", False, False, False, (403, "Only the author or an editor may delete a comment")),
    ("comment", True, True, True, (409, "This comment has already been deleted")),
    ("rejection", True, False, False, None),
    ("rejection", False, True, False, (403, "A rejection reason is resolved, not deleted")),
    ("rejection", False, False, False, (403, "Only the author or an editor may delete a comment")),
    ("sign_note", True, False, False, None),
    ("sign_note", False, True, False, (403, "Only the author or an editor may delete a comment")),
    ("sign_note", False, False, True, (409, "This comment has already been deleted")),
]


@pytest.mark.parametrize("kind, mine, moderate, deleted, expected", DELETE_TABLE)
def test_delete_truth_table(kind, mine, moderate, deleted, expected):
    comment = _c(kind=kind, author=U1 if mine else U2, deleted=NOW if deleted else None)
    assert svc.delete_refusal(comment, U1, moderate=moderate) == expected
    assert svc.may_delete(comment, U1, moderate) is (expected is None)


# (kind, reply, deleted, may_comment) → refusal
RESOLVE_TABLE = [
    ("comment", False, False, True, None),
    ("rejection", False, False, True, None),
    ("comment", False, False, False, (403, "You may not comment on this document")),
    ("comment", True, False, True, (400, "Only a thread can be resolved or reopened")),
    ("sign_note", False, False, True, (400, "A signing note is not a thread to resolve")),
    ("comment", False, True, True, (409, "This comment has been deleted")),
    ("rejection", True, True, False, (403, "You may not comment on this document")),
]


@pytest.mark.parametrize("kind, reply, deleted, may_comment, expected", RESOLVE_TABLE)
def test_resolve_truth_table(kind, reply, deleted, may_comment, expected):
    comment = _c(kind=kind, parent=OTHER if reply else None, deleted=NOW if deleted else None)
    assert svc.resolve_refusal(comment, may_comment=may_comment) == expected
    assert svc.may_resolve(comment, may_comment=may_comment) is (expected is None)


# (thread top deleted, may_comment) → refusal
REPLY_TABLE = [
    (False, True, None),
    (True, True, (409, "This thread's first comment was deleted")),
    (False, False, (403, "You may not comment on this document")),
    # The comment right is checked first, closed thread or not.
    (True, False, (403, "You may not comment on this document")),
]


@pytest.mark.parametrize("deleted, may_comment, expected", REPLY_TABLE)
def test_reply_truth_table(deleted, may_comment, expected):
    top = _c(deleted=NOW if deleted else None)
    assert svc.reply_refusal(top, may_comment=may_comment) == expected


def test_the_closed_message():
    assert svc.THREAD_CLOSED == "This thread's first comment was deleted"


def test_thread_closed():
    assert svc.thread_closed(_c()) is False
    assert svc.thread_closed(_c(deleted=NOW)) is True


def test_comment_can():
    mine = _c(author=U1)
    assert svc.comment_can(mine, U1, may_comment=True, moderate=False) == {
        "edit": True,
        "delete": True,
        "resolve": True,
    }
    theirs = _c(author=U2)
    assert svc.comment_can(theirs, U1, may_comment=False, moderate=True) == {
        "edit": False,
        "delete": True,
        "resolve": False,
    }
    reply = _c(author=U2, parent=OTHER, kind="comment")
    assert svc.comment_can(reply, U1, may_comment=True, moderate=False) == {
        "edit": False,
        "delete": False,
        "resolve": False,
    }


# ---------------------------------------------------------------------------
# Open threads
# ---------------------------------------------------------------------------


def test_open_count():
    threads = [
        _c(),  # open
        _c(kind="rejection"),  # open
        _c(kind="sign_note"),  # never open
        _c(resolved=NOW),
        _c(deleted=NOW),
        _c(parent=OTHER),  # a reply is not a thread
        _c(kind="rejection", resolved=NOW),
    ]
    assert [svc.is_open(t) for t in threads] == [True, True, False, False, False, False, False]
    assert svc.open_count(threads) == 2
    assert svc.open_count([]) == 0


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------


class TestSections:
    @pytest.mark.parametrize(
        "section",
        ["general", "context", "decision", "consequences", "alternatives_considered", None],
    )
    def test_decision_sections(self, section):
        assert svc.validate_section("adr", section) == section

    @pytest.mark.parametrize("section", ["Context", "1.1", "", "custom_x", "general "])
    def test_decision_refuses_others(self, section):
        with pytest.raises(HTTPException) as exc:
            svc.validate_section("adr", section)
        assert (exc.value.status_code, exc.value.detail) == (400, "Unknown section")

    @pytest.mark.parametrize(
        "section", ["1.1", "3.2", "general", "custom_7", "a" * 64, "x", "9", None]
    )
    def test_soaw_sections(self, section):
        assert svc.validate_section("soaw", section) == section

    @pytest.mark.parametrize("section", ["", "a" * 65, "Upper", "a-b", "a b", "a\n", "1/2"])
    def test_soaw_refuses_others(self, section):
        with pytest.raises(HTTPException) as exc:
            svc.validate_section("soaw", section)
        assert (exc.value.status_code, exc.value.detail) == (400, "Unknown section")

    def test_unknown_kind(self):
        with pytest.raises(ValueError, match="Unknown document kind 'risk'"):
            svc.validate_section("risk", None)


# ---------------------------------------------------------------------------
# Comment HTML
# ---------------------------------------------------------------------------


def span(kind, mention_id, label=""):
    return f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}">{label}</span>'


class TestCommentHtml:
    def test_the_allowlist_is_kept_attribute_free(self):
        body = (
            "<P>One <strong>two</strong> <em>three</em> <s>four</s> <code>x</code><br/>"
            "<BR></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>"
        )
        assert svc.comment_html(body) == (
            "<p>One <strong>two</strong> <em>three</em> <s>four</s> <code>x</code><br>"
            "<br></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>"
        )

    def test_a_script_is_text(self):
        assert svc.comment_html("<p><script>alert(1)</script></p>") == (
            "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
        )

    def test_an_img_with_onerror_is_text(self):
        assert svc.comment_html("<img src=x onerror=alert(1)>hi") == (
            "&lt;img src=x onerror=alert(1)&gt;hi"
        )

    def test_attributes_turn_an_allowed_tag_into_text(self):
        assert svc.comment_html('<p style="color:red" onclick="x()">hi</p>') == (
            '&lt;p style="color:red" onclick="x()"&gt;hi</p>'
        )
        assert svc.comment_html("<p/>hi") == "&lt;p/&gt;hi"
        assert svc.comment_html("hi</br>") == "hi&lt;/br&gt;"

    @pytest.mark.parametrize(
        "href",
        [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            " javascript:alert(1)",
            "java&#x09;script:alert(1)",
            "data:text/html,x",
            "vbscript:x",
            "/relative",
            "https://a b",
            "",
        ],
    )
    def test_an_unsafe_link_is_text(self, href):
        out = svc.comment_html(f'<p><a href="{href}">x</a></p>')
        assert out.startswith("<p>&lt;a href=")
        assert out.endswith("x&lt;/a&gt;</p>")
        assert "<a" not in out

    def test_a_safe_link_keeps_only_its_href(self):
        body = (
            '<a target="_blank" rel="noopener" href="https://example.com/?a=1&amp;b=&quot;2&quot;"'
            ' class="x">site</a> <A HREF=mailto:me@example.com>mail</A> '
            "<a href='http://x.test'>plain</a>"
        )
        assert svc.comment_html(body) == (
            '<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">site</a> '
            '<a href="mailto:me@example.com">mail</a> <a href="http://x.test">plain</a>'
        )

    def test_links_stay_balanced(self):
        assert svc.comment_html('<a href="https://x.test">open') == (
            '<a href="https://x.test">open</a>'
        )
        assert svc.comment_html("stray</a>") == "stray&lt;/a&gt;"
        assert svc.comment_html("<a>no href</a>") == "&lt;a&gt;no href&lt;/a&gt;"

    @pytest.mark.parametrize(
        "attrs",
        [
            ' href="https://x.test" href="https://y.test"',
            ' href="https://x.test"junk',
            " href",
        ],
    )
    def test_a_malformed_or_repeated_href_is_refused(self, attrs):
        assert svc.safe_href(attrs) is None

    def test_safe_href(self):
        assert svc.safe_href(' href="https://x.test" /') == "https://x.test"
        assert svc.safe_href(" href = 'MAILTO:a@b.c' ") == "MAILTO:a@b.c"
        assert svc.safe_href(' title="t"') is None

    def test_text_entities_are_normalised(self):
        assert svc.comment_html("<p>a &amp; b &lt; c &gt; d &quot;e&quot; & f</p>") == (
            '<p>a &amp; b &lt; c &gt; d "e" &amp; f</p>'
        )
        assert svc.comment_html("a < b") == "a &lt; b"

    def test_mentions_are_canonical_and_people_allowed(self):
        body = f"<p>{span('user', U2, '@Two')} {span('card', CARD.upper(), '@CRM')}</p>"
        assert svc.comment_html(body) == (
            f'<p><span data-type="mention" data-kind="user" data-id="{U2}"></span> '
            f'<span data-type="mention" data-kind="card" data-id="{CARD}"></span></p>'
        )

    def test_a_malformed_mention_collapses_to_text(self):
        body = (
            f'<span data-type="mention" data-kind="card" data-id="{CARD}" onclick="x">'
            "<b>@CRM</b></span>"
        )
        assert svc.comment_html(body) == "@CRM"

    def test_nested_mention_spans_leave_no_markup(self):
        # The inner span is part of the outer one's label, which is dropped.
        inner = span("card", CARD, "@CRM")
        body = f'<span data-type="mention" data-kind="user" data-id="{U2}">{inner}</span>'
        assert svc.comment_html(body) == (
            f'<span data-type="mention" data-kind="user" data-id="{U2}"></span>'
        )

    def test_a_plain_span_is_text(self):
        assert svc.comment_html('<span class="x">y</span>') == (
            '&lt;span class="x"&gt;y&lt;/span&gt;'
        )

    @pytest.mark.parametrize("body", ["", "   ", "<p></p>", "<p>&nbsp;</p><p><br></p>", "<p> </p>"])
    def test_a_blank_body_is_refused(self, body):
        with pytest.raises(HTTPException) as exc:
            svc.comment_html(body)
        assert (exc.value.status_code, exc.value.detail) == (400, "A comment needs some text")

    def test_blank_allowed_when_asked(self):
        assert svc.comment_html("<p></p>", allow_empty=True) == "<p></p>"
        assert svc.comment_html("", allow_empty=True) == ""

    def test_a_lone_mention_is_not_blank(self):
        assert svc.is_blank(span("card", CARD)) is False
        assert svc.is_blank("<p>x</p>") is False
        assert svc.is_blank("<p>\xa0</p>") is True

    def test_the_stored_body_is_capped(self):
        at_cap = "x" * svc.BODY_MAX_LENGTH
        assert svc.comment_html(at_cap) == at_cap
        with pytest.raises(HTTPException) as exc:
            svc.comment_html(at_cap + "y")
        assert (exc.value.status_code, exc.value.detail) == (
            400,
            "A comment is longer than 20000 characters",
        )
        # Escaping counts: 4,000 "<" become 16,000 characters, 5,001 become 20,004.
        assert len(svc.comment_html("<" * 4000)) == 16000
        with pytest.raises(HTTPException):
            svc.comment_html("<" * 5001)


def test_plain_to_html():
    assert svc.plain_to_html("Needs <numbers> & more\n\n  \nSecond") == (
        "<p>Needs &lt;numbers&gt; &amp; more</p><p>Second</p>"
    )
    assert svc.plain_to_html('Say "no"') == '<p>Say "no"</p>'
    assert svc.plain_to_html("") == ""
    assert svc.plain_to_html(None) == ""
    assert svc.plain_to_html("   ") == ""


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class TestRecipients:
    def test_everyone_once_minus_actor_and_mentioned(self):
        got = svc.comment_recipients(
            creator_id=U1,
            signatories={str(U2), str(U3)},
            people=[U3, U4],
            commenters=[U1, U2],
            actor_id=U2,
            mentioned=[str(U4)],
        )
        assert got == {str(U1), str(U3)}

    def test_a_signatory_without_an_account_is_nobody_to_notify(self):
        """The demo seeds signatories named ``demo-sig-…``: commenting on such a
        document must not try to read them as user ids."""
        got = svc.comment_recipients(
            creator_id=U1,
            signatories={"demo-sig-enterprise-architect", str(U3), ""},
            people=[],
            commenters=[],
            actor_id=U2,
            mentioned=[],
        )
        assert got == {str(U1), str(U3)}

    def test_nobody(self):
        assert (
            svc.comment_recipients(
                creator_id=None,
                signatories=set(),
                people=[],
                commenters=[],
                actor_id=U1,
                mentioned=[],
            )
            == set()
        )

    def test_the_actor_alone(self):
        assert (
            svc.comment_recipients(
                creator_id=U1,
                signatories={str(U1)},
                people=[U1],
                commenters=[U1],
                actor_id=U1,
                mentioned=[],
            )
            == set()
        )

    def test_new_user_mentions(self):
        stored = f"<p>{span('user', U2)}</p>"
        new = (
            f"<p>{span('user', U3)}{span('user', U2)}{span('card', CARD)}"
            f"{span('user', U3)}{span('user', U1)}{span('user', U4)}</p>"
        )
        assert svc.new_user_mentions(stored, new, actor_id=U1) == [str(U3), str(U4)]
        assert svc.new_user_mentions(None, new, actor_id=U4) == [str(U3), str(U2), str(U1)]
        assert svc.new_user_mentions(new, new, actor_id=U1) == []

    def test_texts_never_carry_the_comment(self):
        assert svc.notification_texts(
            "document_comment", doc_label="ADR-001 — X", actor_name="Ada", reply=False
        ) == ('New comment on "ADR-001 — X"', 'Ada commented on "ADR-001 — X"')
        assert svc.notification_texts(
            "document_comment", doc_label="Plan", actor_name="Ada", reply=True
        ) == ('New reply on "Plan"', 'Ada replied on "Plan"')
        assert svc.notification_texts(
            "document_mention", doc_label="Plan", actor_name="Ada", reply=True
        ) == ('Mentioned on "Plan"', 'Ada mentioned you in the discussion of "Plan"')

    def test_link_and_label(self):
        assert svc.thread_link("adr", DOC, OTHER) == (
            f"/ea-delivery/adr/{DOC}/preview?thread={OTHER}"
        )
        assert svc.thread_link("soaw", DOC, OTHER) == (
            f"/ea-delivery/soaw/{DOC}/preview?thread={OTHER}"
        )
        decision = SimpleNamespace(reference_number="ADR-007", revision_number=2, title="Go")
        assert svc.document_label("adr", decision) == "ADR-007 · Rev 2 — Go"
        soaw = SimpleNamespace(name="Plan", revision_number=3)
        assert svc.document_label("soaw", soaw) == "Plan (Rev 3)"


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------


class TestPayload:
    def test_one_comment(self):
        comment = _c(
            author=U1,
            resolved=NOW,
            resolved_by=U2,
            edited=NOW,
            section="context",
            body="<p>stored</p>",
        )
        names = {str(U1): "Ada", str(U2): "Bo"}
        out = svc.comment_payload(
            comment, revision_number=2, names=names, body="<p>rendered</p>", can={"edit": True}
        )
        assert out == {
            "id": str(comment.id),
            "kind": "comment",
            "section": "context",
            "revision_id": str(DOC),
            "revision_number": 2,
            "author": {"id": str(U1), "display_name": "Ada"},
            "author_name": "Snapshot",
            "body": "<p>rendered</p>",
            "created_at": NOW.isoformat(),
            "edited_at": NOW.isoformat(),
            "deleted": False,
            "resolved_at": NOW.isoformat(),
            "resolved_by": {"id": str(U2), "display_name": "Bo"},
            "can": {"edit": True},
        }

    def test_a_deleted_comment_and_gone_people(self):
        comment = _c(author=U3, deleted=NOW, body="")
        comment.soaw_id, comment.architecture_decision_id = OTHER, None
        out = svc.comment_payload(comment, revision_number=1, names={}, body="x", can={})
        assert (out["body"], out["deleted"], out["author"], out["resolved_by"]) == (
            "",
            True,
            None,
            None,
        )
        assert out["revision_id"] == str(OTHER)
        assert (out["edited_at"], out["resolved_at"]) == (None, None)

    def test_threads_group_replies_under_their_top(self):
        top1 = _c(author=U1, cid=U1)
        top2 = _c(author=U2, cid=U2, owner=OTHER)
        reply = _c(author=U2, parent=U1)
        orphan = _c(author=U2, parent=U4)
        threads = svc.build_threads(
            [top1, reply, top2, orphan],
            user_id=U1,
            revision_numbers={str(DOC): 2, str(OTHER): 1},
            may_comment={str(DOC): True, str(OTHER): False},
            moderate=False,
            names={str(U1): "Ada"},
            render=lambda c: c.body.upper(),
        )
        assert [
            (t["id"], t["revision_number"], [r["id"] for r in t["replies"]]) for t in threads
        ] == [
            (str(U1), 2, [str(reply.id)]),
            (str(U2), 1, []),
        ]
        assert threads[0]["body"] == "<P>HI</P>"
        assert threads[0]["can"] == {"edit": True, "delete": True, "resolve": True}
        assert threads[1]["can"] == {"edit": False, "delete": False, "resolve": False}
        assert "replies" not in threads[0]["replies"][0]
        assert threads[0]["replies"][0]["can"] == {"edit": False, "delete": False, "resolve": False}


def test_build_threads_keeps_a_deleted_thread():
    closed = _c(cid=U1, deleted=NOW, body="")
    gone_reply = _c(parent=U1, deleted=NOW, body="")
    bare = _c(cid=U2, deleted=NOW, body="")
    threads = svc.build_threads(
        [closed, gone_reply, bare],
        user_id=U1,
        revision_numbers={str(DOC): 1},
        may_comment={str(DOC): True},
        moderate=True,
        names={},
        render=lambda c: c.body,
    )
    assert [(t["id"], t["deleted"], len(t["replies"])) for t in threads] == [
        (str(U1), True, 1),
        (str(U2), True, 0),
    ]


def test_token_scope_is_the_comment():
    # A restricted chip in a comment carries the comment's token, so a chip
    # copied from the document (document-scoped token) means nothing here.
    comment_id, doc_id = uuid.uuid4(), uuid.uuid4()
    assert mention_service.token_for(comment_id, "card", CARD) != mention_service.token_for(
        doc_id, "card", CARD
    )


# --- hostile bodies: the raw cap first, every pattern linear ------------------------

HOSTILE_BODIES = {
    "span-100k": "<span" * 20000 + ' data-type="mention" ',
    "spaced-span-100k": "<span " * 16666 + 'data-type="mention"',
    "lt-100k": "<" * 100000,
}


@pytest.mark.parametrize("body", HOSTILE_BODIES.values(), ids=list(HOSTILE_BODIES))
def test_an_over_long_body_is_refused_before_it_is_read(body, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("the body was read")

    monkeypatch.setattr(mention_service, "canonicalise", boom)
    started = time.perf_counter()
    with pytest.raises(HTTPException) as refused:
        svc.comment_html(body)
    assert (refused.value.status_code, refused.value.detail) == (
        400,
        "A comment is longer than 20000 characters",
    )
    assert time.perf_counter() - started < 2.0


def test_the_raw_cap_is_twice_the_stored_one():
    assert (svc.BODY_MAX_LENGTH, svc.RAW_BODY_MAX_LENGTH) == (20_000, 40_000)
    svc.check_raw_length("x" * 40_000)
    with pytest.raises(HTTPException):
        svc.check_raw_length("x" * 40_001)


def test_hostile_markup_under_the_cap_is_read_in_linear_time():
    started = time.perf_counter()
    assert svc.is_blank("<" * 100000) is False
    assert svc._markup("<" * 100000, svc._Links()) == "&lt;" * 100000
    assert svc.safe_href(" " * 30000 + '"') is None
    for body in ("<span" * 7999 + ' data-type="mention" ', '<span data-type="mention">' * 1500):
        with pytest.raises(HTTPException):
            svc.comment_html(body)
    assert time.perf_counter() - started < 2.0


def test_a_mention_span_outside_the_grammar_is_stored_canonical():
    body = f"<p><SPAN data-type='mention' data-kind='card' data-id='{CARD}'>@Fake</SPAN></p>"
    assert svc.comment_html(body) == f"<p>{span('card', CARD)}</p>"
    assert svc.comment_html(svc.comment_html(body)) == svc.comment_html(body)


# --- notifications are batches delivered after the commit ----------------------------


def test_deliveries_for_builds_one_batch_per_type_with_someone_to_tell():
    texts = {"document_mention": ("Tm", "Mm"), "document_comment": ("Tc", "Mc")}
    data = {"doc_kind": "adr", "doc_id": "d"}
    out = svc.deliveries_for(
        mentioned=[str(U2), str(U1)],
        audience={str(U4), str(U3)},
        texts=texts,
        link="/l",
        data=data,
    )

    def row(user, title, message):
        return {"user_id": user, "title": title, "message": message, "link": "/l", "data": data}

    assert out == (
        svc.Delivery("document_mention", (row(U2, "Tm", "Mm"), row(U1, "Tm", "Mm"))),
        svc.Delivery("document_comment", (row(U3, "Tc", "Mc"), row(U4, "Tc", "Mc"))),
    )
    only_comment = svc.deliveries_for(
        mentioned=[], audience={str(U1)}, texts=texts, link="/l", data=data
    )
    assert [d.notif_type for d in only_comment] == ["document_comment"]
    assert svc.deliveries_for(mentioned=[], audience=set(), texts=texts, link="/l", data={}) == ()


def test_schedule_deliveries_hands_each_batch_to_the_batch_helper():
    class Tasks:
        def __init__(self):
            self.added = []

        def add_task(self, fn, *args, **kwargs):
            self.added.append((fn, args, kwargs))

    tasks = Tasks()
    recipient = {"user_id": U2, "title": "T", "message": "M", "link": "/l", "data": {}}
    svc.schedule_deliveries(
        tasks,
        (
            svc.Delivery("document_mention", (recipient,)),
            svc.Delivery("document_comment", (recipient, recipient)),
        ),
        actor_id=U1,
    )
    helper = notification_service.deliver_notification_batch
    assert tasks.added == [
        (helper, ([recipient],), {"notif_type": "document_mention", "actor_id": U1}),
        (helper, ([recipient, recipient],), {"notif_type": "document_comment", "actor_id": U1}),
    ]
