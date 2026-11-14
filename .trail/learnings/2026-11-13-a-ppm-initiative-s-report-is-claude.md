---
title: "A PPM initiative's report is a real app page built from the app's own components and printed like every other report; never a hand-drawn imitation"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 1, tokens: 3867 }
id: l-9741221b
scope: repo
status: active
replaces: l-4e079b48
src: agent
touches:
  - frontend/UI_GUIDELINES.md
  - frontend/src/features/reports/ReportShell.tsx
  - frontend/src/print.css
  - frontend/src/features/grc/risk/RiskMatrix.tsx
---

## Decided
Discussion #1398 asked for a PDF of an initiative or of its risks. After two rejected attempts the maintainer settled it:
- The export is an Initiative Report page inside the app, built from the components the UI guidelines name (the shared report shell, metric tiles, outlined cards, standard chips, the percent bar, the real spend charts, the Risk Register's matrix, Inter and Material icons) and printed with the standard report print button, in landscape like every other report.
- The tabs and the report share one implementation: the tabs' building blocks are extracted and both use them.
- Section toggles in the report toolbar choose what shows; showing only risks is the risk report.
- The risk tab is a full standard AG Grid (filter panel, freeze, reorder, group by, Excel export and import).

## Tried and ruled out
- A PDF made of tables: right data, rejected as disappointing ("only tables, where are the colours and charts").
- A visual report hand-built as HTML and CSS in a pop-up window: it had colour and charts but was rejected as "not respecting our UI guidelines and looks AI generated". It imitated the product (own font, tiles with a coloured top stripe, a card with a side stripe, home-made pills, a hand-drawn ring, a centred cover) instead of using it. Imitating components in custom CSS drifts from the guidelines however carefully it is done.
- Pictures of the tabs: blurry, cut at page breaks, carry buttons.
- A4 portrait: the app's reports share one landscape print rule, and consistency with them was preferred over a page-specific override.

## Watch out
- Before building any export or print view, read frontend/UI_GUIDELINES.md and look at the product's own screens; "don't reinvent" applies to print as much as to screens.
- The shared print stylesheet keeps every card whole across pages; a long single-entity report needs its own scoped block, as the portfolio has.
- Reports print in the user's theme, so a dark-mode user prints dark cards; this page behaves like the others.

In the code:
- frontend/src/features/ppm/PpmProjectReport.tsx, ppmReportModel.ts, PpmScheduleTimeline.tsx, ppmVisuals.tsx
- frontend/src/features/reports/ReportShell.tsx, MetricCard.tsx; frontend/src/print.css
- frontend/src/features/grc/risk/RiskMatrix.tsx (generalised for the 5x5 PPM matrix)
- frontend/UI_GUIDELINES.md sections 1, 3.2, 3.6, 3.7, 3.8, 3.9, 5, 6
