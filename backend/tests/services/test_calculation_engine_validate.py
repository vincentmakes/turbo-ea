"""validate_formula dummy-data seeding (requires a database for the CardType).

The validator builds dummy card data from fields_schema and dry-runs the
formula. It must seed realistic NON-ZERO numeric input: the old seeds (0 for
number/cost, "" for everything else including ext.* custom types) failed
legitimate formulas — `3 * data.rating` over an ext.* field evaluated
3 * "" → "" and blew up on the next arithmetic op, and any ratio over numeric
fields hit 0/(0*0) → ZeroDivisionError.
"""

from __future__ import annotations

from app.services.calculation_engine import validate_formula
from tests.conftest import create_card_type

FIELDS_SCHEMA = [
    {
        "section": "Autonomy",
        "fields": [
            {"key": "a1", "label": "Rating", "type": "ext.digital-autonomy.rating"},
            {"key": "mit", "label": "Mitigation", "type": "number"},
            {"key": "risk", "label": "Risk", "type": "number"},
            {"key": "imp", "label": "Impact", "type": "cost"},
            {"key": "flag", "label": "Flag", "type": "boolean"},
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "options": [{"key": "gold", "label": "Gold"}],
            },
        ],
    }
]


class TestValidateFormulaDummySeeding:
    async def test_arithmetic_over_ext_custom_field_validates(self, db):
        await create_card_type(db, key="Application", fields_schema=FIELDS_SCHEMA)
        result = await validate_formula("(3 * data.a1) / 7", "Application", db)
        assert result["valid"] is True, result

    async def test_division_over_numeric_fields_validates(self, db):
        await create_card_type(db, key="Application", fields_schema=FIELDS_SCHEMA)
        result = await validate_formula("data.mit / (data.risk * data.imp)", "Application", db)
        assert result["valid"] is True, result

    async def test_boolean_and_select_seeds_unchanged(self, db):
        await create_card_type(db, key="Application", fields_schema=FIELDS_SCHEMA)
        # boolean stays False; single_select stays the first option key.
        result = await validate_formula(
            'IF(data.flag, 1, IF(data.tier == "gold", 2, 3))', "Application", db
        )
        assert result["valid"] is True, result

    async def test_parent_and_hierarchy_level_validate(self, db):
        await create_card_type(db, key="Application", fields_schema=FIELDS_SCHEMA)
        # The dummy context supplies a populated parent + hierarchy_level, so a
        # formula referencing parent attributes and the level validates cleanly.
        result = await validate_formula(
            "IF(parent, parent.attributes.mit, data.mit) + hierarchy_level",
            "Application",
            db,
        )
        assert result["valid"] is True, result
