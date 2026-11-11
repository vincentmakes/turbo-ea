"""The history of a decision: timeline, saved versions and restore.

- Every viewer reads the timeline (newest first, paged); versions are for
  editors (``adr.manage``) and the decision's signatories, past review rounds
  included.
- A draft's save with changes is a version; a save without changes and a
  save in review are not.
- Restore is for editors, on a draft, forward only.
- Every path that creates a decision opens the timeline with its content.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.document_history import DocumentHistoryEntry
from tests.conftest import auth_headers, create_role, create_user

ADR = "/api/v1/adr"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="blind", label="Blind", permissions={"inventory.view": True})
    users = {
        "admin": await create_user(db, email="admin@h.test", role="admin", display_name="Ada"),
        "one": await create_user(db, email="one@h.test", role="member", display_name="One"),
        "viewer": await create_user(db, email="viewer@h.test", role="viewer", display_name="Vic"),
        "blind": await create_user(db, email="blind@h.test", role="blind", display_name="Bea"),
    }
    return {"users": users, "h": {k: auth_headers(u) for k, u in users.items()}}


async def _call(client, env, method, path, who="admin", json=None, status=200, params=None):
    resp = await client.request(method, path, json=json, headers=env["h"][who], params=params)
    assert resp.status_code == status, resp.text
    return resp.json() if resp.content else None


async def _adr(client, env, **fields) -> dict:
    return await _call(client, env, "POST", ADR, json={"title": "Decision", **fields}, status=201)


async def _save(client, env, adr_id, who="admin", status=200, **fields):
    return await _call(client, env, "PATCH", f"{ADR}/{adr_id}", who, json=fields, status=status)


async def _history(client, env, adr_id, who="admin", **params) -> dict:
    return await _call(client, env, "GET", f"{ADR}/{adr_id}/history", who, params=params)


def _ids(env, *names) -> list[str]:
    return [str(env["users"][n].id) for n in names]


class TestTimeline:
    async def test_every_step_newest_first(self, client, env):
        adr = await _adr(client, env, context="<p>v1</p>")
        base = f"{ADR}/{adr['id']}"
        await _save(client, env, adr["id"], context="<p>v2</p>")
        await _save(client, env, adr["id"], context="<p>v3</p>")
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/reject", "one", json={"comment": "No"})
        await _save(client, env, adr["id"], context="<p>v4</p>")
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/sign", "one")

        body = await _history(client, env, adr["id"])
        assert [
            (e["kind"], e["actor_name"], e["note"], e["has_content"]) for e in body["entries"]
        ] == [
            ("signed", "One", None, False),
            ("signature", "One", None, False),
            ("sent_for_review", "Ada", None, False),
            ("save", "Ada", None, True),
            ("rejected", "One", "No", False),
            ("sent_for_review", "Ada", None, False),
            ("save", "Ada", None, True),
            ("save", "Ada", None, True),
            ("created", "Ada", None, True),
        ]
        assert (body["total"], body["can_view_versions"], body["can_restore"]) == (9, True, False)
        assert all("content" not in e and "signatories" not in e for e in body["entries"])
        assert set(body) == {"can_view_versions", "can_restore", "total", "entries"}

    async def test_pages(self, client, env):
        adr = await _adr(client, env)
        for n in range(3):
            await _save(client, env, adr["id"], title=f"T{n}")
        first = await _history(client, env, adr["id"], page=1, page_size=3)
        second = await _history(client, env, adr["id"], page=2, page_size=3)
        assert first["total"] == second["total"] == 4
        assert [e["kind"] for e in first["entries"]] == ["save", "save", "save"]
        assert [e["kind"] for e in second["entries"]] == ["created"]
        await _call(
            client,
            env,
            "GET",
            f"{ADR}/{adr['id']}/history",
            params={"page_size": 201},
            status=422,
        )
        await _call(
            client, env, "GET", f"{ADR}/{adr['id']}/history", params={"page": 0}, status=422
        )
        default = await _history(client, env, adr["id"])
        assert len(default["entries"]) == 4

    async def test_an_unchanged_save_and_a_save_in_review_record_nothing(self, client, env):
        adr = await _adr(client, env, context="<p>c</p>")
        await _save(client, env, adr["id"], context="<p>c</p>", title="Decision")
        await _call(
            client,
            env,
            "POST",
            f"{ADR}/{adr['id']}/request-signatures",
            json={"user_ids": _ids(env, "one")},
        )
        await _save(client, env, adr["id"], linked_card_ids=[])
        kinds = [e["kind"] for e in (await _history(client, env, adr["id"]))["entries"]]
        assert kinds == ["sent_for_review", "created"]

    async def test_a_legacy_decision_gets_a_baseline_first(self, client, env, db):
        adr = await _adr(client, env, context="<p>old</p>")
        # As migration 171 left it: the ``created`` row has no content.
        created = (await _history(client, env, adr["id"]))["entries"][0]
        row = await db.get(DocumentHistoryEntry, uuid.UUID(created["id"]))
        row.content = None
        await db.flush()
        await _save(client, env, adr["id"], context="<p>new</p>")
        entries = (await _history(client, env, adr["id"]))["entries"]
        assert [(e["kind"], e["actor"], e["has_content"]) for e in entries] == [
            ("save", {"id": str(env["users"]["admin"].id), "display_name": "Ada"}, True),
            ("baseline", None, True),
            ("created", {"id": str(env["users"]["admin"].id), "display_name": "Ada"}, False),
        ]
        baseline = await _call(client, env, "GET", f"{ADR}/{adr['id']}/history/{entries[1]['id']}")
        assert baseline["content"]["context"] == "<p>old</p>"

    async def test_viewers_read_the_timeline_but_no_version(self, client, env):
        adr = await _adr(client, env)
        body = await _history(client, env, adr["id"], "viewer")
        assert (body["can_view_versions"], body["can_restore"]) == (False, False)
        entry_id = body["entries"][0]["id"]
        resp = await _call(
            client, env, "GET", f"{ADR}/{adr['id']}/history/{entry_id}", "viewer", status=403
        )
        assert resp["detail"] == "You may not view the versions of this document"

    async def test_needs_view_and_a_known_decision(self, client, env):
        adr = await _adr(client, env)
        await _call(client, env, "GET", f"{ADR}/{adr['id']}/history", "blind", status=403)
        await _call(client, env, "GET", f"{ADR}/{uuid.uuid4()}/history", status=404)
        entry_id = (await _history(client, env, adr["id"]))["entries"][0]["id"]
        await _call(
            client, env, "GET", f"{ADR}/{adr['id']}/history/{entry_id}", "blind", status=403
        )


class TestVersion:
    async def test_an_editor_opens_a_version(self, client, env):
        one = str(env["users"]["one"].id)
        adr = await _adr(
            client,
            env,
            context="<p>v1</p>",
            decided_on="2026-01-02",
            decision_makers=[{"user_id": one}, {"name": "Guest"}],
        )
        created = (await _history(client, env, adr["id"]))["entries"][0]
        body = await _call(client, env, "GET", f"{ADR}/{adr['id']}/history/{created['id']}", "one")
        assert body == {
            "entry": created,
            "content": {
                "title": "Decision",
                "context": "<p>v1</p>",
                "decision": None,
                "consequences": None,
                "alternatives_considered": None,
                "decided_on": "2026-01-02",
                "effective_from": None,
                "valid_until": None,
                "change_summary": None,
                "decision_makers": [
                    {"user_id": one, "display_name": "One"},
                    {"user_id": None, "display_name": "Guest"},
                ],
                "participants": [],
            },
        }

    async def test_a_signatory_of_a_recalled_round_opens_versions(self, client, env):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        await _call(
            client,
            env,
            "POST",
            f"{base}/request-signatures",
            json={"user_ids": _ids(env, "viewer")},
        )
        await _call(client, env, "POST", f"{base}/recall-signatures")
        body = await _history(client, env, adr["id"], "viewer")
        assert (body["can_view_versions"], body["can_restore"]) == (True, False)
        created = body["entries"][-1]
        version = await _call(client, env, "GET", f"{base}/history/{created['id']}", "viewer")
        assert version["content"]["title"] == "Decision"

    async def test_a_workflow_row_or_another_decisions_entry_is_404(self, client, env):
        adr = await _adr(client, env)
        other = await _adr(client, env, title="Other")
        base = f"{ADR}/{adr['id']}"
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        sent = (await _history(client, env, adr["id"]))["entries"][0]
        foreign = (await _history(client, env, other["id"]))["entries"][0]
        for entry_id in (sent["id"], foreign["id"], "nope"):
            resp = await _call(client, env, "GET", f"{base}/history/{entry_id}", status=404)
            assert resp["detail"] == "History entry not found"


class TestRestore:
    async def test_restores_the_old_text_and_adds_a_restored_row(self, client, env):
        adr = await _adr(client, env, context="<p>first</p>")
        await _save(client, env, adr["id"], context="<p>second</p>", title="Renamed")
        created = (await _history(client, env, adr["id"]))["entries"][-1]
        detail = await _call(
            client, env, "POST", f"{ADR}/{adr['id']}/history/{created['id']}/restore", "one"
        )
        assert (detail["id"], detail["title"], detail["context"]) == (
            adr["id"],
            "Decision",
            "<p>first</p>",
        )
        assert set(detail) == set(adr)
        body = await _history(client, env, adr["id"])
        restored = body["entries"][0]
        assert (restored["kind"], restored["actor_name"], restored["note"]) == (
            "restored",
            "One",
            created["id"],
        )
        assert restored["restored_from"] == {
            "id": created["id"],
            "kind": "created",
            "created_at": created["created_at"],
        }
        assert [e["kind"] for e in body["entries"]] == ["restored", "save", "created"]
        version = await _call(client, env, "GET", f"{ADR}/{adr['id']}/history/{restored['id']}")
        assert version["content"]["context"] == "<p>first</p>"

    async def test_only_a_draft(self, client, env):
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        created = (await _history(client, env, adr["id"]))["entries"][0]
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        resp = await _call(
            client, env, "POST", f"{base}/history/{created['id']}/restore", status=409
        )
        assert resp["detail"] == {"error": "not_draft"}

    async def test_a_foreign_or_workflow_entry_is_404(self, client, env):
        adr = await _adr(client, env)
        other = await _adr(client, env, title="Other")
        base = f"{ADR}/{adr['id']}"
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/recall-signatures")
        recalled = (await _history(client, env, adr["id"]))["entries"][0]
        assert recalled["kind"] == "recalled"
        foreign = (await _history(client, env, other["id"]))["entries"][0]
        for entry_id in (recalled["id"], foreign["id"]):
            resp = await _call(
                client, env, "POST", f"{base}/history/{entry_id}/restore", status=404
            )
            assert resp["detail"] == "History entry not found"

    async def test_invalid_restored_dates_are_a_400(self, client, env, db):
        adr = await _adr(client, env)
        created = (await _history(client, env, adr["id"]))["entries"][0]
        row = await db.get(DocumentHistoryEntry, uuid.UUID(created["id"]))
        row.content = {**row.content, "effective_from": "2026-06-01", "valid_until": "2026-05-01"}
        await db.flush()
        resp = await _call(
            client,
            env,
            "POST",
            f"{ADR}/{adr['id']}/history/{created['id']}/restore",
            status=400,
        )
        assert resp["detail"] == {
            "error": "valid_until_before_effective",
            "problems": ["valid_until_before_effective"],
        }

    async def test_needs_manage(self, client, env):
        adr = await _adr(client, env)
        created = (await _history(client, env, adr["id"]))["entries"][0]
        await _call(
            client,
            env,
            "POST",
            f"{ADR}/{adr['id']}/history/{created['id']}/restore",
            "viewer",
            status=403,
        )
        await _call(
            client,
            env,
            "POST",
            f"{ADR}/{uuid.uuid4()}/history/{created['id']}/restore",
            status=404,
        )


class TestEveryWriterOpensTheTimelineWithContent:
    async def _first(self, client, env, adr_id) -> dict:
        entries = (await _history(client, env, adr_id))["entries"]
        version = await _call(client, env, "GET", f"{ADR}/{adr_id}/history/{entries[-1]['id']}")
        return {"kinds": [e["kind"] for e in entries], **version}

    async def test_the_importer(self, client, env):
        resp = await _call(
            client,
            env,
            "POST",
            f"{ADR}/bulk-import",
            "one",
            json={"items": [{"row_index": 0, "title": "Imported", "context": "Why"}]},
        )
        (result,) = resp["results"]
        first = await self._first(client, env, result["id"])
        assert first["kinds"] == ["created"]
        assert (first["entry"]["actor_name"], first["content"]["title"]) == ("One", "Imported")
        assert first["content"]["context"] is not None

    async def test_duplicate_and_revise(self, client, env):
        adr = await _adr(client, env, context="<p>c</p>", participants=[{"name": "Guest"}])
        base = f"{ADR}/{adr['id']}"
        copy = await _call(client, env, "POST", f"{base}/duplicate", "one", status=201)
        first = await self._first(client, env, copy["id"])
        assert first["kinds"] == ["created"]
        assert (first["content"]["title"], first["content"]["context"]) == (
            "Decision (copy)",
            "<p>c</p>",
        )
        assert first["content"]["participants"] == [{"user_id": None, "display_name": "Guest"}]
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/sign", "one")
        revision = await _call(client, env, "POST", f"{base}/revise", "one")
        first = await self._first(client, env, revision["id"])
        assert first["kinds"] == ["revised"]
        assert (first["entry"]["actor_name"], first["content"]["title"]) == ("One", "Decision")
        assert first["content"]["participants"] == [{"user_id": None, "display_name": "Guest"}]
