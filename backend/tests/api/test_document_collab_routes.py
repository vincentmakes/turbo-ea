"""Collaboration on decisions and SoAWs, step 2: the timeline and the hook surface.

- The three new route modules answer with their first, read-only routes:
  discussion (``/adr/{id}/comments``, ``/soaw/{id}/comments``), timeline
  (``/adr/{id}/history``, ``/soaw/{id}/history``) and "mentioned in"
  (``/mentions/decisions/{id}``) — each behind the document's view
  permission, 404 for an unknown document.
- Every workflow step writes its timeline row, in order, in the request's
  transaction; ``created`` / ``revised`` come from the shared writers, so the
  importer gets them too.
- The hooks (``before_save``, ``after_save``, ``render_doc``) are called from
  each write and read path, ``render_doc`` once per response.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.document_history import DocumentHistoryEntry
from app.services import document_collab
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

ADR = "/api/v1/adr"
SOAW = "/api/v1/soaw"


@pytest.fixture(autouse=True)
def _deliveries_stay_in_the_test_session(patched_async_session):
    """A comment's notifications are delivered after the commit by
    ``deliver_notification_batch``, which opens its own session: hand it the
    test's, so it never reaches the real database."""


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="blind", label="Blind", permissions={"inventory.view": True})
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada")
    one = await create_user(db, email="one@test.com", role="member", display_name="One")
    two = await create_user(db, email="two@test.com", role="member", display_name="Two")
    viewer = await create_user(db, email="viewer@test.com", role="viewer", display_name="Vic")
    blind = await create_user(db, email="blind@test.com", role="blind", display_name="Bea")
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(db, card_type="Application", name="Billing", user_id=admin.id)
    users = {"admin": admin, "one": one, "two": two, "viewer": viewer, "blind": blind}
    return {
        "users": users,
        "card": card,
        "h": {k: auth_headers(u) for k, u in users.items()},
    }


async def _adr(client, env, title="Decision", **fields) -> dict:
    resp = await client.post(ADR, json={"title": title, **fields}, headers=env["h"]["admin"])
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _soaw(client, env, name="Plan", **fields) -> dict:
    resp = await client.post(SOAW, json={"name": name, **fields}, headers=env["h"]["admin"])
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _post(client, env, path, who="admin", json=None, status=200):
    resp = await client.post(path, json=json, headers=env["h"][who])
    assert resp.status_code == status, resp.text
    return resp.json()


async def _timeline(client, env, base, doc_id, who="admin") -> list[tuple]:
    resp = await client.get(f"{base}/{doc_id}/history", headers=env["h"][who])
    assert resp.status_code == 200, resp.text
    # The API answers newest first; read it in the order things happened.
    return [(e["kind"], e["actor_name"], e["note"]) for e in reversed(resp.json()["entries"])]


def _ids(env, *names) -> list[str]:
    return [str(env["users"][n].id) for n in names]


# ---------------------------------------------------------------------------
# The stub routes
# ---------------------------------------------------------------------------


