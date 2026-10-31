---
title: "Data quality leaderboard widget: own endpoint, keys-only config, role labels from the type's roles"
author: Claude
date: 2026-10-31
branch: feat/quality-leaderboard-widget
cost: { minutes: 2, tokens: 469514 }
id: l-b9de5f8f
scope: repo
status: active
src: agent
touches:
  - backend/app/services/dashboard_leaderboard.py
  - backend/app/api/v1/dashboards.py
  - backend/app/services/dashboard_defaults.py
---

## Decided
- The leaderboard reads its own endpoint, `GET /dashboards/leaderboard` (`services/dashboard_leaderboard.py`), not `/dashboards/query`: query rows are cards, the board's rows are people. A person is `{id, display_name}` only, ranked from a DISTINCT `(user_id, card_id)` subquery so several roles on one card count it once; every card passes `CardReadScope` in module mode, so a hidden card neither counts nor moves an average.
- Ties on the ranked figure share a rank (1, 2, 2, 4) and the average is rounded to one decimal in SQL before ordering, so two rows that read the same figure never get different ranks.
- `max_rows` is stored in the widget config and sent as the endpoint's `top` parameter, the way a chart's `top` never enters its stored query.
- The widget ships on the Overview default (`quality-leaderboard`, y=18). The dashboards rule allows a default-layout change without a migration: seeding is insert-only, so only fresh installs and **Reset to default** get it.

## Watch out
- `CardType.stakeholder_roles` (the type's JSONB mirror the metamodel serves) is typed `translations?: TranslationMap`, but the seed stores `{label: {fr: …}}`, the per-property shape. `roleEntity` in `widgets/leaderboardConfig.ts` turns either shape into a `MetaEntityLike` for `useTypeLabel`; a plain cast fails tsc and a wrong shape silently shows English.
- The mirror can lag behind the role-definition table (a role created after the type is not added to it), so the role picker may miss a custom role; the backend checks role keys against the live, non-archived definitions (`unknown_role`).
- Adding a widget to the Overview default moves `test_reset_restores_the_built_in_widgets`'s widget count.
