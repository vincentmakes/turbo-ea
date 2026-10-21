---
title: "A metamodel save re-scores every card of the type: keep it O(1) queries and lock the control while it runs"
author: Claude
date: 2026-10-21
branch: feat/relations-richer-data
cost: { minutes: 45, tokens: 200493 }
touches:
  - CHANGELOG.md
  - frontend/src/features/admin/CardLayoutEditor.test.tsx
  - frontend/src/features/admin/CardLayoutEditor.tsx
  - frontend/src/features/admin/GroupTranslationsDialog.test.tsx
  - frontend/src/features/admin/metamodel/DataQualityPanel.test.tsx
  - frontend/src/features/admin/metamodel/DataQualityPanel.tsx
  - frontend/src/features/admin/metamodel/FieldEditorDialog.test.tsx
  - frontend/src/features/admin/metamodel/FieldEditorDialog.tsx
  - frontend/src/features/admin/metamodel/ImportanceSlider.tsx
  - frontend/src/features/admin/metamodel/TypeDetailDrawer.test.tsx
---

## Decided
- `PATCH /metamodel/types/{key}` re-scores every ACTIVE card of the type whenever `_scoring_signature` moves (field weights or required flags, `section_config` incl. the data-quality weights and the layout order, subtype `hidden_fields` / `optional_relations`); the stakeholder-role routes do the same. The rescore must stay a fixed number of statements: `card_completeness.load_mandatory_config` (per type) + `load_link_facts` (per chunk, three queries) + pure `evaluate`, and `data_quality.load_scoring_context` + `load_scoring_facts` + pure `score_card`. `missing_mandatory` and `calc_data_quality` are the single-card compositions of the same pieces, so there is one scoring definition. Guard: `test_data_quality.py` pins that 10 and 100 cards cost the same statement count (11 with two mandatory sides, one tag group and one counting role; it was 971 for 100 cards).
- Every type-level write in the card-type editor runs one at a time behind a saving state: `runTypePatch` + `mutating` in `TypeDetailDrawer`, `LayoutSaveContext` in `CardLayoutEditor`, a `savingRef` in `DataQualityPanel`. A dialog that is saving ignores `onClose`, disables Cancel, and shows its failure inside itself, never on the drawer behind the modal. Confirmations stay open until the write lands.

## Tried and ruled out
- Fixing only the subtype template dialog: the same PATCH latency sat behind the field editor, both delete confirmations, the hide toggle, the data-quality sliders and the layout editor, so the double-click would have reappeared on the next one a user hit.
- Moving the rescore to a background task: it would have changed the "re-scores straight away" contract and the tests on `card_update_sql`; batching made it fast enough to stay inline.

## Watch out
- The symptom reads as "I have to click Save twice": the first click's PATCH is still in flight (seconds on a remote database) with no feedback, the second lands while it runs, and the dialog closes when the first resolves. Measure the statement count before assuming a UI bug.
- A ref, not state alone, is the re-entry guard: a second click can land before the re-render that disables the button.
- `user-event` refuses to click a control with `pointer-events: none`; a test that wants to prove a locked control ignores a click uses `fireEvent.click`.
