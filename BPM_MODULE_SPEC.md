# BPM Module — Turbo EA Integration Specification

> **For Claude Code**: This module integrates into the existing Turbo EA codebase. The app uses a metamodel-driven architecture — fact sheet types, fields, subtypes, and relations are all data (rows in `fact_sheet_types` and `relation_types`), not code. BPM entities reuse the existing `FactSheet` model and its full ecosystem (tags, subscriptions, comments, todos, events, quality seals, lifecycle). Process modeling uses **bpmn-js** (from bpmn.io / Camunda) for full **BPMN 2.0** compliant diagramming. Build incrementally, epic by epic.

---

## Turbo EA Architecture Summary (Read This First)

### How Fact Sheets Work

All EA entities live in a single `fact_sheets` table, differentiated by the `type` column (string matching a `fact_sheet_types.key`). Custom fields are stored in `attributes` (JSONB), defined by `fields_schema` on the type. Every fact sheet automatically gets: hierarchy support (via `parent_id`), lifecycle management (JSONB with `plan`/`phaseIn`/`active`/`phaseOut`/`endOfLife` dates), tags, subscriptions (user roles), comments, todos, documents, quality seals, completion scoring, audit events, and bookmarks.

**Adding a new entity type = inserting a row into `fact_sheet_types`** with the appropriate `fields_schema`. No new SQLAlchemy models, no new CRUD endpoints, no new Pydantic schemas.

### How Relations Work

Relations live in a `relations` table with `type` (string matching `relation_types.key`), `source_id`, `target_id`, and `attributes` (JSONB). Allowed connections are defined in `relation_types` with `source_type_key`/`target_type_key`.

**Adding a new relation = inserting a row into `relation_types`**. The existing `/api/v1/relations` CRUD handles it automatically.

### Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), PostgreSQL (asyncpg), Alembic, Pydantic 2 |
| Frontend | React 18, TypeScript, MUI 6, AG Grid, Recharts, React Router 7, Vite |
| Auth | JWT (HMAC-SHA256), bcrypt, `get_current_user` dependency |
| Events | In-memory EventBus + SSE streaming + Event model (persisted) |
| Diagramming | Self-hosted DrawIO in iframe (architecture diagrams) |
| **Process Modeling** | **bpmn-js (bpmn.io) — BPMN 2.0 compliant editor/viewer** |

### Code Conventions

- **Backend models**: Inherit `Base`, `UUIDMixin`, `TimestampMixin` from `app.models.base`
- **Backend API**: Routers in `app/api/v1/`, mounted in `router.py`, prefix + tags pattern
- **Backend schemas**: Pydantic models in `app/schemas/`
- **Frontend features**: `src/features/<module>/` folder per feature
- **Frontend types**: All interfaces in `src/types/index.ts`
- **Frontend API calls**: Use `apiClient` from `src/api/client.ts`
- **Imports**: Backend uses `from app.xxx import yyy`, frontend uses `@/` path alias

---

## What Already Exists (Do Not Recreate)

The following are already defined in `backend/app/services/seed.py` and work out of the box:

- **`BusinessCapability`** fact sheet type (key: `BusinessCapability`, category: "Business Architecture", has_hierarchy: true, icon: `account_tree`, color: `#003399`) with fields: `capabilityLevel` (L1-L5 select), `isCoreCapability` (boolean)
- **`BusinessContext`** fact sheet type (key: `BusinessContext`, subtypes: process, valueStream, customerJourney, businessProduct, esgCapability) with field: `maturity` (initial/defined/managed/optimized)
- **`relAppToBC`** relation: Application → BusinessCapability (with functionalSuitability + supportType attributes)
- **`relBizCtxToBC`** relation: BusinessContext → BusinessCapability
- Full CRUD for all fact sheets via `/api/v1/fact-sheets`
- Full CRUD for relations via `/api/v1/relations`
- Tag system, subscriptions, comments, todos, quality seals, lifecycle management, events, notifications

---

## BPMN 2.0 Modeling — Architecture Decision

### Why bpmn-js, Not a Custom Editor

| Concern | Custom (React Flow) | bpmn-js |
|---|---|---|
| BPMN 2.0 compliance | ❌ Manual, incomplete | ✅ Full standard |
| Notation correctness | ❌ You draw the shapes | ✅ Library enforces rules |
| XML import/export | ❌ Build from scratch | ✅ Native |
| Interop (Camunda, Signavio, ARIS, Bizagi) | ❌ None | ✅ Standard XML |
| Properties panel | ❌ Build from scratch | ✅ Plugin available |
| Validation (which connections are legal) | ❌ You code the rules | ✅ Built-in |
| Maintenance effort | High | Low (community-maintained) |

### Dual Storage Model: BPMN XML + Extracted Elements

The BPMN 2.0 XML is the **source of truth** for the diagram. But EA needs relational queries ("which applications support this step?", "which processes use SAP?"). So we use a dual approach:

1. **Primary**: BPMN 2.0 XML stored as `Text` on a `ProcessDiagram` model (linked to the process FactSheet)
2. **Secondary**: On each save, the backend extracts key BPMN elements (tasks, subprocesses, gateways) into a `ProcessElement` table. This table enables EA-style linking (element → application, element → data object) and cross-referencing in reports.

The extraction is automatic and one-directional: XML → elements. Users never edit the elements table directly — it's rebuilt on every diagram save.

```
┌──────────────────────────────────────────────────┐
│  bpmn-js Editor (frontend)                        │
│  User drags, connects, edits BPMN 2.0 elements   │
└──────────────┬───────────────────────────────────┘
               │ PUT /bpm/processes/{id}/diagram
               │ Body: { bpmn_xml: "<?xml ...>" }
               ▼
┌──────────────────────────────────────────────────┐
│  Backend                                          │
│  1. Store XML in process_diagrams table           │
│  2. Parse XML, extract elements                   │
│  3. Upsert into process_elements table            │
│  4. Publish event                                 │
└──────────────────────────────────────────────────┘
```

---

## What the BPM Module Adds

### 1. New Fact Sheet Type: `BusinessProcess` (Seed Data)

The existing `BusinessContext` with subtype `process` is too generic. The BPM module creates a dedicated `BusinessProcess` type with a rich field schema. Add this to the `TYPES` list in `seed.py` (or register via the metamodel admin API at runtime):

```python
# In seed.py — new option lists for BPM

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

# In seed.py TYPES list — insert after BusinessContext (sort_order 6)

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
}
```

### 2. Enrich Existing `BusinessCapability` Type (Seed Data Update)

Add BPM-relevant fields to the existing BusinessCapability `fields_schema`:

```python
# Add to BusinessCapability's fields_schema:
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
}
```

### 3. New Relation Types (Seed Data)

Add to the `RELATIONS` list in `seed.py`:

