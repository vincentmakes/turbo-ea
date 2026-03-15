# Plan: Architect Flow Improvements

## 1. Move Objective + Capability Selection to Phase 0 (Business Requirements)

Currently objectives are selected at the end of Phase 2. Move them to Phase 0 alongside the requirement input, creating a proper "Business Requirements" phase.

### Backend Changes

**New endpoint: `GET /archlens/architect/capabilities`** in `backend/app/api/v1/archlens.py`
- Searches `BusinessCapability` cards (type = "BusinessCapability", not archived)
- Returns `{id, name, description}` like the objectives endpoint
- Accepts optional `?search=` query parameter

**Update `ArchLensArchitectRequest`** in `backend/app/schemas/archlens.py`
- Add `selected_capabilities: list[dict] | None = Field(None, alias="selectedCapabilities")`
- Each capability dict: `{id: str, name: str, isNew: bool}`

**Update Phase 1 prompt** in `archlens_architect.py`
- Accept `objective_ids` and `selected_capabilities` parameters
- Load objective context + format capabilities context
- Include in Phase 1 prompt so AI tailors questions around these

**Thread capabilities through all subsequent phases**
- Pass `selected_capabilities` to Phase 2, 3a, 3b, Phase 5
- Phase 5 already receives objectives; now also gets the user-selected capabilities so it knows which ones are existing vs new

### Frontend Changes (`ArchLensArchitect.tsx`)

**Phase 0 UI expansion** — after the requirement TextField:
1. Objective selection Autocomplete (moved from Phase 2)
2. Capability selection: Autocomplete with `freeSolo` — user can pick existing BusinessCapability cards OR type new ones
3. Store in session state: `selectedObjectives`, `selectedCapabilities: {id, name, isNew}[]`
4. "Generate Questions" button requires: requirement text + at least 1 objective

**Remove from Phase 2**: The objective selection Paper block (lines ~1293-1348) and the `selectedObjectives.length === 0` disable condition on the Phase 2 submit button.

**Pass to all API calls**: Include `objectiveIds` and `selectedCapabilities` in Phase 1, 2, 3a, 3b, and 5 payloads.

### Session State Changes
- Add `selectedCapabilities` to `ArchSession` interface
- Initialize from saved session on mount
- Persist via `saveSession()`

---

## 2. Fix Phase 5 Naming Issues (Hallucinated Card Names)

The core problem: the AI invents card names like "HubSpot Enhanced" instead of referencing the existing "HubSpot Marketing", and creates verbose DataObject names like "Enriched Lead Data" instead of clean domain concepts like "Lead".

### Root Cause
The compact landscape context only lists card names (up to 10 per type). The AI doesn't have the full card list for matching, especially for DataObjects and Applications. Additionally, the prompt doesn't tell the AI to reuse existing card names or use clean domain naming.

### Fix: Expand the context + add naming rules

**In `phase3_capability_mapping`** (`archlens_architect.py`):

1. **Load ALL existing cards** (not just the dependency subgraph) for the relevant types. Add a helper `_load_existing_cards_context()` that queries all non-archived cards of types Application, DataObject, Interface, ITComponent, BusinessCapability and formats them as a lookup list:
   ```
   === ALL EXISTING CARDS (use these names — do NOT invent variants) ===
   [Application]: HubSpot Marketing, NexaCore ERP, Salesforce CRM, ...
   [DataObject]: Customer, Order, Product, Lead, ...
   [Interface]: SAP-HubSpot API, ...
   ```

2. **Add strict naming rules to the prompt**:
   - Rule: "If an existing card matches what you need (same product, same concept), reference it by its EXACT existing name and mark isNew: false. Do NOT create variants like 'X Enhanced' or 'X Extended'."
   - Rule: "For DataObjects, use clean domain entity names (e.g. 'Lead', 'Customer', 'Order'), NOT descriptive phrases like 'Enriched Lead Data' or 'Customer Profile Data'."
   - Rule: "If you need a card that extends or enhances an existing system, reference the EXISTING card and explain the enhancement in the rationale field."

3. **Feed user-selected capabilities** into the prompt so the AI uses those exact names for BusinessCapability cards.

---

## 3. Redesign UI Progress Indicator

Replace the simple chip row with a proper horizontal stepper grouped into named phases.

### Phase Structure

```
Business Requirements → Business Fit → Technical Fit → Solution Architecture → Target Architecture
     (Phase 0)          (Phase 1)      (Phase 2)       (3a, 3b, 3c)              (Phase 5)
```

Detailed sub-phases within Solution Architecture:
- Solution Options (3a)
- Products (3b/gaps)
- Dependencies (3c)

### Implementation

**Replace `ARCHITECT_PHASES` constant** in `utils.ts` with a structured step definition:
```typescript
export const ARCHITECT_STEPS = [
  { key: "requirements", phases: [0] },
  { key: "business_fit", phases: [1] },
  { key: "technical_fit", phases: [2] },
  { key: "solution", phases: [3, 3.5, 4] },
  { key: "target", phases: [5] },
] as const;
```

**Replace the Chip row** with a MUI `Stepper` component (horizontal, non-linear):
- Each step shows the group label (translated)
- Active step is determined by mapping current `archPhase` to the step group
- Completed steps show a checkmark
- Within "Solution Architecture", show sub-step indicator (Options / Products / Dependencies)

### i18n Keys (all 8 locales)

Add new keys to `admin.json`:
- `archlens_architect_step_requirements`: "Business Requirements"
- `archlens_architect_step_business_fit`: "Business Fit"
- `archlens_architect_step_technical_fit`: "Technical Fit"
- `archlens_architect_step_solution`: "Solution Architecture"
- `archlens_architect_step_target`: "Target Architecture"
- `archlens_architect_select_capabilities`: "Which business capabilities are we improving or introducing?"
- `archlens_architect_capabilities_hint`: "Search existing capabilities or type new ones..."
- `archlens_architect_search_capabilities`: "Search capabilities..."
- `archlens_architect_new_capability`: "New: {{name}}"

Translate all into de, fr, es, it, pt, zh, ru.

---

## Files Changed

### Backend
- `backend/app/schemas/archlens.py` — add `selected_capabilities` field
- `backend/app/api/v1/archlens.py` — add capabilities endpoint, thread params through phase endpoints
- `backend/app/services/archlens_architect.py` — add cards context loader, update Phase 1/5 prompts, add naming rules, thread capabilities

### Frontend
- `frontend/src/features/archlens/ArchLensArchitect.tsx` — move objectives to Phase 0, add capabilities, new stepper UI
- `frontend/src/features/archlens/utils.ts` — replace ARCHITECT_PHASES with ARCHITECT_STEPS
- `frontend/src/i18n/locales/{en,de,fr,es,it,pt,zh,ru}/admin.json` — new keys

### No migrations, no model changes, no new files.
