"""Record provenance: ``created_via`` / ``updated_via`` on every record MCP can
create — cards, diagrams, risks, ADRs, SoAWs, comments and BPM flow versions.

The person stays in ``created_by`` / ``updated_by``; the channel is stamped from
the request's ``X-Turbo-EA-Origin`` header by ``ProvenanceMixin``. Each test
creates through MCP, reads the record back, then edits it from the web UI:
``updated_via`` flips, ``created_via`` does not.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

BPMN = """<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d1">
  <process id="Process_1" isExecutable="false">
    <task id="t1" name="{name}" />
  </process>
</definitions>
"""


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    admin = await create_user(db, email="admin@test.com", role="admin", display_name="Ada Admin")
    editor = await create_user(
        db, email="editor@test.com", role="admin", display_name="Eddie Editor"
    )
    process = await create_card(
        db, card_type="BusinessProcess", name="Order to Cash", user_id=admin.id
    )
    return {"admin": admin, "editor": editor, "process": process}


def _mcp(user) -> dict[str, str]:
    return {**auth_headers(user), "X-Turbo-EA-Origin": "mcp"}


def _web(user) -> dict[str, str]:
    return {**auth_headers(user), "X-Turbo-EA-Origin": "web"}


def _via(row: dict) -> tuple[str | None, str | None]:
    return row["created_via"], row["updated_via"]


# ---------------------------------------------------------------------------
# Cards
# ---------------------------------------------------------------------------


class TestCards:
    async def test_mcp_create_then_web_edit(self, client, env):
        admin, editor = env["admin"], env["editor"]
        created = await client.post(
            "/api/v1/cards", json={"type": "Application", "name": "Agent App"}, headers=_mcp(admin)
        )
        assert created.status_code == 201, created.text
        assert _via(created.json()) == ("mcp", "mcp")
        cid = created.json()["id"]

        got = (await client.get(f"/api/v1/cards/{cid}", headers=_web(admin))).json()
        assert _via(got) == ("mcp", "mcp")
        assert (got["created_by_name"], got["updated_by_name"]) == ("Ada Admin", "Ada Admin")

        edited = await client.patch(
            f"/api/v1/cards/{cid}", json={"name": "Agent App v2"}, headers=_web(editor)
        )
        assert edited.status_code == 200, edited.text
        assert _via(edited.json()) == ("mcp", "web")

        got = (await client.get(f"/api/v1/cards/{cid}", headers=_web(admin))).json()
        assert _via(got) == ("mcp", "web")
        assert (got["created_by_name"], got["updated_by_name"]) == ("Ada Admin", "Eddie Editor")

    async def test_a_request_without_the_header_is_api(self, client, env):
        created = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Scripted"},
            headers=auth_headers(env["admin"]),
        )
        assert created.status_code == 201, created.text
        assert _via(created.json()) == ("api", "api")

    async def test_a_card_from_before_the_feature_carries_nothing(self, client, db, env):
        # A pre-157 row: NULL channel and, here, no recorded people either.
        card = await create_card(db, card_type="Application", name="Legacy")
        card.created_via = None
        card.updated_via = None
        await db.flush()

        got = (await client.get(f"/api/v1/cards/{card.id}", headers=_web(env["admin"]))).json()
        assert _via(got) == (None, None)
        assert (got["created_by_name"], got["updated_by_name"]) == (None, None)

    async def test_list_filters_by_creation_channel(self, client, env):
        admin = env["admin"]
        for name, headers in (("Via MCP", _mcp(admin)), ("Via web", _web(admin))):
            resp = await client.post(
                "/api/v1/cards", json={"type": "Application", "name": name}, headers=headers
            )
            assert resp.status_code == 201, resp.text

        resp = await client.get(
            "/api/v1/cards?type=Application&created_via=mcp", headers=_web(admin)
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [c["name"] for c in body["items"]] == ["Via MCP"]
        assert body["total"] == 1

        resp = await client.get(
            "/api/v1/cards?type=Application&created_via=web", headers=_web(admin)
        )
        assert [c["name"] for c in resp.json()["items"]] == ["Via web"]
        assert resp.json()["total"] == 1

        resp = await client.get("/api/v1/cards?type=Application", headers=_web(admin))
        assert resp.json()["total"] == 2

    async def test_list_sorts_by_creation_channel(self, client, env):
        admin = env["admin"]
        for name, headers in (("A web", _web(admin)), ("B mcp", _mcp(admin))):
            await client.post(
                "/api/v1/cards", json={"type": "Application", "name": name}, headers=headers
            )
        resp = await client.get(
            "/api/v1/cards?type=Application&sort_by=created_via&sort_dir=asc",
            headers=_web(admin),
        )
        assert [c["name"] for c in resp.json()["items"]] == ["B mcp", "A web"]

    async def test_an_unknown_channel_is_rejected(self, client, env):
        resp = await client.get("/api/v1/cards?created_via=robot", headers=_web(env["admin"]))
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Diagrams
# ---------------------------------------------------------------------------


async def test_diagram_mcp_create_then_web_edit(client, env):
    admin = env["admin"]
    created = await client.post(
        "/api/v1/diagrams",
        json={"name": "Agent canvas", "data": {"xml": "<mxGraphModel/>"}},
        headers=_mcp(admin),
    )
    assert created.status_code == 201, created.text
    assert _via(created.json()) == ("mcp", "mcp")
    did = created.json()["id"]

    got = (await client.get(f"/api/v1/diagrams/{did}", headers=_web(admin))).json()
    assert _via(got) == ("mcp", "mcp")
    listed = (await client.get("/api/v1/diagrams", headers=_web(admin))).json()
    assert [_via(d) for d in listed if d["id"] == did] == [("mcp", "mcp")]

    edited = await client.patch(
        f"/api/v1/diagrams/{did}", json={"name": "Renamed"}, headers=_web(admin)
    )
    assert edited.status_code == 200, edited.text
    assert _via(edited.json()) == ("mcp", "web")
    got = (await client.get(f"/api/v1/diagrams/{did}", headers=_web(admin))).json()
    assert _via(got) == ("mcp", "web")


# ---------------------------------------------------------------------------
# Risks
# ---------------------------------------------------------------------------


async def test_risk_mcp_create_then_web_edit(client, env):
    admin = env["admin"]
    created = await client.post(
        "/api/v1/risks", json={"title": "Vendor lock-in"}, headers=_mcp(admin)
    )
    assert created.status_code == 200, created.text
    assert _via(created.json()) == ("mcp", "mcp")
    rid = created.json()["id"]

    got = (await client.get(f"/api/v1/risks/{rid}", headers=_web(admin))).json()
    assert _via(got) == ("mcp", "mcp")

    edited = await client.patch(
        f"/api/v1/risks/{rid}", json={"title": "Vendor lock-in (AWS)"}, headers=_web(admin)
    )
    assert edited.status_code == 200, edited.text
    assert _via(edited.json()) == ("mcp", "web")


# ---------------------------------------------------------------------------
# ADRs
# ---------------------------------------------------------------------------


async def test_adr_mcp_create_then_web_edit(client, env):
    admin = env["admin"]
    created = await client.post("/api/v1/adr", json={"title": "Use Postgres"}, headers=_mcp(admin))
    assert created.status_code == 201, created.text
    assert _via(created.json()) == ("mcp", "mcp")
    aid = created.json()["id"]

    got = (await client.get(f"/api/v1/adr/{aid}", headers=_web(admin))).json()
    assert _via(got) == ("mcp", "mcp")
    listed = (await client.get("/api/v1/adr", headers=_web(admin))).json()
    assert [_via(a) for a in listed if a["id"] == aid] == [("mcp", "mcp")]

    edited = await client.patch(
        f"/api/v1/adr/{aid}", json={"title": "Use PostgreSQL"}, headers=_web(admin)
    )
    assert edited.status_code == 200, edited.text
    assert _via(edited.json()) == ("mcp", "web")


# ---------------------------------------------------------------------------
# SoAWs
# ---------------------------------------------------------------------------


async def test_soaw_mcp_create_then_web_edit(client, env):
    admin = env["admin"]
    created = await client.post(
        "/api/v1/soaw", json={"name": "Cloud migration"}, headers=_mcp(admin)
    )
    assert created.status_code == 201, created.text
    assert _via(created.json()) == ("mcp", "mcp")
    sid = created.json()["id"]

    got = (await client.get(f"/api/v1/soaw/{sid}", headers=_web(admin))).json()
    assert _via(got) == ("mcp", "mcp")

    edited = await client.patch(
        f"/api/v1/soaw/{sid}", json={"name": "Cloud migration 2027"}, headers=_web(admin)
    )
    assert edited.status_code == 200, edited.text
    assert _via(edited.json()) == ("mcp", "web")


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


async def test_comment_mcp_create_then_web_edit(client, env):
    admin, process = env["admin"], env["process"]
    created = await client.post(
        f"/api/v1/cards/{process.id}/comments",
        json={"content": "Drafted by the agent"},
        headers=_mcp(admin),
    )
    assert created.status_code == 201, created.text
    assert _via(created.json()) == ("mcp", "mcp")
    comment_id = created.json()["id"]

    listed = (await client.get(f"/api/v1/cards/{process.id}/comments", headers=_web(admin))).json()
    assert [_via(c) for c in listed if c["id"] == comment_id] == [("mcp", "mcp")]

    edited = await client.patch(
        f"/api/v1/comments/{comment_id}", json={"content": "Reviewed"}, headers=_web(admin)
    )
    assert edited.status_code == 200, edited.text
    assert _via(edited.json()) == ("mcp", "web")


# ---------------------------------------------------------------------------
# BPM flow versions
# ---------------------------------------------------------------------------


async def test_flow_version_mcp_create_then_web_edit(client, env):
    admin, pid = env["admin"], env["process"].id
    created = await client.post(
        f"/api/v1/bpm/processes/{pid}/flow/drafts",
        json={"bpmn_xml": BPMN.format(name="Quote")},
        headers=_mcp(admin),
    )
    assert created.status_code == 201, created.text
    assert _via(created.json()) == ("mcp", "mcp")
    vid = created.json()["id"]

    got = (
        await client.get(f"/api/v1/bpm/processes/{pid}/flow/versions/{vid}", headers=_web(admin))
    ).json()
    assert _via(got) == ("mcp", "mcp")

    edited = await client.patch(
        f"/api/v1/bpm/processes/{pid}/flow/versions/{vid}",
        json={"bpmn_xml": BPMN.format(name="Invoice")},
        headers=_web(admin),
    )
    assert edited.status_code == 200, edited.text
    assert _via(edited.json()) == ("mcp", "web")
