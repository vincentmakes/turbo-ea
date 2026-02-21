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


@pytest.fixture(scope="session")
def test_engine():
    """Create a test database engine and all tables. Drops tables at teardown.

    This is a *sync* fixture so the engine is not bound to any specific event
    loop.  NullPool ensures that connections are never cached — each
    ``engine.connect()`` call in the per-test ``db`` fixture creates a fresh
    asyncpg connection on whatever loop is current, avoiding cross-loop errors.
    """
    url = _test_db_url()
    engine = create_async_engine(url, echo=False, poolclass=NullPool)

    async def _setup():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    async def _teardown():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()

    try:
        asyncio.run(_setup())
    except Exception as exc:
        asyncio.run(engine.dispose())
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
# Permission cache cleanup (autouse)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_permission_cache():
    """Ensure permission caches are empty before and after every test."""
    from app.services.permission_service import PermissionService

    PermissionService._role_cache.clear()
    PermissionService._srd_cache.clear()
    yield
    PermissionService._role_cache.clear()
    PermissionService._srd_cache.clear()


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
        password_hash=hash_password(password),
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
        has_hierarchy=kwargs.get("has_hierarchy", False),
        built_in=kwargs.get("built_in", False),
        is_hidden=kwargs.get("is_hidden", False),
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
        status=kwargs.get("status", "ACTIVE"),
        approval_status=kwargs.get("approval_status", "DRAFT"),
        data_quality=kwargs.get("data_quality", 0.0),
        attributes=kwargs.get("attributes", {}),
        lifecycle=kwargs.get("lifecycle", {}),
        description=kwargs.get("description"),
        parent_id=kwargs.get("parent_id"),
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(card)
    await db.flush()
    return card


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
        built_in=kwargs.get("built_in", False),
        is_hidden=kwargs.get("is_hidden", False),
        sort_order=kwargs.get("sort_order", 0),
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
    )
    db.add(srd)
    await db.flush()
    return srd


def auth_headers(user) -> dict[str, str]:
    """Generate Bearer token headers for a test user."""
    token = create_access_token(user.id, user.role)
    return {"Authorization": f"Bearer {token}"}


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
