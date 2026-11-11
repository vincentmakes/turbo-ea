"""The history of a SoAW: timeline, saved versions and restore — the twin of
``test_adr_history.py``, plus the editor's template round trip, which must not
read as a change."""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import auth_headers, create_role, create_user

SOAW = "/api/v1/soaw"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(db, key="blind", label="Blind", permissions={"inventory.view": True})
    users = {
        "admin": await create_user(db, email="admin@s.test", role="admin", display_name="Ada"),
        "one": await create_user(db, email="one@s.test", role="member", display_name="One"),
        "viewer": await create_user(db, email="viewer@s.test", role="viewer", display_name="Vic"),
        "blind": await create_user(db, email="blind@s.test", role="blind", display_name="Bea"),
    }
    return {"users": users, "h": {k: auth_headers(u) for k, u in users.items()}}


async def _call(client, env, method, path, who="admin", json=None, status=200, params=None):
    resp = await client.request(method, path, json=json, headers=env["h"][who], params=params)
    assert resp.status_code == status, resp.text
    return resp.json() if resp.content else None


def _sections(text: str) -> dict:
    return {"1.1": {"content": f"<p>{text}</p>"}}


async def _soaw(client, env, text="v1") -> dict:
    return await _call(
        client, env, "POST", SOAW, json={"name": "Plan", "sections": _sections(text)}, status=201
    )


async def _save(client, env, soaw_id, **fields):
    return await _call(client, env, "PATCH", f"{SOAW}/{soaw_id}", json=fields)


async def _history(client, env, soaw_id, who="admin", **params) -> dict:
    return await _call(client, env, "GET", f"{SOAW}/{soaw_id}/history", who, params=params)


def _ids(env, *names) -> list[str]:
    return [str(env["users"][n].id) for n in names]


class TestTimeline:
    async def test_every_step_newest_first(self, client, env):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _save(client, env, soaw["id"], sections=_sections("v2"))
        await _save(client, env, soaw["id"], name="Plan B")
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/reject", "one", json={"comment": "Scope"})
        await _save(client, env, soaw["id"], document_info={"prepared_by": "Ada"})
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/sign", "one")
        body = await _history(client, env, soaw["id"])
        assert [
            (e["kind"], e["actor_name"], e["note"], e["has_content"]) for e in body["entries"]
        ] == [
            ("signed", "One", None, False),
            ("signature", "One", None, False),
            ("sent_for_review", "Ada", None, False),
            ("save", "Ada", None, True),
            ("rejected", "One", "Scope", False),
            ("sent_for_review", "Ada", None, False),
            ("save", "Ada", None, True),
            ("save", "Ada", None, True),
            ("created", "Ada", None, True),
        ]
        assert (body["total"], body["can_view_versions"], body["can_restore"]) == (9, True, False)

    async def test_pages(self, client, env):
        soaw = await _soaw(client, env)
        await _save(client, env, soaw["id"], name="Two")
        page = await _history(client, env, soaw["id"], page=2, page_size=1)
        assert (page["total"], [e["kind"] for e in page["entries"]]) == (2, ["created"])

    async def test_the_editors_template_round_trip_is_no_change(self, client, env):
        soaw = await _soaw(client, env)
        await _save(
            client,
            env,
            soaw["id"],
            name="Plan",
            document_info={"prepared_by": "", "reviewed_by": "", "review_date": ""},
            version_history=[{"version": "", "date": "", "revised_by": "", "description": ""}],
            sections={
                "1.1": {"content": "<p>v1</p>", "hidden": False},
                "1.2": {"content": "", "hidden": False},
                "2.1": {
                    "content": "",
                    "hidden": False,
                    "table_data": {"columns": ["A", "B"], "rows": [["", ""]]},
                },
            },
        )
        kinds = [e["kind"] for e in (await _history(client, env, soaw["id"]))["entries"]]
        assert kinds == ["created"]

    async def test_a_save_in_review_records_nothing(self, client, env):
        soaw = await _soaw(client, env)
        await _call(
            client,
            env,
            "POST",
            f"{SOAW}/{soaw['id']}/request-signatures",
            json={"user_ids": _ids(env, "one")},
        )
        await _save(client, env, soaw["id"], initiative_id="")
        kinds = [e["kind"] for e in (await _history(client, env, soaw["id"]))["entries"]]
        assert kinds == ["sent_for_review", "created"]

    async def test_viewers_and_strangers(self, client, env):
        soaw = await _soaw(client, env)
        body = await _history(client, env, soaw["id"], "viewer")
        assert (body["can_view_versions"], body["can_restore"]) == (False, False)
        entry_id = body["entries"][0]["id"]
        resp = await _call(
            client, env, "GET", f"{SOAW}/{soaw['id']}/history/{entry_id}", "viewer", status=403
        )
        assert resp["detail"] == "You may not view the versions of this document"
        await _call(client, env, "GET", f"{SOAW}/{soaw['id']}/history", "blind", status=403)
        await _call(client, env, "GET", f"{SOAW}/{uuid.uuid4()}/history", status=404)


