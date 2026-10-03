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

from tests.shard_plugin import parse_shard, shard_of

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


def test_shard_assignment_is_a_stable_hash_of_the_path() -> None:
    # crc32 is defined by the algorithm, not by the process: the same file lands
    # in the same shard on every runner, which is what lets separate CI jobs
    # take disjoint slices without talking to each other.
    assert shard_of("tests/api/test_cards.py", 4) == shard_of("tests/api/test_cards.py", 4)
    assert 1 <= shard_of("tests/api/test_cards.py", 4) <= 4
    assert shard_of("x", 1) == 1


@pytest.mark.parametrize("value", ["0/4", "5/4", "1/0", "abc", "1", "2/x", "/4"])
def test_a_malformed_shard_is_a_usage_error(value: str) -> None:
    with pytest.raises(pytest.UsageError):
        parse_shard(value)


def test_a_malformed_shard_fails_the_run_before_collection(tree: pytest.Pytester) -> None:
    result = tree.runpytest("-p", "no:cacheprovider", "--shard=5/4")
    assert result.ret == pytest.ExitCode.USAGE_ERROR
    result.stderr.fnmatch_lines(["*--shard=5/4: K must lie in 1..N*"])
