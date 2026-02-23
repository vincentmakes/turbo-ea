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
    {
        "key": "missionCritical",
        "label": "Mission Critical",
        "color": "#d32f2f",
        "translations": {
            "de": "Geschäftskritisch",
            "fr": "Critique pour la mission",
            "es": "Crítico para la misión",
            "it": "Critico per la missione",
            "pt": "Crítico para a missão",
            "zh": "关键任务",
        },
    },
    {
        "key": "businessCritical",
        "label": "Business Critical",
        "color": "#f57c00",
        "translations": {
            "de": "Unternehmenskritisch",
            "fr": "Critique pour l'entreprise",
            "es": "Crítico para el negocio",
            "it": "Critico per il business",
            "pt": "Crítico para o negócio",
            "zh": "业务关键",
        },
    },
    {
        "key": "businessOperational",
        "label": "Business Operational",
        "color": "#fbc02d",
        "translations": {
            "de": "Geschäftsbetrieb",
            "fr": "Opérationnel",
            "es": "Operativo",
            "it": "Operativo",
            "pt": "Operacional",
            "zh": "业务运营",
        },
    },
    {
        "key": "administrativeService",
        "label": "Administrative",
        "color": "#9e9e9e",
        "translations": {
            "de": "Administrativ",
            "fr": "Administratif",
            "es": "Administrativo",
            "it": "Amministrativo",
            "pt": "Administrativo",
            "zh": "行政管理",
        },
    },
]

FUNCTIONAL_SUITABILITY_OPTIONS = [
    {
        "key": "perfect",
        "label": "Perfect",
        "color": "#2e7d32",
        "translations": {
            "de": "Perfekt",
            "fr": "Parfait",
            "es": "Perfecto",
            "it": "Perfetto",
            "pt": "Perfeito",
            "zh": "完美",
        },
    },
    {
        "key": "appropriate",
        "label": "Appropriate",
        "color": "#66bb6a",
        "translations": {
            "de": "Angemessen",
            "fr": "Approprié",
            "es": "Apropiado",
            "it": "Appropriato",
            "pt": "Apropriado",
            "zh": "适当",
        },
    },
    {
        "key": "insufficient",
        "label": "Insufficient",
        "color": "#f57c00",
        "translations": {
            "de": "Unzureichend",
            "fr": "Insuffisant",
            "es": "Insuficiente",
            "it": "Insufficiente",
            "pt": "Insuficiente",
            "zh": "不足",
        },
    },
    {
        "key": "unreasonable",
        "label": "Unreasonable",
        "color": "#d32f2f",
        "translations": {
            "de": "Ungeeignet",
            "fr": "Inadéquat",
            "es": "Inadecuado",
            "it": "Inadeguato",
            "pt": "Inadequado",
            "zh": "不合理",
        },
    },
]

TECHNICAL_SUITABILITY_OPTIONS = [
    {
        "key": "fullyAppropriate",
        "label": "Fully Appropriate",
        "color": "#2e7d32",
        "translations": {
            "de": "Vollständig geeignet",
            "fr": "Parfaitement adapté",
            "es": "Totalmente apropiado",
            "it": "Pienamente appropriato",
            "pt": "Totalmente apropriado",
            "zh": "完全适合",
        },
    },
    {
        "key": "adequate",
        "label": "Adequate",
        "color": "#66bb6a",
        "translations": {
            "de": "Ausreichend",
            "fr": "Adéquat",
            "es": "Adecuado",
            "it": "Adeguato",
            "pt": "Adequado",
            "zh": "足够",
        },
    },
    {
        "key": "unreasonable",
        "label": "Unreasonable",
        "color": "#f57c00",
        "translations": {
            "de": "Ungeeignet",
            "fr": "Inadéquat",
            "es": "Inadecuado",
            "it": "Inadeguato",
            "pt": "Inadequado",
            "zh": "不合理",
        },
    },
    {
        "key": "inappropriate",
        "label": "Inappropriate",
        "color": "#d32f2f",
        "translations": {
            "de": "Unpassend",
            "fr": "Inapproprié",
            "es": "Inapropiado",
            "it": "Inappropriato",
            "pt": "Inapropriado",
            "zh": "不适当",
        },
    },
]

HOSTING_TYPE_OPTIONS = [
    {
        "key": "onPremise",
        "label": "On-Premise",
        "translations": {
            "de": "Eigenbetrieb",
            "fr": "Sur site",
            "es": "Local",
            "it": "On-Premise",
            "pt": "Local",
            "zh": "本地部署",
        },
    },
    {
        "key": "cloudSaaS",
        "label": "Cloud (SaaS)",
        "translations": {
            "de": "Cloud (SaaS)",
            "fr": "Cloud (SaaS)",
            "es": "Cloud (SaaS)",
            "it": "Cloud (SaaS)",
            "pt": "Cloud (SaaS)",
            "zh": "云端 (SaaS)",
        },
    },
    {
        "key": "cloudPaaS",
        "label": "Cloud (PaaS)",
        "translations": {
            "de": "Cloud (PaaS)",
            "fr": "Cloud (PaaS)",
            "es": "Cloud (PaaS)",
            "it": "Cloud (PaaS)",
            "pt": "Cloud (PaaS)",
            "zh": "云端 (PaaS)",
        },
    },
    {
        "key": "cloudIaaS",
        "label": "Cloud (IaaS)",
        "translations": {
            "de": "Cloud (IaaS)",
            "fr": "Cloud (IaaS)",
            "es": "Cloud (IaaS)",
            "it": "Cloud (IaaS)",
            "pt": "Cloud (IaaS)",
            "zh": "云端 (IaaS)",
        },
    },
    {
        "key": "hybrid",
        "label": "Hybrid",
        "translations": {
            "de": "Hybrid",
            "fr": "Hybride",
            "es": "Híbrido",
            "it": "Ibrido",
            "pt": "Híbrido",
            "zh": "混合",
        },
    },
]

RESOURCE_CLASSIFICATION_OPTIONS = [
    {
        "key": "standard",
        "label": "Standard",
        "color": "#4caf50",
        "translations": {
            "de": "Standard",
            "fr": "Standard",
            "es": "Estándar",
            "it": "Standard",
            "pt": "Padrão",
            "zh": "标准",
        },
    },
    {
        "key": "phaseIn",
        "label": "Phase In",
        "color": "#2196f3",
        "translations": {
            "de": "Einführung",
            "fr": "En introduction",
            "es": "En introducción",
            "it": "In introduzione",
            "pt": "Em introdução",
            "zh": "引入中",
        },
    },
    {
        "key": "tolerated",
        "label": "Tolerated",
        "color": "#ff9800",
        "translations": {
            "de": "Toleriert",
            "fr": "Toléré",
            "es": "Tolerado",
            "it": "Tollerato",
            "pt": "Tolerado",
            "zh": "容忍",
        },
    },
    {
        "key": "phaseOut",
        "label": "Phase Out",
        "color": "#f44336",
        "translations": {
            "de": "Auslaufend",
            "fr": "En retrait",
            "es": "En retirada",
            "it": "In dismissione",
            "pt": "Em retirada",
            "zh": "淘汰中",
        },
    },
    {
        "key": "declined",
        "label": "Declined",
        "color": "#9e9e9e",
        "translations": {
            "de": "Abgelehnt",
            "fr": "Rejeté",
            "es": "Rechazado",
            "it": "Rifiutato",
            "pt": "Recusado",
            "zh": "已拒绝",
        },
    },
]

DATA_SENSITIVITY_OPTIONS = [
    {
        "key": "public",
        "label": "Public",
        "color": "#4caf50",
        "translations": {
            "de": "Öffentlich",
            "fr": "Public",
            "es": "Público",
            "it": "Pubblico",
            "pt": "Público",
            "zh": "公开",
        },
    },
    {
        "key": "internal",
        "label": "Internal",
        "color": "#2196f3",
        "translations": {
            "de": "Intern",
            "fr": "Interne",
            "es": "Interno",
            "it": "Interno",
            "pt": "Interno",
            "zh": "内部",
        },
    },
    {
        "key": "confidential",
        "label": "Confidential",
        "color": "#ff9800",
        "translations": {
            "de": "Vertraulich",
            "fr": "Confidentiel",
            "es": "Confidencial",
            "it": "Confidenziale",
            "pt": "Confidencial",
            "zh": "机密",
        },
    },
    {
        "key": "restricted",
        "label": "Restricted",
        "color": "#d32f2f",
        "translations": {
            "de": "Eingeschränkt",
            "fr": "Restreint",
            "es": "Restringido",
            "it": "Riservato",
            "pt": "Restrito",
            "zh": "受限",
        },
    },
]

