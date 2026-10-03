"""The ``--shard K/N`` option partitions the suite exactly (tests/shard_plugin.py).

CI runs the backend suite as four shards on parallel runners and combines their
coverage; a file that landed in no shard would silently stop being tested, and
one in two shards would be measured twice. Run under ``pytester`` on a synthetic
tree so the assertions are about the partition, not about this repository.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.shard_plugin import assign_shards, parse_shard

pytest_plugins = ["pytester"]

BACKEND_DIR = Path(__file__).resolve().parents[2]
FILES = 12
COUNT = 4
PASSED = re.compile(r"^(test_\w+\.py)::(test_\w+) PASSED")


@pytest.fixture
def tree(pytester: pytest.Pytester) -> pytest.Pytester:
    pytester.syspathinsert(BACKEND_DIR)
    pytester.makeconftest(
        "from tests.shard_plugin import ("
        "pytest_addoption, pytest_collection_modifyitems, pytest_configure)"
    )
    for i in range(FILES):
        body = "\n".join(f"def test_{i}_{j}():\n    pass\n" for j in range(1 + i % 3))
        pytester.makepyfile(**{f"test_mod_{i:02d}": body})
    return pytester


def passed_ids(pytester: pytest.Pytester, *args: str) -> set[tuple[str, str]]:
    result = pytester.runpytest("-v", "-p", "no:cacheprovider", *args)
    assert result.ret == 0, result.outlines[-5:]
    return {m.groups() for line in result.outlines if (m := PASSED.match(line.strip()))}


def test_the_shards_partition_the_suite(tree: pytest.Pytester) -> None:
    everything = passed_ids(tree)
    assert len(everything) == sum(1 + i % 3 for i in range(FILES))

    shards = [passed_ids(tree, f"--shard={k}/{COUNT}") for k in range(1, COUNT + 1)]
    assert set().union(*shards) == everything, "a test fell out of every shard"
    assert sum(len(s) for s in shards) == len(everything), "a test ran in two shards"
    # whole files: a file's tests all sit in the same shard
    for shard in shards:
        files = {f for f, _ in shard}
        assert shard == {t for t in everything if t[0] in files}


def test_a_shard_is_deterministic(tree: pytest.Pytester) -> None:
    assert passed_ids(tree, f"--shard=2/{COUNT}") == passed_ids(tree, f"--shard=2/{COUNT}")


def test_assignment_deals_the_heaviest_files_first_into_the_lightest_shard() -> None:
    weights = {"a.py": 10, "b.py": 9, "c.py": 1, "d.py": 1}
    assignment = assign_shards(weights, 2)
    assert set(assignment) == set(weights)
    assert all(1 <= k <= 2 for k in assignment.values())
    # a→1 (10), b→2 (9), c→2 (10), d→1 (11): both shards end within one test of each other
    loads = {k: sum(w for f, w in weights.items() if assignment[f] == k) for k in (1, 2)}
    assert loads == {1: 11, 2: 10}


def test_assignment_is_deterministic_and_breaks_ties_on_the_path() -> None:
    weights = {"z.py": 3, "a.py": 3, "m.py": 3}
    first = assign_shards(weights, 3)
    assert first == assign_shards(dict(reversed(list(weights.items()))), 3)
    assert first == {"a.py": 1, "m.py": 2, "z.py": 3}


def test_no_shard_is_left_empty_while_there_are_enough_files() -> None:
    # An empty shard would exit 5 ("no tests collected") and fail its CI leg.
    weights = {f"f{i}.py": 1 + i % 3 for i in range(7)}
    assignment = assign_shards(weights, 4)
    assert set(assignment.values()) == {1, 2, 3, 4}
    assert assign_shards({}, 2) == {}


@pytest.mark.parametrize("value", ["0/4", "5/4", "1/0", "abc", "1", "2/x", "/4"])
def test_a_malformed_shard_is_a_usage_error(value: str) -> None:
    with pytest.raises(pytest.UsageError):
        parse_shard(value)


def test_a_malformed_shard_fails_the_run_before_collection(tree: pytest.Pytester) -> None:
    result = tree.runpytest("-p", "no:cacheprovider", "--shard=5/4")
    assert result.ret == pytest.ExitCode.USAGE_ERROR
    result.stderr.fnmatch_lines(["*--shard=5/4: K must lie in 1..N*"])
