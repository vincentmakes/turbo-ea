"""Seed default LeanIX metamodel v4 fact sheet types and relation types."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fact_sheet_type import FactSheetType
from app.models.relation_type import RelationType

FACT_SHEET_TYPES = [
    # ── Business Architecture ──
    {
        "key": "BusinessCapability",
        "label": "Business Capability",
        "description": "What the business can do — stable functional decomposition (L1→L2→L3).",
        "icon": "account_tree",
        "color": "#4caf50",
        "category": "business",
        "has_hierarchy": True,
        "sort_order": 1,
        "fields_schema": [
            {
                "section": "Business Capability Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                ],
            },
        ],
    },
    {
        "key": "BusinessContext",
        "label": "Business Context",
        "description": "Activities: value streams, business products, processes.",
        "icon": "domain",
        "color": "#66bb6a",
        "category": "business",
        "has_hierarchy": True,
        "sort_order": 2,
        "fields_schema": [
            {
                "section": "Business Context Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                ],
            },
        ],
    },
    {
        "key": "Organization",
        "label": "Organization",
        "description": "Business units, regions, teams, legal entities, customers.",
        "icon": "corporate_fare",
        "color": "#43a047",
        "category": "business",
        "has_hierarchy": True,
        "sort_order": 3,
        "fields_schema": [
            {
                "section": "Organization Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                ],
            },
        ],
    },
    # ── Application Architecture ──
    {
        "key": "Application",
        "label": "Application",
        "description": "Central entity — software systems, microservices, deployments.",
        "icon": "apps",
        "color": "#1976d2",
        "category": "application",
        "has_hierarchy": True,
        "sort_order": 4,
        "fields_schema": [
            {
                "section": "Application Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                    {
                        "key": "businessCriticality",
                        "label": "Business Criticality",
                        "type": "single_select",
                        "options": [
                            {"key": "missionCritical", "label": "Mission Critical", "color": "#d32f2f"},
                            {"key": "businessCritical", "label": "Business Critical", "color": "#f57c00"},
                            {"key": "businessOperational", "label": "Business Operational", "color": "#fbc02d"},
                            {"key": "administrative", "label": "Administrative", "color": "#9e9e9e"},
                        ],
                    },
                    {
                        "key": "functionalFit",
                        "label": "Functional Fit",
                        "type": "single_select",
                        "options": [
                            {"key": "perfect", "label": "Perfect", "color": "#2e7d32"},
                            {"key": "appropriate", "label": "Appropriate", "color": "#66bb6a"},
                            {"key": "insufficient", "label": "Insufficient", "color": "#f57c00"},
                            {"key": "unreasonable", "label": "Unreasonable", "color": "#d32f2f"},
                        ],
                    },
                    {
                        "key": "technicalFit",
                        "label": "Technical Fit",
                        "type": "single_select",
                        "options": [
                            {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
                            {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
                            {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
                            {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"},
                        ],
                    },
                    {
                        "key": "hostingType",
                        "label": "Hosting Type",
                        "type": "single_select",
                        "options": [
                            {"key": "onPremise", "label": "On-Premise"},
                            {"key": "cloudSaaS", "label": "Cloud (SaaS)"},
                            {"key": "cloudPaaS", "label": "Cloud (PaaS)"},
                            {"key": "cloudIaaS", "label": "Cloud (IaaS)"},
                            {"key": "hybrid", "label": "Hybrid"},
                        ],
                    },
                ],
            },
            {
                "section": "Cost",
                "fields": [
                    {"key": "totalAnnualCost", "label": "Total Annual Cost", "type": "number"},
                    {"key": "costCurrency", "label": "Currency", "type": "text"},
                ],
            },
        ],
    },
    {
        "key": "Interface",
        "label": "Interface",
        "description": "Data exchange connections between applications.",
        "icon": "sync_alt",
        "color": "#1565c0",
        "category": "application",
        "has_hierarchy": False,
        "sort_order": 5,
        "fields_schema": [
            {
                "section": "Interface Information",
                "fields": [
                    {
                        "key": "frequency",
                        "label": "Frequency",
                        "type": "single_select",
                        "options": [
                            {"key": "realtime", "label": "Real-time"},
                            {"key": "daily", "label": "Daily"},
                            {"key": "weekly", "label": "Weekly"},
                            {"key": "monthly", "label": "Monthly"},
                            {"key": "onDemand", "label": "On Demand"},
                            {"key": "batch", "label": "Batch"},
                        ],
                    },
                    {
                        "key": "dataDirection",
                        "label": "Data Direction",
                        "type": "single_select",
                        "options": [
                            {"key": "unidirectional", "label": "Unidirectional"},
                            {"key": "bidirectional", "label": "Bidirectional"},
                        ],
                    },
                    {
                        "key": "technicalFit",
                        "label": "Technical Fit",
                        "type": "single_select",
                        "options": [
                            {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
                            {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
                            {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
                            {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"},
                        ],
                    },
                ],
            },
        ],
    },
    {
        "key": "DataObject",
        "label": "Data Object",
        "description": "Business data entities (customer, order, product data).",
        "icon": "database",
        "color": "#0d47a1",
        "category": "application",
        "has_hierarchy": True,
        "sort_order": 6,
        "fields_schema": [
            {
                "section": "Data Object Information",
                "fields": [
                    {
                        "key": "dataSensitivity",
                        "label": "Data Sensitivity",
                        "type": "single_select",
                        "options": [
                            {"key": "public", "label": "Public", "color": "#4caf50"},
                            {"key": "internal", "label": "Internal", "color": "#2196f3"},
                            {"key": "confidential", "label": "Confidential", "color": "#f57c00"},
                            {"key": "restricted", "label": "Restricted", "color": "#d32f2f"},
                        ],
                    },
                    {"key": "isPersonalData", "label": "Contains Personal Data", "type": "boolean"},
                ],
            },
        ],
    },
    # ── Technology Architecture ──
    {
        "key": "ITComponent",
        "label": "IT Component",
        "description": "Technology dependencies — software, hardware, SaaS, infrastructure.",
        "icon": "memory",
        "color": "#7b1fa2",
        "category": "technology",
        "has_hierarchy": True,
        "sort_order": 7,
        "fields_schema": [
            {
                "section": "IT Component Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                    {
                        "key": "technicalFit",
                        "label": "Technical Fit",
                        "type": "single_select",
                        "options": [
                            {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
                            {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
                            {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
                            {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"},
                        ],
                    },
                ],
            },
            {
                "section": "Cost",
                "fields": [
                    {"key": "totalAnnualCost", "label": "Total Annual Cost", "type": "number"},
                ],
            },
        ],
    },
    {
        "key": "TechCategory",
        "label": "Tech Category",
        "description": "Taxonomy for grouping IT Components (e.g., DBMS, OS, Cloud Platform).",
        "icon": "category",
        "color": "#9c27b0",
        "category": "technology",
        "has_hierarchy": True,
        "sort_order": 8,
        "fields_schema": [
            {
                "section": "Tech Category Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                ],
            },
        ],
    },
    {
        "key": "Provider",
        "label": "Provider",
        "description": "Vendors and suppliers of technology and services.",
        "icon": "store",
        "color": "#6a1b9a",
        "category": "technology",
        "has_hierarchy": False,
        "sort_order": 9,
        "fields_schema": [
            {
                "section": "Provider Information",
                "fields": [
                    {"key": "website", "label": "Website", "type": "text"},
                    {"key": "headquarters", "label": "Headquarters", "type": "text"},
                ],
            },
        ],
    },
    # ── Transformation Architecture ──
    {
        "key": "Platform",
        "label": "Platform",
        "description": "Strategic groupings of applications and technologies.",
        "icon": "hub",
        "color": "#e65100",
        "category": "transformation",
        "has_hierarchy": False,
        "sort_order": 10,
        "fields_schema": [
            {
                "section": "Platform Information",
                "fields": [
                    {"key": "alias", "label": "Alias", "type": "text"},
                ],
            },
        ],
    },
    {
        "key": "Objective",
        "label": "Objective",
        "description": "Strategic goals driving initiatives and transformation.",
        "icon": "flag",
        "color": "#ef6c00",
        "category": "transformation",
        "has_hierarchy": False,
        "sort_order": 11,
        "fields_schema": [
            {
                "section": "Objective Information",
                "fields": [
                    {
                        "key": "category",
                        "label": "Category",
                        "type": "single_select",
                        "options": [
                            {"key": "strategic", "label": "Strategic"},
                            {"key": "tactical", "label": "Tactical"},
                            {"key": "operational", "label": "Operational"},
                        ],
                    },
                    {"key": "kpiDescription", "label": "KPI Description", "type": "text"},
                ],
            },
        ],
    },
    {
        "key": "Initiative",
        "label": "Initiative",
        "description": "Transformation efforts — ideas, projects, programs, epics.",
        "icon": "rocket_launch",
        "color": "#f57c00",
        "category": "transformation",
        "has_hierarchy": True,
        "sort_order": 12,
        "fields_schema": [
            {
                "section": "Initiative Information",
                "fields": [
                    {
                        "key": "status",
                        "label": "Status",
                        "type": "single_select",
                        "options": [
                            {"key": "proposed", "label": "Proposed", "color": "#9e9e9e"},
                            {"key": "approved", "label": "Approved", "color": "#2196f3"},
                            {"key": "inProgress", "label": "In Progress", "color": "#ff9800"},
                            {"key": "completed", "label": "Completed", "color": "#4caf50"},
                            {"key": "cancelled", "label": "Cancelled", "color": "#d32f2f"},
                        ],
                    },
                    {"key": "budget", "label": "Budget", "type": "number"},
                    {"key": "startDate", "label": "Start Date", "type": "date"},
                    {"key": "endDate", "label": "End Date", "type": "date"},
                ],
            },
        ],
    },
]

RELATION_TYPES = [
    {"key": "relAppToBC", "label": "Application → Business Capability", "source_type_key": "Application", "target_type_key": "BusinessCapability", "attributes_schema": []},
    {"key": "relAppToOrg", "label": "Application → Organization", "source_type_key": "Application", "target_type_key": "Organization", "attributes_schema": [{"key": "usageType", "label": "Usage Type", "type": "single_select", "options": [{"key": "user", "label": "User"}, {"key": "owner", "label": "Owner"}]}]},
    {"key": "relAppToITC", "label": "Application → IT Component", "source_type_key": "Application", "target_type_key": "ITComponent", "attributes_schema": [{"key": "totalAnnualCost", "label": "Total Annual Cost", "type": "number"}]},
    {"key": "relAppToInterface", "label": "Application → Interface", "source_type_key": "Application", "target_type_key": "Interface", "attributes_schema": [{"key": "direction", "label": "Direction", "type": "single_select", "options": [{"key": "provider", "label": "Provider"}, {"key": "consumer", "label": "Consumer"}]}]},
    {"key": "relAppToDataObj", "label": "Application → Data Object", "source_type_key": "Application", "target_type_key": "DataObject", "attributes_schema": [{"key": "crudFlags", "label": "CRUD Flags", "type": "text"}]},
    {"key": "relAppToProvider", "label": "Application → Provider", "source_type_key": "Application", "target_type_key": "Provider", "attributes_schema": []},
    {"key": "relAppToPlatform", "label": "Application → Platform", "source_type_key": "Application", "target_type_key": "Platform", "attributes_schema": []},
    {"key": "relAppToApp", "label": "Application → Application", "source_type_key": "Application", "target_type_key": "Application", "attributes_schema": []},
    {"key": "relInterfaceToDataObj", "label": "Interface → Data Object", "source_type_key": "Interface", "target_type_key": "DataObject", "attributes_schema": []},
    {"key": "relITCToTechCat", "label": "IT Component → Tech Category", "source_type_key": "ITComponent", "target_type_key": "TechCategory", "attributes_schema": [{"key": "resourceClassification", "label": "Resource Classification", "type": "single_select", "options": [{"key": "approved", "label": "Approved", "color": "#4caf50"}, {"key": "conditional", "label": "Conditional", "color": "#ff9800"}, {"key": "investigating", "label": "Investigating", "color": "#2196f3"}, {"key": "retiring", "label": "Retiring", "color": "#f44336"}, {"key": "unapproved", "label": "Unapproved", "color": "#9e9e9e"}]}]},
    {"key": "relITCToProvider", "label": "IT Component → Provider", "source_type_key": "ITComponent", "target_type_key": "Provider", "attributes_schema": []},
    {"key": "relObjToBC", "label": "Objective → Business Capability", "source_type_key": "Objective", "target_type_key": "BusinessCapability", "attributes_schema": []},
    {"key": "relObjToInitiative", "label": "Objective → Initiative", "source_type_key": "Objective", "target_type_key": "Initiative", "attributes_schema": []},
    {"key": "relInitToApp", "label": "Initiative → Application", "source_type_key": "Initiative", "target_type_key": "Application", "attributes_schema": []},
    {"key": "relInitToITC", "label": "Initiative → IT Component", "source_type_key": "Initiative", "target_type_key": "ITComponent", "attributes_schema": []},
    {"key": "relPlatformToApp", "label": "Platform → Application", "source_type_key": "Platform", "target_type_key": "Application", "attributes_schema": []},
    {"key": "relPlatformToITC", "label": "Platform → IT Component", "source_type_key": "Platform", "target_type_key": "ITComponent", "attributes_schema": []},
    {"key": "relOrgToApp", "label": "Organization → Application", "source_type_key": "Organization", "target_type_key": "Application", "attributes_schema": []},
    {"key": "relBCxToBC", "label": "Business Context → Business Capability", "source_type_key": "BusinessContext", "target_type_key": "BusinessCapability", "attributes_schema": []},
    {"key": "relBCxToApp", "label": "Business Context → Application", "source_type_key": "BusinessContext", "target_type_key": "Application", "attributes_schema": []},
]


async def seed_metamodel(db: AsyncSession) -> None:
    """Insert default fact sheet types and relation types if they don't exist."""
    result = await db.execute(select(FactSheetType).limit(1))
    if result.scalar_one_or_none() is not None:
        return  # already seeded

    for data in FACT_SHEET_TYPES:
        db.add(FactSheetType(**data))

    for data in RELATION_TYPES:
        db.add(RelationType(**data))

    await db.commit()
