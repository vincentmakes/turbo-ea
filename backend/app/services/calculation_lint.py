"""Static analysis of calculation formulas — no database, no evaluation.

Two jobs, both AST-based so that a string literal such as ``PLUCK(x, "data.foo")``
is never mistaken for a field reference the way a regex would:

* ``data_refs`` / ``unknown_field_refs`` — which card fields a formula reads, and
  which of those do not exist on the target card type. Rejecting the unknown ones
  at save time is what makes ``blanks_as_zero`` safe: once a typo cannot be
  stored, a ``None`` at evaluation time can only mean "this card has no value",
  never "this field name is wrong". Without that guarantee, zero-coercion turns a
  loud typo into a quiet wrong number.
* ``lint_formula`` — non-blocking warnings for mistakes that raise no error at
  all. The canonical one is plucking a bare field key off a related card: the key
  matches nothing on the wrapper object, ``PLUCK`` yields ``[None, None, …]`` and
  ``SUM`` reports ``0`` forever, with nothing anywhere to hint at why (#886).

Everything here is pure and cheap, which is what lets the API compute warnings on
a list response without a round-trip.
"""

from __future__ import annotations

import ast
import difflib
from functools import lru_cache

# Card properties the context always provides under `data`, on top of the
# type's own fields_schema keys. Single source of truth — calculation_engine
# builds both the real and the dummy `data` dict from this, so the validator
# can never reject a key the context actually supplies.
BUILTIN_CARD_PROPS = frozenset(
    {
        "name",
        "description",
        "status",
        "approval_status",
        "subtype",
        "reference",
        "lifecycle",
    }
)

# Attributes written onto cards.attributes by services rather than declared in
# a type's fields_schema. A formula may legitimately read these, so rejecting
# them at save time would be a regression. Keep this list short — the right fix
# for a new one is usually to declare the field in the metamodel.
KNOWN_EXTRA_ATTRIBUTE_KEYS = frozenset(
    {
        # capability_catalogue_service stamps these onto BusinessCapability cards
        "catalogueId",
        "capabilityLevel",
        # hierarchy.py stamps this onto every hierarchical type
        "hierarchyLevel",
    }
)

# Keys that legitimately appear at the top level of a related-card / child
# wrapper entry. Anything else in a PLUCK/FILTER key path over such a
# collection can only ever resolve to None.
RELATED_ENTRY_KEYS = frozenset(
    {
        "id",
        "name",
        "type",
        "subtype",
        "attributes",
        "rel_attributes",
        "ppm",
    }
)

_CARD_COLLECTION_ROOTS = frozenset({"relations", "children"})


def split_formula_lines(formula: str) -> list[tuple[str | None, str]]:
    """Split a formula into ``(assignment_target, expression)`` pairs.

    Mirrors exactly what the evaluator executes: blank lines and ``#`` comments
    are dropped, and a line shaped ``name = expr`` yields a target. Shared with
    ``calculation_engine._evaluate_formula`` so static analysis can never
    disagree with evaluation about what the formula actually is.
    """
    pairs: list[tuple[str | None, str]] = []
    for raw in formula.strip().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        var_name: str | None = None
        expression = line
        # Detect assignment: ``varname = expression`` (but NOT ``==`` or ``!=``).
        # String operations rather than a regex, to avoid polynomial
        # backtracking on adversarial input.
        eq_idx = line.find("=")
        if eq_idx > 0 and (eq_idx + 1 >= len(line) or line[eq_idx + 1] != "="):
            if line[eq_idx - 1] != "!":
                candidate = line[:eq_idx].rstrip()
                rest = line[eq_idx + 1 :].lstrip()
                if candidate.isidentifier() and rest:
                    var_name = candidate
                    expression = rest

        pairs.append((var_name, expression))
    return pairs


def _parse(expression: str) -> ast.Expression | None:
    """Parse one expression, or None when it does not compile.

    A syntax error is the evaluator's problem to report, not the linter's — a
    formula mid-edit should not produce spurious warnings.
    """
    try:
        return ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError):
        return None


def _is_data_name(node: ast.AST) -> bool:
    return isinstance(node, ast.Name) and node.id == "data"


@lru_cache(maxsize=256)
def data_refs(formula: str) -> frozenset[str]:
    """Every ``data.<key>`` / ``data["<key>"]`` the formula reads.

    ``data.lifecycle.endOfLife`` yields ``lifecycle``: the outer attribute hangs
    off another attribute, not off the ``data`` name, so only the inner one
    matches — which is right, since ``lifecycle`` is the key that has to exist.

    Subscripts count too. ``_DotDict`` returns ``None`` for a missing *attribute*
    but raises ``KeyError`` for a missing *key*, so ``data["typo"]`` is a real
    and differently-broken path; ignoring it would also leave an easy way to
    slip an unknown key past the save-time check.

    Cached: the same handful of formulas are re-parsed once per card on a bulk
    recalculation.
    """
    refs: set[str] = set()
    for _target, expression in split_formula_lines(formula):
        tree = _parse(expression)
        if tree is None:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and _is_data_name(node.value):
                refs.add(node.attr)
            elif (
                isinstance(node, ast.Subscript)
                and _is_data_name(node.value)
                and isinstance(node.slice, ast.Constant)
                and isinstance(node.slice.value, str)
            ):
                refs.add(node.slice.value)
    return frozenset(refs)


