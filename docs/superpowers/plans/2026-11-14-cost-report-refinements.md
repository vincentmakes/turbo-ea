# Cost report refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three polish items on the cost and licensing screens: two toggle buttons for the card type, a green fiscal-year Time Travel row in both reports, and in a card's Costs section the same row plus one stacked bar per fiscal year with a tooltip that is no longer clipped.

**Architecture:** `TimelineSlider` gets a purely additive discrete-steps mode; a thin wrapper `FiscalYearTimeTravel` turns a list of fiscal years into that mode and is the one control used by the two reports and the two card sections. The Costs section's single bar becomes a new pure option builder with one category per year. All frontend, no backend, no migration.

**Tech Stack:** React 19, MUI 6, ECharts 6 (`EChart` wrapper), Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-11-13-cost-report-refinements-design.md` (read it with this plan).

## Global Constraints

- `TimelineSlider` is exposed to extensions (`loadTimeline` in `lib/extensionHost.tsx`) and `UI_SDK_VERSION` is frozen at 1.19, never bumped: the change is **additive only**, every new prop optional, defaults equal to today, the portfolio / capability / dependency reports and `TimelineSlider.test.tsx` unchanged and green.
- The fiscal-year state stays `fiscalYearParam: number | null` (`null` = current year) in both reports; the request param `fiscal_year`, saved reports and print params are unchanged.
- Colour: the design token `RAG_COLORS.green` (`frontend/src/theme/tokens.ts`), no hex.
- Year labels in the bars and the Time Travel steps: `shortFiscalYear(fy)` from `@/lib/costItems` (`FY27`); the long name is `costFiscalYearName(fy, currentFy)` from `@/lib/fiscalYear`.
- Unselected year bars at opacity 0.45, an unconfirmed (carried-forward) year at 0.55, they do not multiply: the lowest wins; confirmed selected year 1.
- English only in `frontend/src/i18n/locales/en/*.json`; the nine other locales through `/translate` before the PR.
- `cost.fiscalYearHelp` and the chip keys `cost.fiscalYearIndicator`, `licensing.fiscalYearIndicator` are removed with no replacement (user, 2026-11-14).
- No hardcoded colours, `useIsRtl()` for anything ECharts or MUI sliders do not mirror themselves, field labels static (no `shrink`).
- Run `cd frontend && npx tsc --noEmit -p . && npx eslint <touched files>` before each commit. Do not run mutation tests locally.

## Review Focus

- A saved report whose `fiscalYearParam` is not among the steps (older than four years back): falls back to current, as `adoptCurrentFiscalYear` does today. Test in Task 4.
- A user who may read only one of Application / IT Component: one button, always on, never an empty selection. Task 3.
- A fiscal year with no cost items: the bar row, its label and `0 €` still appear in the card section. Task 6 and 7.
- Licensing offers no forecast year (`yearOptions` filters `currentFiscalYear + 1`): its steps stop at the current year. Task 5.
- RTL: the bars axis and the slider step order mirror. Task 6 (option `inverse`) and Task 1.
- The fallback year (no confirmed items) shows its faded items in its bar and the Alert still appears. Task 7.

---

### Task 0: Start from `main`

- [ ] **Step 1:** `git fetch origin && git merge origin/main` on `fix/cost-report-refinements` (PR #70, the upstream sync, is already in `origin/main`; the code files this plan touches did not change there, only `en/reports.json`, `en/ppm.json`, `tokens.ts`). Resolve any conflict by keeping both sides.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit -p .`. Expected: clean.

### Task 1: `TimelineSlider` discrete-steps mode

**Files:**
- Modify: `frontend/src/components/TimelineSlider.tsx`
- Test: `frontend/src/components/TimelineSlider.test.tsx` (add a `describe("steps mode")`, change no existing test)

**Interfaces:**
- Produces: new optional props on `TimelineSlider`:
  - `steps?: { value: number; label: string }[]`: when set (length >= 2) the slider is discrete. `value` is one of `steps[i].value`; `onChange(v)` receives a step value.
  - `accentColor?: string`: replaces the past / future / primary accent.
  - `valueText?: string`: the read-out and `aria-valuetext`.
  - `previousLabel?: string`, `nextLabel?: string`: the step buttons' accessible names and tooltips (default: today's `timelineSlider.prevChange` / `nextChange`); `ariaLabel?: string` on the slider.
  `dateRange` and `yearMarks` stay required: a steps caller passes `dateRange={{ min: first, max: last }}` and `yearMarks={[]}`; they are ignored in steps mode.

- [ ] **Step 1: Write failing tests** in `TimelineSlider.test.tsx`:
  - `renders one labelled mark per step, none thinned`: steps `[{value:2022,label:"FY22"},…,{value:2027,label:"FY27"}]`; every label is in the document.
  - `moves only between steps`: focus the slider, ArrowRight calls `onChange(2023)` from 2022, ArrowLeft from the first step calls nothing new.
  - `step buttons walk the steps and disable at the ends`: buttons named by `timelineSlider.prevChange` / `nextChange` are present in steps mode; previous is disabled on the first step, next on the last; a click calls `onChange` with the neighbour.
  - `step buttons and the slider take their labels from props` (`previousLabel`, `nextLabel`, `ariaLabel`); `shows valueText and exposes it as aria-valuetext`: `valueText="FY26 - Current"` is visible and `getByRole("slider")` has `aria-valuetext="FY26 - Current"`.
  - `uses accentColor and hides the today chips`: with `accentColor="#00aa00"` the thumb colour is that value; no "Reset to today" chip and no past / future chip in steps mode.
  - `without steps nothing changes`: an existing-style render (no new props) matches the old behaviour (the existing suite covers it; add one assertion that no `aria-valuetext` is set).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/components/TimelineSlider.test.tsx`. Expected: the new tests FAIL, the old ones pass.
- [ ] **Step 3: Implement in `TimelineSlider.tsx`.** In steps mode `value` goes straight to the `Slider` (not through `thumbValue` / `cappedRange`, which are millisecond maths), and `isAway`, `isPast`, `isFuture` are forced false; the root `Box` drops `maxWidth: 560` (a steps row is as wide as its parent). Add the three props to `TimelineSliderProps` with doc comments. In steps mode: MUI `Slider` with `min` / `max` = first / last step value, `step={null}`, `marks` = the steps (all labelled), `onChange` passes the value as is (no `snapToCluster`), `valueLabelDisplay="off"`, `getAriaValueText={() => valueText ?? label}`; the previous / next buttons (existing `stepButtonSx`, RTL-aware chevrons) move to the neighbouring step; read-out = `valueText ?? the step label`; `accent = accentColor ?? primary` and the past / future / reset chips, milestones and delta are not rendered. Keep every hook called unconditionally (branch in the render and in the values the hooks return).
- [ ] **Step 4: Run** the same command. Expected: all PASS. Also `npx vitest run src/components/TimelineSlider src/features/reports/PortfolioReport src/features/reports/CapabilityMapReport src/features/reports/DependencyReport src/lib/extensionHost` to confirm every other user of the slider is unchanged.
- [ ] **Step 5: Commit** `feat(timeline): an optional discrete-steps mode for TimelineSlider`.

### Task 2: `FiscalYearTimeTravel`

**Files:**
- Create: `frontend/src/components/FiscalYearTimeTravel.tsx`, `frontend/src/components/FiscalYearTimeTravel.test.tsx`

**Interfaces:**
- Consumes: Task 1 props; new `common` keys (English, in `en/common.json`): `fiscalYearTimeTravel.label` "Fiscal year", `.previous` "Previous fiscal year", `.next` "Next fiscal year"; `shortFiscalYear` (`@/lib/costItems`), `costFiscalYearName` (`@/lib/fiscalYear`), `RAG_COLORS` (`@/theme/tokens`).
- Produces: `export default function FiscalYearTimeTravel(props: { years: number[]; currentFy: number; value: number; onChange: (fy: number) => void; servedYear?: number })` (no explicit return type: `@types/react` 19 has no global `JSX`) where `years` is ascending (oldest first), `value` is the selected fiscal year (never null: callers pass `fiscalYearParam ?? currentFy`). Renders `TimelineSlider` in steps mode with `steps = years.map(fy => ({ value: fy, label: shortFiscalYear(fy) }))`, `valueText = costFiscalYearName(servedYear ?? value, currentFy)` (the year the server answered, when the caller has it), `accentColor = RAG_COLORS.green`, `dateRange` / `yearMarks` as Task 1 says. Full width of its parent (Task 1 drops the 560 px cap in steps mode); passes `previousLabel` / `nextLabel` / `ariaLabel` from the new keys.

- [ ] **Step 1: Failing tests:** `steps are exactly the given years in order` (labels `FY22`…`FY27`); `announces the long name` (`aria-valuetext` = `FY26 - Current` when `currentFy` is 2026 and `value` 2026, `FY27 - Forecast` for 2027); `selecting a step calls onChange with the fiscal year` (arrow key and the next button); `the first year disables previous and the last disables next`.
- [ ] **Step 2: Run** `npx vitest run src/components/FiscalYearTimeTravel.test.tsx`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the component as specified, 25 lines, no state. With fewer than 2 `years` it renders nothing (a one-step slider has min == max; the real lists always have 5 or 6 years, so this is only a guard; test `renders nothing with fewer than two years`).
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): FiscalYearTimeTravel, a green fiscal-year Time Travel row`.

### Task 3: Card type as two toggle buttons (`CostReport.tsx`)

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx` (the `TextField select` ~1322; **keep** the `typeOptions` memo ~344: the fallback effect ~495 and `printParams` ~1004 still read it, combined entry included)
- Test: `frontend/src/features/reports/CostReport.test.tsx`, `CostReport.branches.test.tsx` (the "card type" combo box assertions ~718, 731, 805 become toggle-button assertions)

**Interfaces:**
- Produces: a multi-select MUI `ToggleButtonGroup` (aria-label from `t("cost.cardType")`) with buttons `Application` and `IT Component` (labels from `typeLabel`), mapping onto the existing `cardTypeKey`: only Application → `"Application"`, only IT Component → `"ITComponent"`, both → `COMBINED_KEY`. A type the user may not read is not offered; with one readable type one button, always on.

- [ ] **Step 1: Failing tests** in `CostReport.test.tsx` (use the file's existing mocks): `only Application on requests type Application`; `only IT Component on requests ITComponent`; `both on requests the combined type`; `the last active button cannot be turned off` (click it, selection unchanged); `a user who may read only one type sees one button`; `a saved report with the combined key reopens with both buttons on`.
- [ ] **Step 2: Run** `npx vitest run src/features/reports/CostReport.test.tsx -t "toggle"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Render the group from the Application and IT Component entries of `typeOptions` (the entries whose key is not `COMBINED_KEY`), derive the pressed set from `typeKeysOf(cardTypeKey)`, and map the new set back to the key (ignore an empty set). `typeOptions` keeps its combined entry, so the fallback effect and `printParams` (which prints `cost.combinedType`'s label) are untouched; do not delete `cost.combinedType`.
- [ ] **Step 4: Run** the whole `CostReport*.test.tsx`. Expected: PASS (rewrite assertions that looked for the "Card Type" combo box).
- [ ] **Step 5: Commit** `feat(cost): card type as toggle buttons in the cost report`.

### Task 4: Fiscal-year Time Travel row in the cost report

**Files:**
- Modify: `frontend/src/features/reports/CostReport.tsx` (drop-down and chip ~1420-1455; insert the row before `{/* Summary strip */}`), `frontend/src/i18n/locales/en/reports.json` (remove `cost.fiscalYearHelp`, `cost.fiscalYearIndicator`)
- Test, all in `frontend/src/features/reports/`: `CostReport.test.tsx` (the helpers `openPicker` / `optionNames` / `pick` ~296-313 and the ~15 tests that use them ~319-470 and ~717-790 move to the slider; the "offers no year picker" test ~380-384, which asserts there is no `.MuiSlider-root`, is inverted; the chip tooltip test ~319-334 is deleted, its text no longer exists); `CostReport.mutation.test.tsx` (~364-387 rewritten: the row names the year the response served; ~389-395 chip tooltip deleted); `LicensingReport.test.tsx:155` belongs to Task 5

**Interfaces:**
- Consumes: `FiscalYearTimeTravel` (Task 2). Years = `fiscalYearOptions` mapped to `value ?? currentFiscalYear`, ascending; `value = fiscalYearParam ?? currentFiscalYear`, `servedYear = fiscalYear?.year`, and the row renders only once the first response has set `fiscalYear` (no jump of the steps from the browser's year to the server's `current_fiscal_year`); `onChange(fy)` sets `fiscalYearParam` to `null` when `fy === currentFiscalYear`, else `fy` (the old drop-down's semantics).

- [ ] **Step 1: Failing tests:** `the steps are the fiscal year options in order`; `choosing a step sets the request fiscal_year` (a past year sends `fiscal_year`, the current year sends none); `previous/next and the arrow keys change the year`; `a saved report restores its year onto the slider`; `a saved year older than the steps falls back to current` (Review Focus 1); `the forecast year shows the forecast banner as before`; `the old drop-down and the chip are gone` (no "Fiscal year:" text, no `cost-fiscal-year` test id).
- [ ] **Step 2: Run** the file; the new tests FAIL.
- [ ] **Step 3: Implement** as above; delete `fiscalYearHelp` usage and the `Chip`/`Tooltip` imports if unused; delete the two en keys.
- [ ] **Step 4: Run** `CostReport*.test.tsx` + `npx vitest run src/features/reports`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cost): fiscal year as a green Time Travel row`.

