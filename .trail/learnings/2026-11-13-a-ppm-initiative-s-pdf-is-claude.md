---
title: "A PPM initiative's PDF is a designed report with colour, indicators and charts, never tables alone; its risk table is a full standard AG Grid"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 53, tokens: 279504 }
id: l-4e079b48
scope: repo
status: active
replaces: l-e3a419a4
src: agent
touches:
  - docs/guide/ppm.ar.md
  - docs/guide/ppm.ru.md
  - docs/guide/ppm.zh.md
  - docs/guide/risks.ar.md
  - docs/guide/risks.ru.md
  - docs/guide/risks.zh.md
  - CHANGELOG.md
  - VERSION
  - docs/assets/img/ar/44_ppm_risk_management.png
  - docs/assets/img/da/44_ppm_risk_management.png
---

## Decided
Discussion #1398 asked to stop cutting a PPM risk's text and for a PDF of an initiative or of its risks.
- The initiative PDF is a designed report for paper, built from the app's own colours and chart definitions: KPI tiles, coloured health dots, a completion ring, budget-vs-actual bars, the Budget & Costs spend charts as vector images, a 5×5 risk heat map, coloured score, status and priority chips, and a timeline with bars for the schedule. A section picker chooses what goes in; ticking only Risks is the risk report.
- The risk tab is an AG Grid built to the full grid standard however few risks a project holds: filter panel, freeze, reorder, group by, Excel export and import.
- Frontend only.

## Tried and ruled out
- A PDF made of tables: correct data, but the maintainer rejected it as disappointing ("only tables, where are the colours and charts"). An export a person hands to someone else has to look like the product, not a spreadsheet.
- Pictures of the tabs: blurry when zoomed, cut at page breaks, carry buttons, and the Tasks and Gantt tabs load their own data.
- Dependency arrows on the printed timeline: extra read and routing across page breaks for little value.
- A grid without the filter panel because "few rows": rejected; a new grid follows the grid guidelines in full.
- Eight columns in the printed risk table: wider than A4, so the browser clipped it and shrank the document.

## Watch out
- The pop-up print document drops every CSS background unless its stylesheet sets print-color-adjust: exact. Check colour with the print tool's "background graphics" option OFF, or the check passes for the wrong reason.
- The charting library is loaded only when the costs section is ticked, after the pop-up window is opened in the click.
- Colours in print come from tokens; several on-screen colours exist only on the theme and need a token stand-in.
- Every colour-coded element keeps its text so a black-and-white print still reads.

In the code:
- frontend/src/features/ppm/ppmProjectPrint.ts, ppmProjectPrintVisuals.ts, ppmProjectCharts.ts, PpmProjectPdfDialog.tsx
- frontend/src/features/ppm/PpmRiskGrid.tsx, PpmRiskFilterSidebar.tsx, ppmRiskModel.ts, ppmRiskSpreadsheet.ts, PpmRiskImportDialog.tsx
- frontend/src/lib/printDocument.ts (shared pop-up print path), frontend/src/theme/tokens.ts (PPM_COST_COLORS)
