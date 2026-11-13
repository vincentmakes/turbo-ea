# Cost report: small refinements

**Status:** draft, 2026-11-13. Branch `fix/cost-report-refinements` (from `origin/main`). Refinements are added to
this list as the user gives them; the spec is reviewed by a fresh agent and approved once, when the list is
closed. Not code that fails: polish of a report that works.

**Rule for the upstream sync (decided 2026-11-13):** the fork's cost report wins every conflict with upstream;
Initiatives are not in it any more (an ad hoc report comes later). Merge this branch into `main` before the
sync plan is written.

## 1. Card type: two toggle buttons instead of a drop-down

**Today.** `frontend/src/features/reports/CostReport.tsx` (~line 1321) shows a `TextField select` labelled
"Card Type" with up to three options built in `typeOptions` (~line 342): `Application`, `IT Component`, and
`Application + IT Component` (`COMBINED_KEY`, only when the user may read both types).

**Wanted (the user's words, 2026-11-13):** instead of the combo box, a selector like the toggle controls of the
BPM navigator, with two choices, Application and IT Component.

**Design (agreed in chat).** A multi-select MUI `ToggleButtonGroup` with two buttons, `Application` and
`IT Component`, in the same toolbar slot:
- only Application on → `cardTypeKey = "Application"`; only IT Component on → `"ITComponent"`; both on →
  `COMBINED_KEY`. The state stays the single string `cardTypeKey`, so saved reports, the print parameters, the
  scope filter and every request keep working unchanged.
- never zero buttons on: pressing the only active button does nothing.
- a type the user may not read (`useReadableCardTypes("module")`) is not offered; with one readable type there is
  one button, always on (or no group at all: the builder's call).
- the labels are the existing type labels (`useTypeLabel`), the group has an accessible name from the existing
  `cost.cardType` key; `cost.combinedType` stays in use for the chart title / saved-report label where it already
  is. Remove it only if nothing else reads it.
- a saved report restores through the same `cardTypeKey` path, including a report saved with `COMBINED_KEY`.

**Non-goals.** No change to the data, the endpoints or the other filters; no new key if the existing labels
suffice; the "All cards" scope chip behaves as today (hidden when combined).

**Tests owed.** Next to `CostReport.test.tsx`: each state maps to the right `cardTypeKey` and request `type`
param (Application, ITComponent, both); the last active button cannot be turned off; a user who may read only
one of the types sees one choice; a saved report with `COMBINED_KEY` reopens with both buttons on.

## Open list

Further refinements go here, one section each, as the user gives them.
