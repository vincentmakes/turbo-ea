"""The SDK surveys bridge (SDK 1.14): grant gating, send-only posture,
explicit-card validation, metamodel-resolved fields, one writer with the
REST route, audit batches (own and joined), the ``ext`` stamp on the
``survey.sent`` events, and delivery after the session closed.

Same harness as the other bridge tests: the bridge opens its own sessions
via ``async_session`` (patched to the savepoint-rollback test session) and
the in-memory ``extension_registry`` singleton is driven directly."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.notification import Notification
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.services.extensions import surveys_bridge as bridge_mod
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry
from app.services.extensions.sdk import (
    ExtensionDataError,
    ExtensionPermissionError,
    ExtSurvey,
    ExtSurveyPreview,
)
from app.services.extensions.surveys_bridge import ExtensionSurveys
from tests.conftest import create_card, create_card_type, create_stakeholder_role_def, create_user

NOW = datetime.now(timezone.utc)
KEY = "sample-rules"

FIELDS_SCHEMA = [
    {
        "section": "General",
        "fields": [
            {"key": "costTotalAnnual", "label": "Annual Cost", "type": "cost"},
            {"key": "hostingType", "label": "Hosting", "type": "text"},
        ],
    }
]


def load_registry(*, grants: list[str], enabled: bool = True, status: str = "installed") -> None:
    extension_registry.clear()
    extension_registry.load_installed(
        [
            ExtensionInfo(
                key=KEY,
                name="Sample Rules",
                version="1.0.0",
                status=status,
                enabled=enabled,
                manifest={"grants": grants},
            )
        ]
    )
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=NOW - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=KEY, expires_at=None)],
        )
    )


@pytest.fixture(autouse=True)
def _registry_cleanup():
    extension_registry.clear()
    yield
    extension_registry.clear()


@pytest.fixture(autouse=True)
def _patch_sessions(monkeypatch, db):
    @asynccontextmanager
    async def fake_session():
        yield db

    monkeypatch.setattr(bridge_mod, "async_session", fake_session)
    # deliver_notification_batch imports the factory lazily from app.database.
    import app.database as database_mod

    monkeypatch.setattr(database_mod, "async_session", fake_session)


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application", fields_schema=FIELDS_SCHEMA)
    await create_card_type(db, key="Interface", label="Interface")
    await create_stakeholder_role_def(db, card_type_key="Application", key="responsible")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="technicalApplicationOwner", label="Tech owner"
    )
    owner = await create_user(db, email="owner@test.com", role="member", display_name="Owner")
    a = await create_card(db, card_type="Application", name="Billing")
    b = await create_card(db, card_type="Application", name="CRM")
    orphan = await create_card(db, card_type="Application", name="Nobody")
    archived = await create_card(db, card_type="Application", name="Legacy", status="ARCHIVED")
    iface = await create_card(db, card_type="Interface", name="API")
    db.add_all(
        [
            Stakeholder(card_id=a.id, user_id=owner.id, role="responsible"),
            Stakeholder(card_id=b.id, user_id=owner.id, role="technicalApplicationOwner"),
        ]
    )
    await db.flush()
    return {"a": a, "b": b, "orphan": orphan, "archived": archived, "iface": iface, "owner": owner}


def _send_kwargs(env, **over):
    base = dict(
        name="Quarterly refresh",
        target_type="Application",
        card_ids=[str(env["a"].id), str(env["b"].id), str(env["orphan"].id)],
        roles=["responsible", "technicalApplicationOwner"],
        fields=[{"key": "costTotalAnnual", "action": "maintain"}],
        message="Please check the cost.",
    )
    base.update(over)
    return base


async def _batches(db) -> list[MutationBatch]:
    return list((await db.execute(select(MutationBatch))).scalars().all())


async def _surveys(db) -> list[Survey]:
    return list((await db.execute(select(Survey))).scalars().all())


class TestGating:
    async def test_no_grant_blocks_everything(self, db, env):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionSurveys(KEY)
        with pytest.raises(ExtensionPermissionError):
            await bridge.get(str(uuid.uuid4()))
        with pytest.raises(ExtensionPermissionError):
            await bridge.preview(
                target_type="Application", card_ids=[str(env["a"].id)], roles=["responsible"]
            )
        with pytest.raises(ExtensionPermissionError):
            await bridge.send(**_send_kwargs(env))
        assert await _surveys(db) == []

    async def test_read_grant_previews_but_cannot_send(self, db, env):
        load_registry(grants=["core.surveys.read"])
        bridge = ExtensionSurveys(KEY)
        preview = await bridge.preview(
            target_type="Application", card_ids=[str(env["a"].id)], roles=["responsible"]
        )
        assert preview.users == 1
        with pytest.raises(ExtensionPermissionError):
            await bridge.send(**_send_kwargs(env))

    async def test_write_grant_implies_read(self, db, env):
        load_registry(grants=["core.surveys.write"])
        bridge = ExtensionSurveys(KEY)
        sent = await bridge.send(**_send_kwargs(env))
        assert (await bridge.get(sent.id)).id == sent.id

    async def test_kill_switch_and_disabled_extension(self, db, env, monkeypatch):
        load_registry(grants=["core.surveys.write"], enabled=False)
        with pytest.raises(ExtensionPermissionError):
            await ExtensionSurveys(KEY).send(**_send_kwargs(env))
        load_registry(grants=["core.surveys.write"])
        monkeypatch.setattr(settings, "EXTENSION_WRITES_ENABLED", False)
        with pytest.raises(ExtensionPermissionError):
            await ExtensionSurveys(KEY).send(**_send_kwargs(env))
        assert await _surveys(db) == []


class TestSend:
    async def test_creates_an_active_survey_with_rows_events_and_one_batch(self, db, env):
        load_registry(grants=["core.surveys.write"])
        out = await ExtensionSurveys(KEY).send(**_send_kwargs(env))
        assert isinstance(out, ExtSurvey)
        assert out.status == "active" and out.card_count == 3
        assert out.targeted_card_count == 2 and out.user_count == 1
        assert out.response_count == 2 and out.completed_count == 0
        (survey,) = await _surveys(db)
        assert survey.created_by is None
        assert survey.target_filters["card_ids"] == [
            str(env["a"].id),
            str(env["b"].id),
            str(env["orphan"].id),
        ]
        assert survey.fields == [
            {
                "key": "costTotalAnnual",
                "section": "General",
                "label": "Annual Cost",
                "type": "cost",
                "action": "maintain",
            }
        ]
        rows = (
            (await db.execute(select(SurveyResponse).where(SurveyResponse.survey_id == survey.id)))
            .scalars()
            .all()
        )
        assert {r.card_id for r in rows} == {env["a"].id, env["b"].id}
        events = (
            (await db.execute(select(Event).where(Event.event_type == "survey.sent")))
            .scalars()
            .all()
        )
        assert {e.card_id for e in events} == {env["a"].id, env["b"].id}
        assert all(e.data["ext"] == KEY for e in events)
        (batch,) = await _batches(db)
        assert batch.tool_name == f"ext:{KEY}" and batch.origin == "ext"
        assert batch.summary == {
            "survey_id": out.id,
            "name": "Quarterly refresh",
            "cards": 3,
            "users": 1,
        }
        assert all(e.batch_id == batch.id for e in events)
        # One notification for the one person, whichever cards they hold.
        notes = (await db.execute(select(Notification))).scalars().all()
        assert len(notes) == 1 and notes[0].type == "survey_request"
        assert notes[0].user_id == env["owner"].id

    async def test_no_stakeholder_means_no_survey_and_no_row(self, db, env):
        load_registry(grants=["core.surveys.write"])
        with pytest.raises(ExtensionDataError, match="No stakeholder"):
            await ExtensionSurveys(KEY).send(**_send_kwargs(env, card_ids=[str(env["orphan"].id)]))
        # The batch row opened for the write is discarded with the
        # transaction in production; the shared test session never rolls
        # back, so only the survey is asserted here.
        assert await _surveys(db) == []

    async def test_validation_before_and_inside_the_session(self, db, env):
        load_registry(grants=["core.surveys.write"])
        bridge = ExtensionSurveys(KEY)
        with pytest.raises(ExtensionDataError, match="name"):
            await bridge.send(**_send_kwargs(env, name="  "))
        with pytest.raises(ExtensionDataError, match="at least one card"):
            await bridge.send(**_send_kwargs(env, card_ids=[]))
        with pytest.raises(ExtensionDataError, match="Invalid card id"):
            await bridge.send(**_send_kwargs(env, card_ids=["not-a-uuid"]))
        with pytest.raises(ExtensionDataError, match="At most"):
            await bridge.send(**_send_kwargs(env, card_ids=[str(uuid.uuid4()) for _ in range(501)]))
        with pytest.raises(ExtensionDataError, match="at least one stakeholder role"):
            await bridge.send(**_send_kwargs(env, roles=[]))
        with pytest.raises(ExtensionDataError, match="at least one field"):
            await bridge.send(**_send_kwargs(env, fields=[]))
        # Everything above is refused before any session is opened.
        assert await _batches(db) == []
        with pytest.raises(ExtensionDataError, match="not found"):
            await bridge.send(**_send_kwargs(env, card_ids=[str(uuid.uuid4())]))
        with pytest.raises(ExtensionDataError, match="archived"):
            await bridge.send(**_send_kwargs(env, card_ids=[str(env["archived"].id)]))
        with pytest.raises(ExtensionDataError, match="not of type"):
            await bridge.send(**_send_kwargs(env, card_ids=[str(env["iface"].id)]))
        with pytest.raises(ExtensionDataError, match="Role"):
            await bridge.send(**_send_kwargs(env, roles=["ghost"]))
        with pytest.raises(ExtensionDataError, match="does not exist"):
            await bridge.send(**_send_kwargs(env, fields=[{"key": "nope"}]))
        with pytest.raises(ExtensionDataError, match="action"):
            await bridge.send(
                **_send_kwargs(env, fields=[{"key": "hostingType", "action": "delete"}])
            )
        assert await _surveys(db) == []

    async def test_delivers_after_the_session_closed(self, db, env, monkeypatch):
        """Each emailed notification opens an SMTP connection: the send must
        hand delivery over with no session open (the same rule the notify
        bridge and the REST route follow)."""
        load_registry(grants=["core.surveys.write"])
        state = {"open": 0, "open_during_delivery": None, "types": []}

        @asynccontextmanager
        async def counting_session():
            state["open"] += 1
            try:
                yield db
            finally:
                state["open"] -= 1

        async def fake_deliver(recipients, *, notif_type, actor_id=None):
            state["open_during_delivery"] = state["open"]
            state["types"].append(notif_type)
            return len(recipients)

        monkeypatch.setattr(bridge_mod, "async_session", counting_session)
        monkeypatch.setattr(
            bridge_mod.notification_service, "deliver_notification_batch", fake_deliver
        )
        await ExtensionSurveys(KEY).send(**_send_kwargs(env))
        assert state["open_during_delivery"] == 0
        assert state["types"] == ["survey_request"]


class TestPreview:
    async def test_preview_counts_without_writing(self, db, env):
        load_registry(grants=["core.surveys.read"])
        preview = await ExtensionSurveys(KEY).preview(
            target_type="Application",
            card_ids=[str(env["a"].id), str(env["b"].id), str(env["orphan"].id)],
            roles=["responsible"],
        )
        assert isinstance(preview, ExtSurveyPreview)
        assert preview.cards_matched == 3
        assert preview.cards_with_targets == 1
        assert preview.users == 1 and preview.requests == 1
        assert preview.targets == (
            {"card_id": str(env["a"].id), "user_ids": (str(env["owner"].id),)},
        )
        assert await _surveys(db) == []
        assert await _batches(db) == []

    async def test_preview_validates_like_send(self, db, env):
        load_registry(grants=["core.surveys.read"])
        with pytest.raises(ExtensionDataError, match="archived"):
            await ExtensionSurveys(KEY).preview(
                target_type="Application", card_ids=[str(env["archived"].id)], roles=["x"]
            )


class TestBatchJoin:
    async def test_send_inside_ctx_batch_joins_it(self, db, env):
        from app.services.extensions import data_service as ds_mod

        load_registry(grants=["core.surveys.write"])
        ds_mod.reset_rate_limiter()
        original = ds_mod.async_session
        ds_mod.async_session = bridge_mod.async_session  # same patched session
        try:
            async with ds_mod.open_context_batch(KEY, "nightly survey") as b:
                out = await ExtensionSurveys(KEY).send(**_send_kwargs(env))
        finally:
            ds_mod.async_session = original
        batches = await _batches(db)
        assert len(batches) == 1 and str(batches[0].id) == b.id
        assert batches[0].summary == {"label": "nightly survey", "writes": 1}
        events = (
            (await db.execute(select(Event).where(Event.event_type == "survey.sent")))
            .scalars()
            .all()
        )
        assert events and all(str(e.batch_id) == b.id for e in events)
        assert (await ExtensionSurveys(KEY).get(out.id)).status == "active"

    async def test_get_unknown_returns_none(self, db, env):
        load_registry(grants=["core.surveys.read"])
        assert await ExtensionSurveys(KEY).get("nope") is None
        assert await ExtensionSurveys(KEY).get(str(uuid.uuid4())) is None
