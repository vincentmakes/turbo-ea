"""The agent instructions stay small, and the path-scoped rules stay path-scoped.

``CLAUDE.md`` is loaded into every Claude Code session before the first prompt;
it grew to 370 KB (~90k tokens) before the area deep-dives moved into
``.claude/rules/*.md``, which Claude Code loads only when a file matching their
``paths:`` frontmatter is read or edited. This guard keeps both halves honest:
the always-loaded file under its cap, every rule file genuinely scoped (a glob
as wide as ``frontend/src/**`` would load it on every edit and undo the split),
every pointer in ``CLAUDE.md`` resolving, and the ``/translate`` skill wired to
its Sonnet translator.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.source_scan

_REPO = Path(__file__).resolve().parents[3]
_CLAUDE_MD = _REPO / "CLAUDE.md"
_RULES = _REPO / ".claude" / "rules"
_AGENT = _REPO / ".claude" / "agents" / "translator.md"
_SKILL = _REPO / ".claude" / "skills" / "translate" / "SKILL.md"

MAX_CLAUDE_MD_BYTES = 40_000
FORBIDDEN_GLOBS = {
    "**",
    "**/*",
    "*",
    "backend/**",
    "backend/app/**",
    "frontend/**",
    "frontend/src/**",
}


def _frontmatter(path: Path) -> dict[str, object]:
    """A minimal reader for the frontmatter these files use: scalars and string lists."""
    text = path.read_text(encoding="utf-8")
    match = re.match(r"---\n(.*?)\n---\n", text, re.DOTALL)
    assert match, f"{path.name} has no YAML frontmatter"
    data: dict[str, object] = {}
    current: str | None = None
    for line in match.group(1).splitlines():
        if not line.strip():
            continue
        item = re.match(r"\s+-\s+(.*)$", line)
        if item and current is not None:
            value = item.group(1).strip().strip('"').strip("'")
            assert isinstance(data[current], list), f"{path.name}: {current} mixes forms"
            data[current].append(value)  # type: ignore[union-attr]
            continue
        key, sep, value = line.partition(":")
        assert sep, f"{path.name}: unparseable frontmatter line {line!r}"
        current = key.strip()
        value = value.strip()
        data[current] = value.strip('"').strip("'") if value else []
    return data


def _rule_files() -> list[Path]:
    return sorted(_RULES.glob("*.md"))


def test_claude_md_is_under_its_cap():
    size = len(_CLAUDE_MD.read_bytes())
    assert size <= MAX_CLAUDE_MD_BYTES, (
        f"CLAUDE.md is {size} bytes (cap {MAX_CLAUDE_MD_BYTES}). A convention that does not "
        "apply to every change belongs in .claude/rules/<area>.md with a paths: frontmatter."
    )


def test_rule_files_exist():
    assert _rule_files(), "no .claude/rules/*.md files"


@pytest.mark.parametrize("path", _rule_files(), ids=lambda p: p.name)
def test_rule_file_is_path_scoped(path: Path):
    paths = _frontmatter(path).get("paths")
    assert isinstance(paths, list) and paths, f"{path.name} needs a non-empty paths: list"
    for glob in paths:
        assert glob, f"{path.name} has an empty glob"
        assert glob not in FORBIDDEN_GLOBS, (
            f"{path.name}: {glob!r} is so wide the rule would load on nearly every edit"
        )


def test_every_pointer_in_claude_md_resolves():
    text = _CLAUDE_MD.read_text(encoding="utf-8")
    pointers = set(re.findall(r"\.claude/rules/([\w.-]+\.md)", text))
    assert pointers, "CLAUDE.md points to no rule file"
    missing = sorted(p for p in pointers if not (_RULES / p).is_file())
    assert not missing, f"CLAUDE.md points to missing rule files: {missing}"


def test_every_rule_file_is_reachable_from_claude_md():
    text = _CLAUDE_MD.read_text(encoding="utf-8")
    orphans = [p.name for p in _rule_files() if f".claude/rules/{p.name}" not in text]
    assert not orphans, (
        f"rule files CLAUDE.md never names: {orphans}. Grep and Glob do not trigger "
        "path-scoped loading, so each file needs a pointer."
    )


def test_translator_agent_runs_on_sonnet_without_claude_md():
    meta = _frontmatter(_AGENT)
    assert meta.get("name") == "translator"
    assert meta.get("model") == "sonnet"
    assert meta.get("omitClaudeMd") == "true"


def test_translate_skill_forks_the_translator():
    meta = _frontmatter(_SKILL)
    assert meta.get("name") == "translate"
    assert meta.get("context") == "fork"
    assert meta.get("agent") == "translator"
    assert meta.get("model") == "sonnet"