```python
# BPM Relations — add after existing relations (adjust sort_order)

{"key": "relProcessToBC", "label": "supports", "reverse_label": "is supported by",
 "source_type_key": "BusinessProcess", "target_type_key": "BusinessCapability",
 "cardinality": "n:m", "sort_order": 30,
 "attributes_schema": [
     {"key": "supportType", "label": "Support Type", "type": "single_select",
      "options": SUPPORT_TYPE_OPTIONS},
 ]},

{"key": "relProcessToApp", "label": "is supported by", "reverse_label": "supports",
 "source_type_key": "BusinessProcess", "target_type_key": "Application",
 "cardinality": "n:m", "sort_order": 31,
 "attributes_schema": [
     {"key": "usageType", "label": "Usage", "type": "single_select",
      "options": [
          {"key": "creates", "label": "Creates"},
          {"key": "reads", "label": "Reads"},
          {"key": "updates", "label": "Updates"},
          {"key": "deletes", "label": "Deletes"},
          {"key": "orchestrates", "label": "Orchestrates"},
      ]},
     {"key": "criticality", "label": "Criticality", "type": "single_select",
      "options": [
          {"key": "low", "label": "Low", "color": "#4caf50"},
          {"key": "medium", "label": "Medium", "color": "#ff9800"},
          {"key": "high", "label": "High", "color": "#f44336"},
          {"key": "critical", "label": "Critical", "color": "#b71c1c"},
      ]},
 ]},

{"key": "relProcessToDataObj", "label": "uses", "reverse_label": "is used by",
 "source_type_key": "BusinessProcess", "target_type_key": "DataObject",
 "cardinality": "n:m", "sort_order": 32,
 "attributes_schema": [
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
```

---

## New SQLAlchemy Models

### `backend/app/models/process_diagram.py`

Stores the BPMN 2.0 XML and SVG thumbnail for each process.

```python
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin


class ProcessDiagram(Base, UUIDMixin, TimestampMixin):
    """BPMN 2.0 diagram associated with a BusinessProcess fact sheet.
    One process has at most one active diagram (latest version).
    """

    __tablename__ = "process_diagrams"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    bpmn_xml: Mapped[str] = mapped_column(Text, nullable=False)
    svg_thumbnail: Mapped[str | None] = mapped_column(Text)  # SVG string for previews
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"),
    )

    process = relationship("FactSheet", lazy="selectin")
```

### `backend/app/models/process_element.py`

Extracted BPMN elements that enable EA cross-referencing. Auto-populated on diagram save.

```python
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin


class ProcessElement(Base, UUIDMixin, TimestampMixin):
    """An extracted BPMN element (task, subprocess, gateway, event) that can be linked
    to EA fact sheets (applications, data objects, etc.).
    
    Auto-populated from BPMN XML on each diagram save. The bpmn_element_id is the 
    id attribute from the BPMN XML, used to correlate back to the diagram.
    """

    __tablename__ = "process_elements"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    bpmn_element_id: Mapped[str] = mapped_column(
        String(200), nullable=False
    )  # e.g. "Activity_0abc123" — the BPMN XML element id
    element_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # task, userTask, serviceTask, subprocess, exclusiveGateway, startEvent, endEvent, etc.
    name: Mapped[str | None] = mapped_column(String(500))
    documentation: Mapped[str | None] = mapped_column(Text)
    lane_name: Mapped[str | None] = mapped_column(String(200))  # Which lane/role this element belongs to
    is_automated: Mapped[bool] = mapped_column(Boolean, default=False)
    sequence_order: Mapped[int] = mapped_column(Integer, default=0)  # Approximate order in the flow

    # EA cross-references (optional, set by user via UI)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="SET NULL"),
    )
    data_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="SET NULL"),
    )
    it_component_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="SET NULL"),
    )

    custom_fields: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    process = relationship("FactSheet", foreign_keys=[process_id], lazy="selectin")
    application = relationship("FactSheet", foreign_keys=[application_id], lazy="selectin")
    data_object = relationship("FactSheet", foreign_keys=[data_object_id], lazy="selectin")
    it_component = relationship("FactSheet", foreign_keys=[it_component_id], lazy="selectin")
```

### `backend/app/models/process_assessment.py`

```python
from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin


class ProcessAssessment(Base, UUIDMixin, TimestampMixin):
    """Periodic assessment of a business process."""

    __tablename__ = "process_assessments"

    process_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    assessor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False,
    )
    assessment_date: Mapped[date] = mapped_column(Date, nullable=False)
    overall_score: Mapped[int] = mapped_column(Integer, default=0)  # 1-5
    efficiency: Mapped[int] = mapped_column(Integer, default=0)
    effectiveness: Mapped[int] = mapped_column(Integer, default=0)
    compliance: Mapped[int] = mapped_column(Integer, default=0)
    automation: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    action_items: Mapped[list | None] = mapped_column(JSONB, default=list)
    # action_items schema: [{title: str, description: str, due_date: str, status: str}]

    assessor = relationship("User", lazy="selectin")
    process = relationship("FactSheet", lazy="selectin")
```

### Register in `backend/app/models/__init__.py`

```python
# Add imports:
from app.models.process_diagram import ProcessDiagram
from app.models.process_element import ProcessElement
from app.models.process_assessment import ProcessAssessment

# Add to __all__:
"ProcessDiagram", "ProcessElement", "ProcessAssessment"
```

### Alembic Migration

```bash
cd backend
alembic revision --autogenerate -m "add BPM tables: process_diagrams, process_elements, process_assessments"
alembic upgrade head
```

---

## BPMN XML Parsing Service

### `backend/app/services/bpmn_parser.py`

Extracts elements from BPMN 2.0 XML. Uses Python's built-in `xml.etree.ElementTree` — no extra dependencies.

