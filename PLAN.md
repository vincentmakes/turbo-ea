# Turbo EA — LeanIX Clone

## Overview

Turbo EA is a self-hosted Enterprise Architecture Management (EAM) platform — a faithful clone of SAP LeanIX. It provides a configurable metamodel, fact sheet management with rich detail pages, an inventory view with AG Grid, visual reports, diagrams, collaboration features, and data quality governance.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript + Vite + MUI 5 |
| **Data Grid** | AG Grid Community |
| **Backend** | Python 3.12 + FastAPI |
| **Database** | PostgreSQL 16+ |
| **Real-time** | SSE (Server-Sent Events) via internal async event bus |
| **Icons** | Material Symbols Outlined |
| **Containers** | Docker Alpine |
| **Reverse Proxy** | Nginx Alpine |
| **Deployment** | Docker Compose on Unraid |

---

## LeanIX Metamodel v4 — Complete Specification

### 12 Fact Sheet Types

#### Business Architecture Layer

**1. Business Capability** (`BusinessCapability`)
- Icon: `account_tree` | Color: `#4caf50` | Hierarchy: Yes (L1→L2→L3+)
- Subtypes: none
- Fields: alias (text)
- Purpose: Stable functional decomposition of what the business does

**2. Business Context** (`BusinessContext`)
- Icon: `domain` | Color: `#66bb6a` | Hierarchy: Yes
- Subtypes: Process, Value Stream, Customer Journey, Product
- Fields: alias (text)
- Purpose: Activities an org performs — value streams, products, processes

**3. Organization** (`Organization`)
- Icon: `corporate_fare` | Color: `#43a047` | Hierarchy: Yes
- Subtypes: Business Unit, Region, Legal Entity, Team, Customer
- Fields: alias (text)
- Purpose: Business units, regions, teams, legal entities

#### Application & Data Architecture Layer

**4. Application** (`Application`) — CENTER OF THE METAMODEL
- Icon: `apps` | Color: `#1976d2` | Hierarchy: Yes
- Subtypes: Business Application, Microservice, Deployment
- Fields:
  - *Information section*: alias (text), businessCriticality (single_select: missionCritical/businessCritical/businessOperational/administrativeService), functionalSuitability (single_select: perfect/appropriate/insufficient/unreasonable — UI: "Functional Fit"), technicalSuitability (single_select: fullyAppropriate/adequate/unreasonable/inappropriate — UI: "Technical Fit"), hostingType (single_select: onPremise/cloudSaaS/cloudPaaS/cloudIaaS/hybrid)
  - *Cost section*: totalAnnualCost (number), costCurrency (text)
- Purpose: Software systems, microservices, deployments — connects to more types than any other

**5. Interface** (`Interface`)
- Icon: `sync_alt` | Color: `#1565c0` | Hierarchy: No
- Subtypes: Logical Interface, API
- Fields:
  - *Interface Information section*: frequency (single_select: realtime/daily/weekly/monthly/onDemand/batch), dataDirection (single_select: unidirectional/bidirectional), technicalSuitability (single_select — same as Application)
- Purpose: Data exchange connections between applications (Provider/Consumer pattern)

**6. Data Object** (`DataObject`)
- Icon: `database` | Color: `#0d47a1` | Hierarchy: Yes
- Subtypes: none
- Fields:
  - *Data Object Information section*: dataSensitivity (single_select: public/internal/confidential/restricted), isPersonalData (boolean)
- Purpose: Business data entities (customer, order, product data)

#### Technology Architecture Layer

**7. IT Component** (`ITComponent`)
- Icon: `memory` | Color: `#7b1fa2` | Hierarchy: Yes
- Subtypes: Software, Hardware, SaaS, IaaS, PaaS, Service
- Fields:
  - *IT Component Information section*: alias (text), technicalSuitability (single_select — same as Application)
  - *Cost section*: totalAnnualCost (number)
- Purpose: Technology dependencies — software, hardware, cloud services

**8. Tech Category** (`TechCategory`)
- Icon: `category` | Color: `#9c27b0` | Hierarchy: Yes
- Subtypes: none
- Fields: alias (text)
- Purpose: Standardized groupings for IT Components (e.g., DBMS, OS, Cloud Platform)

**9. Provider** (`Provider`)
- Icon: `store` | Color: `#6a1b9a` | Hierarchy: No
- Subtypes: none
- Fields:
  - *Provider Information section*: website (text), headquarters (text)