class TestDiscussionRoute:
    async def test_admin_may_comment_and_moderate(self, client, env):
        adr = await _adr(client, env)
        resp = await client.get(f"{ADR}/{adr['id']}/comments", headers=env["h"]["admin"])
        assert resp.status_code == 200
        assert resp.json() == {
            "can": {"comment": True, "moderate": True},
            "open_count": 0,
            "threads": [],
        }

    async def test_a_viewer_reads_but_may_not_comment(self, client, env):
        adr = await _adr(client, env)
        resp = await client.get(f"{ADR}/{adr['id']}/comments", headers=env["h"]["viewer"])
        assert resp.json()["can"] == {"comment": False, "moderate": False}

    async def test_a_signatory_may_comment_without_the_permission(self, client, env):
        adr = await _adr(client, env)
        await _post(
            client,
            env,
            f"{ADR}/{adr['id']}/request-signatures",
            json={"user_ids": _ids(env, "viewer")},
        )
        resp = await client.get(f"{ADR}/{adr['id']}/comments", headers=env["h"]["viewer"])
        assert resp.json()["can"] == {"comment": True, "moderate": False}

    async def test_needs_adr_view(self, client, env):
        adr = await _adr(client, env)
        resp = await client.get(f"{ADR}/{adr['id']}/comments", headers=env["h"]["blind"])
        assert resp.status_code == 403

    @pytest.mark.parametrize(
        "doc_id", [str(uuid.uuid4()), "not-a-uuid"], ids=["unknown", "malformed"]
    )
    async def test_unknown_decision_is_404(self, client, env, doc_id):
        resp = await client.get(f"{ADR}/{doc_id}/comments", headers=env["h"]["admin"])
        assert (resp.status_code, resp.json()["detail"]) == (
            404,
            "Architecture decision not found",
        )

    async def test_soaw_twin(self, client, env):
        soaw = await _soaw(client, env)
        member = await client.get(f"{SOAW}/{soaw['id']}/comments", headers=env["h"]["one"])
        assert member.json() == {
            "can": {"comment": True, "moderate": True},
            "open_count": 0,
            "threads": [],
        }
        viewer = await client.get(f"{SOAW}/{soaw['id']}/comments", headers=env["h"]["viewer"])
        assert viewer.json()["can"] == {"comment": False, "moderate": False}
        await _post(
            client,
            env,
            f"{SOAW}/{soaw['id']}/request-signatures",
            json={"user_ids": _ids(env, "viewer")},
        )
        signer = await client.get(f"{SOAW}/{soaw['id']}/comments", headers=env["h"]["viewer"])
        assert signer.json()["can"] == {"comment": True, "moderate": False}
        blind = await client.get(f"{SOAW}/{soaw['id']}/comments", headers=env["h"]["blind"])
        assert blind.status_code == 403
        missing = await client.get(f"{SOAW}/{uuid.uuid4()}/comments", headers=env["h"]["admin"])
        assert (missing.status_code, missing.json()["detail"]) == (
            404,
            "Statement of Architecture Work not found",
        )


class TestHistoryRoute:
    async def test_shape_of_an_entry(self, client, env):
        adr = await _adr(client, env)
        resp = await client.get(f"{ADR}/{adr['id']}/history", headers=env["h"]["admin"])
        assert resp.status_code == 200
        body = resp.json()
        assert body["can_view_versions"] is True
        (entry,) = body["entries"]
        assert entry == {
            "id": entry["id"],
            "kind": "created",
            "actor": {"id": str(env["users"]["admin"].id), "display_name": "Ada"},
            "actor_name": "Ada",
            "note": None,
            "created_at": entry["created_at"],
            "has_content": True,
            "restored_from": None,
        }
        uuid.UUID(entry["id"])
        assert entry["created_at"].startswith(str(date.today().year))

    async def test_viewers_read_the_timeline_but_not_versions(self, client, env):
        adr = await _adr(client, env)
        resp = await client.get(f"{ADR}/{adr['id']}/history", headers=env["h"]["viewer"])
        assert resp.json()["can_view_versions"] is False
        assert [e["kind"] for e in resp.json()["entries"]] == ["created"]

    async def test_a_signatory_may_view_versions(self, client, env):
        adr = await _adr(client, env)
        await _post(
            client,
            env,
            f"{ADR}/{adr['id']}/request-signatures",
            json={"user_ids": _ids(env, "viewer")},
        )
        resp = await client.get(f"{ADR}/{adr['id']}/history", headers=env["h"]["viewer"])
        assert resp.json()["can_view_versions"] is True

    async def test_needs_view_and_a_known_document(self, client, env):
        adr = await _adr(client, env)
        soaw = await _soaw(client, env)
        assert (
            await client.get(f"{ADR}/{adr['id']}/history", headers=env["h"]["blind"])
        ).status_code == 403
        assert (
            await client.get(f"{SOAW}/{soaw['id']}/history", headers=env["h"]["blind"])
        ).status_code == 403
        assert (
            await client.get(f"{ADR}/{uuid.uuid4()}/history", headers=env["h"]["admin"])
        ).status_code == 404
        assert (
            await client.get(f"{SOAW}/{uuid.uuid4()}/history", headers=env["h"]["admin"])
        ).status_code == 404

    async def test_soaw_twin(self, client, env):
        soaw = await _soaw(client, env)
        resp = await client.get(f"{SOAW}/{soaw['id']}/history", headers=env["h"]["viewer"])
        assert resp.status_code == 200
        assert resp.json()["can_view_versions"] is False
        assert [(e["kind"], e["actor_name"]) for e in resp.json()["entries"]] == [
            ("created", "Ada")
        ]
        admin = await client.get(f"{SOAW}/{soaw['id']}/history", headers=env["h"]["admin"])
        assert admin.json()["can_view_versions"] is True


