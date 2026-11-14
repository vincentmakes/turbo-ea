---
title: "A PPM initiative is exported as a PDF through a section picker, and its risk table is an AG Grid showing every risk's text in full"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 28, tokens: 199615 }
id: l-017fb5ee
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/ppm/PpmRiskTab.tsx
  - frontend/src/lib/printDocument.ts
  - frontend/src/features/admin/CustomEolProductsGrid.tsx
  - frontend/src/features/grc/risk/RiskRegisterPage.tsx
  - frontend/src/features/grc/compliance/ComplianceGrid.tsx
  - frontend/src/components/grid/columnFreezePersistence.test.tsx
  - frontend/src/features/ea-delivery/AdrGrid.tsx
  - frontend/src/features/grc/risk/riskPrint.ts
  - frontend/src/features/ppm/PpmProjectDetail.tsx
---

## Decided
Discussion #1398 asked for two things: stop cutting a PPM risk's description and mitigation, and a way to share an initiative (or at least its risks) as a PDF. The maintainer chose:
- The risk table becomes an AG Grid with wrapped, auto-height text, sort, header filters, column freeze and reorder, and no filter sidebar (a project holds few risks).
- One PDF button on the initiative header opens a dialog with a checkbox per section (overview, status reports, budget and costs, risks, tasks and schedule), all ticked by default and remembered per browser. Ticking only Risks is the risk report; there is no separate risk-only button.
- The schedule prints as a table of work packages, milestones and tasks.
- Status reports: the newest in full, earlier ones as a compact table of date, reporter and the three health ratings.
- It is frontend only: every figure comes from endpoints the page already reads under the PPM view permission.

## Tried and ruled out
- Keeping the plain table and only removing the cut: fixes the complaint but gives no sorting or filtering, and the Risk Register already shows risks in a grid.
- Printing the page with the global print stylesheet, as the reports and the portfolio do: it prints only the open tab, and the Gantt and task board load their own data and are interactive.
- A picture of the Gantt chart in the PDF: the chart exists only while its tab is open, a long project gives an unreadable image, and it was the riskiest part to build.
- Every status report in full: a year-old project prints dozens of pages.
- A whole-project button plus a second risk-only button: the section picker covers both with one control.

## Watch out
- The pop-up print window must be opened in the click itself, before any fetch, or Safari and Firefox block it.
- A ticked section with no data prints a "none recorded" line rather than disappearing, so a reader can tell empty from left out.
- A cut preview must not be linkified, which is why the old table could not link URLs in the description; full text can.

In the code:
- frontend/src/features/ppm/PpmRiskTab.tsx, PpmRiskGrid.tsx, ppmRiskModel.ts
- frontend/src/features/ppm/ppmProjectPrint.ts, PpmProjectPdfDialog.tsx, PpmProjectDetail.tsx
- frontend/src/lib/printDocument.ts is the shared pop-up print path; features/grc/risk/riskPrint.ts is the closest precedent
- localStorage keys: turboea.ppmRisks.prefs, turboea.ppm.projectPdf.prefs
