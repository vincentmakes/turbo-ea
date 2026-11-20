#!/usr/bin/env python3
"""Find and fill translation gaps against the English source of truth.

English is authored by the implementation session; the nine other locales are
filled afterwards by the ``/translate`` skill (``.claude/skills/translate``),
which drives this script. Stdlib only, like ``scripts/check_deploy_versions.py``.

    python scripts/i18n/check_locales.py report [--base origin/main] [--json]
    python scripts/i18n/check_locales.py todo <locale> --out <file.json> [--base origin/main]
    python scripts/i18n/check_locales.py apply <locale> <file.json> [--base origin/main]

All three commands compare working files against the Git merge base. The flat TODO
maps namespace:dotted.key to English text for translation or null for deletion.
Only keys retired on this branch may be removed. Report exits 1 for missing or
empty values, placeholder mismatches, outstanding removals, missing or stale
manual translations, or an unavailable base.
Changed English with untouched translations requires review: an existing translation
can still be correct. Suspect values equal to English are also advisory.
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
    result: dict[str, list] = {
        "missing": [],
        "placeholder": [],
        "extra": [],
        "empty": [],
    }
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


def edit_member(text: str, path: tuple, value: str | None) -> str:
    """Edit one existing leaf without re-encoding its siblings or their escapes."""
    decoder = json.JSONDecoder()
    space = re.compile(r"\s*")
    start = text.index("{")
    removals = []
    for key in path:
        previous_end = None
        cursor = start + 1
        while True:
            name, key_end = decoder.raw_decode(text, space.match(text, cursor).end())
            colon = space.match(text, key_end).end()
            start = space.match(text, colon + 1).end()
            _, end = decoder.raw_decode(text, start)
            separator = space.match(text, end).end()
            last = text[separator] == "}"
            if name == key:
                removals.append(
                    (
                        previous_end if last and previous_end else cursor,
                        end if last else separator + 1,
                        last and previous_end is None,
                    )
                )
                break
            previous_end = end
            cursor = separator + 1
    if value is not None:
        return text[:start] + json.dumps(value, ensure_ascii=False) + text[end:]
    # If the removed leaf was its parent's only child, prune the empty object.
    while len(removals) > 1 and removals[-1][2]:
        removals.pop()
    begin, end, _ = removals[-1]
    return text[:begin] + text[end:]


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
            ["git", *args], cwd=REPO, check=True, capture_output=True, encoding="utf-8"
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def changed_files(revision: str | None) -> set[str] | None:
    """Files changed on this branch relative to ``base``, working tree included."""
    if revision is None:
        return None
    out = git("diff", "--no-renames", "--name-only", "-z", revision)
    untracked = git("ls-files", "--others", "--exclude-standard", "-z")
    if out is None or untracked is None:
        return None
    return {name for name in (out + untracked).split("\0") if name}


def locale_at(revision: str, locale: str, ns: str) -> dict:
    text = git("show", f"{revision}:frontend/src/i18n/locales/{locale}/{ns}.json")
    return flatten(json.loads(text)) if text else {}


def branch_changes(base: str) -> tuple[str, set[str]]:
    revision = git("merge-base", base, "HEAD")
    revision = revision.strip() if revision else None
    changed = changed_files(revision)
    if revision is None or changed is None:
        raise ValueError(f"cannot compare the working tree against {base}; check the Git base")
    return revision, changed


def ui_work(revision: str, changed: set[str], locales):
    """Yield source values, authorized tombstones and outstanding work per locale."""
    en_prefix = "frontend/src/i18n/locales/en/"
    touched = {
        Path(name).stem for name in changed if name.startswith(en_prefix) and name.endswith(".json")
    }
    for ns in sorted(set(namespaces()) | touched):
        en = load("en", ns)
        now = flatten(en)
        before = locale_at(revision, "en", ns) if ns in touched else now
        edited = {p for p in now if p not in before or before[p] != now[p]}
        for loc in locales:
            data = load(loc, ns)
            current = flatten(data)
            prior = current
            if ns in touched and f"frontend/src/i18n/locales/{loc}/{ns}.json" in changed:
                prior = locale_at(revision, loc, ns)
            result = diff_locale(en, data, loc)
            source = dict(now)
            review = set(edited)
            # A locale-only plural follows the English plural family's wording.
            for path in current.keys() | prior.keys():
                if path not in now and is_locale_extra(loc, path, now):
                    stem, _ = plural_base(path[-1])
                    variants = [path[:-1] + (f"{stem}_{suffix}",) for suffix in ("other", "one")]
                    source[path] = next(now[p] for p in variants if p in now)
                    if edited.intersection(variants):
                        review.add(path)
            removed = (before.keys() - source.keys()) | {
                p
                for p in current.keys() | prior.keys()
                if p not in source and is_locale_extra(loc, p, before)
            }
            result["changed"] = sorted(
                p for p in review if p in current and p in prior and prior[p] == current[p]
            )
            result["removed"] = sorted(removed.intersection(current))
            result["extra"] = [p for p in result["extra"] if p not in removed]
            result["suspect"] = sorted(p for p in review if current.get(p) == source[p])
            yield loc, ns, source, removed, result


def doc_pages() -> tuple[list[Path], set[Path]]:
    """English manual pages and their siblings, excluding internal specs and plans."""
    suffixes = tuple(f".{loc}" for loc in TARGET_LOCALES) + (".en",)
    all_md = {p for p in DOCS_DIR.rglob("*.md") if not p.is_relative_to(DOCS_DIR / "superpowers")}
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
    revision, changed = branch_changes(base)
    report: dict = {
        "base": base,
        "ui": {},
        "docs": {},
        "screenshots": screenshot_gaps(),
    }
    fatal = 0
    for loc, ns, _, _, result in ui_work(revision, changed, TARGET_LOCALES):
        entry = {kind: [dotted(p) for p in paths] for kind, paths in result.items()}
        fatal += sum(len(entry[k]) for k in ("missing", "placeholder", "empty", "removed"))
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
    report["fatal"] = fatal + sum(map(len, no_sibling.values())) + sum(map(len, stale.values()))
    return report


def print_report(report: dict) -> None:
    print(f"UI locale gaps (base {report['base']}):")
    if not report["ui"]:
        print("  none")
    for loc, per_ns in sorted(report["ui"].items()):
        for ns, entry in sorted(per_ns.items()):
            for kind in (
                "missing",
                "placeholder",
                "empty",
                "changed",
                "removed",
                "suspect",
                "extra",
            ):
                keys = entry[kind]
                if keys:
                    shown = ", ".join(keys[:8]) + (
                        f", … (+{len(keys) - 8})" if len(keys) > 8 else ""
                    )
                    print(f"  {loc}/{ns}.json {kind} ({len(keys)}): {shown}")
    docs = report["docs"]
    print("Manual pages missing translations:")
    for page, locs in sorted(docs["no_sibling"].items()):
        print(f"  {page}: {', '.join(locs)}")
    if not docs["no_sibling"]:
        print("  none")
    print("Changed manual pages with untouched translations:")
    for page, locs in sorted(docs["untouched_sibling"].items()):
        print(f"  {page}: {', '.join(locs)}")
    if not docs["untouched_sibling"]:
        print("  none")
    print("Screenshot entries missing a translated filename (non-fatal):")
    for gap in report["screenshots"]:
        print(f"  {gap['id']}: {', '.join(gap['missing'])}")
    if not report["screenshots"]:
        print("  none")
    print(f"Blocking UI and manual gaps: {report['fatal']}")


def cmd_report(args: argparse.Namespace) -> int:
    report = build_report(args.base)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_report(report)
    return 1 if report["fatal"] else 0


def cmd_todo(args: argparse.Namespace) -> int:
    todo: dict[str, object] = {}
    revision, changed = branch_changes(args.base)
    for _, ns, source, _, result in ui_work(revision, changed, [args.locale]):
        for kind in ("missing", "placeholder", "empty", "changed", "removed"):
            for path in result[kind]:
                todo[f"{ns}:{dotted(path)}"] = None if kind == "removed" else source[path]
    Path(args.out).write_text(canonical_json(todo), encoding="utf-8")
    print(f"{len(todo)} key(s) to translate for {args.locale} -> {args.out}")
    return 0


def apply_entries(
    locale: str, en: dict, text: str, source: dict, removed: set, entries: dict
) -> str:
    data = json.loads(text)
    current = flatten(data)
    known = {}
    for path in source.keys() | removed:
        key = dotted(path)
        known[key] = None if key in known else path
    # Resolve every removal against the branch, even when reapplying an old TODO.
    for key, value in entries.items():
        if value is not None:
            continue
        path = known.get(key)
        if path not in removed:
            raise ValueError(f"{key}: not an unambiguous removal from English")
        if path in current:
            text = edit_member(text, path, None)
            del current[path]
    data = json.loads(text)
    canonical = not data or text == canonical_json(data)
    for key, value in entries.items():
        if value is None:
            continue
        path = known.get(key)
        if path not in source:
            raise ValueError(f"{key}: no matching unambiguous English key")
        problem = validate_value(locale, str(source[path]), value)
        if problem:
            raise ValueError(f"{key}: {problem}")
        if current.get(path) == value:
            continue
        expected = insert_in_order(data, en, path, value)
        if path not in current and any(
            path[: len(p)] == p or p[: len(path)] == path for p in current
        ):
            raise ValueError(f"{key}: would overwrite other locale keys")
        if not canonical:
            if path in current:
                text = edit_member(text, path, value)
            elif len(path) == 1:
                preceding = list(expected)[: list(expected).index(path[0])]
                text = insert_flat_text(text, path[0], value, preceding[-1] if preceding else None)
            else:
                raise ValueError(f"{key}: cannot insert nested key without reformatting")
        data = expected
        current[path] = value
    if canonical:
        return canonical_json(data)
    if json.loads(text) != data:
        raise ValueError("layout-preserving edit diverged")
    return text


def cmd_apply(args: argparse.Namespace) -> int:
    locale = args.locale
    if locale not in TARGET_LOCALES:
        print(f"refusing: {locale} is not a target locale", file=sys.stderr)
        return 2
    todo = json.loads(Path(args.file).read_text(encoding="utf-8"))
    if not isinstance(todo, dict):
        print("refusing: expected an object of translation keys", file=sys.stderr)
        return 1
    by_ns = {}
    for full_key, value in todo.items():
        ns, separator, key = full_key.partition(":")
        if not separator:
            raise ValueError(f"missing namespace in {full_key}")
        by_ns.setdefault(ns, {})[key] = value
    revision, changed = branch_changes(args.base)
    writes = {}
    for _, ns, source, removed, _ in ui_work(revision, changed, [locale]):
        entries = by_ns.pop(ns, {})
        if not entries:
            continue
        target = LOCALES_DIR / locale / f"{ns}.json"
        en = load("en", ns)
        raw = target.read_bytes() if target.exists() else b"{}\n"
        newline = "\r\n" if b"\r\n" in raw else "\n"
        original = raw.decode("utf-8").replace("\r\n", "\n")
        text = apply_entries(locale, en, original, source, removed, entries)
        if text != original:
            delete_file = not (LOCALES_DIR / "en" / target.name).exists() and not json.loads(text)
            writes[target] = None if delete_file else text.replace("\n", newline).encode("utf-8")
    if by_ns:
        raise ValueError(f"unknown namespace: {next(iter(by_ns))}")
    for target, content in writes.items():
        if content is None:
            target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        print(f"{locale}/{target.name}: applied")
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
    todo.add_argument("--base", default="origin/main")
    todo.set_defaults(func=cmd_todo)
    apply = sub.add_parser("apply", help="insert translated keys in English order")
    apply.add_argument("locale")
    apply.add_argument("file")
    apply.add_argument("--base", default="origin/main")
    apply.set_defaults(func=cmd_apply)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
