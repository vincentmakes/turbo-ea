"""Mentions of cards and decisions in decision and SoAW text, end to end.

- Write: a new mention must name a card the writer can read (module mode) or
  a decision while holding ``adr.view`` — 404 otherwise; a person in a
  document is collapsed to text; a restricted reader's save keeps the hidden
  mention through its token; a token copied into another document is dropped.
- Read: every response is resolved for its reader — a hidden card shows as a
  token with no id and no name on GET and non-GET responses alike (R10);
  labels follow renames; archived cards are flagged; deleted ones missing.
- The importer fails only the row whose mention is refused.
- "Mentioned in" for a card and for a decision.
- The list endpoint resolves every row in one batch.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import Engine, select
from sqlalchemy import event as sa_event

from app.core.permissions import ALL_APP_PERMISSION_KEYS
from app.models.architecture_decision import ArchitectureDecision
from app.models.card_type import CardType
from app.models.document_comment import DocumentComment
from app.models.soaw import SoAW
from app.services import mention_service
from app.services.permission_service import PermissionService
from tests.conftest import auth_headers, create_card, create_card_type, create_role, create_user

ADR = "/api/v1/adr"
SOAW = "/api/v1/soaw"
HIDDEN = "ZZHIDDENMENTION"


def span(kind: str, mention_id) -> str:
    return f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}"></span>'


def restricted(doc_id, kind: str, mention_id) -> str:
    token = mention_service.token_for(doc_id, kind, mention_id)
    return (
        f'<span data-type="mention" data-kind="{kind}" data-restricted="true" '
        f'data-token="{token}"></span>'
    )


@pytest.fixture(autouse=True)
def _deliveries_stay_in_the_test_session(patched_async_session):
    """A comment's notifications are delivered after the commit by
    ``deliver_notification_batch``, which opens its own session: hand it the
    test's, so it never reaches the real database."""


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    everything = {k: True for k in ALL_APP_PERMISSION_KEYS if not k.startswith("admin.")}
    await create_role(db, key="restricted", label="Restricted", permissions=everything)
    await create_role(
        db,
        key="soaw_only",
        label="SoAW only",
        permissions={
            "soaw.view": True,
            "soaw.manage": True,
            "soaw.comment": True,
            "inventory.view": True,
        },
    )
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Secret", label="Secret")
    admin = await create_user(db, email="admin@m.test", role="admin", display_name="Ada")
    reader = await create_user(db, email="reader@m.test", role="restricted", display_name="Rex")
    soawer = await create_user(db, email="soaw@m.test", role="soaw_only", display_name="Sam")
    visible = await create_card(db, card_type="Application", name="Billing")
    hidden = await create_card(db, card_type="Secret", name=HIDDEN)
    ct = (await db.execute(select(CardType).where(CardType.key == "Secret"))).scalar_one()
    ct.role_permissions = {"restricted": {"inventory.view": False}}
    await db.commit()
    PermissionService.invalidate_type_permission_cache()
    users = {"admin": admin, "reader": reader, "soawer": soawer}
    return {
        "users": users,
        "h": {k: auth_headers(u) for k, u in users.items()},
        "visible": visible,
        "hidden": hidden,
    }


async def _adr(client, env, who="admin", status=201, **fields):
    resp = await client.post(ADR, json={"title": "Decision", **fields}, headers=env["h"][who])
    assert resp.status_code == status, resp.text
    return resp.json()


async def _soaw(client, env, content, who="admin", status=201):
    resp = await client.post(
        SOAW,
        json={"name": "Plan", "sections": {"1.1": {"content": content}}},
        headers=env["h"][who],
    )
    assert resp.status_code == status, resp.text
    return resp.json()


async def _stored(db, model, doc_id, field):
    return (
        await db.execute(select(getattr(model, field)).where(model.id == uuid.UUID(doc_id)))
    ).scalar_one()


def _no_leak(env, text: str) -> None:
    assert HIDDEN not in text
    assert str(env["hidden"].id) not in text


# ---------------------------------------------------------------------------
# Read: one rendering per reader
# ---------------------------------------------------------------------------


