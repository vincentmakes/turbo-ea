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

## 2. Fiscal year: a green Time Travel row instead of the drop-down and the chip

**Today.** The toolbar has a `Fiscal year` drop-down (options from `costFiscalYearOptions(currentFiscalYear)` in
`frontend/src/lib/fiscalYear.ts`: the current fiscal year plus one forecast year ahead and four past ones,
e.g. FY27 - Forecast, FY26 - Current, FY25 ... FY22), and below it a chip "Fiscal year: FY27 - Forecast".
State: `fiscalYearParam` (`number | null`) in `CostReport.tsx`, also saved in a saved report's config and sent as
`fiscal_year` to the report endpoints.

**Wanted (the user's words, 2026-11-13):** instead of the selector and the "Fiscal year: ..." label, a Time Travel
control like the Application Portfolio's (`/reports/portfolio`), but moving **only across the fiscal years**, in
**green**, placed **between the filter row and the summary tiles** (where the portfolio puts its row).

**Design.**
- Remove the `Fiscal year` drop-down and the chip. In their place, one full-width row between the toolbar
  filters and the KPI tiles: a "Time Travel" label with the selected fiscal year's name (the existing
  `costFiscalYearName` text, e.g. `FY26 - Current`), previous / next step buttons, and a track whose steps are
  exactly the fiscal years of `costFiscalYearOptions(...)`, oldest on the left, forecast year on the right, each
  step labelled `FYnn`.
- Same state, same data: choosing a step sets `fiscalYearParam` through the same path as the drop-down did
  (including the "current year" case that is stored as `null`, if that is how it works today: the builder keeps
  the existing semantics), so saved reports, the print parameters, the `fiscal_year` request parameter and the
  forecast banner/flag (`showForecast`) keep working unchanged.
- The colour is green (the cost report's accent, the same as its icon and the `Total Cost` tile border): use the
  design token, no hex (`frontend/src/theme/tokens.ts`; the builder picks the matching token).
- Reuse, do not copy: `components/TimelineSlider.tsx` is date-based (milliseconds, year marks, transition
  milestones). The builder chooses between a discrete-steps mode on that component or a small dedicated
  component that reuses its look; either way no behaviour of the portfolio's slider changes (its tests stay
  green unchanged).
- Keyboard and screen readers: the track is a slider with arrow-key steps and a text value (`aria-valuetext` =
  the fiscal year name); the step buttons have labels; RTL is honoured through `useIsRtl()` like the existing slider.

**Non-goals.** No new data, no change to which years exist, no milestone marks under the track (the portfolio's
coloured transition marks do not apply to costs), no free date picking.

**Tests owed.** Next to the new component and `CostReport.test.tsx`: the steps are exactly the fiscal year options
in order; selecting a step, the next / previous buttons and the arrow keys change `fiscalYearParam` and the
request's `fiscal_year`; the first step disables "previous" and the last disables "next"; a saved report restores
its year onto the slider; the selected year's name is announced (`aria-valuetext`).

## Open list

Further refinements go here, one section each, as the user gives them.
