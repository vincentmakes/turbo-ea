"""BPM demo seed data for NexaTech Industries.

Adds BusinessProcess cards, BPM relations, BPMN diagrams with extracted
process elements, and process assessments.  Designed to layer on top of the
base NexaTech demo dataset (seed_demo.py) without requiring a full reset.

Can be triggered two ways:
  1. Automatically when SEED_DEMO=true (included in the main seed pipeline)
  2. Incrementally via SEED_BPM=true on an existing instance that already has
     the base demo data but not the BPM data.
"""
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.process_assessment import ProcessAssessment
from app.services.seed import RELATIONS as _META_RELATIONS, TYPES as _META_TYPES

# ---------------------------------------------------------------------------
# UUID registry – deterministic refs for cross-linking
# We need to look up existing demo UUIDs by name at runtime for the relations
# ---------------------------------------------------------------------------
_refs: dict[str, uuid.UUID] = {}


def _id(ref: str) -> uuid.UUID:
    if ref not in _refs:
        _refs[ref] = uuid.uuid4()
    return _refs[ref]


def _fs(
    ref: str, name: str, *,
    parent: str | None = None, subtype: str | None = None,
    desc: str | None = None, attrs: dict | None = None,
    lifecycle: dict | None = None, approval: str = "APPROVED",
):
    d: dict = dict(
        id=_id(ref), type="BusinessProcess", name=name, status="ACTIVE",
        approval_status=approval, attributes=attrs or {}, lifecycle=lifecycle or {},
    )
    if parent:
        d["parent_id"] = _id(parent)
    if subtype:
        d["subtype"] = subtype
    if desc:
        d["description"] = desc
    return d


def _rel(type_: str, src: str, tgt: str, attrs: dict | None = None, desc: str | None = None):
    return dict(id=uuid.uuid4(), type=type_, source_id=_id(src), target_id=_id(tgt),
                attributes=attrs or {}, description=desc)


# ===================================================================
# BUSINESS PROCESSES  (hierarchy: category > group > process > variant)
# ===================================================================

