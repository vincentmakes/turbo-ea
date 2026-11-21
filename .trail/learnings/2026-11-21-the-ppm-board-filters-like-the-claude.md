---
title: "The PPM board filters like the reports: the section starts folded, the tiles follow what the board shows, and matching stays in the browser"
author: Claude
date: 2026-11-21
branch: claude/modest-einstein-f4d4pc
cost: { minutes: 39, tokens: 448414 }
id: l-fcaf3263
scope: repo
status: active
src: agent
touches:
  - docs/guide/ppm.ar.md
  - docs/guide/ppm.da.md
  - docs/guide/ppm.de.md
  - docs/guide/ppm.es.md
  - docs/guide/ppm.fr.md
  - docs/guide/ppm.it.md
  - docs/guide/ppm.pt.md
  - docs/guide/ppm.ru.md
  - docs/guide/ppm.zh.md
  - frontend/src/i18n/locales/ar/ppm.json
---

## Decided
- The PPM portfolio board has the reports' filter section (related cards with sub-cards, tags, fields). The owner asked for it folded by default; the fold is not remembered, and the count chip on the folded header says filters are on. Reports stay expanded by default; the board is the one exception.
- The tiles (initiatives, budget, schedule health) follow what the board shows: the filters, the search and the subtype pick. Unfiltered, the server's figures stand unchanged. This also holds on the public portal board, which shares the view.
- The toolbar keeps its single Subtype dropdown; the section offers no second subtype control, and a subtype smuggled into the link's filter value is dropped.
- Matching runs in the browser with the reports' own matcher, on one extra payload fetched only when the section is first opened or the link already carries filters. The matching ids narrow inside the board's row filter, so a group's header initiative survives when a member of its group does.
- A failed load of that payload opens the section to show the message, narrows nothing, and puts no filter line in the print header.

## Tried and ruled out
- Filtering on the server with the portal's SQL twin of the matcher: the board already holds every row, and a second matcher would have to be kept in step with the reports.
- Moving subtype into the section as a multi-select: offered, the owner chose to keep the toolbar dropdown (existing links and the portal stay as they are).
- Keeping the tiles portfolio-wide: offered, the owner chose tiles that follow the board.
- Writing the filter value to the link from the page container with its own URL update: two functional URL updates in one tick start from the same snapshot in the installed router, and the second overwrites the first. The view's one URL-sync effect writes it.
- Putting the tile recount in the new filter file: the view is shared with the public portal, whose bundle must not import the reports' code.

## Watch out
- The fold keeps its content mounted while hidden, so a test that finds text inside a folded section proves nothing about what a person sees; assert the header's expanded state or visibility.
- With the payload missing, a tag pick prints as its raw id; that is how a filter line could reach a print header for an unfiltered board.
- The tile budget is the sum of the rows' planned CapEx and OpEx; a budget the server withheld stays withheld even when rows carry numbers.

In the code:
- backend/app/api/v1/ppm_reports.py (GET /reports/ppm/filter-data), backend/app/services/ppm_portfolio_service.py (card_filter_payload, empty_filter_payload)
- frontend/src/features/ppm/ppmBoardFilters.ts (encodeCardFilters, decodeCardFilters, matchingInitiativeIds), ppmPortfolioModel.ts (matchesBoard, filterItems, shownDashboard, filterSearchParams), PpmPortfolio.tsx, PpmPortfolioView.tsx
- frontend/UI_GUIDELINES.md section 3.12, link parameter `filters`
