"""Seed the default LeanIX metamodel v4 — matched to the official Meta_Model.xml."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    ADMIN_PERMISSIONS,
    BPM_ADMIN_PERMISSIONS,
    DEFAULT_CARD_PERMISSIONS_BY_ROLE,
    MEMBER_PERMISSIONS,
    VIEWER_PERMISSIONS,
)
from app.models.card_type import CardType
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition

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

# ── 14 Card Types (from Meta_Model.xml + BPM) ────────────────────────

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
                    {
                        "key": "objectiveType",
                        "label": "Objective Type",
                        "type": "single_select",
                        "options": [
                            {"key": "strategic", "label": "Strategic"},
                            {"key": "tactical", "label": "Tactical"},
                            {"key": "operational", "label": "Operational"},
                        ],
                        "weight": 1,
                    },
                    {"key": "targetDate", "label": "Target Date", "type": "date", "weight": 1},
                    {"key": "progress", "label": "Progress (%)", "type": "number", "weight": 1},
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Ziel",
                "fr": "Objectif",
                "es": "Objetivo",
                "it": "Obiettivo",
                "pt": "Objetivo",
                "zh": "目标",
            },
            "description": {
                "de": "Strategische Ziele und Vorgaben, die die Unternehmensarchitektur vorantreiben.",
                "fr": "Objectifs stratégiques qui orientent l'architecture d'entreprise.",
                "es": "Objetivos estratégicos que impulsan la arquitectura empresarial.",
                "it": "Obiettivi strategici che guidano l'architettura aziendale.",
                "pt": "Objetivos estratégicos que direcionam a arquitetura empresarial.",
                "zh": "驱动企业架构的战略目标。",
            },
        },
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
                    {
                        "key": "platformType",
                        "label": "Platform Type",
                        "type": "single_select",
                        "options": [
                            {"key": "digital", "label": "Digital", "color": "#1976d2"},
                            {"key": "technical", "label": "Technical", "color": "#607d8b"},
                        ],
                        "weight": 1,
                    },
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Plattform",
                "fr": "Plateforme",
                "es": "Plataforma",
                "it": "Piattaforma",
                "pt": "Plataforma",
                "zh": "平台",
            },
            "description": {
                "de": "Technologie- oder Geschäftsplattformen, die Anwendungen und Komponenten bündeln.",
                "fr": "Plateformes technologiques ou métier regroupant applications et composants.",
                "es": "Plataformas tecnológicas o de negocio que agrupan aplicaciones y componentes.",
                "it": "Piattaforme tecnologiche o di business che raggruppano applicazioni e componenti.",
                "pt": "Plataformas de tecnologia ou negócio que agrupam aplicações e componentes.",
                "zh": "将应用和组件进行分组的技术或业务平台。",
            },
        },
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
                    {
                        "key": "initiativeStatus",
                        "label": "Status",
                        "type": "single_select",
                        "options": INITIATIVE_STATUS_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "businessValue",
                        "label": "Business Value",
                        "type": "single_select",
                        "options": [
                            {"key": "high", "label": "High", "color": "#2e7d32"},
                            {"key": "medium", "label": "Medium", "color": "#ff9800"},
                            {"key": "low", "label": "Low", "color": "#9e9e9e"},
                        ],
                        "weight": 1,
                    },
                    {
                        "key": "effort",
                        "label": "Effort",
                        "type": "single_select",
                        "options": [
                            {"key": "high", "label": "High", "color": "#d32f2f"},
                            {"key": "medium", "label": "Medium", "color": "#ff9800"},
                            {"key": "low", "label": "Low", "color": "#4caf50"},
                        ],
                        "weight": 1,
                    },
                ],
            },
            {
                "section": "Cost & Timeline",
                "fields": [
                    {"key": "costBudget", "label": "Budget", "type": "cost", "weight": 1},
                    {"key": "costActual", "label": "Actual Cost", "type": "cost", "weight": 0},
                    {"key": "startDate", "label": "Start Date", "type": "date", "weight": 1},
                    {"key": "endDate", "label": "End Date", "type": "date", "weight": 1},
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Initiative",
                "fr": "Initiative",
                "es": "Iniciativa",
                "it": "Iniziativa",
                "pt": "Iniciativa",
                "zh": "举措",
            },
            "description": {
                "de": "Projekte, Programme und Epics, die die Unternehmensarchitektur transformieren.",
                "fr": "Projets, programmes et epics qui transforment l'architecture d'entreprise.",
                "es": "Proyectos, programas y epics que transforman la arquitectura empresarial.",
                "it": "Progetti, programmi ed epic che trasformano l'architettura aziendale.",
                "pt": "Projetos, programas e épicos que transformam a arquitetura empresarial.",
                "zh": "转变企业架构的项目、计划和史诗。",
            },
        },
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
        "translations": {
            "label": {
                "de": "Organisation",
                "fr": "Organisation",
                "es": "Organización",
                "it": "Organizzazione",
                "pt": "Organização",
                "zh": "组织",
            },
            "description": {
                "de": "Organisationseinheiten, Regionen, Rechtseinheiten, Teams und Kunden.",
                "fr": "Unités organisationnelles, régions, entités juridiques, équipes et clients.",
                "es": "Unidades organizativas, regiones, entidades legales, equipos y clientes.",
                "it": "Unità organizzative, regioni, entità giuridiche, team e clienti.",
                "pt": "Unidades organizacionais, regiões, entidades legais, equipes e clientes.",
                "zh": "组织单元、区域、法律实体、团队和客户。",
            },
        },
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
                    {
                        "key": "capabilityLevel",
                        "label": "Capability Level",
                        "type": "single_select",
                        "readonly": True,
                        "options": [
                            {"key": "L1", "label": "Level 1", "color": "#1565c0"},
                            {"key": "L2", "label": "Level 2", "color": "#42a5f5"},
                            {"key": "L3", "label": "Level 3", "color": "#90caf9"},
                            {"key": "L4", "label": "Level 4", "color": "#bbdefb"},
                            {"key": "L5", "label": "Level 5", "color": "#e3f2fd"},
                        ],
                        "weight": 0,
                    },
                    {
                        "key": "isCoreCapability",
                        "label": "Core Capability",
                        "type": "boolean",
                        "weight": 0,
                    },
                ],
            },
            {
                "section": "BPM Assessment",
                "fields": [
                    {
                        "key": "strategicImportance",
                        "label": "Strategic Importance",
                        "type": "single_select",
                        "options": [
                            {"key": "low", "label": "Low", "color": "#9e9e9e"},
                            {"key": "medium", "label": "Medium", "color": "#ff9800"},
                            {"key": "high", "label": "High", "color": "#1976d2"},
                            {"key": "critical", "label": "Critical", "color": "#d32f2f"},
                        ],
                        "weight": 1,
                    },
                    {
                        "key": "maturity",
                        "label": "Capability Maturity",
                        "type": "single_select",
                        "options": PROCESS_MATURITY_OPTIONS,
                        "weight": 1,
                    },
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Geschäftsfähigkeit",
                "fr": "Capacité métier",
                "es": "Capacidad de negocio",
                "it": "Capacità aziendale",
                "pt": "Capacidade de negócio",
                "zh": "业务能力",
            },
            "description": {
                "de": "Stabile Zerlegung dessen, was das Unternehmen tut, unabhängig davon, wie es umgesetzt wird.",
                "fr": "Décomposition stable de ce que fait l'entreprise, indépendamment de la mise en œuvre.",
                "es": "Descomposición estable de lo que hace la empresa, independiente de cómo se realiza.",
                "it": "Scomposizione stabile di ciò che fa l'azienda, indipendente da come viene realizzata.",
                "pt": "Decomposição estável do que a empresa faz, independente de como é realizado.",
                "zh": "企业职能的稳定分解，与具体实现方式无关。",
            },
        },
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
                    {
                        "key": "maturity",
                        "label": "Maturity",
                        "type": "single_select",
                        "options": [
                            {"key": "initial", "label": "Initial", "color": "#d32f2f"},
                            {"key": "defined", "label": "Defined", "color": "#ff9800"},
                            {"key": "managed", "label": "Managed", "color": "#fbc02d"},
                            {"key": "optimized", "label": "Optimized", "color": "#4caf50"},
                        ],
                        "weight": 1,
                    },
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Geschäftskontext",
                "fr": "Contexte métier",
                "es": "Contexto de negocio",
                "it": "Contesto aziendale",
                "pt": "Contexto de negócio",
                "zh": "业务上下文",
            },
            "description": {
                "de": "Geschäftsprozesse, Wertströme, Customer Journeys und Produkte.",
                "fr": "Processus métier, chaînes de valeur, parcours clients et produits.",
                "es": "Procesos de negocio, cadenas de valor, recorridos del cliente y productos.",
                "it": "Processi aziendali, flussi di valore, percorsi del cliente e prodotti.",
                "pt": "Processos de negócio, cadeias de valor, jornadas do cliente e produtos.",
                "zh": "业务流程、价值流、客户旅程和产品。",
            },
        },
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
                    {
                        "key": "processType",
                        "label": "Process Type",
                        "type": "single_select",
                        "required": True,
                        "options": PROCESS_TYPE_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "maturity",
                        "label": "Maturity (CMMI)",
                        "type": "single_select",
                        "options": PROCESS_MATURITY_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "automationLevel",
                        "label": "Automation Level",
                        "type": "single_select",
                        "options": AUTOMATION_LEVEL_OPTIONS,
                        "weight": 1,
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "options": PROCESS_RISK_OPTIONS,
                        "weight": 1,
                    },
                ],
            },
            {
                "section": "Operational Details",
                "fields": [
                    {
                        "key": "frequency",
                        "label": "Execution Frequency",
                        "type": "single_select",
                        "options": PROCESS_FREQUENCY_OPTIONS,
                        "weight": 1,
                    },
                    {
                        "key": "documentationUrl",
                        "label": "Process Documentation URL",
                        "type": "url",
                        "weight": 0,
                    },
                    {
                        "key": "regulatoryRelevance",
                        "label": "Regulatory Relevance",
                        "type": "boolean",
                        "weight": 1,
                    },
                ],
            },
        ],
        "stakeholder_roles": [
            {"key": "responsible", "label": "Responsible"},
            {"key": "process_owner", "label": "Process Owner"},
            {"key": "observer", "label": "Observer"},
        ],
        "translations": {
            "label": {
                "de": "Geschäftsprozess",
                "fr": "Processus métier",
                "es": "Proceso de negocio",
                "it": "Processo aziendale",
                "pt": "Processo de negócio",
                "zh": "业务流程",
            },
            "description": {
                "de": "Geschäftsprozesse mit BPMN-2.0-Modellierung, Lebenszyklus- und Reifegradüberwachung.",
                "fr": "Processus métier avec modélisation BPMN 2.0, cycle de vie et suivi de maturité.",
                "es": "Procesos de negocio con modelado BPMN 2.0, ciclo de vida y seguimiento de madurez.",
                "it": "Processi aziendali con modellazione BPMN 2.0, ciclo di vita e monitoraggio della maturità.",
                "pt": "Processos de negócio com modelagem BPMN 2.0, ciclo de vida e acompanhamento de maturidade.",
                "zh": "具有BPMN 2.0流程建模、生命周期和成熟度跟踪的业务流程。",
            },
        },
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
                    {
                        "key": "businessCriticality",
                        "label": "Business Criticality",
                        "type": "single_select",
                        "required": True,
                        "options": BUSINESS_CRITICALITY_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "functionalSuitability",
                        "label": "Functional Suitability",
                        "type": "single_select",
                        "options": FUNCTIONAL_SUITABILITY_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "technicalSuitability",
                        "label": "Technical Suitability",
                        "type": "single_select",
                        "options": TECHNICAL_SUITABILITY_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "timeModel",
                        "label": "TIME Model",
                        "type": "single_select",
                        "required": True,
                        "options": TIME_MODEL_OPTIONS,
                        "weight": 3,
                    },
                    {
                        "key": "hostingType",
                        "label": "Hosting Type",
                        "type": "single_select",
                        "options": HOSTING_TYPE_OPTIONS,
                        "weight": 1,
                    },
                ],
            },
            {
                "section": "Cost & Ownership",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Total Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {
                        "key": "numberOfUsers",
                        "label": "Number of Users",
                        "type": "number",
                        "weight": 0,
                    },
                    {"key": "vendor", "label": "Vendor", "type": "text", "weight": 0},
                    {"key": "productName", "label": "Product Name", "type": "text", "weight": 0},
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Anwendung",
                "fr": "Application",
                "es": "Aplicación",
                "it": "Applicazione",
                "pt": "Aplicação",
                "zh": "应用程序",
            },
            "description": {
                "de": "Softwareanwendungen, Microservices und Deployments in der IT-Landschaft.",
                "fr": "Applications logicielles, microservices et déploiements dans le paysage IT.",
                "es": "Aplicaciones de software, microservicios y despliegues en el panorama de TI.",
                "it": "Applicazioni software, microservizi e distribuzioni nel panorama IT.",
                "pt": "Aplicações de software, microsserviços e implantações no cenário de TI.",
                "zh": "IT环境中的软件应用、微服务和部署。",
            },
        },
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
                    {
                        "key": "frequency",
                        "label": "Frequency",
                        "type": "single_select",
                        "options": FREQUENCY_OPTIONS,
                        "weight": 1,
                    },
                    {"key": "dataFormat", "label": "Data Format", "type": "text", "weight": 0},
                    {"key": "protocol", "label": "Protocol", "type": "text", "weight": 0},
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Schnittstelle",
                "fr": "Interface",
                "es": "Interfaz",
                "it": "Interfaccia",
                "pt": "Interface",
                "zh": "接口",
            },
            "description": {
                "de": "Datenflüsse und Integrationen zwischen Anwendungen.",
                "fr": "Flux de données et intégrations entre applications.",
                "es": "Flujos de datos e integraciones entre aplicaciones.",
                "it": "Flussi di dati e integrazioni tra applicazioni.",
                "pt": "Fluxos de dados e integrações entre aplicações.",
                "zh": "应用之间的数据流和集成。",
            },
        },
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
                    {
                        "key": "dataSensitivity",
                        "label": "Data Sensitivity",
                        "type": "single_select",
                        "options": DATA_SENSITIVITY_OPTIONS,
                        "weight": 1,
                    },
                    {"key": "dataOwner", "label": "Data Owner", "type": "text", "weight": 0},
                    {
                        "key": "isPersonalData",
                        "label": "Contains Personal Data",
                        "type": "boolean",
                        "weight": 1,
                    },
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Datenobjekt",
                "fr": "Objet de données",
                "es": "Objeto de datos",
                "it": "Oggetto dati",
                "pt": "Objeto de dados",
                "zh": "数据对象",
            },
            "description": {
                "de": "Geschäftsdatenobjekte und deren Klassifikationen.",
                "fr": "Objets de données métier et leurs classifications.",
                "es": "Objetos de datos de negocio y sus clasificaciones.",
                "it": "Oggetti dati aziendali e relative classificazioni.",
                "pt": "Objetos de dados de negócio e suas classificações.",
                "zh": "业务数据对象及其分类。",
            },
        },
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
                    {
                        "key": "technicalSuitability",
                        "label": "Technical Suitability",
                        "type": "single_select",
                        "options": TECHNICAL_SUITABILITY_OPTIONS,
                        "weight": 2,
                    },
                    {
                        "key": "resourceClassification",
                        "label": "Resource Classification",
                        "type": "single_select",
                        "options": RESOURCE_CLASSIFICATION_OPTIONS,
                        "weight": 2,
                    },
                    {"key": "vendor", "label": "Vendor", "type": "text", "weight": 0},
                    {"key": "version", "label": "Version", "type": "text", "weight": 0},
                ],
            },
            {
                "section": "Cost",
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Total Annual Cost",
                        "type": "cost",
                        "weight": 1,
                    },
                    {"key": "licenseType", "label": "License Type", "type": "text", "weight": 0},
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "IT-Komponente",
                "fr": "Composant IT",
                "es": "Componente TI",
                "it": "Componente IT",
                "pt": "Componente de TI",
                "zh": "IT组件",
            },
            "description": {
                "de": "Technologiekomponenten: Software, Hardware, SaaS, PaaS, IaaS, Services.",
                "fr": "Composants technologiques : logiciels, matériel, SaaS, PaaS, IaaS, services.",
                "es": "Componentes tecnológicos: software, hardware, SaaS, PaaS, IaaS, servicios.",
                "it": "Componenti tecnologici: software, hardware, SaaS, PaaS, IaaS, servizi.",
                "pt": "Componentes tecnológicos: software, hardware, SaaS, PaaS, IaaS, serviços.",
                "zh": "技术组件：软件、硬件、SaaS、PaaS、IaaS、服务。",
            },
        },
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
        "translations": {
            "label": {
                "de": "Technologiekategorie",
                "fr": "Catégorie technologique",
                "es": "Categoría tecnológica",
                "it": "Categoria tecnologica",
                "pt": "Categoria tecnológica",
                "zh": "技术类别",
            },
            "description": {
                "de": "Technologiekategorien zur Klassifizierung von IT-Komponenten (z. B. Datenbanken, Middleware).",
                "fr": "Catégories technologiques pour classifier les composants IT (ex. bases de données, middleware).",
                "es": "Categorías tecnológicas para clasificar componentes de TI (p. ej., bases de datos, middleware).",
                "it": "Categorie tecnologiche per classificare i componenti IT (es. database, middleware).",
                "pt": "Categorias tecnológicas para classificar componentes de TI (ex.: bancos de dados, middleware).",
                "zh": "用于分类IT组件的技术类别（如数据库、中间件）。",
            },
        },
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
                    {
                        "key": "providerType",
                        "label": "Provider Type",
                        "type": "single_select",
                        "options": [
                            {"key": "vendor", "label": "Vendor"},
                            {"key": "partner", "label": "Partner"},
                            {"key": "internalProvider", "label": "Internal Provider"},
                        ],
                        "weight": 1,
                    },
                    {"key": "website", "label": "Website", "type": "text", "weight": 0},
                    {
                        "key": "contractEnd",
                        "label": "Contract End Date",
                        "type": "date",
                        "weight": 0,
                    },
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "Anbieter",
                "fr": "Fournisseur",
                "es": "Proveedor",
                "it": "Fornitore",
                "pt": "Fornecedor",
                "zh": "供应商",
            },
            "description": {
                "de": "Externe Technologieanbieter und Lieferanten.",
                "fr": "Fournisseurs et prestataires technologiques externes.",
                "es": "Proveedores y vendedores de tecnología externos.",
                "it": "Fornitori e venditori di tecnologia esterni.",
                "pt": "Fornecedores e vendedores de tecnologia externos.",
                "zh": "外部技术供应商和厂商。",
            },
        },
    },
]


# ── Relations (from Meta_Model.xml — verbs are the edge labels) ────────

RELATIONS = [
    # Strategy & Transformation connections
    {
        "key": "relObjectiveToBC",
        "label": "improves",
        "reverse_label": "is improved by",
        "source_type_key": "Objective",
        "target_type_key": "BusinessCapability",
        "cardinality": "n:m",
        "sort_order": 0,
        "translations": {
            "label": {
                "de": "verbessert",
                "fr": "améliore",
                "es": "mejora",
                "it": "migliora",
                "pt": "melhora",
                "zh": "改进",
            },
            "reverse_label": {
                "de": "wird verbessert durch",
                "fr": "est amélioré par",
                "es": "es mejorado por",
                "it": "è migliorato da",
                "pt": "é melhorado por",
                "zh": "被改进",
            },
        },
    },
    {
        "key": "relPlatformToObjective",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "Platform",
        "target_type_key": "Objective",
        "cardinality": "n:m",
        "sort_order": 1,
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relPlatformToApp",
        "label": "runs",
        "reverse_label": "runs on",
        "source_type_key": "Platform",
        "target_type_key": "Application",
        "cardinality": "n:m",
        "sort_order": 2,
        "translations": {
            "label": {
                "de": "betreibt",
                "fr": "exécute",
                "es": "ejecuta",
                "it": "esegue",
                "pt": "executa",
                "zh": "运行",
            },
            "reverse_label": {
                "de": "läuft auf",
                "fr": "s'exécute sur",
                "es": "se ejecuta en",
                "it": "è eseguito su",
                "pt": "é executado em",
                "zh": "运行于",
            },
        },
    },
    {
        "key": "relPlatformToITC",
        "label": "implements",
        "reverse_label": "is implemented by",
        "source_type_key": "Platform",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 3,
        "translations": {
            "label": {
                "de": "implementiert",
                "fr": "implémente",
                "es": "implementa",
                "it": "implementa",
                "pt": "implementa",
                "zh": "实现",
            },
            "reverse_label": {
                "de": "wird implementiert von",
                "fr": "est implémenté par",
                "es": "es implementado por",
                "it": "è implementato da",
                "pt": "é implementado por",
                "zh": "被实现",
            },
        },
    },
    {
        "key": "relInitiativeToObjective",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "Initiative",
        "target_type_key": "Objective",
        "cardinality": "n:m",
        "sort_order": 4,
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relInitiativeToPlatform",
        "label": "affects",
        "reverse_label": "is affected by",
        "source_type_key": "Initiative",
        "target_type_key": "Platform",
        "cardinality": "n:m",
        "sort_order": 5,
        "translations": {
            "label": {
                "de": "beeinflusst",
                "fr": "affecte",
                "es": "afecta",
                "it": "influenza",
                "pt": "afeta",
                "zh": "影响",
            },
            "reverse_label": {
                "de": "wird beeinflusst von",
                "fr": "est affecté par",
                "es": "es afectado por",
                "it": "è influenzato da",
                "pt": "é afetado por",
                "zh": "被影响",
            },
        },
    },
    {
        "key": "relInitiativeToBC",
        "label": "improves",
        "reverse_label": "is improved by",
        "source_type_key": "Initiative",
        "target_type_key": "BusinessCapability",
        "cardinality": "n:m",
        "sort_order": 6,
        "translations": {
            "label": {
                "de": "verbessert",
                "fr": "améliore",
                "es": "mejora",
                "it": "migliora",
                "pt": "melhora",
                "zh": "改进",
            },
            "reverse_label": {
                "de": "wird verbessert durch",
                "fr": "est amélioré par",
                "es": "es mejorado por",
                "it": "è migliorato da",
                "pt": "é melhorado por",
                "zh": "被改进",
            },
        },
    },
    {
        "key": "relInitiativeToApp",
        "label": "affects",
        "reverse_label": "is affected by",
        "source_type_key": "Initiative",
        "target_type_key": "Application",
        "cardinality": "n:m",
        "sort_order": 7,
        "translations": {
            "label": {
                "de": "beeinflusst",
                "fr": "affecte",
                "es": "afecta",
                "it": "influenza",
                "pt": "afeta",
                "zh": "影响",
            },
            "reverse_label": {
                "de": "wird beeinflusst von",
                "fr": "est affecté par",
                "es": "es afectado por",
                "it": "è influenzato da",
                "pt": "é afetado por",
                "zh": "被影响",
            },
        },
    },
    {
        "key": "relInitiativeToInterface",
        "label": "affects",
        "reverse_label": "is affected by",
        "source_type_key": "Initiative",
        "target_type_key": "Interface",
        "cardinality": "n:m",
        "sort_order": 8,
        "translations": {
            "label": {
                "de": "beeinflusst",
                "fr": "affecte",
                "es": "afecta",
                "it": "influenza",
                "pt": "afeta",
                "zh": "影响",
            },
            "reverse_label": {
                "de": "wird beeinflusst von",
                "fr": "est affecté par",
                "es": "es afectado por",
                "it": "è influenzato da",
                "pt": "é afetado por",
                "zh": "被影响",
            },
        },
    },
    {
        "key": "relInitiativeToDataObj",
        "label": "affects",
        "reverse_label": "is affected by",
        "source_type_key": "Initiative",
        "target_type_key": "DataObject",
        "cardinality": "n:m",
        "sort_order": 9,
        "translations": {
            "label": {
                "de": "beeinflusst",
                "fr": "affecte",
                "es": "afecta",
                "it": "influenza",
                "pt": "afeta",
                "zh": "影响",
            },
            "reverse_label": {
                "de": "wird beeinflusst von",
                "fr": "est affecté par",
                "es": "es afectado por",
                "it": "è influenzato da",
                "pt": "é afetado por",
                "zh": "被影响",
            },
        },
    },
    {
        "key": "relInitiativeToITC",
        "label": "affects",
        "reverse_label": "is affected by",
        "source_type_key": "Initiative",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 10,
        "translations": {
            "label": {
                "de": "beeinflusst",
                "fr": "affecte",
                "es": "afecta",
                "it": "influenza",
                "pt": "afeta",
                "zh": "影响",
            },
            "reverse_label": {
                "de": "wird beeinflusst von",
                "fr": "est affecté par",
                "es": "es afectado por",
                "it": "è influenzato da",
                "pt": "é afetado por",
                "zh": "被影响",
            },
        },
    },
    # Organization connections
    {
        "key": "relOrgToObjective",
        "label": "owns",
        "reverse_label": "is owned by",
        "source_type_key": "Organization",
        "target_type_key": "Objective",
        "cardinality": "n:m",
        "sort_order": 12,
        "translations": {
            "label": {
                "de": "besitzt",
                "fr": "possède",
                "es": "posee",
                "it": "possiede",
                "pt": "possui",
                "zh": "拥有",
            },
            "reverse_label": {
                "de": "gehört zu",
                "fr": "appartient à",
                "es": "pertenece a",
                "it": "appartiene a",
                "pt": "pertence a",
                "zh": "属于",
            },
        },
    },
    {
        "key": "relOrgToInitiative",
        "label": "owns",
        "reverse_label": "is owned by",
        "source_type_key": "Organization",
        "target_type_key": "Initiative",
        "cardinality": "n:m",
        "sort_order": 13,
        "translations": {
            "label": {
                "de": "besitzt",
                "fr": "possède",
                "es": "posee",
                "it": "possiede",
                "pt": "possui",
                "zh": "拥有",
            },
            "reverse_label": {
                "de": "gehört zu",
                "fr": "appartient à",
                "es": "pertenece a",
                "it": "appartiene a",
                "pt": "pertence a",
                "zh": "属于",
            },
        },
    },
    {
        "key": "relOrgToBizCtx",
        "label": "owns",
        "reverse_label": "is owned by",
        "source_type_key": "Organization",
        "target_type_key": "BusinessContext",
        "cardinality": "n:m",
        "sort_order": 14,
        "translations": {
            "label": {
                "de": "besitzt",
                "fr": "possède",
                "es": "posee",
                "it": "possiede",
                "pt": "possui",
                "zh": "拥有",
            },
            "reverse_label": {
                "de": "gehört zu",
                "fr": "appartient à",
                "es": "pertenece a",
                "it": "appartiene a",
                "pt": "pertence a",
                "zh": "属于",
            },
        },
    },
    {
        "key": "relOrgToApp",
        "label": "uses",
        "reverse_label": "is used by",
        "source_type_key": "Organization",
        "target_type_key": "Application",
        "cardinality": "n:m",
        "sort_order": 15,
        "attributes_schema": [
            {
                "key": "usageType",
                "label": "Usage Type",
                "type": "single_select",
                "options": USAGE_TYPE_OPTIONS,
            },
        ],
        "translations": {
            "label": {
                "de": "nutzt",
                "fr": "utilise",
                "es": "utiliza",
                "it": "utilizza",
                "pt": "utiliza",
                "zh": "使用",
            },
            "reverse_label": {
                "de": "wird genutzt von",
                "fr": "est utilisé par",
                "es": "es utilizado por",
                "it": "è utilizzato da",
                "pt": "é utilizado por",
                "zh": "被使用",
            },
        },
    },
    {
        "key": "relOrgToITC",
        "label": "owns",
        "reverse_label": "is owned by",
        "source_type_key": "Organization",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 16,
        "translations": {
            "label": {
                "de": "besitzt",
                "fr": "possède",
                "es": "posee",
                "it": "possiede",
                "pt": "possui",
                "zh": "拥有",
            },
            "reverse_label": {
                "de": "gehört zu",
                "fr": "appartient à",
                "es": "pertenece a",
                "it": "appartiene a",
                "pt": "pertence a",
                "zh": "属于",
            },
        },
    },
    # Application connections
    {
        "key": "relAppToBC",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "Application",
        "target_type_key": "BusinessCapability",
        "cardinality": "n:m",
        "sort_order": 17,
        "attributes_schema": [
            {
                "key": "functionalSuitability",
                "label": "Functional Suitability",
                "type": "single_select",
                "options": FUNCTIONAL_SUITABILITY_OPTIONS,
            },
            {
                "key": "supportType",
                "label": "Support Type",
                "type": "single_select",
                "options": SUPPORT_TYPE_OPTIONS,
            },
        ],
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relAppToBizCtx",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "Application",
        "target_type_key": "BusinessContext",
        "cardinality": "n:m",
        "sort_order": 18,
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relAppToInterface",
        "label": "provides / consumes",
        "reverse_label": "is provided / consumed by",
        "source_type_key": "Application",
        "target_type_key": "Interface",
        "cardinality": "n:m",
        "sort_order": 19,
        "translations": {
            "label": {
                "de": "stellt bereit / konsumiert",
                "fr": "fournit / consomme",
                "es": "provee / consume",
                "it": "fornisce / consuma",
                "pt": "fornece / consome",
                "zh": "提供 / 消费",
            },
            "reverse_label": {
                "de": "wird bereitgestellt / konsumiert von",
                "fr": "est fourni / consommé par",
                "es": "es provisto / consumido por",
                "it": "è fornito / consumato da",
                "pt": "é fornecido / consumido por",
                "zh": "被提供 / 被消费",
            },
        },
    },
    {
        "key": "relAppToDataObj",
        "label": "CRUD",
        "reverse_label": "is used by",
        "source_type_key": "Application",
        "target_type_key": "DataObject",
        "cardinality": "n:m",
        "sort_order": 20,
        "attributes_schema": [
            {"key": "crudCreate", "label": "Create", "type": "boolean"},
            {"key": "crudRead", "label": "Read", "type": "boolean"},
            {"key": "crudUpdate", "label": "Update", "type": "boolean"},
            {"key": "crudDelete", "label": "Delete", "type": "boolean"},
        ],
        "translations": {
            "label": {
                "de": "CRUD",
                "fr": "CRUD",
                "es": "CRUD",
                "it": "CRUD",
                "pt": "CRUD",
                "zh": "CRUD",
            },
            "reverse_label": {
                "de": "wird genutzt von",
                "fr": "est utilisé par",
                "es": "es utilizado por",
                "it": "è utilizzato da",
                "pt": "é utilizado por",
                "zh": "被使用",
            },
        },
    },
    {
        "key": "relAppToITC",
        "label": "uses",
        "reverse_label": "is used by",
        "source_type_key": "Application",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 21,
        "attributes_schema": [
            {
                "key": "technicalSuitability",
                "label": "Technical Suitability",
                "type": "single_select",
                "options": TECHNICAL_SUITABILITY_OPTIONS,
            },
            {"key": "costTotalAnnual", "label": "Annual Cost", "type": "cost"},
        ],
        "translations": {
            "label": {
                "de": "nutzt",
                "fr": "utilise",
                "es": "utiliza",
                "it": "utilizza",
                "pt": "utiliza",
                "zh": "使用",
            },
            "reverse_label": {
                "de": "wird genutzt von",
                "fr": "est utilisé par",
                "es": "es utilizado por",
                "it": "è utilizzato da",
                "pt": "é utilizado por",
                "zh": "被使用",
            },
        },
    },
    # IT Component connections
    {
        "key": "relITCToTechCat",
        "label": "belongs to",
        "reverse_label": "includes",
        "source_type_key": "ITComponent",
        "target_type_key": "TechCategory",
        "cardinality": "n:m",
        "sort_order": 23,
        "attributes_schema": [
            {
                "key": "resourceClassification",
                "label": "Resource Classification",
                "type": "single_select",
                "options": RESOURCE_CLASSIFICATION_OPTIONS,
            },
        ],
        "translations": {
            "label": {
                "de": "gehört zu",
                "fr": "appartient à",
                "es": "pertenece a",
                "it": "appartiene a",
                "pt": "pertence a",
                "zh": "属于",
            },
            "reverse_label": {
                "de": "umfasst",
                "fr": "inclut",
                "es": "incluye",
                "it": "include",
                "pt": "inclui",
                "zh": "包含",
            },
        },
    },
    {
        "key": "relITCToPlatform",
        "label": "implements",
        "reverse_label": "is implemented by",
        "source_type_key": "ITComponent",
        "target_type_key": "Platform",
        "cardinality": "n:m",
        "sort_order": 24,
        "translations": {
            "label": {
                "de": "implementiert",
                "fr": "implémente",
                "es": "implementa",
                "it": "implementa",
                "pt": "implementa",
                "zh": "实现",
            },
            "reverse_label": {
                "de": "wird implementiert von",
                "fr": "est implémenté par",
                "es": "es implementado por",
                "it": "è implementato da",
                "pt": "é implementado por",
                "zh": "被实现",
            },
        },
    },
    # Interface connections
    {
        "key": "relInterfaceToDataObj",
        "label": "transfers",
        "reverse_label": "is transferred by",
        "source_type_key": "Interface",
        "target_type_key": "DataObject",
        "cardinality": "n:m",
        "sort_order": 25,
        "translations": {
            "label": {
                "de": "überträgt",
                "fr": "transfère",
                "es": "transfiere",
                "it": "trasferisce",
                "pt": "transfere",
                "zh": "传输",
            },
            "reverse_label": {
                "de": "wird übertragen von",
                "fr": "est transféré par",
                "es": "es transferido por",
                "it": "è trasferito da",
                "pt": "é transferido por",
                "zh": "被传输",
            },
        },
    },
    {
        "key": "relInterfaceToITC",
        "label": "uses",
        "reverse_label": "is used by",
        "source_type_key": "Interface",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 26,
        "translations": {
            "label": {
                "de": "nutzt",
                "fr": "utilise",
                "es": "utiliza",
                "it": "utilizza",
                "pt": "utiliza",
                "zh": "使用",
            },
            "reverse_label": {
                "de": "wird genutzt von",
                "fr": "est utilisé par",
                "es": "es utilizado por",
                "it": "è utilizzato da",
                "pt": "é utilizado por",
                "zh": "被使用",
            },
        },
    },
    # Provider connections
    {
        "key": "relProviderToInitiative",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "Provider",
        "target_type_key": "Initiative",
        "cardinality": "n:m",
        "sort_order": 27,
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relProviderToApp",
        "label": "offers",
        "reverse_label": "is offered by",
        "source_type_key": "Provider",
        "target_type_key": "Application",
        "cardinality": "n:m",
        "sort_order": 28,
        "translations": {
            "label": {
                "de": "bietet an",
                "fr": "propose",
                "es": "ofrece",
                "it": "offre",
                "pt": "oferece",
                "zh": "提供",
            },
            "reverse_label": {
                "de": "wird angeboten von",
                "fr": "est proposé par",
                "es": "es ofrecido por",
                "it": "è offerto da",
                "pt": "é oferecido por",
                "zh": "由...提供",
            },
        },
    },
    {
        "key": "relProviderToITC",
        "label": "offers",
        "reverse_label": "is offered by",
        "source_type_key": "Provider",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 29,
        "translations": {
            "label": {
                "de": "bietet an",
                "fr": "propose",
                "es": "ofrece",
                "it": "offre",
                "pt": "oferece",
                "zh": "提供",
            },
            "reverse_label": {
                "de": "wird angeboten von",
                "fr": "est proposé par",
                "es": "es ofrecido por",
                "it": "è offerto da",
                "pt": "é oferecido por",
                "zh": "由...提供",
            },
        },
    },
    # Business Context connections
    {
        "key": "relBizCtxToBC",
        "label": "is associated with",
        "reverse_label": "is associated with",
        "source_type_key": "BusinessContext",
        "target_type_key": "BusinessCapability",
        "cardinality": "n:m",
        "sort_order": 30,
        "translations": {
            "label": {
                "de": "ist verknüpft mit",
                "fr": "est associé à",
                "es": "está asociado con",
                "it": "è associato a",
                "pt": "está associado a",
                "zh": "关联于",
            },
            "reverse_label": {
                "de": "ist verknüpft mit",
                "fr": "est associé à",
                "es": "está asociado con",
                "it": "è associato a",
                "pt": "está associado a",
                "zh": "关联于",
            },
        },
    },
    # BPM — Business Process connections
    {
        "key": "relProcessToBC",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "BusinessProcess",
        "target_type_key": "BusinessCapability",
        "cardinality": "n:m",
        "sort_order": 31,
        "attributes_schema": [
            {
                "key": "supportType",
                "label": "Support Type",
                "type": "single_select",
                "options": SUPPORT_TYPE_OPTIONS,
            },
        ],
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relProcessToApp",
        "label": "is supported by",
        "reverse_label": "supports",
        "source_type_key": "BusinessProcess",
        "target_type_key": "Application",
        "cardinality": "n:m",
        "sort_order": 32,
        "attributes_schema": [
            {
                "key": "usageType",
                "label": "Usage",
                "type": "single_select",
                "options": [
                    {"key": "creates", "label": "Creates"},
                    {"key": "reads", "label": "Reads"},
                    {"key": "updates", "label": "Updates"},
                    {"key": "deletes", "label": "Deletes"},
                    {"key": "orchestrates", "label": "Orchestrates"},
                ],
            },
            {
                "key": "criticality",
                "label": "Criticality",
                "type": "single_select",
                "options": [
                    {"key": "low", "label": "Low", "color": "#4caf50"},
                    {"key": "medium", "label": "Medium", "color": "#ff9800"},
                    {"key": "high", "label": "High", "color": "#f44336"},
                    {"key": "critical", "label": "Critical", "color": "#b71c1c"},
                ],
            },
        ],
        "translations": {
            "label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
            "reverse_label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
        },
    },
    {
        "key": "relProcessToDataObj",
        "label": "uses",
        "reverse_label": "is used by",
        "source_type_key": "BusinessProcess",
        "target_type_key": "DataObject",
        "cardinality": "n:m",
        "sort_order": 33,
        "attributes_schema": [
            {"key": "crudCreate", "label": "Create", "type": "boolean"},
            {"key": "crudRead", "label": "Read", "type": "boolean"},
            {"key": "crudUpdate", "label": "Update", "type": "boolean"},
            {"key": "crudDelete", "label": "Delete", "type": "boolean"},
        ],
        "translations": {
            "label": {
                "de": "nutzt",
                "fr": "utilise",
                "es": "utiliza",
                "it": "utilizza",
                "pt": "utiliza",
                "zh": "使用",
            },
            "reverse_label": {
                "de": "wird genutzt von",
                "fr": "est utilisé par",
                "es": "es utilizado por",
                "it": "è utilizzato da",
                "pt": "é utilizado por",
                "zh": "被使用",
            },
        },
    },
    {
        "key": "relProcessToITC",
        "label": "uses",
        "reverse_label": "is used by",
        "source_type_key": "BusinessProcess",
        "target_type_key": "ITComponent",
        "cardinality": "n:m",
        "sort_order": 34,
        "translations": {
            "label": {
                "de": "nutzt",
                "fr": "utilise",
                "es": "utiliza",
                "it": "utilizza",
                "pt": "utiliza",
                "zh": "使用",
            },
            "reverse_label": {
                "de": "wird genutzt von",
                "fr": "est utilisé par",
                "es": "es utilizado por",
                "it": "è utilizzato da",
                "pt": "é utilizado por",
                "zh": "被使用",
            },
        },
    },
    {
        "key": "relProcessDependency",
        "label": "depends on",
        "reverse_label": "is depended on by",
        "source_type_key": "BusinessProcess",
        "target_type_key": "BusinessProcess",
        "cardinality": "n:m",
        "sort_order": 35,
        "translations": {
            "label": {
                "de": "hängt ab von",
                "fr": "dépend de",
                "es": "depende de",
                "it": "dipende da",
                "pt": "depende de",
                "zh": "依赖于",
            },
            "reverse_label": {
                "de": "wird benötigt von",
                "fr": "est requis par",
                "es": "es requerido por",
                "it": "è richiesto da",
                "pt": "é requerido por",
                "zh": "被依赖",
            },
        },
    },
    {
        "key": "relProcessToOrg",
        "label": "is owned by",
        "reverse_label": "owns",
        "source_type_key": "BusinessProcess",
        "target_type_key": "Organization",
        "cardinality": "n:m",
        "sort_order": 36,
        "translations": {
            "label": {
                "de": "gehört zu",
                "fr": "appartient à",
                "es": "pertenece a",
                "it": "appartiene a",
                "pt": "pertence a",
                "zh": "属于",
            },
            "reverse_label": {
                "de": "besitzt",
                "fr": "possède",
                "es": "posee",
                "it": "possiede",
                "pt": "possui",
                "zh": "拥有",
            },
        },
    },
    {
        "key": "relProcessToInitiative",
        "label": "is affected by",
        "reverse_label": "affects",
        "source_type_key": "BusinessProcess",
        "target_type_key": "Initiative",
        "cardinality": "n:m",
        "sort_order": 37,
        "translations": {
            "label": {
                "de": "wird beeinflusst von",
                "fr": "est affecté par",
                "es": "es afectado por",
                "it": "è influenzato da",
                "pt": "é afetado por",
                "zh": "被影响",
            },
            "reverse_label": {
                "de": "beeinflusst",
                "fr": "affecte",
                "es": "afecta",
                "it": "influenza",
                "pt": "afeta",
                "zh": "影响",
            },
        },
    },
    {
        "key": "relProcessToObjective",
        "label": "supports",
        "reverse_label": "is supported by",
        "source_type_key": "BusinessProcess",
        "target_type_key": "Objective",
        "cardinality": "n:m",
        "sort_order": 38,
        "translations": {
            "label": {
                "de": "unterstützt",
                "fr": "prend en charge",
                "es": "apoya",
                "it": "supporta",
                "pt": "suporta",
                "zh": "支持",
            },
            "reverse_label": {
                "de": "wird unterstützt von",
                "fr": "est pris en charge par",
                "es": "es apoyado por",
                "it": "è supportato da",
                "pt": "é suportado por",
                "zh": "被支持",
            },
        },
    },
    {
        "key": "relProcessToBizCtx",
        "label": "realizes",
        "reverse_label": "is realized by",
        "source_type_key": "BusinessProcess",
        "target_type_key": "BusinessContext",
        "cardinality": "n:m",
        "sort_order": 39,
        "translations": {
            "label": {
                "de": "realisiert",
                "fr": "réalise",
                "es": "realiza",
                "it": "realizza",
                "pt": "realiza",
                "zh": "实现",
            },
            "reverse_label": {
                "de": "wird realisiert durch",
                "fr": "est réalisé par",
                "es": "es realizado por",
                "it": "è realizzato da",
                "pt": "é realizado por",
                "zh": "被实现",
            },
        },
    },
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
    existing_types_result = await db.execute(select(CardType))
    existing_types = {t.key: t for t in existing_types_result.scalars().all()}

    existing_rels_result = await db.execute(select(RelationType))
    existing_rels_list = existing_rels_result.scalars().all()
    existing_rels = {r.key for r in existing_rels_list}
    existing_rel_pairs = {
        (r.source_type_key, r.target_type_key) for r in existing_rels_list if not r.is_hidden
    }

    for i, t in enumerate(TYPES):
        key = t["key"]
        if key in existing_types:
            # Update fields_schema on existing built-in types so new sections
            # (like BPM Assessment on BusinessCapability) are picked up
            existing = existing_types[key]
            if existing.built_in:
                # Update translations if not set
                seed_translations = t.get("translations", {})
                if seed_translations and not existing.translations:
                    existing.translations = seed_translations
                seed_schema = t.get("fields_schema", [])
                current_schema = existing.fields_schema or []
                current_sections = {s["section"] for s in current_schema}
                new_sections = [s for s in seed_schema if s["section"] not in current_sections]
                if new_sections:
                    existing.fields_schema = current_schema + new_sections
            continue

        roles = _app_roles if key == "Application" else _default_roles
        fst = CardType(
            key=key,
            label=t["label"],
            description=t.get("description"),
            icon=t.get("icon", "category"),
            color=t.get("color", "#1976d2"),
            category=t.get("category"),
            has_hierarchy=t.get("has_hierarchy", False),
            subtypes=t.get("subtypes", []),
            fields_schema=t.get("fields_schema", []),
            stakeholder_roles=t.get("stakeholder_roles", roles),
            built_in=True,
            is_hidden=t.get("is_hidden", False),
            sort_order=t.get("sort_order", i),
            translations=t.get("translations", {}),
        )
        db.add(fst)

    for i, r in enumerate(RELATIONS):
        if r["key"] in existing_rels:
            continue
        # Skip if a relation with same source+target already exists
        pair = (r["source_type_key"], r["target_type_key"])
        if pair in existing_rel_pairs:
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
            translations=r.get("translations", {}),
        )
        db.add(rt)

    # ── Seed RBAC roles ──────────────────────────────────────────────────
    existing_roles_result = await db.execute(select(Role))
    existing_roles = {r.key for r in existing_roles_result.scalars().all()}

    seed_roles = [
        {
            "key": "admin",
            "label": "Admin",
            "description": "Full access to all features and administration.",
            "is_system": True,
            "is_default": False,
            "color": "#d32f2f",
            "permissions": ADMIN_PERMISSIONS,
            "sort_order": 0,
        },
        {
            "key": "bpm_admin",
            "label": "BPM Admin",
            "description": "Full BPM management plus standard member access.",
            "is_system": False,
            "is_default": False,
            "color": "#7B1FA2",
            "permissions": BPM_ADMIN_PERMISSIONS,
            "sort_order": 1,
        },
        {
            "key": "member",
            "label": "Member",
            "description": "Standard access to create, edit, and manage cards.",
            "is_system": False,
            "is_default": True,
            "color": "#1976d2",
            "permissions": MEMBER_PERMISSIONS,
            "sort_order": 2,
        },
        {
            "key": "viewer",
            "label": "Viewer",
            "description": "Read-only access to the EA landscape.",
            "is_system": False,
            "is_default": False,
            "color": "#757575",
            "permissions": VIEWER_PERMISSIONS,
            "sort_order": 3,
        },
    ]

    for r in seed_roles:
        if r["key"] not in existing_roles:
            db.add(Role(**r))

    # ── Seed stakeholder role definitions ──────────────────────────────────
    # Flush first so that any newly-inserted card_types rows are
    # visible to the FK constraint on stakeholder_role_definitions.
    await db.flush()

    existing_srd_result = await db.execute(select(StakeholderRoleDefinition))
    existing_srd_keys = {(s.card_type_key, s.key) for s in existing_srd_result.scalars().all()}

    for t in TYPES:
        type_key = t["key"]
        # Use the type's explicit stakeholder_roles if provided,
        # otherwise fall back to the same defaults used when creating
        # the CardType above.
        if "stakeholder_roles" in t:
            roles_for_type = t["stakeholder_roles"]
        elif type_key == "Application":
            roles_for_type = _app_roles
        else:
            roles_for_type = _default_roles

        for idx, sr in enumerate(roles_for_type):
            sr_key = sr["key"]
            if (type_key, sr_key) in existing_srd_keys:
                continue
            permissions = DEFAULT_CARD_PERMISSIONS_BY_ROLE.get(sr_key, {})
            db.add(
                StakeholderRoleDefinition(
                    card_type_key=type_key,
                    key=sr_key,
                    label=sr["label"],
                    permissions=permissions,
                    sort_order=idx,
                )
            )

    await db.commit()
