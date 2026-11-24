"""The PPM portfolio must honor timeline visibility and cost permissions."""

from tests.api.test_ppm_reports import _configure_private_timeline
from tests.conftest import (
    auth_headers,
    create_budget_line,
    create_card,
    create_cost_line,
    create_role,
    create_user,
)

pytest_plugins = ("tests.api.test_ppm_reports",)


async def test_filter_data_respects_hidden_dates_and_legacy_keys(client, db, ppm_env):
    card_type = await _configure_private_timeline(db)
    card_type.subtypes = [
        {"key": "Program", "label": "Program", "hidden_fields": ["ActualEnd", "endDate"]}
    ]
    card = await create_card(
        db,
        card_type="Initiative",
        name="Program",
        subtype="Program",
        attributes={
            "startDate": "2026-01-01",
            "endDate": "2035-12-31",
            "actualStart": "2026-01-03",
            "ActualEnd": "2036-12-31",
            "actualEnd": "2037-12-31",
            "businessValue": "high",
        },
    )
    await db.flush()
    response = await client.get(
        "/api/v1/reports/ppm/filter-data", headers=auth_headers(ppm_env["admin"])
    )
    assert response.status_code == 200, response.text
    item = next(item for item in response.json()["items"] if item["id"] == str(card.id))
    assert item["attributes"]["startDate"] == "2026-01-01"
    assert item["attributes"]["actualStart"] == "2026-01-03"
    assert item["attributes"]["businessValue"] == "high"
    for key in ("endDate", "ActualEnd", "actualEnd"):
        assert key not in item["attributes"]


async def test_filter_data_excludes_denied_subtype_like_gantt(client, db, ppm_env):
    from app.services.permission_service import PermissionService

    card_type = await _configure_private_timeline(db)
    card_type.subtypes = [
        {"key": "Project", "label": "Project"},
        {"key": "Secret", "label": "Secret"},
    ]
    card_type.role_permissions = {
        "scope_reader": {"inventory.view": {"value": False, "subtypes": ["Secret"]}}
    }
    await create_role(
        db, key="scope_reader", permissions={"ppm.view": True, "inventory.view": True}
    )
    reader = await create_user(db, role="scope_reader", email="scope-reader@example.test")
    shown = await create_card(db, card_type="Initiative", name="Shown", subtype="Project")
    hidden = await create_card(db, card_type="Initiative", name="Hidden", subtype="Secret")
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    headers = auth_headers(reader)
    filters = await client.get("/api/v1/reports/ppm/filter-data", headers=headers)
    gantt = await client.get("/api/v1/reports/ppm/gantt", headers=headers)
    assert filters.status_code == gantt.status_code == 200
    filter_ids = {item["id"] for item in filters.json()["items"]}
    gantt_ids = {item["id"] for item in gantt.json()}
    assert filter_ids == gantt_ids == {str(shown.id)}
    assert str(hidden.id) not in filters.text


async def test_portfolio_denies_private_cost_amounts_and_rollup(client, db, ppm_env):
    await _configure_private_timeline(db)
    await create_role(db, key="no_cost", permissions={"ppm.view": True, "inventory.view": True})
    reader = await create_user(db, role="no_cost", email="no-cost@example.test")
    parent = await create_card(
        db,
        card_type="Initiative",
        name="Program",
        subtype="Program",
        attributes={"costBudget": 99991, "costActual": 99992},
    )
    child = await create_card(
        db,
        card_type="Initiative",
        name="Child",
        subtype="Project",
        parent_id=parent.id,
        attributes={"costBudget": 98761, "costActual": 98762},
    )
    await create_budget_line(db, initiative_id=child.id, amount=45321)
    await create_cost_line(db, initiative_id=child.id, actual=22345)
    headers = auth_headers(reader)
    dashboard = await client.get("/api/v1/reports/ppm/dashboard", headers=headers)
    gantt = await client.get("/api/v1/reports/ppm/gantt", headers=headers)
    assert dashboard.status_code == gantt.status_code == 200
    assert dashboard.json()["total_budget"] is None
    assert dashboard.json()["total_actual"] is None
    for secret in ("99991", "99992", "98761", "98762", "45321", "22345"):
        assert secret not in dashboard.text
        assert secret not in gantt.text
    admin_dashboard = await client.get(
        "/api/v1/reports/ppm/dashboard", headers=auth_headers(ppm_env["admin"])
    )
    assert admin_dashboard.json()["total_budget"] == 45321
    assert admin_dashboard.json()["total_actual"] == 22345


