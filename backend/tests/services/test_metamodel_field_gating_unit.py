"""``_enforce_field_gating`` in ``api/v1/metamodel`` — pure, no database.

Only custom ``ext.*`` field types are gated (``metamodel.custom_field_types``).
Field help text is core since 2.174.0 (#1297) and passes through untouched.
"""

from __future__ import annotations

from app.api.v1.metamodel import CAP_CUSTOM_FIELD_TYPES, _enforce_field_gating


def _schema(**field):
    return [{"section": "Details", "fields": [{"key": "score", "label": "Score", **field}]}]


def _only(schema):
    return schema[0]["fields"][0]


def test_help_passes_through_without_any_grant():
    new = _schema(type="text", help="Why", helpTranslations={"de": "Warum"})
    old = _schema(type="text", help="Old", helpTranslations={"fr": "Ancien"})
    f = _only(_enforce_field_gating(new, old, set()))
    assert f["help"] == "Why"
    assert f["helpTranslations"] == {"de": "Warum"}


def test_the_retired_help_grant_changes_nothing():
    new = _schema(type="ext.plus.rating", help="Why")
    f = _only(_enforce_field_gating(new, [], {"metamodel.field_help"}))
    assert f["type"] == "text"
    assert f["help"] == "Why"


def test_new_custom_type_without_grant_falls_back_to_text():
    f = _only(_enforce_field_gating(_schema(type="ext.plus.rating"), [], set()))
    assert f["type"] == "text"


def test_custom_type_replacing_a_builtin_reverts_to_the_stored_builtin():
    old = _schema(type="number")
    f = _only(_enforce_field_gating(_schema(type="ext.plus.rating"), old, set()))
    assert f["type"] == "number"


def test_stored_custom_type_is_grandfathered():
    old = _schema(type="ext.plus.rating")
    f = _only(_enforce_field_gating(_schema(type="ext.plus.rating"), old, set()))
    assert f["type"] == "ext.plus.rating"


def test_switching_to_another_custom_type_is_not_grandfathered():
    old = _schema(type="ext.plus.rating")
    f = _only(_enforce_field_gating(_schema(type="ext.plus.stars"), old, set()))
    assert f["type"] == "text"


def test_grant_keeps_a_new_custom_type():
    new = _schema(type="ext.plus.rating")
    f = _only(_enforce_field_gating(new, [], {CAP_CUSTOM_FIELD_TYPES}))
    assert f["type"] == "ext.plus.rating"


def test_builtin_types_are_left_alone():
    f = _only(_enforce_field_gating(_schema(type="percentage"), [], set()))
    assert f["type"] == "percentage"


def test_tolerates_missing_and_malformed_input():
    assert _enforce_field_gating(None, None, set()) == []
    schema = ["not a section", {"section": "S", "fields": ["not a field", {"type": 3}]}]
    assert _enforce_field_gating(schema, ["junk"], set()) == schema
