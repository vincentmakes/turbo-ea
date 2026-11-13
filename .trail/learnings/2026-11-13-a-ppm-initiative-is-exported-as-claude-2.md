---
title: "A PPM initiative is exported as a PDF through a section picker, and its risk table is a full standard AG Grid: filter panel, export and import included"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 12, tokens: 130718 }
id: l-e3a419a4
scope: repo
status: active
replaces: l-017fb5ee
src: agent
touches:
  - frontend/src/features/ppm/PpmRiskTab.tsx
  - frontend/UI_GUIDELINES.md
  - frontend/src/lib/printDocument.ts
---

## Decided
Discussion #1398 asked to stop cutting a PPM risk's text and for a PDF of an initiative or of its risks. The maintainer chose:
- The risk table is an AG Grid built to the full grid standard, however few risks a project holds: filter panel (Filters and Columns tabs), freeze, reorder, group by, Excel export and import, as the Risk Register has. Text is wrapped and never cut.
- One PDF button on the initiative header opens a section picker (overview, status reports, budget and costs, risks, tasks and schedule), all ticked by default and remembered per browser. Ticking only Risks is the risk report.
- The schedule prints as a table of work; status reports print the newest in full and earlier ones as a compact list.
- Frontend only: everything comes from endpoints the page already reads.

## Tried and ruled out
- A grid with no filter panel because "a project holds few risks": the maintainer rejected it. A new AG Grid follows the grid guidelines in full; row count is not a reason to skip the panel or the toolbar.
- Keeping the plain table and only removing the cut: no sorting or filtering.
- Printing the page with the global print stylesheet: it prints only the open tab.
- A picture of the Gantt in the PDF: exists only while its tab is open, unreadable for long projects.
- Eight columns in the printed risk table: wider than A4, so the last column was clipped and the browser shrank the whole document. Title and description share one cell.

## Watch out
- The pop-up print window must be opened in the click, before any fetch.
- A ticked section with no data prints a "nothing recorded" line, so empty reads differently from left out.
- Check any new grid at 1280 wide: separate title and description columns pushed the action buttons off screen.

In the code:
- frontend/src/features/ppm/PpmRiskTab.tsx, PpmRiskGrid.tsx, PpmRiskFilterSidebar.tsx, ppmRiskModel.ts, ppmRiskSpreadsheet.ts, PpmRiskImportDialog.tsx
- frontend/src/features/ppm/ppmProjectPrint.ts, PpmProjectPdfDialog.tsx, PpmProjectDetail.tsx
- frontend/UI_GUIDELINES.md sections 3.6 and 3.11; .claude/rules/frontend-grids.md
- frontend/src/lib/printDocument.ts is the shared pop-up print path
