"""The formula engine's answers, compared whole.

What an admin sees from the engine is a response body (``validate_formula``),
an error sentence (``describe_error``), a cycle (``detect_cycles``) or a value
written into a card (``execute_calculation``). Each test here states the full
expected answer, so a change to any key, branch or default is noticed.
"""

from __future__ import annotations

import operator
import uuid

import pytest
from simpleeval import FunctionNotDefined, NameNotDefined

from app.models.calculation import Calculation
from app.services.calculation_engine import (
    MAX_FORMULA_LENGTH,
    _null_safe_binary,
    _null_safe_unary,
    _zero_like,
    base_context_roots,
    card_data,
    describe_error,
    detect_cycles,
    execute_calculation,
    validate_formula,
)
from tests.conftest import create_card, create_card_type

SCHEMA = [
    {
        "section": "Main",
        "fields": [
            {"key": "num", "label": "Num", "type": "number"},
            {"key": "cost", "label": "Cost", "type": "cost"},
            {"key": "txt", "label": "Text", "type": "text"},
            {"key": "untyped", "label": "Untyped"},
            {"key": "flag", "label": "Flag", "type": "boolean"},
            {"key": "pct", "label": "Pct", "type": "percentage"},
            {
                "key": "tier",
                "label": "Tier",
                "type": "single_select",
                "options": [{"key": "gold"}, {"key": "silver"}],
            },
            {
                "key": "tags",
                "label": "Tags",
                "type": "multiple_select",
                "options": [{"key": "a"}],
            },
            {"key": "bare", "label": "Bare", "type": "single_select", "options": []},
        ],
    },
    {"section": "Empty"},
]

LINT_FORMULA = 'SUM(PLUCK(relations.relInitiativeToApp, "CAPEX"))'


@pytest.fixture
async def app_type(db):
    return await create_card_type(db, key="Application", label="Application", fields_schema=SCHEMA)


async def preview(db, formula):
    result = await validate_formula(formula, "Application", db)
    assert result["valid"] is True, result
    assert set(result) == {"valid", "error", "preview_result", "warnings"}
    assert result["error"] is None
    return result["preview_result"]


class TestValidateFormulaDummyCard:
    @pytest.mark.parametrize(
        "formula, expected",
        [
            ("data.num", 1),
            ("data.cost", 1),
            ("data.txt", 1),
            ("data.untyped", 1),
            ("data.flag", False),
            ("data.pct", 50),
            ("data.tier", "gold"),
            ("data.tags", "a"),
            ("data.bare", None),
            ("data.name", "Test"),
            ("data.description", ""),
            ("data.status", "ACTIVE"),
            ("data.approval_status", "DRAFT"),
            ("data.subtype", None),
            ("data.reference", "TEST-1"),
            ("parent.name", "Parent"),
            ("parent.type", "Application"),
            ("parent.subtype", None),
            ("parent.id", "00000000-0000-0000-0000-000000000000"),
            ("parent.attributes.cost", 1),
            ("parent.attributes.name", "Test"),
            ("hierarchy_level", 2),
            ("children_count", 0),
        ],
    )
    async def test_preview(self, db, app_type, formula, expected):
        assert await preview(db, formula) == expected

    async def test_lint_warnings_ride_along_with_a_valid_answer(self, db, app_type):
        result = await validate_formula(LINT_FORMULA, "Application", db)
        assert result["valid"] is True
        assert result["preview_result"] == 0
        assert len(result["warnings"]) == 1


