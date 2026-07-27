"""Integration tests for the repository-wide Resource endpoints.

Covers ``GET /resources``, ``GET /resources/stats`` and
``POST /resources/bulk-delete``. Requires a PostgreSQL test database.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select
from sqlalchemy.engine import Engine

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.document import Document
from app.models.event import Event
from app.models.file_attachment import FileAttachment
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

BASE = "/api/v1/resources"

# Deterministic timeline so ordering assertions don't depend on clock skew.
T0 = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


async def _add_file(
    db, card, *, name, size, category=None, mime="application/pdf", at=None, by=None
):
    row = FileAttachment(
        card_id=card.id,
        name=name,
        mime_type=mime,
        size=size,
        data=b"x" * size,
        category=category,
        created_by=by,
        created_at=at or T0,
    )
    db.add(row)
    await db.flush()
    return row


async def _add_link(db, card, *, name, url, type_="documentation", at=None, by=None):
    row = Document(
        card_id=card.id,
        name=name,
        url=url,
        type=type_,
        created_by=by,
        created_at=at or T0,
    )
    db.add(row)
    await db.flush()
    return row


@pytest.fixture
async def res_env(db):
    """Two cards of different types carrying three files and two links."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_role(
        db,
        key="nodocs",
        label="No documents",
        permissions={**VIEWER_PERMISSIONS, "documents.view": False},
        is_system=False,
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    nodocs = await create_user(db, email="nodocs@test.com", role="nodocs")

    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    app_card = await create_card(db, card_type="Application", name="NexaCore", user_id=admin.id)
    itc_card = await create_card(db, card_type="ITComponent", name="Postgres", user_id=admin.id)

    f1 = await _add_file(
        db, app_card, name="contract.pdf", size=300, category="contract", at=T0, by=admin.id
    )
    f2 = await _add_file(
        db,
        app_card,
        name="diagram.png",
        size=200,
        category="architecture",
        mime="image/png",
        at=T0 + timedelta(minutes=1),
        by=admin.id,
    )
    f3 = await _add_file(
        db, itc_card, name="notes.txt", size=100, mime="text/plain", at=T0 + timedelta(minutes=2)
    )
    l1 = await _add_link(
        db,
        app_card,
        name="Runbook",
        url="https://wiki.example.com/runbook",
        at=T0 + timedelta(minutes=3),
        by=admin.id,
    )
    l2 = await _add_link(
        db,
        itc_card,
        name="Security review",
        url="https://wiki.example.com/security",
        type_="security",
        at=T0 + timedelta(minutes=4),
    )
    await db.commit()

    return {
        "admin": admin,
        "viewer": viewer,
        "nodocs": nodocs,
        "app_card": app_card,
        "itc_card": itc_card,
        "files": [f1, f2, f3],
        "links": [l1, l2],
    }


@pytest.fixture
def sql_capture():
    """Capture every SQL statement executed during the test.

    Used to prove the list query never touches ``file_attachments.data``
    — selecting the blob column is the one mistake in this feature that
    would take a large workspace down.
    """
    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(Engine, "before_cursor_execute", _capture)
    yield statements
    sa_event.remove(Engine, "before_cursor_execute", _capture)


# -------------------------------------------------------------------
# Permission gating
# -------------------------------------------------------------------


class TestResourcePermissions:
    async def test_viewer_can_read(self, client, res_env):
        resp = await client.get(BASE, headers=auth_headers(res_env["viewer"]))
        assert resp.status_code == 200

    async def test_role_without_documents_view_is_denied(self, client, res_env):
        headers = auth_headers(res_env["nodocs"])
        assert (await client.get(BASE, headers=headers)).status_code == 403
        assert (await client.get(f"{BASE}/stats", headers=headers)).status_code == 403
        resp = await client.post(
            f"{BASE}/bulk-delete",
            json={"refs": [{"kind": "file", "id": str(res_env["files"][0].id)}]},
            headers=headers,
        )
        assert resp.status_code == 403

    async def test_unauthenticated_is_rejected(self, client, res_env):
        assert (await client.get(BASE)).status_code in (401, 403)


# -------------------------------------------------------------------
# GET /resources — shape, pagination, sorting
# -------------------------------------------------------------------


