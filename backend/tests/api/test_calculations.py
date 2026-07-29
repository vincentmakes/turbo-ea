"""Integration tests for the /calculations endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def calc_env(db):
    """Prerequisite data shared by all calculation tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(
        db,
        key="member",
        label="Member",
        permissions=MEMBER_PERMISSIONS,
    )
    await create_role(
        db,
        key="viewer",
        label="Viewer",
        permissions=VIEWER_PERMISSIONS,
    )
    await create_card_type(
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
                ],
            }
        ],
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    return {"admin": admin, "member": member, "viewer": viewer}


# -------------------------------------------------------------------
# POST /calculations  (create)
# -------------------------------------------------------------------


class TestCreateCalculation:
    async def test_admin_can_create(self, client, db, calc_env):
        admin = calc_env["admin"]
        resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Total Cost",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "42",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Total Cost"
        assert data["target_type_key"] == "Application"
        assert data["is_active"] is False

    async def test_member_cannot_create(self, client, db, calc_env):
        member = calc_env["member"]
        resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Blocked",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1+1",
            },
            headers=auth_headers(member),
        )
        assert resp.status_code == 403

    async def test_viewer_cannot_create(self, client, db, calc_env):
        viewer = calc_env["viewer"]
        resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Blocked",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1+1",
            },
            headers=auth_headers(viewer),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# GET /calculations  (list)
# -------------------------------------------------------------------


