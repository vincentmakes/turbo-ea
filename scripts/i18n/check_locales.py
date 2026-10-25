#!/usr/bin/env python3
"""Find and fill translation gaps against the English source of truth.

English is authored by the implementation session; the nine other locales are
filled afterwards by the ``/translate`` skill (``.claude/skills/translate``),
which drives this script. Stdlib only, like ``scripts/check_deploy_versions.py``.

    python scripts/i18n/check_locales.py report [--base origin/main] [--json]
    python scripts/i18n/check_locales.py todo <locale> --out <file.json>
    python scripts/i18n/check_locales.py apply <locale> <file.json>

``report`` exits 1 on a missing key or a placeholder mismatch in the UI JSON and
0 otherwise. Suspect values (equal to English), plural-shape notes, documentation
gaps and screenshot filenames are reported but never fatal: CI parity stays owned
by ``frontend/src/i18n/i18n.test.ts`` and ``backend/tests/services/test_i18n_seed.py``.

The unit of work ``todo`` writes and ``apply`` reads is a flat JSON object
``{"<namespace>:<dotted.key.path>": "<value>"}``. ``todo`` fills the values with
English; the translator replaces them and hands the file to ``apply``, which
inserts each key into ``locales/<locale>/<namespace>.json`` at the position it
has in the English file.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOCALES_DIR = REPO / "frontend" / "src" / "i18n" / "locales"
DOCS_DIR = REPO / "docs"
PAGES_TS = REPO / "scripts" / "screenshots" / "pages.ts"

TARGET_LOCALES = ("de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar")
# Locales that carry their own screenshot filenames in pages.ts; da and ar fall
# back to the entry id on purpose.
SCREENSHOT_LOCALES = ("en", "de", "fr", "es", "it", "pt", "zh", "ru")
PLURAL_SUFFIXES = ("zero", "one", "two", "few", "many", "other")
# Plural categories a locale may carry beyond English's (CLDR).
EXTRA_PLURALS = {"ru": {"few", "many"}, "ar": {"zero", "two", "few", "many"}}
# "carte" is right in French only where it means a map.
FR_CARTE_ALLOWED = (
    "carte des capacités",
    "carte thermique",
    "carte de chaleur",
    "carte des processus",
)

_PLACEHOLDER = re.compile(r"\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}")
_PLURAL = re.compile(r"^(.*)_(" + "|".join(PLURAL_SUFFIXES) + r")$")
_CARTE = re.compile(r"\bcartes?\b", re.IGNORECASE)
_UNESCAPED_QUOTE = re.compile(r'(?<!\\)"')


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def flatten(obj: dict, prefix: tuple = ()) -> dict[tuple, object]:
    """Map every leaf of a nested JSON object to its key path (a tuple)."""
    out: dict[tuple, object] = {}
    for key, value in obj.items():
        path = prefix + (key,)
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


def dotted(path: tuple) -> str:
    return ".".join(path)


def placeholders(value: object) -> set[str]:
    """The ``{{name}}`` interpolation names in a value (format suffixes ignored)."""
    if not isinstance(value, str):
        return set()
    return set(_PLACEHOLDER.findall(value))


def plural_base(key: str) -> tuple[str, str | None]:
    """Split ``count_other`` into ``("count", "other")``; ``("x", None)`` otherwise."""
    match = _PLURAL.match(key)
    if not match:
        return key, None
    return match.group(1), match.group(2)


def is_locale_extra(locale: str, path: tuple, en_flat: dict) -> bool:
    """A key absent from English that is a legitimate extra plural form."""
    base, suffix = plural_base(path[-1])
    if suffix is None or suffix not in EXTRA_PLURALS.get(locale, set()):
        return False
    stem = path[:-1]
    return any(stem + (f"{base}_{s}",) in en_flat for s in ("one", "other"))


def diff_locale(en: dict, loc: dict, locale: str) -> dict[str, list]:
    """Compare one namespace of a locale against English.

    Returns ``missing`` (paths absent from the locale), ``placeholder`` (paths
    whose placeholder set differs), ``extra`` (locale-only paths that are not a
    legitimate plural form) and ``empty`` (present but blank).
    """
    en_flat = flatten(en)
    loc_flat = flatten(loc)
    result: dict[str, list] = {"missing": [], "placeholder": [], "extra": [], "empty": []}
    for path, value in en_flat.items():
        if path not in loc_flat:
            result["missing"].append(path)
            continue
        other = loc_flat[path]
        if isinstance(other, str) and not other.strip():
            result["empty"].append(path)
        elif placeholders(value) != placeholders(other):
            result["placeholder"].append(path)
    for path in loc_flat:
        if path not in en_flat and not is_locale_extra(locale, path, en_flat):
            result["extra"].append(path)
    return result


def fr_carte_violation(value: str) -> bool:
    """True when a French value uses « carte » for a card rather than a map."""
    text = value.lower()
    for allowed in FR_CARTE_ALLOWED:
        text = text.replace(allowed, "")
    return bool(_CARTE.search(text))


def validate_value(locale: str, en_value: str, value: object) -> str | None:
    """Why a translated value must be refused, or None when it may be applied."""
    if not isinstance(value, str) or not value.strip():
        return "empty value"
    if placeholders(value) != placeholders(en_value):
        return (
            f"placeholders {sorted(placeholders(value))} differ from English "
            f"{sorted(placeholders(en_value))}"
        )
    if _UNESCAPED_QUOTE.search(value):
        return 'contains an ASCII " (use 「」 for zh, «» or an escaped quote elsewhere)'
    if locale == "fr" and fr_carte_violation(value):
        return "uses « carte » for a card; French says « fiche » (maps excepted)"
    return None


def insert_in_order(loc: dict, en: dict, path: tuple, value: object) -> dict:
    """Return a copy of ``loc`` with ``path`` set, placed where English has it.

    Keys already in the locale keep their order; a new key goes right after
    the nearest preceding English sibling the locale already carries (and after
    any locale-only plural forms that follow it), or first when none does.
    """
    key, rest = path[0], path[1:]
    if rest:
        child_en = en.get(key, {})
        child_loc = loc.get(key, {})
        new_child = insert_in_order(
            child_loc if isinstance(child_loc, dict) else {}, child_en, rest, value
        )
    else:
        new_child = value
    if key in loc:
        return {k: (new_child if k == key else v) for k, v in loc.items()}
    en_keys = list(en.keys())
    predecessors = en_keys[: en_keys.index(key)] if key in en_keys else en_keys
    anchor = next((k for k in reversed(predecessors) if k in loc), None)
    items = list(loc.items())
    if anchor is None:
        pos = 0
    else:
        pos = [k for k, _ in items].index(anchor) + 1
        anchor_base, _ = plural_base(anchor)
        while pos < len(items):
            next_key = items[pos][0]
            base, suffix = plural_base(next_key)
            if suffix is None or base != anchor_base or next_key in en:
                break
            pos += 1
    items.insert(pos, (key, new_child))
    return dict(items)


def resolve_key(en_flat: dict, dotted_key: str) -> tuple:
    """The English key path a ``todo`` file's dotted key names."""
    matches = [p for p in en_flat if dotted(p) == dotted_key]
    if len(matches) != 1:
        raise KeyError(dotted_key)
    return matches[0]


