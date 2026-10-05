"""Shared test fixtures for the Turbo EA backend.

Provides:
- Async PostgreSQL test database (session-scoped engine, per-test rollback)
- FastAPI test client with overridden DB dependency
- Factory helpers for creating roles, users, card types, and cards
- Convenience fixtures for common test setups (admin_user, member_user, etc.)
"""

from __future__ import annotations

import os
import uuid

# Set test environment BEFORE any app imports so Settings() picks them up.
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only")
os.environ.setdefault("ENVIRONMENT", "development")

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event as sa_event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.core.security import create_access_token, hash_password
from app.models.base import Base

# ``--shard K/N`` (CI runs the suite as shards on parallel runners). Importing the
# hooks registers them on this conftest; the implementation lives in its own
# module so tests/core/test_shard_option.py can load it under ``pytester``.
from tests.shard_plugin import (  # noqa: F401
    pytest_addoption,
    pytest_collection_modifyitems,
    pytest_configure,
)

# Pre-computed bcrypt hash for the default test password "TestPassword1".
# Avoids ~200ms of CPU per create_user() call — saves minutes across 800+ tests.
_DEFAULT_PASSWORD = "TestPassword1"
_DEFAULT_PASSWORD_HASH = hash_password(_DEFAULT_PASSWORD)

# ---------------------------------------------------------------------------
# Database engine
# ---------------------------------------------------------------------------


def _test_db_url() -> str:
    user = os.getenv("POSTGRES_USER", "turboea")
    password = os.getenv("POSTGRES_PASSWORD", "turboea")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("TEST_POSTGRES_DB", "turboea_test")
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"


def _worker_schema() -> str | None:
    """Return a per-worker schema name when tests run in parallel processes.

    pytest-xdist names its workers. mutmut does not: it forks one pytest run
    per mutant, several at once, each of which would otherwise create and drop
    every table in the same schema under the others. ``MUTANT_UNDER_TEST`` is
    set in every process mutmut runs tests in, and a forked child's pid is
    unique among the ones alive at the same time.
    """
    worker = os.getenv("PYTEST_XDIST_WORKER")
    if worker:
        return f"test_{worker}"
    if os.getenv("MUTANT_UNDER_TEST"):
        return f"test_mut_{os.getpid()}"
    return None


@pytest.fixture(scope="session")
def test_engine():
    """Create a test database engine and all tables. Drops tables at teardown.

    This is a *sync* fixture so the engine is not bound to any specific event
    loop.  NullPool ensures that connections are never cached — each
    ``engine.connect()`` call in the per-test ``db`` fixture creates a fresh
    asyncpg connection on whatever loop is current, avoiding cross-loop errors.

    When running under pytest-xdist, each worker gets its own PostgreSQL schema
    to avoid DDL conflicts between parallel workers.
    """
    from sqlalchemy import text

    url = _test_db_url()
    schema = _worker_schema()

    connect_args = {}
    if schema:
        # Set search_path so all tables are created in the worker schema
        connect_args["server_settings"] = {"search_path": f"{schema},public"}

    engine = create_async_engine(url, echo=False, poolclass=NullPool, connect_args=connect_args)

    async def _setup():
        if schema:
            # Create the worker schema (use a raw connection without search_path)
            raw_engine = create_async_engine(url, echo=False, poolclass=NullPool)
            async with raw_engine.begin() as conn:
                await conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
                await conn.execute(text(f"CREATE SCHEMA {schema}"))
            await raw_engine.dispose()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    async def _teardown():
        if schema:
            raw_engine = create_async_engine(url, echo=False, poolclass=NullPool)
            async with raw_engine.begin() as conn:
                await conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
            await raw_engine.dispose()
        else:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    try:
        asyncio.run(_setup())
    except Exception as exc:
        asyncio.run(engine.dispose())
        # A skip is right for a laptop without Docker. For a mutation run it is
        # a silent lie: every database test skips, every mutant they would have
        # killed reads "no tests" or "survived", and the run still exits 0.
        if os.getenv("TEST_DB_REQUIRED"):
            pytest.fail(f"Test database not available ({exc}) and TEST_DB_REQUIRED is set")
        pytest.skip(f"Test database not available ({exc})")

    yield engine

    asyncio.run(_teardown())


# ---------------------------------------------------------------------------
# Per-test transactional session (savepoint rollback pattern)
# ---------------------------------------------------------------------------


