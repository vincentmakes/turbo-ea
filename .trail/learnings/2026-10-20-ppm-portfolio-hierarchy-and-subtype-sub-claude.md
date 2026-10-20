---
title: "PPM portfolio hierarchy and subtype sub-groups (#1254): what the design settled and what the mutation gate caught"
author: Claude
date: 2026-10-20
branch: feat/ppm-portfolio-hierarchy
cost: { minutes: 38, tokens: 458658 }
touches:
  - frontend/src/features/ppm/ppmPortfolioModel.test.ts
  - frontend/src/features/ppm/ppmPortfolioModel.ts
  - frontend/src/features/ppm/PpmPortfolioView.test.tsx
  - frontend/src/features/ppm/PpmPortfolioView.tsx
  - CHANGELOG.md
  - VERSION
  - docs/admin/calculations.ar.md
  - docs/admin/calculations.da.md
  - docs/admin/calculations.de.md
  - docs/admin/calculations.es.md
---

## Decided
- The PPM board nests the Initiative hierarchy **inside each group** (group-by stays primary; a child whose parent is in another group, filtered out or hidden becomes a root) and is **exclusive with the subtype sub-groups** (a tree spans subtypes, so the subtype switch is disabled while the tree is on). Filters narrow first; hidden ancestors are not kept as context rows.
- Everything is frontend-only on the shared view: the gantt payload already carried `parent_id` and `subtype`, and grouping, search and the subtype filter are pure functions in `ppmPortfolioModel.ts` (`treeRows`, `subtypeSubGroups` / `bucketBySubtype`, `groupLayout`, `groupRowsInOrder`), built on `lib/cardTree.buildChildIndex` whose "absent parent = root" rule is exactly the per-group nesting rule.
- One backend rule serves both boards: `build_gantt_items` emits `parent_id` only when the parent is itself a row of the response. That fixes an id leak (a hidden-by-View-cell or archived parent's id was sent) and lets the public projection publish `PpmPublicItem.parent_id` without ever carrying an id the payload does not already hold; `test_no_identifiers_beyond_the_initiative_id` pops `parent_id` only after asserting it names an item id.
- Roll-ups stay out of the portfolio. Users are pointed at a calculated field (`ppm.totalBudget + SUM(PLUCK(children, "attributes.rolledUpBudget"))`, same formula on every level); to keep it fresh, a PPM change re-runs the ACTIVE Initiative ancestors nearest-first (`services/ppm_ancestors.py`, called from `_sync_initiative_costs` / `_refresh_initiative_derived`) and `run_calculations_for_type` sorts cards deepest-first by `attributes.hierarchyLevel`.
- The Display depth menu is sized per group (max of `maxTreeDepth(group.items)`), never over the whole filtered board: a chain split across groups is two roots, not a level.
- Screenshot `101_ppm_portfolio_hierarchy` uses `/ppm?groupBy=Platform&hierarchy=1`: grouped by Organization the demo's programs and projects land in different groups and nothing nests.

## Tried and ruled out
- Defaulted optional inputs on a pure model function (`input.layout ?? {kind:"flat"}`, `allItems ?? []`, a throwaway `() => ""` label callback) on a critical module: every default is an equivalent-looking mutant that no test can kill. Make the input required when the caller always passes it, and extract a helper instead of passing a callback whose result is discarded.
- A non-exported helper with its own guard (`parentsWithin`'s orphan/cycle check) whose effect is masked by a downstream rule (`buildChildIndex` also files orphans as roots): its mutants survive. Export it and test it directly.

## Watch out
- `ppmPortfolioModel.ts` is in `[modules]` of `scripts/mutation/floors.toml` with a 98% floor: the diff gate passing at 83% is not enough, every changed line in that file answers to 98%.
- Stryker's `ArrayDeclaration` mutant on `x ?? []` reads as `["Stryker was here"]` in the report; it is the empty-array fallback being mutated, not the surrounding spread.
- A mutation artifact (`mutation-frontend.json`) is downloadable with `gh api repos/<o>/<r>/actions/artifacts/<id>/zip` when the job summary truncates the survivor list.
- The auto-mode classifier refused a compound `git add -A && git -c user.name=… commit && git push`; plain `git add <files>`, `git commit`, then a separate `git push` go through.
