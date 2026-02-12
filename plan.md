# Turbo EA — Fully Dynamic Metamodel Overhaul

## Vision

Turbo EA is a self-hosted Enterprise Architecture Management platform that creates a **digital twin of a company's IT landscape**. The metamodel is **fully admin-configurable** — fact sheet types, fields, subtypes, and relations are all data, not code.

The user's goal: reproduce the LeanIX metamodel exactly, with full admin configurability to add/edit/delete types, fields, subtypes, and relations.

---

## Key Principles from LeanIX

1. **The metamodel is data, not code.** Every aspect — types, fields, relations, subtypes — is stored in the database and configurable through the admin UI.
2. **Types are not tied to categories.** Categories are informational labels, not structural constraints. A type can have any category or none.
3. **Relations have cardinality.** Each relation type has a multiplicity (1:1, 1:n, n:m) that determines enforcement.
4. **Relations have edge labels.** Each relation has a verb (e.g., "supports", "affects", "uses") describing the directional meaning.
5. **Fields are admin-managed per type.** Admins can add/remove/reorder fields and sections on any type.
6. **Subtypes are admin-managed per type.** Admins can add/remove subtypes on any type.

---

## LeanIX Metamodel from XML (Exact Reference)

### Fact Sheet Types (from XML)

| Key | Label | Color | Layer | Hierarchy | Subtypes |
|-----|-------|-------|-------|-----------|----------|
| Objective | Objective | #c7527d | Strategy & Transformation | No | — |
| Platform | Platform | #027446 | Strategy & Transformation | No | Digital, Technical |
| Initiative | Initiative | #33cc58 | Strategy & Transformation | Yes | Idea, Program, Project, Epic |
| Organization | Organization | #2889ff | Business Architecture | Yes | Business Unit, Region, Legal Entity, Team, Customer |
| BusinessCapability | Business Capability | #003399 | Business Architecture | Yes | — |
| BusinessContext | Business Context | #fe6690 | Business Architecture | Yes | Process, Value Stream, Customer Journey, Business Product, ESG Capability* |
| Application | Application | #0f7eb5 | Application & Data | Yes | Business Application*, Microservice*, AI Agent*, Deployment |
| Interface | Interface | #02afa4 | Application & Data | No | Logical Interface, API, MCP Server* |
| DataObject | Data Object | #774fcc | Application & Data | Yes | — |
| ITComponent | IT Component | #d29270 | Technical Architecture | Yes | SaaS, PaaS, IaaS, Software, Hardware, Service, AI Model |
| TechCategory | Tech Category | #a6566d | Technical Architecture | Yes | — |
| Provider | Provider | #ffa31f | Technical Architecture | No | — |
| System | System | #5B738B | Technical Architecture | No | — (optional type) |

*Asterisks mark optional/newer subtypes shown dashed in the XML diagram.

### Relations (from XML — edge labels are the verbs)

| Source | Target | Label (verb) | Cardinality |
|--------|--------|-------------|-------------|
| Objective | Business Capability | improves | n:m |
| Objective | ESG Capability* | improves | n:m |
| Platform | Objective | supports | n:m |
| Platform | Application | runs | n:m |
| Platform | IT Component | implements | n:m |
| Initiative | Objective | supports | n:m |
| Initiative | Platform | affects | n:m |
| Initiative | Business Capability | improves | n:m |
| Initiative | ESG Capability* | affects | n:m |
| Initiative | Application | affects | n:m |
| Initiative | Interface | affects | n:m |
| Initiative | Data Object | affects | n:m |
| Initiative | IT Component | affects | n:m |
| Initiative | System* | affects | n:m |
| Organization | Objective | owns | n:m |
| Organization | Initiative | owns | n:m |
| Organization | Business Context | owns | n:m |
| Organization | Application | uses | n:m |
| Organization | IT Component | owns | n:m |
| Organization | Microservice* | owns | n:m |
| Application | Business Capability | supports | n:m |
| Application | Business Context | supports | n:m |
| Application | Interface | provides / consumes | n:m |
| Application | Data Object | CRUD | n:m |
| Application | IT Component | uses | n:m |
| Application | System* | runs on | n:m |
| IT Component | Tech Category | belongs to | n:m |
| IT Component | Platform | implements | n:m |
| Interface | Data Object | transfers | n:m |
| Interface | IT Component | uses | n:m |
| Provider | Initiative | supports | n:m |
| Provider | IT Component | offers | n:m |
| Business Context | Business Capability | is associated with | n:m |
| Business Capability | ESG Capability* | is associated with | n:m |
| Business Application* | System* | runs on | n:m |
| Microservice* | System* | supports | n:m |