def known_field_keys(
    fields_schema: list[dict] | None,
    *,
    extra: set[str] | None = None,
) -> set[str]:
    """Field keys a card of this type can carry.

    The type's own ``fields_schema`` plus the built-in card properties, the
    service-written attributes that never appear in a schema, and any ``extra``
    the caller knows about — in practice the target fields of the type's other
    calculations, since one calculation routinely reads another's output and
    nothing requires a calculation target to be a declared field.
    """
    known = set(BUILTIN_CARD_PROPS) | set(KNOWN_EXTRA_ATTRIBUTE_KEYS) | set(extra or ())
    for section in fields_schema or []:
        for field in section.get("fields", []) or []:
            key = field.get("key")
            if key:
                known.add(key)
    return known


def unknown_field_refs(
    formula: str,
    fields_schema: list[dict] | None,
    *,
    extra: set[str] | None = None,
) -> list[str]:
    """Sorted ``data.<key>`` references that do not exist on the target type."""
    known = known_field_keys(fields_schema, extra=extra)
    return sorted(ref for ref in data_refs(formula) if ref not in known)


def suggest_field(
    name: str,
    fields_schema: list[dict] | None,
    *,
    extra: set[str] | None = None,
) -> str | None:
    """Nearest real field key for a mistyped one, or None if nothing is close.

    Case first — ``LicenseCost`` for ``licenseCost`` is by far the most common
    mistake, because the label is title-cased and the key is not.
    """
    known = known_field_keys(fields_schema, extra=extra)
    lowered = {k.lower(): k for k in known}
    exact = lowered.get(name.lower())
    if exact and exact != name:
        return exact
    close = difflib.get_close_matches(name, sorted(known), n=1, cutoff=0.7)
    return close[0] if close else None


def _wrapper_derived(node: ast.AST, aliases: dict[str, bool]) -> bool:
    """True when this expression yields related-card / child wrapper entries.

    Structural rather than a blind sub-tree walk, so provenance survives the
    shapes formulas actually take: an intermediate variable, a nested
    ``FILTER`` inside a ``PLUCK``, a subscripted lookup, two collections added
    together.
    """
    if isinstance(node, ast.Attribute):
        return isinstance(node.value, ast.Name) and node.value.id in _CARD_COLLECTION_ROOTS
    if isinstance(node, ast.Name):
        return aliases.get(node.id, node.id in _CARD_COLLECTION_ROOTS)
    if isinstance(node, ast.Subscript):  # relations["relAppToITC"]
        return _wrapper_derived(node.value, aliases)
    if isinstance(node, ast.BinOp):  # relations.a + relations.b
        return _wrapper_derived(node.left, aliases) or _wrapper_derived(node.right, aliases)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        # PLUCK / FILTER pass their first argument's provenance through.
        return bool(node.args) and _wrapper_derived(node.args[0], aliases)
    return False


@lru_cache(maxsize=256)
def lint_formula(formula: str) -> tuple[str, ...]:
    """Non-blocking warnings about a formula that runs but does not do what it says.

    Currently one check: a ``PLUCK``/``FILTER`` key path over a card collection
    whose first segment cannot exist on the wrapper entry. That is the silent
    zero from #886 — no exception is possible on that path, so a warning is the
    only way the author can ever learn about it.

    Sorted and deduplicated so the API field is stable between calls.
    """
    aliases: dict[str, bool] = {}
    warnings: set[str] = set()

    for target, expression in split_formula_lines(formula):
        tree = _parse(expression)
        if tree is None:
            continue

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            fn = node.func.id
            if fn not in ("PLUCK", "FILTER") or len(node.args) < 2:
                continue

            key_node = node.args[1]
            if not isinstance(key_node, ast.Constant) or not isinstance(key_node.value, str):
                continue  # computed key — nothing static to say about it
            key = key_node.value
            if not key or key.split(".", 1)[0] in RELATED_ENTRY_KEYS:
                continue
            if not _wrapper_derived(node.args[0], aliases):
                continue

            warnings.add(
                f'{fn} key "{key}" will not match: a related card\'s own fields live '
                f'under "attributes." — did you mean "attributes.{key}"?'
            )

        # Register the alias only after walking the line, so `x = PLUCK(x, …)`
        # cannot consult a half-built entry for itself.
        if target:
            aliases[target] = _wrapper_derived(tree.body, aliases)

    return tuple(sorted(warnings))