class TestValidateFormulaRefusals:
    async def test_too_long(self, db, app_type):
        formula = LINT_FORMULA + " " * (MAX_FORMULA_LENGTH - len(LINT_FORMULA) + 1)
        result = await validate_formula(formula, "Application", db)
        assert result == {
            "valid": False,
            "error": "Formula exceeds maximum length of 5000 characters",
            "warnings": list(result["warnings"]),
        }
        assert len(result["warnings"]) == 1

    async def test_exactly_the_maximum_length_is_accepted(self, db, app_type):
        formula = "1" + " " * (MAX_FORMULA_LENGTH - 1)
        assert len(formula) == MAX_FORMULA_LENGTH
        assert (await validate_formula(formula, "Application", db))["valid"] is True

    async def test_unknown_type(self, db):
        result = await validate_formula(LINT_FORMULA, "Nope", db)
        assert result["valid"] is False
        assert result["error"] == "Card type 'Nope' not found"
        assert len(result["warnings"]) == 1

    async def test_one_unknown_field_with_a_hint(self, db, app_type):
        result = await validate_formula("data.Cost + 1", "Application", db)
        assert result == {
            "valid": False,
            "error": (
                "Formula reads 'Cost' (did you mean 'cost'?), which does not exist on "
                "Application. Fields are referenced by key, not by the label shown on the card."
            ),
            "warnings": [],
        }

    async def test_two_unknown_fields(self, db, app_type):
        result = await validate_formula("data.zzzqqq + data.yyyxxx", "Application", db)
        assert result["error"] == (
            "Formula reads 'yyyxxx', 'zzzqqq', which do not exist on Application. "
            "Fields are referenced by key, not by the label shown on the card."
        )

    async def test_a_target_of_another_calculation_counts_as_known(self, db, app_type):
        db.add(
            Calculation(
                name="c",
                formula="1",
                target_type_key="Application",
                target_field_key="derivedScore",
            )
        )
        await db.flush()
        assert await preview(db, "data.derivedScore") is None

    async def test_an_evaluation_error(self, db, app_type):
        result = await validate_formula("data.num / 0", "Application", db)
        assert result == {"valid": False, "error": "Division by zero", "warnings": []}

    async def test_an_empty_formula(self, db, app_type):
        result = await validate_formula("   ", "Application", db)
        assert result == {"valid": False, "error": "Formula is empty", "warnings": []}


class TestDescribeError:
    def test_a_bare_field_name_points_at_the_data_prefix(self):
        context = base_context_roots(data={"licenseCost": 1})
        message = describe_error(NameNotDefined("licenseCost", "x"), "licenseCost", context)
        assert message == "Unknown name 'licenseCost' — card fields are read as 'data.licenseCost'"

    def test_an_unknown_name(self):
        context = base_context_roots(data={"other": 1})
        message = describe_error(NameNotDefined("relatons", "x"), "relatons.x", context)
        assert message == "Unknown name 'relatons' in formula"

    def test_a_name_error_without_a_name_falls_back_to_its_text(self):
        exc = NameNotDefined("x", "x")
        exc.name = ""
        assert describe_error(exc, "x", None) == str(exc)

    def test_the_parent_guard(self):
        exc = TypeError("'NoneType' object has no attribute 'attributes'")
        assert describe_error(exc, "parent.attributes.x", None) == (
            "The formula reads an attribute of something empty — most often 'parent' on a "
            "root card. Guard it with IF(parent, …)."
        )

    def test_one_empty_field(self):
        exc = TypeError("unsupported operand type(s) for +: 'NoneType' and 'int'")
        context = base_context_roots(data={"a": None, "b": 2})
        assert describe_error(exc, "data.a + data.b", context) == (
            "Field(s) 'a' are empty on this card and the formula does arithmetic on them. "
            "Wrap them in COALESCE(field, 0), or switch on 'Treat blank numbers as zero'."
        )

    def test_no_named_field(self):
        exc = TypeError("unsupported operand type(s) for +: 'NoneType' and 'int'")
        assert describe_error(exc, "x + 1", None) == (
            "An empty value is used and the formula does arithmetic on them. "
            "Wrap them in COALESCE(field, 0), or switch on 'Treat blank numbers as zero'."
        )

    def test_five_empty_fields_are_all_named(self):
        exc = TypeError("'NoneType'")
        context = base_context_roots(data={f"f{i}": None for i in range(5)})
        formula = " + ".join(f"data.f{i}" for i in range(5))
        message = describe_error(exc, formula, context)
        assert message.startswith("Field(s) 'f0', 'f1', 'f2', 'f3', 'f4' are empty")

    def test_six_empty_fields_name_five_and_count_the_rest(self):
        exc = TypeError("'NoneType'")
        context = base_context_roots(data={f"f{i}": None for i in range(6)})
        formula = " + ".join(f"data.f{i}" for i in range(6))
        message = describe_error(exc, formula, context)
        assert message.startswith("Field(s) 'f0', 'f1', 'f2', 'f3', 'f4' and 1 more are empty")

    def test_a_type_error_not_about_none_is_generic(self):
        exc = TypeError("unsupported operand type(s) for +: 'int' and 'str'")
        assert describe_error(exc, "1 + 'a'", None) == "Evaluation error (TypeError)"

    def test_none_in_a_message_that_is_not_a_type_error_is_generic(self):
        exc = RuntimeError("NoneType somewhere")
        assert describe_error(exc, "x", None) == "Evaluation error (RuntimeError)"

    def test_simpleeval_messages_pass_through(self):
        exc = FunctionNotDefined("SUMM", "SUMM(1)")
        assert describe_error(exc, "SUMM(1)", None) == str(exc)

    def test_empty_formula(self):
        assert describe_error(ValueError("Empty formula"), "", None) == "Formula is empty"

    def test_another_value_error_is_generic(self):
        assert describe_error(ValueError("nope"), "", None) == "Evaluation error (ValueError)"