---

## What Needs to Change

### Problem 1: Category is a constraint, should be a label
**Current**: `category` column on FactSheetType used to group types in the UI. The admin create dialog forces one of 4 categories.
**Fix**: Remove category as a required concept. Make it an optional label string. Remove from type filtering/grouping. Types stand on their own.

### Problem 2: Cannot edit types after creation
**Current**: Admin UI only creates types. No way to edit fields, subtypes, icon, color, or label after creation. No inline field editor.
**Fix**: Full CRUD admin UI for types with inline field editor, subtype management, and drag-reorder.

### Problem 3: Cannot manage fields on types
**Current**: `fields_schema` is set once at creation (always empty from UI). No UI to add/edit/remove fields or sections.
**Fix**: Section/field builder UI on each type's detail panel. Add field types: text, number, boolean, date, single_select, multiple_select.

### Problem 4: Cannot manage subtypes on types
**Current**: `subtypes` JSONB exists on the model but no UI to manage them. Seed data sets them.
**Fix**: Subtype management UI on each type's detail panel.

### Problem 5: Relations lack cardinality
**Current**: `RelationType` has no multiplicity. All relations are implicitly n:m.
**Fix**: Add `cardinality` column (enum: "1:1", "1:n", "n:m"). Add `label` as the verb/description of the relationship from source perspective. Add `reverse_label` for the target perspective.

### Problem 6: Cannot edit relations after creation
**Current**: Admin UI creates relation types but cannot edit or delete them.
**Fix**: Full CRUD for relation types. Edit attributes_schema, label, reverse_label. Delete with cascade warning.

### Problem 7: Relation types flat list is inefficient
**Current**: All 26+ relation types displayed as flat cards. Hard to understand the graph.
**Fix**: Show relations grouped by the selected type (what can this type connect to?). Add visual metamodel graph view.

### Problem 8: No delete for types or relations
**Current**: No DELETE endpoints.
**Fix**: Add soft-delete (hide) for built-in types/relations. Hard delete for custom ones (with cascade warning for types that have instances).

---

## Implementation Plan

### Phase A: Backend — Dynamic Metamodel Models & API

#### A1. Update RelationType model
Add to `relation_type.py`:
```python
cardinality: Mapped[str] = mapped_column(String(10), default="n:m")  # "1:1", "1:n", "n:m"
reverse_label: Mapped[str | None] = mapped_column(String(200))  # verb from target side
description: Mapped[str | None] = mapped_column(Text)
sort_order: Mapped[int] = mapped_column(Integer, default=0)
```

#### A2. Update FactSheetType model
Add to `fact_sheet_type.py`:
```python
is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)  # soft-delete for built-in
```
Remove the hard dependency on `category` being one of 4 values — keep it as a free-text optional field.

#### A3. Update Metamodel API endpoints
Enhance `metamodel.py`:

**Types:**
- `GET /types` — add `subtypes` to response, filter out `is_hidden=True` by default, add `?include_hidden=true` param
- `PATCH /types/{key}` — accept `subtypes`, `sort_order`, `is_hidden`
- `DELETE /types/{key}` — soft-delete built-in (set `is_hidden=True`), hard-delete custom (check for existing instances first)

**Relation Types:**
- `GET /relation-types` — add `cardinality`, `reverse_label`, `description`
- `GET /relation-types?type_key=X` — filter relations that connect to type X
- `PATCH /relation-types/{key}` — update label, reverse_label, cardinality (only if no instances exist), attributes_schema, description
- `DELETE /relation-types/{key}` — hard-delete custom (check for instances), soft-delete built-in