class TestResourceList:
    async def test_returns_both_kinds_with_correct_shape(self, client, res_env):
        resp = await client.get(f"{BASE}?page_size=200", headers=auth_headers(res_env["admin"]))
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 5
        assert {i["kind"] for i in body["items"]} == {"file", "link"}

        by_name = {i["name"]: i for i in body["items"]}
        pdf = by_name["contract.pdf"]
        assert pdf["kind"] == "file"
        assert pdf["size"] == 300
        assert pdf["mime_type"] == "application/pdf"
        assert pdf["url"] is None
        assert pdf["card_name"] == "NexaCore"
        assert pdf["card_type"] == "Application"
        assert pdf["card_archived"] is False
        assert pdf["creator_name"] == "Test User"

        link = by_name["Runbook"]
        assert link["kind"] == "link"
        assert link["size"] is None
        assert link["mime_type"] is None
        assert link["url"] == "https://wiki.example.com/runbook"

    async def test_never_selects_the_blob_column(self, client, res_env, sql_capture):
        resp = await client.get(f"{BASE}?page_size=200", headers=auth_headers(res_env["admin"]))
        assert resp.status_code == 200

        offending = [s for s in sql_capture if "file_attachments.data" in s]
        assert not offending, f"list query loaded the blob column: {offending[:1]}"

        for item in resp.json()["items"]:
            assert "data" not in item

    async def test_stats_never_selects_the_blob_column(self, client, res_env, sql_capture):
        resp = await client.get(f"{BASE}/stats", headers=auth_headers(res_env["admin"]))
        assert resp.status_code == 200
        assert not [s for s in sql_capture if "file_attachments.data" in s]

    async def test_default_sort_is_created_at_desc(self, client, res_env):
        resp = await client.get(f"{BASE}?page_size=200", headers=auth_headers(res_env["admin"]))
        names = [i["name"] for i in resp.json()["items"]]
        assert names == [
            "Security review",
            "Runbook",
            "notes.txt",
            "diagram.png",
            "contract.pdf",
        ]

    async def test_pagination_walks_the_union_without_gaps_or_repeats(self, client, res_env):
        headers = auth_headers(res_env["admin"])
        seen: list[str] = []
        for page in (1, 2, 3):
            resp = await client.get(f"{BASE}?page={page}&page_size=2", headers=headers)
            assert resp.status_code == 200
            body = resp.json()
            assert body["total"] == 5  # total is the full result set on every page
            seen.extend(f"{i['kind']}:{i['id']}" for i in body["items"])
        assert len(seen) == 5
        assert len(set(seen)) == 5

    async def test_identical_timestamps_paginate_stably(self, client, db, res_env):
        """created_at collides after bulk imports; the id tie-break keeps
        paging deterministic."""
        card = res_env["app_card"]
        same = T0 + timedelta(hours=1)
        await _add_file(db, card, name="tie-a.pdf", size=10, at=same)
        await _add_file(db, card, name="tie-b.pdf", size=10, at=same)
        await db.commit()

        headers = auth_headers(res_env["admin"])
        seen: list[str] = []
        for page in (1, 2):
            resp = await client.get(f"{BASE}?page={page}&page_size=1", headers=headers)
            seen.append(resp.json()["items"][0]["id"])
        assert len(set(seen)) == 2

    async def test_sort_by_size_puts_links_last(self, client, res_env):
        resp = await client.get(
            f"{BASE}?sort_by=size&sort_dir=desc&page_size=200",
            headers=auth_headers(res_env["admin"]),
        )
        sizes = [i["size"] for i in resp.json()["items"]]
        assert sizes[:3] == [300, 200, 100]
        assert sizes[3:] == [None, None]

    async def test_unknown_sort_key_falls_back(self, client, res_env):
        resp = await client.get(
            f"{BASE}?sort_by=data&page_size=200", headers=auth_headers(res_env["admin"])
        )
        assert resp.status_code == 200
        assert resp.json()["items"][0]["name"] == "Security review"


# -------------------------------------------------------------------
# GET /resources — filters
# -------------------------------------------------------------------


