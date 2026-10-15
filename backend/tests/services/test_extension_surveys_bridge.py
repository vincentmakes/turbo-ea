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
    ExtSurveyResponse,
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


# -- SDK 1.16: survey reads -----------------------------------------------------


async def _survey(db, *, name, status="active", target_type="Application", sent_at=None, **kw):
    survey = Survey(
        name=name,
        status=status,
        target_type_key=target_type,
        target_filters=kw.pop("target_filters", {}),
        target_roles=["responsible"],
        fields=[],
        sent_at=sent_at,
        **kw,
    )
    db.add(survey)
    await db.flush()
    return survey


async def _request(db, survey, card, user, *, status="pending", created_at=None):
    row = SurveyResponse(survey_id=survey.id, card_id=card.id, user_id=user.id, status=status)
    if created_at is not None:
        row.created_at = created_at
    db.add(row)
    await db.flush()
    return row


@pytest.fixture
async def surveyed(db, env):
    """Two active Application surveys, one closed, one draft, one Interface
    survey — and requests in every state on the first."""
    other = await create_user(db, email="other@test.com", role="member", display_name="Other")
    newest = await _survey(
        db, name="Newest", sent_at=NOW, target_filters={"card_ids": ["x", "y", "z"]}
    )
    older = await _survey(db, name="Older", sent_at=NOW - timedelta(days=3))
    await _survey(db, name="Closed", status="closed", sent_at=NOW - timedelta(days=9))
    await _survey(db, name="Draft", status="draft")
    await _survey(db, name="Iface", target_type="Interface", sent_at=NOW - timedelta(days=1))
    t0 = NOW - timedelta(days=10)
    await _request(db, newest, env["a"], env["owner"], created_at=t0 + timedelta(hours=2))
    await _request(db, newest, env["b"], env["owner"], created_at=t0)
    await _request(db, newest, env["a"], other, status="completed", created_at=t0)
    await _request(db, newest, env["archived"], other, created_at=t0)
    await _request(db, older, env["b"], other, created_at=t0)
    return {**env, "other": other, "newest": newest, "older": older}