def canonical_json(obj: dict) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def insert_flat_text(text: str, key: str, value: object, anchor: str | None) -> str:
    """Insert one top-level key into a flat JSON file's text, keeping its layout.

    Used for the few locale files that are not in canonical ``json.dumps`` form
    (blank lines between groups, ``\\u`` escapes), so an apply never reformats
    lines it did not add.
    """
    lines = text.split("\n")
    new_line = f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)}"
    if anchor is None:
        idx = next(i for i, line in enumerate(lines) if line.strip() == "{")
        has_entries = any(line.strip().startswith('"') for line in lines[idx + 1 :])
        lines.insert(idx + 1, new_line + ("," if has_entries else ""))
        return "\n".join(lines)
    pattern = re.compile(r"^\s*" + re.escape(json.dumps(anchor)) + r"\s*:")
    pattern_raw = re.compile(r"^\s*" + re.escape(json.dumps(anchor, ensure_ascii=False)) + r"\s*:")
    idx = next(i for i, line in enumerate(lines) if pattern.match(line) or pattern_raw.match(line))
    if lines[idx].rstrip().endswith(","):
        lines.insert(idx + 1, new_line + ",")
    else:
        lines[idx] = lines[idx].rstrip() + ","
        lines.insert(idx + 1, new_line)
    return "\n".join(lines)


def replace_flat_value(text: str, key: str, value: object) -> str:
    """Replace one top-level key's single-line string value in place."""
    keys = {json.dumps(key), json.dumps(key, ensure_ascii=False)}
    pattern = re.compile(
        r"^(\s*(?:" + "|".join(re.escape(k) for k in keys) + r')\s*:\s*)"(?:[^"\\]|\\.)*"',
        re.MULTILINE,
    )
    return pattern.sub(lambda m: m.group(1) + json.dumps(value, ensure_ascii=False), text, count=1)


# ---------------------------------------------------------------------------
# File access
# ---------------------------------------------------------------------------