class TestResourceFilters:
    async def test_kind(self, client, res_env):
        headers = auth_headers(res_env["admin"])
        files = await client.get(f"{BASE}?kind=file&page_size=200", headers=headers)
        assert files.json()["total"] == 3
        links = await client.get(f"{BASE}?kind=link&page_size=200", headers=headers)
        assert links.json()["total"] == 2

    async def test_card_type(self, client, res_env):
        resp = await client.get(
            f"{BASE}?card_type=ITComponent&page_size=200", headers=auth_headers(res_env["admin"])
        )
        assert {i["name"] for i in resp.json()["items"]} == {"notes.txt", "Security review"}

    async def test_card_id(self, client, res_env):
        resp = await client.get(
            f"{BASE}?card_id={res_env['app_card'].id}&page_size=200",
            headers=auth_headers(res_env["admin"]),
        )
        assert resp.json()["total"] == 3

    async def test_category_matches_file_category_and_link_type(self, client, res_env):
        headers = auth_headers(res_env["admin"])
        resp = await client.get(f"{BASE}?category=contract&category=security", headers=headers)
        assert {i["name"] for i in resp.json()["items"]} == {"contract.pdf", "Security review"}

    async def test_mime_type_drops_the_link_branch(self, client, res_env):
        resp = await client.get(
            f"{BASE}?mime_type=image/png&page_size=200", headers=auth_headers(res_env["admin"])
        )
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["name"] == "diagram.png"

    async def test_created_by(self, client, res_env):
        resp = await client.get(
            f"{BASE}?created_by={res_env['admin'].id}&page_size=200",
            headers=auth_headers(res_env["admin"]),
        )
        # f3 and l2 were created without an author.
        assert resp.json()["total"] == 3

    async def test_date_range(self, client, res_env):
        since = quote((T0 + timedelta(minutes=2)).isoformat(), safe="")
        resp = await client.get(
            f"{BASE}?since={since}&page_size=200", headers=auth_headers(res_env["admin"])
        )
        assert {i["name"] for i in resp.json()["items"]} == {
            "notes.txt",
            "Runbook",
            "Security review",
        }

    async def test_search_matches_name_card_name_and_url(self, client, res_env):
        headers = auth_headers(res_env["admin"])
        by_name = await client.get(f"{BASE}?search=contract", headers=headers)
        assert {i["name"] for i in by_name.json()["items"]} == {"contract.pdf"}

        by_card = await client.get(f"{BASE}?search=NexaCore&page_size=200", headers=headers)
        assert by_card.json()["total"] == 3

        by_url = await client.get(f"{BASE}?search=runbook", headers=headers)
        assert {i["name"] for i in by_url.json()["items"]} == {"Runbook"}

    async def test_search_escapes_like_wildcards(self, client, db, res_env):
        await _add_file(db, res_env["app_card"], name="100%_report.pdf", size=50)
        await db.commit()

        resp = await client.get(
            f"{BASE}?search=100%25&page_size=200", headers=auth_headers(res_env["admin"])
        )
        assert {i["name"] for i in resp.json()["items"]} == {"100%_report.pdf"}

    async def test_archived_filter(self, client, db, res_env):
        card = res_env["itc_card"]
        card.archived_at = datetime.now(timezone.utc)
        await db.commit()

        headers = auth_headers(res_env["admin"])
        # Archived resources are visible by default — their blobs still
        # occupy storage, so hiding them would make the totals lie.
        default = await client.get(f"{BASE}?page_size=200", headers=headers)
        assert default.json()["total"] == 5
        assert any(i["card_archived"] for i in default.json()["items"])

        active = await client.get(f"{BASE}?archived=active&page_size=200", headers=headers)
        assert active.json()["total"] == 3

        archived = await client.get(f"{BASE}?archived=archived&page_size=200", headers=headers)
        assert archived.json()["total"] == 2


# -------------------------------------------------------------------
# GET /resources/stats
# -------------------------------------------------------------------


class TestResourceStats:
    async def test_totals(self, client, res_env):
        body = (await client.get(f"{BASE}/stats", headers=auth_headers(res_env["admin"]))).json()
        assert body["file_count"] == 3
        assert body["link_count"] == 2
        assert body["total_bytes"] == 600
        assert body["card_count"] == 2

    async def test_breakdowns(self, client, res_env):
        body = (await client.get(f"{BASE}/stats", headers=auth_headers(res_env["admin"]))).json()

        by_cat = {b["key"]: b for b in body["by_category"]}
        assert by_cat["contract"]["count"] == 1
        assert by_cat["contract"]["bytes"] == 300
        assert by_cat[None]["count"] == 1  # notes.txt has no category

        by_link = {b["key"]: b["count"] for b in body["by_link_type"]}
        assert by_link == {"documentation": 1, "security": 1}

        by_type = {b["key"]: b for b in body["by_card_type"]}
        assert by_type["Application"]["file_count"] == 2
        assert by_type["Application"]["link_count"] == 1
        assert by_type["Application"]["bytes"] == 500
        assert by_type["ITComponent"]["file_count"] == 1
        assert by_type["ITComponent"]["link_count"] == 1

    async def test_largest_files_ordered_desc(self, client, res_env):
        body = (await client.get(f"{BASE}/stats", headers=auth_headers(res_env["admin"]))).json()
        assert [f["name"] for f in body["largest_files"]] == [
            "contract.pdf",
            "diagram.png",
            "notes.txt",
        ]
        assert body["largest_files"][0]["card_name"] == "NexaCore"

    async def test_stats_honour_the_same_filters_as_the_list(self, client, res_env):
        headers = auth_headers(res_env["admin"])

        links_only = (await client.get(f"{BASE}/stats?kind=link", headers=headers)).json()
        assert links_only["file_count"] == 0
        assert links_only["total_bytes"] == 0
        assert links_only["link_count"] == 2

        one_type = (await client.get(f"{BASE}/stats?card_type=ITComponent", headers=headers)).json()
        assert one_type["file_count"] == 1
        assert one_type["total_bytes"] == 100
        assert one_type["card_count"] == 1