```python
"""Parse BPMN 2.0 XML and extract elements for EA cross-referencing."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass

BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"

# BPMN element types we extract for EA linking
EXTRACTABLE_TYPES = {
    f"{{{BPMN_NS}}}task": "task",
    f"{{{BPMN_NS}}}userTask": "userTask",
    f"{{{BPMN_NS}}}serviceTask": "serviceTask",
    f"{{{BPMN_NS}}}scriptTask": "scriptTask",
    f"{{{BPMN_NS}}}businessRuleTask": "businessRuleTask",
    f"{{{BPMN_NS}}}sendTask": "sendTask",
    f"{{{BPMN_NS}}}receiveTask": "receiveTask",
    f"{{{BPMN_NS}}}manualTask": "manualTask",
    f"{{{BPMN_NS}}}callActivity": "callActivity",
    f"{{{BPMN_NS}}}subProcess": "subProcess",
    f"{{{BPMN_NS}}}exclusiveGateway": "exclusiveGateway",
    f"{{{BPMN_NS}}}parallelGateway": "parallelGateway",
    f"{{{BPMN_NS}}}inclusiveGateway": "inclusiveGateway",
    f"{{{BPMN_NS}}}eventBasedGateway": "eventBasedGateway",
    f"{{{BPMN_NS}}}startEvent": "startEvent",
    f"{{{BPMN_NS}}}endEvent": "endEvent",
    f"{{{BPMN_NS}}}intermediateCatchEvent": "intermediateCatchEvent",
    f"{{{BPMN_NS}}}intermediateThrowEvent": "intermediateThrowEvent",
    f"{{{BPMN_NS}}}boundaryEvent": "boundaryEvent",
}


@dataclass
class ExtractedElement:
    bpmn_element_id: str
    element_type: str
    name: str | None
    documentation: str | None
    lane_name: str | None
    is_automated: bool
    sequence_order: int


def parse_bpmn_xml(bpmn_xml: str) -> list[ExtractedElement]:
    """Parse BPMN 2.0 XML and return extracted elements."""
    root = ET.fromstring(bpmn_xml)
    elements: list[ExtractedElement] = []

    # Build lane → element mapping
    lane_map: dict[str, str] = {}  # element_id → lane_name
    for lane in root.iter(f"{{{BPMN_NS}}}lane"):
        lane_name = lane.get("name", "")
        for flow_node_ref in lane.iter(f"{{{BPMN_NS}}}flowNodeRef"):
            if flow_node_ref.text:
                lane_map[flow_node_ref.text.strip()] = lane_name

    # Build sequence flow ordering (approximate topological order)
    sequence_flows: list[tuple[str, str]] = []
    for sf in root.iter(f"{{{BPMN_NS}}}sequenceFlow"):
        src = sf.get("sourceRef", "")
        tgt = sf.get("targetRef", "")
        if src and tgt:
            sequence_flows.append((src, tgt))

    # Simple ordering: count incoming edges as a proxy for position
    incoming_count: dict[str, int] = {}
    for src, tgt in sequence_flows:
        incoming_count[tgt] = incoming_count.get(tgt, 0) + 1

    order = 0
    for tag, element_type in EXTRACTABLE_TYPES.items():
        for elem in root.iter(tag):
            elem_id = elem.get("id", "")
            if not elem_id:
                continue

            name = elem.get("name")

            # Extract documentation
            doc_elem = elem.find(f"{{{BPMN_NS}}}documentation")
            documentation = doc_elem.text if doc_elem is not None and doc_elem.text else None

            # Determine if automated (serviceTask, scriptTask, businessRuleTask)
            is_automated = element_type in ("serviceTask", "scriptTask", "businessRuleTask")

            elements.append(ExtractedElement(
                bpmn_element_id=elem_id,
                element_type=element_type,
                name=name,
                documentation=documentation,
                lane_name=lane_map.get(elem_id),
                is_automated=is_automated,
                sequence_order=order,
            ))
            order += 1

    return elements
```

---

## New API Endpoints

### `backend/app/api/v1/bpm.py` — Diagram & Elements

```
Router prefix: /bpm
Tags: ["bpm"]

# BPMN Diagram
GET    /bpm/processes/{process_id}/diagram           # Get current BPMN XML + SVG thumbnail
PUT    /bpm/processes/{process_id}/diagram            # Save BPMN XML (triggers element extraction)
GET    /bpm/processes/{process_id}/diagram/versions   # List diagram versions
GET    /bpm/processes/{process_id}/diagram/export/svg # Export current diagram as SVG
GET    /bpm/processes/{process_id}/diagram/export/png # Export current diagram as PNG (rendered server-side or client-side)

# Process Elements (extracted from BPMN, enriched with EA links)
GET    /bpm/processes/{process_id}/elements           # List extracted elements
PUT    /bpm/processes/{process_id}/elements/{id}      # Update EA links (application_id, data_object_id, etc.)

# Import/Export BPMN
POST   /bpm/processes/{process_id}/diagram/import     # Import BPMN 2.0 XML file
GET    /bpm/processes/{process_id}/diagram/export/bpmn # Download BPMN 2.0 XML file

# Templates
GET    /bpm/templates                                 # List available BPMN templates
GET    /bpm/templates/{template_key}                  # Get template BPMN XML
```

**Key endpoint logic for `PUT /bpm/processes/{process_id}/diagram`:**

```python
@router.put("/processes/{process_id}/diagram")
async def save_diagram(
    process_id: uuid.UUID,
    body: DiagramSave,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. Validate process exists and is BusinessProcess type
    process = await _get_process_or_404(db, process_id)

    # 2. Store/update BPMN XML
    existing = await db.execute(
        select(ProcessDiagram)
        .where(ProcessDiagram.process_id == process_id)
        .order_by(ProcessDiagram.version.desc())
        .limit(1)
    )
    current = existing.scalar_one_or_none()
    new_version = (current.version + 1) if current else 1

    diagram = ProcessDiagram(
        process_id=process_id,
        bpmn_xml=body.bpmn_xml,
        svg_thumbnail=body.svg_thumbnail,
        version=new_version,
        created_by=current_user.id,
    )
    db.add(diagram)

    # 3. Parse XML and extract elements
    from app.services.bpmn_parser import parse_bpmn_xml
    extracted = parse_bpmn_xml(body.bpmn_xml)

    # 4. Load existing elements to preserve EA links
    existing_elements = await db.execute(
        select(ProcessElement).where(ProcessElement.process_id == process_id)
    )
    old_by_bpmn_id = {e.bpmn_element_id: e for e in existing_elements.scalars().all()}

    # 5. Upsert: keep EA links for elements that still exist, remove deleted ones
    new_bpmn_ids = {e.bpmn_element_id for e in extracted}
    for old_id, old_elem in old_by_bpmn_id.items():
        if old_id not in new_bpmn_ids:
            await db.delete(old_elem)

    for ext in extracted:
        if ext.bpmn_element_id in old_by_bpmn_id:
            # Update existing — preserve EA links
            old = old_by_bpmn_id[ext.bpmn_element_id]
            old.element_type = ext.element_type
            old.name = ext.name
            old.documentation = ext.documentation
            old.lane_name = ext.lane_name
            old.is_automated = ext.is_automated
            old.sequence_order = ext.sequence_order
        else:
            # New element
            db.add(ProcessElement(
                process_id=process_id,
                bpmn_element_id=ext.bpmn_element_id,
                element_type=ext.element_type,
                name=ext.name,
                documentation=ext.documentation,
                lane_name=ext.lane_name,
                is_automated=ext.is_automated,
                sequence_order=ext.sequence_order,
            ))

    # 6. Publish event
    await event_bus.publish(
        "process_diagram.saved",
        {"process_name": process.name, "version": new_version, "element_count": len(extracted)},
        db=db, fact_sheet_id=process_id, user_id=current_user.id,
    )

    await db.commit()
    return {"version": new_version, "element_count": len(extracted)}
```

### `backend/app/api/v1/bpm_assessments.py` — Process Assessments

```
Router prefix: /bpm
Tags: ["bpm"]

GET    /bpm/processes/{process_id}/assessments            # List assessments (ordered by date desc)
POST   /bpm/processes/{process_id}/assessments            # Create assessment
PUT    /bpm/processes/{process_id}/assessments/{id}       # Update assessment
DELETE /bpm/processes/{process_id}/assessments/{id}       # Delete assessment
```

