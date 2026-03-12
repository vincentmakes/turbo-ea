"""PPM (Project Portfolio Management) demo data for NexaTech Industries.

Layers on top of the base NexaTech demo dataset created by seed_demo.py.
Populates status reports, WBS items, tasks, budget/cost lines, and risks
for existing Initiative cards.

Can be triggered:
  1. Automatically via SEED_DEMO=true  (full demo experience)
  2. Incrementally via SEED_PPM=true on an existing instance that already has
     Initiative cards from seed_demo.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_risk import PpmRisk
from app.models.ppm_status_report import PpmStatusReport
from app.models.ppm_task import PpmTask
from app.models.ppm_wbs import PpmWbs
from app.models.user import User

# ===================================================================
# INITIATIVE NAME CONSTANTS (must match seed_demo.py card names)
# ===================================================================
INIT_SAP = "SAP S/4HANA Migration"
INIT_IOT = "IoT Platform Modernization"
INIT_SF = "Salesforce CRM Implementation"
INIT_CYBER = "Cybersecurity Enhancement"
INIT_DW = "Data Warehouse Consolidation"
INIT_DEVOPS = "DevOps Pipeline Modernization"

# Exported for test validation
REFERENCED_INITIATIVE_NAMES: list[str] = [
    INIT_SAP,
    INIT_IOT,
    INIT_SF,
    INIT_CYBER,
    INIT_DW,
    INIT_DEVOPS,
]


# ===================================================================
# STATUS REPORTS
# ===================================================================
def _status_reports(ids: dict[str, uuid.UUID], reporter: uuid.UUID) -> list[dict]:
    """Build status report dicts. Each is (init_name, fields_dict)."""
    _i = ids
    return [
        # --- SAP S/4HANA Migration: healthy project, 4 monthly reports ---
        dict(
            initiative_id=_i[INIT_SAP],
            reporter_id=reporter,
            report_date=date(2025, 12, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="Data migration streams running in parallel. 62% of custom objects mapped.",
            accomplishments="Completed fit-gap analysis for MM and SD modules.",
            next_steps="Begin integration testing with MES layer.",
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            reporter_id=reporter,
            report_date=date(2026, 1, 5),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="Integration testing underway. 78% data objects migrated to sandbox.",
            accomplishments="MES integration prototype validated. Change management workshops held.",
            next_steps="Start UAT planning and cutover runbook.",
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            reporter_id=reporter,
            report_date=date(2026, 2, 3),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="UAT phase 1 kicked off with 45 business testers. 12 defects logged, 8 resolved.",
            accomplishments="Completed data migration dry-run #2 with <4h downtime window.",
            next_steps="Execute UAT phase 2 and begin hypercare staffing.",
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            reporter_id=reporter,
            report_date=date(2026, 3, 3),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="UAT phase 2 in progress. Go-live rehearsal scheduled for April.",
            accomplishments="All critical defects resolved. Training materials finalized.",
            next_steps="Final cutover rehearsal and go/no-go decision.",
        ),
        # --- IoT Platform Modernization: troubled project ---
        dict(
            initiative_id=_i[INIT_IOT],
            reporter_id=reporter,
            report_date=date(2025, 12, 15),
            schedule_health="onTrack",
            cost_health="atRisk",
            scope_health="onTrack",
            summary="Kafka cluster provisioned. Event schema registry design complete.",
            accomplishments="Migrated 3 of 12 device telemetry streams to new pipeline.",
            next_steps="Migrate remaining high-volume streams and load test.",
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            reporter_id=reporter,
            report_date=date(2026, 1, 15),
            schedule_health="atRisk",
            cost_health="offTrack",
            scope_health="onTrack",
            summary=(
                "AKS cluster sizing underestimated. Need additional node pools "
                "for edge-processing workloads. Budget impact ~120K."
            ),
            accomplishments="Migrated 7 of 12 telemetry streams. Real-time dashboard prototype live.",
            next_steps="Submit change request for additional cloud budget. Prioritize remaining streams.",
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            reporter_id=reporter,
            report_date=date(2026, 2, 15),
            schedule_health="atRisk",
            cost_health="offTrack",
            scope_health="atRisk",
            summary=(
                "Key engineer on leave. Kafka consumer lag spikes during peak hours "
                "require architecture rework. Scope may need to defer 2 low-priority streams."
            ),
            accomplishments="AKS scale-up approved. 9 of 12 streams migrated.",
            next_steps="Hire contractor for Kafka optimization. Re-baseline schedule.",
        ),
        # --- Salesforce CRM Implementation: smooth mid-project ---
        dict(
            initiative_id=_i[INIT_SF],
            reporter_id=reporter,
            report_date=date(2025, 11, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="Sales Cloud configuration 80% complete. CPQ rules defined.",
            accomplishments="Completed lead-to-opportunity flow design with sales ops.",
            next_steps="Begin Service Cloud configuration and knowledge base migration.",
        ),
        dict(
            initiative_id=_i[INIT_SF],
            reporter_id=reporter,
            report_date=date(2026, 1, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="atRisk",
            summary=(
                "Service Cloud go-live on track. Minor scope concern: "
                "field service module may need additional sprints."
            ),
            accomplishments="Sales Cloud UAT passed. Data migration from legacy CRM validated.",
            next_steps="Finalize field service scope decision. Begin end-user training.",
        ),
        dict(
            initiative_id=_i[INIT_SF],
            reporter_id=reporter,
            report_date=date(2026, 2, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="Field service deferred to phase 2. Core CRM rollout on schedule for March.",
            accomplishments="250 users trained. Single sign-on integration tested.",
            next_steps="Production cutover and hypercare support.",
        ),
        # --- Cybersecurity Enhancement: on track ---
        dict(
            initiative_id=_i[INIT_CYBER],
            reporter_id=reporter,
            report_date=date(2025, 12, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="SIEM migration to Sentinel complete. MFA rollout at 60% of workforce.",
            accomplishments="Deployed Sentinel with 15 custom detection rules. Vulnerability scanner operational.",
            next_steps="Complete MFA rollout to remaining sites. Begin penetration testing.",
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            reporter_id=reporter,
            report_date=date(2026, 2, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="MFA rollout 95% complete. Pen test scheduled for March.",
            accomplishments="Reduced mean time to detect from 48h to 4h. SOC playbooks updated.",
            next_steps="Execute penetration test. Remediate findings. Plan phase 2 (XDR).",
        ),
        # --- Data Warehouse Consolidation: early stage ---
        dict(
            initiative_id=_i[INIT_DW],
            reporter_id=reporter,
            report_date=date(2026, 2, 15),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="Snowflake account provisioned. Source system inventory complete (14 sources).",
            accomplishments="Data catalog assessment finished. Priority data domains identified.",
            next_steps="Build ELT pipelines for top 5 source systems.",
        ),
        # --- DevOps Pipeline Modernization: small, efficient ---
        dict(
            initiative_id=_i[INIT_DEVOPS],
            reporter_id=reporter,
            report_date=date(2025, 12, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="GitHub Enterprise provisioned. 8 of 24 repos migrated from Bitbucket.",
            accomplishments="GitHub Actions CI templates created for Java, Python, and Node.js.",
            next_steps="Migrate remaining repos and implement GitOps for Kubernetes deployments.",
        ),
        dict(
            initiative_id=_i[INIT_DEVOPS],
            reporter_id=reporter,
            report_date=date(2026, 2, 1),
            schedule_health="onTrack",
            cost_health="onTrack",
            scope_health="onTrack",
            summary="20 of 24 repos migrated. ArgoCD GitOps pipeline operational for 3 services.",
            accomplishments="Terraform modules published for standard infra. Jenkins sunset plan approved.",
            next_steps="Complete final repo migrations and decommission Jenkins.",
        ),
    ]


# ===================================================================
# WBS (Work Breakdown Structure)
# ===================================================================
def _wbs_items(ids: dict[str, uuid.UUID]) -> list[PpmWbs]:
    """Create WBS items. Returns model instances (parents first for FK ordering)."""
    _i = ids
    items: list[PpmWbs] = []

    def _w(
        init: str,
        title: str,
        *,
        sort: int = 0,
        start: str | None = None,
        end: str | None = None,
        completion: float = 0,
        milestone: bool = False,
        parent: PpmWbs | None = None,
    ) -> PpmWbs:
        w = PpmWbs(
            initiative_id=_i[init],
            parent_id=parent.id if parent else None,
            title=title,
            sort_order=sort,
            start_date=date.fromisoformat(start) if start else None,
            end_date=date.fromisoformat(end) if end else None,
            completion=completion,
            is_milestone=milestone,
        )
        items.append(w)
        return w

    # --- SAP S/4HANA Migration ---
    sap1 = _w(
        INIT_SAP,
        "Discovery & Planning",
        sort=1,
        start="2023-01-15",
        end="2023-09-30",
        completion=100,
    )
    _w(
        INIT_SAP,
        "Go/No-Go Decision",
        sort=2,
        start="2023-09-30",
        end="2023-09-30",
        completion=100,
        milestone=True,
        parent=sap1,
    )
    sap2 = _w(
        INIT_SAP, "Data Migration", sort=3, start="2023-10-01", end="2025-12-31", completion=85
    )
    _w(INIT_SAP, "Custom object mapping", sort=1, completion=90, parent=sap2)
    _w(INIT_SAP, "Data cleansing & validation", sort=2, completion=80, parent=sap2)
    _w(
        INIT_SAP,
        "Integration & Testing",
        sort=4,
        start="2025-06-01",
        end="2026-04-30",
        completion=45,
    )
    _w(
        INIT_SAP,
        "User Training & Change Mgmt",
        sort=5,
        start="2025-09-01",
        end="2026-05-31",
        completion=30,
    )
    _w(INIT_SAP, "Go-Live & Hypercare", sort=6, start="2026-05-01", end="2026-06-30", completion=0)
    _w(INIT_SAP, "Go-Live", sort=7, start="2026-06-01", end="2026-06-01", milestone=True)

    # --- IoT Platform Modernization ---
    _w(
        INIT_IOT,
        "Architecture Design",
        sort=1,
        start="2024-03-01",
        end="2024-08-31",
        completion=100,
    )
    _w(
        INIT_IOT,
        "Infrastructure Provisioning",
        sort=2,
        start="2024-09-01",
        end="2025-03-31",
        completion=100,
    )
    iot3 = _w(
        INIT_IOT, "Stream Migration", sort=3, start="2025-04-01", end="2026-06-30", completion=75
    )
    _w(INIT_IOT, "High-volume streams (1-6)", sort=1, completion=100, parent=iot3)
    _w(INIT_IOT, "Medium-volume streams (7-9)", sort=2, completion=85, parent=iot3)
    _w(INIT_IOT, "Low-volume streams (10-12)", sort=3, completion=0, parent=iot3)
    _w(
        INIT_IOT,
        "Performance Tuning & Hardening",
        sort=4,
        start="2026-03-01",
        end="2026-12-31",
        completion=10,
    )

    # --- Salesforce CRM Implementation ---
    _w(
        INIT_SF,
        "Requirements & Design",
        sort=1,
        start="2024-01-01",
        end="2024-06-30",
        completion=100,
    )
    _w(
        INIT_SF,
        "Sales Cloud Configuration",
        sort=2,
        start="2024-07-01",
        end="2025-06-30",
        completion=100,
    )
    _w(
        INIT_SF,
        "Service Cloud Configuration",
        sort=3,
        start="2025-03-01",
        end="2025-12-31",
        completion=90,
    )
    _w(
        INIT_SF,
        "Data Migration & Integration",
        sort=4,
        start="2025-06-01",
        end="2026-01-31",
        completion=80,
    )
    _w(INIT_SF, "Training & Go-Live", sort=5, start="2025-12-01", end="2026-03-31", completion=60)
    _w(INIT_SF, "CRM Go-Live", sort=6, start="2026-03-15", end="2026-03-15", milestone=True)

    # --- Cybersecurity Enhancement ---
    _w(INIT_CYBER, "SIEM Deployment", sort=1, start="2024-06-01", end="2025-06-30", completion=100)
    _w(INIT_CYBER, "MFA Rollout", sort=2, start="2025-01-01", end="2026-03-31", completion=95)
    _w(
        INIT_CYBER,
        "Vulnerability Management",
        sort=3,
        start="2025-06-01",
        end="2026-06-30",
        completion=60,
    )

    # --- Data Warehouse Consolidation ---
    _w(
        INIT_DW,
        "Assessment & Planning",
        sort=1,
        start="2025-01-01",
        end="2025-06-30",
        completion=100,
    )
    _w(
        INIT_DW,
        "ELT Pipeline Development",
        sort=2,
        start="2025-07-01",
        end="2026-06-30",
        completion=15,
    )
    _w(
        INIT_DW,
        "Dashboard & Reporting Layer",
        sort=3,
        start="2026-03-01",
        end="2026-12-31",
        completion=0,
    )

    # --- DevOps Pipeline Modernization ---
    _w(
        INIT_DEVOPS,
        "GitHub Enterprise Setup",
        sort=1,
        start="2025-01-01",
        end="2025-04-30",
        completion=100,
    )
    _w(INIT_DEVOPS, "Repo Migration", sort=2, start="2025-03-01", end="2026-03-31", completion=83)
    _w(
        INIT_DEVOPS,
        "GitOps & IaC Rollout",
        sort=3,
        start="2025-06-01",
        end="2026-06-30",
        completion=40,
    )

    return items


# ===================================================================
# TASKS
# ===================================================================
def _tasks(
    ids: dict[str, uuid.UUID],
    wbs_lookup: dict[tuple[str, str], uuid.UUID],
    assignee: uuid.UUID,
) -> list[dict]:
    """Build task dicts for each initiative."""
    _i = ids

    def _wbs_id(init: str, wbs_title: str) -> uuid.UUID | None:
        return wbs_lookup.get((init, wbs_title))

    return [
        # --- SAP S/4HANA Migration ---
        dict(
            initiative_id=_i[INIT_SAP],
            title="Complete remaining custom object mappings",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=1,
            due_date=date(2026, 3, 31),
            tags=["data-migration"],
            wbs_id=_wbs_id(INIT_SAP, "Data Migration"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Run data migration dry-run #3",
            status="todo",
            priority="high",
            assignee_id=assignee,
            sort_order=2,
            due_date=date(2026, 4, 15),
            tags=["data-migration"],
            wbs_id=_wbs_id(INIT_SAP, "Data Migration"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Execute UAT phase 2 test cases",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=3,
            due_date=date(2026, 3, 28),
            tags=["testing"],
            wbs_id=_wbs_id(INIT_SAP, "Integration & Testing"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Resolve UAT defects (priority 1-2)",
            status="done",
            priority="critical",
            assignee_id=assignee,
            sort_order=4,
            tags=["testing"],
            wbs_id=_wbs_id(INIT_SAP, "Integration & Testing"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Finalize cutover runbook",
            status="in_progress",
            priority="medium",
            assignee_id=assignee,
            sort_order=5,
            due_date=date(2026, 4, 30),
            tags=["go-live"],
            wbs_id=_wbs_id(INIT_SAP, "Go-Live & Hypercare"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Conduct change management workshops (wave 3)",
            status="done",
            priority="medium",
            assignee_id=assignee,
            sort_order=6,
            tags=["change-mgmt"],
            wbs_id=_wbs_id(INIT_SAP, "User Training & Change Mgmt"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Prepare hypercare support roster",
            status="todo",
            priority="low",
            assignee_id=assignee,
            sort_order=7,
            due_date=date(2026, 5, 15),
            tags=["go-live"],
            wbs_id=_wbs_id(INIT_SAP, "Go-Live & Hypercare"),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Train super-users on new MM workflows",
            status="in_progress",
            priority="medium",
            assignee_id=assignee,
            sort_order=8,
            due_date=date(2026, 4, 15),
            tags=["training"],
            wbs_id=_wbs_id(INIT_SAP, "User Training & Change Mgmt"),
        ),
        # --- IoT Platform Modernization ---
        dict(
            initiative_id=_i[INIT_IOT],
            title="Migrate streams 10-12 to Kafka",
            status="todo",
            priority="medium",
            assignee_id=assignee,
            sort_order=1,
            due_date=date(2026, 5, 31),
            tags=["migration"],
            wbs_id=_wbs_id(INIT_IOT, "Stream Migration"),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Resolve Kafka consumer lag spikes",
            status="blocked",
            priority="critical",
            assignee_id=assignee,
            sort_order=2,
            due_date=date(2026, 3, 31),
            tags=["performance"],
            wbs_id=_wbs_id(INIT_IOT, "Performance Tuning & Hardening"),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Scale AKS node pools for edge workloads",
            status="done",
            priority="high",
            assignee_id=assignee,
            sort_order=3,
            tags=["infrastructure"],
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Hire Kafka optimization contractor",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=4,
            due_date=date(2026, 3, 15),
            tags=["staffing"],
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Load test new event pipeline (10K msg/s)",
            status="blocked",
            priority="high",
            assignee_id=assignee,
            sort_order=5,
            due_date=date(2026, 4, 30),
            tags=["testing", "performance"],
            wbs_id=_wbs_id(INIT_IOT, "Performance Tuning & Hardening"),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Update real-time dashboard for new schemas",
            status="in_progress",
            priority="medium",
            assignee_id=assignee,
            sort_order=6,
            due_date=date(2026, 4, 15),
            tags=["dashboard"],
        ),
        # --- Salesforce CRM Implementation ---
        dict(
            initiative_id=_i[INIT_SF],
            title="Configure Service Cloud case routing rules",
            status="done",
            priority="high",
            assignee_id=assignee,
            sort_order=1,
            tags=["service-cloud"],
            wbs_id=_wbs_id(INIT_SF, "Service Cloud Configuration"),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            title="Validate data migration from legacy CRM",
            status="done",
            priority="high",
            assignee_id=assignee,
            sort_order=2,
            tags=["data-migration"],
            wbs_id=_wbs_id(INIT_SF, "Data Migration & Integration"),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            title="Complete SSO integration testing",
            status="done",
            priority="medium",
            assignee_id=assignee,
            sort_order=3,
            tags=["integration"],
            wbs_id=_wbs_id(INIT_SF, "Data Migration & Integration"),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            title="Run end-user training sessions (5 groups)",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=4,
            due_date=date(2026, 3, 10),
            tags=["training"],
            wbs_id=_wbs_id(INIT_SF, "Training & Go-Live"),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            title="Prepare production cutover checklist",
            status="in_progress",
            priority="medium",
            assignee_id=assignee,
            sort_order=5,
            due_date=date(2026, 3, 12),
            tags=["go-live"],
            wbs_id=_wbs_id(INIT_SF, "Training & Go-Live"),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            title="Scope field service module for phase 2",
            status="todo",
            priority="low",
            assignee_id=assignee,
            sort_order=6,
            due_date=date(2026, 4, 30),
            tags=["planning"],
        ),
        # --- Cybersecurity Enhancement ---
        dict(
            initiative_id=_i[INIT_CYBER],
            title="Deploy MFA to remaining 3 office sites",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=1,
            due_date=date(2026, 3, 31),
            tags=["mfa"],
            wbs_id=_wbs_id(INIT_CYBER, "MFA Rollout"),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            title="Schedule and execute penetration test",
            status="todo",
            priority="critical",
            assignee_id=assignee,
            sort_order=2,
            due_date=date(2026, 4, 15),
            tags=["pen-test"],
            wbs_id=_wbs_id(INIT_CYBER, "Vulnerability Management"),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            title="Update SOC playbooks for Sentinel alerts",
            status="done",
            priority="medium",
            assignee_id=assignee,
            sort_order=3,
            tags=["siem"],
            wbs_id=_wbs_id(INIT_CYBER, "SIEM Deployment"),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            title="Remediate critical CVEs from Q4 scan",
            status="done",
            priority="critical",
            assignee_id=assignee,
            sort_order=4,
            tags=["vulnerability"],
            wbs_id=_wbs_id(INIT_CYBER, "Vulnerability Management"),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            title="Evaluate XDR vendors for phase 2",
            status="todo",
            priority="low",
            assignee_id=assignee,
            sort_order=5,
            due_date=date(2026, 6, 30),
            tags=["planning"],
        ),
        # --- Data Warehouse Consolidation ---
        dict(
            initiative_id=_i[INIT_DW],
            title="Build ELT pipeline for ERP (SAP)",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=1,
            due_date=date(2026, 4, 30),
            tags=["elt"],
            wbs_id=_wbs_id(INIT_DW, "ELT Pipeline Development"),
        ),
        dict(
            initiative_id=_i[INIT_DW],
            title="Build ELT pipeline for CRM (Salesforce)",
            status="todo",
            priority="high",
            assignee_id=assignee,
            sort_order=2,
            due_date=date(2026, 5, 31),
            tags=["elt"],
            wbs_id=_wbs_id(INIT_DW, "ELT Pipeline Development"),
        ),
        dict(
            initiative_id=_i[INIT_DW],
            title="Define data quality rules for priority domains",
            status="todo",
            priority="medium",
            assignee_id=assignee,
            sort_order=3,
            due_date=date(2026, 5, 15),
            tags=["data-quality"],
            wbs_id=_wbs_id(INIT_DW, "ELT Pipeline Development"),
        ),
        dict(
            initiative_id=_i[INIT_DW],
            title="Design executive dashboard prototype",
            status="todo",
            priority="low",
            assignee_id=assignee,
            sort_order=4,
            due_date=date(2026, 7, 31),
            tags=["reporting"],
            wbs_id=_wbs_id(INIT_DW, "Dashboard & Reporting Layer"),
        ),
        # --- DevOps Pipeline Modernization ---
        dict(
            initiative_id=_i[INIT_DEVOPS],
            title="Migrate remaining 4 repos from Bitbucket",
            status="in_progress",
            priority="high",
            assignee_id=assignee,
            sort_order=1,
            due_date=date(2026, 3, 31),
            tags=["migration"],
            wbs_id=_wbs_id(INIT_DEVOPS, "Repo Migration"),
        ),
        dict(
            initiative_id=_i[INIT_DEVOPS],
            title="Implement ArgoCD for 5 more microservices",
            status="in_progress",
            priority="medium",
            assignee_id=assignee,
            sort_order=2,
            due_date=date(2026, 5, 31),
            tags=["gitops"],
            wbs_id=_wbs_id(INIT_DEVOPS, "GitOps & IaC Rollout"),
        ),
        dict(
            initiative_id=_i[INIT_DEVOPS],
            title="Publish Terraform modules for databases",
            status="done",
            priority="medium",
            assignee_id=assignee,
            sort_order=3,
            tags=["iac"],
            wbs_id=_wbs_id(INIT_DEVOPS, "GitOps & IaC Rollout"),
        ),
        dict(
            initiative_id=_i[INIT_DEVOPS],
            title="Decommission Jenkins server",
            status="todo",
            priority="low",
            assignee_id=assignee,
            sort_order=4,
            due_date=date(2026, 6, 30),
            tags=["decommission"],
            wbs_id=_wbs_id(INIT_DEVOPS, "Repo Migration"),
        ),
    ]


# ===================================================================
# BUDGET LINES
# ===================================================================
def _budget_lines(ids: dict[str, uuid.UUID]) -> list[dict]:
    _i = ids
    return [
        # SAP (total budget 2.5M)
        dict(initiative_id=_i[INIT_SAP], fiscal_year=2023, category="capex", amount=400000),
        dict(initiative_id=_i[INIT_SAP], fiscal_year=2024, category="capex", amount=600000),
        dict(initiative_id=_i[INIT_SAP], fiscal_year=2025, category="capex", amount=700000),
        dict(initiative_id=_i[INIT_SAP], fiscal_year=2025, category="opex", amount=200000),
        dict(initiative_id=_i[INIT_SAP], fiscal_year=2026, category="capex", amount=400000),
        dict(initiative_id=_i[INIT_SAP], fiscal_year=2026, category="opex", amount=200000),
        # IoT (total budget 1.8M)
        dict(initiative_id=_i[INIT_IOT], fiscal_year=2024, category="capex", amount=300000),
        dict(initiative_id=_i[INIT_IOT], fiscal_year=2025, category="capex", amount=600000),
        dict(initiative_id=_i[INIT_IOT], fiscal_year=2025, category="opex", amount=150000),
        dict(initiative_id=_i[INIT_IOT], fiscal_year=2026, category="capex", amount=500000),
        dict(initiative_id=_i[INIT_IOT], fiscal_year=2026, category="opex", amount=250000),
        # Salesforce (total budget 900K)
        dict(initiative_id=_i[INIT_SF], fiscal_year=2024, category="capex", amount=200000),
        dict(initiative_id=_i[INIT_SF], fiscal_year=2025, category="capex", amount=300000),
        dict(initiative_id=_i[INIT_SF], fiscal_year=2025, category="opex", amount=150000),
        dict(initiative_id=_i[INIT_SF], fiscal_year=2026, category="opex", amount=250000),
        # Cybersecurity (total budget 650K)
        dict(initiative_id=_i[INIT_CYBER], fiscal_year=2025, category="capex", amount=350000),
        dict(initiative_id=_i[INIT_CYBER], fiscal_year=2025, category="opex", amount=100000),
        dict(initiative_id=_i[INIT_CYBER], fiscal_year=2026, category="opex", amount=200000),
        # Data Warehouse (total budget 500K)
        dict(initiative_id=_i[INIT_DW], fiscal_year=2025, category="capex", amount=150000),
        dict(initiative_id=_i[INIT_DW], fiscal_year=2026, category="capex", amount=200000),
        dict(initiative_id=_i[INIT_DW], fiscal_year=2026, category="opex", amount=150000),
        # DevOps (total budget 250K)
        dict(initiative_id=_i[INIT_DEVOPS], fiscal_year=2025, category="capex", amount=100000),
        dict(initiative_id=_i[INIT_DEVOPS], fiscal_year=2025, category="opex", amount=50000),
        dict(initiative_id=_i[INIT_DEVOPS], fiscal_year=2026, category="opex", amount=100000),
    ]


# ===================================================================
# COST LINES (actuals)
# ===================================================================
def _cost_lines(ids: dict[str, uuid.UUID]) -> list[dict]:
    _i = ids
    return [
        # SAP — on budget (actual 1.8M of 2.5M total)
        dict(
            initiative_id=_i[INIT_SAP],
            description="SAP licensing (RISE)",
            category="capex",
            planned=600000,
            actual=580000,
            date=date(2024, 6, 1),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            description="Implementation partner (phase 1)",
            category="capex",
            planned=400000,
            actual=410000,
            date=date(2024, 12, 1),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            description="Data migration tooling",
            category="capex",
            planned=150000,
            actual=145000,
            date=date(2025, 3, 1),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            description="Implementation partner (phase 2)",
            category="capex",
            planned=350000,
            actual=340000,
            date=date(2025, 9, 1),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            description="Change management & training",
            category="opex",
            planned=180000,
            actual=175000,
            date=date(2025, 11, 1),
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            description="UAT environment hosting",
            category="opex",
            planned=50000,
            actual=48000,
            date=date(2026, 1, 1),
        ),
        # IoT — over budget (actual 950K, overspending on infra)
        dict(
            initiative_id=_i[INIT_IOT],
            description="AKS cluster provisioning",
            category="capex",
            planned=200000,
            actual=200000,
            date=date(2024, 9, 1),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            description="Kafka managed service (annual)",
            category="opex",
            planned=120000,
            actual=120000,
            date=date(2025, 1, 1),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            description="Development team (6 months)",
            category="capex",
            planned=300000,
            actual=320000,
            date=date(2025, 6, 1),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            description="AKS scale-up (unplanned)",
            category="capex",
            planned=0,
            actual=120000,
            date=date(2026, 1, 15),
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            description="Contractor for Kafka optimization",
            category="opex",
            planned=0,
            actual=85000,
            date=date(2026, 2, 15),
        ),
        # Salesforce — on budget (actual 450K of 900K)
        dict(
            initiative_id=_i[INIT_SF],
            description="Salesforce licenses (annual)",
            category="opex",
            planned=180000,
            actual=180000,
            date=date(2024, 7, 1),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            description="Implementation partner",
            category="capex",
            planned=200000,
            actual=195000,
            date=date(2025, 1, 1),
        ),
        dict(
            initiative_id=_i[INIT_SF],
            description="Data migration & integration",
            category="capex",
            planned=80000,
            actual=75000,
            date=date(2025, 9, 1),
        ),
        # Cybersecurity — on budget (actual 320K of 650K)
        dict(
            initiative_id=_i[INIT_CYBER],
            description="Microsoft Sentinel licenses",
            category="opex",
            planned=80000,
            actual=80000,
            date=date(2024, 9, 1),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            description="MFA hardware tokens & licenses",
            category="capex",
            planned=120000,
            actual=115000,
            date=date(2025, 3, 1),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            description="Vulnerability scanner (annual)",
            category="opex",
            planned=60000,
            actual=60000,
            date=date(2025, 7, 1),
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            description="Security consulting",
            category="capex",
            planned=80000,
            actual=65000,
            date=date(2025, 11, 1),
        ),
        # Data Warehouse — early spending (actual 180K of 500K)
        dict(
            initiative_id=_i[INIT_DW],
            description="Snowflake credits (initial)",
            category="opex",
            planned=50000,
            actual=45000,
            date=date(2025, 4, 1),
        ),
        dict(
            initiative_id=_i[INIT_DW],
            description="Data engineering contractor",
            category="capex",
            planned=100000,
            actual=95000,
            date=date(2025, 7, 1),
        ),
        dict(
            initiative_id=_i[INIT_DW],
            description="Data catalog tooling",
            category="capex",
            planned=40000,
            actual=40000,
            date=date(2025, 10, 1),
        ),
        # DevOps — on budget (actual 80K of 250K)
        dict(
            initiative_id=_i[INIT_DEVOPS],
            description="GitHub Enterprise licenses",
            category="opex",
            planned=40000,
            actual=40000,
            date=date(2025, 2, 1),
        ),
        dict(
            initiative_id=_i[INIT_DEVOPS],
            description="ArgoCD setup & training",
            category="capex",
            planned=30000,
            actual=28000,
            date=date(2025, 8, 1),
        ),
    ]


# ===================================================================
# RISKS
# ===================================================================
def _risks(ids: dict[str, uuid.UUID], owner: uuid.UUID) -> list[dict]:
    _i = ids
    return [
        # SAP (3 risks)
        dict(
            initiative_id=_i[INIT_SAP],
            title="Data quality issues delay migration",
            description="Legacy data has inconsistencies that require manual cleansing.",
            probability=3,
            impact=4,
            risk_score=12,
            status="mitigated",
            mitigation="Dedicated data steward team assigned. Automated validation rules.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Key SME unavailability during UAT",
            description="Business-critical SMEs may be pulled for BAU operations during UAT.",
            probability=2,
            impact=3,
            risk_score=6,
            status="open",
            mitigation="Backup SMEs identified. UAT schedule shared with business unit heads.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_SAP],
            title="Cutover window insufficient",
            description="Production cutover may exceed the planned weekend window.",
            probability=2,
            impact=5,
            risk_score=10,
            status="open",
            mitigation="Two dry-run cutovers planned. Rollback procedure documented.",
            owner_id=owner,
        ),
        # IoT (4 risks, 1 critical)
        dict(
            initiative_id=_i[INIT_IOT],
            title="Kafka throughput cannot handle peak load",
            description=(
                "Current Kafka configuration shows consumer lag spikes during "
                "peak manufacturing hours (06:00-08:00)."
            ),
            probability=5,
            impact=5,
            risk_score=25,
            status="open",
            mitigation="Engaging Kafka specialist contractor. Evaluating partition rebalancing.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Cloud cost overrun",
            description="AKS and Kafka costs exceeding original estimates by ~120K.",
            probability=5,
            impact=3,
            risk_score=15,
            status="open",
            mitigation="Change request submitted. Evaluating reserved instances for cost savings.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Single point of failure in event pipeline",
            description="Schema registry has no HA configuration.",
            probability=3,
            impact=4,
            risk_score=12,
            status="open",
            mitigation="Plan to deploy schema registry in HA mode during next sprint.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_IOT],
            title="Key engineer departure",
            description="Lead IoT architect on extended leave; knowledge transfer incomplete.",
            probability=4,
            impact=4,
            risk_score=16,
            status="mitigated",
            mitigation="Contractor hired. Documentation sprint completed for critical components.",
            owner_id=owner,
        ),
        # Salesforce (2 risks)
        dict(
            initiative_id=_i[INIT_SF],
            title="User adoption below target",
            description="Sales teams may resist new CRM workflows, reducing adoption rates.",
            probability=3,
            impact=3,
            risk_score=9,
            status="open",
            mitigation="Champions program launched. Gamification of CRM usage metrics.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_SF],
            title="Integration latency with ERP",
            description="Real-time sync between Salesforce and SAP may exceed SLA.",
            probability=2,
            impact=3,
            risk_score=6,
            status="mitigated",
            mitigation="Async integration pattern implemented with retry logic.",
            owner_id=owner,
        ),
        # Cybersecurity (3 risks)
        dict(
            initiative_id=_i[INIT_CYBER],
            title="Pen test reveals critical vulnerability",
            description="Upcoming penetration test may uncover critical findings requiring immediate action.",
            probability=3,
            impact=5,
            risk_score=15,
            status="open",
            mitigation="Incident response team on standby. Emergency patching process defined.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            title="MFA user resistance at remote sites",
            description="Remote manufacturing sites with limited connectivity may resist MFA.",
            probability=3,
            impact=2,
            risk_score=6,
            status="mitigated",
            mitigation="Offline MFA tokens deployed. Site-specific rollout plan created.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_CYBER],
            title="SIEM alert fatigue",
            description="Too many low-priority alerts may cause SOC analysts to miss real threats.",
            probability=3,
            impact=4,
            risk_score=12,
            status="mitigated",
            mitigation="Tuned detection rules. Reduced false positives by 60%.",
            owner_id=owner,
        ),
        # Data Warehouse (2 risks)
        dict(
            initiative_id=_i[INIT_DW],
            title="Source system API instability",
            description="Some legacy source systems have unreliable APIs for data extraction.",
            probability=3,
            impact=3,
            risk_score=9,
            status="open",
            mitigation="Building CDC (change data capture) fallback for unreliable sources.",
            owner_id=owner,
        ),
        dict(
            initiative_id=_i[INIT_DW],
            title="Data governance gaps",
            description="No enterprise data governance framework in place for cross-domain data.",
            probability=2,
            impact=4,
            risk_score=8,
            status="open",
            mitigation="Data steward roles being defined in parallel with pipeline development.",
            owner_id=owner,
        ),
        # DevOps (1 risk)
        dict(
            initiative_id=_i[INIT_DEVOPS],
            title="Jenkins migration breaks legacy pipelines",
            description="Some legacy pipelines use Jenkins-specific plugins with no GitHub Actions equivalent.",
            probability=3,
            impact=3,
            risk_score=9,
            status="open",
            mitigation="Custom GitHub Actions being developed. Jenkins kept running until migration complete.",
            owner_id=owner,
        ),
    ]


# ===================================================================
# SEED FUNCTION
# ===================================================================
async def seed_ppm_demo_data(db: AsyncSession) -> dict:
    """Insert PPM demo data. Safe to run on top of existing base demo data.

    Returns counts dict. Skips if PPM status reports already exist.
    """
    # Check if PPM data already seeded
    result = await db.execute(select(PpmStatusReport.id).limit(1))
    if result.scalar_one_or_none() is not None:
        return {"skipped": True, "reason": "PPM status reports already exist"}

    # Look up existing Initiative cards by name
    init_result = await db.execute(select(Card.id, Card.name).where(Card.type == "Initiative"))
    name_to_id: dict[str, uuid.UUID] = {row.name: row.id for row in init_result.all()}

    # Build filtered lookup — only initiatives we have data for
    ids: dict[str, uuid.UUID] = {}
    for init_name in REFERENCED_INITIATIVE_NAMES:
        init_id = name_to_id.get(init_name)
        if init_id:
            ids[init_name] = init_id

    if not ids:
        return {"skipped": True, "reason": "No matching Initiative cards found"}

    # Look up admin user for FK fields
    admin_result = await db.execute(select(User.id).where(User.role == "admin").limit(1))
    admin_id = admin_result.scalar_one_or_none()
    if not admin_id:
        return {"skipped": True, "reason": "No admin user found"}

    # --- Status Reports ---
    reports = _status_reports(ids, admin_id)
    sr_count = 0
    for r in reports:
        if r["initiative_id"] in ids.values():
            db.add(PpmStatusReport(**r))
            sr_count += 1
    await db.flush()

    # --- WBS Items ---
    wbs_items = _wbs_items(ids)
    wbs_count = 0
    # WBS items are returned as model instances (parents first)
    wbs_lookup: dict[tuple[str, str], uuid.UUID] = {}
    for w in wbs_items:
        if w.initiative_id in ids.values():
            db.add(w)
            wbs_count += 1
    await db.flush()
    # Build lookup for task → WBS linking
    for w in wbs_items:
        # Find initiative name from id
        for init_name, init_id in ids.items():
            if w.initiative_id == init_id:
                wbs_lookup[(init_name, w.title)] = w.id
                break

    # --- Tasks ---
    tasks = _tasks(ids, wbs_lookup, admin_id)
    task_count = 0
    for t in tasks:
        if t["initiative_id"] in ids.values():
            db.add(PpmTask(**t))
            task_count += 1
    await db.flush()

    # --- Budget Lines ---
    budgets = _budget_lines(ids)
    budget_count = 0
    for b in budgets:
        if b["initiative_id"] in ids.values():
            db.add(PpmBudgetLine(**b))
            budget_count += 1
    await db.flush()

    # --- Cost Lines ---
    costs = _cost_lines(ids)
    cost_count = 0
    for c in costs:
        if c["initiative_id"] in ids.values():
            db.add(PpmCostLine(**c))
            cost_count += 1
    await db.flush()

    # --- Risks ---
    risks = _risks(ids, admin_id)
    risk_count = 0
    for r in risks:
        if r["initiative_id"] in ids.values():
            db.add(PpmRisk(**r))
            risk_count += 1
    await db.flush()

    await db.commit()
    return {
        "status_reports": sr_count,
        "wbs_items": wbs_count,
        "tasks": task_count,
        "budget_lines": budget_count,
        "cost_lines": cost_count,
        "risks": risk_count,
    }


# ===================================================================
# CLI entry-point:  python -m app.services.seed_demo_ppm
# ===================================================================
if __name__ == "__main__":
    import asyncio

    from app.database import async_session, engine
    from app.models import Base
    from app.services.seed import seed_metamodel

    async def _main():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_session() as db:
            await seed_metamodel(db)
        async with async_session() as db:
            result = await seed_ppm_demo_data(db)
            print(result)

    asyncio.run(_main())
