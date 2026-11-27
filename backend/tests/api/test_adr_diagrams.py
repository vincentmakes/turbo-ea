"""Diagrams on a decision over the API: live links to free-draw diagrams.

``POST /adr/{id}/diagrams`` / ``DELETE /adr/{id}/diagrams/{diagram_id}`` and
``linked_diagram_ids`` on create and PATCH. Every path needs ``adr.manage``
(403), an existing decision (404) and a decision that is not signed (403;
draft and in review may change links); a caller without ``diagrams.view``
sees no diagram, so to them no link exists (404, and an empty list changes
nothing). The detail payload lists ``diagrams`` as ``{id, name, thumbnail,
updated_at}`` for a reader with ``diagrams.view`` only.
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import func, select

from app.models.architecture_decision_diagram import ArchitectureDecisionDiagram
from app.services.adr_diagram_service import MAX_THUMBNAIL_CHARS
from tests.conftest import (
    auth_headers,
    create_card,
    create_diagram,
    create_role,
    create_user,
)

URL = "/api/v1/adr"
SVG = "data:image/svg+xml;base64,PHN2Zy8+"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    # Manages decisions but may not see diagrams.
    await create_role(
        db,
        key="nodiag",
        label="No diagrams",
        permissions={"adr.view": True, "adr.manage": True},
    )
    # Sees decisions and diagrams but may not manage decisions.
    await create_role(
        db,
        key="reader",
        label="Reader",
        permissions={"adr.view": True, "diagrams.view": True},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    card = await create_card(db, name="Sentinel Card")
    return {
        "admin": admin,
        "nodiag": await create_user(db, email="nodiag@test.com", role="nodiag"),
        "reader": await create_user(db, email="reader@test.com", role="reader"),
        "card": card,
        "alpha": await create_diagram(
            db,
            name="Alpha",
            data={"xml": "<mxGraphModel>SECRET-XML</mxGraphModel>", "thumbnail": SVG},
            card_ids=[card.id],
        ),
        "beta": await create_diagram(db, name="Beta", data={"xml": "<x/>"}),
        "gamma": await create_diagram(db, name="Gamma", data={"xml": "<x/>"}),
    }


async def _create(client, user, **body) -> dict:
    resp = await client.post(URL, json={"title": "Decision", **body}, headers=auth_headers(user))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _detail(client, user, adr_id) -> dict:
    resp = await client.get(f"{URL}/{adr_id}", headers=auth_headers(user))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _link(client, user, adr_id, diagram_id):
    return await client.post(
        f"{URL}/{adr_id}/diagrams",
        json={"diagram_id": str(diagram_id)},
        headers=auth_headers(user),
    )


async def _unlink(client, user, adr_id, diagram_id):
    return await client.delete(f"{URL}/{adr_id}/diagrams/{diagram_id}", headers=auth_headers(user))


async def _patch(client, user, adr_id, ids):
    return await client.patch(
        f"{URL}/{adr_id}",
        json={"linked_diagram_ids": [str(i) for i in ids]},
        headers=auth_headers(user),
    )


async def _to_review(client, admin, adr_id) -> None:
    resp = await client.post(
        f"{URL}/{adr_id}/request-signatures",
        json={"user_ids": [str(admin.id)]},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "in_review"


async def _sign(client, admin, adr_id) -> None:
    await _to_review(client, admin, adr_id)
    resp = await client.post(f"{URL}/{adr_id}/sign", headers=auth_headers(admin))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "signed"


def _ids(payload: dict) -> list[str]:
    return [d["id"] for d in payload["diagrams"]]


async def _rows(db, adr_id) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(ArchitectureDecisionDiagram)
            .where(ArchitectureDecisionDiagram.architecture_decision_id == uuid.UUID(adr_id))
        )
    ).scalar_one()


class TestLinkAndRead:
    async def test_link_returns_the_detail_with_the_diagram(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin)
        assert adr["diagrams"] == []

        resp = await _link(client, admin, adr["id"], env["alpha"].id)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["id"] == adr["id"]
        (row,) = body["diagrams"]
        assert set(row) == {"id", "name", "thumbnail", "updated_at"}
        assert row["id"] == str(env["alpha"].id)
        assert row["name"] == "Alpha"
        assert row["thumbnail"] == SVG
        assert row["updated_at"] == env["alpha"].updated_at.isoformat()

        # A reader with diagrams.view and no adr.manage sees the same list.
        assert (await _detail(client, env["reader"], adr["id"]))["diagrams"] == body["diagrams"]

    async def test_ordered_by_name_then_id(self, client, db, env):
        admin = env["admin"]
        twin_a = await create_diagram(db, name="Alpha")
        adr = await _create(client, admin)
        for d in (env["gamma"], twin_a, env["beta"], env["alpha"]):
            assert (await _link(client, admin, adr["id"], d.id)).status_code == 201
        alphas = sorted([str(env["alpha"].id), str(twin_a.id)])
        assert _ids(await _detail(client, admin, adr["id"])) == [
            *alphas,
            str(env["beta"].id),
            str(env["gamma"].id),
        ]

    async def test_no_xml_and_no_card_ids_in_the_payload(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        text = json.dumps(await _detail(client, admin, adr["id"]))
        assert "SECRET-XML" not in text
        assert "card_ids" not in text
        assert str(env["card"].id) not in text

    async def test_reader_without_diagrams_view_sees_an_empty_list(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        assert len((await _detail(client, admin, adr["id"]))["diagrams"]) == 1
        payload = await _detail(client, env["nodiag"], adr["id"])
        assert payload["diagrams"] == []
        assert "Alpha" not in json.dumps(payload)

    async def test_lists_and_summaries_carry_no_diagrams(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        listed = await client.get(URL, headers=auth_headers(admin))
        assert listed.status_code == 200
        items = listed.json()
        items = items["items"] if isinstance(items, dict) else items
        assert any(i["id"] == adr["id"] for i in items)
        assert all("diagrams" not in i for i in items)
        revisions = await client.get(f"{URL}/{adr['id']}/revisions", headers=auth_headers(admin))
        assert revisions.status_code == 200
        assert revisions.json()
        assert all("diagrams" not in r for r in revisions.json())


class TestThumbnail:
    async def test_at_the_cap_intact_over_it_null(self, client, db, env):
        admin = env["admin"]
        at_cap = "a" * MAX_THUMBNAIL_CHARS
        fits = await create_diagram(db, name="Fits", data={"thumbnail": at_cap})
        too_big = await create_diagram(db, name="Too big", data={"thumbnail": at_cap + "b"})
        none = await create_diagram(db, name="None", data={"xml": "<x/>"})
        adr = await _create(
            client, admin, linked_diagram_ids=[str(fits.id), str(too_big.id), str(none.id)]
        )
        rows = {d["name"]: d for d in (await _detail(client, admin, adr["id"]))["diagrams"]}
        assert rows["Fits"]["thumbnail"] == at_cap
        assert rows["Too big"]["thumbnail"] is None
        assert rows["Too big"]["id"] == str(too_big.id)
        assert rows["None"]["thumbnail"] is None

    def test_the_cap_is_256_kib(self):
        assert MAX_THUMBNAIL_CHARS == 262144


class TestUnlinkAndReplace:
    async def test_unlink(self, client, db, env):
        admin = env["admin"]
        adr = await _create(
            client, admin, linked_diagram_ids=[str(env["alpha"].id), str(env["beta"].id)]
        )
        resp = await _unlink(client, admin, adr["id"], env["alpha"].id)
        assert resp.status_code == 204
        assert _ids(await _detail(client, admin, adr["id"])) == [str(env["beta"].id)]
        # The diagram itself stays.
        assert (
            await client.get(f"/api/v1/diagrams/{env['alpha'].id}", headers=auth_headers(admin))
        ).status_code == 200

    async def test_patch_replaces_the_set(self, client, env):
        admin = env["admin"]
        adr = await _create(
            client, admin, linked_diagram_ids=[str(env["alpha"].id), str(env["beta"].id)]
        )
        resp = await _patch(client, admin, adr["id"], [env["gamma"].id, env["beta"].id])
        assert resp.status_code == 200, resp.text
        assert _ids(resp.json()) == [str(env["beta"].id), str(env["gamma"].id)]

    async def test_patch_empty_clears_and_omitted_keeps(self, client, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        resp = await client.patch(
            f"{URL}/{adr['id']}", json={"title": "Renamed"}, headers=auth_headers(admin)
        )
        assert resp.status_code == 200
        assert _ids(resp.json()) == [str(env["alpha"].id)]
        resp = await _patch(client, admin, adr["id"], [])
        assert resp.status_code == 200
        assert resp.json()["diagrams"] == []

    async def test_create_with_duplicates_links_once(self, client, db, env):
        admin = env["admin"]
        alpha = str(env["alpha"].id)
        adr = await _create(client, admin, linked_diagram_ids=[alpha, alpha])
        assert _ids(adr) == [alpha]
        assert await _rows(db, adr["id"]) == 1


class TestRefusals:
    async def test_without_adr_manage_403(self, client, env):
        admin, reader = env["admin"], env["reader"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        assert (await _link(client, reader, adr["id"], env["beta"].id)).status_code == 403
        assert (await _unlink(client, reader, adr["id"], env["alpha"].id)).status_code == 403
        assert (await _patch(client, reader, adr["id"], [])).status_code == 403
        assert (await _link(client, reader, uuid.uuid4(), env["beta"].id)).status_code == 403
        resp = await client.post(
            URL,
            json={"title": "X", "linked_diagram_ids": [str(env["beta"].id)]},
            headers=auth_headers(reader),
        )
        assert resp.status_code == 403

    async def test_unknown_decision_404(self, client, env):
        admin = env["admin"]
        missing = uuid.uuid4()
        resp = await _link(client, admin, missing, env["alpha"].id)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Architecture decision not found"
        resp = await _unlink(client, admin, missing, env["alpha"].id)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Architecture decision not found"

    async def test_without_diagrams_view_404(self, client, db, env):
        admin, nodiag = env["admin"], env["nodiag"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        resp = await _link(client, nodiag, adr["id"], env["beta"].id)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Diagram not found"
        resp = await _unlink(client, nodiag, adr["id"], env["alpha"].id)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Diagram not found"
        resp = await _patch(client, nodiag, adr["id"], [env["alpha"].id])
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Diagram not found"
        assert _ids(await _detail(client, admin, adr["id"])) == [str(env["alpha"].id)]

    async def test_create_without_diagrams_view(self, client, db, env):
        nodiag = env["nodiag"]
        resp = await client.post(
            URL,
            json={"title": "Refused", "linked_diagram_ids": [str(env["alpha"].id)]},
            headers=auth_headers(nodiag),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Diagram not found"
        listed = (await client.get(URL, headers=auth_headers(env["admin"]))).json()
        listed = listed["items"] if isinstance(listed, dict) else listed
        assert all(i["title"] != "Refused" for i in listed)
        # An empty list is fine and links nothing.
        adr = await _create(client, nodiag, linked_diagram_ids=[])
        assert await _rows(db, adr["id"]) == 0

    async def test_empty_patch_without_diagrams_view_keeps_links(self, client, db, env):
        admin, nodiag = env["admin"], env["nodiag"]
        adr = await _create(
            client, admin, linked_diagram_ids=[str(env["alpha"].id), str(env["beta"].id)]
        )
        resp = await _patch(client, nodiag, adr["id"], [])
        assert resp.status_code == 200, resp.text
        assert resp.json()["diagrams"] == []
        assert await _rows(db, adr["id"]) == 2
        assert _ids(await _detail(client, admin, adr["id"])) == [
            str(env["alpha"].id),
            str(env["beta"].id),
        ]

    async def test_unknown_and_malformed_diagram_404(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin)
        for bad in (uuid.uuid4(), "not-a-uuid"):
            resp = await _link(client, admin, adr["id"], bad)
            assert resp.status_code == 404, bad
            assert resp.json()["detail"] == "Diagram not found"
            resp = await _unlink(client, admin, adr["id"], bad)
            assert resp.status_code == 404, bad
            assert resp.json()["detail"] == "Diagram not found"
            resp = await _patch(client, admin, adr["id"], [env["alpha"].id, bad])
            assert resp.status_code == 404, bad
            assert resp.json()["detail"] == "Diagram not found"
            resp = await client.post(
                URL,
                json={"title": "X", "linked_diagram_ids": [str(bad)]},
                headers=auth_headers(admin),
            )
            assert resp.status_code == 404, bad
        assert await _rows(db, adr["id"]) == 0

    async def test_duplicate_link_409(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        resp = await _link(client, admin, adr["id"], env["alpha"].id)
        assert resp.status_code == 409
        assert await _rows(db, adr["id"]) == 1

    async def test_unlink_a_diagram_that_is_not_linked_404(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        resp = await _unlink(client, admin, adr["id"], env["beta"].id)
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Link not found"
        assert await _rows(db, adr["id"]) == 1


class TestLock:
    async def test_signed_is_fixed(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        await _sign(client, admin, adr["id"])
        assert (await _link(client, admin, adr["id"], env["beta"].id)).status_code == 403
        assert (await _unlink(client, admin, adr["id"], env["alpha"].id)).status_code == 403
        assert (await _patch(client, admin, adr["id"], [env["beta"].id])).status_code == 403
        # The lock is checked before the diagram gate.
        assert (await _link(client, env["nodiag"], adr["id"], env["beta"].id)).status_code == 403
        assert _ids(await _detail(client, admin, adr["id"])) == [str(env["alpha"].id)]

    async def test_in_review_may_change(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        await _to_review(client, admin, adr["id"])
        resp = await _link(client, admin, adr["id"], env["beta"].id)
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "in_review"
        assert (await _unlink(client, admin, adr["id"], env["alpha"].id)).status_code == 204
        resp = await _patch(client, admin, adr["id"], [env["gamma"].id])
        assert resp.status_code == 200, resp.text
        assert _ids(resp.json()) == [str(env["gamma"].id)]
        # Other fields stay locked in review.
        resp = await client.patch(
            f"{URL}/{adr['id']}",
            json={"title": "X", "linked_diagram_ids": []},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403

    async def test_a_closed_decision_may_change_them_like_one_in_review(self, client, db, env):
        """Linked diagrams are filing: a rejected decision keeps them changeable,
        through the endpoints and PATCH alike, while its content stays locked."""
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        await _to_review(client, admin, adr["id"])
        resp = await client.post(
            f"{URL}/{adr['id']}/reject", json={"comment": "No"}, headers=auth_headers(admin)
        )
        assert resp.json()["outcome"]["kind"] == "rejected"
        resp = await _link(client, admin, adr["id"], env["beta"].id)
        assert resp.status_code == 201, resp.text
        assert (await _unlink(client, admin, adr["id"], env["alpha"].id)).status_code == 204
        resp = await _patch(client, admin, adr["id"], [env["gamma"].id])
        assert resp.status_code == 200, resp.text
        assert _ids(resp.json()) == [str(env["gamma"].id)]
        resp = await client.patch(
            f"{URL}/{adr['id']}",
            json={"title": "X", "linked_diagram_ids": []},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 403


class TestCarriedAndRemoved:
    async def test_revision_carries_the_links(self, client, db, env):
        admin = env["admin"]
        adr = await _create(
            client, admin, linked_diagram_ids=[str(env["alpha"].id), str(env["beta"].id)]
        )
        await _sign(client, admin, adr["id"])
        resp = await client.post(f"{URL}/{adr['id']}/revise", headers=auth_headers(admin))
        assert resp.status_code == 200, resp.text
        revision = resp.json()
        assert revision["id"] != adr["id"]
        assert _ids(revision) == [str(env["alpha"].id), str(env["beta"].id)]
        # The signed original keeps its own.
        assert await _rows(db, adr["id"]) == 2

    async def test_duplicate_carries_the_links(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["beta"].id)])
        resp = await client.post(f"{URL}/{adr['id']}/duplicate", headers=auth_headers(admin))
        assert resp.status_code == 201, resp.text
        assert _ids(resp.json()) == [str(env["beta"].id)]
        assert await _rows(db, resp.json()["id"]) == 1
        assert await _rows(db, adr["id"]) == 1

    async def test_deleting_the_diagram_removes_the_link(self, client, db, env):
        admin = env["admin"]
        adr = await _create(
            client, admin, linked_diagram_ids=[str(env["alpha"].id), str(env["beta"].id)]
        )
        resp = await client.delete(
            f"/api/v1/diagrams/{env['alpha'].id}", headers=auth_headers(admin)
        )
        assert resp.status_code == 204, resp.text
        assert _ids(await _detail(client, admin, adr["id"])) == [str(env["beta"].id)]
        assert await _rows(db, adr["id"]) == 1

    async def test_deleting_the_draft_removes_the_rows(self, client, db, env):
        admin = env["admin"]
        adr = await _create(client, admin, linked_diagram_ids=[str(env["alpha"].id)])
        assert await _rows(db, adr["id"]) == 1
        resp = await client.delete(f"{URL}/{adr['id']}", headers=auth_headers(admin))
        assert resp.status_code == 204
        assert await _rows(db, adr["id"]) == 0
        # The diagram itself stays.
        resp = await client.get(f"/api/v1/diagrams/{env['alpha'].id}", headers=auth_headers(admin))
        assert resp.status_code == 200
