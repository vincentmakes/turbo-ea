"""Guard: every reader of the ``Relation`` model decides whether dates count.

A relation can carry its own lifecycle (migration 179): a planned relation has
not started, an ended one has stopped applying. That only means something if
the surfaces that COUNT relations — reports, flags, formulas, completeness,
dashboards, portals, the analysis loaders — stop counting a relation that is
not in effect today, while the surfaces that list relation rows for a person to
manage keep returning every row. The definition lives in one place,
``app/services/lifecycle.py``:

* ``lifecycle_in_effect`` (Python) and ``lifecycle_in_effect_sql`` (its SQL
  twin) — in effect on a day;
* ``live_relations_in_fiscal_year`` — the cost reports' fiscal-year rule
  (``is_live_in_fiscal_year``) applied to the relations they sum through.

This scan walks every function under ``app/`` (by AST, outermost definition)
that names the ``Relation`` model — through whatever alias it was imported
under — other than to construct one. Each must reference one of the markers
above, or sit in ``ALL_TIME`` with the reason it deliberately reads every row.
A new reader that does neither fails; so does an ``ALL_TIME`` entry that no
longer reads the model, or one that applies the definition after all.

It proves a function *considered* the dates, not that every query in it
applies them; the per-reader tests next to each reader are the behavioural
half.

Reads ``app/`` as source, so it is a ``source_scan`` and is deselected under
mutmut (``tests/mutation_plugin.py``).
"""

from __future__ import annotations

import ast

import pytest

from tests.app_source import iter_py

pytestmark = pytest.mark.source_scan

#: Names that apply the one definition.
MARKERS = frozenset(
    {"lifecycle_in_effect", "lifecycle_in_effect_sql", "live_relations_in_fiscal_year"}
)

#: Where the ORM model can be imported from.
_MODEL_MODULES = frozenset({"app.models.relation", "app.models"})

#: Readers that deliberately return every row, dated or not, keyed
#: ``<path under app/>::<outermost function>``. Each says why.
ALL_TIME: dict[str, str] = {
    # Row lists a person manages, and the writes behind them.
    "api/v1/relations.py::list_relations": (
        "GET /relations lists every row with its lifecycle; card detail and the "
        "inventory decide what to show"
    ),
    "api/v1/relations.py::create_relation": "looks the row up by id after the write",
    "api/v1/relations.py::update_relation": "edits one row by id, dated or not",
    "api/v1/relations.py::delete_relation": "deletes one row by id, dated or not",
    "services/card_write_service.py::find_relation": (
        "the idempotent-create lookup on (type, source, target): a pair has one row"
    ),
    "services/catalogue_common.py::add_relation_once": "looks a row up before writing it",
    "services/element_relation_sync.py::sync_element_relations": (
        "diffs the existing rows before writing; an ended row must not be re-created"
    ),
    "services/survey_apply.py::relation_field_peers": (
        "the respondent edits this set and apply_relation_change diffs against it: "
        "showing in-effect rows only would delete the others on submit"
    ),
    "services/survey_apply.py::apply_relation_change": (
        "diffs the submitted set against every stored row before writing"
    ),
    "services/rollback_service.py::_apply_delete_relation": "restores one row by id",
    "services/card_lifecycle.py::gather_archive_impact": (
        "archiving severs every relation, so the dialog lists every one"
    ),
    "services/card_lifecycle.py::expand_cascade_all_related": (
        "archive everything related means every row the impact dialog listed"
    ),
    "main.py::_purge_archived_cards_once": "deletes every row of a purged card",
    # Metamodel administration counts every instance, dated or not.
    "api/v1/metamodel.py::get_relation_type_instance_count": (
        "how many rows a relation-type change touches: every row"
    ),
    "api/v1/metamodel.py::update_relation_type": "counts every row a type change touches",
    "api/v1/metamodel.py::delete_relation_type": "deletes every row of the type",
    "services/card_type_delete.py::type_delete_impact": "counts every row a delete removes",
    "services/card_type_delete.py::delete_type_dependents": "deletes every row of the type",
    # Exports, transfer and migration carry every row with its dates.
    "services/workspace_io/exporter.py::build_bundle": "a workspace export is every row",
    "services/workspace_io/applier.py::_apply_relations": (
        "an import upserts onto every existing row, dated or not"
    ),
    "services/workspace_io/applier.py::_load_remap_context": "maps every existing row id",
    "services/migration/export_snapshot.py::build_export_snapshot": (
        "a platform export is every row, with its lifecycle"
    ),
    "services/migration/staging.py::stage_relations": (
        "staging diffs the source against every existing row"
    ),
    "services/migration/apply.py::_apply_relation_pass": (
        "applying reuses an existing row, dated or not"
    ),
    "api/v1/cards.py::export_json": (
        "a bulk export for integration consumers; names every linked provider"
    ),
    # The sweep looks for relations whose in-effect state CHANGED, both ways.
    "services/relation_lifecycle_sweep.py::affected_card_ids": (
        "finds relations that started or ended in the window, in effect or not"
    ),
    # The time-travel reports filter at the travelled date on the client.
    "api/v1/reports.py::dependencies": (
        "time travel: the client filters edges at the travelled date"
    ),
    "api/v1/reports.py::capability_heatmap": (
        "time travel: the client filters links at the travelled date"
    ),
    "services/portfolio_payload.py::build_portfolio_payload": (
        "time travel: the client filters app_relations at the travelled date"
    ),
}

