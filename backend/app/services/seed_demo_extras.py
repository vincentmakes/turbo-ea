"""Extra demo seed data for NexaTech Industries – comments, stakeholders, etc.

Layers on top of the base NexaTech demo dataset created by seed_demo.py.
Populates comments, stakeholders, history events, diagrams, saved reports,
surveys, todos, documents, and bookmarks.

Can be triggered:
  1. Automatically via SEED_DEMO=true  (full demo experience)
  2. Via the standalone script scripts/seed_extras.py
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bookmark import Bookmark
from app.models.card import Card
from app.models.comment import Comment
from app.models.diagram import Diagram, diagram_cards
from app.models.document import Document
from app.models.ea_principle import EAPrinciple
from app.models.event import Event
from app.models.saved_report import SavedReport
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.todo import Todo
from app.models.user import User
from app.services.principles_catalogue_service import get_catalogue_principle

# ---------------------------------------------------------------------------
# Card name constants (must match seed_demo.py card names)
# ---------------------------------------------------------------------------
CARD_SAP_S4 = "SAP S/4HANA"
CARD_AZURE_IOT = "Azure IoT Hub"
CARD_SF_SALES = "Salesforce Sales Cloud"
CARD_SAP_ARIBA = "SAP Ariba"
CARD_POWERBI = "Power BI"
CARD_KAFKA = "Apache Kafka"
CARD_GRAFANA = "Grafana"
CARD_NEXACLOUD = "NexaCloud IoT Platform"
CARD_JENKINS = "Jenkins"
CARD_JIRA = "Jira"
CARD_CONFLUENCE = "Confluence"
CARD_OKTA = "Okta"
CARD_TEAMS = "Microsoft Teams"

CARD_INIT_SAP = "SAP S/4HANA Migration"
CARD_INIT_IOT = "IoT Platform Modernization"
CARD_INIT_SF = "Salesforce CRM Implementation"
CARD_INIT_DTP = "Digital Transformation Program"
CARD_INIT_CYBER = "Cybersecurity Enhancement"
CARD_INIT_DEVOPS = "DevOps Pipeline Modernization"

CARD_ORG_NEXATECH = "NexaTech Industries"
CARD_ORG_IT_OPS = "IT Operations"
CARD_ORG_ENGINEERING = "Engineering Division"

CARD_IF_SAP_TC = "SAP \u2194 Teamcenter BOM Sync"
CARD_IF_IOT_KAFKA = "Azure IoT Hub \u2192 Kafka Telemetry"
CARD_IF_SF_SAP = "Salesforce \u2192 SAP Order Sync"

CARD_ITC_AKS = "Azure Kubernetes Service"
CARD_ITC_POSTGRES = "PostgreSQL 16"
CARD_ITC_REDIS = "Redis 7"
CARD_ITC_NGINX = "Nginx"
CARD_ITC_AZURE_MONITOR = "Azure Monitor"
CARD_ITC_AZURE_SQL = "Azure SQL Database"

# All card names referenced by this module (exported for test validation)
REFERENCED_CARD_NAMES: list[str] = [
    CARD_SAP_S4,
    CARD_AZURE_IOT,
    CARD_SF_SALES,
    CARD_SAP_ARIBA,
    CARD_POWERBI,
    CARD_KAFKA,
    CARD_GRAFANA,
    CARD_NEXACLOUD,
    CARD_JENKINS,
    CARD_JIRA,
    CARD_CONFLUENCE,
    CARD_OKTA,
    CARD_TEAMS,
    CARD_INIT_SAP,
    CARD_INIT_IOT,
    CARD_INIT_SF,
    CARD_INIT_DTP,
    CARD_INIT_CYBER,
    CARD_INIT_DEVOPS,
    CARD_ORG_NEXATECH,
    CARD_ORG_IT_OPS,
    CARD_ORG_ENGINEERING,
    CARD_IF_SAP_TC,
    CARD_IF_IOT_KAFKA,
    CARD_IF_SF_SAP,
    CARD_ITC_AKS,
    CARD_ITC_POSTGRES,
    CARD_ITC_REDIS,
    CARD_ITC_NGINX,
    CARD_ITC_AZURE_MONITOR,
    CARD_ITC_AZURE_SQL,
]

# Stakeholder role assignments: (card_name, role)
STAKEHOLDER_ASSIGNMENTS: list[tuple[str, str]] = [
    # Application – technical_application_owner
    (CARD_SAP_S4, "technical_application_owner"),
    (CARD_NEXACLOUD, "technical_application_owner"),
    (CARD_KAFKA, "technical_application_owner"),
    (CARD_SF_SALES, "technical_application_owner"),
    (CARD_SAP_ARIBA, "technical_application_owner"),
    # Application – business_application_owner
    (CARD_SAP_S4, "business_application_owner"),
    (CARD_POWERBI, "business_application_owner"),
    (CARD_SF_SALES, "business_application_owner"),
    # Initiative – responsible
    (CARD_INIT_SAP, "responsible"),
    (CARD_INIT_IOT, "responsible"),
    (CARD_INIT_DTP, "responsible"),
    (CARD_INIT_DEVOPS, "responsible"),
    # Initiative – it_project_manager
    (CARD_INIT_SF, "it_project_manager"),
    (CARD_INIT_CYBER, "it_project_manager"),
    # Organization – responsible
    (CARD_ORG_IT_OPS, "responsible"),
    (CARD_ORG_ENGINEERING, "responsible"),
    # Application – observer
    (CARD_GRAFANA, "observer"),
    (CARD_JENKINS, "observer"),
    (CARD_CONFLUENCE, "observer"),
]

# Exported for test validation
VALID_STAKEHOLDER_ROLES_BY_TYPE: dict[str, set[str]] = {
    "Application": {
        "responsible",
        "observer",
        "technical_application_owner",
        "business_application_owner",
    },
    "Initiative": {"responsible", "it_project_manager", "observer"},
    "Organization": {"responsible", "observer"},
    "BusinessProcess": {"responsible", "process_owner", "observer"},
}

# Valid event types
VALID_EVENT_TYPES: set[str] = {
    "card.created",
    "card.updated",
    "card.archived",
    "card.restored",
    "card.deleted",
    "comment.created",
    "relation.created",
    "relation.deleted",
}

# Valid saved report types
VALID_REPORT_TYPES: set[str] = {
    "portfolio",
    "capability-map",
    "lifecycle",
    "dependencies",
    "cost",
    "matrix",
    "data-quality",
    "eol",
}

# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------
_BASE = datetime(2026, 1, 5, 9, 0, 0, tzinfo=timezone.utc)


def _ts(days_offset: int, hours: int = 10) -> datetime:
    """Return a UTC timestamp offset from the base date."""
    return _BASE + timedelta(days=days_offset, hours=hours - 9)


# ---------------------------------------------------------------------------
# Comment definitions
# ---------------------------------------------------------------------------

# (card_name, content, days_offset, reply_index_or_None)
# reply_index refers to position in this list (0-indexed) for threading
COMMENT_DEFS: list[tuple[str, str, int, int | None]] = [
    # SAP S/4HANA – architecture discussion thread
    (
        CARD_SAP_S4,
        "Completed the technical assessment for the S/4HANA migration path. "
        "Brownfield conversion is confirmed as the recommended approach given "
        "our existing customizations.",
        0,
        None,
    ),
    (
        CARD_SAP_S4,
        "Agreed. We should document the 170 custom ABAP programs that need "
        "remediation. I've started the inventory in the migration tracker.",
        2,
        0,
    ),
    (
        CARD_SAP_S4,
        "Integration architecture review scheduled for next week. We need to "
        "decide on SAP Integration Suite vs. keeping the existing middleware.",
        5,
        0,
    ),
    (
        CARD_SAP_S4,
        "Updated the lifecycle phase to reflect the current migration status. "
        "Phase-in target remains Q3 2026.",
        12,
        None,
    ),
    # NexaCloud IoT Platform – operational discussion
    (
        CARD_NEXACLOUD,
        "Telemetry throughput has been stable at 45k events/minute. The new "
        "Kafka consumer group configuration resolved the previous bottleneck.",
        3,
        None,
    ),
    (
        CARD_NEXACLOUD,
        "Good news. We should plan capacity for the next device generation "
        "which will double the event rate. See the IoT Platform Modernization "
        "initiative for the roadmap.",
        4,
        4,
    ),
    (
        CARD_NEXACLOUD,
        "Edge computing proof-of-concept results are promising. Anomaly "
        "detection latency dropped from 2.3s to 180ms at the edge.",
        15,
        None,
    ),
    # Salesforce Sales Cloud – CRM rollout
    (
        CARD_SF_SALES,
        "EMEA sales team onboarding complete. 120 users trained on the new "
        "opportunity management workflow. Americas rollout planned for March.",
        7,
        None,
    ),
    (
        CARD_SF_SALES,
        "Data migration from the legacy CRM validated. 98.5% record accuracy "
        "after the initial sync. Working on the remaining edge cases.",
        10,
        None,
    ),
    # SAP S/4HANA Migration initiative – status updates
    (
        CARD_INIT_SAP,
        "Architecture Review Board approved the migration architecture. "
        "Key decision: use SAP Integration Suite for all S/4HANA-connected "
        "integrations (see ADR-003).",
        8,
        None,
    ),
    (
        CARD_INIT_SAP,
        "Risk update: ABAP remediation timeline is tight. Proposing to bring "
        "in an additional SAP consultant for the Q2 sprint.",
        20,
        None,
    ),
    # Digital Transformation Program – strategic
    (
        CARD_INIT_DTP,
        "Quarterly steering committee update: 3 of 6 workstreams on track, "
        "2 at risk (SAP migration timeline, cloud skills gap). Budget "
        "utilization at 42% of annual allocation.",
        14,
        None,
    ),
    (
        CARD_INIT_DTP,
        "Cloud CoE team hiring complete. 6 FTEs onboarded covering Azure, "
        "Kubernetes, and Terraform expertise.",
        25,
        11,
    ),
    # SAP Ariba – procurement platform
    (
        CARD_SAP_ARIBA,
        "Supplier onboarding workflow integration with SAP S/4HANA is live. "
        "85 preferred suppliers migrated to the new procurement portal. "
        "Remaining vendors scheduled for Q2 onboarding.",
        18,
        None,
    ),
    # Azure IoT Hub – infrastructure
    (
        CARD_AZURE_IOT,
        "Upgraded to premium tier to support the 100k device target. "
        "Device provisioning service configured for automatic enrollment.",
        22,
        None,
    ),
    # Kafka – platform operations
    (
        CARD_KAFKA,
        "Schema Registry deployed. All new topics now require Avro schemas "
        "as per ADR-005. Existing topics will be migrated by end of Q1.",
        30,
        None,
    ),
    (
        CARD_KAFKA,
        "Cluster expanded to 5 brokers to handle the increased IoT telemetry "
        "volume. Replication factor increased to 3 for critical topics.",
        35,
        15,
    ),
    # Organization – governance
    (
        CARD_ORG_NEXATECH,
        "Annual IT landscape review completed. Data quality score improved "
        "from 72% to 85% across all card types. Key gap: lifecycle dates "
        "missing for 15% of applications.",
        40,
        None,
    ),
    # Cybersecurity Enhancement – security
    (
        CARD_INIT_CYBER,
        "Zero Trust implementation Phase 1 complete. Azure Entra ID "
        "configured as the primary identity provider. MFA enforced for "
        "all privileged accounts.",
        28,
        None,
    ),
    (
        CARD_INIT_CYBER,
        "Penetration test results from the external audit are in. No "
        "critical findings. 3 medium-severity items added to the backlog.",
        32,
        18,
    ),
]


# ---------------------------------------------------------------------------
# Saved report configurations
# ---------------------------------------------------------------------------
# Each entry's `config` dict must use the keys the corresponding report
# component actually reads in its `consumeConfig` effect. Mismatched keys
# load silently as no-ops, which is what previously made the demo saved
# reports look broken — they opened with default state instead of the
# preset the user expected.
SAVED_REPORT_DEFS: list[dict] = [
    {
        "name": "Application Portfolio Overview",
        "description": (
            "Applications grouped by business criticality and coloured by "
            "time model — useful for spotting concentrations of "
            "mission-critical legacy apps at a glance."
        ),
        "report_type": "portfolio",
        # PortfolioReport.tsx → consumeConfig reads:
        # view, groupByRaw, colorBy, search, attrFilters, relationFilters,
        # tagFilterIds, sortK, sortD, timelineDate.
        # groupByRaw uses the `attr:<fieldKey>` / `rel:<typeKey>` prefixes
        # the report writes when the user clicks Save — bare keys load as
        # a no-op and the chart shows the report's default grouping.
        "config": {
            "view": "chart",
            "groupByRaw": "attr:businessCriticality",
            "colorBy": "timeModel",
        },
        "visibility": "public",
    },
    {
        "name": "Application Portfolio by Organization",
        "description": (
            "Same applications grouped instead by the owning Organization "
            "(via the Organization → Application relation), still coloured "
            "by time model — surfaces which business units carry the most "
            "tolerate / migrate / eliminate workload."
        ),
        "report_type": "portfolio",
        "config": {
            "view": "chart",
            "groupByRaw": "rel:Organization",
            "colorBy": "timeModel",
        },
        "visibility": "public",
    },
    {
        "name": "Business Capability Heatmap",
        "description": (
            "Heatmap of business capabilities coloured by application "
            "business criticality so you can see where critical workload "
            "concentration sits."
        ),
        "report_type": "capability-map",
        # CapabilityMapReport.tsx → consumeConfig reads:
        # metric, displayLevel, showApps, colorBy, attrFilters,
        # relationFilters, tagFilterIds, timelineDate
        "config": {
            "metric": "count",
            "displayLevel": 2,
            "showApps": True,
            "colorBy": "businessCriticality",
        },
        "visibility": "public",
    },
    {
        "name": "Cost by Provider (Apps + IT Components)",
        "description": (
            "Cost report rolled up by Provider, aggregating annual cost "
            "from related Applications and IT Components — useful for "
            "vendor consolidation and contract negotiation."
        ),
        "report_type": "cost",
        # CostReport.tsx → consumeConfig reads:
        # cardTypeKey, costField, costSources, groupBy, view, sortK, sortD,
        # drillStack. costSources are `<typeKey>:<costFieldKey>` strings
        # for the related types whose costs roll up to the primary.
        "config": {
            "cardTypeKey": "Provider",
            "costField": "costTotalAnnual",
            "costSources": [
                "Application:costTotalAnnual",
                "ITComponent:costTotalAnnual",
            ],
            "view": "chart",
        },
        "visibility": "public",
    },
]

# ---------------------------------------------------------------------------
# Survey definitions
# ---------------------------------------------------------------------------
SURVEY_DEFS: list[dict] = [
    {
        "name": "Annual Application Review 2026",
        "description": (
            "Yearly survey to validate and update key application attributes. "
            "Targeted at application owners."
        ),
        "message": (
            "Please review the following attributes for your application and "
            "confirm or update the values. This helps maintain the accuracy "
            "of our IT landscape documentation."
        ),
        "status": "active",
        "target_type_key": "Application",
        "target_roles": ["responsible", "technical_application_owner"],
        "fields": [
            {
                "key": "productName",
                "section": "Cost & Ownership",
                "label": "Product Name",
                "type": "text",
                "action": "confirm",
            },
            {
                "key": "businessCriticality",
                "section": "Application Information",
                "label": "Business Criticality",
                "type": "single_select",
                "options": [
                    {"key": "missionCritical", "label": "Mission Critical"},
                    {"key": "businessCritical", "label": "Business Critical"},
                    {"key": "businessOperational", "label": "Business Operational"},
                    {"key": "administrativeService", "label": "Administrative Service"},
                ],
                "action": "maintain",
            },
            {
                "key": "numberOfUsers",
                "section": "Cost & Ownership",
                "label": "Number of Users",
                "type": "number",
                "action": "maintain",
            },
        ],
    },
    {
        "name": "IT Component Data Quality Check",
        "description": (
            "Quick survey to fill in missing data for IT components. "
            "Focus on version and support information."
        ),
        "message": (
            "We noticed some IT components are missing version and support "
            "information. Please help us complete this data."
        ),
        "status": "draft",
        "target_type_key": "ITComponent",
        "target_roles": [],
        "fields": [
            {
                "key": "version",
                "section": "Component Information",
                "label": "Current Version",
                "type": "text",
                "action": "maintain",
            },
            {
                "key": "licenseType",
                "section": "Cost",
                "label": "License Type",
                "type": "text",
                "action": "maintain",
            },
        ],
    },
]

# Survey response cards (for the active Application survey)
SURVEY_RESPONSE_CARDS: list[tuple[str, str, dict | None]] = [
    # (card_name, status, responses_or_None)
    (
        CARD_SAP_S4,
        "completed",
        {
            "productName": {
                "current_value": "SAP S/4HANA Cloud",
                "new_value": "SAP S/4HANA Cloud",
                "confirmed": True,
            },
            "businessCriticality": {
                "current_value": "missionCritical",
                "new_value": "missionCritical",
                "confirmed": True,
            },
            "numberOfUsers": {
                "current_value": 850,
                "new_value": 920,
                "confirmed": False,
            },
        },
    ),
    (
        CARD_SF_SALES,
        "completed",
        {
            "productName": {
                "current_value": "Salesforce Sales Cloud",
                "new_value": "Salesforce Sales Cloud",
                "confirmed": True,
            },
            "businessCriticality": {
                "current_value": "businessCritical",
                "new_value": "missionCritical",
                "confirmed": False,
            },
            "numberOfUsers": {
                "current_value": 350,
                "new_value": 480,
                "confirmed": False,
            },
        },
    ),
    (CARD_NEXACLOUD, "pending", None),
    (CARD_KAFKA, "pending", None),
    (CARD_SAP_ARIBA, "pending", None),
]

# ---------------------------------------------------------------------------
# Todo definitions: (card_name_or_None, description, status, due_days_offset)
# ---------------------------------------------------------------------------
TODO_DEFS: list[tuple[str | None, str, str, int | None]] = [
    (CARD_SAP_S4, "Review vendor contract renewal terms for S/4HANA Cloud", "open", 30),
    (CARD_SAP_S4, "Update lifecycle dates after migration milestone review", "done", -5),
    (CARD_NEXACLOUD, "Document edge computing deployment architecture", "open", 45),
    (CARD_SF_SALES, "Complete Americas region data migration validation", "open", 20),
    (CARD_INIT_DTP, "Prepare Q2 steering committee presentation", "open", 15),
    (CARD_INIT_SAP, "Finalize ABAP remediation scope and timeline", "done", -10),
    (CARD_SAP_ARIBA, "Review supplier catalog data migration from legacy system", "open", 25),
    (CARD_KAFKA, "Migrate legacy topics to Avro schema format", "open", 60),
]

# ---------------------------------------------------------------------------
# Document (URL attachment) definitions: (card_name, name, url)
# ---------------------------------------------------------------------------
DOCUMENT_DEFS: list[tuple[str, str, str]] = [
    (
        CARD_SAP_S4,
        "SAP S/4HANA Product Page",
        "https://www.sap.com/products/erp/s4hana.html",
    ),
    (
        CARD_SAP_S4,
        "Migration Guide - Brownfield Conversion",
        "https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/",
    ),
    (
        CARD_SF_SALES,
        "Salesforce Sales Cloud Documentation",
        "https://help.salesforce.com/s/articleView?id=sf.sales_core.htm",
    ),
    (
        CARD_SAP_ARIBA,
        "SAP Ariba Documentation",
        "https://help.sap.com/docs/ariba",
    ),
    (
        CARD_KAFKA,
        "Apache Kafka Documentation",
        "https://kafka.apache.org/documentation/",
    ),
    (
        CARD_AZURE_IOT,
        "Azure IoT Hub Developer Guide",
        "https://learn.microsoft.com/en-us/azure/iot-hub/",
    ),
]

# ---------------------------------------------------------------------------
# Bookmark (saved inventory view) definitions
#
# Filter and column shapes must match the frontend's `Filters` interface and
# the inventory grid's column-key conventions:
#   - `filters.types` is the array the inventory page filters on (the
#     `card_type` column on the bookmark itself is a one-of-many hint used
#     when displaying the bookmark; it does NOT drive the filter)
#   - core / always-on columns use the `core_` prefix, attribute columns
#     use `attr_`, relation columns use `rel_`. Bare keys (e.g. `name`,
#     `businessCriticality`) silently fail to match anything, which was
#     the previous bug — bookmarks loaded but showed neither the right
#     filter nor the right columns.
# ---------------------------------------------------------------------------
BOOKMARK_DEFS: list[dict] = [
    {
        "name": "All Applications",
        "card_type": "Application",
        "filters": {
            "types": ["Application"],
            "search": "",
            "subtypes": [],
            "lifecyclePhases": [],
            "dataQualityMin": None,
            "approvalStatuses": [],
            "showArchived": False,
            "attributes": {},
            "relations": {},
            "tagIds": [],
        },
        "columns": [
            "core_type",
            "core_name",
            "core_path",
            "core_subtype",
            "core_lifecycle",
            "attr_businessCriticality",
            "attr_technicalSuitability",
            "attr_costTotalAnnual",
            "attr_productName",
        ],
        "sort": {"field": "name", "direction": "asc"},
        "visibility": "public",
    },
    {
        "name": "Active Initiatives",
        "card_type": "Initiative",
        "filters": {
            "types": ["Initiative"],
            "search": "",
            "subtypes": [],
            "lifecyclePhases": ["active"],
            "dataQualityMin": None,
            "approvalStatuses": [],
            "showArchived": False,
            "attributes": {},
            "relations": {},
            "tagIds": [],
        },
        "columns": [
            "core_type",
            "core_name",
            "core_path",
            "core_subtype",
            "core_lifecycle",
            "attr_initiativeStatus",
            "attr_businessValue",
            "attr_effort",
            "attr_costBudget",
            "attr_costActual",
            "attr_startDate",
            "attr_endDate",
        ],
        "sort": {"field": "name", "direction": "asc"},
        "visibility": "public",
    },
    {
        "name": "IT Components by Category",
        "card_type": "ITComponent",
        "filters": {
            "types": ["ITComponent"],
            "search": "",
            "subtypes": [],
            "lifecyclePhases": [],
            "dataQualityMin": None,
            "approvalStatuses": [],
            "showArchived": False,
            "attributes": {},
            "relations": {},
            "tagIds": [],
        },
        "columns": [
            "core_type",
            "core_name",
            "core_path",
            "core_subtype",
            "core_lifecycle",
            "attr_version",
            "attr_technicalSuitability",
            "attr_resourceClassification",
            "attr_licenseType",
            "attr_costTotalAnnual",
        ],
        "sort": {"field": "subtype", "direction": "asc"},
        "visibility": "public",
    },
]


# ---------------------------------------------------------------------------
# Diagram XML builders
# ---------------------------------------------------------------------------


def _make_cell(
    cell_id: str,
    label: str,
    card_id: str,
    card_type: str,
    x: int,
    y: int,
    w: int = 180,
    h: int = 60,
    color: str = "#0f7eb5",
) -> str:
    """Build a single mxGraph vertex cell with a card user-object."""
    stroke = color  # simplified; DrawIO will render fine
    style = (
        f"rounded=1;whiteSpace=wrap;html=1;fillColor={color};"
        f"fontColor=#ffffff;strokeColor={stroke};fontSize=12;"
        f"fontStyle=1;arcSize=12;shadow=1"
    )
    return (
        f'<object label="{label}" cardId="{card_id}" cardType="{card_type}">'
        f'<mxCell id="{cell_id}" vertex="1" parent="1" '
        f'style="{style}">'
        f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
        f"</mxCell></object>"
    )


def _make_edge(
    edge_id: str,
    source_id: str,
    target_id: str,
    label: str = "",
) -> str:
    """Build an mxGraph edge between two cells."""
    style = (
        "edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#666666;fontColor=#333333;fontSize=10"
    )
    label_attr = f' value="{label}"' if label else ' value=""'
    return (
        f'<mxCell id="{edge_id}"{label_attr} edge="1" parent="1" '
        f'source="{source_id}" target="{target_id}" style="{style}">'
        f'<mxGeometry relative="1" as="geometry"/>'
        f"</mxCell>"
    )


def _wrap_xml(cells: str) -> str:
    return (
        "<mxGraphModel><root>"
        '<mxCell id="0"/><mxCell id="1" parent="0"/>'
        f"{cells}"
        "</root></mxGraphModel>"
    )


# Diagram definitions will be built at seed time when card UUIDs are known
DIAGRAM_DEFS: list[dict] = [
    {
        "name": "Application Landscape Overview",
        "description": (
            "High-level view of key business applications across "
            "ERP, CRM, IoT, and analytics domains."
        ),
        "card_refs": [
            (CARD_SAP_S4, "Application", "#0f7eb5", 40, 40),
            (CARD_SF_SALES, "Application", "#0f7eb5", 260, 40),
            (CARD_NEXACLOUD, "Application", "#0f7eb5", 480, 40),
            (CARD_SAP_ARIBA, "Application", "#0f7eb5", 40, 140),
            (CARD_POWERBI, "Application", "#0f7eb5", 260, 140),
            (CARD_AZURE_IOT, "Application", "#0f7eb5", 480, 140),
            (CARD_KAFKA, "Application", "#0f7eb5", 40, 240),
            (CARD_TEAMS, "Application", "#0f7eb5", 260, 240),
        ],
        "edges": [
            ("e1", 2, 0, "orders"),  # SF -> SAP
            ("e2", 4, 3, "feeds"),  # IoT Hub -> Kafka
            ("e3", 5, 6, "telemetry"),  # Kafka -> Ariba
        ],
    },
    {
        "name": "Integration Architecture",
        "description": ("Key system interfaces showing data flows between core applications."),
        "card_refs": [
            (CARD_SAP_S4, "Application", "#0f7eb5", 260, 40),
            (CARD_SF_SALES, "Application", "#0f7eb5", 40, 160),
            (CARD_NEXACLOUD, "Application", "#0f7eb5", 480, 160),
            (CARD_KAFKA, "Application", "#0f7eb5", 260, 280),
            (CARD_SAP_ARIBA, "Application", "#0f7eb5", 480, 280),
            (CARD_AZURE_IOT, "Application", "#0f7eb5", 480, 40),
        ],
        "edges": [
            ("e1", 0, 1, "SAP \u2194 SF"),
            ("e2", 2, 3, "events"),
            ("e3", 3, 4, "analytics"),
            ("e4", 5, 2, "telemetry"),
        ],
    },
    {
        "name": "Cloud Infrastructure",
        "description": (
            "Cloud infrastructure components powering the NexaTech "
            "platform including Kubernetes, databases, and caching."
        ),
        "card_refs": [
            (CARD_ITC_AKS, "ITComponent", "#d29270", 40, 40),
            (CARD_ITC_POSTGRES, "ITComponent", "#d29270", 260, 40),
            (CARD_ITC_REDIS, "ITComponent", "#d29270", 480, 40),
            (CARD_ITC_NGINX, "ITComponent", "#d29270", 40, 140),
            (CARD_ITC_AZURE_MONITOR, "ITComponent", "#d29270", 260, 140),
            (CARD_ITC_AZURE_SQL, "ITComponent", "#d29270", 480, 140),
        ],
        "edges": [
            ("e1", 3, 0, "ingress"),
            ("e2", 0, 1, "data"),
            ("e3", 0, 2, "cache"),
        ],
    },
]


# ---------------------------------------------------------------------------
# History event definitions
# ---------------------------------------------------------------------------


def _build_events(
    name_to_id: dict[str, uuid.UUID],
    admin_id: uuid.UUID,
) -> list[dict]:
    """Build event records for realistic card history."""
    events: list[dict] = []

    # card.created events for major cards (backdated)
    created_cards: list[tuple[str, str, int]] = [
        (CARD_SAP_S4, "Application", -90),
        (CARD_SF_SALES, "Application", -85),
        (CARD_NEXACLOUD, "Application", -80),
        (CARD_KAFKA, "Application", -75),
        (CARD_SAP_ARIBA, "Application", -70),
        (CARD_AZURE_IOT, "Application", -65),
        (CARD_POWERBI, "Application", -60),
        (CARD_GRAFANA, "Application", -55),
        (CARD_INIT_DTP, "Initiative", -88),
        (CARD_INIT_SAP, "Initiative", -82),
        (CARD_INIT_IOT, "Initiative", -78),
        (CARD_INIT_SF, "Initiative", -72),
        (CARD_INIT_CYBER, "Initiative", -68),
        (CARD_INIT_DEVOPS, "Initiative", -62),
        (CARD_ORG_NEXATECH, "Organization", -95),
    ]

    for card_name, card_type, days in created_cards:
        card_id = name_to_id.get(card_name)
        if not card_id:
            continue
        events.append(
            {
                "card_id": card_id,
                "user_id": admin_id,
                "event_type": "card.created",
                "data": {
                    "id": str(card_id),
                    "type": card_type,
                    "name": card_name,
                },
                "created_at": _ts(days, 9),
            }
        )

    # card.updated events
    updates: list[tuple[str, dict, int]] = [
        (
            CARD_SAP_S4,
            {
                "changes": {"lifecycle.phase": ["Plan", "PhaseIn"]},
            },
            -45,
        ),
        (
            CARD_SAP_S4,
            {
                "changes": {"costTotalAnnual": [1000000, 1200000]},
            },
            -30,
        ),
        (
            CARD_SF_SALES,
            {
                "changes": {"numberOfUsers": [200, 350]},
            },
            -40,
        ),
        (
            CARD_SF_SALES,
            {
                "changes": {"businessCriticality": ["businessOperational", "businessCritical"]},
            },
            -20,
        ),
        (
            CARD_NEXACLOUD,
            {
                "changes": {"description": ["...", "(updated with edge computing details)"]},
            },
            -35,
        ),
        (
            CARD_KAFKA,
            {
                "changes": {"numberOfUsers": [None, 45]},
            },
            -25,
        ),
        (
            CARD_SAP_ARIBA,
            {
                "changes": {"numberOfUsers": [100, 120]},
            },
            -22,
        ),
        (
            CARD_INIT_DTP,
            {
                "changes": {"status": ["DRAFT", "ACTIVE"]},
            },
            -50,
        ),
        (
            CARD_INIT_SAP,
            {
                "changes": {"priority": ["medium", "high"]},
            },
            -38,
        ),
        (
            CARD_INIT_IOT,
            {
                "changes": {"costBudget": [1500000, 1800000]},
            },
            -28,
        ),
        (
            CARD_INIT_CYBER,
            {
                "changes": {"approval_status": ["PENDING", "APPROVED"]},
            },
            -15,
        ),
        (
            CARD_ORG_NEXATECH,
            {
                "changes": {"description": ["...", "(updated with 2026 org chart)"]},
            },
            -10,
        ),
    ]

    for card_name, data, days in updates:
        card_id = name_to_id.get(card_name)
        if not card_id:
            continue
        events.append(
            {
                "card_id": card_id,
                "user_id": admin_id,
                "event_type": "card.updated",
                "data": data,
                "created_at": _ts(days, 14),
            }
        )

    # relation.created events
    relation_events: list[tuple[str, str, int]] = [
        (CARD_SAP_S4, CARD_KAFKA, -42),
        (CARD_SF_SALES, CARD_SAP_S4, -36),
        (CARD_AZURE_IOT, CARD_KAFKA, -33),
        (CARD_KAFKA, CARD_SAP_ARIBA, -29),
        (CARD_NEXACLOUD, CARD_AZURE_IOT, -26),
    ]

    for src_name, tgt_name, days in relation_events:
        src_id = name_to_id.get(src_name)
        tgt_id = name_to_id.get(tgt_name)
        if not src_id or not tgt_id:
            continue
        events.append(
            {
                "card_id": src_id,
                "user_id": admin_id,
                "event_type": "relation.created",
                "data": {
                    "source_id": str(src_id),
                    "target_id": str(tgt_id),
                    "source_name": src_name,
                    "target_name": tgt_name,
                },
                "created_at": _ts(days, 11),
            }
        )

    return events


# ===================================================================
# Main seed function
# ===================================================================


async def seed_extras_demo_data(db: AsyncSession) -> dict:
    """Seed extra demo data: comments, stakeholders, events, diagrams, etc.

    Idempotent: skips if Comment records already exist.
    Requires: base demo data + admin user already seeded.
    """
    # Check idempotency
    existing = await db.execute(select(Comment.id).limit(1))
    if existing.scalar_one_or_none() is not None:
        return {"skipped": True, "reason": "comments already exist"}

    # Look up admin user
    admin_result = await db.execute(select(User.id).where(User.role == "admin").limit(1))
    admin_id = admin_result.scalar_one_or_none()
    if admin_id is None:
        return {"skipped": True, "reason": "no admin user found"}

    # Build name → (id, type) lookup from existing cards
    card_result = await db.execute(select(Card.id, Card.name, Card.type))
    card_rows = card_result.all()
    name_to_id: dict[str, uuid.UUID] = {r.name: r.id for r in card_rows}

    counts: dict[str, int] = {}

    # ----- Comments -----
    comment_objs: list[Comment] = []
    for card_name, content, days, reply_idx in COMMENT_DEFS:
        card_id = name_to_id.get(card_name)
        if not card_id:
            continue
        parent_id = comment_objs[reply_idx].id if reply_idx is not None else None
        c = Comment(
            id=uuid.uuid4(),
            card_id=card_id,
            user_id=admin_id,
            content=content,
            parent_id=parent_id,
        )
        # Override created_at via column default workaround
        comment_objs.append(c)
        db.add(c)
    await db.flush()

    # Update timestamps after flush (server_default already set, override)
    for i, (_, _, days, _) in enumerate(COMMENT_DEFS):
        if i < len(comment_objs):
            comment_objs[i].created_at = _ts(days, 10)
    await db.flush()
    counts["comments"] = len(comment_objs)

    # ----- Stakeholders -----
    stakeholder_count = 0
    for card_name, role in STAKEHOLDER_ASSIGNMENTS:
        card_id = name_to_id.get(card_name)
        if not card_id:
            continue
        db.add(
            Stakeholder(
                id=uuid.uuid4(),
                card_id=card_id,
                user_id=admin_id,
                role=role,
            )
        )
        stakeholder_count += 1
    await db.flush()
    counts["stakeholders"] = stakeholder_count

    # ----- Events (history) -----
    event_defs = _build_events(name_to_id, admin_id)

    # Also add comment.created events for each comment
    for i, (card_name, content, days, _) in enumerate(COMMENT_DEFS):
        card_id = name_to_id.get(card_name)
        if not card_id or i >= len(comment_objs):
            continue
        event_defs.append(
            {
                "card_id": card_id,
                "user_id": admin_id,
                "event_type": "comment.created",
                "data": {
                    "id": str(comment_objs[i].id),
                    "content": content[:100],
                },
                "created_at": _ts(days, 10),
            }
        )

    for evt in event_defs:
        db.add(
            Event(
                id=uuid.uuid4(),
                card_id=evt["card_id"],
                user_id=evt["user_id"],
                event_type=evt["event_type"],
                data=evt["data"],
                created_at=evt["created_at"],
            )
        )
    await db.flush()
    counts["events"] = len(event_defs)

    # ----- Diagrams -----
    diagram_count = 0
    for diag_def in DIAGRAM_DEFS:
        cells = ""
        cell_ids: list[str] = []
        linked_card_ids: list[uuid.UUID] = []

        for idx, (card_name, card_type, color, x, y) in enumerate(diag_def["card_refs"]):
            card_id = name_to_id.get(card_name)
            if not card_id:
                continue
            cell_id = f"c{idx}"
            cell_ids.append(cell_id)
            linked_card_ids.append(card_id)
            cells += _make_cell(
                cell_id=cell_id,
                label=card_name,
                card_id=str(card_id),
                card_type=card_type,
                x=x,
                y=y,
                color=color,
            )

        # Add edges
        for edge_id, src_idx, tgt_idx, label in diag_def.get("edges", []):
            if src_idx < len(cell_ids) and tgt_idx < len(cell_ids):
                cells += _make_edge(
                    edge_id=edge_id,
                    source_id=cell_ids[src_idx],
                    target_id=cell_ids[tgt_idx],
                    label=label,
                )

        xml = _wrap_xml(cells)
        diag = Diagram(
            id=uuid.uuid4(),
            name=diag_def["name"],
            description=diag_def["description"],
            data={"xml": xml},
            created_by=admin_id,
        )
        db.add(diag)
        await db.flush()

        # Link diagram to cards via M:N table
        for card_id in linked_card_ids:
            await db.execute(
                diagram_cards.insert().values(
                    diagram_id=diag.id,
                    card_id=card_id,
                )
            )
        diagram_count += 1
    await db.flush()
    counts["diagrams"] = diagram_count

    # ----- Saved Reports -----
    for report_def in SAVED_REPORT_DEFS:
        db.add(
            SavedReport(
                id=uuid.uuid4(),
                owner_id=admin_id,
                name=report_def["name"],
                description=report_def.get("description"),
                report_type=report_def["report_type"],
                config=report_def["config"],
                visibility=report_def["visibility"],
            )
        )
    await db.flush()
    counts["saved_reports"] = len(SAVED_REPORT_DEFS)

    # ----- Surveys -----
    survey_objs: list[Survey] = []
    for survey_def in SURVEY_DEFS:
        s = Survey(
            id=uuid.uuid4(),
            name=survey_def["name"],
            description=survey_def["description"],
            message=survey_def["message"],
            status=survey_def["status"],
            target_type_key=survey_def["target_type_key"],
            target_roles=survey_def["target_roles"],
            fields=survey_def["fields"],
            created_by=admin_id,
        )
        if survey_def["status"] == "active":
            s.sent_at = _ts(5, 9)
        survey_objs.append(s)
        db.add(s)
    await db.flush()

    # Survey responses (for the first/active survey only)
    response_count = 0
    if survey_objs:
        active_survey = survey_objs[0]
        for card_name, status, responses in SURVEY_RESPONSE_CARDS:
            card_id = name_to_id.get(card_name)
            if not card_id:
                continue
            sr = SurveyResponse(
                id=uuid.uuid4(),
                survey_id=active_survey.id,
                card_id=card_id,
                user_id=admin_id,
                status=status,
                responses=responses or {},
            )
            if status == "completed":
                sr.responded_at = _ts(12, 15)
            db.add(sr)
            response_count += 1
    await db.flush()
    counts["surveys"] = len(SURVEY_DEFS)
    counts["survey_responses"] = response_count

    # ----- Todos -----
    todo_count = 0
    for todo_def in TODO_DEFS:
        t_card: str | None = todo_def[0]
        description, status, due_offset = todo_def[1], todo_def[2], todo_def[3]
        card_id = name_to_id.get(t_card) if t_card else None
        if t_card and not card_id:
            continue
        due = date.today() + timedelta(days=due_offset) if due_offset else None
        db.add(
            Todo(
                id=uuid.uuid4(),
                card_id=card_id,
                description=description,
                status=status,
                assigned_to=admin_id,
                created_by=admin_id,
                due_date=due,
            )
        )
        todo_count += 1
    await db.flush()
    counts["todos"] = todo_count

    # ----- Documents (URL attachments) -----
    doc_count = 0
    for card_name, doc_name, url in DOCUMENT_DEFS:
        card_id = name_to_id.get(card_name)
        if not card_id:
            continue
        db.add(
            Document(
                id=uuid.uuid4(),
                card_id=card_id,
                name=doc_name,
                url=url,
                type="link",
                created_by=admin_id,
            )
        )
        doc_count += 1
    await db.flush()
    counts["documents"] = doc_count

    # ----- Bookmarks -----
    bookmark_count = 0
    for bm_def in BOOKMARK_DEFS:
        db.add(
            Bookmark(
                id=uuid.uuid4(),
                user_id=admin_id,
                name=bm_def["name"],
                card_type=bm_def.get("card_type"),
                filters=bm_def.get("filters", {}),
                columns=bm_def.get("columns", []),
                sort=bm_def.get("sort", {}),
                visibility=bm_def.get("visibility", "private"),
            )
        )
        bookmark_count += 1
    await db.flush()
    counts["bookmarks"] = bookmark_count

    # ----- EA Principles (first 5 from the catalogue) -----
    # Leaves PR-006..PR-010 catalogue-only so the user can test the import flow.
    principle_count = 0
    existing_principles = await db.execute(select(EAPrinciple.id).limit(1))
    if existing_principles.scalar_one_or_none() is None:
        for idx, cat_id in enumerate(("PR-001", "PR-002", "PR-003", "PR-004", "PR-005")):
            entry = get_catalogue_principle(cat_id)
            if entry is None:
                continue
            db.add(
                EAPrinciple(
                    id=uuid.uuid4(),
                    title=entry["title"],
                    description=entry.get("description"),
                    rationale=entry.get("rationale"),
                    implications=entry.get("implications"),
                    is_active=True,
                    sort_order=(idx + 1) * 10,
                    catalogue_id=cat_id,
                )
            )
            principle_count += 1
        await db.flush()
    counts["principles"] = principle_count

    await db.commit()
    return counts
