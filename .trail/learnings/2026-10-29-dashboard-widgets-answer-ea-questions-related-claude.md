---
title: "Dashboard widgets answer EA questions: related cards, health flags, shares, measures and module series, with the sankey grouped per end"
author: Claude
date: 2026-10-29
branch: claude/sleepy-archimedes-su7k6e
cost: { minutes: 45, tokens: 669210 }
id: l-6ccd3963
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs/guide/dashboard.ar.md
  - docs/guide/dashboard.da.md
  - docs/guide/dashboard.de.md
  - docs/guide/dashboard.es.md
  - docs/guide/dashboard.fr.md
  - docs/guide/dashboard.it.md
  - docs/guide/dashboard.md
  - docs/guide/dashboard.pt.md
  - docs/guide/dashboard.ru.md
---

## Decided
- The sankey offered a relation type but the dialog stripped both side dimensions, so every sankey drew one band with one number. Each end now takes its own dimension (type, subtype, status, phase, quality bucket, a field of that end's type, or the cards themselves), with server-side folding to the top flows and a `labels` map naming the cards.
- Card ids may appear in a response (row keys of a card-keyed dimension plus `labels`) because every one passes the caller's read scope; the "no ids" rule is about what a widget config stores.
- New dimensions, measures and filters reuse the single definitions: flags are the `card_flags` conditions (so a flagged count keeps the SQL group-by path), a cost sum applies the fiscal-year rule the Cost report uses and names the year, `share` divides a narrowed count by the same query without its narrowing filters.
- Module data (risks, compliance, PPM, BPM) enters as `source` + `series` widgets reading the existing report endpoints under their own permission and module flag; the series vocabulary is frozen on the backend and parity-scanned on the frontend; such tiles carry no trend because the reports keep no history.
- Out of this round: multi-hop sankeys, a generic preset catalogue, tags as a dimension (they have no stable key).

## Tried and ruled out
- Folding averages and shares into an "Other" bucket: a sum of averages is wrong, so rows past the limit are dropped for those metrics.
- Applying the query's filters to the related card too: a `related:` flag would then recurse into itself; the related card only has to be active, visible and readable.

## Watch out
- `flags` must be canonical (split, trim, dedupe, sort) on both sides or two equal filters store two snapshot keys; `top` is a query parameter only, never a query field.
- `/compliance/overview` counts findings and is not read-scoped; pre-existing, noted in the rules file, not widened here.
- A subagent ran `git stash` / `git stash pop` to bisect a failure while another agent was editing in parallel; it popped cleanly, but it is a risk — tell parallel agents never to stash.

In the code:
- Backend `backend/app/services/dashboard_query.py` (`flags_problem`, `resolve_side`, `fold_keyed`, `fold_flows`, `share_rows`, `fiscal_year_keys`), `card_flags.stakeholder_condition`, `SOURCE_SERIES` in `dashboard_defaults.py`.
- Frontend `frontend/src/features/dashboard/customize/sections/*`, `widgets/sourceSeries.ts`, `charts/dimensions.ts` (`sideTypes`, per-side `findField`), `queryProblems.ts`.
- Pinned key: `{card_type:"Application", flags:"stale,orphaned"}` → `card_type=Application&flags=orphaned%2Cstale`.
