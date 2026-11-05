---
title: A milestone field must remember that Date was chosen until a date arrives
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 30, tokens: 297923 }
id: l-4e5e7086
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/CustomEolProductDialog.tsx
---

## Decided
The EOL milestone picker (support / end of life: a date, "still going", "already over" or not set) keeps a local "Date was chosen" flag. Its mode was derived from the stored value alone, and choosing Date stores null until a date is typed, so the picker read "Not set" again and never showed the date input. No date could be entered from "Not set" or from a yes/no answer, in the create dialog, the add-cycle dialog or the grid's cell editor. Mutation tests on the date branch exposed it; a stateful test harness confirmed it.

## Watch out
Any control whose mode is computed from a value that stays empty in one of its modes has this trap. Test it with a stateful parent (useState), never with a fixed `value` prop: a fixed prop hides it.

In the code: `MilestoneField` in frontend/src/components/CustomEolProductDialog.tsx (`datePicked`); regression tests in CustomEolProductDialog.test.tsx ("choosing Date") and EolCycleCellEditor.test.tsx.
