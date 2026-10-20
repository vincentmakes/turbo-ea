"""Unit tests for the PPM board's ``group_by`` parsing (no database)."""

from __future__ import annotations

from app.services.ppm_portfolio_service import SUBTYPE_GROUP_PREFIX, subtype_group_key


class TestSubtypeGroupKey:
    def test_the_prefix_is_the_wire_format(self):
        assert SUBTYPE_GROUP_PREFIX == "subtype:"

    def test_a_subtype_value_names_its_key(self):
        assert subtype_group_key("subtype:program") == "program"

    def test_only_the_leading_prefix_is_stripped(self):
        assert subtype_group_key("subtype:subtype:x") == "subtype:x"

    def test_an_empty_key_is_still_a_subtype_value(self):
        assert subtype_group_key("subtype:") == ""

    def test_a_type_key_is_not_a_subtype_value(self):
        assert subtype_group_key("Organization") is None
        assert subtype_group_key("xsubtype:program") is None
        assert subtype_group_key("Subtype:program") is None

    def test_no_value(self):
        assert subtype_group_key(None) is None
        assert subtype_group_key("") is None
