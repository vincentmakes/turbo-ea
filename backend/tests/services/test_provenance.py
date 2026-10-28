"""Record provenance (``created_via`` / ``updated_via``) — no database needed.

The columns are stamped by Python-side ``default`` / ``onupdate`` callables
reading the request contextvars, so what they hold is decided entirely by
``current_origin()`` and by which models carry the mixin.
"""

from __future__ import annotations

import importlib.util
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import String, inspect
from sqlalchemy.orm.attributes import set_committed_value

import app.models  # noqa: F401 — configure every mapper
from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.comment import Comment
from app.models.diagram import Diagram
from app.models.process_flow_version import ProcessFlowVersion
from app.models.provenance import ORIGIN_VALUES, ProvenanceMixin, current_origin
from app.models.risk import Risk
from app.models.soaw import SoAW
from app.services.derived_writes import pin_updated_at
from app.services.event_bus import request_endpoint, request_origin

PROVENANCE_MODELS = (
    Card,
    Diagram,
    Risk,
    ArchitectureDecision,
    SoAW,
    Comment,
    ProcessFlowVersion,
)


@contextmanager
def _request(origin: str | None, endpoint: str | None):
    origin_token = request_origin.set(origin)
    endpoint_token = request_endpoint.set(endpoint)
    try:
        yield
    finally:
        request_origin.reset(origin_token)
        request_endpoint.reset(endpoint_token)


# ---------------------------------------------------------------------------
# current_origin
# ---------------------------------------------------------------------------


def test_an_mcp_request_is_mcp():
    with _request("mcp", "POST /api/v1/cards"):
        assert current_origin() == "mcp"


def test_a_web_request_is_web():
    with _request("web", "PATCH /api/v1/cards/x"):
        assert current_origin() == "web"


def test_an_extension_bridge_is_ext_even_outside_a_request():
    # Extension bridges set ``request_origin="ext"`` themselves, sometimes from
    # a background task with no endpoint.
    with _request("ext", None):
        assert current_origin() == "ext"


def test_a_request_without_the_origin_header_is_api():
    with _request(None, "POST /api/v1/cards"):
        assert current_origin() == "api"


def test_work_outside_any_request_is_system():
    with _request(None, None):
        assert current_origin() == "system"


def test_the_value_set_matches_the_list_filter():
    # ``GET /cards?created_via=`` validates against this exact set.
    assert ORIGIN_VALUES == ("web", "mcp", "api", "ext", "system")


# ---------------------------------------------------------------------------
# The mixin and the models that carry it
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("model", PROVENANCE_MODELS, ids=lambda m: m.__name__)
def test_every_mcp_creatable_model_carries_both_columns(model):
    assert issubclass(model, ProvenanceMixin)
    table = model.__table__
    for name in ("created_via", "updated_via"):
        column = table.c[name]
        assert isinstance(column.type, String)
        assert column.type.length == 20
        assert column.nullable is True
        assert column.server_default is None
        # SQLAlchemy wraps a zero-arg callable; ``__wrapped__`` is ours.
        assert column.default.arg.__wrapped__ is current_origin, name


@pytest.mark.parametrize("model", PROVENANCE_MODELS, ids=lambda m: m.__name__)
def test_only_updated_via_is_restamped_on_update(model):
    table = model.__table__
    assert table.c["created_via"].onupdate is None
    onupdate = table.c["updated_via"].onupdate
    assert onupdate is not None
    assert onupdate.arg.__wrapped__ is current_origin


def test_the_default_is_evaluated_per_write():
    # SQLAlchemy wraps a zero-arg callable; calling it must read the live
    # contextvars rather than a value frozen at import time.
    column = Card.__table__.c["created_via"]
    with _request("mcp", "POST /api/v1/cards"):
        assert column.default.arg(None) == "mcp"
    with _request(None, None):
        assert column.default.arg(None) == "system"


def test_the_migration_covers_exactly_the_mixin_tables():
    path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "157_record_provenance.py"
    spec = importlib.util.spec_from_file_location("migration_157", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.revision == "157"
    assert module.down_revision == "156"
    assert set(module.TABLES) == {m.__tablename__ for m in PROVENANCE_MODELS}
    assert len(module.TABLES) == len(PROVENANCE_MODELS)
    assert module.COLUMNS == ("created_via", "updated_via")


# ---------------------------------------------------------------------------
# derived_writes.pin_updated_at pins the channel too
# ---------------------------------------------------------------------------


def _loaded_card(**committed) -> Card:
    card = Card()
    for key, value in committed.items():
        set_committed_value(card, key, value)
    return card


def test_pin_forces_both_columns_into_the_update():
    card = _loaded_card(updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc), updated_via="mcp")
    assert inspect(card).modified is False
    pin_updated_at(card)
    assert set(inspect(card).committed_state) == {"updated_at", "updated_via"}
    assert card.updated_via == "mcp"


def test_pin_skips_a_column_that_is_not_loaded():
    card = _loaded_card(updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    pin_updated_at(card)
    assert set(inspect(card).committed_state) == {"updated_at"}


def test_pin_a_card_with_neither_column_loaded_is_a_no_op():
    card = _loaded_card(name="x")
    pin_updated_at(card)
    assert set(inspect(card).committed_state) == set()