- Purpose: Vendors and suppliers of technology and services

#### Transformation Architecture Layer

**10. Platform** (`Platform`)
- Icon: `hub` | Color: `#e65100` | Hierarchy: No
- Subtypes: Digital, Technical
- Fields: alias (text)
- Purpose: Strategic groupings of applications and technologies

**11. Objective** (`Objective`)
- Icon: `flag` | Color: `#ef6c00` | Hierarchy: No
- Subtypes: none
- Fields:
  - *Objective Information section*: category (single_select: strategic/tactical/operational), kpiDescription (text)
- Purpose: Strategic goals driving initiatives and transformation

**12. Initiative** (`Initiative`)
- Icon: `rocket_launch` | Color: `#f57c00` | Hierarchy: Yes
- Subtypes: Idea, Program, Project, Epic
- Fields:
  - *Initiative Information section*: status (single_select: proposed/approved/inProgress/completed/cancelled), budget (number), startDate (date), endDate (date)
- Purpose: Transformation efforts — ideas, projects, programs, epics

### Common Properties (ALL fact sheet types)

| Property | Type | Description |
|----------|------|-------------|
| name | text (required) | Primary identifier |
| alias | text | Alternative name |
| description | text (multiline) | Rich description |
| lifecycle | JSONB | Dates for: plan, phaseIn, active, phaseOut, endOfLife |
| tags | relation | Multi-select from tag groups |
| subscriptions | relation | Responsible, Accountable, Observer |
| quality_seal | enum | DRAFT / APPROVED / BROKEN / REJECTED |
| completion | float | Auto-calculated 0–100% based on filled fields |
| external_id | text | Integration identifier |
| documents | relation | Links/attachments |
| comments | relation | Threaded discussion |
| todos | relation | Action items |
| history | events | Full audit trail |

### Lifecycle Model (5 phases)

| Phase | Meaning | Color |
|-------|---------|-------|
| Plan | Envisioned in TO-BE landscape | `#9e9e9e` |
| Phase In | Implementation underway | `#2196f3` |
| Active | In production | `#4caf50` |
| Phase Out | Being retired/replaced | `#ff9800` |
| End of Life | Decommissioned | `#f44336` |

### Quality Seal States

| State | Description | Trigger |
|-------|-------------|---------|
| DRAFT | New/work-in-progress | Default on creation |
| APPROVED | Data verified by Responsible/Accountable | Manual approval |
| BROKEN | Data changed or inactivity timeout | Auto on field/relation change by non-subscriber |
| REJECTED | Removed from quality process | Manual rejection |

What breaks the seal: Changes to attributes, relations, lifecycle.
What does NOT break it: Changes to comments, subscriptions, todos.

### Relation Types (25+ including self-referencing)

#### Cross-Type Relations

| # | Key | Source → Target | Relation Attributes |
|---|-----|----------------|-------------------|
| 1 | relAppToBC | Application → Business Capability | functionalSuitability, supportType (leading/effective) |
| 2 | relAppToOrg | Application → Organization | usageType (user/owner) |
| 3 | relAppToITC | Application → IT Component | technicalSuitability, costTotalAnnual |
| 4 | relProviderAppToInterface | Application → Interface | (provider side) |
| 5 | relConsumerAppToInterface | Application → Interface | (consumer side) |
| 6 | relAppToDataObj | Application → Data Object | crudFlags (C/R/U/D) |
| 7 | relAppToProvider | Application → Provider | — |
| 8 | relAppToPlatform | Application → Platform | — |
| 9 | relAppToBCx | Application → Business Context | — |
| 10 | relAppToInitiative | Application → Initiative | — |
| 11 | relInterfaceToDataObj | Interface → Data Object | — |
| 12 | relInterfaceToITC | Interface → IT Component | (middleware) |
| 13 | relITCToTechCat | IT Component → Tech Category | resourceClassification (standard/phaseIn/tolerated/phaseOut/declined) |
| 14 | relITCToProvider | IT Component → Provider | — |
| 15 | relObjToBC | Objective → Business Capability | — |
| 16 | relObjToInitiative | Objective → Initiative | — |
| 17 | relInitToApp | Initiative → Application | — |
| 18 | relInitToITC | Initiative → IT Component | — |
| 19 | relInitToBC | Initiative → Business Capability | — |
| 20 | relPlatformToApp | Platform → Application | — |
| 21 | relPlatformToITC | Platform → IT Component | — |
| 22 | relPlatformToBC | Platform → Business Capability | — |
| 23 | relOrgToApp | Organization → Application | — |
| 24 | relBCxToBC | Business Context → Business Capability | — |
| 25 | relBCxToApp | Business Context → Application | — |
| 26 | relBCToOrg | Business Capability → Organization | — |

