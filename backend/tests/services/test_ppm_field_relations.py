"""Automatic card relations for PML configurable fields."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.relation import Relation
from app.schemas.ppm_fields import PmlSectionConfig
from app.services.ppm_field_relations import (
    apply_configured_card_relations,
    prepare_configured_card_relations,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture
async def relation_env(db):
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(db, key="Organization", label="Organization")
    await create_card_type(db, key="Application", label="Application")
    await create_relation_type(
        db,
        key="org_supports_initiative",
        label="Supports",
        source_type_key="Organization",
        target_type_key="Initiative",
    )
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, role="admin")
    initiative = await create_card(db, card_type="Initiative")
    organization = await create_card(db, card_type="Organization")
    config = PmlSectionConfig.model_validate(
        {
            "fields": [
                {
                    "key": "organization",
                    "label": "Organization",
                    "kind": "card_reference",
                    "card_type": "Organization",
                    "relation_type": "org_supports_initiative",
                }
            ]
        }
    )
    return user, initiative, organization, config


async def test_automatic_relation_is_oriented_and_event_fanout_is_deferred(
    db, relation_env, monkeypatch
):
    from app.services.card_write_service import event_bus

    user, initiative, organization, config = relation_env
    messages = []
    delivered = []
    monkeypatch.setattr(event_bus, "fanout", delivered.append)
    candidates = await prepare_configured_card_relations(
        db, user, initiative, config, {}, {"organization": str(organization.id)}
    )
    await apply_configured_card_relations(db, user, candidates, messages)
    relation = await db.scalar(select(Relation).where(Relation.type == "org_supports_initiative"))
    assert relation.source_id == organization.id
    assert relation.target_id == initiative.id
    assert len(messages) == 2
    assert delivered == []


async def test_existing_relation_is_reused_without_modifying_its_details(db, relation_env):
    user, initiative, organization, config = relation_env
    existing = await create_relation(
        db,
        type_key="org_supports_initiative",
        source_id=organization.id,
        target_id=initiative.id,
        description="Keep me",
        attributes={"note": "unchanged"},
    )
    existing.description = "Keep me"
    await db.flush()
    candidates = await prepare_configured_card_relations(
        db, user, initiative, config, {}, {"organization": str(organization.id)}
    )
    messages = []
    await apply_configured_card_relations(db, user, candidates, messages)
    rows = (
        await db.scalars(select(Relation).where(Relation.type == "org_supports_initiative"))
    ).all()
    assert len(rows) == 1
    assert rows[0].id == existing.id
    assert rows[0].description == "Keep me"
    assert rows[0].attributes == {"note": "unchanged"}
    assert messages == []


async def test_wrong_type_rejected_and_no_relation_written(db, relation_env):
    user, initiative, _, config = relation_env
    wrong = await create_card(db, card_type="Application")
    with pytest.raises(HTTPException):
        await prepare_configured_card_relations(
            db, user, initiative, config, {}, {"organization": str(wrong.id)}
        )
    assert (await db.scalars(select(Relation))).all() == []


async def test_no_relation_for_unchanged_value_or_unconfigured_relation(db, relation_env):
    user, initiative, organization, config = relation_env
    value = {"organization": str(organization.id)}
    unchanged = await prepare_configured_card_relations(db, user, initiative, config, value, value)
    await apply_configured_card_relations(db, user, unchanged, [])
    config.fields[0].relation_type = None
    no_relation = await prepare_configured_card_relations(db, user, initiative, config, {}, value)
    await apply_configured_card_relations(db, user, no_relation, [])
    assert (await db.scalars(select(Relation))).all() == []


async def test_missing_relation_requires_permission_before_creation(db, relation_env, monkeypatch):
    from app.services.permission_service import PermissionService

    user, initiative, organization, config = relation_env

    async def deny(db, user, permission, *args, **kwargs):
        assert permission == "relations.manage"
        raise HTTPException(403, "Insufficient permissions")

    monkeypatch.setattr(PermissionService, "require_permission", deny)
    candidates = await prepare_configured_card_relations(
        db, user, initiative, config, {}, {"organization": str(organization.id)}
    )
    with pytest.raises(HTTPException) as exc:
        await apply_configured_card_relations(db, user, candidates, [])
    assert exc.value.status_code == 403
    assert (await db.scalars(select(Relation))).all() == []


async def test_existing_relation_reuse_needs_no_new_relation_permission(
    db, relation_env, monkeypatch
):
    from app.services.permission_service import PermissionService

    user, initiative, organization, config = relation_env
    existing = await create_relation(
        db,
        type_key="org_supports_initiative",
        source_id=organization.id,
        target_id=initiative.id,
        description="Preserve existing",
    )

    async def deny(db, user, permission, *args, **kwargs):
        raise AssertionError("Existing relation should be reused")

    existing.description = "Preserve existing"
    await db.flush()
    monkeypatch.setattr(PermissionService, "require_permission", deny)
    candidates = await prepare_configured_card_relations(
        db, user, initiative, config, {}, {"organization": str(organization.id)}
    )
    await apply_configured_card_relations(db, user, candidates, [])
    assert existing.description == "Preserve existing"


async def test_unreadable_card_is_not_exposed(db, relation_env, monkeypatch):
    from app.services import ppm_field_relations

    user, initiative, organization, config = relation_env

    async def deny(*args, **kwargs):
        return False

    monkeypatch.setattr(ppm_field_relations, "is_card_readable", deny)
    with pytest.raises(HTTPException) as exc:
        await prepare_configured_card_relations(
            db, user, initiative, config, {}, {"organization": str(organization.id)}
        )
    assert exc.value.status_code == 404
    assert str(organization.id) not in str(exc.value.detail)


async def test_normal_relation_edit_and_pml_reuse_serialize_on_endpoints(test_engine):
    import asyncio
    from uuid import uuid4

    from sqlalchemy import delete, event
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.relation_type import RelationType
    from app.models.role import Role
    from app.models.user import User
    from app.services.card_write_service import WriteActor, upsert_relation

    suffix = uuid4().hex[:10]
    source_type = f"Org{suffix}"
    initiative_type = "Initiative"
    relation_key = f"rel_{suffix}"
    role_key = f"role_{suffix}"
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        from tests.conftest import (
            create_card,
            create_card_type,
            create_relation,
            create_relation_type,
            create_role,
            create_user,
        )

        exists = await setup.scalar(select(CardType).where(CardType.key == initiative_type))
        created_initiative_type = exists is None
        if created_initiative_type:
            await create_card_type(setup, key=initiative_type, label="Initiative")
        await create_card_type(setup, key=source_type, label="Organization")
        await create_relation_type(
            setup,
            key=relation_key,
            source_type_key=source_type,
            target_type_key=initiative_type,
        )
        await create_role(setup, key=role_key, permissions={"*": True})
        user = await create_user(setup, role=role_key)
        initiative = await create_card(setup, card_type=initiative_type)
        organization = await create_card(setup, card_type=source_type)
        await create_relation(
            setup, type_key=relation_key, source_id=organization.id, target_id=initiative.id
        )
        user_id, initiative_id, organization_id = user.id, initiative.id, organization.id
        await setup.commit()

    config = PmlSectionConfig.model_validate(
        {
            "fields": [
                {
                    "key": "organization",
                    "label": "Organization",
                    "kind": "card_reference",
                    "card_type": source_type,
                    "relation_type": relation_key,
                }
            ]
        }
    )
    attempting_lock = asyncio.Event()
    pml_task = None

    def observe_lock(conn, cursor, statement, parameters, context, executemany):
        task = asyncio.current_task()
        if task is not None and task.get_name() == "pml-relation" and "FOR UPDATE" in statement:
            attempting_lock.set()

    event.listen(test_engine.sync_engine, "before_cursor_execute", observe_lock)
    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as normal:
            normal_user = await normal.get(User, user_id)
            await upsert_relation(
                normal,
                WriteActor.from_user(normal_user),
                type_key=relation_key,
                source_id=organization_id,
                target_id=initiative_id,
                description="Updated concurrently",
                attributes={"classification": "critical"},
            )

            async def write_pml():
                async with AsyncSession(test_engine, expire_on_commit=False) as pml:
                    pml_user = await pml.get(User, user_id)
                    pml_initiative = await pml.get(Card, initiative_id)
                    candidates = await prepare_configured_card_relations(
                        pml,
                        pml_user,
                        pml_initiative,
                        config,
                        {},
                        {"organization": str(organization_id)},
                    )
                    messages = []
                    await apply_configured_card_relations(pml, pml_user, candidates, messages)
                    await pml.commit()
                    return messages

            pml_task = asyncio.create_task(write_pml(), name="pml-relation")
            await asyncio.wait_for(attempting_lock.wait(), timeout=10)
            assert not pml_task.done()
            await normal.commit()
            assert await asyncio.wait_for(pml_task, timeout=10) == []

        async with AsyncSession(test_engine) as check:
            rows = (
                await check.scalars(select(Relation).where(Relation.type == relation_key))
            ).all()
            assert len(rows) == 1
            assert rows[0].description == "Updated concurrently"
            assert rows[0].attributes == {"classification": "critical"}
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", observe_lock)
        if pml_task is not None and not pml_task.done():
            pml_task.cancel()
            await asyncio.gather(pml_task, return_exceptions=True)
        async with AsyncSession(test_engine) as cleanup:
            await cleanup.execute(delete(Card).where(Card.id.in_([initiative_id, organization_id])))
            await cleanup.execute(delete(RelationType).where(RelationType.key == relation_key))
            await cleanup.execute(delete(CardType).where(CardType.key == source_type))
            if created_initiative_type:
                await cleanup.execute(delete(CardType).where(CardType.key == initiative_type))
            await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.execute(delete(Role).where(Role.key == role_key))
            await cleanup.commit()


async def test_archived_card_cannot_create_a_new_automatic_relation(db, relation_env):
    user, initiative, organization, config = relation_env
    organization.status = "ARCHIVED"
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await prepare_configured_card_relations(
            db, user, initiative, config, {}, {"organization": str(organization.id)}
        )
    assert exc.value.status_code == 404
    assert (await db.scalars(select(Relation))).all() == []
