---
title: "Dependency view: relation types are filtered from the same menu as card types; deleting a card comment always takes its replies and every stored copy of its te…"
author: Claude
date: 2026-11-23
branch: claude/bold-shannon-k3caig
cost: { minutes: 57, tokens: 416645 }
id: l-64dc06da
scope: repo
status: active
replaces: l-07d05247
src: agent
touches:
  - CHANGELOG.md
  - docs/guide/reports.ar.md
  - docs/guide/reports.da.md
  - docs/guide/reports.de.md
  - docs/guide/reports.es.md
  - docs/guide/reports.fr.md
  - docs/guide/reports.it.md
  - docs/guide/reports.md
  - docs/guide/reports.pt.md
  - docs/guide/reports.ru.md
---

## Decided
- Discussion #1423: the owner wants no second toolbar button. Hiding relation types answers the same question as hiding card types (what the view draws at all), so the funnel opens one "Filter the view" menu: Card types section, Relation types section below. Each section has its own count, hint and Show all; the button's badge counts both.
- The filter applies wherever the Layered Dependency View is drawn; the report's tree and table are not filtered. The choice lives in the browser's shared view settings, not in saved reports.
- Hiding a relation type removes its lines and only the cards those lines disconnected from the centred card; cards another filter had already stranded stay.
- Discussion #1424: deleting a comment always deletes the replies under it, whoever wrote them (owner's choice after review); the confirmation says how many. The server says per comment whether the caller may delete it; a hidden card answers "not found" on every comment route.
- Discussion #1425 (portal filters on text, number, date, yes/no fields) was set aside by the owner.

## Tried and ruled out
- A separate Relation types button beside Card types: built first, replaced at the owner's request.
- An author may delete only while every reply is theirs; keeping replies under a blanked parent: offered, declined.
- Keeping only cards reachable from the centre after the relation filter: removed cards other filters had stranded.

## Watch out
- Listing comments recursed into ORM relationships eager-loaded three levels deep; a fourth level raised a lazy-load error inside async code and the tab showed no comments. The list now loads the card's comments flat and nests by parent.
- A reply could be posted under a parent on another card; deletion then reached across cards. Parents must now be on the same card.
- Mutation testing: `toContain("2")` on a badge lets `n + 1` → `n - 1` survive ("-2" contains "2"); assert the exact text.
- No Docker in this container: start the installed Postgres 16 by hand on port 5433 with the test script's user and database.

In the code: frontend/src/features/reports/LdvScopeFilter.tsx, ldvViewModel.ts (relationFilterRows), layeredDependencyLayout.ts (filterHiddenRelationTypes, HIERARCHY_EDGE_TYPE); backend/app/api/v1/comments.py, alembic 176 (notifications.card_id index); frontend/src/features/cards/sections/CommentsTab.tsx.
