"""``document_event_scope``: which document events a reader may see."""

from __future__ import annotations

import pytest

from app.models.event import Event
from app.services import document_event_scope as des
from tests.conftest import create_role, create_user


def test_the_families():
    assert des.DOCUMENT_EVENT_FAMILIES == (("adr.", "adr.view"), ("soaw.", "soaw.view"))


@pytest.mark.parametrize(
    "adr_view, soaw_view, hidden",
    [
        (True, True, []),
        (True, False, ["soaw."]),
        (False, True, ["adr."]),
        (False, False, ["adr.", "soaw."]),
    ],
)
def test_hidden_prefixes(adr_view, soaw_view, hidden):
    granted = {"adr.view": adr_view, "soaw.view": soaw_view}
    assert des.hidden_document_prefixes(granted) == hidden


def test_filters_are_one_negated_prefix_match_per_hidden_family():
    assert des.document_event_filters({"adr.view": True, "soaw.view": True}) == ()
    (only,) = des.document_event_filters({"adr.view": True, "soaw.view": False})
    assert only.compare(~Event.event_type.startswith("soaw.", autoescape=True))
    first, second = des.document_event_filters({"adr.view": False, "soaw.view": False})
    assert first.compare(~Event.event_type.startswith("adr.", autoescape=True))
    assert second.compare(~Event.event_type.startswith("soaw.", autoescape=True))
    assert not first.compare(~Event.event_type.startswith("soaw.", autoescape=True))


def test_the_prefix_is_matched_literally():
    """``autoescape``: the prefix is matched as text, never as a LIKE pattern."""
    (clause,) = des.document_event_filters({"adr.view": False, "soaw.view": True})
    sql = str(clause.compile(compile_kwargs={"literal_binds": True}))
    assert sql == "events.event_type NOT LIKE 'adr.' || '%' ESCAPE '/'"


@pytest.mark.parametrize(
    "permissions, hidden",
    [
        ({"*": True}, []),
        ({"adr.view": True, "soaw.view": True}, []),
        ({"adr.view": True}, ["soaw."]),
        ({"soaw.view": True, "adr.view": False}, ["adr."]),
        ({}, ["adr.", "soaw."]),
    ],
)
async def test_read_filters_follow_the_role(db, permissions, hidden):
    await create_role(db, key="reader", label="Reader", permissions=permissions)
    user = await create_user(db, role="reader")
    got = await des.document_event_read_filters(db, user)
    expected = des.document_event_filters(
        {"adr.view": "adr." not in hidden, "soaw.view": "soaw." not in hidden}
    )
    assert len(got) == len(hidden)
    assert all(a.compare(b) for a, b in zip(got, expected, strict=True))
