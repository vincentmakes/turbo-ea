"""Unit tests for Card and Auth schema validators.

Tests _check_depth, _validate_jsonb_dict, CardCreate/CardUpdate validators,
and password strength validation. No database required.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.auth import RegisterRequest, _validate_password_strength
from app.schemas.card import (
    CardCreate,
    CardUpdate,
    _check_depth,
    _validate_jsonb_dict,
)

# ---------------------------------------------------------------------------
# _check_depth
# ---------------------------------------------------------------------------


class TestCheckDepth:
    def test_flat_dict(self):
        assert _check_depth({"a": 1, "b": 2}) == 1

    def test_empty_dict(self):
        assert _check_depth({}) == 0

    def test_empty_list(self):
        assert _check_depth([]) == 0

    def test_scalar(self):
        assert _check_depth(42) == 0
        assert _check_depth("hello") == 0
        assert _check_depth(None) == 0

    def test_nested_dict_depth_2(self):
        assert _check_depth({"a": {"b": 1}}) == 2

    def test_nested_dict_depth_5(self):
        d = {"a": {"b": {"c": {"d": {"e": 1}}}}}
        assert _check_depth(d) == 5

    def test_nested_dict_depth_6(self):
        d = {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}
        assert _check_depth(d) == 6

    def test_list_nesting(self):
        # List adds depth
        assert _check_depth([{"a": 1}]) == 2

    def test_mixed_dict_list_nesting(self):
        d = {"a": [{"b": [{"c": 1}]}]}
        assert _check_depth(d) == 5

    def test_short_circuits_past_max_depth(self):
        """Depth exceeding _MAX_DICT_DEPTH+1 is capped for early exit."""
        d = {"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}}
        depth = _check_depth(d)
        assert depth > 5  # It exceeds max, exact value may vary


# ---------------------------------------------------------------------------
# _validate_jsonb_dict
# ---------------------------------------------------------------------------


class TestValidateJsonbDict:
    def test_none_passes(self):
        assert _validate_jsonb_dict(None, "test") is None

    def test_empty_dict_passes(self):
        assert _validate_jsonb_dict({}, "test") == {}

    def test_normal_dict_passes(self):
        d = {"key1": "value1", "key2": 42}
        assert _validate_jsonb_dict(d, "test") == d

    def test_max_keys_exactly_passes(self):
        d = {f"key{i}": i for i in range(200)}
        assert _validate_jsonb_dict(d, "test") == d

    def test_exceeds_max_keys(self):
        d = {f"key{i}": i for i in range(201)}
        with pytest.raises(ValueError, match="exceeds maximum of 200 keys"):
            _validate_jsonb_dict(d, "attributes")

    def test_depth_at_limit_passes(self):
        d = {"a": {"b": {"c": {"d": {"e": 1}}}}}
        assert _validate_jsonb_dict(d, "test") == d

    def test_exceeds_max_depth(self):
        d = {"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}}
        with pytest.raises(ValueError, match="exceeds maximum nesting depth"):
            _validate_jsonb_dict(d, "lifecycle")

    def test_exceeds_max_size(self):
        # Create a dict whose repr exceeds 50,000 chars
        d = {"key": "x" * 50_001}
        with pytest.raises(ValueError, match="exceeds maximum serialised size"):
            _validate_jsonb_dict(d, "attributes")

    def test_field_name_in_error_message(self):
        d = {f"key{i}": i for i in range(201)}
        with pytest.raises(ValueError, match="lifecycle"):
            _validate_jsonb_dict(d, "lifecycle")

    def test_nested_list_within_depth_passes(self):
        d = {"items": [{"a": 1}, {"b": 2}]}
        assert _validate_jsonb_dict(d, "test") == d

    def test_deeply_nested_list_fails(self):
        d = {"a": [{"b": [{"c": [{"d": [{"e": 1}]}]}]}]}
        with pytest.raises(ValueError, match="nesting depth"):
            _validate_jsonb_dict(d, "test")


# ---------------------------------------------------------------------------
# CardCreate validators
# ---------------------------------------------------------------------------


class TestCardCreateValidators:
    def test_valid_card_create(self):
        card = CardCreate(
            type="Application",
            name="My App",
            lifecycle={"startDate": "2024-01-01"},
            attributes={"cost": 100},
        )
        assert card.name == "My App"
        assert card.lifecycle == {"startDate": "2024-01-01"}

    def test_none_lifecycle_and_attributes_pass(self):
        card = CardCreate(type="Application", name="App")
        assert card.lifecycle is None
        assert card.attributes is None

    def test_oversized_attributes_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            CardCreate(
                type="Application",
                name="App",
                attributes={f"key{i}": i for i in range(201)},
            )
        assert "exceeds maximum of 200 keys" in str(exc_info.value)

    def test_deep_lifecycle_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            CardCreate(
                type="Application",
                name="App",
                lifecycle={"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}},
            )
        assert "nesting depth" in str(exc_info.value)

    def test_deep_attributes_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            CardCreate(
                type="Application",
                name="App",
                attributes={"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}},
            )
        assert "nesting depth" in str(exc_info.value)


# ---------------------------------------------------------------------------
# CardUpdate validators
# ---------------------------------------------------------------------------


class TestCardUpdateValidators:
    def test_valid_card_update(self):
        update = CardUpdate(name="New Name", attributes={"cost": 200})
        assert update.name == "New Name"

    def test_none_fields_pass(self):
        update = CardUpdate()
        assert update.lifecycle is None
        assert update.attributes is None

    def test_oversized_attributes_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            CardUpdate(attributes={f"k{i}": i for i in range(201)})
        assert "exceeds maximum of 200 keys" in str(exc_info.value)

    def test_deep_lifecycle_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            CardUpdate(lifecycle={"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}})
        assert "nesting depth" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Password strength validation
# ---------------------------------------------------------------------------


class TestPasswordStrength:
    def test_valid_password(self):
        result = _validate_password_strength("MyPassword1")
        assert result == "MyPassword1"

    def test_valid_exactly_10_chars(self):
        result = _validate_password_strength("Abcde12345")
        assert result == "Abcde12345"

    def test_too_short(self):
        with pytest.raises(ValueError, match="at least 10 characters"):
            _validate_password_strength("Short1A")

    def test_no_uppercase(self):
        with pytest.raises(ValueError, match="uppercase letter"):
            _validate_password_strength("alllowercase1")

    def test_no_digit(self):
        with pytest.raises(ValueError, match="one digit"):
            _validate_password_strength("NoDigitHere")

    def test_exactly_9_chars_fails(self):
        with pytest.raises(ValueError, match="at least 10"):
            _validate_password_strength("Abcde1234")

    def test_long_valid_password(self):
        result = _validate_password_strength("A" + "x" * 50 + "1")
        assert len(result) == 52

    def test_special_chars_ok(self):
        result = _validate_password_strength("P@ssw0rd!!")
        assert result == "P@ssw0rd!!"


# ---------------------------------------------------------------------------
# RegisterRequest schema
# ---------------------------------------------------------------------------


class TestRegisterRequest:
    def test_valid_register(self):
        req = RegisterRequest(
            email="user@example.com",
            display_name="Test User",
            password="ValidPass1",
        )
        assert req.email == "user@example.com"

    def test_weak_password_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            RegisterRequest(
                email="user@example.com",
                display_name="Test",
                password="weak",
            )
        assert "10 characters" in str(exc_info.value)

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="not-an-email",
                display_name="Test",
                password="ValidPass1",
            )

    def test_empty_display_name_rejected(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="user@example.com",
                display_name="",
                password="ValidPass1",
            )

    def test_display_name_too_long_rejected(self):
        with pytest.raises(ValidationError):
            RegisterRequest(
                email="user@example.com",
                display_name="x" * 201,
                password="ValidPass1",
            )
