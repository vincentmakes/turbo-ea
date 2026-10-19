---
title: "Admin-managed card type categories: where the registry lives and what the review caught"
author: Claude
date: 2026-10-19
branch: feat/metamodel-categories
touches:
  - backend/app/services/card_type_categories.py
  - backend/app/api/v1/metamodel.py
  - backend/app/services/workspace_io/applier.py
  - backend/alembic/versions/156_card_type_categories.py
  - frontend/src/hooks/useCardTypeCategories.ts
  - frontend/src/lib/cardTypeOrder.ts
  - frontend/src/features/reports/ldvLayoutShared.ts
  - frontend/src/features/admin/metamodel/CategoryCombobox.tsx
  - frontend/src/features/admin/metamodel/ManageCategoriesDialog.tsx
---

## Decided
- A category is a row of `card_type_categories`, modelled on `resource_types` (seeded insert-only, `built_in` lock, `translations`, a `ConfigSection` for workspace transfer, exposed on `/settings/bootstrap`). `card_types.category` keeps holding a plain string that is the row's `key`; the four defaults are keyed by their historical names, so no card-type row and no older bundle changed.
- The route refuses an unknown category (`400 unknown_category`, except a type's own current value re-sent), the importers adopt one (`ensure_categories`): workspace applier, content packs, platform migration's `"Imported"`.
- The categories sheet is applied by a bespoke applier placed FIRST in `_run`'s section list: a generic `ConfigSection` would land after `_apply_card_types`, and `_make_config_applier` overwrites every non-key column, `built_in` included. On a built-in target row only `sort_order` is applied.
- Order, colour and translated label come from the registry on every surface; the three hard-coded four-name lists (`cardTypeOrder.ts`, `metamodel/constants.ts`, `ldvLayoutShared.ts`) are gone, with `CARD_TYPE_CATEGORY_ORDER` kept only as the no-registry fallback. The LDV builders take an optional pre-resolved `layers` object (`ldvLayers(categories, locale, uncategorizedLabel)`) so the SDK surface only gained.
- A type with no category is the sentinel `__uncategorized__` everywhere (never the literal "Other", which an admin may create), and `normalize_key` refuses that sentinel as a name.
- Duplicate check on create AND rename compares the case-folded name against other rows' key OR label; after renaming `Foo` to `Bar`, a key-only check let a second `Bar` in.

## Tried and ruled out
- Slug keys for custom categories with a data migration of `card_types.category`: would have changed every consumer keyed on the names (`LAYER_COLORS`, fixtures, older bundles, the SDK's `category` string) for nothing the admin sees.
- Rebuilding the frontend singleton cache from the dialog's own `categories` snapshot after a write: a write made before the registry loaded wiped the built-ins from the cache for the session. Writes now `await refresh()`.
- Caching a failed `/metamodel/categories` fetch as `[]`: no component ever retried. Failure leaves `_cached` null.

## Watch out
- `conftest.py` never runs the seed, so an API test that sends a card-type `category` needs the `default_categories` fixture (only one existing site did, in `test_metamodel.py`).
- `seed.py` constants used by `test_i18n_seed.py` must be module-level; `_builtin_resource_types` is function-local and cannot be imported.
- `test_workspace_applier_cards_exact.py` pins the applier's section order; inserting a section changes it.
- The card-type audit row must log the category LABEL (`audit_labels.category_labels`), not the key — a renamed custom category's key is a name nobody can find in the manage dialog.
- Security-log action labels resolve through `securityLog.actionLabels.<action with underscores>` with the raw action as fallback and no test pins them; add the keys in all 10 `admin.json` files and the row in `docs/admin/audit-log*.md`.
- Screenshot ids are string prefixes; the metamodel categories capture is `100_admin_metamodel_categories`, the first three-digit id.