class TestListCalculations:
    async def test_list_returns_calculations(self, client, db, calc_env):
        admin = calc_env["admin"]
        # Create two calculations
        await client.post(
            "/api/v1/calculations",
            json={
                "name": "Calc A",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1",
            },
            headers=auth_headers(admin),
        )
        await client.post(
            "/api/v1/calculations",
            json={
                "name": "Calc B",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "2",
            },
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/calculations",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        names = [c["name"] for c in resp.json()]
        assert "Calc A" in names
        assert "Calc B" in names

    async def test_filter_by_type_key(self, client, db, calc_env):
        admin = calc_env["admin"]
        await client.post(
            "/api/v1/calculations",
            json={
                "name": "App Calc",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "1",
            },
            headers=auth_headers(admin),
        )

        resp = await client.get(
            "/api/v1/calculations?type_key=Application",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

        resp2 = await client.get(
            "/api/v1/calculations?type_key=NonExistent",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert len(resp2.json()) == 0


# -------------------------------------------------------------------
# DELETE /calculations/{id}
# -------------------------------------------------------------------


class TestDeleteCalculation:
    async def test_admin_can_delete(self, client, db, calc_env):
        admin = calc_env["admin"]
        create_resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Delete Me",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "0",
            },
            headers=auth_headers(admin),
        )
        calc_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/calculations/{calc_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 204

    async def test_delete_nonexistent_returns_404(self, client, db, calc_env):
        admin = calc_env["admin"]
        fake_id = str(uuid.uuid4())
        resp = await client.delete(
            f"/api/v1/calculations/{fake_id}",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 404

    async def test_member_cannot_delete(self, client, db, calc_env):
        admin = calc_env["admin"]
        member = calc_env["member"]
        create_resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Protected",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "0",
            },
            headers=auth_headers(admin),
        )
        calc_id = create_resp.json()["id"]

        resp = await client.delete(
            f"/api/v1/calculations/{calc_id}",
            headers=auth_headers(member),
        )
        assert resp.status_code == 403


# -------------------------------------------------------------------
# POST /calculations/validate
# -------------------------------------------------------------------


class TestValidateFormula:
    async def test_validate_simple_formula(self, client, db, calc_env):
        admin = calc_env["admin"]
        resp = await client.post(
            "/api/v1/calculations/validate",
            json={
                "formula": "1 + 1",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True

    async def test_validate_invalid_formula(self, client, db, calc_env):
        admin = calc_env["admin"]
        resp = await client.post(
            "/api/v1/calculations/validate",
            json={
                "formula": "import os",
                "target_type_key": "Application",
            },
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False


# -------------------------------------------------------------------
# POST /calculations/{id}/activate + deactivate
# -------------------------------------------------------------------


class TestActivateDeactivate:
    async def test_activate_and_deactivate(self, client, db, calc_env):
        admin = calc_env["admin"]
        create_resp = await client.post(
            "/api/v1/calculations",
            json={
                "name": "Toggle Me",
                "target_type_key": "Application",
                "target_field_key": "costTotalAnnual",
                "formula": "42",
            },
            headers=auth_headers(admin),
        )
        calc_id = create_resp.json()["id"]
        assert create_resp.json()["is_active"] is False

        # Activate
        resp = await client.post(
            f"/api/v1/calculations/{calc_id}/activate",
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is True

        # Deactivate
        resp2 = await client.post(
            f"/api/v1/calculations/{calc_id}/deactivate",
            headers=auth_headers(admin),
        )
        assert resp2.status_code == 200
        assert resp2.json()["is_active"] is False


# -------------------------------------------------------------------
# Save-time field validation, warnings and blanks-as-zero  (#886)
# -------------------------------------------------------------------


BASE = "/api/v1/calculations"


def _payload(**overrides):
    body = {
        "name": "Test calc",
        "target_type_key": "Application",
        "target_field_key": "costTotalAnnual",
        "formula": "data.costTotalAnnual * 2",
    }
    body.update(overrides)
    return body


class TestUnknownFieldValidation:
    async def test_unknown_key_is_rejected_and_named(self, client, db, calc_env):
        # The exact shape reported in #886: the field *label* used where the
        # *key* was needed. This used to save fine and fail on every card with
        # a bare "Evaluation error".
        resp = await client.post(
            BASE,
            json=_payload(formula="data.CostTotalAnnual * 2"),
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert "CostTotalAnnual" in detail
        assert "costTotalAnnual" in detail  # the suggestion

    async def test_known_key_is_accepted(self, client, db, calc_env):
        resp = await client.post(BASE, json=_payload(), headers=auth_headers(calc_env["admin"]))
        assert resp.status_code == 201
        assert resp.json()["warnings"] == []

    async def test_builtin_card_properties_are_accepted(self, client, db, calc_env):
        resp = await client.post(
            BASE,
            json=_payload(formula='IF(data.status == "ACTIVE", 1, 0)'),
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 201

    async def test_reference_is_accepted(self, client, db, calc_env):
        # `reference` is supplied by the real context but was missing from the
        # validator's dummy card, so it would have been rejected on day one.
        resp = await client.post(
            BASE,
            json=_payload(formula="CONCAT(data.reference, data.name)"),
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 201

    async def test_another_calculations_target_field_is_accepted(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        first = await client.post(
            BASE,
            json=_payload(name="Derived", target_field_key="derivedScore", formula="1"),
            headers=headers,
        )
        assert first.status_code == 201
        # Chaining one calculation onto another's output is the case
        # detect_cycles already assumes exists, so it must not be rejected.
        second = await client.post(
            BASE,
            json=_payload(name="Uses derived", formula="data.derivedScore + 1"),
            headers=headers,
        )
        assert second.status_code == 201

    async def test_renaming_a_grandfathered_calculation_still_works(self, client, db, calc_env):
        from app.models.calculation import Calculation

        # A row saved before this check existed, or whose field was later
        # removed from the metamodel. Editing anything other than the formula
        # must not be blocked.
        calc = Calculation(
            name="Legacy",
            target_type_key="Application",
            target_field_key="costTotalAnnual",
            formula="data.longGoneField + 1",
        )
        db.add(calc)
        await db.flush()

        resp = await client.patch(
            f"{BASE}/{calc.id}",
            json={"name": "Renamed"},
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 200

    async def test_changing_the_formula_to_an_unknown_key_is_rejected(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        created = await client.post(BASE, json=_payload(), headers=headers)
        calc_id = created.json()["id"]

        resp = await client.patch(
            f"{BASE}/{calc_id}", json={"formula": "data.nope + 1"}, headers=headers
        )
        assert resp.status_code == 400
        assert "nope" in resp.json()["detail"]


class TestFormulaWarnings:
    async def test_bare_pluck_key_warns_without_blocking(self, client, db, calc_env):
        # #886's second formula: no error is possible on this path, it just
        # sums to 0 forever. A warning is the only way the author can find out.
        resp = await client.post(
            BASE,
            json=_payload(formula='SUM(PLUCK(relations.relAppToITC, "costTotalAnnual"))'),
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 201
        warnings = resp.json()["warnings"]
        assert len(warnings) == 1
        assert "attributes.costTotalAnnual" in warnings[0]

    async def test_validate_endpoint_reports_warnings(self, client, db, calc_env):
        resp = await client.post(
            f"{BASE}/validate",
            json={
                "formula": 'SUM(PLUCK(children, "costTotalAnnual"))',
                "target_type_key": "Application",
            },
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is True
        assert len(body["warnings"]) == 1

    async def test_validate_reports_an_unknown_key(self, client, db, calc_env):
        resp = await client.post(
            f"{BASE}/validate",
            json={"formula": "data.nope + 1", "target_type_key": "Application"},
            headers=auth_headers(calc_env["admin"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert "nope" in body["error"]


class TestBlanksAsZero:
    async def test_defaults_to_off(self, client, db, calc_env):
        resp = await client.post(BASE, json=_payload(), headers=auth_headers(calc_env["admin"]))
        assert resp.json()["blanks_as_zero"] is False

    async def test_round_trips_through_create_and_patch(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        created = await client.post(BASE, json=_payload(blanks_as_zero=True), headers=headers)
        assert created.json()["blanks_as_zero"] is True

        calc_id = created.json()["id"]
        patched = await client.patch(
            f"{BASE}/{calc_id}", json={"blanks_as_zero": False}, headers=headers
        )
        assert patched.json()["blanks_as_zero"] is False


class TestCalculationReadPermissions:
    async def test_viewer_cannot_list_calculations(self, client, db, calc_env):
        # Formulas and their error text are admin-only configuration.
        resp = await client.get(BASE, headers=auth_headers(calc_env["viewer"]))
        assert resp.status_code == 403

    async def test_viewer_can_still_read_calculated_fields(self, client, db, calc_env):
        # Non-admin surfaces (the card detail "calc" badge, the type drawer)
        # depend on this one staying open.
        resp = await client.get(
            f"{BASE}/calculated-fields", headers=auth_headers(calc_env["viewer"])
        )
        assert resp.status_code == 200


# -------------------------------------------------------------------
# POST /calculations/recalculate/{type_key}
# -------------------------------------------------------------------


async def _activate(client, headers, **overrides):
    """Create and activate a calculation, returning its id.

    Writes to `doubledCost` rather than the field it reads — a calculation whose
    target is also its input is refused as a dependency cycle.
    """
    payload = _payload(target_field_key="doubledCost", **overrides)
    created = await client.post(BASE, json=payload, headers=headers)
    assert created.status_code == 201, created.text
    calc_id = created.json()["id"]
    activated = await client.post(f"{BASE}/{calc_id}/activate", headers=headers)
    assert activated.status_code == 200, activated.text
    return calc_id


class TestRecalculateReport:
    """A manual run has to say which cards failed and why.

    Discussion #886: the counts alone left an admin re-testing the formula
    against every card by hand to find the twenty-one that broke.
    """

    async def test_reports_per_calculation_and_names_the_failing_card(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        # `data.costTotalAnnual * 2` succeeds where the field is filled in and
        # raises on an empty one, which is exactly the reported situation.
        calc_id = await _activate(client, headers)
        await create_card(db, name="Filled", attributes={"costTotalAnnual": 10})
        await create_card(db, name="Empty", attributes={})

        resp = await client.post(f"{BASE}/recalculate/Application", headers=headers)
        assert resp.status_code == 200, resp.text
        report = resp.json()

        assert report["cards_processed"] == 2
        assert report["calculations_succeeded"] == 1
        assert report["calculations_failed"] == 1

        assert len(report["calculations"]) == 1
        entry = report["calculations"][0]
        assert entry["calculation_id"] == calc_id
        assert entry["target_field"] == "doubledCost"
        assert entry["succeeded"] == 1
        assert entry["failed"] == 1

        assert len(entry["failures"]) == 1
        group = entry["failures"][0]
        assert group["count"] == 1
        assert group["cards_truncated"] is False
        assert [c["name"] for c in group["cards"]] == ["Empty"]
        # The engine's diagnosis travels through, not a bare "failed".
        assert "costTotalAnnual" in group["error"]

    async def test_identical_errors_collapse_into_one_group(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        await _activate(client, headers)
        for i in range(3):
            await create_card(db, name=f"Empty {i}", attributes={})

        resp = await client.post(f"{BASE}/recalculate/Application", headers=headers)
        entry = resp.json()["calculations"][0]

        assert entry["failed"] == 3
        # One formula, one way of being wrong — one row to act on, not three.
        assert len(entry["failures"]) == 1
        assert entry["failures"][0]["count"] == 3
        assert len(entry["failures"][0]["cards"]) == 3

    async def test_card_samples_are_capped_and_flagged(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        await _activate(client, headers)
        for i in range(12):
            await create_card(db, name=f"Empty {i}", attributes={})

        resp = await client.post(f"{BASE}/recalculate/Application", headers=headers)
        group = resp.json()["calculations"][0]["failures"][0]

        assert group["count"] == 12
        assert len(group["cards"]) == 10
        # Never a silent truncation: the UI needs to be able to say "and 2 more".
        assert group["cards_truncated"] is True

    async def test_last_error_reflects_the_failures_not_the_last_card(self, client, db, calc_env):
        # `run_calculations_for_card` rewrites last_error per card, so a run
        # that failed on most cards used to end up green whenever the final
        # card happened to succeed.
        headers = auth_headers(calc_env["admin"])
        calc_id = await _activate(client, headers)
        for i in range(3):
            await create_card(db, name=f"Empty {i}", attributes={})
        await create_card(db, name="Filled", attributes={"costTotalAnnual": 10})

        await client.post(f"{BASE}/recalculate/Application", headers=headers)

        row = await client.get(f"{BASE}/{calc_id}", headers=headers)
        assert row.json()["last_error"]
        assert "costTotalAnnual" in row.json()["last_error"]

    async def test_clean_run_clears_last_error(self, client, db, calc_env):
        headers = auth_headers(calc_env["admin"])
        calc_id = await _activate(client, headers)
        empty = await create_card(db, name="Empty", attributes={})
        await client.post(f"{BASE}/recalculate/Application", headers=headers)
        assert (await client.get(f"{BASE}/{calc_id}", headers=headers)).json()["last_error"]

        # Remove the offending card and run again — the row must go back to OK.
        await db.delete(empty)
        await db.flush()
        await create_card(db, name="Filled", attributes={"costTotalAnnual": 10})

        resp = await client.post(f"{BASE}/recalculate/Application", headers=headers)
        assert resp.json()["calculations_failed"] == 0
        assert (await client.get(f"{BASE}/{calc_id}", headers=headers)).json()["last_error"] is None

    async def test_member_cannot_recalculate(self, client, db, calc_env):
        resp = await client.post(
            f"{BASE}/recalculate/Application", headers=auth_headers(calc_env["member"])
        )
        assert resp.status_code == 403