class TestListSurveys:
    async def test_needs_the_read_grant(self, db, surveyed):
        load_registry(grants=["core.cards.write"])
        bridge = ExtensionSurveys(KEY)
        with pytest.raises(ExtensionPermissionError, match="core.surveys.read"):
            await bridge.list_surveys()
        with pytest.raises(ExtensionPermissionError, match="core.surveys.read"):
            await bridge.pending_responses(str(surveyed["newest"].id))

    async def test_active_surveys_newest_send_first_with_counts(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        out = await ExtensionSurveys(KEY).list_surveys()
        assert [s.name for s in out] == ["Newest", "Iface", "Older"]
        newest = out[0]
        assert newest == ExtSurvey(
            id=str(surveyed["newest"].id),
            name="Newest",
            status="active",
            target_type="Application",
            card_count=3,
            targeted_card_count=3,
            user_count=2,
            response_count=4,
            completed_count=1,
            sent_at=NOW.isoformat(),
            closed_at=None,
        )
        # A survey with no request rows reads as zeros, not as an error.
        iface = out[1]
        assert (iface.response_count, iface.completed_count, iface.user_count) == (0, 0, 0)
        assert iface.targeted_card_count == 0 and iface.card_count == 0

    async def test_status_and_type_filters(self, db, surveyed):
        load_registry(grants=["core.surveys.write"])  # write implies read
        bridge = ExtensionSurveys(KEY)
        assert [s.name for s in await bridge.list_surveys(target_type="Application")] == [
            "Newest",
            "Older",
        ]
        assert [s.name for s in await bridge.list_surveys(status="closed")] == ["Closed"]
        assert [s.name for s in await bridge.list_surveys(status="draft")] == ["Draft"]
        assert await bridge.list_surveys(target_type="Nothing") == ()
        with pytest.raises(ExtensionDataError) as refused:
            await bridge.list_surveys(status="pending")
        assert str(refused.value) == (
            "Unknown survey status 'pending' (expected one of draft, active, closed)"
        )

    async def test_limit_is_clamped(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        bridge = ExtensionSurveys(KEY)
        assert [s.name for s in await bridge.list_surveys(limit=1)] == ["Newest"]
        assert len(await bridge.list_surveys(limit=0)) == 1  # floor of one
        assert len(await bridge.list_surveys(limit=10_000)) == 3
        assert bridge_mod.MAX_SURVEYS_PER_LIST == 200
        with pytest.raises(ExtensionDataError, match="whole number"):
            await bridge.list_surveys(limit="many")

    async def test_get_reports_the_same_counts(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        bridge = ExtensionSurveys(KEY)
        got = await bridge.get(str(surveyed["newest"].id))
        (listed,) = await bridge.list_surveys(limit=1)
        assert got == listed


class TestPendingResponses:
    async def test_pending_only_oldest_first_archived_left_out(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        out = await ExtensionSurveys(KEY).pending_responses(str(surveyed["newest"].id))
        sid = str(surveyed["newest"].id)
        owner = str(surveyed["owner"].id)
        t0 = NOW - timedelta(days=10)
        assert out == (
            ExtSurveyResponse(
                survey_id=sid,
                card_id=str(surveyed["b"].id),
                user_id=owner,
                status="pending",
                requested_at=t0.isoformat(),
            ),
            ExtSurveyResponse(
                survey_id=sid,
                card_id=str(surveyed["a"].id),
                user_id=owner,
                status="pending",
                requested_at=(t0 + timedelta(hours=2)).isoformat(),
            ),
        )

    async def test_card_filter(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        bridge = ExtensionSurveys(KEY)
        sid = str(surveyed["newest"].id)
        out = await bridge.pending_responses(sid, card_ids=[str(surveyed["a"].id)])
        assert [r.card_id for r in out] == [str(surveyed["a"].id)]
        assert await bridge.pending_responses(sid, card_ids=[]) == ()
        assert await bridge.pending_responses(sid, card_ids=[str(surveyed["iface"].id)]) == ()
        with pytest.raises(ExtensionDataError, match="Invalid card id"):
            await bridge.pending_responses(sid, card_ids=["nope"])
        with pytest.raises(ExtensionDataError, match="At most 500"):
            await bridge.pending_responses(sid, card_ids=[str(uuid.uuid4()) for _ in range(501)])

    async def test_scoped_to_one_survey_and_limit(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        bridge = ExtensionSurveys(KEY)
        older = await bridge.pending_responses(str(surveyed["older"].id))
        assert [(r.card_id, r.user_id) for r in older] == [
            (str(surveyed["b"].id), str(surveyed["other"].id))
        ]
        first = await bridge.pending_responses(str(surveyed["newest"].id), limit=1)
        assert [r.card_id for r in first] == [str(surveyed["b"].id)]
        assert len(await bridge.pending_responses(str(surveyed["newest"].id), limit=-5)) == 1
        assert bridge_mod.MAX_PENDING_PER_CALL == 5000

    async def test_unknown_or_malformed_survey_is_empty(self, db, surveyed):
        load_registry(grants=["core.surveys.read"])
        bridge = ExtensionSurveys(KEY)
        assert await bridge.pending_responses("not-a-uuid") == ()
        assert await bridge.pending_responses(str(uuid.uuid4())) == ()


class TestReadOrderingAndDefaults:
    async def test_surveys_tie_break_on_creation_then_id(self, db, env):
        load_registry(grants=["core.surveys.read"])
        # Drafts have no send time: newest creation first. Inserted oldest
        # first, so neither table order nor id order matches by chance.
        drafts = [
            await _survey(
                db, name=f"Draft {i}", status="draft", created_at=NOW - timedelta(days=10 - i)
            )
            for i in range(5)
        ]
        created = NOW - timedelta(days=2)
        same = [
            await _survey(db, name=f"Same {i}", status="closed", sent_at=NOW, created_at=created)
            for i in range(5)
        ]
        bridge = ExtensionSurveys(KEY)
        listed = await bridge.list_surveys(status="draft")
        assert [s.id for s in listed] == [str(d.id) for d in reversed(drafts)]
        closed = await bridge.list_surveys(status="closed")
        assert [s.id for s in closed] == sorted(str(s.id) for s in same)

    async def test_pending_rows_tie_break_on_id(self, db, env):
        load_registry(grants=["core.surveys.read"])
        survey = await _survey(db, name="Tie", sent_at=NOW)
        at = NOW - timedelta(days=4)
        rows = []
        for i in range(5):
            person = await create_user(
                db, email=f"tie{i}@test.com", role="member", display_name=f"Tie {i}"
            )
            rows.append(await _request(db, survey, env["a"], person, created_at=at))
        out = await ExtensionSurveys(KEY).pending_responses(str(survey.id))
        assert [r.user_id for r in out] == [
            str(r.user_id) for r in sorted(rows, key=lambda r: str(r.id))
        ]

    def test_signature_defaults_match_the_protocol(self):
        import inspect

        from app.services.extensions.sdk import SurveysBridge

        for cls in (SurveysBridge, ExtensionSurveys):
            listing = inspect.signature(cls.list_surveys).parameters
            assert listing["status"].default == "active"
            assert listing["target_type"].default is None
            assert listing["limit"].default == 200
            pending = inspect.signature(cls.pending_responses).parameters
            assert pending["card_ids"].default is None
            assert pending["limit"].default == 5000