class TestMentionedInRoute:
    async def test_empty_lists(self, client, env):
        adr = await _adr(client, env)
        resp = await client.get(
            f"/api/v1/mentions/decisions/{adr['id']}", headers=env["h"]["viewer"]
        )
        assert (resp.status_code, resp.json()) == (200, {"decisions": [], "soaws": []})

    async def test_needs_adr_view_and_a_known_decision(self, client, env):
        adr = await _adr(client, env)
        blind = await client.get(
            f"/api/v1/mentions/decisions/{adr['id']}", headers=env["h"]["blind"]
        )
        assert blind.status_code == 403
        missing = await client.get(
            f"/api/v1/mentions/decisions/{uuid.uuid4()}", headers=env["h"]["admin"]
        )
        assert missing.status_code == 404


# ---------------------------------------------------------------------------
# The timeline written by each step
# ---------------------------------------------------------------------------


class TestDecisionTimeline:
    async def test_review_round_to_signed(self, client, env, db):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        await _post(
            client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one", "two")}
        )
        await _post(client, env, f"{base}/sign", who="one", json={"comment": "Looks right"})
        await _post(client, env, f"{base}/sign", who="two")
        assert await _timeline(client, env, ADR, adr["id"]) == [
            ("created", "Ada", None),
            ("sent_for_review", "Ada", None),
            ("signature", "One", "Looks right"),
            ("signature", "Two", None),
            ("signed", "Two", None),
        ]
        rows = (
            (
                await db.execute(
                    select(DocumentHistoryEntry)
                    .where(DocumentHistoryEntry.architecture_decision_id == uuid.UUID(adr["id"]))
                    .order_by(DocumentHistoryEntry.seq)
                )
            )
            .scalars()
            .all()
        )
        assert [r.seq for r in rows] == sorted(r.seq for r in rows)
        assert rows[1].signatories == [
            {"user_id": str(env["users"]["one"].id), "display_name": "One"},
            {"user_id": str(env["users"]["two"].id), "display_name": "Two"},
        ]
        assert all(r.signatories is None for r in rows if r.kind != "sent_for_review")
        assert {r.via for r in rows} == {"api"}

    async def test_reject_and_recall(self, client, env):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/reject", who="one", json={"comment": "Needs numbers"})
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "two")})
        await _post(client, env, f"{base}/recall-signatures")
        assert await _timeline(client, env, ADR, adr["id"]) == [
            ("created", "Ada", None),
            ("sent_for_review", "Ada", None),
            ("rejected", "One", "Needs numbers"),
            ("sent_for_review", "Ada", None),
            ("recalled", "Ada", None),
        ]

    async def test_a_reject_reason_is_capped(self, client, env):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(
            client, env, f"{base}/reject", who="one", json={"comment": "x" * 4001}, status=422
        )
        await _post(client, env, f"{base}/reject", who="one", json={"comment": "x" * 4000})

    async def test_record(self, client, env):
        adr = await _adr(
            client,
            env,
            decision_makers=[{"user_id": str(env["users"]["one"].id)}],
        )
        await _post(client, env, f"{ADR}/{adr['id']}/record", json={"decided_on": "2026-01-15"})
        assert await _timeline(client, env, ADR, adr["id"]) == [
            ("created", "Ada", None),
            ("recorded", "Ada", None),
        ]

    async def test_revise_and_duplicate(self, client, env):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/sign", who="one")
        revision = await _post(client, env, f"{base}/revise", who="two")
        assert await _timeline(client, env, ADR, revision["id"]) == [("revised", "Two", None)]
        copy = await _post(client, env, f"{base}/duplicate", who="one", status=201)
        assert await _timeline(client, env, ADR, copy["id"]) == [("created", "One", None)]
        # The source's own timeline is untouched by either.
        assert [k for k, _, _ in await _timeline(client, env, ADR, adr["id"])] == [
            "created",
            "sent_for_review",
            "signature",
            "signed",
        ]

    async def test_the_importer_opens_a_timeline(self, client, env):
        resp = await client.post(
            f"{ADR}/bulk-import",
            json={"items": [{"row_index": 0, "title": "Imported"}]},
            headers=env["h"]["one"],
        )
        assert resp.status_code == 200, resp.text
        (result,) = resp.json()["results"]
        assert await _timeline(client, env, ADR, result["id"]) == [("created", "One", None)]

    async def test_an_import_dry_run_leaves_no_timeline(self, client, env, db):
        resp = await client.post(
            f"{ADR}/bulk-import",
            json={"items": [{"row_index": 0, "title": "Preview"}], "dry_run": True},
            headers=env["h"]["one"],
        )
        assert resp.status_code == 200, resp.text
        rows = (await db.execute(select(DocumentHistoryEntry))).scalars().all()
        assert rows == []