INITIATIVE_STATUS_OPTIONS = [
    {
        "key": "onTrack",
        "label": "On Track",
        "color": "#4caf50",
        "translations": {
            "de": "Im Plan",
            "fr": "En bonne voie",
            "es": "En curso",
            "it": "In linea",
            "pt": "No prazo",
            "zh": "按计划",
        },
    },
    {
        "key": "atRisk",
        "label": "At Risk",
        "color": "#ff9800",
        "translations": {
            "de": "Gefährdet",
            "fr": "À risque",
            "es": "En riesgo",
            "it": "A rischio",
            "pt": "Em risco",
            "zh": "有风险",
        },
    },
    {
        "key": "offTrack",
        "label": "Off Track",
        "color": "#d32f2f",
        "translations": {
            "de": "Außer Plan",
            "fr": "Hors piste",
            "es": "Fuera de curso",
            "it": "Fuori rotta",
            "pt": "Fora do prazo",
            "zh": "偏离计划",
        },
    },
    {
        "key": "onHold",
        "label": "On Hold",
        "color": "#9e9e9e",
        "translations": {
            "de": "Pausiert",
            "fr": "En attente",
            "es": "En espera",
            "it": "In sospeso",
            "pt": "Em espera",
            "zh": "暂停",
        },
    },
    {
        "key": "completed",
        "label": "Completed",
        "color": "#1976d2",
        "translations": {
            "de": "Abgeschlossen",
            "fr": "Terminé",
            "es": "Completado",
            "it": "Completato",
            "pt": "Concluído",
            "zh": "已完成",
        },
    },
]

FREQUENCY_OPTIONS = [
    {
        "key": "realTime",
        "label": "Real-Time",
        "translations": {
            "de": "Echtzeit",
            "fr": "Temps réel",
            "es": "Tiempo real",
            "it": "Tempo reale",
            "pt": "Tempo real",
            "zh": "实时",
        },
    },
    {
        "key": "daily",
        "label": "Daily",
        "translations": {
            "de": "Täglich",
            "fr": "Quotidien",
            "es": "Diario",
            "it": "Giornaliero",
            "pt": "Diário",
            "zh": "每日",
        },
    },
    {
        "key": "weekly",
        "label": "Weekly",
        "translations": {
            "de": "Wöchentlich",
            "fr": "Hebdomadaire",
            "es": "Semanal",
            "it": "Settimanale",
            "pt": "Semanal",
            "zh": "每周",
        },
    },
    {
        "key": "monthly",
        "label": "Monthly",
        "translations": {
            "de": "Monatlich",
            "fr": "Mensuel",
            "es": "Mensual",
            "it": "Mensile",
            "pt": "Mensal",
            "zh": "每月",
        },
    },
    {
        "key": "onDemand",
        "label": "On Demand",
        "translations": {
            "de": "Auf Anfrage",
            "fr": "À la demande",
            "es": "Bajo demanda",
            "it": "Su richiesta",
            "pt": "Sob demanda",
            "zh": "按需",
        },
    },
    {
        "key": "batch",
        "label": "Batch",
        "translations": {
            "de": "Stapelverarbeitung",
            "fr": "Par lots",
            "es": "Por lotes",
            "it": "Batch",
            "pt": "Em lote",
            "zh": "批处理",
        },
    },
]

SUPPORT_TYPE_OPTIONS = [
    {
        "key": "leading",
        "label": "Leading",
        "color": "#2e7d32",
        "translations": {
            "de": "Führend",
            "fr": "Principal",
            "es": "Principal",
            "it": "Principale",
            "pt": "Principal",
            "zh": "主导",
        },
    },
    {
        "key": "supporting",
        "label": "Supporting",
        "color": "#66bb6a",
        "translations": {
            "de": "Unterstützend",
            "fr": "Support",
            "es": "De soporte",
            "it": "Di supporto",
            "pt": "De suporte",
            "zh": "支持",
        },
    },
    {
        "key": "noSupport",
        "label": "No Support",
        "color": "#9e9e9e",
        "translations": {
            "de": "Keine Unterstützung",
            "fr": "Aucun support",
            "es": "Sin soporte",
            "it": "Nessun supporto",
            "pt": "Sem suporte",
            "zh": "无支持",
        },
    },
]

USAGE_TYPE_OPTIONS = [
    {
        "key": "owner",
        "label": "Owner",
        "color": "#1976d2",
        "translations": {
            "de": "Eigentümer",
            "fr": "Propriétaire",
            "es": "Propietario",
            "it": "Proprietario",
            "pt": "Proprietário",
            "zh": "所有者",
        },
    },
    {
        "key": "user",
        "label": "User",
        "color": "#66bb6a",
        "translations": {
            "de": "Benutzer",
            "fr": "Utilisateur",
            "es": "Usuario",
            "it": "Utente",
            "pt": "Utilizador",
            "zh": "用户",
        },
    },
    {
        "key": "stakeholder",
        "label": "Stakeholder",
        "color": "#ff9800",
        "translations": {
            "de": "Stakeholder",
            "fr": "Partie prenante",
            "es": "Parte interesada",
            "it": "Stakeholder",
            "pt": "Parte interessada",
            "zh": "利益相关者",
        },
    },
]

TIME_MODEL_OPTIONS = [
    {
        "key": "tolerate",
        "label": "Tolerate",
        "color": "#ff9800",
        "translations": {
            "de": "Tolerieren",
            "fr": "Tolérer",
            "es": "Tolerar",
            "it": "Tollerare",
            "pt": "Tolerar",
            "zh": "容忍",
        },
    },
    {
        "key": "invest",
        "label": "Invest",
        "color": "#4caf50",
        "translations": {
            "de": "Investieren",
            "fr": "Investir",
            "es": "Invertir",
            "it": "Investire",
            "pt": "Investir",
            "zh": "投资",
        },
    },
    {
        "key": "migrate",
        "label": "Migrate",
        "color": "#2196f3",
        "translations": {
            "de": "Migrieren",
            "fr": "Migrer",
            "es": "Migrar",
            "it": "Migrare",
            "pt": "Migrar",
            "zh": "迁移",
        },
    },
    {
        "key": "eliminate",
        "label": "Eliminate",
        "color": "#d32f2f",
        "translations": {
            "de": "Eliminieren",
            "fr": "Éliminer",
            "es": "Eliminar",
            "it": "Eliminare",
            "pt": "Eliminar",
            "zh": "淘汰",
        },
    },
]

# ── BPM option lists ──────────────────────────────────────────────────

PROCESS_TYPE_OPTIONS = [
    {
        "key": "core",
        "label": "Core",
        "color": "#1976d2",
        "translations": {
            "de": "Kern",
            "fr": "Principal",
            "es": "Principal",
            "it": "Principale",
            "pt": "Principal",
            "zh": "核心",
        },
    },
    {
        "key": "support",
        "label": "Support",
        "color": "#607d8b",
        "translations": {
            "de": "Unterstützung",
            "fr": "Support",
            "es": "Soporte",
            "it": "Supporto",
            "pt": "Suporte",
            "zh": "支持",
        },
    },
    {
        "key": "management",
        "label": "Management",
        "color": "#9c27b0",
        "translations": {
            "de": "Management",
            "fr": "Gestion",
            "es": "Gestión",
            "it": "Gestione",
            "pt": "Gestão",
            "zh": "管理",
        },
    },
]