### `backend/app/api/v1/bpm_reports.py` — BPM-Specific Reports

```
Router prefix: /reports/bpm
Tags: ["reports"]

GET    /reports/bpm/dashboard                    # BPM KPIs
GET    /reports/bpm/capability-process-matrix    # Capability × Process matrix
GET    /reports/bpm/process-application-matrix   # Process × Application matrix
GET    /reports/bpm/process-dependencies         # Dependency graph data
GET    /reports/bpm/capability-heatmap           # Capability tree colored by metric
GET    /reports/bpm/element-application-map      # Which BPMN elements use which applications
```

### Pydantic Schemas — `backend/app/schemas/bpm.py`

```python
from __future__ import annotations
from datetime import date
from pydantic import BaseModel


class DiagramSave(BaseModel):
    bpmn_xml: str
    svg_thumbnail: str | None = None


class ElementUpdate(BaseModel):
    """Update EA cross-references on an extracted BPMN element."""
    application_id: str | None = None
    data_object_id: str | None = None
    it_component_id: str | None = None
    custom_fields: dict | None = None


class ProcessAssessmentCreate(BaseModel):
    assessment_date: date
    overall_score: int  # 1-5
    efficiency: int
    effectiveness: int
    compliance: int
    automation: int
    notes: str | None = None
    action_items: list[dict] | None = None


class ProcessAssessmentUpdate(BaseModel):
    overall_score: int | None = None
    efficiency: int | None = None
    effectiveness: int | None = None
    compliance: int | None = None
    automation: int | None = None
    notes: str | None = None
    action_items: list[dict] | None = None
```

### Mount in `backend/app/api/v1/router.py`

```python
from app.api.v1 import bpm, bpm_assessments, bpm_reports

api_router.include_router(bpm.router)
api_router.include_router(bpm_assessments.router)
api_router.include_router(bpm_reports.router)
```

---

## Frontend Implementation

### npm Dependencies

```bash
cd frontend
npm install bpmn-js bpmn-js-properties-panel @bpmn-io/properties-panel
```

- **`bpmn-js`** — Core BPMN 2.0 modeler and viewer (MIT licensed)
- **`bpmn-js-properties-panel`** — Properties panel plugin for editing element details
- **`@bpmn-io/properties-panel`** — Base framework for the properties panel

### New Feature Folder: `frontend/src/features/bpm/`

```
frontend/src/features/bpm/
├── BpmnModeler.tsx               # bpmn-js modeler wrapper (edit mode)
├── BpmnViewer.tsx                # bpmn-js viewer wrapper (read-only, embedded in detail page)
├── BpmnTemplateChooser.tsx       # Template selection dialog for new diagrams
├── ElementLinker.tsx             # Panel to link BPMN elements to EA fact sheets
├── ProcessFlowTab.tsx            # Container for viewer + element list (in FactSheetDetail)
├── ProcessFlowEditorPage.tsx     # Full-page editor route
├── ProcessAssessmentPanel.tsx    # Assessment form + history chart
├── BpmDashboard.tsx              # Landing page with KPIs
├── CapabilityHeatMap.tsx         # Grid colored by metric
├── ProcessMatrixReport.tsx       # Capability × Process or Process × App matrix
├── ProcessDependencyGraph.tsx    # Force-directed dependency visualization
├── BpmReportPage.tsx             # Wrapper page for BPM-specific reports
└── bpmn-templates/               # Starter BPMN XML templates
    ├── blank.bpmn
    ├── simple-approval.bpmn
    ├── order-to-cash.bpmn
    ├── hire-to-retire.bpmn
    ├── procure-to-pay.bpmn
    └── incident-management.bpmn
```

### BpmnModeler.tsx — Core Editor Component

This is the main component wrapping bpmn-js. Key design decisions for user-friendliness:

```tsx
/**
 * BpmnModeler — Wraps bpmn-js in a React component with a simplified,
 * user-friendly palette for process owners who may not know BPMN 2.0.
 *
 * Key UX decisions:
 * 1. SIMPLIFIED PALETTE — not all 50+ BPMN elements. Group into categories:
 *    - Activities: Task, User Task, Service Task, Subprocess
 *    - Gateways: Exclusive (XOR), Parallel (AND), Inclusive (OR)
 *    - Events: Start, End, Timer, Message, Error
 *    - Artifacts: Text Annotation, Data Object
 *    - Swimlanes: Pool, Lane
 *
 * 2. TOOLTIPS ON EVERY PALETTE ITEM — plain-English explanation:
 *    - "User Task: A step performed by a person"
 *    - "Service Task: An automated step performed by a system"
 *    - "Exclusive Gateway: Only one path is taken (like an if/else)"
 *    - "Parallel Gateway: All paths are taken simultaneously"
 *
 * 3. RIGHT-CLICK CONTEXT MENU — common actions:
 *    - "Change to User Task / Service Task / Manual Task"
 *    - "Add boundary timer event"
 *    - "Link to Application..." (opens EA linker)
 *
 * 4. PROPERTIES PANEL — simplified, grouped:
 *    - "General" tab: Name, Documentation
 *    - "EA Links" tab: Application, Data Object, IT Component (dropdowns with search)
 *    - "Details" tab: Task type, Loop, Multi-instance
 *
 * 5. TOOLBAR — clear actions:
 *    - Save | Undo/Redo | Zoom In/Out/Fit | Auto-Layout
 *    - Export (SVG, PNG, BPMN XML) | Import BPMN | Start from Template
 *    - Toggle: Simple Mode / Full BPMN Mode (shows all palette items)
 *
 * 6. AUTO-SAVE — debounced 5-second auto-save after last change
 *
 * 7. KEYBOARD SHORTCUTS — displayed in a help overlay (? key):
 *    - Ctrl+Z / Ctrl+Y: Undo/Redo
 *    - Ctrl+S: Save
 *    - Delete/Backspace: Remove selected
 *    - Space+drag: Pan canvas
 *    - Ctrl+scroll: Zoom
 */
```

**Implementation approach for bpmn-js in React:**

```tsx
import { useRef, useEffect, useCallback } from "react";
import BpmnJS from "bpmn-js/lib/Modeler";

// bpmn-js is NOT a React component — it's a vanilla JS library that mounts to a DOM node.
// The React wrapper manages the lifecycle:

export default function BpmnModeler({ processId }: { processId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<BpmnJS | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const modeler = new BpmnJS({
      container: containerRef.current,
      // Keyboard bindings
      keyboard: { bindTo: document },
      // Additional modules can be added here:
      // propertiesPanel, minimap, etc.
    });

    modelerRef.current = modeler;

    // Load diagram from API
    loadDiagram(modeler, processId);

    return () => {
      modeler.destroy();
    };
  }, [processId]);

  // ...save handler, export handler, etc.

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Modeler canvas */}
      <div ref={containerRef} style={{ flex: 1 }} />
      {/* Properties panel mounts here */}
      <div id="properties-panel" style={{ width: 360, overflowY: "auto" }} />
    </div>
  );
}
```