# -------------------------------------------------------------------
# POST /resources/bulk-delete
# -------------------------------------------------------------------


class TestResourceBulkDelete:
    async def test_deletes_mixed_kinds(self, client, db, res_env):
        file_id = res_env["files"][0].id
        link_id = res_env["links"][0].id

        resp = await client.post(
            f"{BASE}/bulk-delete",
            json={
                "refs": [
                    {"kind": "file", "id": str(file_id)},
                    {"kind": "link", "id": str(link_id)},
                ]
            },
            headers=auth_headers(res_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == {"deleted": 2, "skipped": []}

        assert (
            await db.execute(select(FileAttachment).where(FileAttachment.id == file_id))
        ).scalar_one_or_none() is None
        assert (
            await db.execute(select(Document).where(Document.id == link_id))
        ).scalar_one_or_none() is None

    async def test_emits_the_same_events_as_single_row_delete(self, client, db, res_env):
        file_row = res_env["files"][0]
        link_row = res_env["links"][0]

        await client.post(
            f"{BASE}/bulk-delete",
            json={
                "refs": [
                    {"kind": "file", "id": str(file_row.id)},
                    {"kind": "link", "id": str(link_row.id)},
                ]
            },
            headers=auth_headers(res_env["admin"]),
        )

        events = (
            (
                await db.execute(
                    select(Event).where(Event.event_type.in_(["file.deleted", "document.removed"]))
                )
            )
            .scalars()
            .all()
        )
        by_type = {e.event_type: e for e in events}
        assert set(by_type) == {"file.deleted", "document.removed"}

        file_event = by_type["file.deleted"]
        assert file_event.card_id == file_row.card_id
        assert file_event.data["name"] == "contract.pdf"
        assert file_event.data["size"] == 300
        assert file_event.data["summary"] == "contract.pdf"

        link_event = by_type["document.removed"]
        assert link_event.card_id == link_row.card_id
        assert link_event.data["url"] == "https://wiki.example.com/runbook"
        assert link_event.data["type"] == "documentation"

    async def test_unknown_id_is_skipped_not_fatal(self, client, res_env):
        ghost = uuid.uuid4()
        resp = await client.post(
            f"{BASE}/bulk-delete",
            json={
                "refs": [
                    {"kind": "file", "id": str(res_env["files"][0].id)},
                    {"kind": "file", "id": str(ghost)},
                ]
            },
            headers=auth_headers(res_env["admin"]),
        )
        body = resp.json()
        assert body["deleted"] == 1
        assert body["skipped"] == [{"id": str(ghost), "kind": "file", "reason": "Not found"}]

    async def test_partial_permission_skips_rows_the_caller_cannot_delete(
        self, client, db, res_env
    ):
        """A stakeholder with card.manage_documents on one card only may
        delete that card's resources; the rest come back as skipped."""
        await create_stakeholder_role_def(
            db,
            card_type_key="Application",
            key="responsible",
            label="Responsible",
            permissions={"card.manage_documents": True},
        )
        steward = await create_user(db, email="steward@test.com", role="viewer")

        from app.models.stakeholder import Stakeholder

        db.add(Stakeholder(card_id=res_env["app_card"].id, user_id=steward.id, role="responsible"))
        await db.commit()

        allowed = res_env["files"][0].id  # on app_card
        denied = res_env["files"][2].id  # on itc_card

        resp = await client.post(
            f"{BASE}/bulk-delete",
            json={
                "refs": [
                    {"kind": "file", "id": str(allowed)},
                    {"kind": "file", "id": str(denied)},
                ]
            },
            headers=auth_headers(steward),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] == 1
        assert [s["id"] for s in body["skipped"]] == [str(denied)]
        assert "permission" in body["skipped"][0]["reason"].lower()

        assert (
            await db.execute(select(FileAttachment).where(FileAttachment.id == denied))
        ).scalar_one_or_none() is not None

    async def test_empty_selection_is_rejected(self, client, res_env):
        resp = await client.post(
            f"{BASE}/bulk-delete", json={"refs": []}, headers=auth_headers(res_env["admin"])
        )
        assert resp.status_code == 422

    async def test_oversized_selection_is_rejected(self, client, res_env):
        refs = [{"kind": "file", "id": str(uuid.uuid4())} for _ in range(501)]
        resp = await client.post(
            f"{BASE}/bulk-delete", json={"refs": refs}, headers=auth_headers(res_env["admin"])
        )
        assert resp.status_code == 422
