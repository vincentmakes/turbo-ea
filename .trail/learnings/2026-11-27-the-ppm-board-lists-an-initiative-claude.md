---
title: "The PPM board lists an initiative under every card of the grouping type it is related to, not only the first"
author: Claude
date: 2026-11-27
branch: claude/sharp-brown-5ugtqk
cost: { minutes: 16, tokens: 240619 }
id: l-33cff3d6
scope: repo
status: active
src: agent
touches:
  - backend/app/services/ppm_portfolio_service.py
  - backend/app/schemas/ppm.py
  - frontend/src/features/ppm/ppmPortfolioModel.ts
---

## Decided
- Issue #1452: grouped by a related card type (Application, Organization…), the board placed an initiative in only the FIRST group it was related through, so an initiative related to two Applications showed under one while both Applications' Relations listed it. Now it is a row of every visible group card it is related to now.
- Payload: `groups: [{id, name}]` on the gantt item and the public portal item, ordered by relation type (sort_order, key), then name, then id. `group_id` / `group_name` are kept and repeat the first entry, so existing clients, tests and the public API keep working. On a portal every group id is a per-response token, one per group card, shared by every row in that group.
- Group totals include a shared initiative in each group; the KPI bar counts rows (not group memberships), so it still counts it once. The Excel export writes one row per group, as on screen.
- Subtype grouping (`subtype:<key>`, anchors) stays one group per initiative; it goes through the same `groups` list as a one-element list.
- A tree parent's collapse state is per group (`rowCollapseId(groupId, itemId)` = `group>item`, read back per group with `collapsedRowsIn`), because the same initiative is now two rows and folding one must not fold the other.

## Watch out
- `itemGroups` falls back to `group_id` / `group_name` when `groups` is absent: most frontend test fixtures only set those.
- Do not format frontend files with prettier: the repo has no prettier config, and running it rewrote ~1000 unrelated lines.

In the code:
- backend/app/services/ppm_portfolio_service.py (build_group_map, build_gantt_items, the public projection)
- backend/app/schemas/ppm.py (PpmGroupRef), ppm_public.py (PpmPublicGroup)
- frontend/src/features/ppm/ppmPortfolioModel.ts (itemGroups, groupItems, filterItems, rowCollapseId, collapsedRowsIn), PpmPortfolioView.tsx (renderChildToggle toggleId)