### BpmnViewer.tsx — Read-Only Viewer for Fact Sheet Detail

```tsx
/**
 * BpmnViewer — Lightweight read-only viewer embedded in the Process Flow tab.
 * Uses bpmn-js NavigatedViewer (not the full Modeler) for smaller bundle size.
 *
 * Features:
 * - Renders BPMN diagram in read-only mode
 * - Click an element to see its details + EA links in a popover
 * - Hover highlights connected elements (upstream/downstream)
 * - Color overlay: green = automated (serviceTask), blue = manual (userTask)
 * - Minimap in corner for navigation
 * - "Open Editor" button navigates to full-page editor
 * - "Export" dropdown: SVG, PNG
 */
```

```tsx
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
// Smaller than full Modeler — no editing capabilities, just viewing + navigation
```

### ProcessFlowTab.tsx — Tab Content in FactSheetDetail

This component combines the viewer with an element list table:

```tsx
/**
 * ProcessFlowTab — Rendered inside FactSheetDetail when type === "BusinessProcess".
 *
 * Layout:
 * ┌─────────────────────────────────────────────────┐
 * │  [Open Editor]  [Export ▾]  [Import BPMN]       │
 * ├─────────────────────────────────────────────────┤
 * │                                                  │
 * │         BPMN Diagram (BpmnViewer)               │
 * │         (read-only, interactive)                 │
 * │                                                  │
 * ├─────────────────────────────────────────────────┤
 * │  Process Elements                  [Link Apps]   │
 * │  ┌────────┬──────────┬──────┬─────────────────┐ │
 * │  │ Name   │ Type     │ Lane │ Application     │ │
 * │  ├────────┼──────────┼──────┼─────────────────┤ │
 * │  │ Review │ userTask │ Mgr  │ SAP S/4HANA     │ │
 * │  │ Submit │ svcTask  │ Sys  │ Salesforce      │ │
 * │  └────────┴──────────┴──────┴─────────────────┘ │
 * └─────────────────────────────────────────────────┘
 *
 * The element table is an AG Grid showing extracted BPMN elements
 * with their EA links. Users can click to assign applications.
 * Clicking an element in the table highlights it in the diagram.
 * Clicking an element in the diagram selects it in the table.
 */
```

### ElementLinker.tsx — EA Cross-Reference Panel

```tsx
/**
 * ElementLinker — Dialog or side panel for linking BPMN elements to EA fact sheets.
 *
 * Opened from:
 * - Right-click context menu on a BPMN element in the editor
 * - "Link" button in the element table
 * - Properties panel "EA Links" tab
 *
 * UI:
 * ┌──────────────────────────────────────┐
 * │  Link "Review Order" to EA           │
 * │                                       │
 * │  Application:  [🔍 Search apps...  ] │
 * │                 SAP S/4HANA      ✕   │
 * │                                       │
 * │  Data Object:  [🔍 Search data...  ] │
 * │                 Sales Order       ✕   │
 * │                                       │
 * │  IT Component: [🔍 Search...       ] │
 * │                                       │
 * │            [Cancel]  [Save]           │
 * └──────────────────────────────────────┘
 *
 * The search dropdowns use the existing /api/v1/fact-sheets endpoint
 * filtered by type (Application, DataObject, ITComponent).
 * Saving calls PUT /api/v1/bpm/processes/{pid}/elements/{eid}
 */
```

### BPMN Templates

Pre-built starter diagrams so users don't face a blank canvas. Stored as `.bpmn` files (BPMN 2.0 XML) in the frontend bundle and also available via API.

```
Templates to include:

1. blank.bpmn
   - Empty diagram with one pool, one lane, start event + end event
   - For: starting from scratch with proper structure

2. simple-approval.bpmn
   - Start → Submit Request → Review (XOR gateway) → Approve / Reject → End
   - Lanes: Requester, Approver
   - For: any approval workflow

3. order-to-cash.bpmn
   - Start → Receive Order → Check Credit → Pick & Pack → Ship → Invoice → Receive Payment → End
   - Lanes: Sales, Warehouse, Finance
   - For: manufacturing/distribution companies

4. procure-to-pay.bpmn
   - Start → Create Requisition → Approve → Create PO → Receive Goods → Invoice Verification → Payment → End
   - Lanes: Requester, Procurement, Warehouse, Finance
   - For: procurement processes

5. hire-to-retire.bpmn
   - Start → Post Position → Screen Candidates → Interview → Offer → Onboard → End
   - Lanes: Hiring Manager, HR, IT
   - For: HR processes

6. incident-management.bpmn
   - Start → Log Incident → Classify → Investigate → Resolve → Close → End
   - Lanes: Service Desk, L2 Support, L3 Support
   - With: escalation timer boundary events
   - For: ITIL-style incident management
```

### BpmnTemplateChooser.tsx

```tsx
/**
 * BpmnTemplateChooser — Modal dialog shown when creating a new process diagram.
 *
 * UI:
 * ┌──────────────────────────────────────────────────┐
 * │  Start your process diagram                       │
 * │                                                    │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
 * │  │          │  │          │  │          │       │
 * │  │  Blank   │  │ Approval │  │ Order to │       │
 * │  │          │  │          │  │  Cash    │       │
 * │  └──────────┘  └──────────┘  └──────────┘       │
 * │                                                    │
 * │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
 * │  │ Procure  │  │ Hire to  │  │ Incident │       │
 * │  │ to Pay   │  │ Retire   │  │ Mgmt     │       │
 * │  └──────────┘  └──────────┘  └──────────┘       │
 * │                                                    │
 * │  Or: [Import existing BPMN file...]               │
 * │                                                    │
 * │                          [Cancel]  [Create]        │
 * └──────────────────────────────────────────────────┘
 *
 * Each template card shows a mini SVG preview and description.
 * Selecting a template loads the BPMN XML into the editor.
 * "Import" opens a file picker for .bpmn files.
 */
```

### New Routes — Add to `frontend/src/App.tsx`

```tsx
import BpmDashboard from "@/features/bpm/BpmDashboard";
import ProcessFlowEditorPage from "@/features/bpm/ProcessFlowEditorPage";
import BpmReportPage from "@/features/bpm/BpmReportPage";

// Inside authenticated routes:
<Route path="/bpm" element={<BpmDashboard />} />
<Route path="/bpm/processes/:id/flow" element={<ProcessFlowEditorPage />} />
<Route path="/reports/bpm" element={<BpmReportPage />} />
```

### Integration with Existing `FactSheetDetail.tsx`

```tsx
// Inside FactSheetDetail.tsx, in the tabs section:
{factSheet.type === "BusinessProcess" && (
  <>
    <Tab label="Process Flow" value="flow" icon={<MaterialSymbol name="route" />} />
    <Tab label="Assessments" value="assessments" icon={<MaterialSymbol name="analytics" />} />
  </>
)}

// In tab panels:
{tabValue === "flow" && <ProcessFlowTab processId={factSheet.id} />}
{tabValue === "assessments" && <ProcessAssessmentPanel processId={factSheet.id} />}
```

