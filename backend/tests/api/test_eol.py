"""Integration tests for the /eol (End-of-Life) endpoints.

These endpoints proxy the endoflife.date API. External HTTP calls are mocked
to avoid real network requests during tests.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)

pytestmark = pytest.mark.anyio

PRODUCTS_CACHE = ["python", "nodejs", "java", "ruby", "go", "nginx", "postgresql"]


# ---------------------------------------------------------------
# GET /eol/products  (list products)
# ---------------------------------------------------------------


class TestListProducts:
    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_list_products(self, client, db):
        """List all products returns cached product names."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = [p["name"] for p in data]
        assert "python" in names
        assert "nodejs" in names

    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_list_products_with_search(self, client, db):
        """Searching with ?search=py should filter to products containing 'py'."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products?search=py",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = [p["name"] for p in data]
        assert "python" in names
        # nodejs should not match 'py'
        assert "nodejs" not in names

    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_list_products_empty_search(self, client, db):
        """Empty search string returns all products."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products?search=",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == len(PRODUCTS_CACHE)


# ---------------------------------------------------------------
# GET /eol/products/fuzzy  (fuzzy search)
# ---------------------------------------------------------------


class TestFuzzySearchProducts:
    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_fuzzy_search(self, client, db):
        """Fuzzy search for 'python' should return python with a high score."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products/fuzzy?search=python",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["name"] == "python"
        assert data[0]["score"] >= 0.9

    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_fuzzy_search_partial(self, client, db):
        """Fuzzy search for 'node' should find 'nodejs'."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products/fuzzy?search=node",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        names = [p["name"] for p in data]
        assert "nodejs" in names


# ---------------------------------------------------------------
# GET /eol/products/{product}  (get product cycles)
# ---------------------------------------------------------------


class TestGetProductCycles:
    async def test_get_product_cycles(self, client, db):
        """Fetching cycles for a valid product should return cycle data."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        mock_cycles = [
            {"cycle": "3.12", "releaseDate": "2023-10-02", "eol": "2028-10-02", "lts": False},
            {"cycle": "3.11", "releaseDate": "2022-10-24", "eol": "2027-10-24", "lts": False},
        ]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = mock_cycles
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.is_closed = False

        with patch("app.api.v1.eol._client", mock_client):
            resp = await client.get(
                "/api/v1/eol/products/python",
                headers=auth_headers(admin),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["cycle"] == "3.12"

    async def test_get_product_invalid_name_characters(self, client, db):
        """Product names with invalid characters (SSRF prevention) should return 400."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products/../../etc/passwd",
            headers=auth_headers(admin),
        )
        # Path traversal chars will either hit 400 from our validation
        # or 404/422 from the router depending on the slash handling
        assert resp.status_code in (400, 404, 422)

    async def test_get_product_special_chars(self, client, db):
        """Product name with spaces or special chars should be rejected."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.get(
            "/api/v1/eol/products/bad%20name!",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------
# POST /eol/mass-search  (mass EOL search)
# ---------------------------------------------------------------


class TestMassEolSearch:
    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_mass_search_application(self, client, db):
        """Mass search for Application type cards returns fuzzy matches."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")
        await create_card(
            db,
            card_type="Application",
            name="Python Service",
            user_id=admin.id,
        )

        resp = await client.post(
            "/api/v1/eol/mass-search?type_key=Application",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["card_name"] == "Python Service"
        assert data[0]["card_type"] == "Application"
        # Should have candidate matches
        assert len(data[0]["candidates"]) >= 1

    async def test_mass_search_invalid_type(self, client, db):
        """Mass search with an invalid type_key should return 400."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")

        resp = await client.post(
            "/api/v1/eol/mass-search?type_key=Invalid",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 400
        assert "Application" in resp.json()["detail"] or "ITComponent" in resp.json()["detail"]

    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_mass_search_no_cards(self, client, db):
        """Mass search with no cards of that type returns empty list."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="Application", label="Application")

        resp = await client.post(
            "/api/v1/eol/mass-search?type_key=Application",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_mass_search_itcomponent(self, client, db):
        """Mass search also works for ITComponent type."""
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        admin = await create_user(db, email="admin@test.com", role="admin")
        await create_card_type(db, key="ITComponent", label="IT Component")
        await create_card(
            db,
            card_type="ITComponent",
            name="Nginx LB",
            user_id=admin.id,
        )

        resp = await client.post(
            "/api/v1/eol/mass-search?type_key=ITComponent",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["card_name"] == "Nginx LB"


# ---------------------------------------------------------------
# Permission checks
# ---------------------------------------------------------------


class TestEolPermissions:
    @patch("app.api.v1.eol._products_cache", PRODUCTS_CACHE)
    @patch("app.api.v1.eol._products_cache_time", 9999999999.0)
    async def test_unauthenticated_rejected(self, client, db):
        """EOL endpoints require authentication."""
        resp = await client.get("/api/v1/eol/products")
        assert resp.status_code == 401
