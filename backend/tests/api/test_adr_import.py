"""ADR spreadsheet export data (``GET /adr?include_content=true``) and import
(``POST /adr/bulk-import``).

DB-backed: skipped locally without PostgreSQL, run in CI.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.card_type import CardType
from app.models.event import Event
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

URL = "/api/v1/adr/bulk-import"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
    return {
        "admin": await create_user(db, email="admin@test.com", role="admin"),
        "member": await create_user(db, email="member@test.com", role="member"),
        "viewer": await create_user(db, email="viewer@test.com", role="viewer"),
    }


async def _hide_type_from_members(db, type_key: str) -> None:
    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {"member": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()


async def _decisions(db) -> list[ArchitectureDecision]:
    result = await db.execute(
        select(ArchitectureDecision).order_by(ArchitectureDecision.reference_number)
    )
    return list(result.scalars().all())


async def _import(client, user, items, *, dry_run=False):
    return await client.post(
        URL, json={"items": items, "dry_run": dry_run}, headers=auth_headers(user)
    )


class TestBulkImport:
    async def test_dry_run_previews_without_writing_or_publishing(self, client, db, env):
        resp = await _import(
            client, env["member"], [{"row_index": 0, "title": "Adopt Kafka"}], dry_run=True
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["dry_run"] is True
        assert (body["created"], body["skipped"], body["failed"]) == (1, 0, 0)
        assert body["results"][0]["reference_number"] == "ADR-001"
        assert await _decisions(db) == []
        events = (await db.execute(select(Event))).scalars().all()
        assert [e.event_type for e in events] == []

    async def test_rows_become_drafts_with_sequential_references(self, client, db, env):
        app = await create_card(db, card_type="Application", name="Billing")
        existing = await client.post(
            "/api/v1/adr", json={"title": "Existing"}, headers=auth_headers(env["admin"])
        )
        assert existing.json()["reference_number"] == "ADR-001"

        resp = await _import(
            client,
            env["member"],
            [
                {
                    "row_index": 0,
                    "reference_number": "ADR-042",
                    "title": "  Adopt Kafka ",
                    "context": "<p>Events</p>",
                    "decision": "",
                    "card_names": ["Billing", "Billing", "Nowhere"],
                    "status": "signed",
                },
                {"row_index": 1, "title": "Use Postgres", "status": "Draft"},
            ],
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [(r["status"], r["reference_number"]) for r in body["results"]] == [
            ("created", "ADR-002"),
            ("created", "ADR-003"),
        ]
        assert body["results"][0]["warnings"] == [
            "Card not found: Nowhere",
            "Status 'signed' is not imported; created as a draft",
        ]
        assert body["results"][1]["warnings"] == []

        await db.rollback()
        rows = {d.reference_number: d for d in await _decisions(db)}
        kafka = rows["ADR-002"]
        assert (kafka.title, kafka.status, kafka.context, kafka.decision) == (
            "Adopt Kafka",
            "draft",
            "<p>Events</p>",
            None,
        )
        assert kafka.created_by == env["member"].id
        links = (
            (
                await db.execute(
                    select(ArchitectureDecisionCard.card_id).where(
                        ArchitectureDecisionCard.architecture_decision_id == kafka.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert links == [app.id]
        created_events = (
            (await db.execute(select(Event).where(Event.event_type == "adr.created")))
            .scalars()
            .all()
        )
        assert len(created_events) == 3  # the API create + two imported rows

    async def test_existing_references_are_skipped(self, client, db, env):
        await client.post(
            "/api/v1/adr", json={"title": "Existing"}, headers=auth_headers(env["admin"])
        )

        resp = await _import(
            client,
            env["member"],
            [{"row_index": 0, "reference_number": "adr-001", "title": "Renamed in Excel"}],
        )

        body = resp.json()
        assert body["results"][0]["status"] == "skipped"
        assert body["results"][0]["reference_number"] == "ADR-001"
        assert (body["created"], body["skipped"]) == (0, 1)
        await db.rollback()
        assert [d.title for d in await _decisions(db)] == ["Existing"]

    async def test_bad_rows_fail_alone(self, client, db, env):
        resp = await _import(
            client,
            env["member"],
            [
                {"row_index": 0, "title": ""},
                {"row_index": 1, "title": "x" * 501},
                {"row_index": 2, "reference_number": "ADR-900", "title": "First"},
                {"row_index": 3, "reference_number": "adr-900", "title": "Second"},
            ],
        )

        results = resp.json()["results"]
        assert [r["status"] for r in results] == ["failed", "failed", "created", "failed"]
        assert results[0]["error"] == "Title is required"
        assert results[1]["error"] == "Title is longer than 500 characters"
        assert results[3]["error"] == "Reference ADR-900 appears more than once in the file"

    async def test_related_decisions_resolve_against_the_file_and_the_database(
        self, client, db, env
    ):
        existing = await client.post(
            "/api/v1/adr", json={"title": "Existing"}, headers=auth_headers(env["admin"])
        )
        existing_id = existing.json()["id"]

        resp = await _import(
            client,
            env["member"],
            [
                {
                    "row_index": 0,
                    "reference_number": "OLD-1",
                    "title": "First",
                    # A later row of the file, an existing decision, itself,
                    # and a reference nobody has.
                    "related_references": ["old-2", "ADR-001", "OLD-1", "ADR-404"],
                },
                {"row_index": 1, "reference_number": "OLD-2", "title": "Second"},
            ],
        )

        first, second = resp.json()["results"]
        assert first["warnings"] == ["Related decision not found: ADR-404"]
        await db.rollback()
        rows = {d.reference_number: d for d in await _decisions(db)}
        assert rows[first["reference_number"]].related_decisions == [
            second["id"],
            existing_id,
        ]

        listed = await client.get(
            "/api/v1/adr?include_content=true", headers=auth_headers(env["admin"])
        )
        by_ref = {a["reference_number"]: a for a in listed.json()}
        assert by_ref[first["reference_number"]]["related_references"] == [
            second["reference_number"],
            "ADR-001",
        ]

    async def test_a_hidden_card_reads_as_not_found(self, client, db, env):
        await create_card(db, card_type="Initiative", name="Secret programme")
        await _hide_type_from_members(db, "Initiative")

        resp = await _import(
            client,
            env["member"],
            [{"row_index": 0, "title": "Fund it", "card_names": ["Secret programme"]}],
        )

        [result] = resp.json()["results"]
        assert result["status"] == "created"
        assert result["warnings"] == ["Card not found: Secret programme"]

    async def test_an_ambiguous_card_name_is_a_warning(self, client, db, env):
        await create_card(db, card_type="Application", name="Portal")
        await create_card(db, card_type="Initiative", name="Portal")

        resp = await _import(
            client, env["member"], [{"row_index": 0, "title": "X", "card_names": ["Portal"]}]
        )

        assert resp.json()["results"][0]["warnings"] == ["Card name is ambiguous: Portal"]

    async def test_viewer_is_refused(self, client, db, env):
        resp = await _import(client, env["viewer"], [{"row_index": 0, "title": "Nope"}])
        assert resp.status_code == 403
        assert await _decisions(db) == []

    async def test_an_empty_batch_is_rejected(self, client, env):
        resp = await _import(client, env["member"], [])
        assert resp.status_code == 422


class TestIncludeContent:
    async def test_list_carries_sections_only_when_asked(self, client, env):
        headers = auth_headers(env["admin"])
        await client.post(
            "/api/v1/adr",
            json={
                "title": "With content",
                "context": "<p>c</p>",
                "decision": "<p>d</p>",
                "consequences": "<p>q</p>",
                "alternatives_considered": "<p>a</p>",
                "related_decisions": ["ADR-001", "not-a-decision"],
            },
            headers=headers,
        )

        plain = (await client.get("/api/v1/adr", headers=headers)).json()[0]
        assert "context" not in plain
        assert "related_references" not in plain

        full = (await client.get("/api/v1/adr?include_content=true", headers=headers)).json()[0]
        assert full["context"] == "<p>c</p>"
        assert full["decision"] == "<p>d</p>"
        assert full["consequences"] == "<p>q</p>"
        assert full["alternatives_considered"] == "<p>a</p>"
        # A reference the decision itself holds resolves; an unknown entry is dropped.
        assert full["related_references"] == ["ADR-001"]

    async def test_hidden_linked_cards_stay_out(self, client, db, env):
        secret = await create_card(db, card_type="Initiative", name="Secret programme")
        visible = await create_card(db, card_type="Application", name="Billing")
        await client.post(
            "/api/v1/adr",
            json={"title": "Linked", "linked_card_ids": [str(secret.id), str(visible.id)]},
            headers=auth_headers(env["admin"]),
        )
        await _hide_type_from_members(db, "Initiative")

        resp = await client.get(
            "/api/v1/adr?include_content=true", headers=auth_headers(env["member"])
        )

        assert resp.status_code == 200
        assert [c["name"] for c in resp.json()[0]["linked_cards"]] == ["Billing"]
        assert "Secret programme" not in resp.text