### Navigation — Add to `frontend/src/layouts/AppLayout.tsx`

```tsx
{ label: "BPM", icon: "route", path: "/bpm" },
// In Reports submenu:
{ label: "BPM Reports", icon: "analytics", path: "/reports/bpm" },
```

### New TypeScript Types — Add to `frontend/src/types/index.ts`

```typescript
// ---------------------------------------------------------------------------
// BPM — BPMN 2.0 Diagrams, Process Elements, Assessments
// ---------------------------------------------------------------------------

export interface ProcessDiagramData {
  id: string;
  process_id: string;
  bpmn_xml: string;
  svg_thumbnail?: string;
  version: number;
  created_by?: string;
  created_at?: string;
}

export interface ProcessElement {
  id: string;
  process_id: string;
  bpmn_element_id: string;
  element_type: string;
  name?: string;
  documentation?: string;
  lane_name?: string;
  is_automated: boolean;
  sequence_order: number;
  application_id?: string;
  application_name?: string;
  data_object_id?: string;
  data_object_name?: string;
  it_component_id?: string;
  it_component_name?: string;
  custom_fields?: Record<string, unknown>;
}

export interface ProcessAssessment {
  id: string;
  process_id: string;
  assessor_id: string;
  assessor_name?: string;
  assessment_date: string;
  overall_score: number;
  efficiency: number;
  effectiveness: number;
  compliance: number;
  automation: number;
  notes?: string;
  action_items?: { title: string; description: string; due_date: string; status: string }[];
  created_at?: string;
}

export interface BpmDashboardData {
  total_processes: number;
  by_process_type: Record<string, number>;
  by_maturity: Record<string, number>;
  by_automation: Record<string, number>;
  by_risk: Record<string, number>;
  avg_maturity_score: number;
  avg_automation_score: number;
  top_risk_processes: { id: string; name: string; risk: string; maturity: string }[];
}

export interface BpmnTemplate {
  key: string;
  name: string;
  description: string;
  category: string;
  svg_preview?: string;
}
```

---

## UX Guidelines for Process Owners

### Design Principles

The BPMN editor serves **two audiences** with different needs:

| Audience | Needs | Solution |
|---|---|---|
| **Process owners / business analysts** | Document processes quickly, don't know BPMN notation | Simple Mode: curated palette, plain-English tooltips, templates |
| **Process engineers / EA architects** | Full BPMN 2.0 compliance, precise notation, export for Camunda/Signavio | Full Mode: complete BPMN palette, technical properties, XML import/export |

### Simple Mode vs Full Mode

The editor has a toggle: **Simple Mode** (default) and **Full BPMN Mode**.

**Simple Mode palette** (10 elements, plain-English labels):

| Icon | Label | BPMN Type | Tooltip |
|---|---|---|---|
| ○ | Start | startEvent | "Where the process begins" |
| ◉ | End | endEvent | "Where the process ends" |
| ▭ | Task | task | "A step someone or something does" |
| 👤▭ | Person Task | userTask | "A step done by a person" |
| ⚙▭ | System Task | serviceTask | "A step done automatically by a system" |
| ◇ | Decision | exclusiveGateway | "Choose one path based on a condition" |
| ⊞ | Parallel | parallelGateway | "All paths happen at the same time" |
| ⏱ | Timer | intermediateCatchEvent (timer) | "Wait for a specific time or duration" |
| ▭▭ | Sub-Process | subProcess | "A group of steps that belong together" |
| ═ | Swimlane | lane | "A row showing who is responsible" |

**Full BPMN Mode palette** (all standard BPMN 2.0 elements):
- All event types (message, signal, error, escalation, compensation, conditional, link)
- All task types (user, service, script, business rule, manual, send, receive)
- All gateway types (exclusive, parallel, inclusive, event-based, complex)
- Data objects, data stores, message flows, associations
- Pools, lanes
- Groups, text annotations

### Onboarding & Help

1. **First-time tooltip tour**: When a user opens the editor for the first time, show a 5-step overlay tour:
   - "This is your canvas — drag elements from the left palette"
   - "Connect elements by dragging from the arrow handles"
   - "Click any element to edit its name and properties"
   - "Use swimlanes to show who is responsible for each step"
   - "Save your work with Ctrl+S or the Save button"

2. **Persistent help button** (? icon in toolbar): Opens a quick reference sheet:
   - Element shapes and what they mean
   - Keyboard shortcuts
   - "How to add a decision point"
   - "How to link a step to an application"
   - Link to full BPMN 2.0 guide

3. **Smart defaults**:
   - New elements get auto-generated names ("Task 1", "Decision 1") — user renames inline
   - New lanes auto-label "Role 1", "Role 2"
   - Double-click any element to rename immediately (inline editing)
   - Connecting two elements automatically creates a sequence flow with correct arrow

4. **Validation feedback**:
   - Real-time warnings (yellow) for: unconnected elements, missing start/end events, unnamed tasks
   - Errors (red) for: invalid connections (per BPMN spec)
   - Validation panel at bottom shows all issues with "click to navigate" links

5. **Color overlays** (toggle in toolbar):
   - "By Role": each lane gets a distinct color
   - "By Automation": green = automated (service/script tasks), blue = manual (user/manual tasks), gray = unspecified
   - "By Application": elements linked to the same application share a color
   - "By Completion": green = has EA links, red = missing EA links

---

## Epics & User Stories

### Epic 1: BusinessProcess Type & Basic CRUD

> **Implementation**: No new backend code beyond seed data. All CRUD handled by existing endpoints.

```
US-1.1: Register BusinessProcess Fact Sheet Type
  As a platform admin
  I want the BusinessProcess type to appear in the metamodel
  So that users can create processes alongside other fact sheets

  Implementation:
  - Add BusinessProcess to seed.py TYPES list
  - OR: call POST /api/v1/metamodel/types
  - All existing UI works automatically

US-1.2: Create Business Process
  Acceptance Criteria:
  - CreateFactSheetDialog shows BusinessProcess in the type selector
  - Form shows all fields from fields_schema
  - Supports hierarchy: category > group > process > variant
  - Tags, subscriptions, lifecycle all work out of the box
  - API: POST /api/v1/fact-sheets {type: "BusinessProcess", ...}

US-1.3: Browse Processes in Inventory
  Acceptance Criteria:
  - Already works — InventoryPage type filter includes "Business Process"
  - AG Grid shows process-specific columns

US-1.4: Process Detail Page
  Acceptance Criteria:
  - FactSheetDetail renders all BusinessProcess fields
  - Relations, lifecycle, tags, comments, todos, documents all work
  - Already works with existing code
```

### Epic 2: New Relation Types

```
US-2.1: Register BPM Relation Types
  Implementation:
  - Add 9 relation types to seed.py RELATIONS list
  - Existing relation picker on FactSheetDetail works automatically

US-2.2-2.4: Link Process to Capability / Application / Other Processes
  All use existing /api/v1/relations CRUD — no new code needed
```

