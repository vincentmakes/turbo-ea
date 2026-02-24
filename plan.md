# Plan: Add Successor/Predecessor Relationships

## Overview

Add a `has_successors` toggle on card types (mirroring `has_hierarchy`) that, when enabled, shows a dedicated **Successors** section on the card detail page. Under the hood, successor/predecessor uses the standard relations system with a self-referencing relation type per card type.

**Key design decision**: Successor and predecessor are two sides of the **same** relation. "A succeeds B" is equivalent to "B is preceded by A". One relation type per card type with `label: "succeeds"` and `reverse_label: "is preceded by"`.

## Card Types With `has_successors: true`

| Card Type | Relation Key | Rationale |
|-----------|-------------|-----------|
| Application | `relAppSuccessor` | App modernization/replacement — most common EA use case |
| ITComponent | `relITCSuccessor` | Technology lifecycle — upgrading from one tech to another |
| Initiative | `relInitiativeSuccessor` | Project sequencing — temporal ordering of programs/projects |
| Platform | `relPlatformSuccessor` | Platform evolution/replacement |
| BusinessProcess | `relProcessSuccessor` | Process improvement/replacement (distinct from existing "depends on") |
| Interface | `relInterfaceSuccessor` | API versioning — v1 succeeded by v2 |
| DataObject | `relDataObjectSuccessor` | Data model evolution/migration |

**Excluded** (no `has_successors` toggle):
- Objective, Organization, BusinessCapability, BusinessContext, TechCategory, Provider, System

---

## Changes Required

### 1. Backend: `backend/app/models/card_type.py` — Add `has_successors` column

Add a new boolean column `has_successors` (default `False`), mirroring `has_hierarchy`:

```python
has_successors: Mapped[bool] = mapped_column(Boolean, default=False)
```

### 2. Backend: `backend/alembic/versions/039_add_has_successors.py` — Migration

New Alembic migration to add the `has_successors` column to `card_types`:

```python
op.add_column("card_types", sa.Column("has_successors", sa.Boolean(), server_default="false", nullable=False))
```

### 3. Backend: `backend/app/api/v1/metamodel.py` — Expose `has_successors`

Add `has_successors` to:
- The type serialization dict (GET response)
- The create type logic
- The PATCH allowed fields list

### 4. Backend: `backend/app/services/seed.py`

#### a. Fix pair dedup logic (lines 4394-4396)

The current seed logic skips new relation types if a relation with the same `(source_type_key, target_type_key)` pair already exists. This blocks adding successor relations for types that already have a self-referencing relation (e.g., BusinessProcess has `relProcessDependency`).

**Fix**: Remove the pair dedup check. The key-based check already prevents exact duplicates.

Also remove the now-unused `existing_rel_pairs` variable.

#### b. Set `has_successors: True` on 7 card types in TYPES list

Add `"has_successors": True` to Application, ITComponent, Initiative, Platform, BusinessProcess, Interface, DataObject type definitions.

#### c. Add 7 new successor relation types to the RELATIONS list

Each entry:
- `key`: e.g., `relAppSuccessor`
- `label`: `"succeeds"` / `reverse_label`: `"is preceded by"`
- `source_type_key` == `target_type_key` (same card type)
- `cardinality`: `"n:m"`
- `sort_order`: starting from 40
- Full translations (de, fr, es, it, pt, zh)

#### d. Update seed_metamodel function

When updating existing built-in types, also sync `has_successors` from seed data (similar to how other fields are updated).

### 5. Frontend: `frontend/src/types/index.ts` — Add `has_successors` to CardType interface

```typescript
has_successors: boolean;
```

### 6. Frontend: `frontend/src/features/cards/sections/SuccessorsSection.tsx` — New section component

Create a new section component mirroring `HierarchySection.tsx` but using the relations API:

- Accordion with icon `arrow_forward` and title "Successors"
- Two sub-sections: **Predecessors** (cards that this card succeeds) and **Successors** (cards that succeed this card)
- Search & add: autocomplete to search same-type cards
- Quick create: inline create new card + relation
- Remove: delete the relation
- Click navigates to the related card
- Uses the successor relation type for the card's type (found by matching `source_type_key === target_type_key === cardType` and key pattern `rel*Successor`)
- Hidden if `!typeConfig?.has_successors`

### 7. Frontend: `frontend/src/features/cards/sections/index.ts` — Export SuccessorsSection

### 8. Frontend: `frontend/src/features/cards/CardDetailContent.tsx` — Wire up section

