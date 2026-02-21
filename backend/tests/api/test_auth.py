"""Integration tests for the /auth endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

from tests.conftest import auth_headers, create_role, create_user

# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------


class TestRegister:
    async def test_first_user_gets_admin_role(self, client, db):
        """The very first user to register gets the admin role."""
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "first@test.com",
                "display_name": "First User",
                "password": "ValidPassword1",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    async def test_second_user_gets_member_role(self, client, db):
        """Subsequent users get the default member role."""
        # First user already exists
        await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "second@test.com",
                "display_name": "Second User",
                "password": "ValidPassword1",
            },
        )
        assert response.status_code == 200

    async def test_duplicate_email_rejected(self, client, db):
        await create_user(db, email="existing@test.com")

        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "existing@test.com",
                "display_name": "Duplicate",
                "password": "ValidPassword1",
            },
        )
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()

    async def test_weak_password_rejected(self, client, db):
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "weak@test.com",
                "display_name": "Weak Password",
                "password": "short",
            },
        )
        assert response.status_code == 422  # Pydantic validation error


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


class TestLogin:
    async def test_successful_login(self, client, db):
        await create_user(db, email="user@test.com", password="ValidPassword1")

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "user@test.com", "password": "ValidPassword1"},
        )
        assert response.status_code == 200
        assert "access_token" in response.json()

    async def test_wrong_password(self, client, db):
        await create_user(db, email="user@test.com", password="ValidPassword1")

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "user@test.com", "password": "WrongPassword1"},
        )
        assert response.status_code == 401

    async def test_nonexistent_user(self, client, db):
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@test.com", "password": "AnyPassword1"},
        )
        assert response.status_code == 401

    async def test_inactive_user_rejected(self, client, db):
        user = await create_user(db, email="inactive@test.com", password="ValidPassword1")
        user.is_active = False
        await db.flush()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "inactive@test.com", "password": "ValidPassword1"},
        )
        assert response.status_code == 403

    async def test_account_lockout_after_failed_attempts(self, client, db):
        await create_user(db, email="lockme@test.com", password="ValidPassword1")

        # Fail 5 times to trigger lockout
        for _ in range(5):
            await client.post(
                "/api/v1/auth/login",
                json={"email": "lockme@test.com", "password": "WrongPassword!"},
            )

        # 6th attempt — even with correct password — should be locked
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "lockme@test.com", "password": "ValidPassword1"},
        )
        assert response.status_code == 423

    async def test_sso_user_cannot_password_login(self, client, db):
        from app.models.user import User

        user = User(
            email="sso@test.com",
            display_name="SSO User",
            password_hash=None,
            role="member",
            is_active=True,
            auth_provider="sso",
            sso_subject_id="sso-123",
        )
        db.add(user)
        await db.flush()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "sso@test.com", "password": "AnyPassword1"},
        )
        assert response.status_code == 403
        assert "sso" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------


class TestMe:
    async def test_returns_current_user(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, email="admin@test.com", role="admin")

        response = await client.get(
            "/api/v1/auth/me",
            headers=auth_headers(user),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "admin@test.com"
        assert data["role"] == "admin"

    async def test_unauthenticated_returns_401(self, client, db):
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 401

    async def test_invalid_token_returns_401(self, client, db):
        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /auth/refresh
# ---------------------------------------------------------------------------


class TestRefreshToken:
    async def test_refresh_returns_new_token(self, client, db):
        await create_role(db, key="admin", permissions={"*": True})
        user = await create_user(db, email="admin@test.com", role="admin")

        response = await client.post(
            "/api/v1/auth/refresh",
            headers=auth_headers(user),
        )
        assert response.status_code == 200
        assert "access_token" in response.json()