@pytest.fixture
async def db(test_engine):
    """Provide a transactional session that rolls back after each test.

    Uses the savepoint pattern: an outer transaction wraps the entire test.
    When code under test calls ``session.commit()``, it releases the current
    savepoint; the ``after_transaction_end`` listener immediately opens a new
    one.  At teardown the outer transaction is rolled back, undoing everything.
    """
    conn = await test_engine.connect()
    trans = await conn.begin()
    session = AsyncSession(bind=conn, expire_on_commit=False)

    # Start a nested (savepoint) transaction.
    await conn.begin_nested()

    @sa_event.listens_for(session.sync_session, "after_transaction_end")
    def _restart_savepoint(sess, transaction):
        if conn.closed or conn.invalidated:
            return
        if not conn.in_nested_transaction():
            conn.sync_connection.begin_nested()

    yield session

    await session.close()
    await trans.rollback()
    await conn.close()


# ---------------------------------------------------------------------------
# FastAPI test app + HTTP client
# ---------------------------------------------------------------------------


@pytest.fixture
async def app(db):
    """Minimal FastAPI test app with ``get_db`` overridden to use the test session."""
    from fastapi import FastAPI
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    from app.api.v1.router import api_router
    from app.config import settings
    from app.core.rate_limit import limiter
    from app.database import get_db

    test_app = FastAPI()
    test_app.state.limiter = limiter
    test_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Mirror the production origin-tracking middleware so tests can verify
    # the audit log tags `X-Turbo-EA-Origin: mcp` writes correctly.
    from app.main import capture_request_origin

    test_app.middleware("http")(capture_request_origin)

    test_app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    async def _override_get_db():
        yield db

    test_app.dependency_overrides[get_db] = _override_get_db
    yield test_app
    test_app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    """HTTP test client for the test app."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c


# ---------------------------------------------------------------------------
# updated_at observation
# ---------------------------------------------------------------------------


@pytest.fixture
def card_update_sql(db):
    """Record whether each ``UPDATE cards`` re-derived ``updated_at`` from now().

    You cannot detect an ``updated_at`` bump by comparing timestamps in a test:
    PostgreSQL's ``now()`` is ``transaction_timestamp()``, constant for the life
    of a transaction, and the ``db`` fixture wraps the whole test in one. A
    before/after comparison is therefore byte-identical however many UPDATEs
    were emitted, and the assertion passes vacuously.

    The real discriminator is the rendered SET clause: ``updated_at=now()``
    when the ``onupdate`` default fired, a bound parameter when
    ``derived_writes`` pinned it. See the updated_at invariant in CLAUDE.md.
    """
    from types import SimpleNamespace

    statements: list[str] = []
    bind = db.sync_session.get_bind()

    @sa_event.listens_for(bind, "before_cursor_execute")
    def _record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("UPDATE CARDS"):
            statements.append(statement)

    yield SimpleNamespace(
        statements=statements,
        bumped=lambda: any("updated_at=now()" in s.lower() for s in statements),
        clear=statements.clear,
    )

    sa_event.remove(bind, "before_cursor_execute", _record)


# ---------------------------------------------------------------------------
# Permission cache cleanup (autouse)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_permission_cache():
    """Ensure permission caches are empty before and after every test."""
    from app.services.permission_service import PermissionService

    PermissionService._role_cache.clear()
    PermissionService._srd_cache.clear()
    PermissionService.invalidate_type_permission_cache()
    yield
    PermissionService._role_cache.clear()
    PermissionService._srd_cache.clear()
    PermissionService.invalidate_type_permission_cache()


@pytest.fixture(autouse=True)
def _disable_rate_limiter():
    """Disable slowapi rate limiting during tests to avoid 429 responses."""
    from app.core.rate_limit import limiter

    limiter.enabled = False
    yield
    limiter.enabled = True


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------


async def create_role(db, *, key="admin", label="Admin", permissions=None, is_system=True):
    """Insert a role into the test database."""
    from app.models.role import Role

    role = Role(
        key=key,
        label=label,
        permissions=permissions if permissions is not None else {"*": True},
        is_system=is_system,
        color="#757575",
    )
    db.add(role)
    await db.flush()
    return role


async def create_user(
    db,
    *,
    email=None,
    role="admin",
    password="TestPassword1",
    display_name="Test User",
):
    """Insert a user into the test database."""
    from app.models.user import User

    user = User(
        email=email or f"test-{uuid.uuid4().hex[:8]}@example.com",
        display_name=display_name,
        password_hash=(
            _DEFAULT_PASSWORD_HASH if password == _DEFAULT_PASSWORD else hash_password(password)
        ),
        role=role,
        is_active=True,
        auth_provider="local",
    )
    db.add(user)
    await db.flush()
    return user


async def create_card_type(
    db, *, key="Application", label="Application", fields_schema=None, **kwargs
):
    """Insert a card type into the test database."""
    from app.models.card_type import CardType

    ct = CardType(
        key=key,
        label=label,
        icon=kwargs.get("icon", "apps"),
        color=kwargs.get("color", "#0f7eb5"),
        fields_schema=fields_schema if fields_schema is not None else [],
        section_config=kwargs.get("section_config", {}),
        subtypes=kwargs.get("subtypes", []),
        # Legacy JSONB mirror of the stakeholder role definitions — only read
        # when the definition table has no rows for the type.
        stakeholder_roles=kwargs.get("stakeholder_roles", []),
        has_hierarchy=kwargs.get("has_hierarchy", False),
        hierarchy_labels=kwargs.get("hierarchy_labels", []),
        allow_card_logo=kwargs.get("allow_card_logo", False),
        # Per-role overrides of the type-scoped inventory permissions.
        role_permissions=kwargs.get("role_permissions", {}),
        built_in=kwargs.get("built_in", False),
        is_hidden=kwargs.get("is_hidden", False),
        translations=kwargs.get("translations", {}),
    )
    db.add(ct)
    await db.flush()
    return ct


async def create_card(db, *, card_type="Application", name="Test Card", user_id=None, **kwargs):
    """Insert a card into the test database."""
    from app.models.card import Card

    card = Card(
        type=card_type,
        name=name,
        subtype=kwargs.get("subtype"),
        status=kwargs.get("status", "ACTIVE"),
        approval_status=kwargs.get("approval_status", "DRAFT"),
        data_quality=kwargs.get("data_quality", 0.0),
        attributes=kwargs.get("attributes", {}),
        lifecycle=kwargs.get("lifecycle", {}),
        description=kwargs.get("description"),
        alias=kwargs.get("alias"),
        parent_id=kwargs.get("parent_id"),
        parent_label=kwargs.get("parent_label"),
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(card)
    await db.flush()
    return card


async def create_budget_line(db, *, initiative_id, fiscal_year=2025, category="capex", amount=0.0):
    """Insert a PPM budget line (planned spend for one fiscal year)."""
    from app.models.ppm_cost_line import PpmBudgetLine

    line = PpmBudgetLine(
        initiative_id=initiative_id,
        fiscal_year=fiscal_year,
        category=category,
        amount=amount,
    )
    db.add(line)
    await db.flush()
    return line


async def create_cost_line(
    db,
    *,
    initiative_id,
    category="capex",
    description="Cost line",
    planned=0.0,
    actual=0.0,
    date=None,
):
    """Insert a PPM cost line. ``date`` may be None — such a row counts towards
    the totals but belongs to no fiscal year."""
    from app.models.ppm_cost_line import PpmCostLine

    line = PpmCostLine(
        initiative_id=initiative_id,
        description=description,
        category=category,
        planned=planned,
        actual=actual,
        date=date,
    )
    db.add(line)
    await db.flush()
    return line


async def create_wbs(
    db, *, initiative_id, title="Work package", parent_id=None, completion=0.0, is_milestone=False
):
    """Insert a PPM work package (or milestone) row."""
    from app.models.ppm_wbs import PpmWbs

    wbs = PpmWbs(
        initiative_id=initiative_id,
        parent_id=parent_id,
        title=title,
        completion=completion,
        is_milestone=is_milestone,
    )
    db.add(wbs)
    await db.flush()
    return wbs


async def create_task(
    db, *, initiative_id, title="Task", status="todo", wbs_id=None, start_date=None, due_date=None
):
    """Insert a PPM task row."""
    from app.models.ppm_task import PpmTask

    task = PpmTask(
        initiative_id=initiative_id,
        title=title,
        status=status,
        wbs_id=wbs_id,
        start_date=start_date,
        due_date=due_date,
    )
    db.add(task)
    await db.flush()
    return task


async def create_ppm_risk(
    db, *, initiative_id, title="Risk", probability=3, impact=3, status="open"
):
    """Insert a PPM (initiative-scoped) risk row."""
    from app.models.ppm_risk import PpmRisk

    risk = PpmRisk(
        initiative_id=initiative_id,
        title=title,
        probability=probability,
        impact=impact,
        risk_score=probability * impact,
        status=status,
    )
    db.add(risk)
    await db.flush()
    return risk


async def create_status_report(
    db,
    *,
    initiative_id,
    report_date,
    schedule_health="onTrack",
    cost_health="onTrack",
    scope_health="onTrack",
):
    """Insert a PPM status report row."""
    from app.models.ppm_status_report import PpmStatusReport

    report = PpmStatusReport(
        initiative_id=initiative_id,
        report_date=report_date,
        schedule_health=schedule_health,
        cost_health=cost_health,
        scope_health=scope_health,
    )
    db.add(report)
    await db.flush()
    return report


async def create_relation_type(
    db,
    *,
    key="app_to_itc",
    label="Application to IT Component",
    source_type_key="Application",
    target_type_key="ITComponent",
    **kwargs,
):
    """Insert a relation type into the test database."""
    from app.models.relation_type import RelationType

    rt = RelationType(
        key=key,
        label=label,
        reverse_label=kwargs.get("reverse_label", f"Reverse {label}"),
        source_type_key=source_type_key,
        target_type_key=target_type_key,
        cardinality=kwargs.get("cardinality", "n:m"),
        attributes_schema=kwargs.get("attributes_schema", []),
        built_in=kwargs.get("built_in", False),
        is_hidden=kwargs.get("is_hidden", False),
        sort_order=kwargs.get("sort_order", 0),
        translations=kwargs.get("translations", {}),
    )
    db.add(rt)
    await db.flush()
    return rt


async def create_relation(db, *, type_key="app_to_itc", source_id=None, target_id=None, **kwargs):
    """Insert a relation instance into the test database."""
    from app.models.relation import Relation

    rel = Relation(
        type=type_key,
        source_id=source_id,
        target_id=target_id,
        attributes=kwargs.get("attributes", {}),
    )
    db.add(rel)
    await db.flush()
    return rel


async def create_stakeholder_role_def(
    db,
    *,
    card_type_key="Application",
    key="responsible",
    label="Responsible",
    permissions=None,
    **kwargs,
):
    """Insert a stakeholder role definition into the test database."""
    from app.models.stakeholder_role_definition import StakeholderRoleDefinition

    srd = StakeholderRoleDefinition(
        card_type_key=card_type_key,
        key=key,
        label=label,
        permissions=permissions if permissions is not None else {},
        color=kwargs.get("color", "#757575"),
        sort_order=kwargs.get("sort_order", 0),
        is_archived=kwargs.get("is_archived", False),
        counts_for_quality=kwargs.get("counts_for_quality", True),
    )
    db.add(srd)
    await db.flush()
    return srd


async def create_analysis_run(
    db, *, analysis_type="compliance", status="completed", user_id=None, results=None
):
    """Insert a TurboLens analysis run (the parent row every compliance
    finding and every background-analysis result hangs off)."""
    from datetime import datetime, timezone

    from app.models.turbolens import TurboLensAnalysisRun

    run = TurboLensAnalysisRun(
        id=uuid.uuid4(),
        analysis_type=analysis_type,
        status=status,
        started_at=datetime.now(timezone.utc),
        results=results,
        created_by=user_id,
    )
    db.add(run)
    await db.flush()
    return run


async def create_compliance_finding(db, run_id, **kwargs):
    """Insert a compliance finding on ``run_id`` with sensible defaults
    (a landscape-level GDPR DPIA finding, ``decision="verified"``)."""
    from app.models.turbolens import TurboLensComplianceFinding

    row = TurboLensComplianceFinding(
        id=uuid.uuid4(),
        run_id=run_id,
        regulation=kwargs.get("regulation", "gdpr"),
        regulation_article=kwargs.get("regulation_article", "Art. 35"),
        card_id=kwargs.get("card_id"),
        scope_type=kwargs.get("scope_type", "landscape" if not kwargs.get("card_id") else "card"),
        category=kwargs.get("category", "privacy"),
        requirement=kwargs.get("requirement", "A DPIA is required."),
        status=kwargs.get("status", "non_compliant"),
        severity=kwargs.get("severity", "high"),
        gap_description=kwargs.get("gap_description", "No DPIA on file."),
        evidence=kwargs.get("evidence"),
        remediation=kwargs.get("remediation", "Run and document a DPIA."),
        ai_detected=kwargs.get("ai_detected", False),
        finding_key=kwargs.get("finding_key", f"k-{uuid.uuid4().hex}"),
        decision=kwargs.get("decision", "verified"),
        risk_id=kwargs.get("risk_id"),
    )
    db.add(row)
    await db.flush()
    return row


async def create_risk(
    db, *, title="Risk", reference=None, status="identified", owner_id=None, **kwargs
):
    """Insert an EA Risk Register row. ``reference`` defaults to the next
    free ``R-NNNNNN`` so several risks can be created in one test."""
    from app.models.risk import Risk
    from app.services.risk_service import derive_level, next_reference

    initial_probability = kwargs.get("initial_probability", "medium")
    initial_impact = kwargs.get("initial_impact", "medium")
    residual_probability = kwargs.get("residual_probability")
    residual_impact = kwargs.get("residual_impact")
    risk = Risk(
        reference=reference or await next_reference(db),
        title=title,
        description=kwargs.get("description", ""),
        category=kwargs.get("category", "operational"),
        source_type=kwargs.get("source_type", "manual"),
        source_ref=kwargs.get("source_ref"),
        initial_probability=initial_probability,
        initial_impact=initial_impact,
        initial_level=derive_level(initial_probability, initial_impact),
        residual_probability=residual_probability,
        residual_impact=residual_impact,
        residual_level=(
            derive_level(residual_probability, residual_impact)
            if residual_probability and residual_impact
            else None
        ),
        owner_id=owner_id,
        target_resolution_date=kwargs.get("target_resolution_date"),
        status=status,
        acceptance_rationale=kwargs.get("acceptance_rationale"),
        created_by=kwargs.get("created_by"),
    )
    db.add(risk)
    await db.flush()
    return risk


def auth_headers(user) -> dict[str, str]:
    """Generate Bearer token headers for a test user."""
    token = create_access_token(user.id, user.role)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Seams for code that reaches outside the request (see tests/seams.py)
# ---------------------------------------------------------------------------

# Every place the app opens a session of its own. The first is the lazy
# ``from app.database import async_session`` inside background tasks and
# loops; the rest bind the name at import time and must be patched where
# they hold it.
_ASYNC_SESSION_TARGETS = (
    "app.database.async_session",
    "app.api.v1.migration.async_session",
    "app.api.v1.workspace.async_session",
    "app.services.extensions.startup.async_session",
)


@pytest.fixture
def patched_async_session(db, monkeypatch):
    """Hand the test's savepoint session to every ``async_session()`` the
    code under test opens, so background jobs see the test's rows and
    cannot leak a connection to the real database. Returns the factory."""
    from tests.seams import session_factory_for

    factory = session_factory_for(db)
    for target in _ASYNC_SESSION_TARGETS:
        monkeypatch.setattr(target, factory)
    return factory


@pytest.fixture
def fake_call_ai(monkeypatch):
    """A scripted ``call_ai`` installed on every module that consumes it."""
    from tests.seams import FakeCallAi

    return FakeCallAi().install(monkeypatch)


@pytest.fixture
def sources_registry_snapshot():
    """Restore the migration adapter registry after a test registers a
    throwaway source (``register_source`` mutates module state)."""
    from app.services.migration.registry import SOURCES

    before = dict(SOURCES)
    yield
    SOURCES.clear()
    SOURCES.update(before)


# ---------------------------------------------------------------------------
# Convenience fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def admin_role(db):
    return await create_role(db, key="admin", label="Admin", permissions={"*": True})


@pytest.fixture
async def member_role(db):
    return await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)


@pytest.fixture
async def viewer_role(db):
    return await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)


@pytest.fixture
async def admin_user(db, admin_role):
    return await create_user(db, email="admin@test.com", role="admin")


@pytest.fixture
async def member_user(db, member_role):
    return await create_user(db, email="member@test.com", role="member")


@pytest.fixture
async def viewer_user(db, viewer_role):
    return await create_user(db, email="viewer@test.com", role="viewer")


@pytest.fixture
async def app_card_type(db):
    return await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "General",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "weight": 1,
                        "options": [
                            {"key": "low", "label": "Low"},
                            {"key": "medium", "label": "Medium"},
                            {"key": "high", "label": "High"},
                        ],
                    },
                    {
                        "key": "website",
                        "label": "Website",
                        "type": "url",
                        "weight": 0,
                    },
                ],
            }
        ],
    )