class TestSoawTimeline:
    async def test_review_round_to_signed(self, client, env):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _post(
            client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one", "two")}
        )
        await _post(client, env, f"{base}/sign", who="one")
        await _post(client, env, f"{base}/sign", who="two")
        assert await _timeline(client, env, SOAW, soaw["id"]) == [
            ("created", "Ada", None),
            ("sent_for_review", "Ada", None),
            ("signature", "One", None),
            ("signature", "Two", None),
            ("signed", "Two", None),
        ]
        revision = await _post(client, env, f"{base}/revise", who="one")
        assert await _timeline(client, env, SOAW, revision["id"]) == [("revised", "One", None)]

    async def test_reject_and_recall(self, client, env):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/reject", who="one", json={"comment": "Scope?"})
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "two")})
        await _post(client, env, f"{base}/recall-signatures")
        assert await _timeline(client, env, SOAW, soaw["id"]) == [
            ("created", "Ada", None),
            ("sent_for_review", "Ada", None),
            ("rejected", "One", "Scope?"),
            ("sent_for_review", "Ada", None),
            ("recalled", "Ada", None),
        ]

    async def test_a_reject_reason_is_capped(self, client, env):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(
            client, env, f"{base}/reject", who="one", json={"comment": "y" * 4001}, status=422
        )


# ---------------------------------------------------------------------------
# The hooks: called from every path, render_doc once per response
# ---------------------------------------------------------------------------


@pytest.fixture
def spy(monkeypatch):
    """Record every hook call (kind, doc kind, the doc's id or None, the data
    handed over) and delegate to the real hook."""
    calls: list[tuple] = []
    real = {
        name: getattr(document_collab, name)
        for name in ("before_save", "after_save", "on_workflow", "render_doc")
    }

    async def before_save(db, doc_kind, doc, incoming, *, user, read_scope, copy=False):
        calls.append(
            (
                "before_save",
                doc_kind,
                doc.id if doc else None,
                dict(incoming),
                user,
                read_scope,
                copy,
            )
        )
        return await real["before_save"](
            db, doc_kind, doc, incoming, user=user, read_scope=read_scope, copy=copy
        )

    async def after_save(db, doc_kind, doc, *, user, was_draft, before):
        calls.append(("after_save", doc_kind, doc.id, was_draft, before))
        return await real["after_save"](
            db, doc_kind, doc, user=user, was_draft=was_draft, before=before
        )

    async def on_workflow(db, doc_kind, doc, step, **kw):
        calls.append(("on_workflow", doc_kind, doc.id, step))
        return await real["on_workflow"](db, doc_kind, doc, step, **kw)

    async def render_doc(db, doc_kind, payloads, *, user, read_scope, register=None):
        calls.append(("render_doc", doc_kind, [p["id"] for p in payloads], payloads))
        return await real["render_doc"](
            db, doc_kind, payloads, user=user, read_scope=read_scope, register=register
        )

    for name, fn in (
        ("before_save", before_save),
        ("after_save", after_save),
        ("on_workflow", on_workflow),
        ("render_doc", render_doc),
    ):
        monkeypatch.setattr(document_collab, name, fn)
    return calls


def _of(calls, name) -> list[tuple]:
    return [c for c in calls if c[0] == name]