### Task 5: The same row in the licensing report

**Files:**
- Modify: `frontend/src/features/reports/LicensingReport.tsx` (drop-down and chip ~752-780; the row goes at the top of the report body, outside the `data &&` tiles block, before the error Alert, and renders once `data` has answered; `yearOptions` ~220), `frontend/src/i18n/locales/en/reports.json` (remove `licensing.fiscalYearIndicator`)
- Test: `frontend/src/features/reports/LicensingReport.test.tsx`

**Interfaces:**
- Consumes: Task 2 with `years` = `yearOptions` (which already excludes the forecast year) mapped as in Task 4; same `fiscalYearParam` semantics; the `restoredYear` ref is reset on a user pick exactly as the drop-down's handler did.

- [ ] **Step 1: Failing tests:** `the steps stop at the current year` (no forecast step); `choosing a step changes the request year`; `the drop-down and the chip are gone`; `a restored year outside the steps falls back` (the existing `restoredYear` behaviour).
- [ ] **Step 2: Run** `npx vitest run src/features/reports/LicensingReport.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** and remove the chip key.
- [ ] **Step 4: Run** the same file. Expected: PASS.
- [ ] **Step 5: Commit** `feat(licensing): fiscal year as a green Time Travel row`.

### Task 6: Tooltip fix and the per-year bars option builder

**Files:**
- Create: `frontend/src/features/cards/sections/costsYearBarsOption.ts` (+ `.test.ts`); delete `costsStackedBarOption.ts` and its test once Task 7 has no user of it (do both in Task 7's commit if the delete breaks the build here)
- Modify: `frontend/src/features/cards/sections/licensingBarOption.ts` (+ its test)

**Interfaces:**
- Produces: `export interface CostYearBar { fiscalYear: number; label: string; confirmed: boolean; segments: { key: string; label: string; amount: number; color: string }[]; total: number }` and `export function buildCostsYearBarsOption(bars: CostYearBar[], selectedFy: number, o: { chrome: EChartsChrome; isRtl: boolean; format: (v: number) => string }): EChartsCoreOption`. `bars` are given forecast first (the order shown top to bottom). The option: one category per bar (the short label at the left, the formatted `total` at the right of the bar), one series per distinct item key stacked, per-bar values, a year without items drawn as an empty row. Per-data opacity: selected confirmed 1, selected unconfirmed 0.55, not selected 0.45 (lowest wins when both apply). A very light tint behind the selected row and a medium-weight label and value for it. `tooltip(ctx, { trigger: "item", confine: false, appendTo: "body", zIndex: 2000, valueFormatter })` so it is never clipped. Mechanics (the builder takes `tintColor: string` in its options, the caller passes `RAG_COLORS.green` with alpha, since `EChartsChrome` has no success colour): `yAxis` is `type: "category", inverse: true` so the first bar (forecast) is on top; the total is a last, transparent stacked series of value 0 whose per-datum `label` (`position: "right"`, formatter = the formatted total) sits at the end of the bar, so an empty year still shows `0 €`; the tint is a silent `markArea` on that series spanning the selected category; the selected label is bolder through the axis label's `rich` style; rounded ends are set per data item on the first and last non-zero segment of each row (mirrored in RTL), inner segments square.
- `buildLicensingBarOption` gets the same tooltip override (`confine: false`, `appendTo: "body"`).

- [ ] **Step 1: Failing tests** in `costsYearBarsOption.test.ts`: `one category per bar in the given order, short label`; `segments carry each year's items and colours`; `a year with no items is an empty row with its label and a 0 total`; `the selected year is full opacity and the others 0.45`; `an unconfirmed selected year is 0.55 and an unconfirmed other year stays 0.45` (the lowest wins); `the tint exists only for the selected year and follows a change`; `the first bar is on top (yAxis.inverse) and an empty year's total label reads the formatted 0`; `tooltip.confine is false and tooltip.appendTo is body`; `RTL inverts the value axis`. In `licensingBarOption.test.ts`: `its tooltip is not confined and is appended to body`.
- [ ] **Step 2: Run** `npx vitest run src/features/cards/sections/costsYearBarsOption.test.ts src/features/cards/sections/licensingBarOption.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both. Pure functions, no React.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cards): per-year cost bars option and an unclipped tooltip`.

### Task 7: Costs section: Time Travel row and one bar per year

**Files:**
- Modify: `frontend/src/features/cards/sections/CostsSection.tsx` (stepper ~150-165, the single bar ~204), delete `costsStackedBarOption.ts` / `.test.ts`, `frontend/src/i18n/locales/en/cards.json` (remove `costs.previousYear` / `costs.nextYear`, replaced by the new `common` keys)
- Test: `frontend/src/features/cards/sections/CostsSection.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`years` = the response's `data.years` fiscal years, ascending; `value` = the selected year), Task 6 (`bars` built from every `data.years` entry, reversed so the forecast is on top; `colorOf` / `labelOf` as today).

