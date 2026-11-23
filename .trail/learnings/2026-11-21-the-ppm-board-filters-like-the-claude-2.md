---
title: "The PPM board filters like the reports and remembers its whole toolbar in the browser: the link is the state, the browser keeps the last state"
author: Claude
date: 2026-11-21
branch: claude/modest-einstein-f4d4pc
id: l-7f8ebbc2
scope: repo
status: active
replaces: l-fcaf3263
src: agent
touches:
  - CHANGELOG.md
  - docs/guide/ppm.md
  - frontend/UI_GUIDELINES.md
  - frontend/src/features/ppm/PpmPortfolio.filters.test.tsx
  - frontend/src/features/ppm/PpmPortfolio.tsx
  - frontend/src/features/ppm/PpmPortfolioExport.test.tsx
  - frontend/src/features/ppm/PpmPortfolioView.test.tsx
  - frontend/src/features/ppm/PpmPortfolioView.tsx
  - frontend/src/features/reports/ReportFilterSection.tsx
---

## Decided
- The PPM portfolio board has the reports' filter section (related cards with sub-cards, tags, fields), folded the first time. The tiles follow what the board shows (filters, search, subtype pick); unfiltered, the server's figures stand. The toolbar keeps its single Subtype dropdown.
- Matching runs in the browser with the reports' own matcher, on one payload fetched only when the section is first opened, opens unfolded, or the link carries filters. The matching ids narrow inside the board's row filter, so a group's header initiative survives with its members.
- The owner found that filters "do not persist like in reports": the board kept its state only in the link, so the menu entry and the back arrow on an initiative (both a bare link) lost it. Now the link stays the board's state and the browser remembers the last state: search, grouping, subtype, hierarchy and depth, sub-grouping, the filter selection and the section's fold. A bare link gets the remembered settings; a link with settings of its own wins and becomes what is remembered. The reports' Reset button returns the board to its defaults.
- The remembered settings are written onto the link before the board mounts, and the board mounts only once the link is seen to show them, because the view and the page container both read their opening state from the link.

## Tried and ruled out
- Filtering on the server with the portal's SQL twin of the matcher: the board already holds every row.
- Keeping the fold unremembered ("always folded"): the first version; the owner chose to remember it, as reports do.
- Remembering only the filter section: the owner chose the whole toolbar.
- Saving what the link shows: a bare link over a mounted board would wipe the memory. The view reports its state and that is what is saved.
- Passing remembered values as the view's opening defaults: opening defaults are left out of the link by design, so a shared link would no longer carry them.
- A second URL update from the container: two functional URL updates in one tick start from the same snapshot in the installed router and the second overwrites the first.

## Watch out
- Tests that render the real board share the test browser's storage between cases; clear it before each.
- The default state is remembered as no entry at all, so storage reads as empty after Reset.
- A fold forced open by a failed payload load is derived and never remembered.
- The fold keeps its content mounted while hidden; assert the header's expanded state or visibility, not presence of text.
- The screenshot script clears storage before every page, so a remembered board cannot leak between captures.

In the code:
- frontend/src/features/ppm/ppmBoardPrefs.ts (key `turboea.ppm.portfolio.prefs`, BOARD_PARAMS, restoreTarget), PpmPortfolio.tsx (outer latch, Reset, PpmPortfolioBoard), PpmPortfolioView.tsx (onBoardStateChange), ppmBoardFilters.ts, ppmPortfolioModel.ts (matchesBoard, shownDashboard)
- backend/app/api/v1/ppm_reports.py (GET /reports/ppm/filter-data)
- frontend/UI_GUIDELINES.md section 3.12
