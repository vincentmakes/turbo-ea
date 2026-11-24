"""Lock PML Provider references even when no relation is created."""

from __future__ import annotations

import asyncio
from uuid import uuid4

from sqlalchemy import delete, event, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.role import Role
from app.models.user import User
from app.schemas.ppm_fields import PmlSectionConfig
from app.services.ppm_field_relations import prepare_configured_card_relations
from tests.conftest import create_card, create_card_type, create_role, create_user


async def test_provider_extra_locks_block_concurrent_reparent(test_engine):
    suffix = uuid4().hex[:10]
    role_key = f"lock_{suffix}"
    provider_type = f"Provider{suffix}"
    async with AsyncSession(test_engine, expire_on_commit=False) as setup:
        initiative_type = await setup.scalar(select(CardType).where(CardType.key == "Initiative"))
        created_type = initiative_type is None
        if created_type:
            await create_card_type(setup, key="Initiative", label="Initiative")
        await create_card_type(setup, key=provider_type, label="Provider")
        await create_role(setup, key=role_key, permissions={"*": True})
        user = await create_user(setup, role=role_key)
        initiative = await create_card(setup, card_type="Initiative")
        provider = await create_card(setup, card_type=provider_type)
        initiative_id, provider_id, user_id = initiative.id, provider.id, user.id
        await setup.commit()

    trying_update = asyncio.Event()
    pending = None

    def observe_update(conn, cursor, statement, parameters, context, executemany):
        task = asyncio.current_task()
        if (
            task
            and task.get_name() == "provider-reparent"
            and statement.lstrip().startswith("UPDATE cards")
        ):
            trying_update.set()

    event.listen(test_engine.sync_engine, "before_cursor_execute", observe_update)
    try:
        async with AsyncSession(test_engine, expire_on_commit=False) as pml:
            actor = await pml.get(User, user_id)
            card = await pml.get(Card, initiative_id)
            candidates = await prepare_configured_card_relations(
                pml,
                actor,
                card,
                PmlSectionConfig(),
                {},
                {},
                extra_lock_card_ids=[provider_id, uuid4()],
            )
            assert candidates == []

            async def reparent():
                async with AsyncSession(test_engine) as writer:
                    await writer.execute(
                        update(Card).where(Card.id == provider_id).values(name="Changed")
                    )
                    await writer.commit()

            pending = asyncio.create_task(reparent(), name="provider-reparent")
            await asyncio.wait_for(trying_update.wait(), timeout=10)
            assert not pending.done()
            await pml.commit()
            await asyncio.wait_for(pending, timeout=10)
        async with AsyncSession(test_engine) as check:
            assert (await check.get(Card, provider_id)).name == "Changed"
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", observe_update)
        if pending is not None and not pending.done():
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
        async with AsyncSession(test_engine) as cleanup:
            await cleanup.execute(delete(Card).where(Card.id.in_([initiative_id, provider_id])))
            await cleanup.execute(delete(CardType).where(CardType.key == provider_type))
            if created_type:
                await cleanup.execute(delete(CardType).where(CardType.key == "Initiative"))
            await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.execute(delete(Role).where(Role.key == role_key))
            await cleanup.commit()
