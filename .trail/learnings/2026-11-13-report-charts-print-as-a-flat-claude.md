---
title: "Report charts print as a flat picture, Safari prints through execCommand, and the Initiative Report's deck is pictures of its sections"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 68, tokens: 1299405 }
id: l-11a97684
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/charts/printCopy.ts
  - frontend/src/components/charts/EChart.tsx
  - frontend/src/print.css
  - frontend/src/lib/printPage.ts
  - frontend/src/features/reports/reportExport.ts
  - frontend/src/features/reports/ReportShell.tsx
  - frontend/e2e/report-print.spec.ts
---

## Decided
- A report chart prints as a flat, opaque copy of itself: on print start `EChart` resizes the chart, calls `getZr().flush()`, and puts a canvas holding one `renderToCanvas` image beside the live one (`frontend/src/components/charts/printCopy.ts`); `print.css` hides the live canvas while the copy is shown and never shows the copy on screen. Why: Chrome prints a canvas repainted after print start by replaying its drawing commands, and zrender's `clearRect` becomes a transparency group with an alpha soft mask (`/SMask` with `/S /Alpha`), which Apple Preview and iOS draw as white boxes (Acrobat draws it correctly). And `resize()` alone repaints only on the next animation frame, so the PDF got the screen layout, cut off.
- The report Print button calls `printPage()` (`frontend/src/lib/printPage.ts`): in WebKit it uses `document.execCommand("print")`, because WebKit ignores `window.print()` while any request is in flight, and the app's live event stream (`useEventStream.ts`) is always open. Other browsers keep `window.print()`. Not verified on a Safari device when this was written.
- The Initiative Report's PowerPoint is a section mode of the shared export engine (`reportExport.ts`, `ReportExportData.sections`): a title slide, then each section shown and not empty on its own slide(s), as pictures of the page. Blocks are marked with `data-export-row` (where a slide may break), `data-export-keep` and `data-export-heading` (held with the next row). The maintainer chose pictures of the page over editable native slides.

## Tried and ruled out
- `resize()` + `flush()` alone: the layout is right but the soft masks stay.
- Switching the charts to the SVG renderer: no masks, but a renderer and bundle change for every chart in the app.
- Editable native PowerPoint slides: a second layout to maintain, and it would not look like the app.

## Watch out
- A script that calls `page.emulateMedia({ media: "print" })` before `page.pdf()` hides the bug: Chrome then takes a bitmap snapshot. That is why earlier checks passed. Check a PDF by counting `/S /Alpha` and `/SMask` in `pdf.toString("latin1")` (or with pypdf); `frontend/e2e/report-print.spec.ts` does this. Wait for the chart's entry animation before printing.
- jsdom reports an Apple vendor, so `printPage` takes the WebKit path in tests: tests that click Print mock `@/lib/printPage`.
- A new report that uses section mode must mark its blocks (`data-export-row` / `data-export-keep` / `data-export-heading`), or a slide may break inside a card.

In the code: `frontend/src/components/charts/printCopy.ts`, `frontend/src/components/charts/EChart.tsx`, `frontend/src/print.css`, `frontend/src/lib/printPage.ts`, `frontend/src/features/reports/ReportShell.tsx`, `frontend/src/features/reports/reportExport.ts`, `frontend/src/features/ppm/PpmProjectReport.tsx`, `frontend/e2e/report-print.spec.ts`.
