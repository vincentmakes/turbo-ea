"""Provider inheritance and scoped direct-child selection for PML."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.schemas.ppm_fields import PmlSectionConfig
from app.services.ppm_providers import (
    load_provider_choices,
    resolve_effective_provider,
    validate_budget_provider_change,
    validate_provider_child,
)
from tests.conftest import (
    create_budget_line,
    create_card,
    create_card_type,
    create_cost_line,
    create_role,
    create_user,
)


@pytest.fixture
async def provider_env(db):
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, role="admin")
    await create_card_type(db, key="Initiative", label="Initiative")
    provider_type = await create_card_type(db, key="Provider", label="Provider", has_hierarchy=True)
    initiative = await create_card(db, card_type="Initiative", name="Program")
    parent = await create_card(db, card_type="Provider", name="Aruba Software")
    child = await create_card(db, card_type="Provider", name="Licensing", parent_id=parent.id)
    other = await create_card(db, card_type="Provider", name="Other")
    budget = await create_budget_line(db, initiative_id=initiative.id, amount=100)
    budget.field_values = {"origine_costi": str(parent.id)}
    cost = await create_cost_line(db, initiative_id=initiative.id, actual=100)
    cost.budget_line_id = budget.id
    config = PmlSectionConfig.model_validate(
        {"provider_source": {"budget_field_key": "origine_costi", "allow_child_selection": True}}
    )
    await db.flush()
    return user, initiative, parent, child, other, budget, cost, config, provider_type


async def test_cost_inherits_budget_and_can_use_direct_child(db, provider_env):
    user, _, parent, child, _, budget, cost, config, _ = provider_env
    assert resolve_effective_provider(budget, cost, config) == parent.id
    selected = await validate_provider_child(db, user, budget, child.id, config)
    assert selected.id == child.id
    cost.provider_child_id = child.id
    assert resolve_effective_provider(budget, cost, config) == child.id
    cost.provider_child_id = None
    assert resolve_effective_provider(budget, cost, config) == parent.id


async def test_wrong_parent_or_archived_child_rejected(db, provider_env):
    user, _, _, child, other, budget, _, config, _ = provider_env
    with pytest.raises(HTTPException) as exc:
        await validate_provider_child(db, user, budget, other.id, config)
    assert exc.value.status_code == 404
    child.status = "ARCHIVED"
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await validate_provider_child(db, user, budget, child.id, config)
    assert exc.value.status_code == 404


async def test_disabled_hierarchy_preserves_saved_child_and_blocks_new_selections(db, provider_env):
    user, initiative, _, child, _, budget, cost, config, provider_type = provider_env
    cost.provider_child_id = child.id
    provider_type.has_hierarchy = False
    await db.flush()
    assert resolve_effective_provider(budget, cost, config) == child.id
    with pytest.raises(HTTPException):
        await validate_provider_child(db, user, budget, child.id, config)
    page = await load_provider_choices(
        db, user, initiative.id, budget.id, config, search="", page=1, page_size=20
    )
    assert page == {"items": [], "total": 0}


async def test_hidden_parent_never_exposes_child_or_count(db, provider_env, monkeypatch):
    from app.services import ppm_providers

    user, initiative, parent, _, _, budget, _, config, _ = provider_env
    normal = ppm_providers.is_card_readable

    async def hidden_parent(session, actor, card_id, **kwargs):
        if card_id == parent.id:
            return False
        return await normal(session, actor, card_id, **kwargs)

    monkeypatch.setattr(ppm_providers, "is_card_readable", hidden_parent)
    page = await load_provider_choices(
        db, user, initiative.id, budget.id, config, search="", page=1, page_size=20
    )
    assert page == {"items": [], "total": 0}


async def test_children_are_filtered_before_search_paging_and_count(db, provider_env):
    user, initiative, parent, child, _, budget, _, config, _ = provider_env
    await create_card(
        db, card_type="Provider", name="Archived", parent_id=parent.id, status="ARCHIVED"
    )
    await create_card(db, card_type="Provider", name="Child of child", parent_id=child.id)
    page = await load_provider_choices(
        db, user, initiative.id, budget.id, config, search="lic", page=1, page_size=10
    )
    assert page["total"] == 1
    assert [item["id"] for item in page["items"]] == [str(child.id)]
    assert page["items"][0]["parent_id"] == str(parent.id)


async def test_budget_change_rejects_invalid_explicit_child(db, provider_env):
    user, _, _, child, other, budget, cost, config, _ = provider_env
    cost.provider_child_id = child.id
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await validate_budget_provider_change(db, user, budget, other.id, config)
    assert exc.value.status_code == 409


async def test_stored_deleted_or_reparented_child_identity_is_preserved(db, provider_env):
    _, _, _, child, other, budget, cost, config, _ = provider_env
    cost.provider_child_id = child.id
    child.parent_id = other.id
    await db.flush()
    assert resolve_effective_provider(budget, cost, config) == child.id
    missing_id = uuid4()
    cost.provider_child_id = missing_id
    assert resolve_effective_provider(budget, cost, config) == missing_id


async def test_budget_conflict_does_not_disclose_cost_ids_without_cost_access(
    db, provider_env, monkeypatch
):
    from app.services.permission_service import PermissionService

    user, _, _, child, other, budget, cost, config, _ = provider_env
    cost.provider_child_id = child.id
    await db.flush()

    async def deny_costs(*args, **kwargs):
        return False

    monkeypatch.setattr(PermissionService, "can_view_costs", deny_costs)
    with pytest.raises(HTTPException) as exc:
        await validate_budget_provider_change(db, user, budget, other.id, config)
    assert exc.value.status_code == 409
    assert str(cost.id) not in str(exc.value.detail)
    assert "cost_ids" not in exc.value.detail


async def test_clearing_parent_rejects_deleted_child(db, provider_env):
    user, _, _, _, _, budget, cost, config, _ = provider_env
    cost.provider_child_id = uuid4()
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await validate_budget_provider_change(db, user, budget, None, config)
    assert exc.value.status_code == 409


async def test_disabled_provider_source_omits_child_until_reenabled(db, provider_env):
    from app.services.ppm_providers import project_providers

    user, _, _, child, _, budget, cost, config, _ = provider_env
    cost.provider_child_id = child.id
    await db.flush()
    disabled = PmlSectionConfig()
    projected = (await project_providers(db, user, disabled, [budget], [cost]))[cost.id]
    assert projected["provider"] is None
    assert projected["provider_child_id"] is None
    assert projected["effective_provider_context"] is None
    assert projected["budget_provider_context"] is None
    assert cost.provider_child_id == child.id
    projected = (await project_providers(db, user, config, [budget], [cost]))[cost.id]
    assert projected["provider"]["id"] == str(child.id)
    assert projected["effective_provider_context"] == str(child.id)