**New: Field management sub-endpoints (convenience — can also use PATCH /types/{key}):**
- `POST /types/{key}/sections` — add a section
- `POST /types/{key}/sections/{section}/fields` — add a field to a section
- `DELETE /types/{key}/sections/{section}/fields/{field_key}` — remove a field
- `PATCH /types/{key}/sections/{section}/fields/{field_key}` — update field properties
- `POST /types/{key}/subtypes` — add a subtype
- `DELETE /types/{key}/subtypes/{subtype_key}` — remove a subtype

#### A4. Update seed data
- Update seed to match the XML exactly (13 types with correct colors)
- Add `cardinality` and `reverse_label` to all relation types
- Add `description` to relation types using the XML edge labels as verbs
- Keep `sort_order` matching XML layer ordering

#### A5. Add multiple_select field type
- Add "multiple_select" to field type options
- Frontend renders as multi-select chip input
- Stored as JSON array in attributes JSONB

### Phase B: Frontend — Metamodel Admin Overhaul

#### B1. Rewrite MetamodelAdmin with 3 views

**View 1: Types List**
- Card per type showing icon, color swatch, label, layer label, hierarchy badge, subtype count, field count, relation count
- Click to open type detail panel (drawer or inline expand)
- "New Type" button opens create dialog
- Sort by sort_order, drag to reorder
- Show/hide toggle for hidden types

**View 2: Type Detail Panel** (the main editing view)
- Header: icon picker, color picker, label (editable), description, hierarchy toggle
- **Subtypes section**: List of subtypes with add/remove
- **Fields section**: Sections as collapsible groups. Each section has:
  - Section name (editable)
  - List of fields (drag-reorder within section)
  - "Add Field" button → field dialog (key, label, type, required, weight, options for select types)
  - Edit/delete per field
- **Relations section**: Shows all relation types connected to this type (as source or target)
  - Each shows: verb/label, target type icon+name, cardinality badge
  - "Add Relation" button → opens dialog to create a new relation type

**View 3: Metamodel Graph**
- Visual graph showing types as colored nodes and relations as labeled edges
- Use the exact layout from the LeanIX XML (4-layer horizontal layout)
- Types positioned by layer: Strategy & Transformation (top) → Business → Application & Data → Technical (bottom)
- Edges labeled with the verb (supports, affects, etc.)
- Click a type node to navigate to its detail panel
- Implementation: Simple SVG/Canvas rendering (not a heavy library)

#### B2. Type Create/Edit Dialog
- Key (auto-generated slug from label, immutable after creation)
- Label
- Description
- Icon (Material Symbol picker or text input)
- Color (color picker)
- Layer label (free text, not enum — e.g., "Strategy & Transformation", "Business Architecture")
- Has hierarchy toggle

#### B3. Field Editor Dialog
- Key (auto-slug from label, immutable after creation)
- Label
- Type: text | number | boolean | date | single_select | multiple_select
- Required toggle
- Weight (number, for completion scoring)
- Options editor (for select types): list of {key, label, color} with add/remove/reorder

#### B4. Relation Type Create/Edit Dialog
- Source type (dropdown)
- Target type (dropdown)
- Label (verb, e.g., "supports")
- Reverse label (e.g., "is supported by")
- Cardinality: 1:1 | 1:n | n:m
- Attributes schema (inline field editor, same as type fields)

#### B5. Update useMetamodel hook
- Add `subtypes` to the cached type data
- Add `cardinality`, `reverse_label` to relation types
- Add mutation helpers: `updateType()`, `deleteType()`, `updateRelationType()`, `deleteRelationType()`

#### B6. Update types/index.ts
```typescript
interface RelationType {
  key: string;
  label: string;
  reverse_label?: string;
  source_type_key: string;
  target_type_key: string;
  cardinality: "1:1" | "1:n" | "n:m";
  attributes_schema: FieldDef[];
  built_in: boolean;
  description?: string;
}

// Add multiple_select to FieldDef type union
interface FieldDef {
  type: "text" | "number" | "boolean" | "date" | "single_select" | "multiple_select";
  // ...existing
}
```

### Phase C: Frontend — Update Consuming Components

