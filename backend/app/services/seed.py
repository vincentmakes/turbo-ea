"""Seed the default LeanIX metamodel v4 — matched to the official Meta_Model.xml."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fact_sheet_type import FactSheetType
from app.models.relation_type import RelationType

# ── Reusable option lists ──────────────────────────────────────────────

BUSINESS_CRITICALITY_OPTIONS = [
    {"key": "missionCritical", "label": "Mission Critical", "color": "#d32f2f"},
    {"key": "businessCritical", "label": "Business Critical", "color": "#f57c00"},
    {"key": "businessOperational", "label": "Business Operational", "color": "#fbc02d"},
    {"key": "administrativeService", "label": "Administrative", "color": "#9e9e9e"},
]

FUNCTIONAL_SUITABILITY_OPTIONS = [
    {"key": "perfect", "label": "Perfect", "color": "#2e7d32"},
    {"key": "appropriate", "label": "Appropriate", "color": "#66bb6a"},
    {"key": "insufficient", "label": "Insufficient", "color": "#f57c00"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#d32f2f"},
]

TECHNICAL_SUITABILITY_OPTIONS = [
    {"key": "fullyAppropriate", "label": "Fully Appropriate", "color": "#2e7d32"},
    {"key": "adequate", "label": "Adequate", "color": "#66bb6a"},
    {"key": "unreasonable", "label": "Unreasonable", "color": "#f57c00"},
    {"key": "inappropriate", "label": "Inappropriate", "color": "#d32f2f"},
]

HOSTING_TYPE_OPTIONS = [
    {"key": "onPremise", "label": "On-Premise"},
    {"key": "cloudSaaS", "label": "Cloud (SaaS)"},
    {"key": "cloudPaaS", "label": "Cloud (PaaS)"},
    {"key": "cloudIaaS", "label": "Cloud (IaaS)"},
    {"key": "hybrid", "label": "Hybrid"},
]

RESOURCE_CLASSIFICATION_OPTIONS = [
    {"key": "standard", "label": "Standard", "color": "#4caf50"},
    {"key": "phaseIn", "label": "Phase In", "color": "#2196f3"},
    {"key": "tolerated", "label": "Tolerated", "color": "#ff9800"},
    {"key": "phaseOut", "label": "Phase Out", "color": "#f44336"},
    {"key": "declined", "label": "Declined", "color": "#9e9e9e"},
]

DATA_SENSITIVITY_OPTIONS = [
    {"key": "public", "label": "Public", "color": "#4caf50"},
    {"key": "internal", "label": "Internal", "color": "#2196f3"},
    {"key": "confidential", "label": "Confidential", "color": "#ff9800"},
    {"key": "restricted", "label": "Restricted", "color": "#d32f2f"},
]

INITIATIVE_STATUS_OPTIONS = [
    {"key": "onTrack", "label": "On Track", "color": "#4caf50"},
    {"key": "atRisk", "label": "At Risk", "color": "#ff9800"},
    {"key": "offTrack", "label": "Off Track", "color": "#d32f2f"},
    {"key": "onHold", "label": "On Hold", "color": "#9e9e9e"},
    {"key": "completed", "label": "Completed", "color": "#1976d2"},
]

FREQUENCY_OPTIONS = [
    {"key": "realTime", "label": "Real-Time"},
    {"key": "daily", "label": "Daily"},
    {"key": "weekly", "label": "Weekly"},
    {"key": "monthly", "label": "Monthly"},
    {"key": "onDemand", "label": "On Demand"},
    {"key": "batch", "label": "Batch"},
]

SUPPORT_TYPE_OPTIONS = [
    {"key": "leading", "label": "Leading", "color": "#2e7d32"},
    {"key": "supporting", "label": "Supporting", "color": "#66bb6a"},
    {"key": "noSupport", "label": "No Support", "color": "#9e9e9e"},
]

USAGE_TYPE_OPTIONS = [
    {"key": "owner", "label": "Owner", "color": "#1976d2"},
    {"key": "user", "label": "User", "color": "#66bb6a"},
    {"key": "stakeholder", "label": "Stakeholder", "color": "#ff9800"},
]

TIME_MODEL_OPTIONS = [
    {"key": "tolerate", "label": "Tolerate", "color": "#ff9800"},
    {"key": "invest", "label": "Invest", "color": "#4caf50"},
    {"key": "migrate", "label": "Migrate", "color": "#2196f3"},
    {"key": "eliminate", "label": "Eliminate", "color": "#d32f2f"},
]

# ── BPM option lists ──────────────────────────────────────────────────

PROCESS_TYPE_OPTIONS = [
    {"key": "core", "label": "Core", "color": "#1976d2"},
    {"key": "support", "label": "Support", "color": "#607d8b"},
    {"key": "management", "label": "Management", "color": "#9c27b0"},
]

PROCESS_MATURITY_OPTIONS = [
    {"key": "initial", "label": "1 - Initial", "color": "#d32f2f"},
    {"key": "managed", "label": "2 - Managed", "color": "#ff9800"},
    {"key": "defined", "label": "3 - Defined", "color": "#fbc02d"},
    {"key": "measured", "label": "4 - Measured", "color": "#66bb6a"},
    {"key": "optimized", "label": "5 - Optimized", "color": "#2e7d32"},
]

AUTOMATION_LEVEL_OPTIONS = [
    {"key": "manual", "label": "Manual", "color": "#d32f2f"},
    {"key": "partiallyAutomated", "label": "Partially Automated", "color": "#ff9800"},
    {"key": "fullyAutomated", "label": "Fully Automated", "color": "#4caf50"},
]

PROCESS_RISK_OPTIONS = [
    {"key": "low", "label": "Low", "color": "#4caf50"},
    {"key": "medium", "label": "Medium", "color": "#ff9800"},
    {"key": "high", "label": "High", "color": "#f44336"},
    {"key": "critical", "label": "Critical", "color": "#b71c1c"},
]

PROCESS_FREQUENCY_OPTIONS = [
    {"key": "adHoc", "label": "Ad Hoc"},
    {"key": "daily", "label": "Daily"},
    {"key": "weekly", "label": "Weekly"},
    {"key": "monthly", "label": "Monthly"},
    {"key": "quarterly", "label": "Quarterly"},
    {"key": "yearly", "label": "Yearly"},
    {"key": "continuous", "label": "Continuous"},
]

# ── 14 Fact Sheet Types (from Meta_Model.xml + BPM) ──────────────────

TYPES = [
    # -- Strategy & Transformation layer --
    {
        "key": "Objective",
        "label": "Objective",
        "description": "Strategic objectives and goals that drive the enterprise architecture.",
        "icon": "flag",
        "color": "#c7527d",
        "category": "Strategy & Transformation",
        "has_hierarchy": False,
        "subtypes": [],
        "sort_order": 0,
        "fields_schema": [
            {
                "section": "Objective Information",
                "fields": [
                    {"key": "objectiveType", "label": "Objective Type", "type": "single_select", "options": [
                        {"key": "strategic", "label": "Strategic"},
                        {"key": "tactical", "label": "Tactical"},
                        {"key": "operational", "label": "Operational"},
                    ], "weight": 1},
                    {"key": "targetDate", "label": "Target Date", "type": "date", "weight": 1},
                    {"key": "progress", "label": "Progress (%)", "type": "number", "weight": 1},
                ],
            },
        ],
    },
    {
        "key": "Platform",
        "label": "Platform",
        "description": "Technology or business platforms that group applications and components.",
        "icon": "layers",
        "color": "#027446",
        "category": "Strategy & Transformation",
        "has_hierarchy": False,
        "subtypes": [
            {"key": "digital", "label": "Digital"},
            {"key": "technical", "label": "Technical"},
        ],
        "sort_order": 1,
        "fields_schema": [
            {
                "section": "Platform Information",
                "fields": [
                    {"key": "platformType", "label": "Platform Type", "type": "single_select", "options": [
                        {"key": "digital", "label": "Digital", "color": "#1976d2"},
                        {"key": "technical", "label": "Technical", "color": "#607d8b"},
                    ], "weight": 1},
                ],
            },
        ],
    },
    {
        "key": "Initiative",
        "label": "Initiative",
        "description": "Projects, programs, and epics that transform the enterprise architecture.",
        "icon": "rocket_launch",
        "color": "#33cc58",
        "category": "Strategy & Transformation",
        "has_hierarchy": True,
        "subtypes": [
            {"key": "idea", "label": "Idea"},
            {"key": "program", "label": "Program"},
            {"key": "project", "label": "Project"},
            {"key": "epic", "label": "Epic"},
        ],
        "sort_order": 2,
        "fields_schema": [
            {
                "section": "Initiative Information",
                "fields": [
                    {"key": "initiativeStatus", "label": "Status", "type": "single_select", "options": INITIATIVE_STATUS_OPTIONS, "weight": 2},
                    {"key": "businessValue", "label": "Business Value", "type": "single_select", "options": [
                        {"key": "high", "label": "High", "color": "#2e7d32"},
                        {"key": "medium", "label": "Medium", "color": "#ff9800"},
                        {"key": "low", "label": "Low", "color": "#9e9e9e"},
                    ], "weight": 1},
                    {"key": "effort", "label": "Effort", "type": "single_select", "options": [
                        {"key": "high", "label": "High", "color": "#d32f2f"},
                        {"key": "medium", "label": "Medium", "color": "#ff9800"},
                        {"key": "low", "label": "Low", "color": "#4caf50"},
                    ], "weight": 1},
                ],
            },
            {
                "section": "Cost & Timeline",
                "fields": [
                    {"key": "costBudget", "label": "Budget", "type": "number", "weight": 1},
                    {"key": "costActual", "label": "Actual Cost", "type": "number", "weight": 0},
                    {"key": "startDate", "label": "Start Date", "type": "date", "weight": 1},
                    {"key": "endDate", "label": "End Date", "type": "date", "weight": 1},
                ],
            },
        ],
    },
    # -- Business Architecture layer --
    {
        "key": "Organization",
        "label": "Organization",
        "description": "Organizational units, regions, legal entities, teams, and customers.",
        "icon": "corporate_fare",
        "color": "#2889ff",
        "category": "Business Architecture",
        "has_hierarchy": True,
        "subtypes": [
            {"key": "businessUnit", "label": "Business Unit"},
            {"key": "region", "label": "Region"},
            {"key": "legalEntity", "label": "Legal Entity"},
            {"key": "team", "label": "Team"},
            {"key": "customer", "label": "Customer"},
        ],
        "sort_order": 3,
        "fields_schema": [
            {
                "section": "Organization Information",
                "fields": [
                    {"key": "headCount", "label": "Head Count", "type": "number", "weight": 0},
                    {"key": "location", "label": "Location", "type": "text", "weight": 0},
                ],
            },
        ],
    },
    {
        "key": "BusinessCapability",
        "label": "Business Capability",
        "description": "Stable decomposition of what the business does, independent of how it is done.",
        "icon": "account_tree",
        "color": "#003399",
        "category": "Business Architecture",
        "has_hierarchy": True,
        "subtypes": [],
        "sort_order": 4,
        "fields_schema": [
            {
                "section": "Capability Information",
                "fields": [
                    {"key": "capabilityLevel", "label": "Capability Level", "type": "single_select", "readonly": True, "options": [
                        {"key": "L1", "label": "Level 1", "color": "#1565c0"},
                        {"key": "L2", "label": "Level 2", "color": "#42a5f5"},
                        {"key": "L3", "label": "Level 3", "color": "#90caf9"},
                        {"key": "L4", "label": "Level 4", "color": "#bbdefb"},
                        {"key": "L5", "label": "Level 5", "color": "#e3f2fd"},
                    ], "weight": 0},
                    {"key": "isCoreCapability", "label": "Core Capability", "type": "boolean", "weight": 0},
                ],
            },
            {
                "section": "BPM Assessment",
                "fields": [
                    {"key": "strategicImportance", "label": "Strategic Importance", "type": "single_select",
                     "options": [
                         {"key": "low", "label": "Low", "color": "#9e9e9e"},
                         {"key": "medium", "label": "Medium", "color": "#ff9800"},
                         {"key": "high", "label": "High", "color": "#1976d2"},
                         {"key": "critical", "label": "Critical", "color": "#d32f2f"},
                     ], "weight": 1},
                    {"key": "maturity", "label": "Capability Maturity", "type": "single_select",
                     "options": PROCESS_MATURITY_OPTIONS, "weight": 1},
                ],
            },
        ],
    },
    {
        "key": "BusinessContext",
        "label": "Business Context",
        "description": "Business processes, value streams, customer journeys, and products.",
        "icon": "swap_horiz",
        "color": "#fe6690",
        "category": "Business Architecture",
        "has_hierarchy": True,
        "subtypes": [
            {"key": "process", "label": "Process"},
            {"key": "valueStream", "label": "Value Stream"},
            {"key": "customerJourney", "label": "Customer Journey"},
            {"key": "businessProduct", "label": "Business Product"},
            {"key": "esgCapability", "label": "ESG Capability"},
        ],
        "sort_order": 5,
        "fields_schema": [
            {
                "section": "Business Context Information",
                "fields": [
                    {"key": "maturity", "label": "Maturity", "type": "single_select", "options": [
                        {"key": "initial", "label": "Initial", "color": "#d32f2f"},
                        {"key": "defined", "label": "Defined", "color": "#ff9800"},
                        {"key": "managed", "label": "Managed", "color": "#fbc02d"},
                        {"key": "optimized", "label": "Optimized", "color": "#4caf50"},
                    ], "weight": 1},
                ],
            },
        ],
    },
    # -- BPM layer --
    {
        "key": "BusinessProcess",
        "label": "Business Process",
        "description": "Business processes with BPMN 2.0 flow modeling, lifecycle, and maturity tracking.",
        "icon": "route",
        "color": "#e65100",
        "category": "Business Architecture",
        "has_hierarchy": True,
        "subtypes": [
            {"key": "category", "label": "Process Category"},
            {"key": "group", "label": "Process Group"},
            {"key": "process", "label": "Process"},
            {"key": "variant", "label": "Process Variant"},
        ],
        "sort_order": 6,
        "fields_schema": [
            {
                "section": "Process Classification",
                "fields": [
                    {"key": "processType", "label": "Process Type", "type": "single_select",
                     "required": True, "options": PROCESS_TYPE_OPTIONS, "weight": 2},
                    {"key": "maturity", "label": "Maturity (CMMI)", "type": "single_select",
                     "options": PROCESS_MATURITY_OPTIONS, "weight": 2},
                    {"key": "automationLevel", "label": "Automation Level", "type": "single_select",
                     "options": AUTOMATION_LEVEL_OPTIONS, "weight": 1},
                    {"key": "riskLevel", "label": "Risk Level", "type": "single_select",
                     "options": PROCESS_RISK_OPTIONS, "weight": 1},
                ],
            },
            {
                "section": "Operational Details",
                "fields": [
                    {"key": "frequency", "label": "Execution Frequency", "type": "single_select",
                     "options": PROCESS_FREQUENCY_OPTIONS, "weight": 1},
                    {"key": "responsibleOrg", "label": "Responsible Organization", "type": "text", "weight": 0},
                    {"key": "documentationUrl", "label": "Process Documentation URL", "type": "text", "weight": 0},
                    {"key": "regulatoryRelevance", "label": "Regulatory Relevance", "type": "boolean", "weight": 1},
                ],
            },
        ],
        "subscription_roles": [
            {"key": "responsible", "label": "Responsible"},
            {"key": "process_owner", "label": "Process Owner"},
            {"key": "observer", "label": "Observer"},
        ],
    },
    # -- Application & Data Architecture layer --
    {
        "key": "Application",
        "label": "Application",
        "description": "Software applications, microservices, and deployments in the IT landscape.",
        "icon": "apps",
        "color": "#0f7eb5",
        "category": "Application & Data",
        "has_hierarchy": True,
        "subtypes": [
            {"key": "businessApplication", "label": "Business Application"},
            {"key": "microservice", "label": "Microservice"},
            {"key": "aiAgent", "label": "AI Agent"},
            {"key": "deployment", "label": "Deployment"},
        ],
        "sort_order": 7,
        "fields_schema": [
            {
                "section": "Application Information",
                "fields": [
                    {"key": "businessCriticality", "label": "Business Criticality", "type": "single_select", "required": True, "options": BUSINESS_CRITICALITY_OPTIONS, "weight": 2},
                    {"key": "functionalSuitability", "label": "Functional Suitability", "type": "single_select", "options": FUNCTIONAL_SUITABILITY_OPTIONS, "weight": 2},
                    {"key": "technicalSuitability", "label": "Technical Suitability", "type": "single_select", "options": TECHNICAL_SUITABILITY_OPTIONS, "weight": 2},
                    {"key": "timeModel", "label": "TIME Model", "type": "single_select", "required": True, "options": TIME_MODEL_OPTIONS, "weight": 3},
                    {"key": "hostingType", "label": "Hosting Type", "type": "single_select", "options": HOSTING_TYPE_OPTIONS, "weight": 1},
                ],
            },
            {
                "section": "Cost & Ownership",
                "fields": [
                    {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "number", "weight": 1},
                    {"key": "numberOfUsers", "label": "Number of Users", "type": "number", "weight": 0},
                    {"key": "vendor", "label": "Vendor", "type": "text", "weight": 0},
                    {"key": "productName", "label": "Product Name", "type": "text", "weight": 0},
                ],
            },
        ],
    },
    {
        "key": "Interface",
        "label": "Interface",
        "description": "Data flows and integrations between applications.",
        "icon": "sync_alt",
        "color": "#02afa4",
        "category": "Application & Data",
        "has_hierarchy": False,
        "subtypes": [
            {"key": "logicalInterface", "label": "Logical Interface"},
            {"key": "api", "label": "API"},
            {"key": "mcpServer", "label": "MCP Server"},
        ],
        "sort_order": 8,
        "fields_schema": [
            {
                "section": "Interface Information",
                "fields": [
                    {"key": "frequency", "label": "Frequency", "type": "single_select", "options": FREQUENCY_OPTIONS, "weight": 1},
                    {"key": "dataFormat", "label": "Data Format", "type": "text", "weight": 0},
                    {"key": "protocol", "label": "Protocol", "type": "text", "weight": 0},
                ],
            },
        ],
    },
    {
        "key": "DataObject",
        "label": "Data Object",
        "description": "Business data objects and their classifications.",
        "icon": "database",
        "color": "#774fcc",
        "category": "Application & Data",
        "has_hierarchy": True,
        "subtypes": [],
        "sort_order": 9,
        "fields_schema": [
            {
                "section": "Data Information",
                "fields": [
                    {"key": "dataSensitivity", "label": "Data Sensitivity", "type": "single_select", "options": DATA_SENSITIVITY_OPTIONS, "weight": 1},
                    {"key": "dataOwner", "label": "Data Owner", "type": "text", "weight": 0},
                    {"key": "isPersonalData", "label": "Contains Personal Data", "type": "boolean", "weight": 1},
                ],
            },
        ],
    },
    # -- Technical Architecture layer --
    {
        "key": "ITComponent",
        "label": "IT Component",
        "description": "Technology components: software, hardware, SaaS, PaaS, IaaS, services.",
        "icon": "memory",
        "color": "#d29270",
        "category": "Technical Architecture",
        "has_hierarchy": True,
        "subtypes": [
            {"key": "software", "label": "Software"},
            {"key": "hardware", "label": "Hardware"},
            {"key": "saas", "label": "SaaS"},
            {"key": "paas", "label": "PaaS"},
            {"key": "iaas", "label": "IaaS"},
            {"key": "service", "label": "Service"},
            {"key": "aiModel", "label": "AI Model"},
        ],
        "sort_order": 10,
        "fields_schema": [
            {
                "section": "Component Information",
                "fields": [
                    {"key": "technicalSuitability", "label": "Technical Suitability", "type": "single_select", "options": TECHNICAL_SUITABILITY_OPTIONS, "weight": 2},
                    {"key": "resourceClassification", "label": "Resource Classification", "type": "single_select", "options": RESOURCE_CLASSIFICATION_OPTIONS, "weight": 2},
                    {"key": "vendor", "label": "Vendor", "type": "text", "weight": 0},
                    {"key": "version", "label": "Version", "type": "text", "weight": 0},
                ],
            },
            {
                "section": "Cost",
                "fields": [
                    {"key": "costTotalAnnual", "label": "Total Annual Cost", "type": "number", "weight": 1},
                    {"key": "licenseType", "label": "License Type", "type": "text", "weight": 0},
                ],
            },
        ],
    },
    {
        "key": "TechCategory",
        "label": "Tech Category",
        "description": "Technology categories for classifying IT components (e.g., Databases, Middleware).",
        "icon": "category",
        "color": "#a6566d",
        "category": "Technical Architecture",
        "has_hierarchy": True,
        "subtypes": [],
        "sort_order": 11,
        "fields_schema": [],
    },
    {
        "key": "Provider",
        "label": "Provider",
        "description": "External technology providers and vendors.",
        "icon": "storefront",
        "color": "#ffa31f",
        "category": "Technical Architecture",
        "has_hierarchy": False,
        "subtypes": [],
        "sort_order": 12,
        "fields_schema": [
            {
                "section": "Provider Information",
                "fields": [
                    {"key": "providerType", "label": "Provider Type", "type": "single_select", "options": [
                        {"key": "vendor", "label": "Vendor"},
                        {"key": "partner", "label": "Partner"},
                        {"key": "internalProvider", "label": "Internal Provider"},
                    ], "weight": 1},
                    {"key": "website", "label": "Website", "type": "text", "weight": 0},
                    {"key": "contractEnd", "label": "Contract End Date", "type": "date", "weight": 0},
                ],
            },
        ],
    },
    {
        "key": "System",
        "label": "System",
        "description": "Technical systems and runtime environments.",
        "icon": "dns",
        "color": "#5B738B",
        "category": "Technical Architecture",
        "has_hierarchy": False,
        "subtypes": [],
        "sort_order": 13,
        "is_hidden": False,
        "fields_schema": [
            {
                "section": "System Information",
                "fields": [
                    {"key": "systemType", "label": "System Type", "type": "single_select", "options": [
                        {"key": "cluster", "label": "Cluster"},
                        {"key": "server", "label": "Server"},
                        {"key": "virtualMachine", "label": "Virtual Machine"},
                        {"key": "container", "label": "Container"},
                    ], "weight": 1},
                    {"key": "environment", "label": "Environment", "type": "single_select", "options": [
                        {"key": "production", "label": "Production", "color": "#d32f2f"},
                        {"key": "staging", "label": "Staging", "color": "#ff9800"},
                        {"key": "development", "label": "Development", "color": "#4caf50"},
                        {"key": "test", "label": "Test", "color": "#2196f3"},
                    ], "weight": 1},
                ],
            },
        ],
    },
]


# ── Relations (from Meta_Model.xml — verbs are the edge labels) ────────

RELATIONS = [
    # Strategy & Transformation connections
    {"key": "relObjectiveToBC", "label": "improves", "reverse_label": "is improved by", "source_type_key": "Objective", "target_type_key": "BusinessCapability", "cardinality": "n:m", "sort_order": 0},
    {"key": "relPlatformToObjective", "label": "supports", "reverse_label": "is supported by", "source_type_key": "Platform", "target_type_key": "Objective", "cardinality": "n:m", "sort_order": 1},
    {"key": "relPlatformToApp", "label": "runs", "reverse_label": "runs on", "source_type_key": "Platform", "target_type_key": "Application", "cardinality": "n:m", "sort_order": 2},
    {"key": "relPlatformToITC", "label": "implements", "reverse_label": "is implemented by", "source_type_key": "Platform", "target_type_key": "ITComponent", "cardinality": "n:m", "sort_order": 3},
    {"key": "relInitiativeToObjective", "label": "supports", "reverse_label": "is supported by", "source_type_key": "Initiative", "target_type_key": "Objective", "cardinality": "n:m", "sort_order": 4},
    {"key": "relInitiativeToPlatform", "label": "affects", "reverse_label": "is affected by", "source_type_key": "Initiative", "target_type_key": "Platform", "cardinality": "n:m", "sort_order": 5},
    {"key": "relInitiativeToBC", "label": "improves", "reverse_label": "is improved by", "source_type_key": "Initiative", "target_type_key": "BusinessCapability", "cardinality": "n:m", "sort_order": 6},
    {"key": "relInitiativeToApp", "label": "affects", "reverse_label": "is affected by", "source_type_key": "Initiative", "target_type_key": "Application", "cardinality": "n:m", "sort_order": 7},
    {"key": "relInitiativeToInterface", "label": "affects", "reverse_label": "is affected by", "source_type_key": "Initiative", "target_type_key": "Interface", "cardinality": "n:m", "sort_order": 8},
    {"key": "relInitiativeToDataObj", "label": "affects", "reverse_label": "is affected by", "source_type_key": "Initiative", "target_type_key": "DataObject", "cardinality": "n:m", "sort_order": 9},
    {"key": "relInitiativeToITC", "label": "affects", "reverse_label": "is affected by", "source_type_key": "Initiative", "target_type_key": "ITComponent", "cardinality": "n:m", "sort_order": 10},
    {"key": "relInitiativeToSystem", "label": "affects", "reverse_label": "is affected by", "source_type_key": "Initiative", "target_type_key": "System", "cardinality": "n:m", "sort_order": 11},

    # Organization connections
    {"key": "relOrgToObjective", "label": "owns", "reverse_label": "is owned by", "source_type_key": "Organization", "target_type_key": "Objective", "cardinality": "n:m", "sort_order": 12},
    {"key": "relOrgToInitiative", "label": "owns", "reverse_label": "is owned by", "source_type_key": "Organization", "target_type_key": "Initiative", "cardinality": "n:m", "sort_order": 13},
    {"key": "relOrgToBizCtx", "label": "owns", "reverse_label": "is owned by", "source_type_key": "Organization", "target_type_key": "BusinessContext", "cardinality": "n:m", "sort_order": 14},
    {"key": "relOrgToApp", "label": "uses", "reverse_label": "is used by", "source_type_key": "Organization", "target_type_key": "Application", "cardinality": "n:m", "sort_order": 15, "attributes_schema": [
        {"key": "usageType", "label": "Usage Type", "type": "single_select", "options": USAGE_TYPE_OPTIONS},
    ]},
    {"key": "relOrgToITC", "label": "owns", "reverse_label": "is owned by", "source_type_key": "Organization", "target_type_key": "ITComponent", "cardinality": "n:m", "sort_order": 16},

    # Application connections
    {"key": "relAppToBC", "label": "supports", "reverse_label": "is supported by", "source_type_key": "Application", "target_type_key": "BusinessCapability", "cardinality": "n:m", "sort_order": 17, "attributes_schema": [
        {"key": "functionalSuitability", "label": "Functional Suitability", "type": "single_select", "options": FUNCTIONAL_SUITABILITY_OPTIONS},
        {"key": "supportType", "label": "Support Type", "type": "single_select", "options": SUPPORT_TYPE_OPTIONS},
    ]},
    {"key": "relAppToBizCtx", "label": "supports", "reverse_label": "is supported by", "source_type_key": "Application", "target_type_key": "BusinessContext", "cardinality": "n:m", "sort_order": 18},
    {"key": "relAppToInterface", "label": "provides / consumes", "reverse_label": "is provided / consumed by", "source_type_key": "Application", "target_type_key": "Interface", "cardinality": "n:m", "sort_order": 19},
    {"key": "relAppToDataObj", "label": "CRUD", "reverse_label": "is used by", "source_type_key": "Application", "target_type_key": "DataObject", "cardinality": "n:m", "sort_order": 20, "attributes_schema": [
        {"key": "crudCreate", "label": "Create", "type": "boolean"},
        {"key": "crudRead", "label": "Read", "type": "boolean"},
        {"key": "crudUpdate", "label": "Update", "type": "boolean"},
        {"key": "crudDelete", "label": "Delete", "type": "boolean"},
    ]},
    {"key": "relAppToITC", "label": "uses", "reverse_label": "is used by", "source_type_key": "Application", "target_type_key": "ITComponent", "cardinality": "n:m", "sort_order": 21, "attributes_schema": [
        {"key": "technicalSuitability", "label": "Technical Suitability", "type": "single_select", "options": TECHNICAL_SUITABILITY_OPTIONS},
        {"key": "costTotalAnnual", "label": "Annual Cost", "type": "number"},
    ]},
    {"key": "relAppToSystem", "label": "runs on", "reverse_label": "runs", "source_type_key": "Application", "target_type_key": "System", "cardinality": "n:m", "sort_order": 22},

    # IT Component connections
    {"key": "relITCToTechCat", "label": "belongs to", "reverse_label": "includes", "source_type_key": "ITComponent", "target_type_key": "TechCategory", "cardinality": "n:m", "sort_order": 23, "attributes_schema": [
        {"key": "resourceClassification", "label": "Resource Classification", "type": "single_select", "options": RESOURCE_CLASSIFICATION_OPTIONS},
    ]},
    {"key": "relITCToPlatform", "label": "implements", "reverse_label": "is implemented by", "source_type_key": "ITComponent", "target_type_key": "Platform", "cardinality": "n:m", "sort_order": 24},

    # Interface connections
    {"key": "relInterfaceToDataObj", "label": "transfers", "reverse_label": "is transferred by", "source_type_key": "Interface", "target_type_key": "DataObject", "cardinality": "n:m", "sort_order": 25},
    {"key": "relInterfaceToITC", "label": "uses", "reverse_label": "is used by", "source_type_key": "Interface", "target_type_key": "ITComponent", "cardinality": "n:m", "sort_order": 26},

    # Provider connections
    {"key": "relProviderToInitiative", "label": "supports", "reverse_label": "is supported by", "source_type_key": "Provider", "target_type_key": "Initiative", "cardinality": "n:m", "sort_order": 27},
    {"key": "relProviderToITC", "label": "offers", "reverse_label": "is offered by", "source_type_key": "Provider", "target_type_key": "ITComponent", "cardinality": "n:m", "sort_order": 28},

    # Business Context connections
    {"key": "relBizCtxToBC", "label": "is associated with", "reverse_label": "is associated with", "source_type_key": "BusinessContext", "target_type_key": "BusinessCapability", "cardinality": "n:m", "sort_order": 29},

    # BPM — Business Process connections
    {"key": "relProcessToBC", "label": "supports", "reverse_label": "is supported by",
     "source_type_key": "BusinessProcess", "target_type_key": "BusinessCapability",
     "cardinality": "n:m", "sort_order": 30, "attributes_schema": [
         {"key": "supportType", "label": "Support Type", "type": "single_select", "options": SUPPORT_TYPE_OPTIONS},
     ]},
    {"key": "relProcessToApp", "label": "is supported by", "reverse_label": "supports",
     "source_type_key": "BusinessProcess", "target_type_key": "Application",
     "cardinality": "n:m", "sort_order": 31, "attributes_schema": [
         {"key": "usageType", "label": "Usage", "type": "single_select", "options": [
             {"key": "creates", "label": "Creates"},
             {"key": "reads", "label": "Reads"},
             {"key": "updates", "label": "Updates"},
             {"key": "deletes", "label": "Deletes"},
             {"key": "orchestrates", "label": "Orchestrates"},
         ]},
         {"key": "criticality", "label": "Criticality", "type": "single_select", "options": [
             {"key": "low", "label": "Low", "color": "#4caf50"},
             {"key": "medium", "label": "Medium", "color": "#ff9800"},
             {"key": "high", "label": "High", "color": "#f44336"},
             {"key": "critical", "label": "Critical", "color": "#b71c1c"},
         ]},
     ]},
    {"key": "relProcessToDataObj", "label": "uses", "reverse_label": "is used by",
     "source_type_key": "BusinessProcess", "target_type_key": "DataObject",
     "cardinality": "n:m", "sort_order": 32, "attributes_schema": [
         {"key": "crudCreate", "label": "Create", "type": "boolean"},
         {"key": "crudRead", "label": "Read", "type": "boolean"},
         {"key": "crudUpdate", "label": "Update", "type": "boolean"},
         {"key": "crudDelete", "label": "Delete", "type": "boolean"},
     ]},
    {"key": "relProcessToITC", "label": "uses", "reverse_label": "is used by",
     "source_type_key": "BusinessProcess", "target_type_key": "ITComponent",
     "cardinality": "n:m", "sort_order": 33},
    {"key": "relProcessDependency", "label": "depends on", "reverse_label": "is depended on by",
     "source_type_key": "BusinessProcess", "target_type_key": "BusinessProcess",
     "cardinality": "n:m", "sort_order": 34},
    {"key": "relProcessToOrg", "label": "is owned by", "reverse_label": "owns",
     "source_type_key": "BusinessProcess", "target_type_key": "Organization",
     "cardinality": "n:m", "sort_order": 35},
    {"key": "relProcessToInitiative", "label": "is affected by", "reverse_label": "affects",
     "source_type_key": "BusinessProcess", "target_type_key": "Initiative",
     "cardinality": "n:m", "sort_order": 36},
    {"key": "relProcessToObjective", "label": "supports", "reverse_label": "is supported by",
     "source_type_key": "BusinessProcess", "target_type_key": "Objective",
     "cardinality": "n:m", "sort_order": 37},
    {"key": "relProcessToBizCtx", "label": "realizes", "reverse_label": "is realized by",
     "source_type_key": "BusinessProcess", "target_type_key": "BusinessContext",
     "cardinality": "n:m", "sort_order": 38},
]


async def seed_metamodel(db: AsyncSession) -> None:
    """Seed the default metamodel, adding any missing types and relations.

    On a fresh DB every type and relation is inserted. On an existing DB,
    only types/relations whose key is not yet present are added, and
    existing built-in types get their fields_schema updated to pick up
    new sections (e.g. the BPM Assessment section on BusinessCapability).
    """
    _default_roles = [
        {"key": "responsible", "label": "Responsible"},
        {"key": "observer", "label": "Observer"},
    ]
    _app_roles = _default_roles + [
        {"key": "technical_application_owner", "label": "Technical Application Owner"},
        {"key": "business_application_owner", "label": "Business Application Owner"},
    ]

    # Load existing keys so we can skip or update
    existing_types_result = await db.execute(select(FactSheetType))
    existing_types = {t.key: t for t in existing_types_result.scalars().all()}

    existing_rels_result = await db.execute(select(RelationType))
    existing_rels = {r.key for r in existing_rels_result.scalars().all()}

    for i, t in enumerate(TYPES):
        key = t["key"]
        if key in existing_types:
            # Update fields_schema on existing built-in types so new sections
            # (like BPM Assessment on BusinessCapability) are picked up
            existing = existing_types[key]
            if existing.built_in:
                seed_schema = t.get("fields_schema", [])
                current_schema = existing.fields_schema or []
                current_sections = {s["section"] for s in current_schema}
                new_sections = [
                    s for s in seed_schema if s["section"] not in current_sections
                ]
                if new_sections:
                    existing.fields_schema = current_schema + new_sections
            continue

        roles = _app_roles if key == "Application" else _default_roles
        fst = FactSheetType(
            key=key,
            label=t["label"],
            description=t.get("description"),
            icon=t.get("icon", "category"),
            color=t.get("color", "#1976d2"),
            category=t.get("category"),
            has_hierarchy=t.get("has_hierarchy", False),
            subtypes=t.get("subtypes", []),
            fields_schema=t.get("fields_schema", []),
            subscription_roles=t.get("subscription_roles", roles),
            built_in=True,
            is_hidden=t.get("is_hidden", False),
            sort_order=t.get("sort_order", i),
        )
        db.add(fst)

    for i, r in enumerate(RELATIONS):
        if r["key"] in existing_rels:
            continue

        rt = RelationType(
            key=r["key"],
            label=r["label"],
            reverse_label=r.get("reverse_label"),
            description=r.get("description"),
            source_type_key=r["source_type_key"],
            target_type_key=r["target_type_key"],
            cardinality=r.get("cardinality", "n:m"),
            attributes_schema=r.get("attributes_schema", []),
            built_in=True,
            is_hidden=False,
            sort_order=r.get("sort_order", i),
        )
        db.add(rt)

    await db.commit()