class TestDecisionHooks:
    async def test_create(self, client, env, spy):
        adr = await _adr(client, env, context="<p>c</p>", decision="<p>d</p>")
        (before,) = _of(spy, "before_save")
        assert before[1:4] == (
            "adr",
            None,
            {
                "context": "<p>c</p>",
                "decision": "<p>d</p>",
                "consequences": None,
                "alternatives_considered": None,
            },
        )
        assert before[4].id == env["users"]["admin"].id and before[5] is not None
        assert _of(spy, "on_workflow") == [("on_workflow", "adr", uuid.UUID(adr["id"]), "created")]
        (render,) = _of(spy, "render_doc")
        assert render[1:3] == ("adr", [adr["id"]])
        assert render[3] == [adr]

    async def test_update(self, client, env, spy):
        adr = await _adr(client, env)
        spy.clear()
        resp = await client.patch(
            f"{ADR}/{adr['id']}",
            json={"title": "New", "decision": "<p>d</p>", "consequences": "<p>q</p>"},
            headers=env["h"]["admin"],
        )
        assert resp.status_code == 200
        (before,) = _of(spy, "before_save")
        assert before[1:4] == (
            "adr",
            uuid.UUID(adr["id"]),
            {"decision": "<p>d</p>", "consequences": "<p>q</p>"},
        )
        # ``before`` is the content as it was before the save touched the row.
        assert _of(spy, "after_save") == [
            (
                "after_save",
                "adr",
                uuid.UUID(adr["id"]),
                True,
                {
                    "title": "Decision",
                    "context": None,
                    "decision": None,
                    "consequences": None,
                    "alternatives_considered": None,
                    "decided_on": None,
                    "effective_from": None,
                    "valid_until": None,
                    "change_summary": None,
                    "decision_makers": [],
                    "participants": [],
                },
            )
        ]
        assert _of(spy, "on_workflow") == []
        (render,) = _of(spy, "render_doc")
        assert render[3] == [resp.json()]
        assert resp.json()["decision"] == "<p>d</p>"

    async def test_update_in_review_reports_it_was_not_a_draft(self, client, env, spy):
        adr = await _adr(client, env)
        await _post(
            client,
            env,
            f"{ADR}/{adr['id']}/request-signatures",
            json={"user_ids": _ids(env, "one")},
        )
        spy.clear()
        resp = await client.patch(
            f"{ADR}/{adr['id']}", json={"linked_card_ids": []}, headers=env["h"]["admin"]
        )
        assert resp.status_code == 200, resp.text
        assert _of(spy, "after_save") == [("after_save", "adr", uuid.UUID(adr["id"]), False, None)]
        assert _of(spy, "before_save")[0][3] == {}

    async def test_workflow_steps(self, client, env, spy):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        spy.clear()
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/recall-signatures")
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/reject", who="one", json={"comment": "no"})
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/sign", who="one")
        revision = await _post(client, env, f"{base}/revise")
        dup = await _post(client, env, f"{base}/duplicate", status=201)
        assert [c[2:] for c in _of(spy, "on_workflow")] == [
            (uuid.UUID(adr["id"]), "sent_for_review"),
            (uuid.UUID(adr["id"]), "recalled"),
            (uuid.UUID(adr["id"]), "sent_for_review"),
            (uuid.UUID(adr["id"]), "rejected"),
            (uuid.UUID(adr["id"]), "sent_for_review"),
            (uuid.UUID(adr["id"]), "signature"),
            (uuid.UUID(adr["id"]), "signed"),
            (uuid.UUID(revision["id"]), "revised"),
            (uuid.UUID(dup["id"]), "created"),
        ]
        # The revision and the duplicate copy their text through before_save,
        # as copies with no writer scope (a copy is never re-checked).
        copies = _of(spy, "before_save")
        assert [(c[1], c[2], c[4], c[5], c[6]) for c in copies] == [
            ("adr", None, None, None, True),
            ("adr", None, None, None, True),
        ]
        # One render per response.
        assert len(_of(spy, "render_doc")) == 8

    async def test_record(self, client, env, spy):
        adr = await _adr(client, env, decision_makers=[{"name": "Board"}])
        spy.clear()
        await _post(client, env, f"{ADR}/{adr['id']}/record", json={"decided_on": "2026-01-15"})
        assert [c[3] for c in _of(spy, "on_workflow")] == ["recorded"]

    async def test_reads_render_once_per_response(self, client, env, spy):
        first = await _adr(client, env, title="First")
        second = await _adr(client, env, title="Second")
        await client.post(
            f"{ADR}/{first['id']}/cards",
            json={"card_id": str(env["card"].id)},
            headers=env["h"]["admin"],
        )
        spy.clear()
        h = env["h"]["admin"]
        detail = await client.get(f"{ADR}/{first['id']}", headers=h)
        listing = await client.get(ADR, headers=h)
        content = await client.get(ADR, params={"include_content": "true"}, headers=h)
        revisions = await client.get(f"{ADR}/{first['id']}/revisions", headers=h)
        by_card = await client.get(f"{ADR}/by-card/{env['card'].id}", headers=h)
        renders = _of(spy, "render_doc")
        assert [(r[1], sorted(r[2])) for r in renders] == [
            ("adr", [first["id"]]),
            ("adr", sorted([first["id"], second["id"]])),
            ("adr", sorted([first["id"], second["id"]])),
            ("adr", [first["id"]]),
            ("adr", [first["id"]]),
        ]
        for resp, render in zip(
            (detail, listing, content, revisions, by_card), renders, strict=True
        ):
            body = resp.json()
            assert body == (render[3][0] if isinstance(body, dict) else render[3])
        # The spreadsheet export's text fields are part of the one batch.
        assert {"context", "consequences", "alternatives_considered", "link_references"} <= set(
            renders[2][3][0]
        )
        assert "context" not in renders[1][3][0]


