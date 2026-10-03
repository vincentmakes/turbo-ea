"""``--shard K/N``: run one deterministic slice of the suite.

CI runs the backend suite as several shards on parallel runners and combines
their coverage data afterwards (``Backend Integration Tests`` in
``.github/workflows/ci.yml``). Every test FILE is assigned to exactly one shard
by a stable hash of its path, so the N shards partition the suite and the same
file always lands in the same shard.

File-level rather than test-level so a module's fixtures stay together, and
``zlib.crc32`` rather than ``hash()`` — the string hash is seeded per process,
and every pytest-xdist worker and the controller must derive the same list or
xdist refuses to run. The hooks are imported into ``tests/conftest.py``; a
``pytester`` run can load them the same way.
"""

from __future__ import annotations

import zlib

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--shard",
        default=None,
        metavar="K/N",
        help=(
            "Run only shard K of N (1-based). Test files are assigned to shards by a "
            "stable hash of their path, so the N shards partition the suite exactly."
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


def shard_of(relative_path: str, count: int) -> int:
    """The 1-based shard a test file belongs to."""
    return zlib.crc32(relative_path.encode()) % count + 1


def pytest_configure(config: pytest.Config) -> None:
    value = config.getoption("--shard")
    if value:
        parse_shard(value)  # fail at startup, not after collection


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    value = config.getoption("--shard")
    if not value:
        return
    index, count = parse_shard(value)
    kept: list[pytest.Item] = []
    dropped: list[pytest.Item] = []
    for item in items:
        try:
            rel = item.path.relative_to(config.rootpath).as_posix()
        except ValueError:  # a file outside rootdir keeps its absolute path
            rel = item.path.as_posix()
        (kept if shard_of(rel, count) == index else dropped).append(item)
    if dropped:
        config.hook.pytest_deselected(items=dropped)
    items[:] = kept
