"""ArchiMate demo data — NexaTech Industries mapped to ArchiMate 3.2."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

PLUGIN_ID = "archimate"


def _id(ref: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, f"archimate-demo-{ref}")


# ── Demo element cards ─────────────────────────────────────────────────────

ARCHIMATE_DEMO_CARDS: list[dict[str, Any]] = [
    # Business Layer — Active Structure
    {
        "ref": "ba_nexa_group",
        "type_key": "arch_BusinessActor",
        "name": "NexaTech Industries",
        "desc": "Global industrial manufacturing conglomerate — parent organization.",
        "color": "#f5e27a",
    },
    {
        "ref": "ba_operations",
        "type_key": "arch_BusinessActor",
        "name": "Operations Division",
        "desc": "Responsible for manufacturing, supply chain, and logistics.",
        "color": "#f5e27a",
    },
    {
        "ref": "ba_finance",
        "type_key": "arch_BusinessRole",
        "name": "Finance & Controlling",
        "desc": "Business role overseeing financial planning and cost controlling.",
        "color": "#f5e27a",
    },
    {
        "ref": "ba_it_team",
        "type_key": "arch_BusinessRole",
        "name": "IT Architecture Team",
        "desc": "EA governance, platform standards, and technology decisions.",
        "color": "#f5e27a",
    },
    # Business Layer — Behavior
    {
        "ref": "bp_procure_to_pay",
        "type_key": "arch_BusinessProcess",
        "name": "Procure-to-Pay",
        "desc": "End-to-end process from purchase requisition through supplier payment.",
        "color": "#f5e27a",
    },
    {
        "ref": "bp_order_to_cash",
        "type_key": "arch_BusinessProcess",
        "name": "Order-to-Cash",
        "desc": "Customer order management through revenue recognition.",
        "color": "#f5e27a",
    },
    {
        "ref": "bs_erp_service",
        "type_key": "arch_BusinessService",
        "name": "ERP Core Service",
        "desc": "Business service providing integrated ERP capabilities across divisions.",
        "color": "#f5e27a",
    },
    # Business Layer — Passive Structure
    {
        "ref": "bo_supplier_contract",
        "type_key": "arch_Contract",
        "name": "Supplier Framework Contract",
        "desc": "Master contract governing all supplier relationships.",
        "color": "#f5e27a",
    },
    # Application Layer — Active Structure
    {
        "ref": "ac_erp",
        "type_key": "arch_ApplicationComponent",
        "name": "SAP S/4HANA",
        "desc": "Central ERP system for finance, procurement, and production planning.",
        "color": "#b3d9ff",
    },
    {
        "ref": "ac_crm",
        "type_key": "arch_ApplicationComponent",
        "name": "Salesforce CRM",
        "desc": "Customer relationship management and sales process automation.",
        "color": "#b3d9ff",
    },
    {
        "ref": "ac_plm",
        "type_key": "arch_ApplicationComponent",
        "name": "Siemens Teamcenter PLM",
        "desc": "Product lifecycle management for engineering BOM and CAD.",
        "color": "#b3d9ff",
    },
    {
        "ref": "ac_mes",
        "type_key": "arch_ApplicationComponent",
        "name": "Opcenter MES",
        "desc": "Manufacturing execution system for shop-floor orchestration.",
        "color": "#b3d9ff",
    },
    {
        "ref": "ac_iot",
        "type_key": "arch_ApplicationComponent",
        "name": "Azure IoT Hub",
        "desc": "IoT device management and telemetry ingestion platform.",
        "color": "#b3d9ff",
    },
    {
        "ref": "ac_analytics",
        "type_key": "arch_ApplicationComponent",
        "name": "Power BI Analytics",
        "desc": "Business intelligence and reporting platform.",
        "color": "#b3d9ff",
    },
    {
        "ref": "ai_erp_api",
        "type_key": "arch_ApplicationInterface",
        "name": "ERP Integration API",
        "desc": "REST/SOAP API gateway exposing ERP services to external applications.",
        "color": "#b3d9ff",
    },
    # Application Layer — Behavior
    {
        "ref": "as_procurement_svc",
        "type_key": "arch_ApplicationService",
        "name": "Procurement Service",
        "desc": "Application service encapsulating purchasing workflows.",
        "color": "#b3d9ff",
    },
    {
        "ref": "as_analytics_svc",
        "type_key": "arch_ApplicationService",
        "name": "Analytics Service",
        "desc": "Delivers dashboards and KPI reports to business stakeholders.",
        "color": "#b3d9ff",
    },
    # Application Layer — Passive Structure
    {
        "ref": "do_product_data",
        "type_key": "arch_DataObject",
        "name": "Product Master Data",
        "desc": "Canonical product information including BOM, specs, and pricing.",
        "color": "#b3d9ff",
    },
    {
        "ref": "do_financial_data",
        "type_key": "arch_DataObject",
        "name": "Financial Data",
        "desc": "General ledger, cost centers, and financial reporting data.",
        "color": "#b3d9ff",
    },
    # Technology Layer — Active Structure
    {
        "ref": "tn_azure_prod",
        "type_key": "arch_Node",
        "name": "Azure Production Cluster",
        "desc": "AKS-managed Kubernetes cluster hosting core business applications.",
        "color": "#aae6aa",
    },
    {
        "ref": "tn_edge_gateways",
        "type_key": "arch_Device",
        "name": "Factory Edge Gateways",
        "desc": "Industrial IoT edge gateways deployed at manufacturing sites.",
        "color": "#aae6aa",
    },
    {
        "ref": "ts_kafka",
        "type_key": "arch_SystemSoftware",
        "name": "Apache Kafka",
        "desc": "Event streaming platform for real-time data pipeline integration.",
        "color": "#aae6aa",
    },
    {
        "ref": "tc_wan",
        "type_key": "arch_CommunicationNetwork",
        "name": "Global WAN",
        "desc": "MPLS/SD-WAN connecting all NexaTech manufacturing sites.",
        "color": "#aae6aa",
    },
    # Technology Layer — Passive Structure
    {
        "ref": "ta_backup",
        "type_key": "arch_Artifact",
        "name": "Encrypted Backup Archive",
        "desc": "Encrypted daily snapshots of all production databases.",
        "color": "#aae6aa",
    },
    # Motivation Layer
    {
        "ref": "goal_digital_ops",
        "type_key": "arch_Goal",
        "name": "Digital Operations Excellence",
        "desc": "Transform factory operations through data-driven automation and IoT.",
        "color": "#ffcca8",
    },
    {
        "ref": "driver_cost",
        "type_key": "arch_Driver",
        "name": "Cost Reduction Pressure",
        "desc": "Competitive pressure to reduce operational costs by 15% in 3 years.",
        "color": "#ffcca8",
    },
    {
        "ref": "req_integration",
        "type_key": "arch_Requirement",
        "name": "Real-time ERP–MES Integration",
        "desc": "All shop-floor events must be reflected in ERP within 30 seconds.",
        "color": "#ffcca8",
    },
    # Strategy Layer
    {
        "ref": "cap_mfg",
        "type_key": "arch_Capability",
        "name": "Smart Manufacturing",
        "desc": "Capability to operate connected, data-driven production environments.",
        "color": "#d9b3ff",
    },
    {
        "ref": "cap_data",
        "type_key": "arch_Capability",
        "name": "Enterprise Data & Analytics",
        "desc": "Unified data platform and analytics capability across all divisions.",
        "color": "#d9b3ff",
    },
    # Composite Layer
    {
        "ref": "grp_digital_backbone",
        "type_key": "arch_Grouping",
        "name": "Digital Backbone",
        "desc": "Core integrated application landscape forming NexaTech's digital backbone.",
        "color": "#ffffff",
    },
]


# ── Demo relations ─────────────────────────────────────────────────────────

ARCHIMATE_DEMO_RELATIONS: list[dict[str, Any]] = [
    # Business actor assignments
    {
        "ref": "rel_ops_procure",
        "source_ref": "ba_operations",
        "target_ref": "bp_procure_to_pay",
        "rel_type": "arch_rel_Assignment",
    },
    {
        "ref": "rel_fin_otc",
        "source_ref": "ba_finance",
        "target_ref": "bp_order_to_cash",
        "rel_type": "arch_rel_Assignment",
    },
    # Business services realized by processes
    {
        "ref": "rel_procure_erpsvc",
        "source_ref": "bp_procure_to_pay",
        "target_ref": "bs_erp_service",
        "rel_type": "arch_rel_Realization",
    },
    # Applications realizing business services
    {
        "ref": "rel_erp_erpsvc",
        "source_ref": "ac_erp",
        "target_ref": "bs_erp_service",
        "rel_type": "arch_rel_Realization",
    },
    # Application serving relationships
    {
        "ref": "rel_erp_serves_crm",
        "source_ref": "ac_erp",
        "target_ref": "ac_crm",
        "rel_type": "arch_rel_Serving",
    },
    {
        "ref": "rel_erp_serves_mes",
        "source_ref": "ac_erp",
        "target_ref": "ac_mes",
        "rel_type": "arch_rel_Serving",
    },
    {
        "ref": "rel_iot_serves_analytics",
        "source_ref": "ac_iot",
        "target_ref": "ac_analytics",
        "rel_type": "arch_rel_Serving",
    },
    # Application component compositions
    {
        "ref": "rel_erp_api_comp",
        "source_ref": "ac_erp",
        "target_ref": "ai_erp_api",
        "rel_type": "arch_rel_Composition",
    },
    # Data access
    {
        "ref": "rel_erp_prod_data",
        "source_ref": "ac_erp",
        "target_ref": "do_product_data",
        "rel_type": "arch_rel_Access",
    },
    {
        "ref": "rel_erp_fin_data",
        "source_ref": "ac_erp",
        "target_ref": "do_financial_data",
        "rel_type": "arch_rel_Access",
    },
    # Technology assignments
    {
        "ref": "rel_azure_erp",
        "source_ref": "tn_azure_prod",
        "target_ref": "ac_erp",
        "rel_type": "arch_rel_Assignment",
    },
    {
        "ref": "rel_azure_analytics",
        "source_ref": "tn_azure_prod",
        "target_ref": "ac_analytics",
        "rel_type": "arch_rel_Assignment",
    },
    {
        "ref": "rel_kafka_sys",
        "source_ref": "ts_kafka",
        "target_ref": "ac_iot",
        "rel_type": "arch_rel_Serving",
    },
    # Goal / driver associations
    {
        "ref": "rel_driver_goal",
        "source_ref": "driver_cost",
        "target_ref": "goal_digital_ops",
        "rel_type": "arch_rel_Influence",
    },
    {
        "ref": "rel_goal_cap",
        "source_ref": "goal_digital_ops",
        "target_ref": "cap_mfg",
        "rel_type": "arch_rel_Association",
    },
    # Grouping
    {
        "ref": "rel_grp_erp",
        "source_ref": "grp_digital_backbone",
        "target_ref": "ac_erp",
        "rel_type": "arch_rel_Aggregation",
    },
    {
        "ref": "rel_grp_mes",
        "source_ref": "grp_digital_backbone",
        "target_ref": "ac_mes",
        "rel_type": "arch_rel_Aggregation",
    },
    {
        "ref": "rel_grp_plm",
        "source_ref": "grp_digital_backbone",
        "target_ref": "ac_plm",
        "rel_type": "arch_rel_Aggregation",
    },
]


async def seed_archimate_demo(db: AsyncSession) -> dict:
    """Idempotent seed of ArchiMate demo cards and relations."""
    from sqlalchemy import select

    from app.models.card import Card
    from app.models.relation import Relation

    created_cards = 0
    skipped_cards = 0
    created_rels = 0

    ref_to_id: dict[str, uuid.UUID] = {}

    for card_def in ARCHIMATE_DEMO_CARDS:
        card_id = _id(card_def["ref"])
        ref_to_id[card_def["ref"]] = card_id

        result = await db.execute(select(Card).where(Card.id == card_id))
        existing = result.scalar_one_or_none()

        if existing:
            skipped_cards += 1
            continue

        card = Card(
            id=card_id,
            type_key=card_def["type_key"],
            name=card_def["name"],
            description=card_def.get("desc", ""),
            attributes={"archimateColor": card_def.get("color", "#e0e0e0")},
            status="ACTIVE",
        )
        db.add(card)
        created_cards += 1

    await db.flush()

    for rel_def in ARCHIMATE_DEMO_RELATIONS:
        rel_id = _id(rel_def["ref"])
        source_id = ref_to_id.get(rel_def["source_ref"])
        target_id = ref_to_id.get(rel_def["target_ref"])

        if not source_id or not target_id:
            continue

        result = await db.execute(select(Relation).where(Relation.id == rel_id))
        if result.scalar_one_or_none():
            continue

        rel = Relation(
            id=rel_id,
            type_key=rel_def["rel_type"],
            source_id=source_id,
            target_id=target_id,
            attributes={},
        )
        db.add(rel)
        created_rels += 1

    await db.commit()

    return {
        "cards_created": created_cards,
        "cards_skipped": skipped_cards,
        "relations_created": created_rels,
    }
