"""Unit tests for the revision-chain reader (``app/services/revision_chain.py``).

Pure: no database. Every assertion names exact ids, roles and numbers, because
CI mutates these lines and a truthiness check kills nothing.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.revision_chain import (
    Chain,
    RevisionNode,
    build_chains,
    is_effective,
    is_locked,
    next_revision_number,
    revise_refusal,
)

TODAY = date(2026, 11, 10)
T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def node(
    nid: str,
    rev: int,
    status: str = "signed",
    parent: str | None = None,
    *,
    minutes: int = 0,
    group: str | None = None,
    eff: date | None = None,
) -> RevisionNode:
    return RevisionNode(
        id=nid,
        parent_id=parent,
        revision_number=rev,
        status=status,
        created_at=T0 + timedelta(minutes=minutes),
        group_key=group,
        effective_from=eff,
    )


def ids(chain: Chain) -> list[str]:
    return [n.id for n in chain.nodes]


def roles(chain: Chain) -> dict[str, str]:
    return {n.id: chain.role(n.id) for n in chain.nodes}


def only_chain(nodes: list[RevisionNode]) -> Chain:
    chains = build_chains(nodes, today=TODAY)
    distinct = {id(c) for c in chains.values()}
    assert len(distinct) == 1
    return chains[nodes[0].id]


# ---------------------------------------------------------------------------
# locked / effective
# ---------------------------------------------------------------------------


def test_only_signed_is_locked():
    assert is_locked(node("a", 1, "signed")) is True
    assert is_locked(node("a", 1, "draft")) is False
    assert is_locked(node("a", 1, "in_review")) is False


def test_effective_boundary_today_is_effective_tomorrow_is_not():
    assert is_effective(node("a", 1, eff=TODAY), TODAY) is True
    assert is_effective(node("a", 1, eff=TODAY - timedelta(days=1)), TODAY) is True
    assert is_effective(node("a", 1, eff=TODAY + timedelta(days=1)), TODAY) is False
    assert is_effective(node("a", 1, eff=None), TODAY) is True


def test_unlocked_is_never_effective():
    assert is_effective(node("a", 1, "draft", eff=None), TODAY) is False
    assert is_effective(node("a", 1, "in_review", eff=TODAY), TODAY) is False


# ---------------------------------------------------------------------------
# build_chains — shapes
# ---------------------------------------------------------------------------


def test_single_signed_node():
    a = node("a", 1)
    chains = build_chains([a], today=TODAY)
    assert list(chains) == ["a"]
    chain = chains["a"]
    assert chain.nodes == (a,)
    assert chain.current is a
    assert chain.open_revision is None
    assert chain.forked is False
    assert chain.role("a") == "current"
    assert next_revision_number(chain) == 2


def test_single_draft_node_is_current_and_not_open_revision():
    a = node("a", 1, "draft")
    chain = build_chains([a], today=TODAY)["a"]
    assert chain.current is a
    assert chain.open_revision is None
    assert chain.role("a") == "current"


def test_empty_input_gives_no_chains():
    assert build_chains([], today=TODAY) == {}


def test_linear_chain_of_signed_revisions():
    a = node("a", 1)
    b = node("b", 2, parent="a", minutes=1)
    c = node("c", 3, parent="b", minutes=2)
    chains = build_chains([c, a, b], today=TODAY)
    assert set(chains) == {"a", "b", "c"}
    assert chains["a"] is chains["b"] is chains["c"]
    chain = chains["a"]
    assert ids(chain) == ["a", "b", "c"]
    assert chain.current is c
    assert chain.open_revision is None
    assert chain.forked is False
    assert roles(chain) == {"a": "earlier", "b": "earlier", "c": "current"}
    assert next_revision_number(chain) == 4


def test_newest_signed_effective_in_future_leaves_older_current():
    a = node("a", 1, eff=date(2026, 1, 1))
    b = node("b", 2, parent="a", minutes=1, eff=TODAY + timedelta(days=1))
    chain = only_chain([a, b])
    assert chain.current is a
    assert roles(chain) == {"a": "current", "b": "upcoming"}
    # b is locked, so it is not the open revision.
    assert chain.open_revision is None


def test_newest_signed_effective_today_is_current():
    a = node("a", 1, eff=date(2026, 1, 1))
    b = node("b", 2, parent="a", minutes=1, eff=TODAY)
    chain = only_chain([a, b])
    assert chain.current is b
    assert roles(chain) == {"a": "earlier", "b": "current"}


def test_no_effective_node_current_is_first_locked():
    a = node("a", 1, eff=TODAY + timedelta(days=5))
    b = node("b", 2, parent="a", minutes=1, eff=TODAY + timedelta(days=9))
    c = node("c", 3, "draft", parent="b", minutes=2)
    chain = only_chain([a, b, c])
    assert chain.current is a
    assert roles(chain) == {"a": "current", "b": "upcoming", "c": "upcoming"}
    assert chain.open_revision is c


def test_no_effective_node_with_draft_before_first_locked():
    d = node("d", 1, "draft")
    a = node("a", 2, parent="d", minutes=1, eff=TODAY + timedelta(days=1))
    chain = only_chain([d, a])
    assert chain.current is a
    assert roles(chain) == {"d": "earlier", "a": "current"}
    assert chain.open_revision is None


def test_draft_on_top_of_signed_is_open_revision():
    a = node("a", 1)
    b = node("b", 2, "draft", parent="a", minutes=1)
    chain = only_chain([a, b])
    assert chain.current is a
    assert chain.open_revision is b
    assert roles(chain) == {"a": "current", "b": "upcoming"}
    assert next_revision_number(chain) == 3


def test_open_revision_is_the_last_unlocked_after_current():
    a = node("a", 1)
    b = node("b", 2, "draft", parent="a", minutes=1)
    c = node("c", 3, "in_review", parent="a", minutes=2)
    chain = only_chain([a, b, c])
    assert chain.current is a
    assert chain.open_revision is c


def test_unlocked_before_current_is_not_open_revision():
    d = node("d", 1, "draft")
    a = node("a", 2, parent="d", minutes=1)
    chain = only_chain([d, a])
    assert chain.current is a
    assert chain.open_revision is None
    assert roles(chain) == {"d": "earlier", "a": "current"}


def test_all_draft_chain_current_is_last_node():
    a = node("a", 1, "draft")
    b = node("b", 2, "draft", parent="a", minutes=1)
    c = node("c", 3, "in_review", parent="b", minutes=2)
    chain = only_chain([a, b, c])
    assert chain.current is c
    assert chain.open_revision is None
    assert roles(chain) == {"a": "earlier", "b": "earlier", "c": "current"}


# ---------------------------------------------------------------------------
# forks, gaps, dangling parents, cycles
# ---------------------------------------------------------------------------


def test_fork_two_children_ordered_deterministically_and_forked():
    a = node("a", 1)
    # Same revision number: created_at decides.
    c = node("c", 2, parent="a", minutes=1)
    b = node("b", 2, parent="a", minutes=2)
    chain = only_chain([b, a, c])
    assert ids(chain) == ["a", "c", "b"]
    assert chain.forked is True
    assert chain.current is b
    assert roles(chain) == {"a": "earlier", "c": "earlier", "b": "current"}
    assert next_revision_number(chain) == 3


def test_fork_with_equal_created_at_orders_by_id():
    a = node("a", 1)
    z = node("z", 2, parent="a", minutes=1)
    m = node("m", 2, parent="a", minutes=1)
    chain = only_chain([z, a, m])
    assert ids(chain) == ["a", "m", "z"]
    assert chain.current is z


def test_fork_with_distinct_numbers_is_forked():
    a = node("a", 1)
    b = node("b", 2, parent="a", minutes=1)
    c = node("c", 3, parent="a", minutes=2)
    chain = only_chain([a, b, c])
    assert ids(chain) == ["a", "b", "c"]
    assert chain.forked is True


def test_duplicate_revision_number_without_shared_parent_is_forked():
    a = node("a", 1)
    b = node("b", 1, parent="a", minutes=1)
    chain = only_chain([a, b])
    assert chain.forked is True


def test_revision_number_orders_before_created_at():
    # b was created first but carries the higher number.
    b = node("b", 2, parent="a", minutes=0)
    a = node("a", 1, minutes=5)
    chain = only_chain([b, a])
    assert ids(chain) == ["a", "b"]
    assert chain.current is b


def test_revision_number_gaps_are_kept():
    a = node("a", 1)
    b = node("b", 4, parent="a", minutes=1)
    c = node("c", 7, "draft", parent="b", minutes=2)
    chain = only_chain([a, b, c])
    assert ids(chain) == ["a", "b", "c"]
    assert chain.forked is False
    assert chain.current is b
    assert chain.open_revision is c
    assert next_revision_number(chain) == 8


def test_dangling_parent_becomes_a_root():
    a = node("a", 2, parent="deleted")
    b = node("b", 3, parent="a", minutes=1)
    chains = build_chains([a, b], today=TODAY)
    assert set(chains) == {"a", "b"}
    assert chains["a"] is chains["b"]
    assert ids(chains["a"]) == ["a", "b"]
    assert chains["a"].current is b
    assert chains["a"].forked is False


def test_dangling_parent_does_not_join_unrelated_nodes():
    a = node("a", 1, parent="gone")
    b = node("b", 1, parent="gone")
    chains = build_chains([a, b], today=TODAY)
    assert chains["a"] is not chains["b"]
    assert ids(chains["a"]) == ["a"]
    assert ids(chains["b"]) == ["b"]
    assert chains["a"].forked is False


def test_parent_id_cycle_terminates_and_forms_one_chain():
    a = node("a", 1, parent="c")
    b = node("b", 2, parent="a", minutes=1)
    c = node("c", 3, parent="b", minutes=2)
    chains = build_chains([a, b, c], today=TODAY)
    assert chains["a"] is chains["b"] is chains["c"]
    chain = chains["a"]
    assert ids(chain) == ["a", "b", "c"]
    assert chain.current is c
    assert chain.forked is False


def test_self_parent_terminates_and_is_not_a_fork():
    a = node("a", 1, parent="a")
    b = node("b", 2, parent="a", minutes=1)
    chain = only_chain([a, b])
    assert ids(chain) == ["a", "b"]
    assert chain.forked is False
    assert chain.current is b


def test_separate_roots_are_separate_chains():
    a = node("a", 1)
    b = node("b", 1)
    chains = build_chains([a, b], today=TODAY)
    assert chains["a"] is not chains["b"]
    assert ids(chains["a"]) == ["a"]
    assert ids(chains["b"]) == ["b"]


def test_duplicate_ids_are_refused():
    with pytest.raises(ValueError, match="duplicate revision id"):
        build_chains([node("a", 1), node("a", 2)], today=TODAY)


# ---------------------------------------------------------------------------
# group_key
# ---------------------------------------------------------------------------


def test_group_key_joins_rows_with_no_parent_link():
    a = node("a", 1, group="ADR-012")
    b = node("b", 2, minutes=1, group="ADR-012")
    c = node("c", 3, "draft", minutes=2, group="ADR-012")
    other = node("x", 1, group="ADR-013")
    chains = build_chains([a, b, c, other], today=TODAY)
    assert chains["a"] is chains["b"] is chains["c"]
    assert chains["x"] is not chains["a"]
    chain = chains["a"]
    assert ids(chain) == ["a", "b", "c"]
    assert chain.current is b
    assert chain.open_revision is c
    assert ids(chains["x"]) == ["x"]


def test_group_key_and_parent_links_merge_into_one_chain():
    a = node("a", 1, group="ADR-001")
    b = node("b", 2, parent="a", minutes=1)
    c = node("c", 3, minutes=2, group="ADR-001")
    chains = build_chains([a, b, c], today=TODAY)
    assert chains["a"] is chains["b"] is chains["c"]
    assert ids(chains["a"]) == ["a", "b", "c"]


def test_group_key_none_never_groups():
    a = node("a", 1, group=None)
    b = node("b", 1, group=None)
    chains = build_chains([a, b], today=TODAY)
    assert chains["a"] is not chains["b"]
    assert ids(chains["a"]) == ["a"]
    assert ids(chains["b"]) == ["b"]


# ---------------------------------------------------------------------------
# role
# ---------------------------------------------------------------------------


def test_role_of_unknown_id_raises():
    chain = only_chain([node("a", 1)])
    with pytest.raises(KeyError):
        chain.role("nope")


# ---------------------------------------------------------------------------
# revise_refusal
# ---------------------------------------------------------------------------


def test_revise_latest_signed_is_allowed():
    a = node("a", 1)
    b = node("b", 2, parent="a", minutes=1)
    chain = only_chain([a, b])
    assert revise_refusal(chain, "b") is None


def test_revise_single_signed_is_allowed():
    chain = only_chain([node("a", 1)])
    assert revise_refusal(chain, "a") is None


def test_revise_draft_is_not_locked():
    a = node("a", 1)
    b = node("b", 2, "draft", parent="a", minutes=1)
    chain = only_chain([a, b])
    assert revise_refusal(chain, "b") == "not_locked"


def test_revise_in_review_is_not_locked():
    chain = only_chain([node("a", 1, "in_review")])
    assert revise_refusal(chain, "a") == "not_locked"


def test_revise_with_open_draft_is_refused():
    a = node("a", 1)
    b = node("b", 2, "draft", parent="a", minutes=1)
    chain = only_chain([a, b])
    assert revise_refusal(chain, "a") == "open_revision_exists"


def test_open_revision_exists_counts_an_unlocked_node_before_this_one():
    d = node("d", 1, "draft")
    a = node("a", 2, parent="d", minutes=1)
    chain = only_chain([d, a])
    assert revise_refusal(chain, "a") == "open_revision_exists"


def test_revise_earlier_signed_is_not_latest():
    a = node("a", 1)
    b = node("b", 2, parent="a", minutes=1)
    chain = only_chain([a, b])
    assert revise_refusal(chain, "a") == "not_latest"


def test_not_latest_counts_a_future_effective_signed_revision():
    a = node("a", 1)
    b = node("b", 2, parent="a", minutes=1, eff=TODAY + timedelta(days=30))
    chain = only_chain([a, b])
    assert chain.current is a
    assert revise_refusal(chain, "a") == "not_latest"
    assert revise_refusal(chain, "b") is None


def test_refusal_precedence_not_locked_before_open_revision():
    # Two drafts: each is unlocked and each sees another unlocked node.
    a = node("a", 1)
    b = node("b", 2, "draft", parent="a", minutes=1)
    c = node("c", 3, "draft", parent="a", minutes=2)
    chain = only_chain([a, b, c])
    assert revise_refusal(chain, "b") == "not_locked"


def test_refusal_precedence_open_revision_before_not_latest():
    a = node("a", 1)
    b = node("b", 2, parent="a", minutes=1)
    c = node("c", 3, "draft", parent="b", minutes=2)
    chain = only_chain([a, b, c])
    # a is both not the latest locked revision and in a chain with a draft.
    assert revise_refusal(chain, "a") == "open_revision_exists"
    assert revise_refusal(chain, "b") == "open_revision_exists"


def test_revise_refusal_unknown_id_raises():
    chain = only_chain([node("a", 1)])
    with pytest.raises(KeyError):
        revise_refusal(chain, "nope")


# ---------------------------------------------------------------------------
# next_revision_number
# ---------------------------------------------------------------------------


def test_next_revision_number_uses_chain_maximum_not_last_node():
    # A fork: c (rev 2) was created after b (rev 5); the maximum still wins.
    a = node("a", 1)
    b = node("b", 5, parent="a", minutes=1)
    c = node("c", 2, parent="a", minutes=2)
    chain = only_chain([a, b, c])
    assert ids(chain) == ["a", "c", "b"]
    assert next_revision_number(chain) == 6
