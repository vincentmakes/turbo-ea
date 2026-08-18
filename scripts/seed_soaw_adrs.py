#!/usr/bin/env python3
"""One-time script to seed SoAW and ADR demo data on an existing database.

Wipes all existing SoAW and ADR records, then inserts the full demo dataset.
Looks up card UUIDs by name from the database (since _id() generates random
UUIDs per process, they won't match the UUIDs created during initial seeding).

Usage (inside the backend container):

    docker compose exec backend python /app/seed_soaw_adrs.py

To get the script into the container:

    docker compose cp scripts/seed_soaw_adrs.py backend:/app/
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# When running outside the container, add backend/ to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if backend_dir.is_dir():
    sys.path.insert(0, str(backend_dir))

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models.architecture_decision import ArchitectureDecision  # noqa: E402
from app.models.architecture_decision_card import ArchitectureDecisionCard  # noqa: E402
from app.models.card import Card  # noqa: E402
from app.models.soaw import SoAW  # noqa: E402
from app.models.user import User  # noqa: E402

# ---------------------------------------------------------------------------
# Card ref → card name mapping (must match seed_demo.py card names exactly)
# ---------------------------------------------------------------------------
_CARD_REF_TO_NAME: dict[str, str] = {
    "init_digital_program": "Digital Transformation Program",
    "init_sap_migration": "SAP S/4HANA Migration",
    "init_iot_modern": "IoT Platform Modernization",
    "init_cybersec_enhance": "Cybersecurity Enhancement",
    "init_dw_consolidation": "Data Warehouse Consolidation",
    "init_devops": "DevOps Pipeline Modernization",
    "init_zero_trust": "Zero Trust Network Implementation",
    "app_azure_iot": "Azure IoT Hub",
    "app_nexacloud": "NexaCloud IoT Platform",
    "app_kafka": "Apache Kafka",
    "app_sap_s4": "SAP S/4HANA",
    "app_snowflake": "Snowflake",
    "itc_aks": "Azure Kubernetes Service",
}

# ---------------------------------------------------------------------------
# ADR definitions (self-contained — no dependency on _id())
# ---------------------------------------------------------------------------
_ADRS = [
    {
        "reference_number": "ADR-001",
        "title": "Adopt Cloud-First Strategy for All New Applications",
        "status": "signed",
        "context": (
            "<p>NexaTech currently runs 80% of its applications on-premises. "
            "Rising data centre costs, limited scalability, and the need for "
            "global availability require a strategic shift.</p>"
        ),
        "decision": (
            "<p>All new applications will be deployed to cloud platforms (Azure preferred, "
            "AWS as secondary). Existing applications will be migrated based on a "
            "prioritized roadmap during the Digital Transformation Program.</p>"
        ),
        "consequences": (
            "<p>Reduced capital expenditure on hardware. Teams must upskill on cloud "
            "technologies. Vendor lock-in risk must be mitigated through portable "
            "container-based deployments where feasible.</p>"
        ),
        "alternatives_considered": (
            "<p>1. Hybrid approach with selective cloud adoption \u2014 rejected due to "
            "operational complexity.<br>"
            "2. Continue on-premises with hardware refresh \u2014 rejected due to cost "
            "trajectory.</p>"
        ),
        "related_decisions": [],
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "CTO Office",
                "email": "cto@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-09-15T10:00:00Z",
            }
        ],
        "signed_at": datetime(2025, 9, 15, 10, 0, 0, tzinfo=timezone.utc),
        "revision_number": 1,
        "card_names": [
            "Digital Transformation Program",
            "Azure IoT Hub",
            "NexaCloud IoT Platform",
        ],
    },
    {
        "reference_number": "ADR-002",
        "title": "Introduce Centralized API Gateway for All External Integrations",
        "status": "signed",
        "context": (
            "<p>Multiple applications expose APIs directly, leading to inconsistent "
            "authentication, rate limiting, and monitoring. A centralized gateway "
            "would standardize cross-cutting concerns.</p>"
        ),
        "decision": (
            "<p>Deploy an API gateway (Kong or AWS API Gateway) as the single entry "
            "point for all external-facing APIs. Internal service-to-service calls "
            "remain direct via service mesh.</p>"
        ),
        "consequences": (
            "<p>Unified authentication and rate limiting. Additional infrastructure "
            "component to maintain. All teams must register new APIs in the gateway.</p>"
        ),
        "alternatives_considered": (
            "<p>1. Sidecar proxy per service \u2014 rejected as too complex for current "
            "team maturity.<br>"
            "2. No gateway, enforce standards via code reviews \u2014 rejected as "
            "unenforceable at scale.</p>"
        ),
        "related_decisions": ["ADR-001"],
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "Enterprise Architect",
                "email": "ea@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-10-01T14:30:00Z",
            }
        ],
        "signed_at": datetime(2025, 10, 1, 14, 30, 0, tzinfo=timezone.utc),
        "revision_number": 1,
        "card_names": [
            "Digital Transformation Program",
            "Apache Kafka",
        ],
    },
    {
        "reference_number": "ADR-003",
        "title": "Use SAP Integration Suite for S/4HANA Connectivity",
        "status": "draft",
        "context": (
            "<p>The SAP S/4HANA migration requires reliable integration with "
            "surrounding systems (MES, PLM, CRM). Multiple integration patterns "
            "are available.</p>"
        ),
        "decision": (
            "<p>Adopt SAP Integration Suite (formerly CPI) as the primary middleware "
            "for all S/4HANA-connected integrations. Custom point-to-point "
            "integrations are discouraged.</p>"
        ),
        "consequences": (
            "<p>Consistent monitoring and error handling for SAP integrations. "
            "Additional licensing cost for SAP Integration Suite. Non-SAP systems "
            "use the centralized API gateway instead.</p>"
        ),
        "alternatives_considered": (
            "<p>1. MuleSoft \u2014 rejected due to budget constraints.<br>"
            "2. Custom middleware \u2014 rejected due to maintenance overhead.</p>"
        ),
        "related_decisions": ["ADR-001", "ADR-002"],
        "revision_number": 1,
        "card_names": [
            "SAP S/4HANA Migration",
            "SAP S/4HANA",
        ],
    },
    {
        "reference_number": "ADR-004",
        "title": "Adopt Zero Trust Network Architecture",
        "status": "signed",
        "context": (
            "<p>NexaTech's perimeter-based security model is insufficient for the "
            "hybrid cloud environment being built under the Digital Transformation "
            "Program. Remote workforce growth and cloud workloads require "
            "identity-centric access controls rather than network-location trust.</p>"
        ),
        "decision": (
            "<p>Implement a Zero Trust architecture across all environments:</p>"
            "<ul>"
            "<li>All access requires identity verification (Azure Entra ID as IdP)</li>"
            "<li>Micro-segmentation for east-west traffic using network policies</li>"
            "<li>Continuous posture assessment for endpoints and workloads</li>"
            "<li>Least-privilege access enforced via RBAC and just-in-time elevation</li>"
            "</ul>"
        ),
        "consequences": (
            "<p>Stronger security posture across cloud and on-premises. Requires "
            "re-architecture of legacy network ACLs. All teams must adopt identity-based "
            "authentication for service-to-service communication. Short-term productivity "
            "impact during transition.</p>"
        ),
        "alternatives_considered": (
            "<p>1. Enhanced perimeter security (next-gen firewalls only) \u2014 rejected as "
            "insufficient for cloud-native workloads.<br>"
            "2. VPN-only remote access \u2014 rejected due to latency and scalability "
            "limitations.</p>"
        ),
        "related_decisions": ["ADR-001"],
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "CISO Office",
                "email": "ciso@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-11-10T09:00:00Z",
            },
            {
                "user_id": "demo-placeholder",
                "display_name": "Enterprise Architect",
                "email": "ea@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-11-12T14:00:00Z",
            },
        ],
        "signed_at": datetime(2025, 11, 12, 14, 0, 0, tzinfo=timezone.utc),
        "revision_number": 1,
        "card_names": [
            "Zero Trust Network Implementation",
            "Cybersecurity Enhancement",
        ],
    },
    {
        "reference_number": "ADR-005",
        "title": "Standardize on Event-Driven Architecture for Inter-Service Communication",
        "status": "signed",
        "context": (
            "<p>Synchronous REST-based communication between NexaTech applications "
            "causes tight coupling, cascading failures during peak load, and makes "
            "it difficult to add new consumers of business events. The IoT platform "
            "alone generates 50k+ events per minute that must reach multiple "
            "downstream systems.</p>"
        ),
        "decision": (
            "<p>Adopt Apache Kafka as the central event backbone for all "
            "asynchronous inter-service communication. Key principles:</p>"
            "<ul>"
            "<li>Domain events published to well-defined Kafka topics</li>"
            "<li>Schema Registry enforces Avro/JSON Schema compatibility</li>"
            "<li>Synchronous REST remains permitted for query/response patterns</li>"
            "<li>Event catalog maintained in the EA repository</li>"
            "</ul>"
        ),
        "consequences": (
            "<p>Decoupled services with independent scalability. Requires Kafka "
            "operational expertise and a shared schema governance process. Existing "
            "point-to-point integrations must be migrated over 18 months.</p>"
        ),
        "alternatives_considered": (
            "<p>1. RabbitMQ \u2014 rejected due to lack of persistent replay and "
            "limited throughput for IoT volumes.<br>"
            "2. AWS SNS/SQS \u2014 rejected to avoid cloud vendor lock-in for the "
            "messaging backbone.</p>"
        ),
        "related_decisions": ["ADR-001", "ADR-002"],
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "CTO Office",
                "email": "cto@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-10-20T11:00:00Z",
            },
        ],
        "signed_at": datetime(2025, 10, 20, 11, 0, 0, tzinfo=timezone.utc),
        "revision_number": 1,
        "card_names": [
            "Apache Kafka",
            "Digital Transformation Program",
        ],
    },
    {
        "reference_number": "ADR-006",
        "title": "Consolidate Data Warehouse on Cloud-Native Platform",
        "status": "in_review",
        "context": (
            "<p>NexaTech operates three separate data stores for analytics: an "
            "on-premises SQL Server warehouse, a Snowflake instance for marketing, "
            "and ad-hoc data lakes on shared drives. Inconsistent schemas, duplicated "
            "ETL pipelines, and rising licensing costs require consolidation.</p>"
        ),
        "decision": (
            "<p>Consolidate all analytical workloads onto Snowflake as the single "
            "cloud data warehouse platform, implementing a medallion architecture "
            "(bronze/silver/gold layers). Key elements:</p>"
            "<ul>"
            "<li>Bronze: raw ingestion from all source systems via Kafka + CDC</li>"
            "<li>Silver: cleansed and conformed data models</li>"
            "<li>Gold: business-ready aggregates consumed by Power BI</li>"
            "<li>dbt for transformation orchestration and lineage</li>"
            "</ul>"
        ),
        "consequences": (
            "<p>Single source of truth for analytics. Eliminates duplicate ETL "
            "maintenance. Requires migration of existing SQL Server reports "
            "and retraining of analysts on Snowflake SQL dialect.</p>"
        ),
        "alternatives_considered": (
            "<p>1. Azure Synapse Analytics \u2014 rejected due to existing Snowflake "
            "investment and team expertise.<br>"
            "2. Databricks Lakehouse \u2014 rejected as over-engineered for current "
            "analytics maturity level.</p>"
        ),
        "related_decisions": ["ADR-001", "ADR-005"],
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "Data Architecture Lead",
                "email": "data-arch@nexatech.demo",
                "status": "pending",
                "signed_at": None,
            },
            {
                "user_id": "demo-placeholder",
                "display_name": "Enterprise Architect",
                "email": "ea@nexatech.demo",
                "status": "pending",
                "signed_at": None,
            },
        ],
        "signed_at": None,
        "revision_number": 1,
        "card_names": [
            "Data Warehouse Consolidation",
            "Snowflake",
        ],
    },
    {
        "reference_number": "ADR-007",
        "title": "Adopt Container-First Deployment for All New Services",
        "status": "draft",
        "context": (
            "<p>Deployment patterns across NexaTech are inconsistent: some teams "
            "deploy to VMs, others use ad-hoc Docker containers, and legacy systems "
            "run on bare metal. This fragmentation increases operational cost and "
            "slows release cycles.</p>"
        ),
        "decision": (
            "<p>All new services must be containerized and deployed to Azure "
            "Kubernetes Service (AKS). Specific guidelines:</p>"
            "<ul>"
            "<li>Docker images built via CI/CD (GitHub Actions)</li>"
            "<li>Helm charts for all Kubernetes deployments</li>"
            "<li>Existing VM-based services migrated opportunistically</li>"
            "<li>Exceptions require Architecture Review Board approval</li>"
            "</ul>"
        ),
        "consequences": (
            "<p>Consistent deployment model across all teams. Kubernetes operational "
            "skills become mandatory. Legacy VM applications continue running until "
            "natural refresh cycles. Platform team must provide golden-path templates.</p>"
        ),
        "alternatives_considered": (
            "<p>1. Azure App Service (PaaS) \u2014 rejected as too restrictive for "
            "complex multi-container workloads.<br>"
            "2. Serverless-first (Azure Functions) \u2014 rejected as not suitable "
            "for long-running manufacturing backend processes.</p>"
        ),
        "related_decisions": ["ADR-001", "ADR-004"],
        "revision_number": 1,
        "card_names": [
            "DevOps Pipeline Modernization",
            "Azure Kubernetes Service",
        ],
    },
]

# ---------------------------------------------------------------------------
# SoAW section helpers
# ---------------------------------------------------------------------------


def _empty_section(hidden: bool = False) -> dict:
    return {"content": "", "hidden": hidden}


def _rich(content: str, hidden: bool = False) -> dict:
    return {"content": content, "hidden": hidden}


def _table(columns: list[str], rows: list[list[str]], hidden: bool = False) -> dict:
    return {
        "content": "",
        "hidden": hidden,
        "table_data": {"columns": columns, "rows": rows},
    }


def _togaf_phases(phases: dict[str, str], hidden: bool = False) -> dict:
    base = {k: "" for k in ("A", "B", "C", "D", "E", "F", "G", "H", "RM")}
    base.update(phases)
    return {"content": "", "hidden": hidden, "togaf_data": base}


# ---------------------------------------------------------------------------
# SoAW documents (inline — no imports from seed_demo.py)
# ---------------------------------------------------------------------------
_SOAWS = [
    {
        "name": "Digital Transformation Program \u2014 Statement of Architecture Work",
        "initiative_name": "Digital Transformation Program",
        "status": "signed",
        "document_info": {
            "prepared_by": "Enterprise Architecture Team",
            "reviewed_by": "CTO Office",
            "review_date": "2025-08-15",
        },
        "version_history": [
            {
                "version": "1.0",
                "date": "2025-07-01",
                "revised_by": "Enterprise Architecture Team",
                "description": "Initial draft for steering committee review",
            },
            {
                "version": "2.0",
                "date": "2025-08-20",
                "revised_by": "Enterprise Architecture Team",
                "description": "Final version incorporating CTO feedback, approved and signed",
            },
        ],
        "sections": {
            "1.1": _rich(
                "<p>NexaTech Industries has identified the need for a comprehensive digital "
                "transformation to modernize its IT landscape, reduce operational costs, and "
                "enable new digital revenue streams.</p>"
                "<p>This Statement of Architecture Work establishes the architectural vision, "
                "scope, and governance for the Digital Transformation Program spanning "
                "2025-2027.</p>"
            ),
            "1.2": _rich(
                "<p>The scope encompasses the full enterprise IT landscape across four "
                "architecture domains:</p>"
                "<ul>"
                "<li><strong>Business Architecture</strong>: Digitization of core processes</li>"
                "<li><strong>Application Architecture</strong>: "
                "Cloud migration of 40+ applications</li>"
                "<li><strong>Data Architecture</strong>: Unified data platform</li>"
                "<li><strong>Technology Architecture</strong>: Cloud-first infrastructure</li>"
                "</ul>"
            ),
            "2.1": _table(
                ["Objective", "Notes"],
                [
                    [
                        "Migrate 80% of workloads to cloud by end of 2026",
                        "Aligns with ADR-001",
                    ],
                    ["Reduce IT operating costs by 25%", "Baseline measured Q1 2025"],
                    [
                        "Achieve < 2-week release cycle",
                        "Requires DevOps maturity uplift",
                    ],
                    [
                        "Establish single data platform for analytics",
                        "Replaces 3 existing data stores",
                    ],
                ],
            ),
            "2.2": _rich(
                "<p><strong>Assumptions:</strong></p>"
                "<ul><li>Azure Enterprise Agreement remains through 2027</li>"
                "<li>SAP S/4HANA migration aligns with this program</li></ul>"
                "<p><strong>Constraints:</strong></p>"
                "<ul><li>Annual IT budget cap: EUR 8M</li>"
                "<li>Data residency required in EU</li></ul>"
                "<p><strong>Principles:</strong></p>"
                "<ul><li>Cloud-first (ADR-001)</li><li>API-first (ADR-002)</li>"
                "<li>Event-driven (ADR-005)</li><li>Zero Trust (ADR-004)</li></ul>"
            ),
            "2.3": _table(
                ["Stakeholder", "Concern"],
                [
                    ["CTO Office", "Program alignment with business strategy"],
                    ["VP Engineering", "Minimal disruption to manufacturing"],
                    ["CISO", "Security posture during cloud migration"],
                    ["Head of Data & Analytics", "Data availability during transition"],
                ],
            ),
            "3.1": _togaf_phases(
                {
                    "A": "Completed Q2 2025",
                    "B": "Completed Q3 2025",
                    "C": "In progress",
                    "D": "In progress",
                    "E": "Planned Q1 2026",
                    "F": "Planned Q2 2026",
                    "G": "Ongoing",
                    "H": "Planned Q4 2027",
                    "RM": "Continuous",
                }
            ),
            "4.1": _rich(
                "<p>80+ applications, predominantly on-premises. SAP ECC 6.0, "
                "mixed CRM, NexaCloud IoT, ~120 point-to-point interfaces.</p>"
            ),
            "4.2": _rich(
                "<p>Cloud ratio: 20/80. Release cycle: 6-8 weeks. "
                "Annual IT cost: EUR 12.5M. Downtime: 47h/year.</p>"
            ),
            "4.3": _rich(
                "<p>15 apps flagged for retirement. 30% on unsupported OS. "
                "No API gateway. Cloud skills limited to IoT and DevOps teams.</p>"
            ),
            "5.1": _rich(
                "<p>Cloud-native, API-first platform: AKS for containers, "
                "Kong API Gateway, Kafka event backbone, Snowflake warehouse, "
                "Zero Trust with Azure Entra ID.</p>"
            ),
            "5.2": _rich(
                "<p>Target: 90% cloud. Release cycle: &lt; 2 weeks. "
                "Annual cost: EUR 9.4M. Downtime: &lt; 10h/year.</p>"
            ),
            "5.3": _rich(
                "<p>EUR 3.1M annual savings. 4x faster time-to-market. "
                "Single analytics platform. Improved developer experience.</p>"
            ),
            "6.1": _rich(
                "<p>3-year investment: EUR 8M. Expected annual savings: EUR 3.1M "
                "from year 2. Positive ROI within 30 months.</p>"
            ),
            "6.2": _rich(
                "<p>Net reduction of 15 applications. 120 interfaces consolidated "
                "to ~40 API routes + 30 Kafka topics. New Cloud CoE team (6 FTEs).</p>"
            ),
            "6.3": _rich(
                "<p>6-wave migration approach over 18 months (Q1 2026 \u2013 Q3 2027), "
                "starting with lowest-risk IoT and DevOps workloads.</p>"
            ),
            "7.0": _rich("<p>Key risks and open issues from architecture planning.</p>"),
            "7.1": _table(
                ["Risk #", "Description", "Priority", "Status"],
                [
                    [
                        "R-001",
                        "Cloud migration causes manufacturing downtime",
                        "High",
                        "Mitigated",
                    ],
                    ["R-002", "Skills gap delays migration waves", "High", "Open"],
                    [
                        "R-003",
                        "Azure EA renewal terms unfavorable",
                        "Medium",
                        "Monitoring",
                    ],
                ],
            ),
            "7.2": _table(
                ["Description", "Status"],
                [
                    ["SAP S/4HANA timeline dependency not confirmed", "Open"],
                    ["Legacy PLM vendor contract has 18-month exit clause", "Open"],
                ],
            ),
        },
        "revision_number": 1,
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "CTO Office",
                "email": "cto@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-08-20T10:00:00Z",
            },
            {
                "user_id": "demo-placeholder",
                "display_name": "Enterprise Architect",
                "email": "ea@nexatech.demo",
                "status": "signed",
                "signed_at": "2025-08-20T14:30:00Z",
            },
        ],
        "signed_at": datetime(2025, 8, 20, 14, 30, 0, tzinfo=timezone.utc),
    },
    {
        "name": "SAP S/4HANA Migration \u2014 Statement of Architecture Work",
        "initiative_name": "SAP S/4HANA Migration",
        "status": "in_review",
        "document_info": {
            "prepared_by": "SAP Solution Architecture Team",
            "reviewed_by": "",
            "review_date": "",
        },
        "version_history": [
            {
                "version": "1.0",
                "date": "2025-11-01",
                "revised_by": "SAP Solution Architecture Team",
                "description": "Initial draft submitted for architecture review",
            },
        ],
        "sections": {
            "1.1": _rich(
                "<p>NexaTech's SAP ECC 6.0 reaches mainstream maintenance end in 2027. "
                "This SoAW covers the brownfield migration to S/4HANA on Azure.</p>"
            ),
            "1.2": _rich(
                "<p>Scope: brownfield migration, ABAP remediation (170+ programs), "
                "integration re-architecture via SAP Integration Suite, "
                "master data migration.</p>"
            ),
            "2.1": _table(
                ["Objective", "Notes"],
                [
                    [
                        "S/4HANA go-live by Q3 2026",
                        "Aligned with SAP maintenance timeline",
                    ],
                    ["Reduce custom ABAP by 60%", "Adopt SAP standard processes"],
                    ["Zero data loss during migration", "Validated via parallel run"],
                ],
            ),
            "2.2": _rich(
                "<p><strong>Assumptions:</strong> SAP licenses procured. Azure infra from DTP.</p>"
                "<p><strong>Constraints:</strong> No disruption to quarter-end close. "
                "Budget: EUR 2.5M.</p>"
            ),
            "2.3": _table(
                ["Stakeholder", "Concern"],
                [
                    ["CFO", "Financial closing continuity"],
                    ["VP Manufacturing", "Production planning availability"],
                    ["SAP Basis Team", "Technical migration execution"],
                ],
            ),
            "3.1": _togaf_phases(
                {
                    "A": "Completed",
                    "B": "Completed \u2014 fit-to-standard workshops done",
                    "C": "In progress \u2014 interface inventory",
                    "D": "In progress \u2014 Azure hosting architecture",
                    "E": "Planned Q2 2026",
                    "F": "Planned Q2 2026 \u2014 cutover planning",
                }
            ),
            "4.1": _rich("<p>SAP ECC 6.0 EHP8 on Oracle. 170 custom programs, 85 interfaces.</p>"),
            "4.2": _rich("<p>Month-end close: 5 days. MRP run: 4 hours. Availability: 99.5%.</p>"),
            "4.3": _rich("<p>40% custom code unused. Oracle license renewal due Q4 2026.</p>"),
            "5.1": _rich(
                "<p>S/4HANA 2023 on Azure (HANA managed). ~65 custom programs. "
                "SAP Integration Suite. Fiori launchpad.</p>"
            ),
            "5.2": _rich("<p>Month-end close: 3 days. MRP: &lt; 30 min. Availability: 99.9%.</p>"),
            "5.3": _rich(
                "<p>Eliminated Oracle license (EUR 400K/yr). Real-time analytics. "
                "Simplified integration.</p>"
            ),
            "6.1": _rich(
                "<p>Investment: EUR 2.5M. Annual savings: EUR 600K. Payback: 4 years.</p>"
            ),
            "6.2": _rich(
                "<p>ERP modernized. 85 interfaces re-routed through SAP Integration Suite.</p>"
            ),
            "6.3": _rich(
                "<p>Three phases: technical migration (Q1-Q2 2026), "
                "integration + UAT (Q2-Q3 2026), go-live + hypercare (Q3 2026).</p>"
            ),
            "7.0": _empty_section(),
            "7.1": _table(
                ["Risk #", "Description", "Priority", "Status"],
                [
                    [
                        "R-001",
                        "ABAP remediation takes longer than estimated",
                        "High",
                        "Open",
                    ],
                    ["R-002", "Key user availability during UAT", "Medium", "Open"],
                ],
            ),
            "7.2": _table(
                ["Description", "Status"],
                [
                    ["Integration Suite license scope needs confirmation", "Open"],
                ],
            ),
        },
        "revision_number": 1,
        "signatories": [
            {
                "user_id": "demo-placeholder",
                "display_name": "Enterprise Architect",
                "email": "ea@nexatech.demo",
                "status": "pending",
                "signed_at": None,
            },
            {
                "user_id": "demo-placeholder",
                "display_name": "SAP Solution Architect",
                "email": "sap-arch@nexatech.demo",
                "status": "pending",
                "signed_at": None,
            },
        ],
        "signed_at": None,
    },
    {
        "name": "IoT Platform Modernization \u2014 Statement of Architecture Work",
        "initiative_name": "IoT Platform Modernization",
        "status": "draft",
        "document_info": {
            "prepared_by": "IoT Architecture Team",
            "reviewed_by": "",
            "review_date": "",
        },
        "version_history": [
            {
                "version": "0.1",
                "date": "2025-12-01",
                "revised_by": "IoT Architecture Team",
                "description": "Initial draft \u2014 Part I only",
            },
        ],
        "sections": {
            "1.1": _rich(
                "<p>Upgrade NexaCloud IoT platform for next-gen connected products. "
                "Address throughput, edge computing, and predictive analytics needs.</p>"
            ),
            "1.2": _rich(
                "<p>Upgrade Azure IoT Hub (100k+ devices), introduce edge computing, "
                "build ML pipeline, modernize NexaConnect mobile app.</p>"
            ),
            "2.1": _table(
                ["Objective", "Notes"],
                [
                    ["100k concurrent device connections", "Current: 25k"],
                    ["Sub-second anomaly detection at edge", "Reduces cloud egress"],
                    ["Predictive maintenance accuracy > 90%", "ML on 2 years data"],
                ],
            ),
            "2.2": _rich(
                "<p><strong>Assumptions:</strong> IoT Hub premium tier approved. "
                "Historical telemetry available.</p>"
                "<p><strong>Constraints:</strong> Budget EUR 1.8M. "
                "Backward compatibility with NexaSense devices.</p>"
            ),
            "2.3": _table(
                ["Stakeholder", "Concern"],
                [
                    ["VP Product", "Device onboarding speed"],
                    ["IoT Engineering Lead", "Platform scalability"],
                ],
            ),
            "3.1": _togaf_phases(
                {
                    "A": "In progress",
                    "B": "Planned Q1 2026",
                }
            ),
            "4.1": _rich("<p>Azure IoT Hub (standard tier), NexaCloud, NexaConnect, Kafka.</p>"),
            "4.2": _empty_section(),
            "4.3": _empty_section(),
            "5.1": _empty_section(),
            "5.2": _empty_section(),
            "5.3": _empty_section(),
            "6.1": _empty_section(),
            "6.2": _empty_section(),
            "6.3": _empty_section(),
            "7.0": _empty_section(),
            "7.1": _table(["Risk #", "Description", "Priority", "Status"], [["", "", "", ""]]),
            "7.2": _table(["Description", "Status"], [["", ""]]),
        },
        "revision_number": 1,
        "signatories": [],
        "signed_at": None,
    },
]


def _build_database_url() -> str:
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "turboea")
    user = os.getenv("POSTGRES_USER", "turboea")
    password = os.getenv("POSTGRES_PASSWORD", "turboea")
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"


async def seed(db: AsyncSession) -> dict:
    """Wipe existing SoAW + ADR data, then insert demo dataset."""
    # Build name → UUID lookup from existing cards
    result = await db.execute(select(Card.id, Card.name))
    name_to_id: dict[str, uuid.UUID] = {row.name: row.id for row in result.all()}

    # Look up admin user for SoAW created_by
    admin_result = await db.execute(select(User.id).where(User.role == "admin").limit(1))
    admin_id = admin_result.scalar_one_or_none()

    # Delete in FK order
    await db.execute(delete(ArchitectureDecisionCard))
    await db.execute(delete(ArchitectureDecision))
    await db.execute(delete(SoAW))
    await db.flush()
    print("[cleanup] Deleted all existing SoAW and ADR records")

    # Insert ADRs
    adr_id_by_ref: dict[str, uuid.UUID] = {}
    skipped_links = 0
    for adr_def in _ADRS:
        adr_id = uuid.uuid4()
        adr_id_by_ref[adr_def["reference_number"]] = adr_id
        adr_data = {k: v for k, v in adr_def.items() if k != "card_names"}
        adr_data["id"] = adr_id
        db.add(ArchitectureDecision(**adr_data))
    await db.flush()

    # Insert ADR-to-card links
    for adr_def in _ADRS:
        adr_id = adr_id_by_ref[adr_def["reference_number"]]
        for card_name in adr_def.get("card_names", []):
            card_id = name_to_id.get(card_name)
            if card_id:
                db.add(
                    ArchitectureDecisionCard(
                        architecture_decision_id=adr_id,
                        card_id=card_id,
                    )
                )
            else:
                print(f"  [warn] Card '{card_name}' not found, skipping link")
                skipped_links += 1
    await db.flush()

    # Insert SoAW documents
    for soaw_def in _SOAWS:
        init_name = soaw_def.pop("initiative_name", None)
        init_id = name_to_id.get(init_name) if init_name else None
        soaw_data = {k: v for k, v in soaw_def.items()}
        soaw_data["id"] = uuid.uuid4()
        soaw_data["initiative_id"] = init_id
        if admin_id:
            soaw_data["created_by"] = admin_id
        db.add(SoAW(**soaw_data))
    await db.flush()

    await db.commit()

    total_links = sum(len(a.get("card_names", [])) for a in _ADRS)
    return {
        "adrs": len(_ADRS),
        "adr_links": total_links - skipped_links,
        "soaws": len(_SOAWS),
        "skipped_links": skipped_links,
    }


async def main() -> None:
    url = _build_database_url()
    host = os.environ.get("POSTGRES_HOST", "localhost")
    db_name = os.environ.get("POSTGRES_DB", "turboea")
    print(f"[seed_soaw_adrs] Connecting to {host}/{db_name}...")
    engine = create_async_engine(url, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        result = await seed(db)

    await engine.dispose()
    print(
        f"[seed_soaw_adrs] Done: {result['adrs']} ADRs, "
        f"{result['adr_links']} ADR-card links, {result['soaws']} SoAWs"
    )
    if result["skipped_links"]:
        print(f"  [warn] {result['skipped_links']} card links skipped (cards not found)")


if __name__ == "__main__":
    asyncio.run(main())
