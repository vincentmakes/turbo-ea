"""Entity-section descriptors for the card-context and module tables, consumed by
the generic :mod:`entities` engine.

Listed in dependency order: a section's intra-module parents come first
(``PpmWbs`` before ``PpmTask`` before ``PpmTaskComment``; ``Risk`` before
``RiskCard``/``RiskMitigationTask`` before the occurrences; ``ArchitectureDecision``
before its card links; ``Survey`` before ``SurveyResponse``). Cards and relations
are applied earlier by the bespoke core sections, so card FKs always resolve.
"""

from __future__ import annotations

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.bookmark import Bookmark
from app.models.comment import Comment
from app.models.diagram import Diagram
from app.models.diagram_favorite import DiagramFavorite
from app.models.diagram_group import DiagramGroup
from app.models.document import Document
from app.models.file_attachment import FileAttachment
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_dependency import PpmDependency
from app.models.ppm_risk import PpmRisk
from app.models.ppm_status_report import PpmStatusReport
from app.models.ppm_task import PpmTask
from app.models.ppm_task_comment import PpmTaskComment
from app.models.ppm_wbs import PpmWbs
from app.models.process_assessment import ProcessAssessment
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.process_flow_version import ProcessFlowVersion
from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import RiskMitigationTask, RiskMitigationTaskOccurrence
from app.models.saved_report import SavedReport
from app.models.soaw import SoAW
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.todo import Todo
from app.models.web_portal import WebPortal
from app.services.workspace_io.entities import EntitySection

# Sheet name for the bespoke Diagram↔Card association (handled like CardTags).
SHEET_DIAGRAM_CARDS = "DiagramCards"
# Sheet name for the bespoke Diagram↔Group association (both PKs preserved).
SHEET_DIAGRAM_GROUP_MEMBERS = "DiagramGroupMembers"

ENTITY_SECTIONS: tuple[EntitySection, ...] = (
    # --- Card context ----------------------------------------------------
    EntitySection(
        "Stakeholders", Stakeholder, card_fk_columns=("card_id",), user_fk_columns=("user_id",)
    ),
    EntitySection(
        "Documents", Document, card_fk_columns=("card_id",), user_fk_columns=("created_by",)
    ),
    EntitySection(
        "Comments",
        Comment,
        card_fk_columns=("card_id",),
        user_fk_columns=("user_id",),
        self_parent_column="parent_id",
    ),
    EntitySection(
        "Todos",
        Todo,
        card_fk_columns=("card_id",),
        user_fk_columns=("assigned_to", "created_by"),
    ),
    EntitySection(
        "FileAttachments",
        FileAttachment,
        card_fk_columns=("card_id",),
        user_fk_columns=("created_by",),
        asset_columns=(("data", "bytes", "bin"),),
        filename_column="name",  # keep the original filename + extension
    ),
    EntitySection(
        "Diagrams",
        Diagram,
        user_fk_columns=("created_by",),
        # Extract the DrawIO XML from data["xml"] into a real .drawio file;
        # the thumbnail / view / card_refs keys stay inline as JSON.
        json_asset_columns=(("data", "xml", "drawio"),),
        filename_column="name",
    ),
    # Diagram groups (shared) + per-user favorites. After Diagrams so the
    # favorites' diagram_id (an intra-module FK, preserved verbatim) resolves.
    EntitySection("DiagramGroups", DiagramGroup, user_fk_columns=("created_by",)),
    EntitySection("DiagramFavorites", DiagramFavorite, user_fk_columns=("user_id",)),
    # --- BPM --------------------------------------------------------------
    EntitySection(
        "ProcessDiagrams",
        ProcessDiagram,
        card_fk_columns=("process_id",),
        user_fk_columns=("created_by",),
        asset_columns=(("bpmn_xml", "text", "bpmn"), ("svg_thumbnail", "text", "svg")),
    ),
    EntitySection(
        "ProcessElements",
        ProcessElement,
        card_fk_columns=("process_id", "application_id", "data_object_id", "it_component_id"),
    ),
    EntitySection(
        "ProcessFlowVersions",
        ProcessFlowVersion,
        card_fk_columns=("process_id",),
        user_fk_columns=("created_by", "submitted_by", "approved_by"),
        self_parent_column="based_on_id",
        asset_columns=(("bpmn_xml", "text", "bpmn"), ("svg_thumbnail", "text", "svg")),
    ),
    EntitySection(
        "ProcessAssessments",
        ProcessAssessment,
        card_fk_columns=("process_id",),
        user_fk_columns=("assessor_id",),
    ),
    # --- PPM (wbs before task before comment/dependency) -----------------
    EntitySection(
        "PpmStatusReports",
        PpmStatusReport,
        card_fk_columns=("initiative_id",),
        user_fk_columns=("reporter_id",),
    ),
    EntitySection("PpmCostLines", PpmCostLine, card_fk_columns=("initiative_id",)),
    EntitySection("PpmBudgetLines", PpmBudgetLine, card_fk_columns=("initiative_id",)),
    EntitySection(
        "PpmRisks", PpmRisk, card_fk_columns=("initiative_id",), user_fk_columns=("owner_id",)
    ),
    EntitySection(
        "PpmWbs",
        PpmWbs,
        card_fk_columns=("initiative_id",),
        user_fk_columns=("assignee_id",),
        self_parent_column="parent_id",
    ),
    EntitySection(
        "PpmTasks", PpmTask, card_fk_columns=("initiative_id",), user_fk_columns=("assignee_id",)
    ),
    EntitySection("PpmTaskComments", PpmTaskComment, user_fk_columns=("user_id",)),
    EntitySection("PpmDependencies", PpmDependency, card_fk_columns=("initiative_id",)),
    # --- GRC risk register -----------------------------------------------
    EntitySection("Risks", Risk, user_fk_columns=("owner_id", "accepted_by", "created_by")),
    EntitySection("RiskCards", RiskCard, card_fk_columns=("card_id",)),
    EntitySection(
        "RiskMitigationTasks", RiskMitigationTask, user_fk_columns=("owner_id", "created_by")
    ),
    EntitySection(
        "RiskMitTaskOccurrences",
        RiskMitigationTaskOccurrence,
        user_fk_columns=("assigned_owner_id", "completed_by", "owner_at_completion"),
    ),
    # --- Governance / delivery -------------------------------------------
    EntitySection(
        "Adrs",
        ArchitectureDecision,
        user_fk_columns=("created_by",),
        self_parent_column="parent_id",
    ),
    EntitySection("AdrCards", ArchitectureDecisionCard, card_fk_columns=("card_id",)),
    EntitySection(
        "Soaws",
        SoAW,
        card_fk_columns=("initiative_id",),
        user_fk_columns=("created_by",),
        self_parent_column="parent_id",
    ),
    # --- Saved views + surveys -------------------------------------------
    EntitySection("SavedReports", SavedReport, user_fk_columns=("owner_id",)),
    EntitySection("Bookmarks", Bookmark, user_fk_columns=("user_id",)),
    EntitySection("WebPortals", WebPortal, user_fk_columns=("created_by",)),
    EntitySection("Surveys", Survey, user_fk_columns=("created_by",)),
    EntitySection(
        "SurveyResponses",
        SurveyResponse,
        card_fk_columns=("card_id",),
        user_fk_columns=("user_id",),
    ),
)
