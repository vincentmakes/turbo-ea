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