class TestNullSafeOperators:
    @pytest.mark.parametrize(
        "other, zero", [("x", ""), ([1], []), ((1,), ()), (5, 0), (2.5, 0), (None, 0)]
    )
    def test_zero_like(self, other, zero):
        assert _zero_like(other) == zero
        assert type(_zero_like(other)) is type(zero)

    @pytest.mark.parametrize(
        "a, b, expected",
        [
            (None, 5, -5),
            (5, None, 5),
            (None, None, 0),
            (7, 2, 5),
        ],
    )
    def test_binary_sub_keeps_operand_order(self, a, b, expected):
        assert _null_safe_binary(operator.sub)(a, b) == expected

    def test_binary_add_over_strings_and_lists(self):
        add = _null_safe_binary(operator.add)
        assert add(None, "x") == "x"
        assert add("x", None) == "x"
        assert add(None, [1]) == [1]

    def test_unary(self):
        neg = _null_safe_unary(operator.neg)
        assert neg(None) == 0
        assert neg(3) == -3
        assert _null_safe_unary(lambda v: v + 10)(None) == 10


class TestCardData:
    async def test_built_ins_and_attributes(self, db, app_type):
        card = await create_card(
            db,
            card_type="Application",
            name="CRM",
            description="desc",
            attributes={"cost": 5, "name": "shadowed"},
            lifecycle={"active": "2026-01-01"},
        )
        data = card_data(card)
        assert data["description"] == "desc"
        assert data["cost"] == 5
        # Attributes are spread last, so a same-named attribute wins.
        assert data["name"] == "shadowed"
        assert data.lifecycle.active == "2026-01-01"
        assert data.missing is None
        for key in ("status", "approval_status", "subtype", "reference"):
            assert data[key] == getattr(card, key)


class TestExecuteCalculation:
    async def _calc(self, formula, target="score", blanks_as_zero=False):
        return Calculation(
            id=uuid.uuid4(),
            name="c",
            formula=formula,
            target_type_key="Application",
            target_field_key=target,
            blanks_as_zero=blanks_as_zero,
        )

    async def test_writes_the_result_and_keeps_other_attributes(self, db, app_type):
        card = await create_card(db, card_type="Application", attributes={"num": 4, "keep": 1})
        ok, error = await execute_calculation(db, await self._calc("data.num * 2"), card)
        assert (ok, error) == (True, None)
        assert card.attributes == {"num": 4, "keep": 1, "score": 8}

    async def test_a_none_result_removes_the_key(self, db, app_type):
        card = await create_card(db, card_type="Application", attributes={"score": 3, "k": 1})
        ok, _ = await execute_calculation(db, await self._calc("IF(1 == 2, 1, None)"), card)
        assert ok is True
        assert card.attributes == {"k": 1}

    async def test_blanks_as_zero(self, db, app_type):
        card = await create_card(db, card_type="Application", attributes={})
        calc = await self._calc("data.num + 1", blanks_as_zero=True)
        assert await execute_calculation(db, calc, card) == (True, None)
        assert card.attributes == {"score": 1}

    async def test_a_failure_names_the_empty_field(self, db, app_type):
        card = await create_card(db, card_type="Application", attributes={"cost": 2})
        ok, error = await execute_calculation(db, await self._calc("data.num + data.cost"), card)
        assert ok is False
        assert error.startswith("Field(s) 'num' are empty on this card")
        assert "score" not in card.attributes