PROCESS_MATURITY_OPTIONS = [
    {
        "key": "initial",
        "label": "1 - Initial",
        "color": "#d32f2f",
        "translations": {
            "de": "1 - Initial",
            "fr": "1 - Initial",
            "es": "1 - Inicial",
            "it": "1 - Iniziale",
            "pt": "1 - Inicial",
            "zh": "1 - 初始",
        },
    },
    {
        "key": "managed",
        "label": "2 - Managed",
        "color": "#ff9800",
        "translations": {
            "de": "2 - Gemanagt",
            "fr": "2 - Géré",
            "es": "2 - Gestionado",
            "it": "2 - Gestito",
            "pt": "2 - Gerenciado",
            "zh": "2 - 已管理",
        },
    },
    {
        "key": "defined",
        "label": "3 - Defined",
        "color": "#fbc02d",
        "translations": {
            "de": "3 - Definiert",
            "fr": "3 - Défini",
            "es": "3 - Definido",
            "it": "3 - Definito",
            "pt": "3 - Definido",
            "zh": "3 - 已定义",
        },
    },
    {
        "key": "measured",
        "label": "4 - Measured",
        "color": "#66bb6a",
        "translations": {
            "de": "4 - Gemessen",
            "fr": "4 - Mesuré",
            "es": "4 - Medido",
            "it": "4 - Misurato",
            "pt": "4 - Medido",
            "zh": "4 - 已量化",
        },
    },
    {
        "key": "optimized",
        "label": "5 - Optimized",
        "color": "#2e7d32",
        "translations": {
            "de": "5 - Optimiert",
            "fr": "5 - Optimisé",
            "es": "5 - Optimizado",
            "it": "5 - Ottimizzato",
            "pt": "5 - Otimizado",
            "zh": "5 - 已优化",
        },
    },
]

AUTOMATION_LEVEL_OPTIONS = [
    {
        "key": "manual",
        "label": "Manual",
        "color": "#d32f2f",
        "translations": {
            "de": "Manuell",
            "fr": "Manuel",
            "es": "Manual",
            "it": "Manuale",
            "pt": "Manual",
            "zh": "手动",
        },
    },
    {
        "key": "partiallyAutomated",
        "label": "Partially Automated",
        "color": "#ff9800",
        "translations": {
            "de": "Teilautomatisiert",
            "fr": "Partiellement automatisé",
            "es": "Parcialmente automatizado",
            "it": "Parzialmente automatizzato",
            "pt": "Parcialmente automatizado",
            "zh": "部分自动化",
        },
    },
    {
        "key": "fullyAutomated",
        "label": "Fully Automated",
        "color": "#4caf50",
        "translations": {
            "de": "Vollautomatisiert",
            "fr": "Entièrement automatisé",
            "es": "Totalmente automatizado",
            "it": "Completamente automatizzato",
            "pt": "Totalmente automatizado",
            "zh": "完全自动化",
        },
    },
]

PROCESS_RISK_OPTIONS = [
    {
        "key": "low",
        "label": "Low",
        "color": "#4caf50",
        "translations": {
            "de": "Niedrig",
            "fr": "Faible",
            "es": "Bajo",
            "it": "Basso",
            "pt": "Baixo",
            "zh": "低",
        },
    },
    {
        "key": "medium",
        "label": "Medium",
        "color": "#ff9800",
        "translations": {
            "de": "Mittel",
            "fr": "Moyen",
            "es": "Medio",
            "it": "Medio",
            "pt": "Médio",
            "zh": "中",
        },
    },
    {
        "key": "high",
        "label": "High",
        "color": "#f44336",
        "translations": {
            "de": "Hoch",
            "fr": "Élevé",
            "es": "Alto",
            "it": "Alto",
            "pt": "Alto",
            "zh": "高",
        },
    },
    {
        "key": "critical",
        "label": "Critical",
        "color": "#b71c1c",
        "translations": {
            "de": "Kritisch",
            "fr": "Critique",
            "es": "Crítico",
            "it": "Critico",
            "pt": "Crítico",
            "zh": "严重",
        },
    },
]