#### Self-Referencing Relations (ALL types support these)

| Key | Label | Description |
|-----|-------|-------------|
| relToSuccessor | Successor | Planned replacement |
| relToPredecessor | Predecessor | What this replaced |
| relToRequires | Requires | Same-type dependency |
| relToRequiredBy | Required By | Inverse dependency |

Parent/Child hierarchy is handled by `parent_id` on the fact sheet model.

### Tag Groups

| Property | Values | Description |
|----------|--------|-------------|
| mode | single / multi | Single-select or multi-select per fact sheet |
| create_mode | open / restricted | Who can create new tags |
| restrict_to_types | JSONB array | Limit to specific fact sheet types |
| mandatory | boolean | Required for quality seal approval |

### Subscription Model

| Role | Description | Limit |
|------|-------------|-------|
| Responsible | Maintains/updates the fact sheet | Multiple per FS |
| Accountable | Overall ownership (must be enabled) | One per FS |
| Observer | Notified of changes | Multiple per FS |

### Completion Score Calculation

Score = (filled weighted fields / total weighted fields) × 100

Each field in `fields_schema` has a `weight` (default 1). Weight 0 = excluded.
Completion only counts fields and relations, NOT tags or subscriptions.

---

## Current Implementation Plan — Phase 2: Rich Fact Sheets

### Backend Changes

#### 1. Enrich FactSheetType model
- Add `subtypes` JSONB column: `[{key, label}]`
- Add `completion_weights` JSONB column (or embed weights in fields_schema)

#### 2. Enrich TagGroup model
- Add `create_mode` column: "open" / "restricted" (default: "open")
- Add `restrict_to_types` JSONB column: list of fact sheet type keys (null = all)

#### 3. Quality Seal states
- Change default from "UNSET" to "DRAFT"
- Support 4 states: DRAFT, APPROVED, BROKEN, REJECTED
- Auto-break seal on attribute/relation/lifecycle changes (except by responsible/accountable)

#### 4. Overhaul seed data
Complete LeanIX-faithful field schemas for all 12 types with:
- Multiple sections per type (Information, Cost, etc.)
- Proper field keys matching LeanIX GraphQL names (functionalSuitability not functionalFit)
- Required flags on key fields
- Weight values for completion
- Subtypes for Application, Interface, ITComponent, Organization, BusinessContext, Initiative, Platform

Enriched relation types with proper attributes:
- relAppToBC: functionalSuitability, supportType
- relAppToITC: technicalSuitability, costTotalAnnual
- relAppToOrg: usageType
- relITCToTechCat: resourceClassification (5 values with colors)
- relAppToDataObj: crudFlags
- Provider/Consumer interface pattern
- Self-referencing: successor, predecessor, requires, requiredBy

#### 5. Completion score calculation
- Backend computes score on fact sheet create/update
- Reads fields_schema weights, checks which fields in `attributes` are filled
- Returns completion as 0–100 integer

#### 6. Fact sheet PATCH improvements
- Break quality seal on attribute/relation change (check if user is subscriber)
- Record field-level changes in events (old_value → new_value)
- Validate against fields_schema types

### Frontend Changes

#### 1. FactSheetDetail — Complete Overhaul
**Header area:**
- Fact sheet type badge (colored chip with icon)
- Name (large, editable inline)
- Completion score ring (circular progress %)
- Quality seal badge with approve/reject actions
- Tags displayed as colored chips
- Action menu: Edit, Delete, Clone, Subscribe

**Body — Section-based layout (NOT tabs for content):**
Replace current tab-based layout with scrollable sections like real LeanIX:

1. **Information Section** (collapsible)
   - Subsections from fields_schema, each with header
   - Edit button per subsection → inline form
   - Field types: text input, single_select dropdown (colored chips), number, boolean switch, date picker
   - Required fields marked with asterisk