- Import `SuccessorsSection`
- Add `"successors"` to default section order (after hierarchy, before relations)
- Filter it out when `!typeConfig?.has_successors` (same pattern as hierarchy)
- Add `renderSection` case for `key === "successors"`

### 9. Frontend: `frontend/src/features/admin/metamodel/TypeDetailDrawer.tsx` — Add toggle

Add a `has_successors` switch toggle next to the existing `has_hierarchy` toggle:

```tsx
<FormControlLabel
  control={<Switch checked={hasSuccessors} onChange={(e) => setHasSuccessors(e.target.checked)} />}
  label={t("metamodel.typeDrawer.supportsSuccessors")}
/>
```

### 10. Frontend: `frontend/src/features/admin/MetamodelAdmin.tsx` — Add to create dialog + type list chip

- Add `has_successors` to the new type creation form (toggle switch)
- Show a "Successors" chip on type cards when `has_successors` is true (next to the "Hierarchy" chip)

### 11. Frontend: `frontend/src/features/admin/CardLayoutEditor.tsx` — Add successors section

Add `"successors"` to the built-in sections list with `onlyIf: (ct) => ct.has_successors` and to the default order.

### 12. Frontend: i18n translations (all 7 locales)

**New keys needed** in multiple namespaces:

**`admin.json`** (all 7 locales):
- `metamodel.supportsSuccessors`: "Supports Successors / Predecessors"
- `metamodel.typeDrawer.supportsSuccessors`: "Supports Successors / Predecessors"
- `metamodel.successors`: "Successors"
- `cardLayout.builtinSections.successors`: "Successors"

**`cards.json`** (all 7 locales):
- `successors.title`: "Successors"
- `successors.predecessors`: "Predecessors"
- `successors.successorsList`: "Successors"
- `successors.noPredecessors`: "No predecessors."
- `successors.noSuccessors`: "No successors."
- `successors.addPredecessor`: "Add Predecessor"
- `successors.addSuccessor`: "Add Successor"
- `successors.search`: "Search {{type}}"
- `successors.searchPlaceholder`: "Type to search..."
- `successors.createNew`: "Create new {{type}}"
- `successors.createAsPredecessor`: "Create new {{type}} as predecessor"
- `successors.createAsSuccessor`: "Create new {{type}} as successor"
- `successors.createAndAdd`: "Create & Add"
- `successors.backToSearch`: "Back to search"
- `successors.errors.add`: "Failed to add relation"
- `successors.errors.create`: "Failed to create card"

### 13. Version & Changelog

- Bump `VERSION` from `0.15.1` → `0.16.0` (new feature)
- Add changelog entry under `## [0.16.0] - 2026-02-24`

---

## Files to Modify/Create

### Backend
1. `backend/app/models/card_type.py` — Add `has_successors` column
2. `backend/alembic/versions/039_add_has_successors.py` — **New** migration
3. `backend/app/api/v1/metamodel.py` — Expose `has_successors` in CRUD
4. `backend/app/services/seed.py` — Fix dedup + add relation types + set flags

### Frontend
5. `frontend/src/types/index.ts` — Add `has_successors` to CardType
6. `frontend/src/features/cards/sections/SuccessorsSection.tsx` — **New** component
7. `frontend/src/features/cards/sections/index.ts` — Export new section
8. `frontend/src/features/cards/CardDetailContent.tsx` — Wire up section
9. `frontend/src/features/admin/metamodel/TypeDetailDrawer.tsx` — Toggle
10. `frontend/src/features/admin/MetamodelAdmin.tsx` — Create dialog + chip
11. `frontend/src/features/admin/CardLayoutEditor.tsx` — Section config
12. `frontend/src/i18n/locales/{en,de,fr,es,it,pt,zh}/admin.json` — 4 new keys × 7 locales
13. `frontend/src/i18n/locales/{en,de,fr,es,it,pt,zh}/cards.json` — ~16 new keys × 7 locales
14. `VERSION` — Bump to 0.16.0
15. `CHANGELOG.md` — Add entry

---

## Translation Values for Seed Relation Types

**Label**: "succeeds"
| Locale | Translation |
|--------|-------------|
| de | folgt auf |
| fr | succède à |
| es | sucede a |
| it | succede a |
| pt | sucede a |
| zh | 继承 |

**Reverse label**: "is preceded by"
| Locale | Translation |
|--------|-------------|
| de | wird abgelöst durch |
| fr | est précédé par |
| es | es precedido por |
| it | è preceduto da |
| pt | é precedido por |
| zh | 被继承 |