class TestDetectCycles:
    async def _active(self, db, target, formula, type_key="Application", active=True):
        calc = Calculation(
            id=uuid.uuid4(),
            name=target,
            formula=formula,
            target_type_key=type_key,
            target_field_key=target,
            is_active=active,
        )
        db.add(calc)
        await db.flush()
        return calc

    def _new(self, target, formula, calc_id=None):
        return Calculation(
            id=calc_id or uuid.uuid4(),
            name=target,
            formula=formula,
            target_type_key="Application",
            target_field_key=target,
        )

    async def test_a_two_step_cycle(self, db):
        await self._active(db, "b", "data.a + 1")
        assert await detect_cycles(db, self._new("a", "data.b * 2")) == ["b", "a"]

    async def test_a_self_reference(self, db):
        assert await detect_cycles(db, self._new("a", "data.a + 1")) == ["a", "a"]

    async def test_a_three_step_cycle(self, db):
        await self._active(db, "b", "data.c")
        await self._active(db, "c", "data.a")
        assert await detect_cycles(db, self._new("a", "data.b")) == ["b", "a"]

    async def test_a_chain_without_a_cycle(self, db):
        await self._active(db, "b", "data.c + data.plain")
        await self._active(db, "c", "data.plain")
        assert await detect_cycles(db, self._new("a", "data.b")) is None

    async def test_an_inactive_calculation_does_not_count(self, db):
        await self._active(db, "b", "data.a", active=False)
        assert await detect_cycles(db, self._new("a", "data.b")) is None

    async def test_another_types_calculation_does_not_count(self, db):
        await self._active(db, "b", "data.a", type_key="Other")
        assert await detect_cycles(db, self._new("a", "data.b")) is None

    async def test_the_edit_replaces_its_stored_version(self, db):
        stored = await self._active(db, "a", "data.b")
        await self._active(db, "b", "data.plain")
        # The stored "a" reads "b"; the edited one no longer does.
        assert await detect_cycles(db, self._new("a", "1", calc_id=stored.id)) is None
        # And an edit that introduces a cycle is still caught.
        assert await detect_cycles(db, self._new("b", "data.a", calc_id=None)) is not None


class TestSharedContext:
    """Every root a formula can read about a card's surroundings, compared whole."""

    async def _landscape(self, db):
        from tests.conftest import create_relation, create_relation_type

        for key in ("Application", "Interface", "Provider"):
            await create_card_type(db, key=key, label=key)
        await create_relation_type(
            db, key="relAppToInterface", source_type_key="Application", target_type_key="Interface"
        )
        await create_relation_type(
            db, key="relProviderToApp", source_type_key="Provider", target_type_key="Application"
        )
        await create_relation_type(
            db,
            key="relAppHidden",
            source_type_key="Application",
            target_type_key="Interface",
            is_hidden=True,
        )
        await create_relation_type(
            db,
            key="relInterfaceToProvider",
            source_type_key="Interface",
            target_type_key="Provider",
        )
        parent = await create_card(db, card_type="Application", name="Parent", attributes={"p": 1})
        card = await create_card(db, card_type="Application", name="Card", parent_id=parent.id)
        child = await create_card(
            db,
            card_type="Application",
            name="Child",
            parent_id=card.id,
            subtype="microservice",
            attributes={"c": 2},
        )
        await create_card(
            db, card_type="Application", name="Gone", parent_id=card.id, status="ARCHIVED"
        )
        iface = await create_card(db, card_type="Interface", name="API", attributes={"i": 3})
        archived = await create_card(db, card_type="Interface", name="Old", status="ARCHIVED")
        provider = await create_card(db, card_type="Provider", name="Vendor")
        await create_relation(
            db,
            type_key="relAppToInterface",
            source_id=card.id,
            target_id=iface.id,
            attributes={"flowDirection": "forward"},
        )
        await create_relation(
            db, type_key="relAppToInterface", source_id=card.id, target_id=archived.id
        )
        await create_relation(
            db, type_key="relProviderToApp", source_id=provider.id, target_id=card.id
        )
        await create_relation(db, type_key="relAppHidden", source_id=card.id, target_id=iface.id)
        return parent, card, child, iface, provider

    async def test_the_whole_shared_context(self, db):
        from app.services.calculation_engine import build_shared_context
        from app.services.calculation_ppm import empty_ppm

        parent, card, child, iface, provider = await self._landscape(db)
        shared = await build_shared_context(db, card)
        assert shared["relations"] == {
            "relAppToInterface": [
                {
                    "id": str(iface.id),
                    "name": "API",
                    "type": "Interface",
                    "attributes": {"i": 3},
                    "rel_attributes": {"flowDirection": "forward"},
                }
            ],
            "relProviderToApp": [
                {
                    "id": str(provider.id),
                    "name": "Vendor",
                    "type": "Provider",
                    "attributes": {},
                    "rel_attributes": {},
                }
            ],
        }
        assert shared["relation_count"] == {"relAppToInterface": 1, "relProviderToApp": 1}
        assert shared["children"] == [
            {
                "id": str(child.id),
                "name": "Child",
                "type": "Application",
                "subtype": "microservice",
                "attributes": {"c": 2},
            }
        ]
        assert shared["children_count"] == 1
        assert shared["parent"] == {
            "id": str(parent.id),
            "name": "Parent",
            "type": "Application",
            "subtype": None,
            "attributes": {"p": 1},
        }
        assert shared["hierarchy_level"] == 2
        assert shared["ppm"] == empty_ppm()
        assert (shared["None"], shared["True"], shared["False"]) == (None, True, False)
        # Attribute access works on every wrapper a formula walks through.
        assert shared["relations"].relAppToInterface[0].attributes.i == 3
        assert shared["parent"].attributes.p == 1

    async def test_a_relation_type_with_no_rows_is_an_empty_group(self, db):
        from app.services.calculation_engine import build_shared_context

        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="Interface", label="Interface")
        from tests.conftest import create_relation_type

        await create_relation_type(
            db, key="relAppToInterface", source_type_key="Application", target_type_key="Interface"
        )
        card = await create_card(db, card_type="Application", name="Lonely")
        shared = await build_shared_context(db, card)
        assert shared["relations"] == {"relAppToInterface": []}
        assert shared["relation_count"] == {"relAppToInterface": 0}
        assert (shared["children"], shared["children_count"], shared["parent"]) == ([], 0, None)
        assert shared["hierarchy_level"] == 1

    async def test_an_archived_parent_reads_as_none(self, db):
        from app.services.calculation_engine import build_shared_context

        await create_card_type(db, key="Application", label="Application")
        parent = await create_card(db, card_type="Application", name="P", status="ARCHIVED")
        card = await create_card(db, card_type="Application", name="C", parent_id=parent.id)
        assert (await build_shared_context(db, card))["parent"] is None


