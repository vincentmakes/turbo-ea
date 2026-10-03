"""``--shard K/N``: run one deterministic slice of the suite.

CI runs the backend suite as several shards on parallel runners and combines
their coverage data afterwards (``Backend Integration Tests`` in
``.github/workflows/ci.yml``). Every test FILE is assigned to exactly one shard,
largest file first into the lightest shard, so the N shards partition the suite
and carry about the same number of tests.

The assignment is a pure function of the collected items: every shard job
collects the whole suite, so each one computes the same partition and takes its
own slice without the jobs talking to each other — and every pytest-xdist worker
inside a shard derives the same list, which xdist requires. File-level rather
than test-level so a module's fixtures stay together. Pass the same paths and
``-k`` to every shard: "shard K of this subset" is fine, a different subset per
shard is not. The hooks are imported into ``tests/conftest.py``; a ``pytester``
run can load them the same way.
"""

from __future__ import annotations

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--shard",
        default=None,
        metavar="K/N",
        help=(
            "Run only shard K of N (1-based). Test files are dealt to the N shards "
            "largest-first, so the shards partition the suite and are balanced."
        ),
    )


def parse_shard(value: str) -> tuple[int, int]:
    """``"2/4"`` → ``(2, 4)``; anything else is a usage error."""
    try:
        index_text, count_text = value.split("/", 1)
        index, count = int(index_text), int(count_text)
    except ValueError:
        raise pytest.UsageError(f"--shard expects K/N with two integers, got {value!r}") from None
    if count < 1 or not 1 <= index <= count:
        raise pytest.UsageError(f"--shard={value}: K must lie in 1..N and N must be >= 1")
    return index, count


def assign_shards(weights: dict[str, int], count: int) -> dict[str, int]:
    """File → 1-based shard: heaviest file first into the lightest shard.

    Deterministic (ties break on the path), never leaves a shard empty while
    there are at least ``count`` files, and adapts as files come and go — no
    stored durations to drift.
    """
    load = [0] * count
    assignment: dict[str, int] = {}
    for path, weight in sorted(weights.items(), key=lambda kv: (-kv[1], kv[0])):
        lightest = min(range(count), key=lambda i: (load[i], i))
        load[lightest] += weight
        assignment[path] = lightest + 1
    return assignment


def _file_key(item: pytest.Item) -> str:
    # rootdir-relative, posix, and never raises — unlike item.path.relative_to.
    return item.nodeid.split("::", 1)[0]


def pytest_configure(config: pytest.Config) -> None:
    value = config.getoption("--shard")
    if value:
        parse_shard(value)  # fail at startup, not after collection


@pytest.hookimpl(trylast=True)  # after -k / -m deselection, so weights are what will run
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    value = config.getoption("--shard")
    if not value:
        return
    index, count = parse_shard(value)
    weights: dict[str, int] = {}
    for item in items:
        weights[_file_key(item)] = weights.get(_file_key(item), 0) + 1
    assignment = assign_shards(weights, count)
    kept = [item for item in items if assignment[_file_key(item)] == index]
    dropped = [item for item in items if assignment[_file_key(item)] != index]
    if dropped:
        config.hook.pytest_deselected(items=dropped)
    items[:] = kept