async def test_mixed_cost_access_keeps_allowed_rows_and_excludes_denied_rollup(client, db, ppm_env):
    from app.models.stakeholder import Stakeholder
    from tests.conftest import create_stakeholder_role_def

    await _configure_private_timeline(db)
    await create_role(
        db, key="mixed_cost_reader", permissions={"ppm.view": True, "inventory.view": True}
    )
    reader = await create_user(db, role="mixed_cost_reader", email="mixed-cost@example.test")
    await create_stakeholder_role_def(
        db, card_type_key="Initiative", key="cost_viewer", permissions={"card.view_costs": True}
    )
    parent = await create_card(
        db,
        card_type="Initiative",
        name="Parent",
        attributes={"costBudget": 45441.0, "costActual": 22395.0},
    )
    allowed = await create_card(
        db,
        card_type="Initiative",
        name="Allowed",
        parent_id=parent.id,
        attributes={"costBudget": 120.0, "costActual": 50.0},
    )
    denied = await create_card(
        db,
        card_type="Initiative",
        name="Denied",
        parent_id=parent.id,
        attributes={"costBudget": 98761, "costActual": 98762},
    )
    db.add_all(
        [
            Stakeholder(card_id=parent.id, user_id=reader.id, role="cost_viewer"),
            Stakeholder(card_id=allowed.id, user_id=reader.id, role="cost_viewer"),
        ]
    )
    await create_budget_line(db, initiative_id=allowed.id, amount=120)
    await create_cost_line(db, initiative_id=allowed.id, actual=50)
    await create_budget_line(db, initiative_id=denied.id, amount=45321)
    await create_cost_line(db, initiative_id=denied.id, actual=22345)
    headers = auth_headers(reader)
    response = await client.get("/api/v1/reports/ppm/gantt", headers=headers)
    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()}
    assert rows[str(allowed.id)]["cost_budget"] == 120
    assert rows[str(allowed.id)]["cost_actual"] == 50
    assert rows[str(parent.id)]["rollup"]["capex_planned"] == 120
    assert rows[str(parent.id)]["rollup"]["capex_actual"] == 50
    assert rows[str(denied.id)]["cost_budget"] is None
    rollup = await client.get(f"/api/v1/ppm/initiatives/{parent.id}/rollup", headers=headers)
    filters = await client.get("/api/v1/reports/ppm/filter-data", headers=headers)
    assert rollup.status_code == filters.status_code == 200
    parent_filters = next(row for row in filters.json()["items"] if row["id"] == str(parent.id))
    assert (
        rollup.json()["total_planned"],
        rollup.json()["total_actual"],
        parent_filters["attributes"]["costBudget"],
        parent_filters["attributes"]["costActual"],
    ) == (120, 50, 120, 50)
    assert rollup.json()["descendant_count"] == 2
    for secret in ("98761", "98762", "45321", "22345"):
        assert secret not in response.text
    dashboard = await client.get("/api/v1/reports/ppm/dashboard", headers=headers)
    assert dashboard.status_code == 200
    assert dashboard.json()["total_budget"] is None
    assert dashboard.json()["total_actual"] is None


async def test_layout_hidden_date_is_omitted_from_all_private_timeline_views(client, db, ppm_env):
    card_type = await _configure_private_timeline(db)
    card_type.section_config = {"custom:0": {"hidden_fields": ["ActualEnd"]}}
    initiative = await create_card(
        db,
        card_type="Initiative",
        name="Hidden end",
        attributes={
            "startDate": "2026-01-01",
            "actualStart": "2026-01-02",
            "ActualEnd": "2026-02-01",
        },
    )
    await db.flush()

    headers = auth_headers(ppm_env["admin"])
    schedule = await client.get(
        f"/api/v1/ppm/initiatives/{initiative.id}/schedule", headers=headers
    )
    gantt = await client.get("/api/v1/reports/ppm/gantt", headers=headers)
    filters = await client.get("/api/v1/reports/ppm/filter-data", headers=headers)
    assert schedule.status_code == gantt.status_code == filters.status_code == 200
    assert schedule.json()["actual_start_date"] == "2026-01-02"
    assert schedule.json().get("actual_end_date") is None
    assert schedule.json().get("actual_end_label") is None
    row = next(row for row in gantt.json() if row["id"] == str(initiative.id))
    assert row["actual_start_date"] == "2026-01-02"
    assert row.get("actual_end_date") is None
    attributes = next(
        row["attributes"] for row in filters.json()["items"] if row["id"] == str(initiative.id)
    )
    assert attributes["actualStart"] == "2026-01-02"
    assert "ActualEnd" not in attributes