### Epic 3: BPMN 2.0 Process Modeling

**Goal**: Process owners can model BPMN 2.0 diagrams with a user-friendly editor, and EA architects can cross-reference diagram elements to applications, data objects, and IT components.

```
US-3.1: BPMN Diagram Editor (Full Page)
  As a process owner
  I want a visual BPMN 2.0 editor to model my process
  So that the process flow is documented in standard notation

  Acceptance Criteria:
  - Full-page editor at /bpm/processes/:id/flow
  - Uses bpmn-js Modeler with simplified palette (Simple Mode default)
  - Toggle between Simple Mode and Full BPMN Mode
  - Canvas supports: drag elements from palette, connect with sequence flows,
    add swimlanes, inline rename (double-click), undo/redo
  - Properties panel on the right for element details
  - Toolbar: Save, Undo, Redo, Zoom, Fit, Auto-Layout, Export, Import, Templates
  - Auto-save with 5-second debounce after last change
  - Keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+S, Delete, Space+drag
  - Back button returns to process fact sheet detail
  - API: PUT /api/v1/bpm/processes/{id}/diagram

US-3.2: Start from Template
  As a process owner
  I want to start from a pre-built template instead of a blank canvas
  So that I can model common processes quickly

  Acceptance Criteria:
  - Template chooser dialog shown when no diagram exists yet
  - 6 templates: Blank, Simple Approval, Order-to-Cash, Procure-to-Pay,
    Hire-to-Retire, Incident Management
  - Each template has a preview thumbnail and description
  - Selecting a template loads the BPMN XML into the editor
  - "Import BPMN" option to upload .bpmn files from other tools

US-3.3: BPMN Diagram Viewer (Read-Only)
  As a stakeholder
  I want to view the BPMN diagram without being able to edit it
  So that I can understand the process

  Acceptance Criteria:
  - ProcessFlowTab in FactSheetDetail shows BpmnViewer (read-only)
  - Uses bpmn-js NavigatedViewer (smaller bundle than full Modeler)
  - Click element to see details in popover (name, type, lane, linked application)
  - Hover highlights connected elements
  - Color overlays: by automation level, by application
  - Minimap for navigation
  - "Open Editor" button navigates to full-page editor
  - If no diagram exists, shows "Create Process Flow" button with template chooser

US-3.4: Element Extraction & EA Linking
  As an EA architect
  I want BPMN elements to be automatically extracted and linkable to EA fact sheets
  So that I can trace which applications, data objects, and IT components
  support each process step

  Acceptance Criteria:
  - On diagram save, backend parses BPMN XML and extracts tasks, gateways, events
  - Extracted elements shown in a table below the diagram viewer
  - Table columns: Name, Type, Lane, Application, Data Object, IT Component
  - Click "Link" on a row to assign EA fact sheets via search picker
  - Links persist across diagram saves (matched by bpmn_element_id)
  - If an element is deleted from the diagram, its EA links are removed
  - Element-to-app links feed into the Process × Application matrix report
  - API: GET /api/v1/bpm/processes/{id}/elements
  - API: PUT /api/v1/bpm/processes/{id}/elements/{eid}

US-3.5: Link from Editor (Context Menu)
  As a process owner
  I want to link a BPMN element to an application directly from the editor
  So that I don't have to switch views to add EA context

  Acceptance Criteria:
  - Right-click a task in the editor → "Link to Application..."
  - Opens ElementLinker dialog with search for Applications, Data Objects, IT Components
  - Save triggers PUT to elements API
  - Linked application name shown as a badge/overlay on the element in the diagram

US-3.6: Import / Export BPMN 2.0
  As a process engineer
  I want to import BPMN 2.0 XML from other tools (Camunda, Signavio, ARIS)
  and export my diagrams in standard BPMN 2.0 format
  So that I can collaborate with teams using different tools

  Acceptance Criteria:
  - Import: File upload (.bpmn, .xml) → loads into editor, saves to backend
  - Export BPMN: Download as .bpmn file (standard BPMN 2.0 XML)
  - Export SVG: Download as .svg (vector, print-quality)
  - Export PNG: Download as .png (raster, for presentations)
  - Import validates XML is valid BPMN 2.0, shows error if not

US-3.7: Diagram Versioning
  As a process owner
  I want to see the history of changes to my process diagram
  So that I can track evolution and revert if needed

  Acceptance Criteria:
  - Each save creates a new version (version number increments)
  - Version history accessible from toolbar or diagram info panel
  - View previous versions in read-only mode
  - "Restore this version" creates a new version from the old XML
  - API: GET /api/v1/bpm/processes/{id}/diagram/versions

US-3.8: Validation & Quality Checks
  As a process owner
  I want the editor to warn me about modeling errors
  So that my diagrams follow BPMN 2.0 best practices

  Acceptance Criteria:
  - Warnings (non-blocking):
    - Unconnected elements ("Task X has no incoming/outgoing flow")
    - Unnamed tasks ("Task has no name")
    - Missing start or end event
    - Empty lanes
  - Errors (blocking save with override option):
    - Invalid connections per BPMN spec
  - Validation panel at bottom of editor, items are clickable to navigate
  - Validation runs on save and on-demand via toolbar button

US-3.9: First-Time Onboarding
  As a process owner using the editor for the first time
  I want a guided introduction
  So that I can start modeling without reading documentation

  Acceptance Criteria:
  - 5-step tooltip tour on first visit (stored in localStorage or user preferences)
  - Quick reference help panel (? key or button)
  - Tooltips on every palette item explaining what each element does
  - Link to full documentation in help panel
```

### Epic 4: BPM Reports & Visualizations

```
US-4.1: BPM Dashboard
  Acceptance Criteria:
  - Route: /bpm
  - KPI cards: total processes, avg maturity, avg automation level
  - Recharts charts: process type pie, maturity bar, automation bar, risk distribution
  - Table: top 10 at-risk processes
  - Diagram coverage stat: % of processes with BPMN diagrams
  - API: GET /api/v1/reports/bpm/dashboard

US-4.2: Capability Heat Map
  Acceptance Criteria:
  - Grid: L1 capabilities as cards, L2 as colored cells
  - Color by: maturity, strategicImportance, process coverage count
  - Click navigates to capability detail
  - API: GET /api/v1/reports/bpm/capability-heatmap

US-4.3: Cross-Reference Matrices
  Acceptance Criteria:
  - Capability × Process matrix
  - Process × Application matrix (using both process-level and element-level links)
  - Cells colored by criticality or support type
  - Click cell to view/create/remove relation
  - API: GET /api/v1/reports/bpm/capability-process-matrix
  - API: GET /api/v1/reports/bpm/process-application-matrix

US-4.4: Process Dependency Graph
  Acceptance Criteria:
  - Force-directed graph (D3)
  - Nodes = processes, edges = dependencies (relProcessDependency)
  - Click node highlights upstream/downstream
  - API: GET /api/v1/reports/bpm/process-dependencies

US-4.5: Element-Application Map
  As an EA architect
  I want to see which applications are used across all BPMN diagrams
  So that I can assess application criticality from a process perspective

  Acceptance Criteria:
  - Table: Application | Process | Element | Element Type | Lane
  - Grouped by application, showing all process steps that reference it
  - Sortable, filterable, exportable
  - API: GET /api/v1/reports/bpm/element-application-map
```