- [ ] **Step 1: Failing tests:** `shows one bar row per fiscal year, forecast on top`; `an empty year still has its row, label and 0`; `choosing a year highlights its bar and dims the others` (option passed to the chart, selected index full); `the TCO and the tiles show the selected year only`; `the confirm banner and the fallback items still work` (Review Focus 6); `the chart wrapper does not clip` (no `overflow: hidden` on the box around the chart); `the old stepper arrows are gone`.
- [ ] **Step 2: Run** `npx vitest run src/features/cards/sections/CostsSection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the stepper with `FiscalYearTimeTravel` (selected year state stays `picked`), build `bars` with `useMemo`, render `EChart` with height `bars.length * 22`, remove the `overflow: "hidden"` wrapper (keep the 14 px-bar look through the series' own `borderRadius`), keep everything below the chart. The chart leaves the `year.items.length > 0 ?` conditional: it is always drawn (a new card shows its rows at `0 €`), and the existing "no cost items" text and the tiles stay conditional on the selected year's items.
- [ ] **Step 4: Run** `npx vitest run src/features/cards`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cards): Costs section with a Time Travel row and a bar per fiscal year`.

### Task 8: Licensing section: Time Travel row, no per-year bars

**Files:**
- Modify: `frontend/src/features/cards/sections/LicensingSection.tsx` (stepper ~360-380 inside the flex row that also holds the model chips and `editModelButton`: the Time Travel row becomes a row of its own above that one), `frontend/src/i18n/locales/en/cards.json` (remove `licensing.previousYear` / `licensing.nextYear`)
- Test: `LicensingSection.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`years` = `data.years` ascending, selected year `picked ?? currentFy`). The two-row Licensed / Actual chart per metric stays as it is, with Task 6's tooltip fix.

- [ ] **Step 1: Failing tests:** `changes year with the Time Travel row`; `the stepper arrows are gone`; `no per-year bars are drawn` and `the Licensed / Actual chart is still there`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the swap only; metrics, tiles and edit model unchanged.
- [ ] **Step 4: Run** `npx vitest run src/features/cards`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(licensing): Time Travel row in a card's Licensing section`.