# ── Process Categories (L1) ───────────────────────────────────────
PROCESSES = [
    _fs("bp_cat_core", "Core Business Processes",
        subtype="category",
        desc="Revenue-generating processes that directly serve customers and deliver products.",
        attrs={"processType": "core"},
        lifecycle={"active": "2005-03-15"}),
    _fs("bp_cat_support", "Support Processes",
        subtype="category",
        desc="Internal processes that enable core business operations.",
        attrs={"processType": "support"},
        lifecycle={"active": "2005-03-15"}),
    _fs("bp_cat_management", "Management Processes",
        subtype="category",
        desc="Strategic and governance processes that steer the organization.",
        attrs={"processType": "management"},
        lifecycle={"active": "2005-03-15"}),

    # ── Core > Order to Cash (Group) ──────────────────────────────
    _fs("bp_grp_otc", "Order to Cash",
        parent="bp_cat_core", subtype="group",
        desc="End-to-end revenue cycle from customer order through delivery and payment collection.",
        attrs={"processType": "core", "maturity": "optimized", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "daily", "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_order_entry", "Order Entry & Validation",
        parent="bp_grp_otc", subtype="process",
        desc="Receive customer orders via portal/EDI, validate pricing, inventory availability, and credit.",
        attrs={"processType": "core", "maturity": "optimized", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "daily",
               "regulatoryRelevance": False},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_credit_check", "Credit Check",
        parent="bp_grp_otc", subtype="process",
        desc="Automated and manual credit scoring for new and existing customers before order confirmation.",
        attrs={"processType": "core", "maturity": "measured", "automationLevel": "fullyAutomated",
               "riskLevel": "medium", "frequency": "daily",
               "regulatoryRelevance": True},
        lifecycle={"active": "2012-01-01"}),

    _fs("bp_fulfillment", "Order Fulfillment & Shipping",
        parent="bp_grp_otc", subtype="process",
        desc="Pick, pack, and ship sensors and gateways from Stuttgart warehouse to global customers.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "daily",
               "regulatoryRelevance": False},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_invoicing", "Invoicing & Payment Collection",
        parent="bp_grp_otc", subtype="process",
        desc="Generate invoices, process customer payments, and manage collections for overdue accounts.",
        attrs={"processType": "core", "maturity": "optimized", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "daily",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    # ── Core > New Product Introduction (Group) ───────────────────
    _fs("bp_grp_npi", "New Product Introduction",
        parent="bp_cat_core", subtype="group",
        desc="Gate-based process from product concept through design, validation, and production ramp-up.",
        attrs={"processType": "core", "maturity": "defined", "automationLevel": "manual",
               "riskLevel": "high", "frequency": "monthly", "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_concept", "Concept & Feasibility",
        parent="bp_grp_npi", subtype="process",
        desc="Evaluate new product ideas against market demand, technology readiness, and investment case.",
        attrs={"processType": "core", "maturity": "defined", "automationLevel": "manual",
               "riskLevel": "high", "frequency": "quarterly",
               "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    _fs("bp_design_review", "Design Review & Gate Approval",
        parent="bp_grp_npi", subtype="process",
        desc="Formal multi-discipline review at each development phase gate (concept, design, validation, production).",
        attrs={"processType": "core", "maturity": "optimized", "automationLevel": "manual",
               "riskLevel": "medium", "frequency": "monthly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_proto_validation", "Prototyping & Validation",
        parent="bp_grp_npi", subtype="process",
        desc="Build prototypes, run EVT/DVT/PVT test campaigns, and validate against product requirements.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "high", "frequency": "monthly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_prod_transfer", "Production Transfer",
        parent="bp_grp_npi", subtype="process",
        desc="Transfer validated design to manufacturing: BOM release, tooling, line setup, pilot run.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "high", "frequency": "quarterly",
               "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    # ── Core > Manufacturing Execution (Group) ────────────────────
    _fs("bp_grp_mfg", "Manufacturing Execution",
        parent="bp_cat_core", subtype="group",
        desc="Shop floor processes from work order release through finished goods quality inspection.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "continuous", "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_smt_assembly", "SMT Assembly",
        parent="bp_grp_mfg", subtype="process",
        desc="Surface-mount technology: solder paste printing, component placement, and reflow soldering.",
        attrs={"processType": "core", "maturity": "optimized", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "continuous",
               "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_final_assembly", "Final Assembly & Integration",
        parent="bp_grp_mfg", subtype="process",
        desc="Assemble tested PCBAs into enclosures, install connectors, flash firmware, and label.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "continuous",
               "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_quality_inspection", "Quality Inspection & Testing",
        parent="bp_grp_mfg", subtype="process",
        desc="Automated optical, electrical, and functional testing on every production unit with SPC analysis.",
        attrs={"processType": "core", "maturity": "measured", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "continuous",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    # ── Core > Customer Service (Group) ───────────────────────────
    _fs("bp_grp_service", "Customer Service & Support",
        parent="bp_cat_core", subtype="group",
        desc="Post-sales support lifecycle from incident through resolution and preventive maintenance.",
        attrs={"processType": "core", "maturity": "defined", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "daily", "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    _fs("bp_incident_mgmt", "Incident Management",
        parent="bp_grp_service", subtype="process",
        desc="Receive, triage, diagnose, and resolve customer-reported issues for deployed sensors and gateways.",
        attrs={"processType": "core", "maturity": "defined", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "daily",
               "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    _fs("bp_field_service", "Field Service Dispatch",
        parent="bp_grp_service", subtype="process",
        desc="Dispatch field technicians for on-site installation, repair, and preventive maintenance visits.",
        attrs={"processType": "core", "maturity": "initial", "automationLevel": "manual",
               "riskLevel": "high", "frequency": "weekly",
               "regulatoryRelevance": False},
        lifecycle={"active": "2015-01-01"}),

    _fs("bp_warranty_claim", "Warranty Claim Processing",
        parent="bp_grp_service", subtype="process",
        desc="Validate warranty entitlements, authorize replacements or repairs, and track claim financials.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "weekly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2014-01-01"}),

    # ── Support > Procure to Pay (Group) ──────────────────────────
    _fs("bp_grp_p2p", "Procure to Pay",
        parent="bp_cat_support", subtype="group",
        desc="End-to-end procurement cycle from purchase requisition through supplier payment.",
        attrs={"processType": "support", "maturity": "optimized", "automationLevel": "partiallyAutomated",
               "riskLevel": "low", "frequency": "daily", "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_requisition", "Purchase Requisition",
        parent="bp_grp_p2p", subtype="process",
        desc="Create, approve, and route purchase requisitions for electronic components and raw materials.",
        attrs={"processType": "support", "maturity": "optimized", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "daily",
               "regulatoryRelevance": False},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_po_creation", "Purchase Order Management",
        parent="bp_grp_p2p", subtype="process",
        desc="Create POs from approved requisitions, manage supplier confirmations and delivery tracking.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "low", "frequency": "daily",
               "regulatoryRelevance": False},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_goods_receipt", "Goods Receipt & Inspection",
        parent="bp_grp_p2p", subtype="process",
        desc="Receive incoming shipments, verify quantities against POs, run incoming quality inspection.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "daily",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_invoice_verification", "Invoice Verification & Payment",
        parent="bp_grp_p2p", subtype="process",
        desc="Three-way match (PO, goods receipt, invoice), approve, and schedule supplier payments.",
        attrs={"processType": "support", "maturity": "optimized", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "daily",
               "regulatoryRelevance": True},
        lifecycle={"active": "2012-01-01"}),

    # ── Support > Hire to Retire (Group) ──────────────────────────
    _fs("bp_grp_h2r", "Hire to Retire",
        parent="bp_cat_support", subtype="group",
        desc="Employee lifecycle from recruitment through onboarding, development, and separation.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "low", "frequency": "weekly", "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_recruitment", "Recruitment & Hiring",
        parent="bp_grp_h2r", subtype="process",
        desc="Post positions, screen candidates, conduct interviews, and extend offers for engineering talent.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "low", "frequency": "weekly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_onboarding", "Employee Onboarding",
        parent="bp_grp_h2r", subtype="process",
        desc="IT equipment provisioning, system access setup, safety training, and first-week orientation.",
        attrs={"processType": "support", "maturity": "defined", "automationLevel": "partiallyAutomated",
               "riskLevel": "low", "frequency": "weekly",
               "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    # ── Support > IT Service Management (Group) ───────────────────
    _fs("bp_grp_itsm", "IT Service Management",
        parent="bp_cat_support", subtype="group",
        desc="ITIL-based processes for managing IT services, incidents, changes, and assets.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "continuous", "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    _fs("bp_it_incident", "IT Incident Management",
        parent="bp_grp_itsm", subtype="process",
        desc="Log, classify, prioritize, and resolve IT incidents within SLA targets.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "continuous",
               "regulatoryRelevance": False},
        lifecycle={"active": "2012-01-01"}),

    _fs("bp_change_mgmt", "IT Change Management",
        parent="bp_grp_itsm", subtype="process",
        desc="Request, evaluate, approve, and implement changes to production IT systems.",
        attrs={"processType": "support", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "high", "frequency": "weekly",
               "regulatoryRelevance": False},
        lifecycle={"active": "2014-01-01"}),

    # ── Support > Engineering Change Management ───────────────────
    _fs("bp_ecm", "Engineering Change Management",
        parent="bp_cat_support", subtype="process",
        desc="Controlled process for evaluating, approving, and implementing design and BOM changes.",
        attrs={"processType": "support", "maturity": "optimized", "automationLevel": "partiallyAutomated",
               "riskLevel": "high", "frequency": "weekly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    # ── Management > Strategic Planning ───────────────────────────
    _fs("bp_strategic_planning", "Strategic Planning & Review",
        parent="bp_cat_management", subtype="process",
        desc="Annual strategic planning cycle: market analysis, portfolio review, and investment decisions.",
        attrs={"processType": "management", "maturity": "defined", "automationLevel": "manual",
               "riskLevel": "low", "frequency": "quarterly",
               "regulatoryRelevance": False},
        lifecycle={"active": "2005-03-15"}),

    _fs("bp_budget_planning", "Budget Planning & Forecasting",
        parent="bp_cat_management", subtype="process",
        desc="Annual budget creation, quarterly rolling forecasts, and variance analysis.",
        attrs={"processType": "management", "maturity": "managed", "automationLevel": "partiallyAutomated",
               "riskLevel": "low", "frequency": "monthly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2008-01-01"}),

    _fs("bp_regulatory_submission", "Regulatory Submission",
        parent="bp_cat_management", subtype="process",
        desc="Prepare and submit CE, UL, and IEC certification documentation for new and changed products.",
        attrs={"processType": "management", "maturity": "managed", "automationLevel": "manual",
               "riskLevel": "high", "frequency": "monthly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_internal_audit", "Internal Audit",
        parent="bp_cat_management", subtype="process",
        desc="Plan and execute internal quality and compliance audits per ISO 9001 and IEC 62443 requirements.",
        attrs={"processType": "management", "maturity": "defined", "automationLevel": "manual",
               "riskLevel": "medium", "frequency": "quarterly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2010-01-01"}),

    # ── Core > IoT Device Lifecycle (Group) ───────────────────────
    _fs("bp_grp_iot", "IoT Device Lifecycle",
        parent="bp_cat_core", subtype="group",
        desc="Processes spanning IoT device provisioning, monitoring, firmware updates, and decommissioning.",
        attrs={"processType": "core", "maturity": "defined", "automationLevel": "partiallyAutomated",
               "riskLevel": "high", "frequency": "continuous", "regulatoryRelevance": True},
        lifecycle={"active": "2020-01-01"}),

    _fs("bp_device_provisioning", "Device Provisioning",
        parent="bp_grp_iot", subtype="process",
        desc="Register new devices, provision certificates, configure connectivity, and validate first telemetry.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "fullyAutomated",
               "riskLevel": "medium", "frequency": "daily",
               "regulatoryRelevance": True},
        lifecycle={"active": "2021-01-01"}),

    _fs("bp_ota_update", "OTA Firmware Update",
        parent="bp_grp_iot", subtype="process",
        desc="Prepare, test, stage, and roll out over-the-air firmware updates to deployed device fleets.",
        attrs={"processType": "core", "maturity": "defined", "automationLevel": "fullyAutomated",
               "riskLevel": "critical", "frequency": "monthly",
               "regulatoryRelevance": True},
        lifecycle={"active": "2022-01-01"}),

    _fs("bp_anomaly_response", "Anomaly Detection & Response",
        parent="bp_grp_iot", subtype="process",
        desc="Detect anomalous sensor readings via ML, triage alerts, and trigger corrective actions.",
        attrs={"processType": "core", "maturity": "initial", "automationLevel": "partiallyAutomated",
               "riskLevel": "high", "frequency": "continuous",
               "regulatoryRelevance": False},
        lifecycle={"phaseIn": "2025-01-01", "active": "2025-09-01"}),

    # Variants (different customer-segment flavors of OTC)
    _fs("bp_otc_industrial", "Order to Cash (Industrial B2B)",
        parent="bp_grp_otc", subtype="variant",
        desc="OTC variant for industrial sensor customers: includes technical validation and compliance docs.",
        attrs={"processType": "core", "maturity": "optimized", "automationLevel": "partiallyAutomated",
               "riskLevel": "medium", "frequency": "daily"},
        lifecycle={"active": "2010-01-01"}),

    _fs("bp_otc_consumer", "Order to Cash (Consumer/Smart Home)",
        parent="bp_grp_otc", subtype="variant",
        desc="OTC variant for NexaHub consumer products: simplified flow via e-commerce and retail partners.",
        attrs={"processType": "core", "maturity": "managed", "automationLevel": "fullyAutomated",
               "riskLevel": "low", "frequency": "daily"},
        lifecycle={"active": "2020-01-01"}),
]


# ===================================================================
# BPM RELATIONS – linking processes to existing demo entities
# Uses string names to look up existing cards at runtime
# ===================================================================
# We'll use a lookup dict populated at seed time for existing entities.
# For now, define the spec and resolve at runtime.

_BPM_RELATION_SPECS = [
    # ── Process → Business Capability (relProcessToBC) ────────────
    # OTC processes
    ("relProcessToBC", "bp_grp_otc", "Order Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_grp_otc", "Sales & Distribution", {"supportType": "leading"}),
    ("relProcessToBC", "bp_order_entry", "Order Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_credit_check", "Financial Planning & Analysis", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_fulfillment", "Logistics & Warehousing", {"supportType": "leading"}),
    ("relProcessToBC", "bp_fulfillment", "Packaging & Shipping", {"supportType": "leading"}),
    ("relProcessToBC", "bp_invoicing", "Accounting & Reporting", {"supportType": "leading"}),
    # NPI processes
    ("relProcessToBC", "bp_grp_npi", "Product Lifecycle Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_concept", "Product Strategy & Roadmapping", {"supportType": "leading"}),
    ("relProcessToBC", "bp_design_review", "Engineering & Design", {"supportType": "leading"}),
    ("relProcessToBC", "bp_proto_validation", "Simulation & Testing", {"supportType": "leading"}),
    ("relProcessToBC", "bp_prod_transfer", "Production Planning", {"supportType": "leading"}),
    # Manufacturing
    ("relProcessToBC", "bp_grp_mfg", "Manufacturing & Production", {"supportType": "leading"}),
    ("relProcessToBC", "bp_smt_assembly", "SMT Assembly", {"supportType": "leading"}),
    ("relProcessToBC", "bp_smt_assembly", "Production Execution", {"supportType": "leading"}),
    ("relProcessToBC", "bp_final_assembly", "Final Assembly", {"supportType": "leading"}),
    ("relProcessToBC", "bp_quality_inspection", "Testing & Calibration", {"supportType": "leading"}),
    ("relProcessToBC", "bp_quality_inspection", "Quality Management System", {"supportType": "supporting"}),
    # Customer Service
    ("relProcessToBC", "bp_grp_service", "Service & After-Sales", {"supportType": "leading"}),
    ("relProcessToBC", "bp_incident_mgmt", "Technical Support", {"supportType": "leading"}),
    ("relProcessToBC", "bp_field_service", "Field Service Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_warranty_claim", "Warranty Management", {"supportType": "leading"}),
    # P2P
    ("relProcessToBC", "bp_grp_p2p", "Supply Chain Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_requisition", "Procurement", {"supportType": "leading"}),
    ("relProcessToBC", "bp_po_creation", "Procurement", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_po_creation", "Vendor Management", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_goods_receipt", "Inventory Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_invoice_verification", "Accounting & Reporting", {"supportType": "supporting"}),
    # H2R
    ("relProcessToBC", "bp_grp_h2r", "Human Capital Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_recruitment", "Human Capital Management", {"supportType": "leading"}),
    # ITSM
    ("relProcessToBC", "bp_grp_itsm", "IT Service Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_it_incident", "IT Service Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_change_mgmt", "IT Service Management", {"supportType": "supporting"}),
    # ECM
    ("relProcessToBC", "bp_ecm", "Engineering & Design", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_ecm", "Product Requirements Management", {"supportType": "supporting"}),
    # IoT
    ("relProcessToBC", "bp_grp_iot", "Remote Monitoring & Diagnostics", {"supportType": "leading"}),
    ("relProcessToBC", "bp_device_provisioning", "Remote Monitoring & Diagnostics", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_ota_update", "Firmware Development", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_ota_update", "OTA Update Management", {"supportType": "leading"}),
    ("relProcessToBC", "bp_anomaly_response", "Remote Monitoring & Diagnostics", {"supportType": "leading"}),
    # Management
    ("relProcessToBC", "bp_strategic_planning", "Corporate Strategy", {"supportType": "leading"}),
    ("relProcessToBC", "bp_budget_planning", "Financial Planning & Analysis", {"supportType": "leading"}),
    ("relProcessToBC", "bp_regulatory_submission", "Regulatory Affairs", {"supportType": "leading"}),
    ("relProcessToBC", "bp_regulatory_submission", "Product Certification", {"supportType": "supporting"}),
    ("relProcessToBC", "bp_internal_audit", "Audit Management", {"supportType": "leading"}),

    # ── Process → Application (relProcessToApp) ──────────────────
    ("relProcessToApp", "bp_order_entry", "SAP S/4HANA", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_order_entry", "Salesforce Sales Cloud", {"usageType": "creates", "criticality": "high"}),
    ("relProcessToApp", "bp_credit_check", "SAP S/4HANA", {"usageType": "reads", "criticality": "critical"}),
    ("relProcessToApp", "bp_fulfillment", "SAP S/4HANA", {"usageType": "updates", "criticality": "critical"}),
    ("relProcessToApp", "bp_fulfillment", "Siemens Opcenter", {"usageType": "reads", "criticality": "high"}),
    ("relProcessToApp", "bp_invoicing", "SAP S/4HANA", {"usageType": "creates", "criticality": "critical"}),
    ("relProcessToApp", "bp_concept", "Confluence", {"usageType": "creates", "criticality": "low"}),
    ("relProcessToApp", "bp_concept", "Jira", {"usageType": "creates", "criticality": "medium"}),
    ("relProcessToApp", "bp_design_review", "Siemens Teamcenter", {"usageType": "reads", "criticality": "critical"}),
    ("relProcessToApp", "bp_proto_validation", "MATLAB/Simulink", {"usageType": "orchestrates", "criticality": "high"}),
    ("relProcessToApp", "bp_proto_validation", "Siemens NX", {"usageType": "reads", "criticality": "high"}),
    ("relProcessToApp", "bp_prod_transfer", "Siemens Teamcenter", {"usageType": "reads", "criticality": "critical"}),
    ("relProcessToApp", "bp_prod_transfer", "Siemens Opcenter", {"usageType": "updates", "criticality": "critical"}),
    ("relProcessToApp", "bp_smt_assembly", "Siemens Opcenter", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_smt_assembly", "NexaSCADA", {"usageType": "reads", "criticality": "high"}),
    ("relProcessToApp", "bp_final_assembly", "Siemens Opcenter", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_quality_inspection", "Quality Inspection System", {"usageType": "creates", "criticality": "critical"}),
    ("relProcessToApp", "bp_quality_inspection", "Siemens Opcenter", {"usageType": "updates", "criticality": "high"}),
    ("relProcessToApp", "bp_incident_mgmt", "Salesforce Service Cloud", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_incident_mgmt", "ServiceNow", {"usageType": "creates", "criticality": "high"}),
    ("relProcessToApp", "bp_field_service", "Salesforce Service Cloud", {"usageType": "orchestrates", "criticality": "high"}),
    ("relProcessToApp", "bp_warranty_claim", "Salesforce Service Cloud", {"usageType": "orchestrates", "criticality": "high"}),
    ("relProcessToApp", "bp_warranty_claim", "SAP S/4HANA", {"usageType": "updates", "criticality": "medium"}),
    ("relProcessToApp", "bp_requisition", "SAP Ariba", {"usageType": "creates", "criticality": "critical"}),
    ("relProcessToApp", "bp_requisition", "SAP S/4HANA", {"usageType": "creates", "criticality": "high"}),
    ("relProcessToApp", "bp_po_creation", "SAP Ariba", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_goods_receipt", "SAP S/4HANA", {"usageType": "updates", "criticality": "critical"}),
    ("relProcessToApp", "bp_invoice_verification", "SAP S/4HANA", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_invoice_verification", "Coupa", {"usageType": "reads", "criticality": "medium"}),
    ("relProcessToApp", "bp_recruitment", "SAP SuccessFactors", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_onboarding", "SAP SuccessFactors", {"usageType": "orchestrates", "criticality": "high"}),
    ("relProcessToApp", "bp_onboarding", "ServiceNow", {"usageType": "creates", "criticality": "medium"}),
    ("relProcessToApp", "bp_it_incident", "ServiceNow", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_it_incident", "Splunk", {"usageType": "reads", "criticality": "high"}),
    ("relProcessToApp", "bp_change_mgmt", "ServiceNow", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_ecm", "Siemens Teamcenter", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_ecm", "SAP S/4HANA", {"usageType": "updates", "criticality": "high"}),
    ("relProcessToApp", "bp_device_provisioning", "NexaCloud IoT Platform", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_device_provisioning", "Azure IoT Hub", {"usageType": "creates", "criticality": "critical"}),
    ("relProcessToApp", "bp_device_provisioning", "NexaConnect Device Manager", {"usageType": "updates", "criticality": "high"}),
    ("relProcessToApp", "bp_ota_update", "NexaConnect Device Manager", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_ota_update", "Azure IoT Hub", {"usageType": "updates", "criticality": "critical"}),
    ("relProcessToApp", "bp_anomaly_response", "Anomaly Detection Service", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_anomaly_response", "NexaCloud IoT Platform", {"usageType": "reads", "criticality": "high"}),
    ("relProcessToApp", "bp_anomaly_response", "Grafana", {"usageType": "reads", "criticality": "medium"}),
    ("relProcessToApp", "bp_budget_planning", "Workday Adaptive Planning", {"usageType": "orchestrates", "criticality": "critical"}),
    ("relProcessToApp", "bp_budget_planning", "Power BI", {"usageType": "reads", "criticality": "medium"}),
    ("relProcessToApp", "bp_regulatory_submission", "Siemens Teamcenter", {"usageType": "reads", "criticality": "high"}),
    ("relProcessToApp", "bp_regulatory_submission", "DocuSign", {"usageType": "creates", "criticality": "medium"}),

    # ── Process → Data Object (relProcessToDataObj) ──────────────
    ("relProcessToDataObj", "bp_order_entry", "Sales Order",
     {"crudCreate": True, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_order_entry", "Customer Data",
     {"crudCreate": False, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_fulfillment", "Inventory Record",
     {"crudCreate": False, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_invoicing", "Financial Transaction",
     {"crudCreate": True, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_design_review", "Bill of Materials",
     {"crudCreate": False, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_design_review", "Product Master Data",
     {"crudCreate": False, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_smt_assembly", "Production Order",
     {"crudCreate": False, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_quality_inspection", "Test Results",
     {"crudCreate": True, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_quality_inspection", "Quality Report",
     {"crudCreate": True, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_requisition", "Purchase Order",
     {"crudCreate": True, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_goods_receipt", "Inventory Record",
     {"crudCreate": True, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_recruitment", "Employee Data",
     {"crudCreate": True, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_ecm", "Bill of Materials",
     {"crudCreate": False, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_ecm", "Product Master Data",
     {"crudCreate": False, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_device_provisioning", "IoT Device Registry",
     {"crudCreate": True, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_ota_update", "Firmware Binary",
     {"crudCreate": False, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_ota_update", "IoT Device Registry",
     {"crudCreate": False, "crudRead": True, "crudUpdate": True, "crudDelete": False}),
    ("relProcessToDataObj", "bp_anomaly_response", "Device Telemetry Data",
     {"crudCreate": False, "crudRead": True, "crudUpdate": False, "crudDelete": False}),
    ("relProcessToDataObj", "bp_anomaly_response", "Maintenance Record",
     {"crudCreate": True, "crudRead": True, "crudUpdate": True, "crudDelete": False}),

    # ── Process → Organization (relProcessToOrg) ─────────────────
    ("relProcessToOrg", "bp_grp_otc", "Sales & Marketing"),
    ("relProcessToOrg", "bp_grp_npi", "Engineering Division"),
    ("relProcessToOrg", "bp_grp_mfg", "Manufacturing Division"),
    ("relProcessToOrg", "bp_grp_service", "Customer Support"),
    ("relProcessToOrg", "bp_grp_p2p", "Supply Chain & Logistics"),
    ("relProcessToOrg", "bp_grp_h2r", "Human Resources"),
    ("relProcessToOrg", "bp_grp_itsm", "IT Operations"),
    ("relProcessToOrg", "bp_ecm", "Engineering Division"),
    ("relProcessToOrg", "bp_grp_iot", "R&D"),
    ("relProcessToOrg", "bp_strategic_planning", "Corporate"),
    ("relProcessToOrg", "bp_budget_planning", "Finance & Controlling"),
    ("relProcessToOrg", "bp_regulatory_submission", "Legal & Compliance"),
    ("relProcessToOrg", "bp_internal_audit", "Legal & Compliance"),

    # ── Process → Objective (relProcessToObjective) ──────────────
    ("relProcessToObjective", "bp_grp_otc", "Improve Customer Experience (NPS > 70)"),
    ("relProcessToObjective", "bp_grp_npi", "Reduce Time-to-Market by 30%"),
    ("relProcessToObjective", "bp_grp_mfg", "Achieve Industry 4.0 Manufacturing"),
    ("relProcessToObjective", "bp_grp_service", "Improve Customer Experience (NPS > 70)"),
    ("relProcessToObjective", "bp_grp_iot", "Expand IoT Product Portfolio"),
    ("relProcessToObjective", "bp_grp_iot", "Accelerate Digital Transformation"),
    ("relProcessToObjective", "bp_grp_p2p", "Optimize IT Costs (15% Reduction)"),
    ("relProcessToObjective", "bp_grp_itsm", "Strengthen Cybersecurity Posture"),
    ("relProcessToObjective", "bp_ecm", "Reduce Time-to-Market by 30%"),
    ("relProcessToObjective", "bp_budget_planning", "Optimize IT Costs (15% Reduction)"),
    ("relProcessToObjective", "bp_anomaly_response", "Enable Data-Driven Decision Making"),

    # ── Process → Initiative (relProcessToInitiative) ────────────
    ("relProcessToInitiative", "bp_grp_otc", "SAP S/4HANA Migration"),
    ("relProcessToInitiative", "bp_grp_otc", "Salesforce CRM Implementation"),
    ("relProcessToInitiative", "bp_grp_npi", "Legacy PLM Retirement"),
    ("relProcessToInitiative", "bp_grp_mfg", "Manufacturing Excellence Program"),
    ("relProcessToInitiative", "bp_grp_service", "Customer Portal Redesign"),
    ("relProcessToInitiative", "bp_grp_iot", "IoT Platform Modernization"),
    ("relProcessToInitiative", "bp_grp_itsm", "Cybersecurity Enhancement"),
    ("relProcessToInitiative", "bp_ecm", "Legacy PLM Retirement"),
    ("relProcessToInitiative", "bp_anomaly_response", "AI/ML for Predictive Maintenance"),
    ("relProcessToInitiative", "bp_grp_p2p", "SAP S/4HANA Migration"),
    ("relProcessToInitiative", "bp_it_incident", "Cybersecurity Enhancement"),

    # ── Process → Business Context (relProcessToBizCtx) ──────────
    ("relProcessToBizCtx", "bp_grp_otc", "Order to Cash"),
    ("relProcessToBizCtx", "bp_grp_npi", "New Product Introduction"),
    ("relProcessToBizCtx", "bp_grp_npi", "Idea to Product"),
    ("relProcessToBizCtx", "bp_grp_mfg", "Manufacturing Execution Process"),
    ("relProcessToBizCtx", "bp_grp_service", "Installed Base to Service"),
    ("relProcessToBizCtx", "bp_grp_service", "Customer Complaint Handling"),
    ("relProcessToBizCtx", "bp_grp_p2p", "Procure to Pay"),
    ("relProcessToBizCtx", "bp_design_review", "Design Review Process"),
    ("relProcessToBizCtx", "bp_ecm", "Engineering Change Management"),
    ("relProcessToBizCtx", "bp_regulatory_submission", "Regulatory Submission Process"),

    # ── Process → IT Component (relProcessToITC) ─────────────────
    ("relProcessToITC", "bp_smt_assembly", "Dell PowerEdge R760"),
    ("relProcessToITC", "bp_device_provisioning", "Azure Kubernetes Service"),
    ("relProcessToITC", "bp_ota_update", "Azure Kubernetes Service"),
    ("relProcessToITC", "bp_anomaly_response", "Anomaly Detection Model v2"),
    ("relProcessToITC", "bp_it_incident", "PagerDuty"),
    ("relProcessToITC", "bp_it_incident", "Datadog"),

    # ── Process dependencies (relProcessDependency) ──────────────
    ("relProcessDependency", "bp_fulfillment", "bp_order_entry"),
    ("relProcessDependency", "bp_credit_check", "bp_order_entry"),
    ("relProcessDependency", "bp_invoicing", "bp_fulfillment"),
    ("relProcessDependency", "bp_prod_transfer", "bp_design_review"),
    ("relProcessDependency", "bp_prod_transfer", "bp_proto_validation"),
    ("relProcessDependency", "bp_smt_assembly", "bp_prod_transfer"),
    ("relProcessDependency", "bp_final_assembly", "bp_smt_assembly"),
    ("relProcessDependency", "bp_quality_inspection", "bp_final_assembly"),
    ("relProcessDependency", "bp_fulfillment", "bp_quality_inspection"),
    ("relProcessDependency", "bp_goods_receipt", "bp_po_creation"),
    ("relProcessDependency", "bp_invoice_verification", "bp_goods_receipt"),
    ("relProcessDependency", "bp_anomaly_response", "bp_device_provisioning"),
    ("relProcessDependency", "bp_ota_update", "bp_device_provisioning"),
]


# ===================================================================
# PROCESS ASSESSMENT DATA  (historical maturity assessments)
# ===================================================================
_ASSESSMENT_SPECS = [
    # (process_ref, assessment_date, overall, efficiency, effectiveness, compliance, automation, notes)
    ("bp_grp_otc", "2024-06-15", 4, 4, 4, 5, 3, "OTC well-optimized. Automation gap in shipping notifications."),
    ("bp_grp_otc", "2025-01-20", 4, 4, 5, 5, 4, "Salesforce integration improved order tracking. Automation improved."),
    ("bp_grp_npi", "2024-06-15", 3, 2, 3, 4, 1, "Gate process solid but heavily manual. Digitize design reviews."),
    ("bp_grp_npi", "2025-01-20", 3, 3, 3, 4, 2, "Teamcenter integration improved traceability. Still manual gates."),
    ("bp_grp_mfg", "2024-06-15", 3, 3, 4, 4, 3, "MES coverage good. SCADA needs modernization."),
    ("bp_grp_mfg", "2025-01-20", 4, 4, 4, 4, 3, "Opcenter APS improved scheduling. SCADA still legacy."),
    ("bp_grp_service", "2024-06-15", 2, 2, 3, 3, 2, "Field service dispatch still phone-based. Need mobile app."),
    ("bp_grp_service", "2025-01-20", 3, 2, 3, 3, 2, "Service Cloud deployed. Field dispatch still not automated."),
    ("bp_grp_p2p", "2024-06-15", 4, 4, 4, 5, 4, "P2P highly automated via SAP + Ariba. Minor manual exceptions."),
    ("bp_grp_p2p", "2025-01-20", 5, 5, 4, 5, 4, "Three-way match fully automated. Best-in-class process."),
    ("bp_grp_iot", "2024-06-15", 2, 2, 3, 3, 3, "Provisioning automated but anomaly detection immature."),
    ("bp_grp_iot", "2025-01-20", 3, 3, 3, 3, 3, "Anomaly ML model v2 deployed. Still tuning false positive rate."),
    ("bp_ecm", "2024-06-15", 4, 3, 4, 5, 3, "ECM well-controlled via Teamcenter. Cross-system sync needs work."),
    ("bp_ecm", "2025-01-20", 4, 4, 4, 5, 3, "Improved SAP BOM sync. Full traceability achieved."),
    ("bp_grp_itsm", "2024-06-15", 3, 3, 3, 3, 3, "ServiceNow operational. Change management needs more rigor."),
    ("bp_grp_itsm", "2025-01-20", 3, 3, 3, 4, 3, "Added CAB review workflow. Improved change success rate."),
]


# ===================================================================
# BPMN DIAGRAM DATA  (embedded XML for key processes)
# ===================================================================
def _make_otc_bpmn() -> str:
    """Return a NexaTech-specific Order-to-Cash BPMN 2.0 XML."""
    return """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_NexaOTC"
                  targetNamespace="http://turbo-ea.io/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Part_1" name="NexaTech Order to Cash" processRef="Proc_1" />
  </bpmn:collaboration>
  <bpmn:process id="Proc_1" isExecutable="false">
    <bpmn:laneSet id="LS_1">
      <bpmn:lane id="Lane_Sales" name="Sales">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ReceiveOrder</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ValidateOrder</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Finance" name="Finance">
        <bpmn:flowNodeRef>Task_CreditCheck</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>GW_Credit</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_RejectOrder</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Rejected</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Invoice</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_CollectPayment</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Complete</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Warehouse" name="Warehouse &amp; Logistics">
        <bpmn:flowNodeRef>Task_PickPack</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Ship</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ConfirmDelivery</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1" name="Customer Order Received"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_ReceiveOrder" name="Receive &amp; Log Order"><bpmn:documentation>Log order in Salesforce, create SO in SAP.</bpmn:documentation><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="Task_ValidateOrder" name="Validate Order Data"><bpmn:documentation>Check pricing, product availability, and customer data.</bpmn:documentation><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="Task_CreditCheck" name="Run Credit Check"><bpmn:documentation>Automated credit scoring via SAP Credit Management.</bpmn:documentation><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:exclusiveGateway id="GW_Credit" name="Credit Approved?"><bpmn:incoming>F4</bpmn:incoming><bpmn:outgoing>F_OK</bpmn:outgoing><bpmn:outgoing>F_Fail</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:userTask id="Task_RejectOrder" name="Notify &amp; Reject Order"><bpmn:incoming>F_Fail</bpmn:incoming><bpmn:outgoing>F_EndR</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End_Rejected" name="Order Rejected"><bpmn:incoming>F_EndR</bpmn:incoming></bpmn:endEvent>
    <bpmn:userTask id="Task_PickPack" name="Pick &amp; Pack"><bpmn:documentation>Warehouse staff picks items and packs for shipping.</bpmn:documentation><bpmn:incoming>F_OK</bpmn:incoming><bpmn:outgoing>F5</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="Task_Ship" name="Ship &amp; Track"><bpmn:documentation>Generate shipping label, dispatch carrier, track delivery.</bpmn:documentation><bpmn:incoming>F5</bpmn:incoming><bpmn:outgoing>F6</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:userTask id="Task_ConfirmDelivery" name="Confirm Delivery"><bpmn:incoming>F6</bpmn:incoming><bpmn:outgoing>F7</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="Task_Invoice" name="Generate Invoice"><bpmn:documentation>Auto-generate invoice in SAP upon delivery confirmation.</bpmn:documentation><bpmn:incoming>F7</bpmn:incoming><bpmn:outgoing>F8</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:userTask id="Task_CollectPayment" name="Collect Payment"><bpmn:incoming>F8</bpmn:incoming><bpmn:outgoing>F9</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End_Complete" name="Order Complete"><bpmn:incoming>F9</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_ReceiveOrder" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_ReceiveOrder" targetRef="Task_ValidateOrder" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_ValidateOrder" targetRef="Task_CreditCheck" />
    <bpmn:sequenceFlow id="F4" sourceRef="Task_CreditCheck" targetRef="GW_Credit" />
    <bpmn:sequenceFlow id="F_OK" name="Approved" sourceRef="GW_Credit" targetRef="Task_PickPack" />
    <bpmn:sequenceFlow id="F_Fail" name="Rejected" sourceRef="GW_Credit" targetRef="Task_RejectOrder" />
    <bpmn:sequenceFlow id="F_EndR" sourceRef="Task_RejectOrder" targetRef="End_Rejected" />
    <bpmn:sequenceFlow id="F5" sourceRef="Task_PickPack" targetRef="Task_Ship" />
    <bpmn:sequenceFlow id="F6" sourceRef="Task_Ship" targetRef="Task_ConfirmDelivery" />
    <bpmn:sequenceFlow id="F7" sourceRef="Task_ConfirmDelivery" targetRef="Task_Invoice" />
    <bpmn:sequenceFlow id="F8" sourceRef="Task_Invoice" targetRef="Task_CollectPayment" />
    <bpmn:sequenceFlow id="F9" sourceRef="Task_CollectPayment" targetRef="End_Complete" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiag_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
    <bpmndi:BPMNShape id="Part_1_di" bpmnElement="Part_1" isHorizontal="true"><dc:Bounds x="160" y="60" width="1300" height="600" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_Sales_di" bpmnElement="Lane_Sales" isHorizontal="true"><dc:Bounds x="190" y="60" width="1270" height="180" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_Finance_di" bpmnElement="Lane_Finance" isHorizontal="true"><dc:Bounds x="190" y="240" width="1270" height="200" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Lane_Warehouse_di" bpmnElement="Lane_Warehouse" isHorizontal="true"><dc:Bounds x="190" y="440" width="1270" height="220" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1"><dc:Bounds x="232" y="132" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_ReceiveOrder_di" bpmnElement="Task_ReceiveOrder"><dc:Bounds x="320" y="110" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_ValidateOrder_di" bpmnElement="Task_ValidateOrder"><dc:Bounds x="480" y="110" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_CreditCheck_di" bpmnElement="Task_CreditCheck"><dc:Bounds x="480" y="290" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="GW_Credit_di" bpmnElement="GW_Credit" isMarkerVisible="true"><dc:Bounds x="645" y="305" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_RejectOrder_di" bpmnElement="Task_RejectOrder"><dc:Bounds x="780" y="250" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_Rejected_di" bpmnElement="End_Rejected"><dc:Bounds x="942" y="272" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_PickPack_di" bpmnElement="Task_PickPack"><dc:Bounds x="620" y="500" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_Ship_di" bpmnElement="Task_Ship"><dc:Bounds x="780" y="500" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_ConfirmDelivery_di" bpmnElement="Task_ConfirmDelivery"><dc:Bounds x="940" y="500" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_Invoice_di" bpmnElement="Task_Invoice"><dc:Bounds x="1060" y="290" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Task_CollectPayment_di" bpmnElement="Task_CollectPayment"><dc:Bounds x="1220" y="290" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="End_Complete_di" bpmnElement="End_Complete"><dc:Bounds x="1372" y="312" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="268" y="150" /><di:waypoint x="320" y="150" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="420" y="150" /><di:waypoint x="480" y="150" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F3_di" bpmnElement="F3"><di:waypoint x="530" y="190" /><di:waypoint x="530" y="290" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F4_di" bpmnElement="F4"><di:waypoint x="580" y="330" /><di:waypoint x="645" y="330" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_OK_di" bpmnElement="F_OK"><di:waypoint x="670" y="355" /><di:waypoint x="670" y="500" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_Fail_di" bpmnElement="F_Fail"><di:waypoint x="695" y="330" /><di:waypoint x="780" y="290" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F_EndR_di" bpmnElement="F_EndR"><di:waypoint x="880" y="290" /><di:waypoint x="942" y="290" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F5_di" bpmnElement="F5"><di:waypoint x="720" y="540" /><di:waypoint x="780" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F6_di" bpmnElement="F6"><di:waypoint x="880" y="540" /><di:waypoint x="940" y="540" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F7_di" bpmnElement="F7"><di:waypoint x="990" y="500" /><di:waypoint x="990" y="330" /><di:waypoint x="1060" y="330" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F8_di" bpmnElement="F8"><di:waypoint x="1160" y="330" /><di:waypoint x="1220" y="330" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F9_di" bpmnElement="F9"><di:waypoint x="1320" y="330" /><di:waypoint x="1372" y="330" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>"""


# Process elements to be inserted for the OTC diagram
_OTC_ELEMENTS = [
    ("Task_ReceiveOrder", "userTask", "Receive & Log Order", "Sales", False, 0),
    ("Task_ValidateOrder", "serviceTask", "Validate Order Data", "Sales", True, 1),
    ("Task_CreditCheck", "serviceTask", "Run Credit Check", "Finance", True, 2),
    ("GW_Credit", "exclusiveGateway", "Credit Approved?", "Finance", False, 3),
    ("Task_RejectOrder", "userTask", "Notify & Reject Order", "Finance", False, 4),
    ("Task_PickPack", "userTask", "Pick & Pack", "Warehouse & Logistics", False, 5),
    ("Task_Ship", "serviceTask", "Ship & Track", "Warehouse & Logistics", True, 6),
    ("Task_ConfirmDelivery", "userTask", "Confirm Delivery", "Warehouse & Logistics", False, 7),
    ("Task_Invoice", "serviceTask", "Generate Invoice", "Finance", True, 8),
    ("Task_CollectPayment", "userTask", "Collect Payment", "Finance", False, 9),
]


# ===================================================================
# COMPLETION SCORING  (reused from seed_demo.py)
# ===================================================================
def _compute_data_quality(d: dict, type_schemas: dict[str, list]) -> float:
    schema = type_schemas.get(d["type"], [])
    total_weight = 0.0
    filled_weight = 0.0
    attrs = d.get("attributes", {})
    for section in schema:
        for field in section.get("fields", []):
            weight = field.get("weight", 1)
            if weight <= 0:
                continue
            total_weight += weight
            val = attrs.get(field["key"])
            if val is not None and val != "" and val is not False:
                filled_weight += weight
    total_weight += 1
    if d.get("description") and d["description"].strip():
        filled_weight += 1
    total_weight += 1
    lc = d.get("lifecycle", {})
    if any(lc.get(p) for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")):
        filled_weight += 1
    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


# ===================================================================
# SEED FUNCTION
# ===================================================================
async def seed_bpm_demo_data(db: AsyncSession) -> dict:
    """Insert BPM demo data. Safe to run on top of existing base demo data.

    Returns counts dict. Skips if BusinessProcess cards already exist.
    """
    # Check if BPM data already seeded
    result = await db.execute(
        select(Card.id).where(Card.type == "BusinessProcess").limit(1)
    )
    if result.scalar_one_or_none() is not None:
        return {"skipped": True, "reason": "BusinessProcess cards already exist"}

    # Build lookup: existing card name → id  (for cross-type relations)
    # Use (name, type) tuple to avoid collisions when the same name exists
    # in multiple types (e.g. "ServiceNow" as Application AND Provider).
    existing_result = await db.execute(select(Card.id, Card.name, Card.type))
    name_type_to_id: dict[tuple[str, str], uuid.UUID] = {}
    name_to_id: dict[str, uuid.UUID] = {}  # fallback
    for row in existing_result.all():
        name_type_to_id[(row.name, row.type)] = row.id
        name_to_id[row.name] = row.id

    # Build relation type key → target_type_key mapping for type-aware resolution
    _rel_target_type = {r["key"]: r["target_type_key"] for r in _META_RELATIONS}

    # Compute data quality scores
    type_schemas = {t["key"]: t.get("fields_schema", []) for t in _META_TYPES}
    for d in PROCESSES:
        d["data_quality"] = _compute_data_quality(d, type_schemas)

    # Insert BusinessProcess cards
    for d in PROCESSES:
        db.add(Card(**d))
    await db.flush()

    # Resolve and insert relations
    rel_count = 0
    for spec in _BPM_RELATION_SPECS:
        rel_type = spec[0]
        src_ref = spec[1]
        tgt_ref_or_name = spec[2]
        attrs = spec[3] if len(spec) > 3 else {}

        src_id = _refs.get(src_ref)
        if not src_id:
            continue

        # Target can be a bp_ ref (process-to-process) or a name (cross-type)
        if tgt_ref_or_name.startswith("bp_"):
            tgt_id = _refs.get(tgt_ref_or_name)
        else:
            # Prefer type-aware lookup to avoid collisions (e.g. "ServiceNow"
            # exists as both Application and Provider)
            expected_type = _rel_target_type.get(rel_type)
            tgt_id = (
                name_type_to_id.get((tgt_ref_or_name, expected_type))
                if expected_type
                else None
            ) or name_to_id.get(tgt_ref_or_name)

        if not tgt_id:
            continue

        db.add(Relation(
            id=uuid.uuid4(), type=rel_type,
            source_id=src_id, target_id=tgt_id,
            attributes=attrs or {},
        ))
        rel_count += 1
    await db.flush()

    # Insert BPMN diagram for Order to Cash group process
    otc_id = _refs.get("bp_grp_otc")
    diagram_count = 0
    element_count = 0
    if otc_id:
        diagram = ProcessDiagram(
            process_id=otc_id,
            bpmn_xml=_make_otc_bpmn(),
            version=1,
        )
        db.add(diagram)
        diagram_count += 1
        await db.flush()

        # Insert extracted process elements with EA links
        for bpmn_id, elem_type, name, lane, is_auto, seq in _OTC_ELEMENTS:
            elem = ProcessElement(
                process_id=otc_id,
                bpmn_element_id=bpmn_id,
                element_type=elem_type,
                name=name,
                lane_name=lane,
                is_automated=is_auto,
                sequence_order=seq,
            )
            # Link elements to applications where appropriate
            if name == "Receive & Log Order":
                elem.application_id = name_to_id.get("Salesforce Sales Cloud")
            elif name == "Validate Order Data":
                elem.application_id = name_to_id.get("SAP S/4HANA")
            elif name == "Run Credit Check":
                elem.application_id = name_to_id.get("SAP S/4HANA")
            elif name == "Pick & Pack":
                elem.application_id = name_to_id.get("Siemens Opcenter")
            elif name == "Ship & Track":
                elem.application_id = name_to_id.get("SAP S/4HANA")
            elif name == "Generate Invoice":
                elem.application_id = name_to_id.get("SAP S/4HANA")
            elif name == "Collect Payment":
                elem.application_id = name_to_id.get("SAP S/4HANA")
            db.add(elem)
            element_count += 1
        await db.flush()

    # Insert process assessments (no user FK needed – use a placeholder)
    # Find the first admin user for assessor_id
    from app.models.user import User
    admin_result = await db.execute(
        select(User.id).where(User.role == "admin").limit(1)
    )
    admin_id = admin_result.scalar_one_or_none()
    assessment_count = 0
    if admin_id:
        for proc_ref, dt_str, overall, eff, effect, compl, auto, notes in _ASSESSMENT_SPECS:
            proc_id = _refs.get(proc_ref)
            if not proc_id:
                continue
            db.add(ProcessAssessment(
                process_id=proc_id,
                assessor_id=admin_id,
                assessment_date=date.fromisoformat(dt_str),
                overall_score=overall,
                efficiency=eff,
                effectiveness=effect,
                compliance=compl,
                automation=auto,
                notes=notes,
            ))
            assessment_count += 1
        await db.flush()

    await db.commit()
    return {
        "cards": len(PROCESSES),
        "relations": rel_count,
        "diagrams": diagram_count,
        "elements": element_count,
        "assessments": assessment_count,
    }


# ===================================================================
# CLI entry-point:  python -m app.services.seed_demo_bpm
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
            result = await seed_bpm_demo_data(db)
            print(result)

    asyncio.run(_main())