### Epic 5: Process Assessments

```
US-5.1: Create Process Assessment
  Acceptance Criteria:
  - ProcessAssessmentPanel in FactSheetDetail "Assessments" tab
  - Form: date, scores (1-5) for overall/efficiency/effectiveness/compliance/automation, notes
  - Action items sub-form: title, description, due_date, status
  - API: POST /api/v1/bpm/processes/{id}/assessments

US-5.2: Assessment History & Trends
  Acceptance Criteria:
  - Recharts LineChart: dimension scores over time
  - Table of all assessments with expandable action items
  - Date range filter

US-5.3: Generate Process Report
  Acceptance Criteria:
  - "Export Report" button on process detail
  - DOCX/PDF with: metadata, BPMN diagram (SVG embed), element-app table,
    related capabilities/apps, latest assessment, action items
```

### Epic 6: Governance & Integration

```
US-6.1: Global Search — already works
US-6.2: Governance Filters — bookmark presets for no-owner, stale, high-risk
US-6.3: Import/Export — existing inventory import/export supports new type
US-6.4: Process Coverage KPI
  As a governance lead
  I want to see which processes have BPMN diagrams and which don't
  So that I can enforce documentation standards

  Acceptance Criteria:
  - BPM dashboard shows: "X of Y processes have diagrams (Z%)"
  - Inventory filter: "Has BPMN diagram" yes/no
```

---

## Implementation Order

```
Phase 1 — Type Registration (Epics 1 + 2)                          [~2 hours]
  1. Add BusinessProcess type + option lists to seed.py
  2. Add 9 BPM relation types to seed.py
  3. Enrich BusinessCapability fields_schema
  4. Verify: create process, add relations, browse in inventory

Phase 2 — BPMN Backend (Epic 3, backend)                           [~6 hours]
  5. Create ProcessDiagram, ProcessElement, ProcessAssessment models
  6. Create Alembic migration
  7. Create bpmn_parser.py service
  8. Create bpm.py router (diagram CRUD, element extraction, element linking)
  9. Create schemas/bpm.py
  10. Create bpm_assessments.py router
  11. Add BPMN template files (XML)

Phase 3 — BPMN Editor Frontend (Epic 3, frontend)                  [~12 hours]
  12. npm install bpmn-js + properties panel
  13. Build BpmnModeler.tsx (full editor wrapper with simplified palette)
  14. Build BpmnViewer.tsx (read-only viewer)
  15. Build ProcessFlowTab.tsx (viewer + element table)
  16. Build ProcessFlowEditorPage.tsx (full-page editor route)
  17. Build BpmnTemplateChooser.tsx
  18. Build ElementLinker.tsx (EA linking dialog)
  19. Integrate ProcessFlowTab into FactSheetDetail
  20. Add routes to App.tsx
  21. Simple Mode / Full Mode toggle
  22. Keyboard shortcuts, toolbar, auto-save
  23. First-time onboarding tooltip tour
  24. Validation panel

Phase 4 — BPM Dashboard & Reports (Epic 4)                         [~6 hours]
  25. Create bpm_reports.py backend endpoints
  26. Build BpmDashboard with KPIs and charts
  27. Build CapabilityHeatMap
  28. Build ProcessMatrixReport
  29. Build ProcessDependencyGraph
  30. Build Element-Application Map report
  31. Add navigation items in AppLayout

Phase 5 — Assessments (Epic 5)                                     [~4 hours]
  32. Build ProcessAssessmentPanel (form + chart)
  33. Integrate as tab in FactSheetDetail
  34. Process report export (DOCX with embedded SVG)

Phase 6 — Governance & Polish (Epic 6)                             [~2 hours]
  35. Governance bookmark presets
  36. Diagram coverage stats
  37. Seed demo processes with BPMN diagrams (optional)
```

---

## Key Implementation Notes

### What You Do NOT Need to Build

- ❌ CRUD API for processes — use existing `/api/v1/fact-sheets`
- ❌ Relation API — use existing `/api/v1/relations`
- ❌ Tags, subscriptions, comments, todos, lifecycle, quality seals, events, search
- ❌ Auth/RBAC — use existing `get_current_user`
- ❌ BPMN rendering engine — bpmn-js handles all notation, validation, and rendering

### What You DO Need to Build

- ✅ Seed data: new FactSheetType + 9 RelationTypes
- ✅ 3 new SQLAlchemy models: ProcessDiagram, ProcessElement, ProcessAssessment
- ✅ 1 new service: bpmn_parser.py (XML parsing, ~80 lines)
- ✅ 3 new API routers: bpm.py, bpm_assessments.py, bpm_reports.py
- ✅ 1 new Pydantic schema file: schemas/bpm.py
- ✅ Frontend: bpmn-js wrappers (Modeler + Viewer), EA element linker, templates
- ✅ Frontend: BPM dashboard, heatmap, matrix, dependency graph, assessment panel
- ✅ UX: Simple/Full mode toggle, tooltips, onboarding tour, validation panel
- ✅ BPMN template files (6 starter templates as .bpmn XML)

### npm Dependencies to Add

```bash
cd frontend
npm install bpmn-js bpmn-js-properties-panel @bpmn-io/properties-panel
```

### Python Dependencies — None Required

The BPMN XML parser uses Python's built-in `xml.etree.ElementTree`. No new pip packages.

### bpmn-js Licensing

bpmn-js core is **MIT licensed** (free for commercial use). The bpmn-js-properties-panel is also MIT. Some advanced bpmn.io plugins (like the bpmn-js-token-simulation or bpmn-js-differ) have different licenses — check before adding.

### Testing Checklist

```
Integration Tests (Backend):
  - Create BusinessProcess via /api/v1/fact-sheets
  - Save BPMN XML via PUT /bpm/processes/{id}/diagram → elements extracted
  - Re-save diagram with one element removed → element deleted, others preserved
  - Re-save diagram → EA links on surviving elements preserved
  - Update element EA links via PUT /bpm/processes/{id}/elements/{eid}
  - Assessment CRUD with score validation (1-5)
  - BPM dashboard stats endpoint

E2E Tests (Frontend):
  - Open editor with blank template, add tasks and connections, save
  - Reopen editor → diagram loads with correct positions
  - Create from Order-to-Cash template → diagram loads with all elements
  - Import .bpmn file from external tool → renders correctly
  - Export as SVG/PNG/BPMN → valid files
  - Link element to application → visible in element table and reports
  - View diagram in read-only mode → click element shows popover
  - Toggle Simple/Full mode → palette changes
  - Validation: create diagram with unconnected task → warning shown
  - First-time user → onboarding tour appears
```
