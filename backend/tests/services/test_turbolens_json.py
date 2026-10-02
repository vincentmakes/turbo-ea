"""The JSON side of ``turbolens_ai``: parsing and repairing model output,
the prompt blocks and the ``is_ai_configured`` gate. No database."""

from __future__ import annotations

import pytest

from app.services.turbolens_ai import (
    _salvage_objects,
    format_principles_block,
    format_principles_block_advisory,
    is_ai_configured,
    parse_json,
    repair_truncated_json,
)


class TestParseJson:
    def test_direct_and_fenced(self):
        assert parse_json('{"a": 1}') == {"a": 1}
        assert parse_json("```json\n[1, 2]\n```") == [1, 2]
        assert parse_json('```\n{"a": 1}\n```') == {"a": 1}

    def test_prose_around_the_json(self):
        assert parse_json('Sure! Here it is: {"a": 1} Hope this helps.') == {"a": 1}
        assert parse_json('Result:\n[{"a": 1}]\nDone.') == [{"a": 1}]

    def test_truncated_structures_are_closed(self):
        assert parse_json('{"a": {"b": [1, 2') == {"a": {"b": [1, 2]}}
        assert parse_json('[{"name": "A"}, {"name": "B"') == [{"name": "A"}, {"name": "B"}]
        assert parse_json('[{"name": "A"') == [{"name": "A"}]

    def test_a_truncated_array_stays_a_list(self):
        # The first element is complete, the second is cut mid-string. Lifting
        # the first object out and returning a dict for a list is what made
        # the vendor analysis fail on a cut-off batch.
        text = '[{"name":"A","category":"X"},{"name":"B","cat'
        assert parse_json(text) == [{"name": "A", "category": "X"}]

    def test_a_truncated_object_stays_an_object(self):
        assert parse_json('{"summary": "s", "items": [{"a": 1}, {"b": 2') == {
            "summary": "s",
            "items": [{"a": 1}, {"b": 2}],
        }

    def test_salvage_recovers_objects_from_a_broken_array(self):
        assert parse_json('[{"a":1},{"b":2,}]') == [{"a": 1}, {"b": 2}]
        assert parse_json('{"a": 1} and then {"b": 2}') == [{"a": 1}, {"b": 2}]

    def test_nothing_to_parse_raises(self):
        with pytest.raises(ValueError, match="Could not parse AI response"):
            parse_json("no json here at all")


class TestRepairTruncatedJson:
    def test_no_bracket_is_none(self):
        assert repair_truncated_json("plain text") is None

    def test_closes_open_brackets_in_order(self):
        assert repair_truncated_json("[1, 2,") == "[1, 2]"
        assert repair_truncated_json('{"a": [1, {"b": 2') == '{"a": [1, {"b": 2}]}'

    def test_escaped_quotes_do_not_open_a_string(self):
        assert repair_truncated_json('{"a": "x\\"y", "b": [1') == '{"a": "x\\"y", "b": [1]}'

    def test_leading_prose_is_dropped_and_trailing_separators_stripped(self):
        assert repair_truncated_json('Here: {"a": 1,') == '{"a": 1}'
        assert repair_truncated_json('{"a":') == '{"a"}'

    def test_an_odd_quote_count_cuts_the_open_string(self):
        assert repair_truncated_json('{"a": "b') == '{"a": "}'


class TestSalvageObjects:
    def test_extracts_each_top_level_object(self):
        text = 'x {"a":1} y {"b":[1,2],} {broken'
        assert _salvage_objects(text) == [{"a": 1}, {"b": [1, 2]}]

    def test_nested_objects_count_once(self):
        assert _salvage_objects('{"a":{"b":1}}') == [{"a": {"b": 1}}]

    def test_nothing(self):
        assert _salvage_objects("nope") == []


class TestPrinciplesBlocks:
    PRINCIPLES = [
        {
            "title": "Cloud first",
            "description": "Prefer SaaS",
            "rationale": "",
            "implications": "No new DCs",
        },
        {"title": "API first", "description": "", "rationale": "Reuse", "implications": ""},
    ]

    def test_empty_is_empty(self):
        assert format_principles_block([]) == ""
        assert format_principles_block_advisory([]) == ""

    def test_mandatory_block(self):
        block = format_principles_block(self.PRINCIPLES)
        assert "=== ORGANISATION EA PRINCIPLES ===" in block
        assert "Principle 1: Cloud first" in block and "  Description: Prefer SaaS" in block
        assert "  Implications: No new DCs" in block and "  Rationale: Reuse" in block
        assert "Principle 2: API first" in block
        assert "  Rationale: " not in block.split("Principle 2")[0]  # empty fields are omitted

    def test_advisory_block_uses_softer_language(self):
        block = format_principles_block_advisory(self.PRINCIPLES)
        assert "(advisory)" in block and "should NOT narrow your detection scope" in block
        assert "Principle 1: Cloud first" in block


class TestIsAiConfigured:
    @pytest.mark.parametrize(
        "config,expected",
        [
            ({"provider": "claude", "api_key": "k"}, True),
            ({"provider": "openai", "api_key": "k"}, True),
            ({"provider": "deepseek", "api_key": "k"}, True),
            ({"provider": "gemini", "api_key": "k"}, True),
            ({"provider": "openai", "api_key": ""}, False),
            ({"provider": "azure", "api_key": "k", "provider_url": "https://a"}, True),
            ({"provider": "azure", "api_key": "k"}, False),
            ({"provider": "ollama", "provider_url": "http://o"}, True),
            ({"provider": "ollama", "model": "llama3"}, True),
            ({"provider": "ollama"}, False),
            ({"provider": "bedrock", "provider_url": "eu-west-1", "model": "m"}, True),
            ({"provider": "bedrock", "model": "m"}, False),
            ({"provider": "weird", "api_key": "k"}, False),
            ({}, False),
        ],
    )
    def test_matrix(self, config, expected):
        assert is_ai_configured(config) is expected