#### C1. FactSheetDetail — Relations section
- Group relations by relation type, showing the verb label
- Show cardinality badge
- Show relation attributes (if any)

#### C2. CreateFactSheetDialog
- No changes needed (already uses dynamic metamodel)

#### C3. InventoryPage
- No category-based grouping (types are independent)

### Phase D: Seed Data — Match XML Exactly

Update seed.py to:
1. Use exact colors from XML
2. Include all 13 types (including System as optional/hidden)
3. Include all relations with exact verb labels from XML
4. Set cardinality on all relations
5. Include optional subtypes (AI Agent, MCP Server, ESG Capability, AI Model)

---

## File Changes Summary

### Backend
| File | Action |
|------|--------|
| `backend/app/models/relation_type.py` | Add cardinality, reverse_label, description, sort_order columns |
| `backend/app/models/fact_sheet_type.py` | Add is_hidden column |
| `backend/app/api/v1/metamodel.py` | Full rewrite: CRUD for types (with subtypes/fields inline), CRUD for relation types, DELETE endpoints |
| `backend/app/services/seed.py` | Update to match XML exactly: 13 types, exact colors, all relations with verbs and cardinality |

### Frontend
| File | Action |
|------|--------|
| `frontend/src/types/index.ts` | Add cardinality, reverse_label to RelationType; add multiple_select to FieldDef |
| `frontend/src/hooks/useMetamodel.ts` | Add subtypes to cache, add mutation helpers |
| `frontend/src/features/admin/MetamodelAdmin.tsx` | Complete rewrite: 3-view layout (types list, type detail, graph) |
| `frontend/src/features/fact-sheets/FactSheetDetail.tsx` | Update relations section to show verb labels and cardinality |

### Migration
- Set `RESET_DB=true` to get new schema + re-seed

---

## Implementation Order

1. **A1-A2**: Model changes (add columns)
2. **A4**: Seed data update (match XML exactly)
3. **A3**: API enhancement (CRUD endpoints)
4. **B5-B6**: Frontend types + hook updates
5. **B1-B4**: Admin UI rewrite (biggest piece)
6. **C1-C3**: Update consuming components
7. Build + test + commit

---
---

# Reports Redesign

## Philosophy

The metamodel is powerful (configurable types, attributes, relations, hierarchies), but the current reports don't leverage it — they're hardcoded to specific attributes and lack interactivity. The redesign follows three principles:

1. **Data-driven, not hardcoded** — reports read the metamodel to populate filter options, axis choices, and color mappings dynamically
2. **Interactive** — every visual element is clickable, filterable, and explorable
3. **Dual-mode** — each report has a **chart view** and a **table view** toggle

**Chart library:** Recharts (React-native, lightweight, covers scatter/bubble, treemap, bar, radar) + custom SVG for specialized layouts (capability map, tech radar).

---

## Report 1 — Application Portfolio (TIME / Bubble Chart)

> The #1 EA report. Maps items on a configurable 2D grid to drive invest/migrate/tolerate/eliminate decisions.

### Current problems
- Axes hardcoded to `functionalFit` / `technicalFit`
- No axis customization, no legend, no filters
- Crude CSS-grid bubbles with 2-letter abbreviations
- No table view fallback

### Proposed design

**Top toolbar:**

| Control | Type | Purpose |
|---------|------|---------|
| Fact Sheet Type | Dropdown (from metamodel) | Which items to plot (default: Application) |
| X-Axis | Dropdown (single_select fields of chosen type) | Horizontal dimension |
| Y-Axis | Dropdown (single_select fields of chosen type) | Vertical dimension |
| Bubble Size | Dropdown (number fields + "None") | Third dimension |
| Bubble Color | Dropdown (single_select fields + "None") | Fourth dimension |
| Filter by | Multi-select chips (tags, lifecycle status, related type) | Narrow dataset |

**Chart area:**
- Recharts `ScatterChart` with labeled quadrant grid
- Axis labels derived from the selected field's `options[].label`
- Bubble size scaled with a visible legend (min/max reference circles)
- Bubble color mapped from field option colors (with legend strip below chart)
- Hover tooltip: name, all four mapped values, plus lifecycle status
- Click bubble → navigate to fact sheet detail

