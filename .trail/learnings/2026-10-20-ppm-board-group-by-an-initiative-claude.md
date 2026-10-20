---
title: "PPM board: group by an Initiative subtype"
author: Claude
date: 2026-10-20
branch: feat/ppm-initiative-derived-financials
cost: { minutes: 201, tokens: 819229 }
touches:
  - backend/app/services/ppm_rollup.py
  - backend/app/services/ppm_portfolio_service.py
  - frontend/src/features/ppm/ppmPortfolioModel.ts
  - frontend/src/features/ppm/PpmPortfolioView.tsx
  - frontend/src/features/admin/WebPortalsAdmin.tsx
---

## Decided
- Grouping the PPM board by an Initiative subtype is encoded `group_by=subtype:<key>` on both `/reports/ppm/gantt` and the public portfolio, in `?groupBy=` and in a portal's `card_config.ppm.default_group_by`. One group per initiative of that subtype; that initiative is the group's **anchor** (`group_anchor: true`, on `PpmGanttItem` and `PpmPublicItem`): its header and its bottom line, never a row. Every initiative beneath it at any depth joins the group, so a nested program is a row in the top-most program's group; the rest is Ungrouped.
- The backend decides it with the pure `ppm_rollup.anchor_groups(parents, subtype_of, key)`, walking UP the same on-board `parents` map the roll-up and `parent_id` use, so a hidden / archived / unpublished intermediate breaks the chain identically and no query is added (pinned by `TestQueryCount::test_subtype_grouping_adds_no_query`, equal count to an ungrouped board). The `subtype:` branch runs before `build_group_map`, which never validates its key. The public tokeniser already maps the anchor's own id to the same `gN` its rows carry.
- Frontend: `PortfolioGroup.anchor` is required (`PpmPortfolioItem | null`); `groupItems` files the anchor there; `filterItems` filters rows and keeps an anchor whose group kept a row (or when no filter is set); `hasHierarchy` counts only non-anchor parents (children of the anchor are roots); `subtypeKeys` skips anchors; `groupByLabel` names the grouping; the export writes the anchor as its group's first row with no parent. The anchored group's bottom line replaces "Σ Totals" and renders `rowFigures(anchor)` with the row renderers (no second cost/dates model); mobile shows the same block under the header.
- The portal admin offers the subtypes as a second section and disables one the portal's own subtype filter excludes (it would open all-Ungrouped), with a tooltip.

## Tried and ruled out
- A trivial `anchorFigures(anchor)` alias for `rowFigures(anchor)`: on the 98% mutation module it adds a function and no rule; the view calls `rowFigures` directly.
- Checking `hasHierarchy` as "same group": the existing view test puts a plain parent in one group and its child in another and expects the switch.

## Watch out
- MUI `Select` clones every child, `ListSubheader` included, with `role="option"`; a section header is told apart by `.MuiListSubheader-root` (it has no tabindex, so it cannot be picked). Tests must not count options by role alone.
- A disabled `MenuItem` takes no pointer events, so a tooltip on it needs an inner span with `pointer-events: auto` that stops the click (Select's item click would otherwise pick it), and `describeChild` keeps the option's accessible name the label rather than the tooltip text.
- `ppm_rollup.anchor_groups` treats a parent id that is not a key of `parents` as off-board; callers must pass the on-board map, never raw `parent_id`s.
