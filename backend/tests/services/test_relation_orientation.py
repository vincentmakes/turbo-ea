"""Every relation is stored in its relation type's direction (#1140).

The UI always sends a relation's ends the right way round, but the API accepted
card ids without checking them against the type, so rows stored the other way
round (an Interface as the source of an Application → Interface link) reached
the database. Card detail then listed them on neither card and an arrow drawn
from one showed a provider as a consumer. ``app/services/relation_orientation``
turns such a pair round on every write path; these tests pin the helper, the
survey path that looks rows up per side, and the source scan that stops a new
writer skipping it.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.v1.surveys import _apply_relation_change
from app.models.migration import IdentityMap, Migration, StagedRecord
from app.models.relation import Relation
from app.services.migration.apply import _apply_relation_pass
from app.services.relation_orientation import (
    direction_for,
    orient_endpoints,
    oriented,
    runs_against_type,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_user,
)

APP_TO_IF = SimpleNamespace(source_type_key="Application", target_type_key="Interface")
SELF_PAIR = SimpleNamespace(source_type_key="Organization", target_type_key="Organization")


class TestPureHelpers:
    def test_matching_pair_is_not_against_the_type(self):
        assert runs_against_type(APP_TO_IF, "Application", "Interface") is False

    def test_swapped_pair_runs_against_the_type(self):
        assert runs_against_type(APP_TO_IF, "Interface", "Application") is True

    def test_self_referencing_type_is_never_turned(self):
        assert runs_against_type(SELF_PAIR, "Organization", "Organization") is False

    def test_unknown_input_is_left_alone(self):
        assert runs_against_type(None, "Interface", "Application") is False
        assert runs_against_type(APP_TO_IF, None, "Application") is False
        assert runs_against_type(APP_TO_IF, "Interface", "") is False
        assert runs_against_type(APP_TO_IF, "ITComponent", "Application") is False

    def test_oriented_swaps_only_a_backwards_pair(self):
        a, b = uuid.uuid4(), uuid.uuid4()
        assert oriented(APP_TO_IF, a, b, "Application", "Interface") == (a, b)
        assert oriented(APP_TO_IF, a, b, "Interface", "Application") == (b, a)

    def test_direction_follows_the_type_not_the_request(self):
        assert direction_for(APP_TO_IF, "Interface", "outgoing") == "incoming"
        assert direction_for(APP_TO_IF, "Application", "incoming") == "outgoing"
        # A self-pair's direction is the caller's to say.
        assert direction_for(SELF_PAIR, "Organization", "incoming") == "incoming"
        assert direction_for(None, "Interface", "outgoing") == "outgoing"


@pytest.fixture
async def env(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Interface", label="Interface")
    rt = await create_relation_type(
        db,
        key="relAppToInterface",
        label="provides / consumes",
        source_type_key="Application",
        target_type_key="Interface",
    )
    app = await create_card(db, card_type="Application", name="Multicash")
    iface = await create_card(db, card_type="Interface", name="MultiCash | SAP")
    return SimpleNamespace(rt=rt, app=app, iface=iface)


class TestOrientEndpoints:
    async def test_swaps_a_backwards_pair(self, db, env):
        assert await orient_endpoints(db, env.rt, env.iface.id, env.app.id) == (
            env.app.id,
            env.iface.id,
        )

    async def test_resolves_the_type_by_key(self, db, env):
        assert await orient_endpoints(db, "relAppToInterface", env.iface.id, env.app.id) == (
            env.app.id,
            env.iface.id,
        )

    async def test_keeps_a_correct_pair(self, db, env):
        assert await orient_endpoints(db, env.rt, env.app.id, env.iface.id) == (
            env.app.id,
            env.iface.id,
        )

    async def test_leaves_unknown_types_and_missing_cards_alone(self, db, env):
        missing = uuid.uuid4()
        assert await orient_endpoints(db, "noSuchType", env.iface.id, env.app.id) == (
            env.iface.id,
            env.app.id,
        )
        assert await orient_endpoints(db, env.rt, env.iface.id, missing) == (
            env.iface.id,
            missing,
        )


class TestSurveyApply:
    """The survey apply path looks relations up per side before writing, so it
    takes the side from the relation type rather than the field's direction —
    a stale or hand-edited field can neither miss an existing link nor write a
    backwards one."""

    async def test_wrong_field_direction_still_writes_the_type_direction(self, db, env):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        user = await create_user(db, email="surveyor@test.com")
        changed = await _apply_relation_change(
            db,
            env.iface,
            {"relation_type_key": "relAppToInterface", "direction": "outgoing"},
            [{"id": str(env.app.id)}],
            user.id,
        )
        assert changed is True
        rels = (await db.execute(select(Relation))).scalars().all()
        assert [(r.source_id, r.target_id) for r in rels] == [(env.app.id, env.iface.id)]

        # Re-applying the same answer finds the link it wrote: nothing changes.
        again = await _apply_relation_change(
            db,
            env.iface,
            {"relation_type_key": "relAppToInterface", "direction": "outgoing"},
            [{"id": str(env.app.id)}],
            user.id,
        )
        assert again is False


class TestMigrationApply:
    """A source platform's from/to is its own convention; the relation pass
    stores the Turbo EA type's direction and reuses a row that turning lands on
    rather than inserting a duplicate."""

    async def _stage(self, db, env):
        migration = Migration(
            name="export.xlsx", source_type="leanix", file_hash="c" * 64, status="staged"
        )
        db.add(migration)
        await db.flush()
        for native, card in (("lx-app", env.app), ("lx-if", env.iface)):
            db.add(
                IdentityMap(
                    source_type="leanix", source_id=native, entity_kind="card", target_id=card.id
                )
            )
        db.add(
            StagedRecord(
                migration_id=migration.id,
                source_type="leanix",
                entity_kind="relation",
                source_id="lx-rel-1",
                card_type_key="relAppToInterface",
                action="create",
                source_data={
                    # The platform recorded this link Interface-first.
                    "from_entity_id": "lx-if",
                    "to_entity_id": "lx-app",
                    "tea_type": "relAppToInterface",
                    "attributes": {"note": "from lx"},
                },
            )
        )
        await db.flush()
        return migration

    async def test_creates_the_relation_in_the_type_direction(self, db, env):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        user = await create_user(db, email="migrator@test.com")
        migration = await self._stage(db, env)
        counts = await _apply_relation_pass(db, migration, user)
        assert counts["created"] == 1
        rels = (await db.execute(select(Relation))).scalars().all()
        assert [(r.source_id, r.target_id) for r in rels] == [(env.app.id, env.iface.id)]

    async def test_reuses_the_existing_relation_it_turns_onto(self, db, env):
        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        user = await create_user(db, email="migrator@test.com")
        existing = await create_relation(
            db,
            type_key="relAppToInterface",
            source_id=env.app.id,
            target_id=env.iface.id,
            attributes={"flowDirection": "forward"},
        )
        migration = await self._stage(db, env)
        counts = await _apply_relation_pass(db, migration, user)
        assert counts == {**counts, "created": 0, "updated": 1}
        rels = (await db.execute(select(Relation))).scalars().all()
        assert [r.id for r in rels] == [existing.id]
        assert rels[0].attributes == {"flowDirection": "forward", "note": "from lx"}


# ---------------------------------------------------------------------------
# Recurrence guard: no module constructs a Relation without orienting it.
# ---------------------------------------------------------------------------

_APP = Path(__file__).resolve().parents[2] / "app"
_CONSTRUCTOR = re.compile(r"\bRelation\(")

# Modules whose relations run in a direction fixed by the code itself — the
# relation type is chosen to match the ends, so there is nothing to turn.
_FIXED_DIRECTION = {
    "services/element_relation_sync.py": "a process always links out to its elements' cards",
    "services/process_catalogue_service.py": "catalogue imports link in the type's own direction",
    "services/value_stream_catalogue_service.py": "catalogue imports use the type's direction",
    "services/seed_demo.py": "demo data; test_seed_demo.py checks it against the metamodel",
    "services/seed_demo_bpm.py": "demo data; test_seed_demo.py checks it against the metamodel",
}
# Not the ORM model at all.
_NOT_THE_MODEL = {
    "models/relation.py": "the model's own class statement",
    "services/migration/sources/leanix/xlsx_parser.py": "the snapshot dataclass",
}


def _constructors() -> dict[str, str]:
    found = {}
    for path in _APP.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if _CONSTRUCTOR.search(text):
            found[path.relative_to(_APP).as_posix()] = text
    return found


def test_every_relation_writer_orients():
    unguarded = [
        rel
        for rel, text in _constructors().items()
        if rel not in _NOT_THE_MODEL
        and rel not in _FIXED_DIRECTION
        and "relation_orientation" not in text
    ]
    assert not unguarded, (
        "These modules construct a Relation without turning its ends into the "
        "relation type's direction — call app.services.relation_orientation "
        f"before inserting, or list the module here with the reason: {unguarded}"
    )


def test_allowlists_are_not_stale():
    found = _constructors()
    for rel in [*_FIXED_DIRECTION, *_NOT_THE_MODEL]:
        assert rel in found, f"{rel} no longer constructs a Relation; drop it from the list"