**Quadrant overlay:**
- Semi-transparent colored backgrounds for the 4 quadrants
- Labels in each corner: "Invest", "Migrate", "Tolerate", "Eliminate"
- Quadrant labels configurable (user can rename them)

**Table toggle:**
- Switch to a sortable data table showing all plotted items with columns for name, x-value, y-value, size-value, color-value, lifecycle
- Row click → navigate to detail

**Empty / partial states:**
- Items missing axis values shown in a "Not classified" sidebar count
- Prompt to "Complete data for N items" linking to the data quality report

---

## Report 2 — Business Capability Heatmap

> Visualizes the capability hierarchy as a nested tile map, colored by a chosen metric. The "executive Rosetta Stone" of EA.

### Proposed design

**Top toolbar:**

| Control | Type | Purpose |
|---------|------|---------|
| Heatmap Metric | Dropdown | What colors the tiles (see below) |
| Scope | Multi-select | Filter by business unit / tag |

**Metric options (dropdown):**
- Application Count — how many apps support each capability (darker = more)
- Average Application Health — mean of functional fit / technical fit scores
- Total Cost — sum of `totalAnnualCost` of linked applications
- Risk — count of linked end-of-life technologies
- Strategic Importance — a single_select attribute on the capability type
- Custom — any number attribute on the capability type

**Tile layout:**
- L1 capabilities as large labeled cards in a responsive CSS Grid (3-4 columns)
- L2 capabilities nested inside as smaller tiles
- L3 capabilities (if any) shown as colored chips within L2 tiles
- Each tile shows: capability name, metric value, small sparkline or badge
- Color scale: 5-step sequential palette (light → dark) with legend bar at bottom

**Interactivity:**
- Hover tile → tooltip with capability name, metric value, top 3 supporting apps
- Click tile → slide-out drawer listing all linked applications with their health scores
- Tile border highlight if any linked app is end-of-life

**Fallback:**
- If no hierarchy exists, render as a flat grid sorted by metric value (still useful)

---

## Report 3 — Technology Lifecycle & Obsolescence

> Timeline showing technology end-of-life risk. Replaces the current Roadmap report.

### Current problems
- No date axis labels at all
- No legend for phase colors
- No date range controls or zoom
- No filtering beyond type

### Proposed design

**Top toolbar:**

| Control | Type | Purpose |
|---------|------|---------|
| Fact Sheet Type | Dropdown | Default: "IT Component" / "Technology" |
| Time Range | Date range picker | Start/end of visible window |
| Group By | Dropdown | None, Category, Related Application, Tag |
| Filter | Multi-select chips | Lifecycle phase, category, tags |

**Timeline area:**
- Proper horizontal date axis at top with labeled tick marks (quarters or years)
- "Today" marker line (dashed vertical red line)
- Each item = horizontal bar spanning its lifecycle phases
- Phases color-coded: Plan (gray) → Phase In (blue) → Active (green) → Phase Out (amber) → End of Life (red)
- Grouped rows with collapsible group headers when "Group By" is set

**Legend:**
- Horizontal color strip legend always visible below toolbar
- Includes count badges: "12 Active · 5 Phase Out · 3 End of Life"

**Risk indicators:**
- Items in End of Life phase get a warning icon
- Items approaching End of Life (within selected threshold) get a caution icon
- Summary banner at top: "N technologies reaching end of life within 12 months"

**Interactivity:**
- Hover bar segment → tooltip with exact dates, phase, linked applications count
- Click bar → navigate to fact sheet detail
- Mouse wheel / pinch to zoom timeline; drag to pan

**Table toggle:**
- Sortable table: Name, Category, Current Phase, Phase-Out Date, End-of-Life Date, # Linked Apps

---

## Report 4 — Dependency / Interface Map

> Network graph showing how applications connect. Critical for impact analysis and migration planning.

### Proposed design

**Top toolbar:**

