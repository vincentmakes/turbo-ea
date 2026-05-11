"""Backfill the AI Governance section onto Application / ITComponent / Interface.

A new ``AI Governance`` section is added to the ``fields_schema`` of three
built-in card types in this release: ``Application``, ``ITComponent`` and
``Interface``. The section carries five JSONB-stored attributes —
``aiRiskClass``, ``aiSystemRole``, ``aiLifecycleStage``, ``aiIntendedPurpose``,
``aiClassificationOverride`` — that feed the new ``/grc?tab=governance&sub=ai``
inventory dashboard and the EU AI Act risk-classification flow.

``seed.py`` only inserts missing card-type rows on boot, so on existing
installs the new section never lands without an explicit migration. This
migration appends the section to each affected row's ``fields_schema``
exactly once — if the section is already present (re-run, admin already
added one with this exact name), the row is left untouched. Admin
customisations to the surrounding sections are preserved.

The section definition is **inlined here on purpose** so this migration
remains reproducible against the seed values current as of this release,
even if ``seed.py`` is later refactored.

Revision ID: 075
Revises: 074
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from alembic import op

revision = "075"
down_revision = "074"
branch_labels = None
depends_on = None


_AI_GOVERNANCE_SECTION_NAME = "AI Governance"
_TARGET_TYPE_KEYS = ("Application", "ITComponent", "Interface")

_AI_RISK_CLASS_OPTIONS: list[dict[str, Any]] = [
    {
        "key": "unacceptable",
        "label": "Unacceptable risk",
        "color": "#b71c1c",
        "translations": {
            "de": "Unannehmbares Risiko",
            "fr": "Risque inacceptable",
            "es": "Riesgo inaceptable",
            "it": "Rischio inaccettabile",
            "pt": "Risco inaceitável",
            "zh": "不可接受的风险",
            "ru": "Неприемлемый риск",
        },
    },
    {
        "key": "high",
        "label": "High risk",
        "color": "#e53935",
        "translations": {
            "de": "Hohes Risiko",
            "fr": "Risque élevé",
            "es": "Riesgo alto",
            "it": "Rischio elevato",
            "pt": "Risco alto",
            "zh": "高风险",
            "ru": "Высокий риск",
        },
    },
    {
        "key": "limited",
        "label": "Limited risk",
        "color": "#fbc02d",
        "translations": {
            "de": "Begrenztes Risiko",
            "fr": "Risque limité",
            "es": "Riesgo limitado",
            "it": "Rischio limitato",
            "pt": "Risco limitado",
            "zh": "有限风险",
            "ru": "Ограниченный риск",
        },
    },
    {
        "key": "minimal",
        "label": "Minimal risk",
        "color": "#43a047",
        "translations": {
            "de": "Minimales Risiko",
            "fr": "Risque minimal",
            "es": "Riesgo mínimo",
            "it": "Rischio minimo",
            "pt": "Risco mínimo",
            "zh": "最小风险",
            "ru": "Минимальный риск",
        },
    },
]

_AI_SYSTEM_ROLE_OPTIONS: list[dict[str, Any]] = [
    {
        "key": "provider",
        "label": "Provider",
        "color": "#1565c0",
        "translations": {
            "de": "Anbieter",
            "fr": "Fournisseur",
            "es": "Proveedor",
            "it": "Fornitore",
            "pt": "Fornecedor",
            "zh": "提供方",
            "ru": "Поставщик",
        },
    },
    {
        "key": "consumer",
        "label": "Consumer",
        "color": "#6a1b9a",
        "translations": {
            "de": "Nutzer",
            "fr": "Utilisateur",
            "es": "Consumidor",
            "it": "Utilizzatore",
            "pt": "Consumidor",
            "zh": "使用方",
            "ru": "Потребитель",
        },
    },
    {
        "key": "embedded",
        "label": "Embedded",
        "color": "#00897b",
        "translations": {
            "de": "Eingebettet",
            "fr": "Intégré",
            "es": "Integrado",
            "it": "Integrato",
            "pt": "Integrado",
            "zh": "嵌入式",
            "ru": "Встроенный",
        },
    },
]

_AI_LIFECYCLE_STAGE_OPTIONS: list[dict[str, Any]] = [
    {
        "key": "design",
        "label": "Design",
        "color": "#90a4ae",
        "translations": {
            "de": "Konzeption",
            "fr": "Conception",
            "es": "Diseño",
            "it": "Progettazione",
            "pt": "Concepção",
            "zh": "设计",
            "ru": "Проектирование",
        },
    },
    {
        "key": "training",
        "label": "Training",
        "color": "#7b1fa2",
        "translations": {
            "de": "Training",
            "fr": "Entraînement",
            "es": "Entrenamiento",
            "it": "Addestramento",
            "pt": "Treinamento",
            "zh": "训练",
            "ru": "Обучение",
        },
    },
    {
        "key": "validation",
        "label": "Validation",
        "color": "#1976d2",
        "translations": {
            "de": "Validierung",
            "fr": "Validation",
            "es": "Validación",
            "it": "Validazione",
            "pt": "Validação",
            "zh": "验证",
            "ru": "Валидация",
        },
    },
    {
        "key": "production",
        "label": "Production",
        "color": "#2e7d32",
        "translations": {
            "de": "Produktion",
            "fr": "Production",
            "es": "Producción",
            "it": "Produzione",
            "pt": "Produção",
            "zh": "生产",
            "ru": "Эксплуатация",
        },
    },
    {
        "key": "retired",
        "label": "Retired",
        "color": "#757575",
        "translations": {
            "de": "Stillgelegt",
            "fr": "Retiré",
            "es": "Retirado",
            "it": "Ritirato",
            "pt": "Aposentado",
            "zh": "已退役",
            "ru": "Выведено из эксплуатации",
        },
    },
]

_AI_CLASSIFICATION_OVERRIDE_OPTIONS: list[dict[str, Any]] = [
    {
        "key": "auto",
        "label": "Auto-detect",
        "color": "#90a4ae",
        "translations": {
            "de": "Automatisch erkennen",
            "fr": "Détection automatique",
            "es": "Detección automática",
            "it": "Rilevamento automatico",
            "pt": "Detecção automática",
            "zh": "自动识别",
            "ru": "Автоопределение",
        },
    },
    {
        "key": "yes",
        "label": "Force include",
        "color": "#2e7d32",
        "translations": {
            "de": "Erzwingen: ja",
            "fr": "Forcer l'inclusion",
            "es": "Forzar inclusión",
            "it": "Forza inclusione",
            "pt": "Forçar inclusão",
            "zh": "强制纳入",
            "ru": "Принудительно включить",
        },
    },
    {
        "key": "no",
        "label": "Force exclude",
        "color": "#c62828",
        "translations": {
            "de": "Erzwingen: nein",
            "fr": "Forcer l'exclusion",
            "es": "Forzar exclusión",
            "it": "Forza esclusione",
            "pt": "Forçar exclusão",
            "zh": "强制排除",
            "ru": "Принудительно исключить",
        },
    },
]


def _ai_governance_section() -> dict[str, Any]:
    return {
        "section": _AI_GOVERNANCE_SECTION_NAME,
        "translations": {
            "de": "KI-Governance",
            "fr": "Gouvernance IA",
            "es": "Gobierno de IA",
            "it": "Governance dell'IA",
            "pt": "Governança de IA",
            "zh": "AI 治理",
            "ru": "Управление ИИ",
        },
        "fields": [
            {
                "key": "aiRiskClass",
                "label": "AI Risk Class",
                "type": "single_select",
                "options": _AI_RISK_CLASS_OPTIONS,
                "weight": 3,
                "translations": {
                    "de": "KI-Risikoklasse",
                    "fr": "Classe de risque IA",
                    "es": "Clase de riesgo de IA",
                    "it": "Classe di rischio IA",
                    "pt": "Classe de risco de IA",
                    "zh": "AI 风险等级",
                    "ru": "Класс риска ИИ",
                },
            },
            {
                "key": "aiSystemRole",
                "label": "AI System Role",
                "type": "single_select",
                "options": _AI_SYSTEM_ROLE_OPTIONS,
                "weight": 2,
                "translations": {
                    "de": "Rolle im KI-System",
                    "fr": "Rôle dans le système IA",
                    "es": "Rol en el sistema de IA",
                    "it": "Ruolo nel sistema IA",
                    "pt": "Papel no sistema de IA",
                    "zh": "AI 系统角色",
                    "ru": "Роль в системе ИИ",
                },
            },
            {
                "key": "aiLifecycleStage",
                "label": "AI Lifecycle Stage",
                "type": "single_select",
                "options": _AI_LIFECYCLE_STAGE_OPTIONS,
                "weight": 2,
                "translations": {
                    "de": "KI-Lebenszyklusphase",
                    "fr": "Étape du cycle de vie IA",
                    "es": "Etapa del ciclo de vida de IA",
                    "it": "Fase del ciclo di vita IA",
                    "pt": "Etapa do ciclo de vida de IA",
                    "zh": "AI 生命周期阶段",
                    "ru": "Этап жизненного цикла ИИ",
                },
            },
            {
                "key": "aiIntendedPurpose",
                "label": "Intended Purpose",
                "type": "text",
                "weight": 1,
                "translations": {
                    "de": "Beabsichtigter Zweck",
                    "fr": "Finalité prévue",
                    "es": "Finalidad prevista",
                    "it": "Finalità prevista",
                    "pt": "Finalidade pretendida",
                    "zh": "预期用途",
                    "ru": "Назначение",
                },
            },
            {
                "key": "aiClassificationOverride",
                "label": "AI Classification",
                "type": "single_select",
                "options": _AI_CLASSIFICATION_OVERRIDE_OPTIONS,
                "weight": 1,
                "translations": {
                    "de": "KI-Klassifizierung",
                    "fr": "Classification IA",
                    "es": "Clasificación de IA",
                    "it": "Classificazione IA",
                    "pt": "Classificação de IA",
                    "zh": "AI 分类",
                    "ru": "Классификация ИИ",
                },
            },
        ],
    }


def upgrade() -> None:
    conn = op.get_bind()
    for type_key in _TARGET_TYPE_KEYS:
        row = conn.execute(
            text("SELECT fields_schema FROM card_types WHERE key = :k"),
            {"k": type_key},
        ).fetchone()
        if row is None:
            # Custom install that doesn't have this built-in type — leave alone.
            continue
        schema = row[0]
        if not isinstance(schema, list):
            continue
        # Idempotency guard: skip if the section is already present
        # (re-run, or admin manually added a section with this exact name).
        already_present = any(
            isinstance(s, dict) and s.get("section") == _AI_GOVERNANCE_SECTION_NAME for s in schema
        )
        if already_present:
            continue
        new_schema = list(schema) + [_ai_governance_section()]
        conn.execute(
            text("UPDATE card_types SET fields_schema = :s WHERE key = :k"),
            {"k": type_key, "s": json.dumps(new_schema)},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for type_key in _TARGET_TYPE_KEYS:
        row = conn.execute(
            text("SELECT fields_schema FROM card_types WHERE key = :k"),
            {"k": type_key},
        ).fetchone()
        if row is None:
            continue
        schema = row[0]
        if not isinstance(schema, list):
            continue
        new_schema = [
            s
            for s in schema
            if not (isinstance(s, dict) and s.get("section") == _AI_GOVERNANCE_SECTION_NAME)
        ]
        if len(new_schema) == len(schema):
            continue
        conn.execute(
            text("UPDATE card_types SET fields_schema = :s WHERE key = :k"),
            {"k": type_key, "s": json.dumps(new_schema)},
        )
