"""Every blob a workspace transfer copies has been asked "do you hold an id?" (#1246).

The generic entity engine copies a JSON, text or asset column verbatim by
introspection. That is what let a diagram's ``cardId`` attributes travel to
another instance unchanged: nothing ever asked whether the column held an
instance-local card, relation or tag id. This guard asks it of every such
column — either the section declares it in ``id_bearing_columns`` with a
``rewrite`` (see ``workspace_io/remap.py``), or it is listed below with the
reason it holds none. A new column, or a new section, fails here until someone
has answered.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from app.services.workspace_io.sections import ENTITY_SECTIONS

PROSE = "free text a person typed"
DISPLAY = "display names / labels, not ids"
PICTURE = "a rendered picture; regenerated on the next save"
KEYS = "metamodel keys (types, fields, roles, options), not ids"
BINARY = "uploaded file bytes"
USER_IDS = "user ids, not card / relation / tag ids (signatures stay a separate concern)"
MODULE_IDS = "ids of module rows, which keep their primary keys on import"
ENUM = "a fixed status / category value stored as text"

ID_FREE_COLUMNS: dict[tuple[str, str], str] = {
    ("Documents", "url"): "an external link the user entered",
    ("Comments", "content"): PROSE,
    ("Todos", "description"): PROSE,
    ("FileAttachments", "data"): BINARY,
    ("CardLogos", "data"): BINARY,
    ("Diagrams", "description"): PROSE,
    ("ProcessDiagrams", "svg_thumbnail"): PICTURE,
    ("ProcessElements", "documentation"): PROSE,
    ("ProcessElements", "custom_fields"): "a step's own attribute values",
    ("ProcessFlowVersions", "svg_thumbnail"): PICTURE,
    ("ProcessFlowVersions", "withdrawal_reason"): PROSE,
    ("ProcessAssessments", "notes"): PROSE,
    ("ProcessAssessments", "action_items"): PROSE,
    ("PpmStatusReports", "schedule_health"): ENUM,
    ("PpmStatusReports", "cost_health"): ENUM,
    ("PpmStatusReports", "scope_health"): ENUM,
    ("PpmStatusReports", "summary"): PROSE,
    ("PpmStatusReports", "accomplishments"): PROSE,
    ("PpmStatusReports", "next_steps"): PROSE,
    ("PpmCostLines", "description"): PROSE,
    ("PpmCostLines", "category"): ENUM,
    ("PpmBudgetLines", "category"): ENUM,
    ("PpmRisks", "title"): PROSE,
    ("PpmRisks", "status"): ENUM,
    ("PpmRisks", "description"): PROSE,
    ("PpmRisks", "mitigation"): PROSE,
    ("PpmWbs", "title"): PROSE,
    ("PpmWbs", "description"): PROSE,
    ("PpmTasks", "title"): PROSE,
    ("PpmTasks", "status"): ENUM,
    ("PpmTasks", "priority"): ENUM,
    ("PpmTasks", "description"): PROSE,
    ("PpmTasks", "tags"): "free-form task labels",
    ("PpmTaskComments", "content"): PROSE,
    ("PpmDependencies", "kind"): ENUM,
    ("Risks", "description"): PROSE,
    ("Risks", "acceptance_rationale"): PROSE,
    ("RiskMitigationTasks", "description"): PROSE,
    ("RiskMitTaskOccurrences", "completion_notes"): PROSE,
    ("TurbolensAnalysisRuns", "results"): (
        "display-only history of a past scan; the findings it produced are remapped"
    ),
    ("TurbolensAnalysisRuns", "error_message"): PROSE,
    ("ComplianceFindings", "requirement"): PROSE,
    ("ComplianceFindings", "gap_description"): PROSE,
    ("ComplianceFindings", "evidence"): PROSE,
    ("ComplianceFindings", "remediation"): PROSE,
    ("ComplianceFindings", "review_note"): PROSE,
    ("Adrs", "context"): PROSE,
    ("Adrs", "decision"): PROSE,
    ("Adrs", "consequences"): PROSE,
    ("Adrs", "alternatives_considered"): PROSE,
    ("Adrs", "related_decisions"): MODULE_IDS,
    ("Adrs", "attributes"): "an extension's own ext.<key>.* bag; core cannot know its shape",
    ("Adrs", "signatories"): USER_IDS,
    ("Soaws", "document_info"): PROSE,
    ("Soaws", "version_history"): PROSE,
    ("Soaws", "sections"): PROSE,
    ("Soaws", "signatories"): USER_IDS,
    ("SavedReports", "description"): PROSE,
    ("SavedReports", "thumbnail"): PICTURE,
    ("Bookmarks", "columns"): KEYS,
    ("Bookmarks", "column_state"): KEYS,
    ("Bookmarks", "column_filter_model"): "grid filter values: names and option keys",
    ("Bookmarks", "sort"): KEYS,
    ("WebPortals", "description"): PROSE,
    ("WebPortals", "display_fields"): KEYS,
    ("WebPortals", "card_config"): KEYS,
    ("WebPortals", "allowed_email_domains"): "e-mail domains",
    ("Surveys", "description"): PROSE,
    ("Surveys", "message"): PROSE,
    ("Surveys", "target_roles"): KEYS,
    ("Surveys", "fields"): KEYS,
}


def _blob_columns(section) -> set[str]:
    """The columns the engine copies as blobs: JSONB, Text and binary value
    columns plus every offloaded asset."""
    managed = {a[0] for a in section.asset_columns} | {a[0] for a in section.json_asset_columns}
    copied = set(section.value_columns()) | managed
    out = set(managed)
    for col in section.model.__table__.columns:
        if col.name in copied and isinstance(col.type, (JSONB, sa.Text, sa.LargeBinary)):
            out.add(col.name)
    return out


def test_every_blob_column_is_declared_or_allowlisted():
    unanswered = []
    for section in ENTITY_SECTIONS:
        for col in sorted(_blob_columns(section)):
            if col in section.id_bearing_columns:
                continue
            if (section.sheet, col) not in ID_FREE_COLUMNS:
                unanswered.append(f"{section.sheet}.{col}")
    assert unanswered == [], (
        "These columns are copied verbatim by workspace transfer. If they can hold a "
        "card, relation or tag id, declare them in id_bearing_columns with a rewrite "
        "(workspace_io/remap.py); otherwise allowlist them in ID_FREE_COLUMNS with a reason."
    )


def test_no_allowlist_entry_is_stale():
    live = {(s.sheet, c) for s in ENTITY_SECTIONS for c in _blob_columns(s)}
    stale = sorted(k for k in ID_FREE_COLUMNS if k not in live)
    assert stale == []


def test_a_rewrite_and_its_columns_come_together():
    for section in ENTITY_SECTIONS:
        assert (section.rewrite is None) == (not section.id_bearing_columns), section.sheet
        columns = {c.name for c in section.model.__table__.columns}
        for col in section.id_bearing_columns:
            assert col in columns, f"{section.sheet}.{col}"
            assert (section.sheet, col) not in ID_FREE_COLUMNS, f"{section.sheet}.{col}"


def test_the_sections_that_hold_ids_are_the_known_ones():
    declared = {s.sheet: s.id_bearing_columns for s in ENTITY_SECTIONS if s.id_bearing_columns}
    assert declared == {
        "Todos": ("link",),
        "Diagrams": ("data",),
        "ProcessDiagrams": ("bpmn_xml",),
        "ProcessElements": ("called_element",),
        "ProcessFlowVersions": ("bpmn_xml", "draft_element_links"),
        "ComplianceFindings": ("finding_key",),
        "SavedReports": ("config",),
        "Bookmarks": ("filters",),
        "WebPortals": ("filters",),
        "Surveys": ("target_filters",),
        "SurveyResponses": ("responses",),
    }