PROCESS_FREQUENCY_OPTIONS = [
    {
        "key": "adHoc",
        "label": "Ad Hoc",
        "translations": {
            "de": "Ad hoc",
            "fr": "Ad hoc",
            "es": "Ad hoc",
            "it": "Ad hoc",
            "pt": "Ad hoc",
            "zh": "临时",
        },
    },
    {
        "key": "daily",
        "label": "Daily",
        "translations": {
            "de": "Täglich",
            "fr": "Quotidien",
            "es": "Diario",
            "it": "Giornaliero",
            "pt": "Diário",
            "zh": "每日",
        },
    },
    {
        "key": "weekly",
        "label": "Weekly",
        "translations": {
            "de": "Wöchentlich",
            "fr": "Hebdomadaire",
            "es": "Semanal",
            "it": "Settimanale",
            "pt": "Semanal",
            "zh": "每周",
        },
    },
    {
        "key": "monthly",
        "label": "Monthly",
        "translations": {
            "de": "Monatlich",
            "fr": "Mensuel",
            "es": "Mensual",
            "it": "Mensile",
            "pt": "Mensal",
            "zh": "每月",
        },
    },
    {
        "key": "quarterly",
        "label": "Quarterly",
        "translations": {
            "de": "Vierteljährlich",
            "fr": "Trimestriel",
            "es": "Trimestral",
            "it": "Trimestrale",
            "pt": "Trimestral",
            "zh": "每季度",
        },
    },
    {
        "key": "yearly",
        "label": "Yearly",
        "translations": {
            "de": "Jährlich",
            "fr": "Annuel",
            "es": "Anual",
            "it": "Annuale",
            "pt": "Anual",
            "zh": "每年",
        },
    },
    {
        "key": "continuous",
        "label": "Continuous",
        "translations": {
            "de": "Kontinuierlich",
            "fr": "Continu",
            "es": "Continuo",
            "it": "Continuo",
            "pt": "Contínuo",
            "zh": "持续",
        },
    },
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
                "translations": {
                    "de": "Zielinformationen",
                    "fr": "Informations sur l'objectif",
                    "es": "Información del objetivo",
                    "it": "Informazioni sull'obiettivo",
                    "pt": "Informações do objetivo",
                    "zh": "目标信息",
                },
                "fields": [
                    {
                        "key": "objectiveType",
                        "label": "Objective Type",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "strategic",
                                "label": "Strategic",
                                "translations": {
                                    "de": "Strategisch",
                                    "fr": "Stratégique",
                                    "es": "Estratégico",
                                    "it": "Strategico",
                                    "pt": "Estratégico",
                                    "zh": "战略性",
                                },
                            },
                            {
                                "key": "tactical",
                                "label": "Tactical",
                                "translations": {
                                    "de": "Taktisch",
                                    "fr": "Tactique",
                                    "es": "Táctico",
                                    "it": "Tattico",
                                    "pt": "Tático",
                                    "zh": "战术性",
                                },
                            },
                            {
                                "key": "operational",
                                "label": "Operational",
                                "translations": {
                                    "de": "Operativ",
                                    "fr": "Opérationnel",
                                    "es": "Operativo",
                                    "it": "Operativo",
                                    "pt": "Operacional",
                                    "zh": "运营性",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Zieltyp",
                            "fr": "Type d'objectif",
                            "es": "Tipo de objetivo",
                            "it": "Tipo di obiettivo",
                            "pt": "Tipo de objetivo",
                            "zh": "目标类型",
                        },
                    },
                    {
                        "key": "targetDate",
                        "label": "Target Date",
                        "type": "date",
                        "weight": 1,
                        "translations": {
                            "de": "Zieldatum",
                            "fr": "Date cible",
                            "es": "Fecha objetivo",
                            "it": "Data obiettivo",
                            "pt": "Data alvo",
                            "zh": "目标日期",
                        },
                    },
                    {
                        "key": "progress",
                        "label": "Progress (%)",
                        "type": "number",
                        "weight": 1,
                        "translations": {
                            "de": "Fortschritt (%)",
                            "fr": "Progression (%)",
                            "es": "Progreso (%)",
                            "it": "Progresso (%)",
                            "pt": "Progresso (%)",
                            "zh": "进度 (%)",
                        },
                    },
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
            {
                "key": "digital",
                "label": "Digital",
                "translations": {
                    "de": "Digital",
                    "fr": "Numérique",
                    "es": "Digital",
                    "it": "Digitale",
                    "pt": "Digital",
                    "zh": "数字",
                },
            },
            {
                "key": "technical",
                "label": "Technical",
                "translations": {
                    "de": "Technisch",
                    "fr": "Technique",
                    "es": "Técnica",
                    "it": "Tecnica",
                    "pt": "Técnica",
                    "zh": "技术",
                },
            },
        ],
        "sort_order": 1,
        "fields_schema": [
            {
                "section": "Platform Information",
                "translations": {
                    "de": "Plattforminformationen",
                    "fr": "Informations sur la plateforme",
                    "es": "Información de la plataforma",
                    "it": "Informazioni sulla piattaforma",
                    "pt": "Informações da plataforma",
                    "zh": "平台信息",
                },
                "fields": [
                    {
                        "key": "platformType",
                        "label": "Platform Type",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "digital",
                                "label": "Digital",
                                "color": "#1976d2",
                                "translations": {
                                    "de": "Digital",
                                    "fr": "Numérique",
                                    "es": "Digital",
                                    "it": "Digitale",
                                    "pt": "Digital",
                                    "zh": "数字化",
                                },
                            },
                            {
                                "key": "technical",
                                "label": "Technical",
                                "color": "#607d8b",
                                "translations": {
                                    "de": "Technisch",
                                    "fr": "Technique",
                                    "es": "Técnico",
                                    "it": "Tecnico",
                                    "pt": "Técnico",
                                    "zh": "技术",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Plattformtyp",
                            "fr": "Type de plateforme",
                            "es": "Tipo de plataforma",
                            "it": "Tipo di piattaforma",
                            "pt": "Tipo de plataforma",
                            "zh": "平台类型",
                        },
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
            {
                "key": "idea",
                "label": "Idea",
                "translations": {
                    "de": "Idee",
                    "fr": "Idée",
                    "es": "Idea",
                    "it": "Idea",
                    "pt": "Ideia",
                    "zh": "创意",
                },
            },
            {
                "key": "program",
                "label": "Program",
                "translations": {
                    "de": "Programm",
                    "fr": "Programme",
                    "es": "Programa",
                    "it": "Programma",
                    "pt": "Programa",
                    "zh": "计划",
                },
            },
            {
                "key": "project",
                "label": "Project",
                "translations": {
                    "de": "Projekt",
                    "fr": "Projet",
                    "es": "Proyecto",
                    "it": "Progetto",
                    "pt": "Projeto",
                    "zh": "项目",
                },
            },
            {
                "key": "epic",
                "label": "Epic",
                "translations": {
                    "de": "Epic",
                    "fr": "Epic",
                    "es": "Épica",
                    "it": "Epic",
                    "pt": "Épico",
                    "zh": "史诗",
                },
            },
        ],
        "sort_order": 2,
        "fields_schema": [
            {
                "section": "Initiative Information",
                "translations": {
                    "de": "Initiativeninformationen",
                    "fr": "Informations sur l'initiative",
                    "es": "Información de la iniciativa",
                    "it": "Informazioni sull'iniziativa",
                    "pt": "Informações da iniciativa",
                    "zh": "举措信息",
                },
                "fields": [
                    {
                        "key": "initiativeStatus",
                        "label": "Status",
                        "type": "single_select",
                        "options": INITIATIVE_STATUS_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Status",
                            "fr": "Statut",
                            "es": "Estado",
                            "it": "Stato",
                            "pt": "Status",
                            "zh": "状态",
                        },
                    },
                    {
                        "key": "businessValue",
                        "label": "Business Value",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "high",
                                "label": "High",
                                "color": "#2e7d32",
                                "translations": {
                                    "de": "Hoch",
                                    "fr": "Élevée",
                                    "es": "Alto",
                                    "it": "Alto",
                                    "pt": "Alto",
                                    "zh": "高",
                                },
                            },
                            {
                                "key": "medium",
                                "label": "Medium",
                                "color": "#ff9800",
                                "translations": {
                                    "de": "Mittel",
                                    "fr": "Moyenne",
                                    "es": "Medio",
                                    "it": "Medio",
                                    "pt": "Médio",
                                    "zh": "中",
                                },
                            },
                            {
                                "key": "low",
                                "label": "Low",
                                "color": "#9e9e9e",
                                "translations": {
                                    "de": "Niedrig",
                                    "fr": "Faible",
                                    "es": "Bajo",
                                    "it": "Basso",
                                    "pt": "Baixo",
                                    "zh": "低",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Geschäftswert",
                            "fr": "Valeur métier",
                            "es": "Valor de negocio",
                            "it": "Valore aziendale",
                            "pt": "Valor de negócio",
                            "zh": "业务价值",
                        },
                    },
                    {
                        "key": "effort",
                        "label": "Effort",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "high",
                                "label": "High",
                                "color": "#d32f2f",
                                "translations": {
                                    "de": "Hoch",
                                    "fr": "Élevé",
                                    "es": "Alto",
                                    "it": "Alto",
                                    "pt": "Alto",
                                    "zh": "高",
                                },
                            },
                            {
                                "key": "medium",
                                "label": "Medium",
                                "color": "#ff9800",
                                "translations": {
                                    "de": "Mittel",
                                    "fr": "Moyen",
                                    "es": "Medio",
                                    "it": "Medio",
                                    "pt": "Médio",
                                    "zh": "中",
                                },
                            },
                            {
                                "key": "low",
                                "label": "Low",
                                "color": "#4caf50",
                                "translations": {
                                    "de": "Niedrig",
                                    "fr": "Faible",
                                    "es": "Bajo",
                                    "it": "Basso",
                                    "pt": "Baixo",
                                    "zh": "低",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Aufwand",
                            "fr": "Effort",
                            "es": "Esfuerzo",
                            "it": "Impegno",
                            "pt": "Esforço",
                            "zh": "工作量",
                        },
                    },
                ],
            },
            {
                "section": "Cost & Timeline",
                "translations": {
                    "de": "Kosten & Zeitplan",
                    "fr": "Coûts et calendrier",
                    "es": "Costes y cronograma",
                    "it": "Costi e tempistica",
                    "pt": "Custos e cronograma",
                    "zh": "成本与时间表",
                },
                "fields": [
                    {
                        "key": "costBudget",
                        "label": "Budget",
                        "type": "cost",
                        "weight": 1,
                        "translations": {
                            "de": "Budget",
                            "fr": "Budget",
                            "es": "Presupuesto",
                            "it": "Budget",
                            "pt": "Orçamento",
                            "zh": "预算",
                        },
                    },
                    {
                        "key": "costActual",
                        "label": "Actual Cost",
                        "type": "cost",
                        "weight": 0,
                        "translations": {
                            "de": "Ist-Kosten",
                            "fr": "Coût réel",
                            "es": "Coste real",
                            "it": "Costo effettivo",
                            "pt": "Custo real",
                            "zh": "实际成本",
                        },
                    },
                    {
                        "key": "startDate",
                        "label": "Start Date",
                        "type": "date",
                        "weight": 1,
                        "translations": {
                            "de": "Startdatum",
                            "fr": "Date de début",
                            "es": "Fecha de inicio",
                            "it": "Data di inizio",
                            "pt": "Data de início",
                            "zh": "开始日期",
                        },
                    },
                    {
                        "key": "endDate",
                        "label": "End Date",
                        "type": "date",
                        "weight": 1,
                        "translations": {
                            "de": "Enddatum",
                            "fr": "Date de fin",
                            "es": "Fecha de fin",
                            "it": "Data di fine",
                            "pt": "Data de término",
                            "zh": "结束日期",
                        },
                    },
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
            {
                "key": "businessUnit",
                "label": "Business Unit",
                "translations": {
                    "de": "Geschäftseinheit",
                    "fr": "Unité métier",
                    "es": "Unidad de negocio",
                    "it": "Unità aziendale",
                    "pt": "Unidade de negócio",
                    "zh": "业务单元",
                },
            },
            {
                "key": "region",
                "label": "Region",
                "translations": {
                    "de": "Region",
                    "fr": "Région",
                    "es": "Región",
                    "it": "Regione",
                    "pt": "Região",
                    "zh": "区域",
                },
            },
            {
                "key": "legalEntity",
                "label": "Legal Entity",
                "translations": {
                    "de": "Rechtseinheit",
                    "fr": "Entité juridique",
                    "es": "Entidad legal",
                    "it": "Entità giuridica",
                    "pt": "Entidade legal",
                    "zh": "法律实体",
                },
            },
            {
                "key": "team",
                "label": "Team",
                "translations": {
                    "de": "Team",
                    "fr": "Équipe",
                    "es": "Equipo",
                    "it": "Team",
                    "pt": "Equipe",
                    "zh": "团队",
                },
            },
            {
                "key": "customer",
                "label": "Customer",
                "translations": {
                    "de": "Kunde",
                    "fr": "Client",
                    "es": "Cliente",
                    "it": "Cliente",
                    "pt": "Cliente",
                    "zh": "客户",
                },
            },
        ],
        "sort_order": 3,
        "fields_schema": [
            {
                "section": "Organization Information",
                "translations": {
                    "de": "Organisationsinformationen",
                    "fr": "Informations sur l'organisation",
                    "es": "Información de la organización",
                    "it": "Informazioni sull'organizzazione",
                    "pt": "Informações da organização",
                    "zh": "组织信息",
                },
                "fields": [
                    {
                        "key": "headCount",
                        "label": "Head Count",
                        "type": "number",
                        "weight": 0,
                        "translations": {
                            "de": "Mitarbeiterzahl",
                            "fr": "Effectif",
                            "es": "Número de empleados",
                            "it": "Organico",
                            "pt": "Número de funcionários",
                            "zh": "员工人数",
                        },
                    },
                    {
                        "key": "location",
                        "label": "Location",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Standort",
                            "fr": "Localisation",
                            "es": "Ubicación",
                            "it": "Sede",
                            "pt": "Localização",
                            "zh": "位置",
                        },
                    },
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
                "translations": {
                    "de": "Fähigkeitsinformationen",
                    "fr": "Informations sur la capacité",
                    "es": "Información de la capacidad",
                    "it": "Informazioni sulla capacità",
                    "pt": "Informações da capacidade",
                    "zh": "能力信息",
                },
                "fields": [
                    {
                        "key": "capabilityLevel",
                        "label": "Capability Level",
                        "type": "single_select",
                        "readonly": True,
                        "options": [
                            {
                                "key": "L1",
                                "label": "Level 1",
                                "color": "#1565c0",
                                "translations": {
                                    "de": "Ebene 1",
                                    "fr": "Niveau 1",
                                    "es": "Nivel 1",
                                    "it": "Livello 1",
                                    "pt": "Nível 1",
                                    "zh": "级别 1",
                                },
                            },
                            {
                                "key": "L2",
                                "label": "Level 2",
                                "color": "#42a5f5",
                                "translations": {
                                    "de": "Ebene 2",
                                    "fr": "Niveau 2",
                                    "es": "Nivel 2",
                                    "it": "Livello 2",
                                    "pt": "Nível 2",
                                    "zh": "级别 2",
                                },
                            },
                            {
                                "key": "L3",
                                "label": "Level 3",
                                "color": "#90caf9",
                                "translations": {
                                    "de": "Ebene 3",
                                    "fr": "Niveau 3",
                                    "es": "Nivel 3",
                                    "it": "Livello 3",
                                    "pt": "Nível 3",
                                    "zh": "级别 3",
                                },
                            },
                            {
                                "key": "L4",
                                "label": "Level 4",
                                "color": "#bbdefb",
                                "translations": {
                                    "de": "Ebene 4",
                                    "fr": "Niveau 4",
                                    "es": "Nivel 4",
                                    "it": "Livello 4",
                                    "pt": "Nível 4",
                                    "zh": "级别 4",
                                },
                            },
                            {
                                "key": "L5",
                                "label": "Level 5",
                                "color": "#e3f2fd",
                                "translations": {
                                    "de": "Ebene 5",
                                    "fr": "Niveau 5",
                                    "es": "Nivel 5",
                                    "it": "Livello 5",
                                    "pt": "Nível 5",
                                    "zh": "级别 5",
                                },
                            },
                        ],
                        "weight": 0,
                        "translations": {
                            "de": "Fähigkeitsebene",
                            "fr": "Niveau de capacité",
                            "es": "Nivel de capacidad",
                            "it": "Livello di capacità",
                            "pt": "Nível de capacidade",
                            "zh": "能力级别",
                        },
                    },
                    {
                        "key": "isCoreCapability",
                        "label": "Core Capability",
                        "type": "boolean",
                        "weight": 0,
                        "translations": {
                            "de": "Kernfähigkeit",
                            "fr": "Capacité fondamentale",
                            "es": "Capacidad central",
                            "it": "Capacità fondamentale",
                            "pt": "Capacidade central",
                            "zh": "核心能力",
                        },
                    },
                ],
            },
            {
                "section": "BPM Assessment",
                "translations": {
                    "de": "BPM-Bewertung",
                    "fr": "Évaluation BPM",
                    "es": "Evaluación BPM",
                    "it": "Valutazione BPM",
                    "pt": "Avaliação BPM",
                    "zh": "BPM评估",
                },
                "fields": [
                    {
                        "key": "strategicImportance",
                        "label": "Strategic Importance",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "low",
                                "label": "Low",
                                "color": "#9e9e9e",
                                "translations": {
                                    "de": "Niedrig",
                                    "fr": "Faible",
                                    "es": "Baja",
                                    "it": "Bassa",
                                    "pt": "Baixa",
                                    "zh": "低",
                                },
                            },
                            {
                                "key": "medium",
                                "label": "Medium",
                                "color": "#ff9800",
                                "translations": {
                                    "de": "Mittel",
                                    "fr": "Moyenne",
                                    "es": "Media",
                                    "it": "Media",
                                    "pt": "Média",
                                    "zh": "中",
                                },
                            },
                            {
                                "key": "high",
                                "label": "High",
                                "color": "#1976d2",
                                "translations": {
                                    "de": "Hoch",
                                    "fr": "Élevée",
                                    "es": "Alta",
                                    "it": "Alta",
                                    "pt": "Alta",
                                    "zh": "高",
                                },
                            },
                            {
                                "key": "critical",
                                "label": "Critical",
                                "color": "#d32f2f",
                                "translations": {
                                    "de": "Kritisch",
                                    "fr": "Critique",
                                    "es": "Crítica",
                                    "it": "Critica",
                                    "pt": "Crítica",
                                    "zh": "关键",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Strategische Bedeutung",
                            "fr": "Importance stratégique",
                            "es": "Importancia estratégica",
                            "it": "Importanza strategica",
                            "pt": "Importância estratégica",
                            "zh": "战略重要性",
                        },
                    },
                    {
                        "key": "maturity",
                        "label": "Capability Maturity",
                        "type": "single_select",
                        "options": PROCESS_MATURITY_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Fähigkeitsreifegrad",
                            "fr": "Maturité de la capacité",
                            "es": "Madurez de la capacidad",
                            "it": "Maturità della capacità",
                            "pt": "Maturidade da capacidade",
                            "zh": "能力成熟度",
                        },
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
            {
                "key": "process",
                "label": "Process",
                "translations": {
                    "de": "Prozess",
                    "fr": "Processus",
                    "es": "Proceso",
                    "it": "Processo",
                    "pt": "Processo",
                    "zh": "流程",
                },
            },
            {
                "key": "valueStream",
                "label": "Value Stream",
                "translations": {
                    "de": "Wertstrom",
                    "fr": "Chaîne de valeur",
                    "es": "Cadena de valor",
                    "it": "Flusso di valore",
                    "pt": "Cadeia de valor",
                    "zh": "价值流",
                },
            },
            {
                "key": "customerJourney",
                "label": "Customer Journey",
                "translations": {
                    "de": "Customer Journey",
                    "fr": "Parcours client",
                    "es": "Recorrido del cliente",
                    "it": "Percorso del cliente",
                    "pt": "Jornada do cliente",
                    "zh": "客户旅程",
                },
            },
            {
                "key": "businessProduct",
                "label": "Business Product",
                "translations": {
                    "de": "Geschäftsprodukt",
                    "fr": "Produit métier",
                    "es": "Producto de negocio",
                    "it": "Prodotto aziendale",
                    "pt": "Produto de negócio",
                    "zh": "业务产品",
                },
            },
            {
                "key": "esgCapability",
                "label": "ESG Capability",
                "translations": {
                    "de": "ESG-Fähigkeit",
                    "fr": "Capacité ESG",
                    "es": "Capacidad ESG",
                    "it": "Capacità ESG",
                    "pt": "Capacidade ESG",
                    "zh": "ESG能力",
                },
            },
        ],
        "sort_order": 5,
        "fields_schema": [
            {
                "section": "Business Context Information",
                "translations": {
                    "de": "Geschäftskontextinformationen",
                    "fr": "Informations sur le contexte métier",
                    "es": "Información del contexto de negocio",
                    "it": "Informazioni sul contesto aziendale",
                    "pt": "Informações do contexto de negócio",
                    "zh": "业务上下文信息",
                },
                "fields": [
                    {
                        "key": "maturity",
                        "label": "Maturity",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "initial",
                                "label": "Initial",
                                "color": "#d32f2f",
                                "translations": {
                                    "de": "Initial",
                                    "fr": "Initial",
                                    "es": "Inicial",
                                    "it": "Iniziale",
                                    "pt": "Inicial",
                                    "zh": "初始",
                                },
                            },
                            {
                                "key": "defined",
                                "label": "Defined",
                                "color": "#ff9800",
                                "translations": {
                                    "de": "Definiert",
                                    "fr": "Défini",
                                    "es": "Definido",
                                    "it": "Definito",
                                    "pt": "Definido",
                                    "zh": "已定义",
                                },
                            },
                            {
                                "key": "managed",
                                "label": "Managed",
                                "color": "#fbc02d",
                                "translations": {
                                    "de": "Gesteuert",
                                    "fr": "Géré",
                                    "es": "Gestionado",
                                    "it": "Gestito",
                                    "pt": "Gerenciado",
                                    "zh": "已管理",
                                },
                            },
                            {
                                "key": "optimized",
                                "label": "Optimized",
                                "color": "#4caf50",
                                "translations": {
                                    "de": "Optimiert",
                                    "fr": "Optimisé",
                                    "es": "Optimizado",
                                    "it": "Ottimizzato",
                                    "pt": "Otimizado",
                                    "zh": "已优化",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Reifegrad",
                            "fr": "Maturité",
                            "es": "Madurez",
                            "it": "Maturità",
                            "pt": "Maturidade",
                            "zh": "成熟度",
                        },
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
            {
                "key": "category",
                "label": "Process Category",
                "translations": {
                    "de": "Prozesskategorie",
                    "fr": "Catégorie de processus",
                    "es": "Categoría de proceso",
                    "it": "Categoria di processo",
                    "pt": "Categoria de processo",
                    "zh": "流程类别",
                },
            },
            {
                "key": "group",
                "label": "Process Group",
                "translations": {
                    "de": "Prozessgruppe",
                    "fr": "Groupe de processus",
                    "es": "Grupo de procesos",
                    "it": "Gruppo di processi",
                    "pt": "Grupo de processos",
                    "zh": "流程组",
                },
            },
            {
                "key": "process",
                "label": "Process",
                "translations": {
                    "de": "Prozess",
                    "fr": "Processus",
                    "es": "Proceso",
                    "it": "Processo",
                    "pt": "Processo",
                    "zh": "流程",
                },
            },
            {
                "key": "variant",
                "label": "Process Variant",
                "translations": {
                    "de": "Prozessvariante",
                    "fr": "Variante de processus",
                    "es": "Variante de proceso",
                    "it": "Variante di processo",
                    "pt": "Variante de processo",
                    "zh": "流程变体",
                },
            },
        ],
        "sort_order": 6,
        "fields_schema": [
            {
                "section": "Process Classification",
                "translations": {
                    "de": "Prozessklassifikation",
                    "fr": "Classification du processus",
                    "es": "Clasificación del proceso",
                    "it": "Classificazione del processo",
                    "pt": "Classificação do processo",
                    "zh": "流程分类",
                },
                "fields": [
                    {
                        "key": "processType",
                        "label": "Process Type",
                        "type": "single_select",
                        "required": True,
                        "options": PROCESS_TYPE_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Prozesstyp",
                            "fr": "Type de processus",
                            "es": "Tipo de proceso",
                            "it": "Tipo di processo",
                            "pt": "Tipo de processo",
                            "zh": "流程类型",
                        },
                    },
                    {
                        "key": "maturity",
                        "label": "Maturity (CMMI)",
                        "type": "single_select",
                        "options": PROCESS_MATURITY_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Reifegrad (CMMI)",
                            "fr": "Maturité (CMMI)",
                            "es": "Madurez (CMMI)",
                            "it": "Maturità (CMMI)",
                            "pt": "Maturidade (CMMI)",
                            "zh": "成熟度 (CMMI)",
                        },
                    },
                    {
                        "key": "automationLevel",
                        "label": "Automation Level",
                        "type": "single_select",
                        "options": AUTOMATION_LEVEL_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Automatisierungsgrad",
                            "fr": "Niveau d'automatisation",
                            "es": "Nivel de automatización",
                            "it": "Livello di automazione",
                            "pt": "Nível de automação",
                            "zh": "自动化级别",
                        },
                    },
                    {
                        "key": "riskLevel",
                        "label": "Risk Level",
                        "type": "single_select",
                        "options": PROCESS_RISK_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Risikostufe",
                            "fr": "Niveau de risque",
                            "es": "Nivel de riesgo",
                            "it": "Livello di rischio",
                            "pt": "Nível de risco",
                            "zh": "风险级别",
                        },
                    },
                ],
            },
            {
                "section": "Operational Details",
                "translations": {
                    "de": "Betriebliche Details",
                    "fr": "Détails opérationnels",
                    "es": "Detalles operativos",
                    "it": "Dettagli operativi",
                    "pt": "Detalhes operacionais",
                    "zh": "运营详情",
                },
                "fields": [
                    {
                        "key": "frequency",
                        "label": "Execution Frequency",
                        "type": "single_select",
                        "options": PROCESS_FREQUENCY_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Ausführungshäufigkeit",
                            "fr": "Fréquence d'exécution",
                            "es": "Frecuencia de ejecución",
                            "it": "Frequenza di esecuzione",
                            "pt": "Frequência de execução",
                            "zh": "执行频率",
                        },
                    },
                    {
                        "key": "documentationUrl",
                        "label": "Process Documentation URL",
                        "type": "url",
                        "weight": 0,
                        "translations": {
                            "de": "Prozessdokumentation URL",
                            "fr": "URL de documentation du processus",
                            "es": "URL de documentación del proceso",
                            "it": "URL documentazione del processo",
                            "pt": "URL da documentação do processo",
                            "zh": "流程文档 URL",
                        },
                    },
                    {
                        "key": "regulatoryRelevance",
                        "label": "Regulatory Relevance",
                        "type": "boolean",
                        "weight": 1,
                        "translations": {
                            "de": "Regulatorische Relevanz",
                            "fr": "Pertinence réglementaire",
                            "es": "Relevancia regulatoria",
                            "it": "Rilevanza normativa",
                            "pt": "Relevância regulatória",
                            "zh": "合规相关性",
                        },
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
            {
                "key": "businessApplication",
                "label": "Business Application",
                "translations": {
                    "de": "Geschäftsanwendung",
                    "fr": "Application métier",
                    "es": "Aplicación de negocio",
                    "it": "Applicazione aziendale",
                    "pt": "Aplicação de negócio",
                    "zh": "业务应用",
                },
            },
            {
                "key": "microservice",
                "label": "Microservice",
                "translations": {
                    "de": "Microservice",
                    "fr": "Microservice",
                    "es": "Microservicio",
                    "it": "Microservizio",
                    "pt": "Microsserviço",
                    "zh": "微服务",
                },
            },
            {
                "key": "aiAgent",
                "label": "AI Agent",
                "translations": {
                    "de": "KI-Agent",
                    "fr": "Agent IA",
                    "es": "Agente de IA",
                    "it": "Agente IA",
                    "pt": "Agente de IA",
                    "zh": "AI代理",
                },
            },
            {
                "key": "deployment",
                "label": "Deployment",
                "translations": {
                    "de": "Bereitstellung",
                    "fr": "Déploiement",
                    "es": "Despliegue",
                    "it": "Distribuzione",
                    "pt": "Implantação",
                    "zh": "部署",
                },
            },
        ],
        "sort_order": 7,
        "fields_schema": [
            {
                "section": "Application Information",
                "translations": {
                    "de": "Anwendungsinformationen",
                    "fr": "Informations sur l'application",
                    "es": "Información de la aplicación",
                    "it": "Informazioni sull'applicazione",
                    "pt": "Informações da aplicação",
                    "zh": "应用信息",
                },
                "fields": [
                    {
                        "key": "businessCriticality",
                        "label": "Business Criticality",
                        "type": "single_select",
                        "required": True,
                        "options": BUSINESS_CRITICALITY_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Geschäftskritikalität",
                            "fr": "Criticité métier",
                            "es": "Criticidad de negocio",
                            "it": "Criticità aziendale",
                            "pt": "Criticidade de negócio",
                            "zh": "业务关键性",
                        },
                    },
                    {
                        "key": "functionalSuitability",
                        "label": "Functional Suitability",
                        "type": "single_select",
                        "options": FUNCTIONAL_SUITABILITY_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Funktionale Eignung",
                            "fr": "Adéquation fonctionnelle",
                            "es": "Idoneidad funcional",
                            "it": "Idoneità funzionale",
                            "pt": "Adequação funcional",
                            "zh": "功能适用性",
                        },
                    },
                    {
                        "key": "technicalSuitability",
                        "label": "Technical Suitability",
                        "type": "single_select",
                        "options": TECHNICAL_SUITABILITY_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Technische Eignung",
                            "fr": "Adéquation technique",
                            "es": "Idoneidad técnica",
                            "it": "Idoneità tecnica",
                            "pt": "Adequação técnica",
                            "zh": "技术适用性",
                        },
                    },
                    {
                        "key": "timeModel",
                        "label": "TIME Model",
                        "type": "single_select",
                        "required": True,
                        "options": TIME_MODEL_OPTIONS,
                        "weight": 3,
                        "translations": {
                            "de": "TIME-Modell",
                            "fr": "Modèle TIME",
                            "es": "Modelo TIME",
                            "it": "Modello TIME",
                            "pt": "Modelo TIME",
                            "zh": "TIME 模型",
                        },
                    },
                    {
                        "key": "hostingType",
                        "label": "Hosting Type",
                        "type": "single_select",
                        "options": HOSTING_TYPE_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Hosting-Typ",
                            "fr": "Type d'hébergement",
                            "es": "Tipo de alojamiento",
                            "it": "Tipo di hosting",
                            "pt": "Tipo de hospedagem",
                            "zh": "托管类型",
                        },
                    },
                ],
            },
            {
                "section": "Cost & Ownership",
                "translations": {
                    "de": "Kosten & Eigentümerschaft",
                    "fr": "Coûts et propriété",
                    "es": "Costes y propiedad",
                    "it": "Costi e proprietà",
                    "pt": "Custos e propriedade",
                    "zh": "成本与所有权",
                },
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Total Annual Cost",
                        "type": "cost",
                        "weight": 1,
                        "translations": {
                            "de": "Jährliche Gesamtkosten",
                            "fr": "Coût annuel total",
                            "es": "Coste anual total",
                            "it": "Costo annuale totale",
                            "pt": "Custo anual total",
                            "zh": "年度总成本",
                        },
                    },
                    {
                        "key": "numberOfUsers",
                        "label": "Number of Users",
                        "type": "number",
                        "weight": 0,
                        "translations": {
                            "de": "Anzahl Benutzer",
                            "fr": "Nombre d'utilisateurs",
                            "es": "Número de usuarios",
                            "it": "Numero di utenti",
                            "pt": "Número de usuários",
                            "zh": "用户数量",
                        },
                    },
                    {
                        "key": "vendor",
                        "label": "Vendor",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Anbieter",
                            "fr": "Fournisseur",
                            "es": "Proveedor",
                            "it": "Fornitore",
                            "pt": "Fornecedor",
                            "zh": "供应商",
                        },
                    },
                    {
                        "key": "productName",
                        "label": "Product Name",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Produktname",
                            "fr": "Nom du produit",
                            "es": "Nombre del producto",
                            "it": "Nome del prodotto",
                            "pt": "Nome do produto",
                            "zh": "产品名称",
                        },
                    },
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
            {
                "key": "logicalInterface",
                "label": "Logical Interface",
                "translations": {
                    "de": "Logische Schnittstelle",
                    "fr": "Interface logique",
                    "es": "Interfaz lógica",
                    "it": "Interfaccia logica",
                    "pt": "Interface lógica",
                    "zh": "逻辑接口",
                },
            },
            {
                "key": "api",
                "label": "API",
                "translations": {
                    "de": "API",
                    "fr": "API",
                    "es": "API",
                    "it": "API",
                    "pt": "API",
                    "zh": "API",
                },
            },
            {
                "key": "mcpServer",
                "label": "MCP Server",
                "translations": {
                    "de": "MCP-Server",
                    "fr": "Serveur MCP",
                    "es": "Servidor MCP",
                    "it": "Server MCP",
                    "pt": "Servidor MCP",
                    "zh": "MCP服务器",
                },
            },
        ],
        "sort_order": 8,
        "fields_schema": [
            {
                "section": "Interface Information",
                "translations": {
                    "de": "Schnittstelleninformationen",
                    "fr": "Informations sur l'interface",
                    "es": "Información de la interfaz",
                    "it": "Informazioni sull'interfaccia",
                    "pt": "Informações da interface",
                    "zh": "接口信息",
                },
                "fields": [
                    {
                        "key": "frequency",
                        "label": "Frequency",
                        "type": "single_select",
                        "options": FREQUENCY_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Häufigkeit",
                            "fr": "Fréquence",
                            "es": "Frecuencia",
                            "it": "Frequenza",
                            "pt": "Frequência",
                            "zh": "频率",
                        },
                    },
                    {
                        "key": "dataFormat",
                        "label": "Data Format",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Datenformat",
                            "fr": "Format de données",
                            "es": "Formato de datos",
                            "it": "Formato dati",
                            "pt": "Formato de dados",
                            "zh": "数据格式",
                        },
                    },
                    {
                        "key": "protocol",
                        "label": "Protocol",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Protokoll",
                            "fr": "Protocole",
                            "es": "Protocolo",
                            "it": "Protocollo",
                            "pt": "Protocolo",
                            "zh": "协议",
                        },
                    },
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
                "translations": {
                    "de": "Dateninformationen",
                    "fr": "Informations sur les données",
                    "es": "Información de datos",
                    "it": "Informazioni sui dati",
                    "pt": "Informações de dados",
                    "zh": "数据信息",
                },
                "fields": [
                    {
                        "key": "dataSensitivity",
                        "label": "Data Sensitivity",
                        "type": "single_select",
                        "options": DATA_SENSITIVITY_OPTIONS,
                        "weight": 1,
                        "translations": {
                            "de": "Datensensibilität",
                            "fr": "Sensibilité des données",
                            "es": "Sensibilidad de datos",
                            "it": "Sensibilità dei dati",
                            "pt": "Sensibilidade dos dados",
                            "zh": "数据敏感性",
                        },
                    },
                    {
                        "key": "dataOwner",
                        "label": "Data Owner",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Dateneigentümer",
                            "fr": "Propriétaire des données",
                            "es": "Propietario de datos",
                            "it": "Proprietario dei dati",
                            "pt": "Proprietário dos dados",
                            "zh": "数据所有者",
                        },
                    },
                    {
                        "key": "isPersonalData",
                        "label": "Contains Personal Data",
                        "type": "boolean",
                        "weight": 1,
                        "translations": {
                            "de": "Enthält personenbezogene Daten",
                            "fr": "Contient des données personnelles",
                            "es": "Contiene datos personales",
                            "it": "Contiene dati personali",
                            "pt": "Contém dados pessoais",
                            "zh": "包含个人数据",
                        },
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
            {
                "key": "software",
                "label": "Software",
                "translations": {
                    "de": "Software",
                    "fr": "Logiciel",
                    "es": "Software",
                    "it": "Software",
                    "pt": "Software",
                    "zh": "软件",
                },
            },
            {
                "key": "hardware",
                "label": "Hardware",
                "translations": {
                    "de": "Hardware",
                    "fr": "Matériel",
                    "es": "Hardware",
                    "it": "Hardware",
                    "pt": "Hardware",
                    "zh": "硬件",
                },
            },
            {
                "key": "saas",
                "label": "SaaS",
                "translations": {
                    "de": "SaaS",
                    "fr": "SaaS",
                    "es": "SaaS",
                    "it": "SaaS",
                    "pt": "SaaS",
                    "zh": "SaaS",
                },
            },
            {
                "key": "paas",
                "label": "PaaS",
                "translations": {
                    "de": "PaaS",
                    "fr": "PaaS",
                    "es": "PaaS",
                    "it": "PaaS",
                    "pt": "PaaS",
                    "zh": "PaaS",
                },
            },
            {
                "key": "iaas",
                "label": "IaaS",
                "translations": {
                    "de": "IaaS",
                    "fr": "IaaS",
                    "es": "IaaS",
                    "it": "IaaS",
                    "pt": "IaaS",
                    "zh": "IaaS",
                },
            },
            {
                "key": "service",
                "label": "Service",
                "translations": {
                    "de": "Dienst",
                    "fr": "Service",
                    "es": "Servicio",
                    "it": "Servizio",
                    "pt": "Serviço",
                    "zh": "服务",
                },
            },
            {
                "key": "aiModel",
                "label": "AI Model",
                "translations": {
                    "de": "KI-Modell",
                    "fr": "Modèle IA",
                    "es": "Modelo de IA",
                    "it": "Modello IA",
                    "pt": "Modelo de IA",
                    "zh": "AI模型",
                },
            },
        ],
        "sort_order": 10,
        "fields_schema": [
            {
                "section": "Component Information",
                "translations": {
                    "de": "Komponenteninformationen",
                    "fr": "Informations sur le composant",
                    "es": "Información del componente",
                    "it": "Informazioni sul componente",
                    "pt": "Informações do componente",
                    "zh": "组件信息",
                },
                "fields": [
                    {
                        "key": "technicalSuitability",
                        "label": "Technical Suitability",
                        "type": "single_select",
                        "options": TECHNICAL_SUITABILITY_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Technische Eignung",
                            "fr": "Adéquation technique",
                            "es": "Idoneidad técnica",
                            "it": "Idoneità tecnica",
                            "pt": "Adequação técnica",
                            "zh": "技术适用性",
                        },
                    },
                    {
                        "key": "resourceClassification",
                        "label": "Resource Classification",
                        "type": "single_select",
                        "options": RESOURCE_CLASSIFICATION_OPTIONS,
                        "weight": 2,
                        "translations": {
                            "de": "Ressourcenklassifizierung",
                            "fr": "Classification des ressources",
                            "es": "Clasificación de recursos",
                            "it": "Classificazione delle risorse",
                            "pt": "Classificação de recursos",
                            "zh": "资源分类",
                        },
                    },
                    {
                        "key": "vendor",
                        "label": "Vendor",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Anbieter",
                            "fr": "Fournisseur",
                            "es": "Proveedor",
                            "it": "Fornitore",
                            "pt": "Fornecedor",
                            "zh": "供应商",
                        },
                    },
                    {
                        "key": "version",
                        "label": "Version",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Version",
                            "fr": "Version",
                            "es": "Versión",
                            "it": "Versione",
                            "pt": "Versão",
                            "zh": "版本",
                        },
                    },
                ],
            },
            {
                "section": "Cost",
                "translations": {
                    "de": "Kosten",
                    "fr": "Coûts",
                    "es": "Costes",
                    "it": "Costi",
                    "pt": "Custos",
                    "zh": "成本",
                },
                "fields": [
                    {
                        "key": "costTotalAnnual",
                        "label": "Total Annual Cost",
                        "type": "cost",
                        "weight": 1,
                        "translations": {
                            "de": "Jährliche Gesamtkosten",
                            "fr": "Coût annuel total",
                            "es": "Coste anual total",
                            "it": "Costo annuale totale",
                            "pt": "Custo anual total",
                            "zh": "年度总成本",
                        },
                    },
                    {
                        "key": "licenseType",
                        "label": "License Type",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Lizenztyp",
                            "fr": "Type de licence",
                            "es": "Tipo de licencia",
                            "it": "Tipo di licenza",
                            "pt": "Tipo de licença",
                            "zh": "许可类型",
                        },
                    },
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
                "translations": {
                    "de": "Anbieterinformationen",
                    "fr": "Informations sur le fournisseur",
                    "es": "Información del proveedor",
                    "it": "Informazioni sul fornitore",
                    "pt": "Informações do fornecedor",
                    "zh": "供应商信息",
                },
                "fields": [
                    {
                        "key": "providerType",
                        "label": "Provider Type",
                        "type": "single_select",
                        "options": [
                            {
                                "key": "vendor",
                                "label": "Vendor",
                                "translations": {
                                    "de": "Lieferant",
                                    "fr": "Fournisseur",
                                    "es": "Proveedor",
                                    "it": "Fornitore",
                                    "pt": "Fornecedor",
                                    "zh": "供应商",
                                },
                            },
                            {
                                "key": "partner",
                                "label": "Partner",
                                "translations": {
                                    "de": "Partner",
                                    "fr": "Partenaire",
                                    "es": "Socio",
                                    "it": "Partner",
                                    "pt": "Parceiro",
                                    "zh": "合作伙伴",
                                },
                            },
                            {
                                "key": "internalProvider",
                                "label": "Internal Provider",
                                "translations": {
                                    "de": "Interner Anbieter",
                                    "fr": "Fournisseur interne",
                                    "es": "Proveedor interno",
                                    "it": "Fornitore interno",
                                    "pt": "Provedor interno",
                                    "zh": "内部供应商",
                                },
                            },
                        ],
                        "weight": 1,
                        "translations": {
                            "de": "Anbietertyp",
                            "fr": "Type de fournisseur",
                            "es": "Tipo de proveedor",
                            "it": "Tipo di fornitore",
                            "pt": "Tipo de fornecedor",
                            "zh": "供应商类型",
                        },
                    },
                    {
                        "key": "website",
                        "label": "Website",
                        "type": "text",
                        "weight": 0,
                        "translations": {
                            "de": "Website",
                            "fr": "Site web",
                            "es": "Sitio web",
                            "it": "Sito web",
                            "pt": "Website",
                            "zh": "网站",
                        },
                    },
                    {
                        "key": "contractEnd",
                        "label": "Contract End Date",
                        "type": "date",
                        "weight": 0,
                        "translations": {
                            "de": "Vertragsende",
                            "fr": "Date de fin de contrat",
                            "es": "Fecha de fin de contrato",
                            "it": "Data di fine contratto",
                            "pt": "Data de término do contrato",
                            "zh": "合同结束日期",
                        },
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
            # Update built-in types: add new sections & merge translations
            existing = existing_types[key]
            if existing.built_in:
                # Merge type-level translations
                seed_translations = t.get("translations", {})
                if seed_translations:
                    existing.translations = {
                        **(existing.translations or {}),
                        **seed_translations,
                    }

                # Merge subtype translations
                seed_subtypes = t.get("subtypes", [])
                if seed_subtypes and existing.subtypes:
                    seed_sub_map = {s["key"]: s for s in seed_subtypes}
                    updated_subtypes = []
                    for sub in existing.subtypes:
                        seed_sub = seed_sub_map.get(sub["key"])
                        if seed_sub and "translations" in seed_sub:
                            merged = dict(sub)
                            merged["translations"] = {
                                **merged.get("translations", {}),
                                **seed_sub["translations"],
                            }
                            updated_subtypes.append(merged)
                        else:
                            updated_subtypes.append(sub)
                    existing.subtypes = updated_subtypes

                # Merge fields_schema: add new sections & merge translations
                seed_schema = t.get("fields_schema", [])
                current_schema = existing.fields_schema or []
                current_sections = {s["section"] for s in current_schema}

                # Build seed lookup by section name
                seed_section_map = {s["section"]: s for s in seed_schema}

                # Merge translations into existing sections
                updated_schema = []
                for sec in current_schema:
                    seed_sec = seed_section_map.get(sec["section"])
                    if seed_sec:
                        merged_sec = dict(sec)
                        # Merge section-level translations
                        if "translations" in seed_sec:
                            merged_sec["translations"] = {
                                **merged_sec.get("translations", {}),
                                **seed_sec["translations"],
                            }
                        # Merge field-level translations
                        seed_field_map = {f["key"]: f for f in seed_sec.get("fields", [])}
                        merged_fields = []
                        for field in merged_sec.get("fields", []):
                            seed_field = seed_field_map.get(field["key"])
                            if seed_field:
                                mf = dict(field)
                                if "translations" in seed_field:
                                    mf["translations"] = {
                                        **mf.get("translations", {}),
                                        **seed_field["translations"],
                                    }
                                # Merge option translations
                                seed_opts = seed_field.get("options", [])
                                if seed_opts and mf.get("options"):
                                    seed_opt_map = {o["key"]: o for o in seed_opts}
                                    merged_opts = []
                                    for opt in mf["options"]:
                                        seed_opt = seed_opt_map.get(opt["key"])
                                        if seed_opt and "translations" in seed_opt:
                                            mo = dict(opt)
                                            mo["translations"] = {
                                                **mo.get("translations", {}),
                                                **seed_opt["translations"],
                                            }
                                            merged_opts.append(mo)
                                        else:
                                            merged_opts.append(opt)
                                    mf["options"] = merged_opts
                                merged_fields.append(mf)
                            else:
                                merged_fields.append(field)
                        merged_sec["fields"] = merged_fields
                        updated_schema.append(merged_sec)
                    else:
                        updated_schema.append(sec)

                # Add new sections that don't exist yet
                new_sections = [s for s in seed_schema if s["section"] not in current_sections]
                if new_sections:
                    updated_schema = updated_schema + new_sections

                existing.fields_schema = updated_schema
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