class TestRead:
    async def test_a_card_mention_reads_resolved_or_restricted_per_reader(self, client, env):
        hid, vid = env["hidden"].id, env["visible"].id
        adr = await _adr(client, env, decision=f"<p>{span('card', hid)} {span('card', vid)}</p>")
        as_admin = (await client.get(f"{ADR}/{adr['id']}", headers=env["h"]["admin"])).json()
        assert as_admin["decision"] == (
            f'<p><span data-type="mention" data-kind="card" data-id="{hid}">@{HIDDEN}</span> '
            f'<span data-type="mention" data-kind="card" data-id="{vid}">@Billing</span></p>'
        )
        resp = await client.get(f"{ADR}/{adr['id']}", headers=env["h"]["reader"])
        assert resp.json()["decision"] == (
            f"<p>{restricted(adr['id'], 'card', hid)} "
            f'<span data-type="mention" data-kind="card" data-id="{vid}">@Billing</span></p>'
        )
        _no_leak(env, resp.text)

    async def test_the_label_follows_a_rename_and_is_never_stored(self, client, env, db):
        vid = env["visible"].id
        adr = await _adr(client, env, decision=f"<p>{span('card', vid)}</p>")
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == (
            f"<p>{span('card', vid)}</p>"
        )
        resp = await client.patch(
            f"/api/v1/cards/{vid}", json={"name": "Invoicing"}, headers=env["h"]["admin"]
        )
        assert resp.status_code == 200, resp.text
        body = (await client.get(f"{ADR}/{adr['id']}", headers=env["h"]["admin"])).json()
        assert body["decision"] == (
            f'<p><span data-type="mention" data-kind="card" data-id="{vid}">@Invoicing</span></p>'
        )

    async def test_an_archived_card_is_flagged_and_a_deleted_one_missing(self, client, env, db):
        old = await create_card(db, card_type="Application", name="Old", status="ARCHIVED")
        gone = await create_card(db, card_type="Application", name="Gone")
        hid = env["hidden"].id
        adr = await _adr(
            client,
            env,
            context=f"<p>{span('card', old.id)}{span('card', gone.id)}{span('card', hid)}</p>",
        )
        await db.delete(gone)
        env["hidden"].status = "ARCHIVED"
        await db.commit()
        body = (await client.get(f"{ADR}/{adr['id']}", headers=env["h"]["reader"])).json()
        # Hidden wins over archived: still restricted.
        assert body["context"] == (
            f'<p><span data-type="mention" data-kind="card" data-id="{old.id}" '
            'data-archived="true">@Old</span>'
            f'<span data-type="mention" data-kind="card" data-id="{gone.id}" '
            'data-missing="true"></span>'
            f"{restricted(adr['id'], 'card', hid)}</p>"
        )

    async def test_a_decision_reads_as_its_current_revision(self, client, env):
        target = await _adr(client, env, title="Use Postgres")
        base = f"{ADR}/{target['id']}"
        me = [str(env["users"]["admin"].id)]
        h = env["h"]["admin"]
        assert (
            await client.post(f"{base}/request-signatures", json={"user_ids": me}, headers=h)
        ).status_code == 200
        assert (await client.post(f"{base}/sign", headers=h)).status_code == 200
        rev = (await client.post(f"{base}/revise", headers=h)).json()
        await client.patch(f"{ADR}/{rev['id']}", json={"title": "Use Postgres 16"}, headers=h)
        rbase = f"{ADR}/{rev['id']}"
        assert (
            await client.post(f"{rbase}/request-signatures", json={"user_ids": me}, headers=h)
        ).status_code == 200
        assert (await client.post(f"{rbase}/sign", headers=h)).status_code == 200

        adr = await _adr(client, env, decision=f"<p>{span('decision', target['id'])}</p>")
        body = (await client.get(f"{ADR}/{adr['id']}", headers=h)).json()
        assert body["decision"] == (
            f'<p><span data-type="mention" data-kind="decision" data-id="{target["id"]}">'
            f"{target['reference_number']} · Rev 2 Use Postgres 16</span></p>"
        )

    async def test_a_soaw_reader_without_adr_view_gets_a_decision_restricted(self, client, env):
        target = await _adr(client, env, title="Use Postgres")
        soaw = await _soaw(client, env, f"<p>{span('decision', target['id'])}</p>")
        as_admin = (await client.get(f"{SOAW}/{soaw['id']}", headers=env["h"]["admin"])).json()
        assert as_admin["sections"]["1.1"]["content"] == (
            f'<p><span data-type="mention" data-kind="decision" data-id="{target["id"]}">'
            f"{target['reference_number']} Use Postgres</span></p>"
        )
        resp = await client.get(f"{SOAW}/{soaw['id']}", headers=env["h"]["soawer"])
        assert resp.json()["sections"]["1.1"]["content"] == (
            f"<p>{restricted(soaw['id'], 'decision', target['id'])}</p>"
        )
        assert target["id"] not in resp.text and "Use Postgres" not in resp.text


# ---------------------------------------------------------------------------
# Non-GET responses to a restricted reader (R10)
# ---------------------------------------------------------------------------