| Control | Type | Purpose |
|---------|------|---------|
| Center On | Search/autocomplete | Focus on a specific application |
| Depth | Slider (1-3) | How many hops of dependencies to show |
| Relation Types | Multi-select | Which relation types to include as edges |
| Layout | Toggle: Force / Hierarchical | Graph layout algorithm |
| Filter | Multi-select chips | Type, tags, lifecycle |

**Graph area:**
- Force-directed or hierarchical graph layout (custom SVG)
- Nodes = applications (circles with name labels)
- Node size = configurable (user count, cost, or uniform)
- Node color = by type, lifecycle status, or domain/tag
- Edges = relations between applications
- Edge thickness = uniform (or by a relation attribute if available)
- Edge color = by relation type (with legend)

**Interactivity:**
- Drag nodes to rearrange
- Hover node → highlight all connected edges, dim unconnected
- Click node → sidebar panel with: name, type, lifecycle, list of all relations
- Double-click node → navigate to fact sheet detail
- Hover edge → tooltip with relation type, description

**Impact analysis mode:**
- Select a node → all downstream dependents highlighted in red cascade
- Badge showing "N direct + M transitive dependents"

**Table toggle:**
- Flat table: Source App, Relation Type, Target App, Description
- Sortable, searchable

---

## Report 5 — Cost & Rationalization Treemap

> Replaces the current bar-chart cost report with a treemap that instantly shows where money goes.

### Current problems
- Only shows flat list with LinearProgress bars
- Hardcoded to Application type, totalAnnualCost field
- No grouping, no drill-down

### Proposed design

**Top toolbar:**

| Control | Type | Purpose |
|---------|------|---------|
| Fact Sheet Type | Dropdown | Which items to analyze |
| Cost Field | Dropdown (number fields) | Which attribute represents cost |
| Group By | Dropdown | None, Business Capability, Business Unit, Tag, Lifecycle |
| Color By | Dropdown | Health score, lifecycle phase, business criticality |
| Filter | Multi-select chips | Tags, lifecycle, related types |

**Treemap area:**
- Recharts `Treemap` component
- Rectangle size = cost value
- Rectangle color = selected color dimension (with legend)
- Group By creates nested treemap (outer rectangles = groups, inner = items)
- Each rectangle labeled with: name (truncated), cost value

**Summary strip above treemap:**
- Total cost (large number)
- Item count
- Average cost per item
- Top cost driver (name + % of total)

**Interactivity:**
- Hover rectangle → tooltip: name, cost, % of total, group, lifecycle
- Click rectangle → navigate to fact sheet detail
- Click group → zoom into group (breadcrumb to zoom back out)

**Table toggle:**
- Sortable table: Name, Cost, % of Total, Group, Lifecycle, Health
- Total row at bottom

---

## Report 6 — Matrix Report (Enhanced)

> Keep the cross-reference matrix but make it actually useful.

### Current problems
- Just a bullet "●" — no information density
- No hover details, no counts, no color coding
- Unwieldy at scale — no pagination or virtualization

### Proposed design

**Top toolbar (same as current + additions):**

| Control | Type | Purpose |
|---------|------|---------|
| Row Type | Dropdown | Fact sheet type for rows |
| Column Type | Dropdown | Fact sheet type for columns |
| Cell Metric | Dropdown: Count / Attribute / Exists | What to show in cells |
| Sort Rows By | Dropdown: Name / Relation Count | Row ordering |
| Filter | Search field + tag chips | Narrow rows/columns |

**Matrix area:**
- Sticky header row + sticky first column (preserved from current)
- **Cell content options:**
  - "Exists" mode: colored dot (current but improved — color by a relation attribute)
  - "Count" mode: number showing how many relations exist (heat-colored: white → blue)
  - "Attribute" mode: show a specific relation attribute value in each cell
- Cell background: intensity-shaded by value (heatmap effect)
- Row/column count badges in headers: "(12)" after each name

**Interactivity:**
- Hover cell → tooltip: row item name, column item name, relation details
- Click cell → popover with full relation details + link to both items
- Click row/column header → navigate to that fact sheet

**Scale handling:**
- Virtual scrolling for large matrices (react-window or similar)
- Show top N rows/columns with "Show all" toggle
- Summary row at bottom: column totals

---

## Report 7 — Data Quality & Completeness Dashboard

