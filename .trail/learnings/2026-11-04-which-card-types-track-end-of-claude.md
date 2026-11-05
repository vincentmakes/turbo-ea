---
title: "Which card types track End of Life is each type's own End of Life section toggle, defaulting to Application and IT Component"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 48, tokens: 220750 }
id: l-320a2a45
scope: repo
status: active
src: agent
touches:
  - backend/app/services/card_flags.py
  - frontend/src/lib/eol.ts
---

## Decided
- A type tracks EOL when its `eol` section is not hidden; an explicit `hidden` boolean wins, and absent means the shipped default (Application, IT Component on; every other type, custom ones included, off). The user confirmed one toggle drives everything: card section, create-dialog link, EOL report, data-quality coverage and drill-down, dashboard eol flags/dimension, inventory column, bulk linking, card-status.
- No migration: the default lives in code (card_flags.type_tracks_eol / lib/eol.ts typeTracksEol), so old installs keep exactly the old behaviour and the Card Layout switch now shows the effective state instead of the raw stored flag.

## Tried and ruled out
- Writing explicit `eol.hidden` into the seed + a guarded UPDATE migration: unnecessary once the default is computed, and it would freeze a choice an admin never made.

## Watch out
- The section never was "forced hidden" by the seed: the list was hard-coded, so the switch read visible while EolLinkSection rendered null.
- Frontend surfaces that render before the metamodel loads must fall back to the key default (typeKeyTracksEol), or EOL flickers away on IT Component; tests that count API calls need the useMetamodel test double.
- The EOL report's IT Component -> Application impact loads applications on its own when Application stops tracking EOL.

In the code: backend/app/services/card_flags.py (DEFAULT_EOL_TYPES, type_tracks_eol, eol_type_keys), dashboard_query.ResolvedQuery.eol_types, GET /eol/types, frontend/src/lib/eol.ts, CardLayoutEditor eol row (effective hidden + note).
