---
title: "A saved query view is resolved before the inventory's first card request, lifecycle dates are compared as text in SQL, and docs screenshots here need the prein…"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 1, tokens: 2147 }
id: l-bff5edef
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/inventory/InventoryPage.tsx
  - backend/app/services/lifecycle.py
  - backend/tests/services/test_card_query.py
  - backend/app/services/dashboard_query.py
---

## Decided
- The inventory holds back its first card request while a saved query view is being resolved: a `?view=` link or a query remembered from the last visit is checked against the user's saved views first. Otherwise the first request runs with the wrong filters (or a stale or deleted query) and is thrown away a moment later. An unknown or unreadable view falls back to the user's own remembered filters, not to an empty inventory.
- Changing the type facet away from the query's start type leaves the query view, rather than sending the old query with a new type.
- Filtering a hop on lifecycle phase in SQL compares dates as text after a format check and never casts to a date, because one malformed lifecycle value would otherwise make every inventory request fail. The reference date is bound from Python in UTC, not read from the database clock.
- An MCP update of a view to a query with another start type resets the view's filters and grouping, since both belonged to the old type. The same start type keeps them.

## Tried and ruled out
- Casting lifecycle dates to a date in SQL: one bad value fails the whole query.
- Letting the dashboards and the card query each build their own relation EXISTS: they share one builder, and each passes its own read-scope mode for the far card (module for dashboards, inventory for query views).

## Watch out
- Impossible calendar dates count as a phase in SQL but not in Python. The parity test leaves them out on purpose.
- The docs screenshot script needs the preinstalled Chromium in the cloud environment; its pinned Playwright cannot find its own browser.
- After a rebase in a cloud session, a force push may be blocked. Merging the old remote tip, when it only holds the same commit, gives a normal push with no file changes.

In the code:
- Resolution gate: `viewPending` and `refreshActiveQuery` in `frontend/src/features/inventory/InventoryPage.tsx` and `viewApply.ts`.
- Lifecycle twin: `current_lifecycle_phase_sql` in `backend/app/services/lifecycle.py`; parity tests in `backend/tests/services/test_card_query.py`.
- Shared builder: `relation_exists` in `backend/app/services/dashboard_query.py`.
- Screenshots: `PLAYWRIGHT_EXECUTABLE_PATH=/opt/pw-browsers/chromium npx tsx capture.ts --base-url http://localhost:5173 --only 98d` in `scripts/screenshots`.
