---
title: "Metamodel editor ergonomics (#1286 #1291 #1292 #1297): what the work settled"
author: Claude
date: 2026-10-21
branch: feat/metamodel-editor-ergonomics
touches:
  - backend/app/api/v1/metamodel.py
  - frontend/src/features/admin/CardLayoutEditor.tsx
  - frontend/src/features/admin/CardLayoutEditor.test.tsx
  - frontend/src/features/admin/metamodel/FieldEditorDialog.tsx
  - frontend/src/features/admin/metamodel/TypeDetailDrawer.tsx
  - frontend/src/lib/optionOrder.ts
---

## Decided
- Field help text is core (#1297): `_enforce_field_gating` only downgrades a new or changed `ext.*` type now; `metamodel.field_help` stays in `VALID_GRANTS` / `teax.py` as a no-op so old manifests lint. `useExtensionCapabilities` has no component consumer left (kept for the next gated capability).
- Stored `multiple_select` values render in option order through ONE helper, `orderByOptions` (`lib/optionOrder.ts`), used by card detail (view + edit chips) and the Inventory's `optionChipItems`. Unknown keys go last, stable.
- Option rows in `FieldEditorDialog` are keyed by a transient `_rowId` (stripped on save like `_original`): `key={idx}` would leave `KeyInput`'s internal `touched` state on the old index after a reorder.
- Subtype rename is a pencil beside the chip in `TypeDetailDrawer`, not inside the template dialog: the dialog's Save writes `hidden_fields` from the `cardTypeKey` prop, so an immediate rename PATCH there would race the refresh and could write the old label back. Escape must `stopPropagation()` or the drawer (a Modal) closes too.
- `SortableGroupCard` registered `useSortable` AND `useDroppable` under the same id; the later registration wins in dnd-kit, so the group's droppable rect was its body only. Removed the duplicate; the card root is the droppable now.

## Watch out
- `CardLayoutEditor.test.tsx`'s `stubLayout()` gives each element its own non-overlapping band and does not nest a container's rect around its children. Moving the group droppable from body to root changed how many ArrowDown/ArrowUp steps a keyboard drag needs; the step counts in those tests are stub artefacts, explained in comments. The Ungrouped zone joins the stub via `data-ungrouped-drop`.
- An empty column is a zero-size rect in that stub, which is how "a drop with nothing underneath" is reached now (the empty group's body used to be).