def namespaces() -> list[str]:
    return sorted(p.stem for p in (LOCALES_DIR / "en").glob("*.json"))


def load(locale: str, ns: str) -> dict:
    path = LOCALES_DIR / locale / f"{ns}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def git(*args: str) -> str | None:
    try:
        return subprocess.run(
            ["git", *args], cwd=REPO, check=True, capture_output=True, text=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def changed_files(base: str) -> set[str] | None:
    """Files changed on this branch relative to ``base``, working tree included."""
    merge_base = git("merge-base", base, "HEAD")
    if merge_base is None:
        return None
    out = git("diff", "--name-only", merge_base.strip())
    untracked = git("ls-files", "--others", "--exclude-standard")
    if out is None:
        return None
    return {f for f in (out + (untracked or "")).splitlines() if f}


def english_at(base: str, ns: str) -> dict | None:
    merge_base = git("merge-base", base, "HEAD")
    if merge_base is None:
        return None
    text = git("show", f"{merge_base.strip()}:frontend/src/i18n/locales/en/{ns}.json")
    return json.loads(text) if text else {}


def doc_pages() -> tuple[list[Path], set[Path]]:
    """English doc pages (no locale suffix) and every file under docs/."""
    suffixes = tuple(f".{loc}" for loc in TARGET_LOCALES) + (".en",)
    all_md = set(DOCS_DIR.rglob("*.md"))
    english = sorted(p for p in all_md if not p.stem.endswith(suffixes))
    return english, all_md


def screenshot_gaps() -> list[dict]:
    text = PAGES_TS.read_text(encoding="utf-8") if PAGES_TS.exists() else ""
    # Only documentation screenshots are per-locale; marketing ones are English.
    text = text.split("export const MARKETING_PAGES", 1)[0]
    gaps = []
    for match in re.finditer(r"filenames:\s*\{([^}]*)\}", text):
        ids = re.findall(r'\bid:\s*"([^"]+)"', text[: match.start()])
        listed = set(re.findall(r"\b([a-z]{2}):\s*\"", match.group(1)))
        missing = [loc for loc in SCREENSHOT_LOCALES if loc not in listed]
        if missing:
            gaps.append({"id": ids[-1] if ids else "?", "missing": missing})
    return gaps


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def build_report(base: str) -> dict:
    changed = changed_files(base)
    report: dict = {"base": base, "ui": {}, "docs": {}, "screenshots": screenshot_gaps()}
    fatal = 0
    for ns in namespaces():
        en = load("en", ns)
        en_flat = flatten(en)
        touched: set[tuple] | None = None
        if changed is not None and f"frontend/src/i18n/locales/en/{ns}.json" in changed:
            before = flatten(english_at(base, ns) or {})
            touched = {p for p, v in en_flat.items() if before.get(p) != v}
        for loc in TARGET_LOCALES:
            data = load(loc, ns)
            result = diff_locale(en, data, loc)
            loc_flat = flatten(data)
            suspects = []
            if touched:
                suspects = [p for p in touched if p in loc_flat and loc_flat[p] == en_flat[p]]
            entry = {
                "missing": [dotted(p) for p in result["missing"]],
                "placeholder": [dotted(p) for p in result["placeholder"]],
                "empty": [dotted(p) for p in result["empty"]],
                "extra": [dotted(p) for p in result["extra"]],
                "suspect": sorted(dotted(p) for p in suspects),
            }
            fatal += len(entry["missing"]) + len(entry["placeholder"]) + len(entry["empty"])
            if any(entry.values()):
                report["ui"].setdefault(loc, {})[ns] = entry
    english, all_md = doc_pages()
    no_sibling: dict[str, list[str]] = {}
    stale: dict[str, list[str]] = {}
    for page in english:
        rel = page.relative_to(REPO).as_posix()
        for loc in TARGET_LOCALES:
            sibling = page.with_name(f"{page.stem}.{loc}.md")
            sib_rel = sibling.relative_to(REPO).as_posix()
            if sibling not in all_md:
                no_sibling.setdefault(rel, []).append(loc)
            elif changed is not None and rel in changed and sib_rel not in changed:
                stale.setdefault(rel, []).append(loc)
    report["docs"] = {"no_sibling": no_sibling, "untouched_sibling": stale}
    report["fatal"] = fatal
    return report


def print_report(report: dict) -> None:
    print(f"UI locale gaps (base {report['base']}):")
    if not report["ui"]:
        print("  none")
    for loc, per_ns in sorted(report["ui"].items()):
        for ns, entry in sorted(per_ns.items()):
            for kind in ("missing", "placeholder", "empty", "suspect", "extra"):
                keys = entry[kind]
                if keys:
                    shown = ", ".join(keys[:8]) + (
                        f", … (+{len(keys) - 8})" if len(keys) > 8 else ""
                    )
                    print(f"  {loc}/{ns}.json {kind} ({len(keys)}): {shown}")
    docs = report["docs"]
    print("Docs pages with no sibling (non-fatal):")
    for page, locs in sorted(docs["no_sibling"].items()):
        print(f"  {page}: {', '.join(locs)}")
    if not docs["no_sibling"]:
        print("  none")
    print("Docs pages changed on this branch whose sibling was not (non-fatal):")
    for page, locs in sorted(docs["untouched_sibling"].items()):
        print(f"  {page}: {', '.join(locs)}")
    if not docs["untouched_sibling"]:
        print("  none")
    print("Screenshot entries missing a translated filename (non-fatal):")
    for gap in report["screenshots"]:
        print(f"  {gap['id']}: {', '.join(gap['missing'])}")
    if not report["screenshots"]:
        print("  none")
    print(f"Fatal UI gaps: {report['fatal']}")


def cmd_report(args: argparse.Namespace) -> int:
    report = build_report(args.base)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_report(report)
    return 1 if report["fatal"] else 0


def cmd_todo(args: argparse.Namespace) -> int:
    todo: dict[str, object] = {}
    for ns in namespaces():
        en = load("en", ns)
        en_flat = flatten(en)
        result = diff_locale(en, load(args.locale, ns), args.locale)
        for path in result["missing"] + result["placeholder"] + result["empty"]:
            todo[f"{ns}:{dotted(path)}"] = en_flat[path]
    Path(args.out).write_text(canonical_json(todo), encoding="utf-8")
    print(f"{len(todo)} key(s) to translate for {args.locale} -> {args.out}")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    locale = args.locale
    if locale not in TARGET_LOCALES:
        print(f"refusing: {locale} is not a target locale", file=sys.stderr)
        return 2
    todo = json.loads(Path(args.file).read_text(encoding="utf-8"))
    by_ns: dict[str, dict[tuple, object]] = {}
    errors = []
    for full_key, value in todo.items():
        ns, _, key = full_key.partition(":")
        en_flat = flatten(load("en", ns))
        try:
            path = resolve_key(en_flat, key)
        except KeyError:
            errors.append(f"{full_key}: no such English key")
            continue
        problem = validate_value(locale, str(en_flat[path]), value)
        if problem:
            errors.append(f"{full_key}: {problem}")
            continue
        by_ns.setdefault(ns, {})[path] = value
    if errors:
        print("refused, nothing written:", file=sys.stderr)
        for line in errors:
            print(f"  {line}", file=sys.stderr)
        return 1
    for ns, entries in by_ns.items():
        target = LOCALES_DIR / locale / f"{ns}.json"
        en = load("en", ns)
        text = target.read_text(encoding="utf-8") if target.exists() else "{}\n"
        data = json.loads(text)
        expected = data
        for path, value in entries.items():
            expected = insert_in_order(expected, en, path, value)
        if canonical_json(data) == text or not text.strip("{}\n "):
            target.write_text(canonical_json(expected), encoding="utf-8")
        else:
            if any(len(p) > 1 for p in entries):
                print(f"refusing: {target} is not canonical JSON and nested", file=sys.stderr)
                return 1
            for (key,), value in entries.items():
                present = json.loads(text)
                if key in present:
                    text = replace_flat_value(text, key, value)
                    continue
                en_keys = list(en.keys())
                anchor = next(
                    (k for k in reversed(en_keys[: en_keys.index(key)]) if k in present), None
                )
                text = insert_flat_text(text, key, value, anchor)
            if json.loads(text) != expected:
                print(f"refusing: layout-preserving edit of {target} diverged", file=sys.stderr)
                return 1
            target.write_text(text, encoding="utf-8")
        print(f"{locale}/{ns}.json: {len(entries)} key(s) applied")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    rep = sub.add_parser("report", help="list gaps in every locale")
    rep.add_argument("--base", default="origin/main")
    rep.add_argument("--json", action="store_true")
    rep.set_defaults(func=cmd_report)
    todo = sub.add_parser("todo", help="write the keys one locale still needs")
    todo.add_argument("locale", choices=TARGET_LOCALES)
    todo.add_argument("--out", required=True)
    todo.set_defaults(func=cmd_todo)
    apply = sub.add_parser("apply", help="insert translated keys in English order")
    apply.add_argument("locale")
    apply.add_argument("file")
    apply.set_defaults(func=cmd_apply)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
