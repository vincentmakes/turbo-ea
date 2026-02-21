"""Unit tests for the ServiceNow service layer.

Tests ServiceNowClient, FieldTransformer, SyncEngine, and credential helpers
WITHOUT requiring a database or external ServiceNow instance.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.servicenow_service import (
    INSTANCE_URL_PATTERN,
    FieldTransformer,
    ServiceNowClient,
    SyncEngine,
    _get_nested,
    _set_nested,
    decrypt_credentials,
    encrypt_credentials,
)

# ---------------------------------------------------------------------------
# Credential encryption helpers
# ---------------------------------------------------------------------------


class TestCredentialEncryption:
    def test_round_trip(self):
        """encrypt then decrypt returns original credentials."""
        creds = {"username": "admin", "password": "s3cret"}
        encrypted = encrypt_credentials(creds)
        assert "_enc" in encrypted
        assert encrypted["_enc"] != json.dumps(creds)
        decrypted = decrypt_credentials(encrypted)
        assert decrypted == creds

    def test_decrypt_empty_no_enc_key(self):
        """Decrypting a dict without _enc returns it unchanged (legacy path)."""
        legacy = {"username": "admin", "password": "plain"}
        assert decrypt_credentials(legacy) == legacy

    def test_decrypt_invalid_token(self):
        """Corrupted _enc returns empty dict."""
        assert decrypt_credentials({"_enc": "not-valid-fernet-token"}) == {}


# ---------------------------------------------------------------------------
# Instance URL validation
# ---------------------------------------------------------------------------


class TestInstanceUrlPattern:
    @pytest.mark.parametrize(
        "url",
        [
            "https://mycompany.service-now.com",
            "https://dev12345.service-now.com",
            "https://mycompany.servicenowservices.com",
            "https://mycompany.service-now.com/api/now",
            "https://mycompany.service-now.com:8443",
        ],
    )
    def test_valid_urls(self, url):
        assert INSTANCE_URL_PATTERN.match(url) is not None

    @pytest.mark.parametrize(
        "url",
        [
            "http://insecure.service-now.com",
            "https://evil.example.com",
            "ftp://mycompany.service-now.com",
            "https://",
            "",
        ],
    )
    def test_invalid_urls(self, url):
        assert INSTANCE_URL_PATTERN.match(url) is None


# ---------------------------------------------------------------------------
# Nested path helpers
# ---------------------------------------------------------------------------


class TestNestedHelpers:
    def test_set_nested_simple(self):
        d: dict = {}
        _set_nested(d, "name", "MyApp")
        assert d == {"name": "MyApp"}

    def test_set_nested_dotted(self):
        d: dict = {}
        _set_nested(d, "attributes.businessCriticality", "high")
        assert d == {"attributes": {"businessCriticality": "high"}}

    def test_set_nested_deep(self):
        d: dict = {}
        _set_nested(d, "a.b.c", 42)
        assert d == {"a": {"b": {"c": 42}}}

    def test_get_nested_simple(self):
        assert _get_nested({"name": "App"}, "name") == "App"

    def test_get_nested_dotted(self):
        d = {"attributes": {"cost": 100}}
        assert _get_nested(d, "attributes.cost") == 100

    def test_get_nested_missing_key(self):
        assert _get_nested({"a": 1}, "b") is None

    def test_get_nested_missing_intermediate(self):
        assert _get_nested({"a": 1}, "a.b") is None

    def test_get_nested_none_intermediate(self):
        assert _get_nested({}, "a.b.c") is None


# ---------------------------------------------------------------------------
# FieldTransformer
# ---------------------------------------------------------------------------


class TestFieldTransformerValues:
    """Tests for FieldTransformer.transform_value."""

    def test_direct_passthrough(self):
        assert FieldTransformer.transform_value("hello", "direct", None) == "hello"

    def test_none_transform_type(self):
        assert FieldTransformer.transform_value("hello", None, None) == "hello"

    def test_value_map_snow_to_turbo(self):
        config = {"mapping": {"1": "critical", "2": "high", "3": "medium"}}
        assert FieldTransformer.transform_value("1", "value_map", config) == "critical"
        assert FieldTransformer.transform_value("3", "value_map", config) == "medium"
        # Unknown key returns original value
        assert FieldTransformer.transform_value("99", "value_map", config) == "99"

    def test_value_map_turbo_to_snow(self):
        config = {"mapping": {"1": "critical", "2": "high"}}
        result = FieldTransformer.transform_value(
            "critical", "value_map", config, direction="turbo_to_snow"
        )
        assert result == "1"

    def test_value_map_turbo_to_snow_unknown(self):
        config = {"mapping": {"1": "critical"}}
        result = FieldTransformer.transform_value(
            "unknown", "value_map", config, direction="turbo_to_snow"
        )
        assert result == "unknown"

    def test_date_format_full_datetime(self):
        result = FieldTransformer.transform_value("2024-06-15 10:30:00", "date_format", {})
        assert result == "2024-06-15"

    def test_date_format_short_string(self):
        result = FieldTransformer.transform_value("2024-06", "date_format", {})
        assert result == "2024-06"

    def test_date_format_empty(self):
        assert FieldTransformer.transform_value("", "date_format", {}) is None
        assert FieldTransformer.transform_value(None, "date_format", {}) is None

    def test_boolean_snow_to_turbo(self):
        assert FieldTransformer.transform_value("true", "boolean", {}) is True
        assert FieldTransformer.transform_value("1", "boolean", {}) is True
        assert FieldTransformer.transform_value("yes", "boolean", {}) is True
        assert FieldTransformer.transform_value("false", "boolean", {}) is False
        assert FieldTransformer.transform_value("0", "boolean", {}) is False

    def test_boolean_turbo_to_snow(self):
        result = FieldTransformer.transform_value(True, "boolean", {}, direction="turbo_to_snow")
        assert result == "true"
        result = FieldTransformer.transform_value(False, "boolean", {}, direction="turbo_to_snow")
        assert result == "false"

    def test_unknown_transform_type(self):
        """Unknown transform types return value unchanged."""
        assert FieldTransformer.transform_value("x", "weird_type", {}) == "x"


class TestFieldTransformerMappings:
    """Tests for FieldTransformer.apply_mappings with mock SnowFieldMapping objects."""

    @staticmethod
    def _make_fm(
        snow_field: str,
        turbo_field: str,
        direction: str = "snow_leads",
        transform_type: str | None = None,
        transform_config: dict | None = None,
        is_identity: bool = False,
    ):
        """Create a mock SnowFieldMapping."""
        fm = SimpleNamespace()
        fm.snow_field = snow_field
        fm.turbo_field = turbo_field
        fm.direction = direction
        fm.transform_type = transform_type
        fm.transform_config = transform_config
        fm.is_identity = is_identity
        return fm

    def test_snow_to_turbo_basic(self):
        fms = [
            self._make_fm("name", "name"),
            self._make_fm("u_criticality", "attributes.businessCriticality"),
        ]
        record = {"name": "MyApp", "u_criticality": "high"}
        result = FieldTransformer.apply_mappings(record, fms, "snow_to_turbo")
        assert result == {"name": "MyApp", "attributes": {"businessCriticality": "high"}}

    def test_turbo_to_snow_basic(self):
        fms = [
            self._make_fm("name", "name", direction="turbo_leads"),
            self._make_fm("u_cost", "attributes.cost", direction="turbo_leads"),
        ]
        record = {"name": "MyApp", "attributes": {"cost": 5000}}
        result = FieldTransformer.apply_mappings(record, fms, "turbo_to_snow")
        assert result == {"name": "MyApp", "u_cost": 5000}

    def test_direction_filtering_snow_to_turbo(self):
        """turbo_leads fields are skipped when pulling snow_to_turbo."""
        fms = [
            self._make_fm("name", "name", direction="snow_leads"),
            self._make_fm("u_score", "attributes.score", direction="turbo_leads"),
        ]
        record = {"name": "App", "u_score": "99"}
        result = FieldTransformer.apply_mappings(record, fms, "snow_to_turbo")
        assert "attributes" not in result
        assert result == {"name": "App"}

    def test_direction_filtering_turbo_to_snow(self):
        """snow_leads fields are skipped when pushing turbo_to_snow."""
        fms = [
            self._make_fm("name", "name", direction="snow_leads"),
            self._make_fm("u_score", "attributes.score", direction="turbo_leads"),
        ]
        record = {"name": "App", "attributes": {"score": 99}}
        result = FieldTransformer.apply_mappings(record, fms, "turbo_to_snow")
        assert "name" not in result
        assert result == {"u_score": 99}

    def test_with_value_map_transform(self):
        fms = [
            self._make_fm(
                "priority",
                "attributes.priority",
                transform_type="value_map",
                transform_config={"mapping": {"1": "critical", "2": "high"}},
            ),
        ]
        record = {"priority": "1"}
        result = FieldTransformer.apply_mappings(record, fms, "snow_to_turbo")
        assert result == {"attributes": {"priority": "critical"}}


# ---------------------------------------------------------------------------
# ServiceNowClient
# ---------------------------------------------------------------------------


class TestServiceNowClient:
    """Tests for the async HTTP client (mocking httpx)."""

    async def test_basic_auth_setup(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
            auth_type="basic",
        )
        http_client = await client._get_client()
        assert http_client.auth is not None
        await client.close()

    async def test_oauth2_auth_setup(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"access_token": "my-token"},
            auth_type="oauth2",
        )
        http_client = await client._get_client()
        assert http_client.headers.get("Authorization") == "Bearer my-token"
        await client.close()

    async def test_test_connection_success(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_response)
            mock_get.return_value = mock_http
            ok, msg = await client.test_connection()

        assert ok is True
        assert msg == "Connection successful"

    async def test_test_connection_failure_http_error(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(side_effect=httpx.ConnectError("refused"))
            mock_get.return_value = mock_http
            ok, msg = await client.test_connection()

        assert ok is False
        assert "Connection failed" in msg

    async def test_test_connection_failure_non_200(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"

        with patch.object(client, "_get_client") as mock_get:
            mock_http = AsyncMock()
            mock_http.get = AsyncMock(return_value=mock_response)
            mock_get.return_value = mock_http
            ok, msg = await client.test_connection()

        assert ok is False
        assert "401" in msg

    async def test_list_table_fields_invalid_table(self):
        """Invalid table name returns empty list without making HTTP call."""
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        result = await client.list_table_fields("'; DROP TABLE--")
        assert result == []

    async def test_fetch_records_invalid_table(self):
        """Invalid table name returns empty without HTTP call."""
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        records, total = await client.fetch_records("bad table!")
        assert records == []
        assert total == 0

    async def test_create_record_invalid_table(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        with pytest.raises(ValueError, match="Invalid table name"):
            await client.create_record("bad table!", {})

    async def test_update_record_invalid_table(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        with pytest.raises(ValueError, match="Invalid table name"):
            await client.update_record("bad!", "a" * 32, {})

    async def test_update_record_invalid_sys_id(self):
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        with pytest.raises(ValueError, match="Invalid sys_id"):
            await client.update_record("cmdb_ci", "not-a-valid-sysid", {})

    async def test_close_noop_when_no_client(self):
        """Closing a client that was never opened is safe."""
        client = ServiceNowClient(
            "https://test.service-now.com",
            {"username": "admin", "password": "pass"},
        )
        await client.close()  # Should not raise

    async def test_trailing_slash_stripped(self):
        client = ServiceNowClient(
            "https://test.service-now.com/",
            {"username": "admin", "password": "pass"},
        )
        assert client.instance_url == "https://test.service-now.com"


# ---------------------------------------------------------------------------
# SyncEngine._compute_diff
# ---------------------------------------------------------------------------


class TestSyncEngineComputeDiff:
    """Tests for _compute_diff (no DB needed — operates on card objects)."""

    @staticmethod
    def _make_card(name="App", description="Desc", lifecycle=None, attributes=None):
        card = SimpleNamespace()
        card.name = name
        card.description = description
        card.lifecycle = lifecycle or {}
        card.attributes = attributes or {}
        return card

    def test_no_diff_when_identical(self):
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(name="App", attributes={"cost": 100})
        transformed = {"name": "App", "attributes": {"cost": 100}}
        assert engine._compute_diff(card, transformed) is None

    def test_diff_name_change(self):
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(name="OldApp")
        transformed = {"name": "NewApp"}
        diff = engine._compute_diff(card, transformed)
        assert diff == {"name": {"old": "OldApp", "new": "NewApp"}}

    def test_diff_description_change(self):
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(description="Old desc")
        transformed = {"description": "New desc"}
        diff = engine._compute_diff(card, transformed)
        assert diff == {"description": {"old": "Old desc", "new": "New desc"}}

    def test_diff_lifecycle_change(self):
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(lifecycle={"startDate": "2024-01-01"})
        transformed = {"lifecycle": {"startDate": "2025-01-01"}}
        diff = engine._compute_diff(card, transformed)
        assert diff == {"lifecycle.startDate": {"old": "2024-01-01", "new": "2025-01-01"}}

    def test_diff_attribute_change(self):
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(attributes={"cost": 100})
        transformed = {"attributes": {"cost": 200}}
        diff = engine._compute_diff(card, transformed)
        assert diff == {"attributes.cost": {"old": 100, "new": 200}}

    def test_diff_skips_empty_new_values(self):
        """Empty new values should not generate diffs."""
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(name="App")
        transformed = {"name": ""}
        diff = engine._compute_diff(card, transformed)
        assert diff is None

    def test_diff_attribute_none_not_reported(self):
        """None attribute values should not generate diffs."""
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(attributes={"cost": 100})
        transformed = {"attributes": {"cost": None}}
        diff = engine._compute_diff(card, transformed)
        assert diff is None

    def test_diff_multiple_changes(self):
        engine = SyncEngine(db=None, client=None)
        card = self._make_card(name="Old", attributes={"tier": "bronze"})
        transformed = {"name": "New", "attributes": {"tier": "gold"}}
        diff = engine._compute_diff(card, transformed)
        assert "name" in diff
        assert "attributes.tier" in diff
