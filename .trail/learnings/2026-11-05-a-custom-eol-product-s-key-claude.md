---
title: "A custom EOL product's key is generated and never shown; an end of life is required per cycle and 'support already ended' is a warning, as on endoflife.date"
author: Claude
date: 2026-11-05
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 37, tokens: 296802 }
id: l-ba2047ab
scope: repo
status: active
replaces: l-3feafb90
src: agent
touches:
  - CHANGELOG.md
  - docs/admin/eol.ar.md
  - docs/admin/eol.da.md
  - docs/admin/eol.de.md
  - docs/admin/eol.es.md
  - docs/admin/eol.fr.md
  - docs/admin/eol.it.md
  - docs/admin/eol.md
  - docs/admin/eol.pt.md
  - docs/admin/eol.ru.md
---

## Decided
Nobody types or sees a custom EOL product's key: the server derives it from the title (and numbers a duplicate). The card chip, the grid, the EOL report and the dashboards share one status rule, `eol_status` on the backend and `cycleStatus` on the frontend. That rule now follows endoflife.date: a cycle whose active support is over — a past support date OR `support: false` ("Support already ended") — reads Approaching EOL (warning) until its end of life; and every custom cycle must carry an end of life (a date, `false` = none announced, `true` = already ended), refused with "end of life is required" by the create and update schemas, because endoflife.date requires `eol` on every release and a cycle without one can only ever read Unknown. Active support may stay unknown.

## Tried and ruled out
- Showing the generated key read-only "for reference": the user said nobody cares about it.
- Ignoring `support: false` in the shared rule (the Nov 4 alignment): a user marked a cycle "Support already ended", left the end of life unknown and got an Unknown chip, which contradicted endoflife.date's reading of the same data.
- A fifth "Security support" status: the user chose to keep four statuses and map ended support to the existing warning.

## Watch out
- A legacy cycle row with `eol` null can no longer be PATCHed without an `eol` in the same body: `update_cycle` re-validates the merged row through `EolCustomCycleCreate`. The panel flags such a cycle.
- API tests that assert a 403 or 409 on a cycle body must include `eol`, or the 422 from validation masks the status they pin.

In the code:
- backend/app/services/eol_service.py `eol_status`; frontend/src/lib/eolCustom.ts `cycleStatus`.
- backend/app/schemas/eol_custom.py `EOL_REQUIRED_MESSAGE`, `EolCustomCycleCreate._require_eol`, `EolCustomCycleUpdate._eol_cannot_be_cleared`.
- frontend/src/components/CustomEolProductDialog.tsx `MilestoneField required`, `cycleIssues` (`eol.custom.errors.eolRequired`).