class TestNonGetResponses:
    async def test_no_write_response_names_the_hidden_card(self, client, env):
        hid = env["hidden"].id
        h = env["h"]["reader"]
        adr = await _adr(client, env, decision=f"<p>{span('card', hid)}</p>")
        base = f"{ADR}/{adr['id']}"

        resp = await client.patch(base, json={"title": "Renamed"}, headers=h)
        assert resp.status_code == 200, resp.text
        assert resp.json()["decision"] == f"<p>{restricted(adr['id'], 'card', hid)}</p>"
        _no_leak(env, resp.text)

        resp = await client.post(f"{base}/duplicate", headers=h)
        assert resp.status_code == 201, resp.text
        dup = resp.json()
        assert dup["decision"] == f"<p>{restricted(dup['id'], 'card', hid)}</p>"
        _no_leak(env, resp.text)

        me = [str(env["users"]["reader"].id)]
        resp = await client.post(f"{base}/request-signatures", json={"user_ids": me}, headers=h)
        assert resp.status_code == 200, resp.text
        _no_leak(env, resp.text)

        resp = await client.post(f"{base}/sign", headers=h)
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "signed"
        _no_leak(env, resp.text)

        resp = await client.post(f"{base}/revise", headers=h)
        assert resp.status_code == 200, resp.text
        rev = resp.json()
        assert rev["decision"] == f"<p>{restricted(rev['id'], 'card', hid)}</p>"
        _no_leak(env, resp.text)

    async def test_a_restore_keeps_the_hidden_mention_and_names_no_hidden_card(
        self, client, env, db
    ):
        """The restricted reader restores a version whose text mentions a card
        they cannot see and the current text no longer holds: the mention was
        stored on the document once, so it is kept, not refused (R10, R19)."""
        hid = env["hidden"].id
        h = env["h"]["reader"]
        adr = await _adr(client, env, decision=f"<p>{span('card', hid)}</p>")
        base = f"{ADR}/{adr['id']}"
        resp = await client.patch(
            base, json={"decision": "<p>plain</p>"}, headers=env["h"]["admin"]
        )
        assert resp.status_code == 200, resp.text
        history = (await client.get(f"{base}/history", headers=h)).json()["entries"]
        assert [e["kind"] for e in history] == ["save", "created"]
        resp = await client.post(f"{base}/history/{history[1]['id']}/restore", headers=h)
        assert resp.status_code == 200, resp.text
        assert resp.json()["decision"] == f"<p>{restricted(adr['id'], 'card', hid)}</p>"
        _no_leak(env, resp.text)
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == (
            f"<p>{span('card', hid)}</p>"
        )

        soaw = await _soaw(client, env, f"<p>{span('card', hid)}</p>")
        sbase = f"{SOAW}/{soaw['id']}"
        resp = await client.patch(
            sbase,
            json={"sections": {"1.1": {"content": "<p>plain</p>"}}},
            headers=env["h"]["admin"],
        )
        assert resp.status_code == 200, resp.text
        created = (await client.get(f"{sbase}/history", headers=h)).json()["entries"][-1]
        resp = await client.post(f"{sbase}/history/{created['id']}/restore", headers=h)
        assert resp.status_code == 200, resp.text
        assert resp.json()["sections"] == {
            "1.1": {"content": f"<p>{restricted(soaw['id'], 'card', hid)}</p>"}
        }
        _no_leak(env, resp.text)

    async def test_the_soaw_update_response_names_no_hidden_card(self, client, env, db):
        hid = env["hidden"].id
        soaw = await _soaw(client, env, f"<p>{span('card', hid)}</p>")
        resp = await client.patch(
            f"{SOAW}/{soaw['id']}", json={"name": "Renamed"}, headers=env["h"]["reader"]
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["sections"] == {
            "1.1": {"content": f"<p>{restricted(soaw['id'], 'card', hid)}</p>"}
        }
        _no_leak(env, resp.text)


# ---------------------------------------------------------------------------
# Write: what may be mentioned, and what survives a save
# ---------------------------------------------------------------------------


class TestWrite:
    async def test_a_hidden_mention_survives_the_restricted_readers_save(self, client, env, db):
        hid = env["hidden"].id
        adr = await _adr(client, env, decision=f"<p>{span('card', hid)}</p>")
        seen = (await client.get(f"{ADR}/{adr['id']}", headers=env["h"]["reader"])).json()
        resp = await client.patch(
            f"{ADR}/{adr['id']}",
            json={"decision": seen["decision"] + "<p>More</p>"},
            headers=env["h"]["reader"],
        )
        assert resp.status_code == 200, resp.text
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == (
            f"<p>{span('card', hid)}</p><p>More</p>"
        )

    async def test_a_hidden_soaw_mention_survives_the_restricted_readers_save(
        self, client, env, db
    ):
        hid = env["hidden"].id
        soaw = await _soaw(client, env, f"<p>{span('card', hid)}</p>")
        seen = (await client.get(f"{SOAW}/{soaw['id']}", headers=env["h"]["reader"])).json()
        sections = seen["sections"]
        sections["custom_new"] = {"content": "<p>Added</p>"}
        resp = await client.patch(
            f"{SOAW}/{soaw['id']}", json={"sections": sections}, headers=env["h"]["reader"]
        )
        assert resp.status_code == 200, resp.text
        assert await _stored(db, SoAW, soaw["id"], "sections") == {
            "1.1": {"content": f"<p>{span('card', hid)}</p>"},
            "custom_new": {"content": "<p>Added</p>"},
        }

    async def test_a_token_copied_into_another_document_is_dropped(self, client, env, db):
        hid = env["hidden"].id
        first = await _adr(client, env, decision=f"<p>{span('card', hid)}</p>")
        second = await _adr(client, env, decision=f"<p>{span('card', hid)}</p>", title="Other")
        seen = (await client.get(f"{ADR}/{first['id']}", headers=env["h"]["reader"])).json()
        third = await _adr(client, env)
        for target in (second, third):
            resp = await client.patch(
                f"{ADR}/{target['id']}",
                json={"context": seen["decision"]},
                headers=env["h"]["reader"],
            )
            assert resp.status_code == 200, resp.text
            assert await _stored(db, ArchitectureDecision, target["id"], "context") == "<p></p>"
        # A new document restores nothing either.
        created = await _adr(client, env, who="reader", context=seen["decision"])
        assert await _stored(db, ArchitectureDecision, created["id"], "context") == "<p></p>"

    async def test_a_restricted_writer_cannot_mention_a_hidden_card(self, client, env, db):
        hid = env["hidden"].id
        adr = await _adr(client, env, decision="<p>Before</p>")
        resp = await client.patch(
            f"{ADR}/{adr['id']}",
            json={"decision": f"<p>{span('card', hid)}</p>"},
            headers=env["h"]["reader"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Card not found")
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == "<p>Before</p>"
        resp = await client.post(
            ADR,
            json={"title": "New", "decision": f"<p>{span('card', hid)}</p>"},
            headers=env["h"]["reader"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Card not found")
        resp = await client.post(
            SOAW,
            json={"name": "P", "sections": {"1.1": {"content": span("card", hid)}}},
            headers=env["h"]["reader"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Card not found")

    async def test_an_unknown_card_is_refused(self, client, env):
        resp = await client.post(
            ADR,
            json={"title": "New", "decision": f"<p>{span('card', uuid.uuid4())}</p>"},
            headers=env["h"]["admin"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Card not found")

    async def test_an_existing_mention_of_a_since_deleted_card_is_kept(self, client, env, db):
        gone = await create_card(db, card_type="Application", name="Gone")
        adr = await _adr(client, env, decision=f"<p>{span('card', gone.id)}</p>")
        await db.delete(gone)
        await db.commit()
        resp = await client.patch(
            f"{ADR}/{adr['id']}",
            json={"decision": f"<p>{span('card', gone.id)} again</p>"},
            headers=env["h"]["admin"],
        )
        assert resp.status_code == 200, resp.text
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == (
            f"<p>{span('card', gone.id)} again</p>"
        )

    async def test_a_person_in_a_document_is_collapsed_to_text(self, client, env, db):
        uid = env["users"]["admin"].id
        adr = await _adr(
            client,
            env,
            decision=(
                f'<p>Ask <span data-type="mention" data-kind="user" data-id="{uid}">@Ada</span></p>'
            ),
        )
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == "<p>Ask @Ada</p>"

    async def test_labels_and_flags_are_stripped_on_save(self, client, env, db):
        vid = env["visible"].id
        adr = await _adr(
            client,
            env,
            decision=(
                f'<p><span data-type="mention" data-kind="card" data-id="{vid}" '
                'data-archived="true">@Old name</span></p>'
            ),
        )
        assert await _stored(db, ArchitectureDecision, adr["id"], "decision") == (
            f"<p>{span('card', vid)}</p>"
        )

    async def test_a_decision_mention_needs_adr_view(self, client, env, db):
        target = await _adr(client, env, title="Use Postgres")
        resp = await client.post(
            SOAW,
            json={"name": "P", "sections": {"1.1": {"content": span("decision", target["id"])}}},
            headers=env["h"]["soawer"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Decision not found")
        resp = await client.post(
            SOAW,
            json={"name": "P", "sections": {"1.1": {"content": span("decision", uuid.uuid4())}}},
            headers=env["h"]["admin"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Decision not found")
        soaw = await _soaw(client, env, span("decision", target["id"]))
        assert await _stored(db, SoAW, soaw["id"], "sections") == {
            "1.1": {"content": span("decision", target["id"])}
        }

    async def test_the_importer_fails_only_the_row_with_a_refused_mention(self, client, env):
        hid = env["hidden"].id
        resp = await client.post(
            f"{ADR}/bulk-import",
            json={
                "items": [
                    {"row_index": 1, "title": "Good", "decision": "<p>Plain</p>"},
                    {"row_index": 2, "title": "Bad", "decision": f"<p>{span('card', hid)}</p>"},
                    {
                        "row_index": 3,
                        "title": "Fine",
                        "decision": f"<p>{span('card', env['visible'].id)}</p>",
                    },
                ]
            },
            headers=env["h"]["reader"],
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [(r["row_index"], r["status"], r["error"]) for r in body["results"]] == [
            (1, "created", None),
            (2, "failed", "Mention refused: Card not found"),
            (3, "created", None),
        ]
        assert (body["created"], body["failed"]) == (2, 1)


# ---------------------------------------------------------------------------
# "Mentioned in"
# ---------------------------------------------------------------------------


class TestMentionedIn:
    async def test_a_card_is_mentioned_in_decisions_and_soaws(self, client, env, db):
        vid = env["visible"].id
        h = env["h"]["admin"]
        first = await _adr(client, env, title="First", consequences=f"<p>{span('card', vid)}</p>")
        # Two revisions of one decision mention it: listed once, as the current one.
        base = f"{ADR}/{first['id']}"
        me = [str(env["users"]["admin"].id)]
        await client.post(f"{base}/request-signatures", json={"user_ids": me}, headers=h)
        await client.post(f"{base}/sign", headers=h)
        await client.post(f"{base}/revise", headers=h)
        talked = await _adr(client, env, title="Talked about")
        db.add(
            DocumentComment(
                architecture_decision_id=uuid.UUID(talked["id"]),
                author_name="Ada",
                body=f"<p>What about {span('card', vid)}?</p>",
            )
        )
        await _adr(client, env, title="Unrelated", decision="<p>nothing</p>")
        soaw = await _soaw(client, env, f"<p>{span('card', vid)}</p>")
        await _soaw(client, env, "<p>nothing</p>")
        await db.commit()

        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=h)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "decisions": [
                {
                    "id": first["id"],
                    "reference_number": first["reference_number"],
                    "revision_number": 1,
                    "title": "First",
                    "status": "signed",
                    "standing": "in_force",
                    "via": "text",
                },
                {
                    "id": talked["id"],
                    "reference_number": talked["reference_number"],
                    "revision_number": 1,
                    "title": "Talked about",
                    "status": "draft",
                    "standing": None,
                    "via": "comment",
                },
            ],
            "soaws": [{"id": soaw["id"], "name": "Plan", "revision_number": 1, "status": "draft"}],
        }
        # SoAWs only for a reader without adr.view.
        as_soawer = await client.get(f"/api/v1/mentions/cards/{vid}", headers=env["h"]["soawer"])
        assert as_soawer.json() == {
            "decisions": [],
            "soaws": [{"id": soaw["id"], "name": "Plan", "revision_number": 1, "status": "draft"}],
        }

    async def test_a_hidden_or_unknown_card_is_404(self, client, env):
        for card_id in (env["hidden"].id, uuid.uuid4(), "not-a-uuid"):
            resp = await client.get(f"/api/v1/mentions/cards/{card_id}", headers=env["h"]["reader"])
            assert (resp.status_code, resp.json()["detail"]) == (404, "Card not found")
        resp = await client.get(
            f"/api/v1/mentions/cards/{env['hidden'].id}", headers=env["h"]["admin"]
        )
        assert resp.json() == {"decisions": [], "soaws": []}

    async def test_a_decision_is_mentioned_through_any_revision(self, client, env):
        h = env["h"]["admin"]
        target = await _adr(client, env, title="Target")
        base = f"{ADR}/{target['id']}"
        me = [str(env["users"]["admin"].id)]
        await client.post(f"{base}/request-signatures", json={"user_ids": me}, headers=h)
        await client.post(f"{base}/sign", headers=h)
        rev = (await client.post(f"{base}/revise", headers=h)).json()
        older = await _adr(client, env, title="Older", decision=span("decision", target["id"]))
        newer = await _adr(client, env, title="Newer", context=span("decision", rev["id"]))
        soaw = await _soaw(client, env, span("decision", rev["id"]))
        resp = await client.get(f"/api/v1/mentions/decisions/{target['id']}", headers=h)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [(d["id"], d["title"], d["via"]) for d in body["decisions"]] == [
            (older["id"], "Older", "text"),
            (newer["id"], "Newer", "text"),
        ]
        assert [s["id"] for s in body["soaws"]] == [soaw["id"]]
        # The same answer from the revision's own page.
        again = await client.get(f"/api/v1/mentions/decisions/{rev['id']}", headers=h)
        assert again.json() == body

    async def test_decision_mentioned_in_needs_adr_view(self, client, env):
        target = await _adr(client, env)
        resp = await client.get(
            f"/api/v1/mentions/decisions/{target['id']}", headers=env["h"]["soawer"]
        )
        assert resp.status_code == 403
        resp = await client.get(
            f"/api/v1/mentions/decisions/{uuid.uuid4()}", headers=env["h"]["admin"]
        )
        assert resp.status_code == 404


async def _sign(client, env, kind_path, doc_id):
    """Request the admin's signature on a draft and sign it."""
    h = env["h"]["admin"]
    me = [str(env["users"]["admin"].id)]
    resp = await client.post(
        f"{kind_path}/{doc_id}/request-signatures", json={"user_ids": me}, headers=h
    )
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"{kind_path}/{doc_id}/sign", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "signed"


async def _revise(client, env, kind_path, doc_id) -> dict:
    resp = await client.post(f"{kind_path}/{doc_id}/revise", headers=env["h"]["admin"])
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


class TestMentionedInIsParsed:
    """A ``LIKE`` hit is only a candidate (B4); only a chain's current or open
    revision counts, named as the revision that holds the mention (B5); a
    SoAW whose sections are not a JSON object is skipped (B8)."""

    async def test_plain_text_holding_the_marker_lists_nothing(self, client, env, db):
        hid = env["hidden"].id
        marker = f'data-kind="card" data-id="{hid}"'
        # The restricted reader may not mention the hidden card, but may type
        # these characters anywhere.
        adr = await _adr(client, env, who="reader", decision=f"<p>{marker}</p>")
        assert marker in await _stored(db, ArchitectureDecision, adr["id"], "decision")
        resp = await client.post(
            f"{ADR}/{adr['id']}/comments",
            json={"body": f"<p>{marker}</p>"},
            headers=env["h"]["reader"],
        )
        assert resp.status_code == 201, resp.text
        soaw = await _soaw(client, env, f"<p>{marker}</p>", who="reader")
        assert marker in (await _stored(db, SoAW, soaw["id"], "sections"))["1.1"]["content"]

        resp = await client.get(f"/api/v1/mentions/cards/{hid}", headers=env["h"]["admin"])
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"decisions": [], "soaws": []}

    async def test_a_mention_only_in_an_earlier_revision_lists_nothing(self, client, env, db):
        vid = env["visible"].id
        h = env["h"]["admin"]
        rev1 = await _adr(client, env, title="Moves", consequences=f"<p>{span('card', vid)}</p>")
        await _sign(client, env, ADR, rev1["id"])
        rev2 = await _revise(client, env, ADR, rev1["id"])
        resp = await client.patch(
            f"{ADR}/{rev2['id']}", json={"consequences": "<p>No longer</p>"}, headers=h
        )
        assert resp.status_code == 200, resp.text
        await _sign(client, env, ADR, rev2["id"])
        db.add(
            DocumentComment(
                architecture_decision_id=uuid.UUID(rev1["id"]),
                author_name="Ada",
                body=f"<p>{span('card', vid)}</p>",
            )
        )
        await db.commit()

        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=h)
        assert resp.json() == {"decisions": [], "soaws": []}

        # The open draft mentions it again: the entry is that draft.
        rev3 = await _revise(client, env, ADR, rev2["id"])
        resp = await client.patch(
            f"{ADR}/{rev3['id']}", json={"context": f"<p>{span('card', vid)}</p>"}, headers=h
        )
        assert resp.status_code == 200, resp.text
        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=h)
        assert resp.json()["decisions"] == [
            {
                "id": rev3["id"],
                "reference_number": rev1["reference_number"],
                "revision_number": 3,
                "title": "Moves",
                "status": "draft",
                "standing": None,
                "via": "text",
            }
        ]

    async def test_a_comment_on_the_open_draft_counts_and_names_the_draft(self, client, env, db):
        vid = env["visible"].id
        rev1 = await _adr(client, env, title="Talked")
        await _sign(client, env, ADR, rev1["id"])
        rev2 = await _revise(client, env, ADR, rev1["id"])
        db.add(
            DocumentComment(
                architecture_decision_id=uuid.UUID(rev2["id"]),
                author_name="Ada",
                body=f"<p>{span('card', vid)}</p>",
            )
        )
        await db.commit()
        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=env["h"]["admin"])
        assert [(d["id"], d["revision_number"], d["via"]) for d in resp.json()["decisions"]] == [
            (rev2["id"], 2, "comment")
        ]

    async def test_a_soaw_chain_is_listed_once_as_the_revision_holding_it(self, client, env):
        vid = env["visible"].id
        h = env["h"]["admin"]
        rev1 = await _soaw(client, env, f"<p>{span('card', vid)}</p>")
        await _sign(client, env, SOAW, rev1["id"])
        rev2 = await _revise(client, env, SOAW, rev1["id"])
        await _sign(client, env, SOAW, rev2["id"])
        rev3 = await _revise(client, env, SOAW, rev2["id"])

        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=h)
        assert resp.json()["soaws"] == [
            {"id": rev2["id"], "name": "Plan", "revision_number": 2, "status": "signed"}
        ]

        # Clearing the open draft changes nothing: the current one holds it.
        resp = await client.patch(
            f"{SOAW}/{rev3['id']}",
            json={"sections": {"1.1": {"content": "<p>gone</p>"}}},
            headers=h,
        )
        assert resp.status_code == 200, resp.text
        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=h)
        assert [s["id"] for s in resp.json()["soaws"]] == [rev2["id"]]

    async def test_a_soaw_whose_sections_are_not_an_object_is_skipped(self, client, env, db):
        vid = env["visible"].id
        soaw = await _soaw(client, env, f"<p>{span('card', vid)}</p>")
        for odd in (None, ["x"], "x"):
            other = await _soaw(client, env, "<p>other</p>")
            row = await db.get(SoAW, uuid.UUID(other["id"]))
            row.sections = odd
        await db.commit()
        for path in (f"cards/{vid}", f"decisions/{(await _adr(client, env))['id']}"):
            resp = await client.get(f"/api/v1/mentions/{path}", headers=env["h"]["admin"])
            assert resp.status_code == 200, resp.text
        resp = await client.get(f"/api/v1/mentions/cards/{vid}", headers=env["h"]["admin"])
        assert [s["id"] for s in resp.json()["soaws"]] == [soaw["id"]]


# ---------------------------------------------------------------------------
# Comments: resolved per reader, tokens scoped to the comment (R4, R10)
# ---------------------------------------------------------------------------


def resolved(kind: str, mention_id, label: str) -> str:
    return f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}">{label}</span>'


class TestComments:
    async def _comment(self, client, env, base, body, who="admin", status=201, **extra):
        resp = await client.post(
            f"{base}/comments", json={"body": body, **extra}, headers=env["h"][who]
        )
        assert resp.status_code == status, resp.text
        return resp.json()

    async def test_a_hidden_card_reads_restricted_in_a_comment(self, client, env):
        hid, vid = env["hidden"].id, env["visible"].id
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        body = f"<p>{span('card', hid)} {span('card', vid)}</p>"
        thread = await self._comment(client, env, base, body)
        assert thread["body"] == (
            f"<p>{resolved('card', hid, '@' + HIDDEN)} {resolved('card', vid, '@Billing')}</p>"
        )
        resp = await client.get(f"{base}/comments", headers=env["h"]["reader"])
        (read,) = resp.json()["threads"]
        # The token is the COMMENT's, not the decision's.
        assert read["body"] == (
            f"<p>{restricted(thread['id'], 'card', hid)} {resolved('card', vid, '@Billing')}</p>"
        )
        _no_leak(env, resp.text)

    async def test_a_decision_mention_is_restricted_without_adr_view(self, client, env):
        target = await _adr(client, env, title="Use Postgres")
        soaw = await _soaw(client, env, "<p>x</p>")
        base = f"{SOAW}/{soaw['id']}"
        thread = await self._comment(client, env, base, span("decision", target["id"]))
        as_admin = (await client.get(f"{base}/comments", headers=env["h"]["admin"])).json()
        assert as_admin["threads"][0]["body"] == resolved(
            "decision", target["id"], f"{target['reference_number']} Use Postgres"
        )
        as_soawer = await client.get(f"{base}/comments", headers=env["h"]["soawer"])
        assert as_soawer.json()["threads"][0]["body"] == restricted(
            thread["id"], "decision", target["id"]
        )
        # And a writer without adr.view may not add one.
        resp = await client.post(
            f"{base}/comments",
            json={"body": span("decision", target["id"])},
            headers=env["h"]["soawer"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Decision not found")

    async def test_a_writer_may_not_mention_a_card_they_cannot_read(self, client, env, db):
        adr = await _adr(client, env)
        resp = await client.post(
            f"{ADR}/{adr['id']}/comments",
            json={"body": span("card", env["hidden"].id)},
            headers=env["h"]["reader"],
        )
        assert (resp.status_code, resp.json()["detail"]) == (404, "Card not found")
        assert (await db.execute(select(DocumentComment))).scalars().all() == []

    async def test_a_restricted_chip_copied_into_a_new_comment_is_dropped(self, client, env, db):
        hid = env["hidden"].id
        adr = await _adr(client, env, decision=f"<p>{span('card', hid)}</p>")
        as_reader = (await client.get(f"{ADR}/{adr['id']}", headers=env["h"]["reader"])).json()
        chip = restricted(adr["id"], "card", hid)
        assert chip in as_reader["decision"]
        thread = await self._comment(
            client, env, f"{ADR}/{adr['id']}", f"<p>See {chip}</p>", who="reader"
        )
        assert thread["body"] == "<p>See </p>"
        stored = await db.get(DocumentComment, uuid.UUID(thread["id"]))
        assert stored.body == "<p>See </p>"

    async def test_editing_keeps_a_hidden_mention(self, client, env, db):
        hid = env["hidden"].id
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        comment = DocumentComment(
            architecture_decision_id=uuid.UUID(adr["id"]),
            author_id=env["users"]["reader"].id,
            author_name="Rex",
            body=f"<p>Old {span('card', hid)}</p>",
        )
        db.add(comment)
        await db.commit()
        chip = restricted(comment.id, "card", hid)
        reply = await self._comment(
            client, env, base, "<p>A reply</p>", who="reader", parent_id=str(comment.id)
        )
        assert reply["body"] == f"<p>Old {chip}</p>"
        _no_leak(env, str(reply))
        resp = await client.patch(
            f"{base}/comments/{comment.id}",
            json={"body": f"<p>New {chip}</p>"},
            headers=env["h"]["reader"],
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["body"] == f"<p>New {chip}</p>"
        _no_leak(env, resp.text)
        await db.refresh(comment)
        assert comment.body == f"<p>New {span('card', hid)}</p>"
        # A token from another scope (the decision's) is dropped on edit.
        foreign = restricted(adr["id"], "card", hid)
        resp = await client.patch(
            f"{base}/comments/{comment.id}",
            json={"body": f"<p>Again {foreign}</p>"},
            headers=env["h"]["reader"],
        )
        assert resp.json()["body"] == "<p>Again </p>"
        resolved_resp = await client.post(
            f"{base}/comments/{comment.id}/resolve", headers=env["h"]["reader"]
        )
        assert resolved_resp.status_code == 200, resolved_resp.text
        _no_leak(env, resolved_resp.text)

    async def test_non_get_responses_never_leak(self, client, env, db):
        hid = env["hidden"].id
        adr = await _adr(client, env)
        base = f"{ADR}/{adr['id']}"
        top = await self._comment(client, env, base, f"<p>{span('card', hid)}</p>")
        responses = [
            await client.post(
                f"{base}/comments",
                json={"body": "<p>reply</p>", "parent_id": top["id"]},
                headers=env["h"]["reader"],
            ),
            await client.post(f"{base}/comments/{top['id']}/resolve", headers=env["h"]["reader"]),
            await client.post(f"{base}/comments/{top['id']}/reopen", headers=env["h"]["reader"]),
        ]
        for resp in responses:
            assert resp.status_code in (200, 201), resp.text
            _no_leak(env, resp.text)
            assert resp.json()["body"] == f"<p>{restricted(top['id'], 'card', hid)}</p>"


# ---------------------------------------------------------------------------
# One batch per response
# ---------------------------------------------------------------------------


@pytest.fixture
def sql_count():
    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    sa_event.listen(Engine, "before_cursor_execute", _capture)
    yield statements
    sa_event.remove(Engine, "before_cursor_execute", _capture)


class TestQueryCount:
    async def _count(self, client, env, sql_count, **params) -> int:
        sql_count.clear()
        resp = await client.get(ADR, params=params, headers=env["h"]["reader"])
        assert resp.status_code == 200, resp.text
        _no_leak(env, resp.text)
        return len(sql_count)

    async def test_the_list_resolves_every_row_in_one_batch(self, client, env, sql_count):
        hid, vid = env["hidden"].id, env["visible"].id
        for _ in range(2):
            await _adr(client, env, decision="<p>plain</p>")
        await self._count(client, env, sql_count)  # warm the permission caches
        plain_two = await self._count(client, env, sql_count)
        for _ in range(2):
            await _adr(client, env, decision="<p>plain</p>")
        plain_four = await self._count(client, env, sql_count)
        assert plain_four == plain_two

        for _ in range(2):
            await _adr(client, env, decision=f"<p>{span('card', hid)}{span('card', vid)}</p>")
        mentions_six = await self._count(client, env, sql_count)
        for _ in range(3):
            await _adr(client, env, decision=f"<p>{span('card', vid)}</p>")
        mentions_nine = await self._count(client, env, sql_count)
        assert mentions_nine == mentions_six
        # One card query on top of the plain list.
        assert mentions_six == plain_four + 1
        # The spreadsheet export's extra text fields join the same batch.
        assert await self._count(client, env, sql_count, include_content="true") == (
            await self._count(client, env, sql_count, include_content="true")
        )

    async def test_no_mention_means_no_query_and_the_same_payloads(self, db, env, sql_count):
        payloads = [{"id": str(uuid.uuid4()), "decision": "<p>plain</p>", "context": None}]
        sql_count.clear()
        out = await mention_service.resolve_for_reader(
            db, doc_kind="adr", payloads=payloads, user=env["users"]["reader"], read_scope=None
        )
        assert out is payloads
        assert sql_count == []


class TestServiceEdges:
    async def test_people_resolve_by_their_current_name(self, db, env):
        ada = env["users"]["admin"].id
        ghost = str(uuid.uuid4())
        states = await mention_service.mention_states(
            db,
            {("user", str(ada)), ("user", ghost)},
            user=env["users"]["reader"],
            read_scope=None,
        )
        assert states == {("user", str(ada)): mention_service.resolved("@Ada")}

    async def test_a_writer_without_a_user_must_say_what_it_is(self, db, env):
        incoming = {"decision": span("card", env["visible"].id)}
        with pytest.raises(ValueError, match="A user writer needs its user"):
            await mention_service.normalise_for_write(
                db, doc_kind="adr", doc=None, incoming=incoming, user=None, read_scope=None
            )
        # A copy is never checked, not even for existence.
        missing = {"decision": span("card", uuid.uuid4())}
        out = await mention_service.normalise_for_write(
            db,
            doc_kind="adr",
            doc=None,
            incoming=missing,
            user=None,
            read_scope=None,
            copy=True,
        )
        assert out == missing and out is not missing

    async def test_a_system_writer_is_checked_for_existence_only(self, client, env, db):
        target = await _adr(client, env, title="Target")
        hid = env["hidden"].id
        incoming = {"decision": span("decision", target["id"]) + span("card", hid)}
        out = await mention_service.normalise_for_write(
            db,
            doc_kind="adr",
            doc=None,
            incoming=incoming,
            user=None,
            read_scope=None,
            system=True,
        )
        assert out == incoming
        unknown = {"decision": span("decision", uuid.uuid4())}
        with pytest.raises(mention_service.MentionRefused) as refused:
            await mention_service.normalise_for_write(
                db,
                doc_kind="adr",
                doc=None,
                incoming=unknown,
                user=None,
                read_scope=None,
                system=True,
            )
        assert (refused.value.status_code, refused.value.detail) == (404, "Decision not found")