async def test_null_fields_section_is_ignored_by_private_timeline_views(client, db, ppm_env):
    card_type = await _configure_private_timeline(db)
    card_type.fields_schema = [*card_type.fields_schema, {"section": "Empty", "fields": None}]
    initiative = await create_card(
        db,
        card_type="Initiative",
        name="Nullable schema",
        attributes={"startDate": "2026-01-01", "actualStart": "2026-01-02"},
    )
    await db.flush()

    headers = auth_headers(ppm_env["admin"])
    schedule = await client.get(
        f"/api/v1/ppm/initiatives/{initiative.id}/schedule", headers=headers
    )
    gantt = await client.get("/api/v1/reports/ppm/gantt", headers=headers)
    filters = await client.get("/api/v1/reports/ppm/filter-data", headers=headers)
    assert schedule.status_code == gantt.status_code == filters.status_code == 200
    assert schedule.json()["actual_start_date"] == "2026-01-02"
    row = next(row for row in gantt.json() if row["id"] == str(initiative.id))
    assert row["actual_start_date"] == "2026-01-02"


async def test_latest_reports_loads_only_one_report_per_initiative(db, ppm_env):
    from datetime import UTC, date, datetime

    from sqlalchemy import event

    from app.models.ppm_status_report import PpmStatusReport
    from app.services.ppm_portfolio_service import latest_reports
    from tests.conftest import create_status_report

    project = await create_card(db, card_type="Initiative", name="Report history")
    earlier = await create_status_report(db, initiative_id=project.id, report_date=date(2026, 1, 1))
    later = await create_status_report(db, initiative_id=project.id, report_date=date(2026, 1, 1))
    earlier.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    later.created_at = datetime(2026, 1, 2, tzinfo=UTC)
    await create_status_report(db, initiative_id=project.id, report_date=date(2025, 12, 31))
    await db.flush()
    project_id, expected = project.id, later.id
    db.expunge_all()
    loaded = []

    def record_report(_session, instance):
        if isinstance(instance, PpmStatusReport):
            loaded.append(instance.id)

    event.listen(db.sync_session, "loaded_as_persistent", record_report)
    try:
        reports = await latest_reports(db, [project_id])
    finally:
        event.remove(db.sync_session, "loaded_as_persistent", record_report)

    assert reports[project_id].id == expected
    assert loaded == [expected]


async def test_card_financial_comparison_excludes_denied_subtype(client, db, ppm_env):
    from app.services.permission_service import PermissionService

    card_type = await _configure_private_timeline(db)
    card_type.subtypes = [
        {"key": "Project", "label": "Project"},
        {"key": "Secret", "label": "Secret"},
    ]
    card_type.role_permissions = {
        "financial_reader": {"inventory.view": {"value": False, "subtypes": ["Secret"]}}
    }
    await create_role(
        db,
        key="financial_reader",
        permissions={"ppm.view": True, "inventory.view": True, "costs.view": True},
    )
    reader = await create_user(db, role="financial_reader", email="financial-reader@example.test")
    parent = await create_card(
        db,
        card_type="Initiative",
        name="Root",
        subtype="Project",
        attributes={"costBudget": 5070, "costActual": 4040},
    )
    allowed = await create_card(
        db, card_type="Initiative", name="Visible", subtype="Project", parent_id=parent.id
    )
    hidden = await create_card(
        db, card_type="Initiative", name="Hidden", subtype="Secret", parent_id=parent.id
    )
    await create_budget_line(db, initiative_id=allowed.id, amount=70)
    await create_cost_line(db, initiative_id=allowed.id, actual=40)
    await create_budget_line(db, initiative_id=hidden.id, amount=5000)
    await create_cost_line(db, initiative_id=hidden.id, actual=4000)
    PermissionService.invalidate_type_permission_cache()

    response = await client.get(
        f"/api/v1/ppm/initiatives/{parent.id}/financials", headers=auth_headers(reader)
    )
    assert response.status_code == 200, response.text
    summary = response.json()["card_comparison"]
    assert float(summary["budget"]["total"]) == 70
    assert float(summary["actual"]["total"]) == 40
    gantt = await client.get("/api/v1/reports/ppm/gantt", headers=auth_headers(reader))
    assert gantt.status_code == 200, gantt.text
    row = next(item for item in gantt.json() if item["id"] == str(parent.id))
    assert row["cost_budget"] == 70
    assert row["cost_actual"] == 40