2. **Lifecycle Section** (collapsible)
   - 5-phase horizontal timeline visualization
   - Date pickers for each phase
   - Color-coded current phase indicator

3. **Relations Sections** (one per relation type, collapsible)
   - Grouped by relation type (e.g., "Business Capabilities", "IT Components")
   - Each shows list of related fact sheets with relation attributes
   - Add relation: search dialog with fact sheet type filter
   - Relation attributes editable inline

4. **Tags Section** (collapsible)
   - Tag groups with assigned tags
   - Add/remove tags

5. **Subscriptions Section** (collapsible)
   - Grouped by role (Responsible, Accountable, Observer)
   - Add/remove subscribers

6. **Documents Section** (collapsible)
   - List of links/resources
   - Add new link

**Sidebar tabs (Comments, Todos, History):**
- Right sidebar or bottom tabs for collaborative features

#### 2. CreateFactSheetDialog — Enhanced
- Type selector with icons
- **Subtype selector** (shows subtypes for selected type)
- **Parent selector** (for hierarchical types — search existing fact sheets)
- Name (required)
- Description
- Mandatory fields from fields_schema (marked with asterisk)

#### 3. InventoryPage — Enhanced Filters
- Quality seal filter (Draft/Approved/Broken/Rejected chips)
- Lifecycle phase filter
- Tag filter (multi-select from tag groups)
- Subscription filter (my fact sheets)
- Completion range filter
- Column for subtype

#### 4. QualitySealBadge — Enhanced
- Show all 4 states with distinct colors
- DRAFT: gray, APPROVED: green, BROKEN: amber, REJECTED: red
- Approve button only shown to subscribers

---

## Database Schema

### Core Tables

```sql
fact_sheet_types (
  id UUID PK,
  key VARCHAR(100) UNIQUE,
  label VARCHAR(200),
  description TEXT,
  icon VARCHAR(100),
  color VARCHAR(20),
  category VARCHAR(50),        -- business/application/technology/transformation
  has_hierarchy BOOLEAN,
  subtypes JSONB,              -- [{key, label}] — NEW
  fields_schema JSONB,         -- [{section, fields: [{key, label, type, options, required, weight}]}]
  built_in BOOLEAN DEFAULT true,
  sort_order INT,
  created_at, updated_at
)

relation_types (
  id UUID PK,
  key VARCHAR(100) UNIQUE,
  label VARCHAR(200),
  source_type_key VARCHAR(100),
  target_type_key VARCHAR(100),
  attributes_schema JSONB,
  built_in BOOLEAN DEFAULT true,
  created_at, updated_at
)

fact_sheets (
  id UUID PK,
  type VARCHAR(100),
  subtype VARCHAR(100),        -- NEW
  name VARCHAR(500) NOT NULL,
  description TEXT,
  parent_id UUID FK,
  lifecycle JSONB,
  attributes JSONB,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  quality_seal VARCHAR(20) DEFAULT 'DRAFT',  -- CHANGED from UNSET
  completion FLOAT DEFAULT 0,
  external_id VARCHAR(500),
  alias VARCHAR(500),
  created_by UUID FK,
  updated_by UUID FK,
  created_at, updated_at
)

tag_groups (
  id UUID PK,
  name VARCHAR(200),
  description TEXT,
  mode VARCHAR(20) DEFAULT 'multi',
  create_mode VARCHAR(20) DEFAULT 'open',    -- NEW
  restrict_to_types JSONB,                    -- NEW
  mandatory BOOLEAN DEFAULT false,
  created_at
)

-- All other tables unchanged from Phase 1
```

---

## API Routes (unchanged from Phase 1, plus)

- `POST /api/v1/fact-sheets/{id}/quality-seal` body: `{action: "approve"|"reject"|"reset"}`
- `GET /api/v1/fact-sheets/{id}` now returns computed completion, resolved relations with attributes

---

## Unraid Deployment

### Prerequisites
- Existing PostgreSQL container (16+)
- Docker Compose support

### Setup
```bash
mkdir -p /mnt/user/appdata/turbo-ea && cd /mnt/user/appdata/turbo-ea
git clone https://github.com/vincentmakes/turbo-ea.git .
cp .env.example .env
# Edit .env: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, SECRET_KEY
docker compose up -d --build
```

First run with old database: `RESET_DB=true docker compose up -d`

Access: `http://<unraid-ip>:8920`