class TestVersion:
    async def test_an_editor_opens_a_version(self, client, env):
        soaw = await _soaw(client, env)
        created = (await _history(client, env, soaw["id"]))["entries"][0]
        body = await _call(
            client, env, "GET", f"{SOAW}/{soaw['id']}/history/{created['id']}", "one"
        )
        assert body == {
            "entry": created,
            "content": {
                "name": "Plan",
                "document_info": {},
                "version_history": [],
                "sections": {"1.1": {"content": "<p>v1</p>"}},
            },
        }

    async def test_a_signatory_of_a_recalled_round_opens_versions(self, client, env):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _call(
            client,
            env,
            "POST",
            f"{base}/request-signatures",
            json={"user_ids": _ids(env, "viewer")},
        )
        await _call(client, env, "POST", f"{base}/recall-signatures")
        body = await _history(client, env, soaw["id"], "viewer")
        assert body["can_view_versions"] is True
        created = body["entries"][-1]
        version = await _call(client, env, "GET", f"{base}/history/{created['id']}", "viewer")
        assert version["content"]["name"] == "Plan"

    async def test_a_workflow_row_or_another_soaws_entry_is_404(self, client, env):
        soaw = await _soaw(client, env)
        other = await _soaw(client, env, "other")
        base = f"{SOAW}/{soaw['id']}"
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        sent = (await _history(client, env, soaw["id"]))["entries"][0]
        foreign = (await _history(client, env, other["id"]))["entries"][0]
        for entry_id in (sent["id"], foreign["id"]):
            resp = await _call(client, env, "GET", f"{base}/history/{entry_id}", status=404)
            assert resp["detail"] == "History entry not found"


class TestRestore:
    async def test_restores_the_old_content(self, client, env):
        soaw = await _soaw(client, env)
        await _save(
            client,
            env,
            soaw["id"],
            name="Renamed",
            sections=_sections("v2"),
            version_history=[{"version": "2"}],
        )
        created = (await _history(client, env, soaw["id"]))["entries"][-1]
        detail = await _call(
            client, env, "POST", f"{SOAW}/{soaw['id']}/history/{created['id']}/restore", "one"
        )
        assert (detail["id"], detail["name"], detail["sections"], detail["version_history"]) == (
            soaw["id"],
            "Plan",
            {"1.1": {"content": "<p>v1</p>"}},
            [],
        )
        assert detail["revisions"][0]["id"] == soaw["id"]
        assert detail["open_thread_count"] == 0
        entries = (await _history(client, env, soaw["id"]))["entries"]
        assert [(e["kind"], e["note"]) for e in entries] == [
            ("restored", created["id"]),
            ("save", None),
            ("created", None),
        ]

    async def test_refusals(self, client, env):
        soaw = await _soaw(client, env)
        other = await _soaw(client, env, "other")
        base = f"{SOAW}/{soaw['id']}"
        created = (await _history(client, env, soaw["id"]))["entries"][0]
        foreign = (await _history(client, env, other["id"]))["entries"][0]
        await _call(
            client, env, "POST", f"{base}/history/{created['id']}/restore", "viewer", status=403
        )
        resp = await _call(
            client, env, "POST", f"{base}/history/{foreign['id']}/restore", status=404
        )
        assert resp["detail"] == "History entry not found"
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        resp = await _call(
            client, env, "POST", f"{base}/history/{created['id']}/restore", status=409
        )
        assert resp["detail"] == {"error": "not_draft"}

    async def test_an_approved_soaw_is_versioned_and_restored_like_a_draft(self, client, env):
        """A SoAW in the legacy ``approved`` status can be edited, so its saves
        are recorded as versions and a version can be restored into it."""
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _save(client, env, soaw["id"], status="approved")
        await _save(client, env, soaw["id"], sections=_sections("v2"))
        body = await _history(client, env, soaw["id"])
        assert body["can_restore"] is True
        entries = body["entries"]
        assert [(e["kind"], e["has_content"]) for e in entries] == [
            ("save", True),
            ("created", True),
        ]
        save = await _call(client, env, "GET", f"{base}/history/{entries[0]['id']}")
        assert save["content"]["sections"] == {"1.1": {"content": "<p>v2</p>"}}
        detail = await _call(client, env, "POST", f"{base}/history/{entries[1]['id']}/restore")
        assert (detail["status"], detail["sections"]) == (
            "approved",
            {"1.1": {"content": "<p>v1</p>"}},
        )
        kinds = [e["kind"] for e in (await _history(client, env, soaw["id"]))["entries"]]
        assert kinds == ["restored", "save", "created"]

    async def test_a_revision_opens_with_its_content(self, client, env):
        soaw = await _soaw(client, env)
        base = f"{SOAW}/{soaw['id']}"
        await _call(
            client, env, "POST", f"{base}/request-signatures", json={"user_ids": _ids(env, "one")}
        )
        await _call(client, env, "POST", f"{base}/sign", "one")
        revision = await _call(client, env, "POST", f"{base}/revise", "one")
        (entry,) = (await _history(client, env, revision["id"]))["entries"]
        assert (entry["kind"], entry["actor_name"], entry["has_content"]) == (
            "revised",
            "One",
            True,
        )
        version = await _call(client, env, "GET", f"{SOAW}/{revision['id']}/history/{entry['id']}")
        assert version["content"]["sections"] == {"1.1": {"content": "<p>v1</p>"}}
