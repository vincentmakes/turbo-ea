"""Give mutmut's ``mutants/`` the same place in the tree as the suite it copies.

mutmut copies the source and the tests into ``<suite>/mutants/`` and runs the
tests from there. Every test that finds a file relative to itself then looks
one directory too deep: ``Path(__file__).parents[3]`` is the repository root
from ``backend/tests/services/`` but ``backend/`` from
``backend/mutants/tests/services/``, so the workflow guards, the migration
tests, the extension loader's ``VERSION`` check and anything else that reads
the repository fail, and the stats pass (which runs with ``-x``) stops at the
first of them.

This script builds a *shadow root* per suite instead::

    .mutation/backend/            symlinks to every top-level entry of the repo,
    .mutation/backend/backend/    except the suite, which is a real directory
    backend/mutants  ->  ../.mutation/backend/backend

so a test running from ``.mutation/backend/backend/tests/services/`` sees the
same parents as from ``backend/tests/services/``. One root per suite, so the
backend's ``mcp-server`` is always the real one and the reverse. Inside the
suite's directory the
entries mutmut does not write itself (``alembic/``, ``bpmn_templates/`` ...)
are symlinked too; the ones it does write — the source paths, ``tests/``,
``pyproject.toml``, ``also_copy`` — are left alone so a copy can never land in
the real tree through a link.

Idempotent: run it before every ``mutmut run``. ``--clean`` removes it all.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SHADOW_NAME = ".mutation"
SUITES = ("backend", "mcp-server")

# What mutmut always copies into mutants/ (configuration.py, ``also_copy``
# defaults) plus what must never be shadowed: a link there would let a copy
# write into the real tree, or let pytest collect the suite twice.
_MUTMUT_OWNED = {
    "mutants",
    "tests",
    "test",
    "setup.cfg",
    "pyproject.toml",
    "uv.lock",
    "poetry.lock",
    "Pipfile.lock",
    "pdm.lock",
}
_NEVER_LINK_SUFFIXES = (".egg-info",)
_NEVER_LINK = {"__pycache__", "venv", ".venv", ".pytest_cache", ".ruff_cache"}


def mutmut_owned(suite_dir: Path) -> set[str]:
    """Top-level names under the suite that mutmut writes into ``mutants/``."""
    owned = set(_MUTMUT_OWNED)
    config = tomllib.loads((suite_dir / "pyproject.toml").read_text("utf-8"))
    mutmut = config.get("tool", {}).get("mutmut", {})
    for entry in [*mutmut.get("source_paths", []), *mutmut.get("also_copy", [])]:
        owned.add(Path(entry).parts[0])
    return owned


def _link(path: Path, target: str) -> None:
    """Point ``path`` at ``target`` (relative), replacing a stale link."""
    if path.is_symlink():
        if os.readlink(path) == target:
            return
        path.unlink()
    elif path.exists():
        return  # a real file or directory: mutmut's, keep it
    path.symlink_to(target)


def build(suite: str, repo: Path = REPO) -> Path:
    """Create or refresh the shadow root for ``suite``; return its mutants dir."""
    suite_dir = repo / suite
    shadow = repo / SHADOW_NAME / suite
    mutants = shadow / suite
    if mutants.is_symlink():  # never let mutmut write through a link into the tree
        mutants.unlink()
    mutants.mkdir(parents=True, exist_ok=True)

    for entry in repo.iterdir():
        if entry.name in (SHADOW_NAME, suite):
            continue
        _link(shadow / entry.name, f"../../{entry.name}")

    owned = mutmut_owned(suite_dir)
    for entry in suite_dir.iterdir():
        name = entry.name
        if name in owned or name in _NEVER_LINK or name.endswith(_NEVER_LINK_SUFFIXES):
            continue
        _link(mutants / name, f"../../../{suite}/{name}")

    link = suite_dir / "mutants"
    target = f"../{SHADOW_NAME}/{suite}/{suite}"
    if link.is_symlink():
        if os.readlink(link) != target:
            link.unlink()
            link.symlink_to(target)
    elif link.exists():
        raise SystemExit(
            f"{link} is a real directory left by a run without the shadow root; "
            "delete it and run again."
        )
    else:
        link.symlink_to(target)
    return mutants


def clean(suite: str, repo: Path = REPO) -> None:
    link = repo / suite / "mutants"
    if link.is_symlink():
        link.unlink()
    shutil.rmtree(repo / SHADOW_NAME / suite, ignore_errors=True)
    shadow = repo / SHADOW_NAME
    if shadow.is_dir() and not any(shadow.iterdir()):
        shadow.rmdir()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("suite", choices=SUITES)
    parser.add_argument("--clean", action="store_true", help="remove the shadow root")
    args = parser.parse_args(argv)
    if args.clean:
        clean(args.suite)
    else:
        print(build(args.suite))
    return 0


if __name__ == "__main__":
    sys.exit(main())