> Meta-report on the health of the EA repository. Drives data governance.

### Proposed design

**KPI cards row (top):**

| Card | Value |
|------|-------|
| Overall Completion | Gauge (0-100%) across all types |
| Items with Complete Lifecycle | Count / % |
| Orphaned Items | Count of items with zero relations |
| Stale Items | Items not updated in 90+ days |

**Completeness by Type (main area):**
- Horizontal stacked bar chart — one bar per fact sheet type
- Segments: Complete (green), Partial (amber), Minimal (red)
- Sorted by worst-first (most incomplete at top)
- Each bar labeled with type name and count

**Worst offenders table:**
- Table listing the 20 lowest-completion items across all types
- Columns: Name, Type, Completion %, Missing Fields (comma-separated), Last Updated, Owner
- Click row → navigate to item to fill in data
- Sortable by any column

**Trend sparklines:**
- Small sparkline chart per type showing completion trend over last 6 data points (if historical data available)

**Interactivity:**
- Click on a bar segment → filtered table showing those items
- Filter by type, owner, tag
- "Fix now" button on each row → navigates to edit mode of the fact sheet

---

## UI / Visual Design Guidelines (all reports)

### Layout pattern (consistent across all reports):
```
┌─────────────────────────────────────────────┐
│  Report Title            [Chart] [Table]  ↗ │  ← title + view toggle + fullscreen
├─────────────────────────────────────────────┤
│  [Filter1 ▾] [Filter2 ▾] [Filter3 ▾]  🔍  │  ← toolbar with filters
├─────────────────────────────────────────────┤
│                                             │
│           Main visualization area           │  ← chart or table
│                                             │
├─────────────────────────────────────────────┤
│  ● Legend    ○ Legend    ◉ Legend            │  ← always-visible legend
└─────────────────────────────────────────────┘
```

### Shared components to build:
1. **ReportShell** — wraps every report with consistent title bar, chart/table toggle, fullscreen button, export menu
2. **ReportToolbar** — flex-wrap row of filter controls with responsive collapse
3. **ReportLegend** — horizontal legend strip with color swatches
4. **MetricCard** — small KPI card (value + label + optional trend)
5. **ChartTableToggle** — icon toggle between chart and table views

### Responsive behavior:
- Toolbar filters wrap to multiple lines on narrow screens
- Charts maintain aspect ratio with horizontal scroll when needed
- Table view is the automatic fallback on mobile (< 600px)
- Legends stack vertically on narrow screens

### Color palette:
- Sequential: `#e3f2fd → #1565c0` (light blue → dark blue) for heatmaps
- Diverging: `#c62828 → #fff → #2e7d32` (red → white → green) for health/risk
- Categorical: MUI palette colors for type-based coloring
- Always respect field option colors from the metamodel when available

### Export menu (all reports):
- Export as PNG (chart screenshot)
- Export as CSV (underlying data)
- Copy shareable link

---

## Proposed Navigation

Replace the current flat "Reports" dropdown with grouped sub-navigation:

```
Reports ▾
  ├── Portfolio        (Bubble chart — TIME model)
  ├── Capability Map   (Heatmap)
  ├── Lifecycle        (Timeline / obsolescence)
  ├── Dependencies     (Network graph)
  ├── Cost             (Treemap)
  ├── Matrix           (Cross-reference)
  └── Data Quality     (Completeness dashboard)
```

Drop "Landscape" as a separate report — its use case is covered better by the Capability Map (for capabilities) and by the Portfolio report's table view (for listing with filters).

---

## Implementation Priority

| Phase | Reports | Rationale |
|-------|---------|-----------|
| **Phase 1** | Portfolio (bubble), Lifecycle (timeline), Cost (treemap) | Highest value, existing API endpoints, direct upgrades of current reports |
| **Phase 2** | Capability Heatmap, Matrix (enhanced) | Require hierarchy traversal and more complex rendering |
| **Phase 3** | Dependencies (graph), Data Quality (dashboard) | New report types, new API endpoints needed |

### New dependencies to add:
- `recharts` — scatter, treemap, bar charts
- No other external dependencies needed (graph can use custom SVG)
