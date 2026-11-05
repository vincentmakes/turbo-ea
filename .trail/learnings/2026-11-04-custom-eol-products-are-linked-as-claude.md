---
title: "Custom EOL products are linked as custom:<key> in the existing EOL attributes, and the support boolean is inverted against endoflife.date's file format"
author: Claude
date: 2026-11-04
branch: claude/blissful-goldberg-qnvh1z
cost: { minutes: 80, tokens: 840270 }
id: l-7d8abf18
scope: repo
status: active
src: agent
touches:
  - docs/assets/img/ar/29b_admin_settings_eol_custom.png
  - docs/assets/img/da/29b_admin_settings_eol_custom.png
  - docs/assets/img/de/29b_admin_einstellungen_eol_eigene.png
  - docs/assets/img/en/29b_admin_settings_eol_custom.png
  - docs/assets/img/es/29b_admin_config_eol_personalizados.png
  - docs/assets/img/fr/29b_admin_parametres_eol_personnalises.png
  - docs/assets/img/it/29b_admin_impostazioni_eol_personalizzati.png
  - docs/assets/img/pt/29b_admin_config_eol_personalizados.png
  - docs/assets/img/ru/29b_admin_nastroyki_eol_sobstvennye.png
  - docs/assets/img/zh/29b_admin_settings_eol_custom.png
---

## Decided
- A card links a custom EOL product through the same two attributes an endoflife.date link uses, with `eol_product = "custom:<key>"`. One attribute pair means every existing writer (card PATCH, mass-link, create dialog) stays atomic, coverage counts it as "linked" with no change to card_flags, and the `:` can never collide with an endoflife.date slug (the upstream SSRF regex already refuses it). The resolver takes the custom cycles as an argument, loaded by the caller BEFORE it releases its session, so nothing reads the DB during the outbound fetch.
- Workspace transfer carries the two tables as ConfigSections keyed by natural key (product key; product_key + cycle), not EntitySections: entity sections preserve UUIDs and a unique-slug clash on the target would abort the whole import at flush. That is also why cycles point at the product by its immutable slug, not its id.
- The offer to create a custom product from a card holds back only for a STRONG upstream match (score >= 0.7): fuzzy search always returns some weak look-alike, so "no suggestions" never fired in a real browser.

## Tried and ruled out
- A third `eol_source` attribute: every writer would have to set and clear it in step with the other two.
- Storing cycle dates as Date columns: the workspace bundle reads cells back as strings, so ISO strings + JSONB scalars for eol/support avoid coercion and match the upstream cycle shape.

## Watch out
- `support` follows the endoflife.date API, where `true` means STILL supported; the product FILE's `eoas: true` means support has ENDED, and `eol: true` means ended in both. `milestoneMode/milestoneValue(kind)` in lib/eolCustom.ts encode this; eolContribution inverts support into eoas.
- AG Grid infers cellDataType from the first row: a column mixing `true`/`false` and date strings became a checkbox column and dropped the valueFormatter. The custom products grid sets `cellDataType: false` in defaultColDef.
- A grid reload after a failed write must not clear the error state, or the user never sees why (the delete 409 was wiped by the reload that followed it).

In the code: backend/app/services/eol_custom_service.py, backend/app/services/eol_service.py (resolve_eol_statuses custom_cycles), backend/app/services/workspace_io/schema.py (EolCustomProducts / EolCustomCycles sections), frontend/src/lib/eolCustom.ts, frontend/src/lib/eolContribution.ts, frontend/src/features/admin/CustomEolProductsGrid.tsx, frontend/src/components/EolLinkSection.tsx (STRONG_MATCH).