### Task 9: Docs, changelog, version, locale keys (last)

**Files:**
- Modify: `docs/guide/` cost report and card Costs pages (English only), `CHANGELOG.md`, `VERSION`

- [ ] **Step 1:** Update the English guide text for the three changes (toggle buttons, Time Travel row, per-year bars). The screenshots in `docs/assets/img/**` for the cost report and the Costs section are retaken by the user with `scripts/screenshots` (Playwright needs the running demo app); list them in the PR.
- [ ] **Step 2:** Set `VERSION` to the next minor over `main`'s (2.205.0 after the sync, so 2.206.0 unless `main` moved) and add a `## [x.y.z]` heading with **Changed** entries (one line each: card type toggle buttons, fiscal-year Time Travel in the cost and licensing reports and in a card's Costs and Licensing sections, a bar per fiscal year, the cost tooltip no longer clipped).
- [ ] **Step 3:** `mkdocs build --strict` when available; run `/translate` and tell it, in its brief, to also **delete** the keys the English files no longer have (`scripts/i18n/check_locales.py` lists them as `extra`): `cost.fiscalYearHelp`, `cost.fiscalYearIndicator`, `licensing.fiscalYearIndicator`, `costs.previousYear`, `costs.nextYear`, `licensing.previousYear`, `licensing.nextYear`.
- [ ] **Step 4: Commit** `docs: cost report refinements`.

---

**Self-review notes.** Spec items 1, 2, 3 map to Tasks 3, 4+5, 6+7+8. The licensing choice (same row, no per-year bars, tooltip fix) is Tasks 5 and 8. `fiscalYearHelp` and both indicator keys are removed in Tasks 4 and 5. Names are consistent: `FiscalYearTimeTravel`, `buildCostsYearBarsOption`, `CostYearBar`. Each task is frontend-only; Tasks 1, 2, 3, 6 are independent of each other, 4, 5, 7, 8 need Task 2 (7 also Task 6).

## Agent's calls (from the plan review)

- The Time Travel row names the year the server answered (`fiscalYear.year`) and appears after the first response, so the steps never jump.
- The card type toggle keeps `typeOptions` (combined entry included) for the fallback effect and `printParams`.
- Steps mode drops the 560 px cap and bypasses the millisecond maths; its buttons and slider carry their own labels.
- The per-year bars are always drawn, also for an empty year or a card with no cost at all.
- Tint, total and rounded ends are built as in Task 6 (a `tintColor` option, a transparent total series, `markArea`, per-datum radius).
- The nine other locales lose the removed keys through `/translate` with an explicit instruction.
- The sync (PR #70) is merged first (Task 0), so the version is set once, at the end.