#: Functions whose relation query is finished by a helper that applies the
#: definition: ``<reader> -> <the helper's key>``. The helper must itself apply it.
APPLIED_BY: dict[str, str] = {
    "services/portal_card_filters.py::relation_condition": (
        "services/portal_card_filters.py::_related"
    ),
    "services/portal_card_filters.py::relation_subtype_condition": (
        "services/portal_card_filters.py::_related"
    ),
}


def relation_names(tree: ast.AST) -> set[str]:
    """Every local name the ORM ``Relation`` model is imported under."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in _MODEL_MODULES:
            for alias in node.names:
                if alias.name == "Relation":
                    names.add(alias.asname or alias.name)
    return names


def _outermost_functions(tree: ast.Module) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    out: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append(node)
        elif isinstance(node, ast.ClassDef):
            out.extend(
                n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            )
    return out


def _reads(func: ast.AST, names: set[str]) -> bool:
    """``func`` names the model other than as a constructor or an annotation."""
    skip: set[int] = set()
    for node in ast.walk(func):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            skip.add(id(node.func))  # ``Relation(...)`` builds a row; it reads nothing
        for annotation in _annotations(node):
            skip.update(id(n) for n in ast.walk(annotation))
    return any(
        isinstance(node, ast.Name) and node.id in names and id(node) not in skip
        for node in ast.walk(func)
    )


def _annotations(node: ast.AST) -> list[ast.AST]:
    if isinstance(node, ast.arg) and node.annotation is not None:
        return [node.annotation]
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.returns is not None:
        return [node.returns]
    if isinstance(node, ast.AnnAssign):
        return [node.annotation]
    return []


def _applies_definition(func: ast.AST) -> bool:
    for node in ast.walk(func):
        if isinstance(node, ast.Name) and node.id in MARKERS:
            return True
        if isinstance(node, ast.Attribute) and node.attr in MARKERS:
            return True
    return False


def readers_in(text: str) -> dict[str, bool]:
    """``{function name: applies the definition}`` for every reader in one module."""
    tree = ast.parse(text)
    names = relation_names(tree)
    if not names:
        return {}
    return {
        func.name: _applies_definition(func)
        for func in _outermost_functions(tree)
        if _reads(func, names)
    }


def all_readers() -> dict[str, bool]:
    found: dict[str, bool] = {}
    for path, text in iter_py().items():
        if path == "models/relation.py":
            continue  # the model's own module
        for name, applies in readers_in(text).items():
            found[f"{path}::{name}"] = applies
    return found


def test_every_relation_reader_applies_the_definition_or_says_why_not():
    unclassified = sorted(
        key
        for key, applies in all_readers().items()
        if not applies and key not in ALL_TIME and key not in APPLIED_BY
    )
    assert not unclassified, (
        "These functions read the Relation model without deciding whether a "
        "relation's lifecycle dates count. A current-state reader (a count, a "
        "flag, an aggregate, a published or derived value) applies "
        "lifecycle_in_effect_sql / lifecycle_in_effect (or, for a fiscal-year "
        "cost, live_relations_in_fiscal_year); a reader that returns every row "
        "for a person to manage goes in ALL_TIME with the reason: "
        f"{unclassified}"
    )


def test_allowlists_are_not_stale():
    found = all_readers()
    for key in ALL_TIME:
        assert key in found, f"{key} no longer reads the Relation model; drop it from ALL_TIME"
        assert not found[key], (
            f"{key} applies the in-effect definition; it is no all-time reader — drop it "
            "from ALL_TIME"
        )
    for key, helper in APPLIED_BY.items():
        assert key in found, f"{key} no longer reads the Relation model; drop it from APPLIED_BY"
        assert not found[key], f"{key} applies the definition itself; drop it from APPLIED_BY"
        assert found.get(helper), f"{key} names {helper}, which does not apply the definition"


def test_the_two_lists_do_not_overlap():
    assert not set(ALL_TIME) & set(APPLIED_BY)


def test_the_scan_sees_a_new_unclassified_reader():
    source = """
from app.models.relation import Relation as Rel
from app.services.lifecycle import lifecycle_in_effect_sql


async def counts(db):
    return await db.execute(select(Rel.id))


async def counted(db):
    return await db.execute(select(Rel.id).where(lifecycle_in_effect_sql(Rel)))


def builds(card):
    return Rel(type="t", source_id=card.id)


def annotated(rel: Rel) -> Rel:
    return rel
"""
    # An aliased import is still the model; a constructor and annotations read nothing.
    assert readers_in(source) == {"counts": False, "counted": True}


def test_the_scan_ignores_another_relation_class():
    source = """
from app.services.migration.snapshot import Relation


def staged():
    return [r for r in select(Relation.id)]
"""
    assert readers_in(source) == {}


def test_the_scan_reads_methods_and_attribute_markers():
    source = """
from app.models import Relation
from app.services import lifecycle


class Loader:
    def all(self):
        return select(Relation)

    def now(self):
        return select(Relation).where(lifecycle.lifecycle_in_effect_sql(Relation))
"""
    assert readers_in(source) == {"all": False, "now": True}


def test_markers_name_the_definition():
    # The card-only fiscal-year rule is not a marker: a cost report that
    # filters its cards but not its relations has decided nothing about them.
    assert "is_live_in_fiscal_year" not in MARKERS
    assert MARKERS == {
        "lifecycle_in_effect",
        "lifecycle_in_effect_sql",
        "live_relations_in_fiscal_year",
    }