class TestRunCalculationsForType:
    async def test_the_grouped_report(self, db):
        from sqlalchemy import select

        from app.services.calculation_engine import MAX_SAMPLE_CARDS, run_calculations_for_type

        await create_card_type(db, key="Application", label="Application")
        await create_card_type(db, key="Other", label="Other")
        ok_calc = Calculation(
            name="Ok",
            formula="1",
            target_type_key="Application",
            target_field_key="one",
            is_active=True,
            execution_order=0,
        )
        mixed = Calculation(
            name="Mixed",
            formula="1 / data.div",
            target_type_key="Application",
            target_field_key="ratio",
            is_active=True,
            execution_order=1,
        )
        db.add_all([ok_calc, mixed])
        await db.flush()
        zero = [
            await create_card(db, card_type="Application", name=f"Z{i}", attributes={"div": 0})
            for i in range(MAX_SAMPLE_CARDS + 1)
        ]
        bad = await create_card(db, card_type="Application", name="Bad", attributes={"div": "x"})
        good = await create_card(db, card_type="Application", name="Good", attributes={"div": 2})
        await create_card(db, card_type="Application", name="Arch", status="ARCHIVED")
        await create_card(db, card_type="Other", name="Elsewhere")
        await db.commit()

        report = await run_calculations_for_type(db, "Application")
        processed = MAX_SAMPLE_CARDS + 3
        assert report["cards_processed"] == processed
        assert report["calculations_succeeded"] == processed + 1
        assert report["calculations_failed"] == MAX_SAMPLE_CARDS + 2
        first, second = report["calculations"]
        assert first == {
            "calculation_id": str(ok_calc.id),
            "name": "Ok",
            "target_field": "one",
            "succeeded": processed,
            "failed": 0,
            "failures": [],
        }
        assert (second["name"], second["target_field"]) == ("Mixed", "ratio")
        assert (second["succeeded"], second["failed"]) == (1, MAX_SAMPLE_CARDS + 2)
        by_error = {g["error"]: g for g in second["failures"]}
        division = by_error["Division by zero"]
        assert division["count"] == MAX_SAMPLE_CARDS + 1
        assert division["cards_truncated"] is True
        assert len(division["cards"]) == MAX_SAMPLE_CARDS
        assert {c["id"] for c in division["cards"]} <= {str(c.id) for c in zero}
        other = by_error.pop(next(e for e in by_error if e != "Division by zero"))
        assert (other["count"], other["cards_truncated"]) == (1, False)
        assert other["cards"] == [{"id": str(bad.id), "name": "Bad"}]

        stored = {
            c.name: c.last_error for c in (await db.execute(select(Calculation))).scalars().all()
        }
        assert stored == {"Ok": None, "Mixed": "Division by zero"}
        await db.refresh(good)
        assert good.attributes["ratio"] == 0.5