class TestSoawHooks:
    async def test_create_update_and_reads(self, client, env, spy):
        soaw = await _soaw(client, env, sections={"1.1": {"content": "<p>a</p>"}})
        (before,) = _of(spy, "before_save")
        assert before[1:4] == ("soaw", None, {"sections": {"1.1": {"content": "<p>a</p>"}}})
        assert (before[4].id, before[5]) == (env["users"]["admin"].id, None)
        assert [c[3] for c in _of(spy, "on_workflow")] == ["created"]
        assert _of(spy, "render_doc")[0][3] == [soaw]

        spy.clear()
        resp = await client.patch(
            f"{SOAW}/{soaw['id']}", json={"name": "Renamed"}, headers=env["h"]["admin"]
        )
        assert resp.status_code == 200
        assert _of(spy, "before_save") == []
        assert _of(spy, "after_save") == [
            (
                "after_save",
                "soaw",
                uuid.UUID(soaw["id"]),
                True,
                {
                    "name": "Plan",
                    "document_info": {},
                    "version_history": [],
                    "sections": {"1.1": {"content": "<p>a</p>"}},
                },
            )
        ]
        spy.clear()
        resp = await client.patch(
            f"{SOAW}/{soaw['id']}",
            json={"sections": {"1.1": {"content": "<p>b</p>"}}},
            headers=env["h"]["admin"],
        )
        assert [c[1:4] for c in _of(spy, "before_save")] == [
            ("soaw", uuid.UUID(soaw["id"]), {"sections": {"1.1": {"content": "<p>b</p>"}}})
        ]
        assert resp.json()["sections"] == {"1.1": {"content": "<p>b</p>"}}

        spy.clear()
        h = env["h"]["admin"]
        detail = await client.get(f"{SOAW}/{soaw['id']}", headers=h)
        listing = await client.get(SOAW, headers=h)
        revisions = await client.get(f"{SOAW}/{soaw['id']}/revisions", headers=h)
        renders = _of(spy, "render_doc")
        assert [(r[1], r[2]) for r in renders] == [
            ("soaw", [soaw["id"]]),
            ("soaw", [soaw["id"]]),
            ("soaw", [soaw["id"]]),
        ]
        assert detail.json() == renders[0][3][0]
        assert "revisions" in detail.json()
        assert listing.json() == renders[1][3]
        assert revisions.json() == renders[2][3]

    async def test_workflow_steps(self, client, env, spy):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        spy.clear()
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/recall-signatures")
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/reject", who="one", json={"comment": "no"})
        await _post(client, env, f"{base}/request-signatures", json={"user_ids": _ids(env, "one")})
        await _post(client, env, f"{base}/sign", who="one")
        revision = await _post(client, env, f"{base}/revise")
        sid = uuid.UUID(soaw["id"])
        assert [c[2:] for c in _of(spy, "on_workflow")] == [
            (sid, "sent_for_review"),
            (sid, "recalled"),
            (sid, "sent_for_review"),
            (sid, "rejected"),
            (sid, "sent_for_review"),
            (sid, "signature"),
            (sid, "signed"),
            (uuid.UUID(revision["id"]), "revised"),
        ]
        assert [c[1:3] for c in _of(spy, "before_save")] == [("soaw", None)]
        assert len(_of(spy, "render_doc")) == 7
