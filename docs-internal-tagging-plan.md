# Card Tagging — end-to-end plan

## Context

Tag Management admin now has full CRUD (shipped in 0.46.0), but cards still can't actually be tagged from the UI. The backend endpoints (`POST /cards/{id}/tags`, `DELETE /cards/{id}/tags/{tag_id}`) exist, `Card.tags` is already eagerly loaded with `group_name` populated, and demo seed has 5 tag groups — but nothing in the Card Detail or Inventory surfaces lets a user attach a tag to a card. This change wires tagging into every card type and the adjacent surfaces so tags become a usable categorisation axis.

## User decisions (confirmed)

- **Reports**: deferred. Existing reports have no filter bar; tag filtering will land in a dedicated PR.
- **Permission**: `tags.manage` OR `card.edit` for assigning/removing tags on a card. Tag-group/tag CRUD stays admin-only (`tags.manage`).
- **Excel**: export + import with `Group: Tag, Group: Tag` formatting.

## Scope

**In**

1. New **TagsSection** on Card Detail — renders current tags as coloured chips grouped by tag group, with an edit dialog that respects `mode: single | multi` and honours `restrict_to_types`.
2. Shared **TagPicker** component reusable in Card Detail edit, CreateCardDialog, Inventory filter sidebar, and Web Portal filter.
3. CreateCardDialog: tag picker on the create form; POST /cards then POST /cards/{id}/tags.
4. Inventory: tag column (chip renderer) + tag-filter section in the sidebar (one sub-section per tag group; AND across groups, OR within a group — matches relation filter).
5. Excel export + import of tags.
6. Web Portal viewer: tag filter in the sidebar (client-side, consistent with inventory).
7. Demo seed: extend tag coverage beyond Applications/BusinessContexts/ITComponents to Initiatives, Organizations, BusinessCapabilities, BusinessProcesses, DataObjects, Providers, Platforms.
8. Permission change: loosen `POST /cards/{id}/tags` + `DELETE /cards/{id}/tags/{tag_id}` to allow `tags.manage` OR `card.edit`.
9. i18n across 8 locales.
10. Tests: TagsSection, TagPicker, backend permission cases.
11. Version bump `0.46.0` → `0.47.0` + changelog.

**Out**

- Reports (dashboard, portfolio, matrix, etc.) — deferred.
- Bulk tag apply/remove from the inventory multi-select — deferred.
- `mandatory` enforcement on card save — surface the flag visually only; blocking save comes later.
- `PATCH /cards/{id}/tags` bulk-replace endpoint — TagsSection computes the diff client-side and calls existing POST + DELETE.

## Implementation chunks

Work is split into 5 chunks that each land a working tree and a commit/push, so a timeout never leaves the branch broken.

1. **Chunk 1** — Plan doc, backend permission loosening, `TagsSection.tsx`, CardDetailContent wiring, i18n keys. End state: every card can be tagged from the Card Detail.
2. **Chunk 2** — Shared `TagPicker.tsx` + CreateCardDialog integration. End state: tags can be set on a card at creation time.
3. **Chunk 3** — Inventory tag column + sidebar filter. End state: tags are visible and filterable in inventory.
4. **Chunk 4** — Excel export + import + Web Portal tag filter. End state: tags round-trip via Excel and portal visitors can filter.
5. **Chunk 5** — Demo seed coverage expansion + tests + changelog + version bump. End state: shippable 0.47.0.

## Design details

### Backend

- `backend/app/api/v1/tags.py` — change the permission check on `assign_tags` and `remove_tag` from `require_permission(db, user, "tags.manage")` to a combined check that passes if the user has either `tags.manage` globally or `card.edit` on the specific card. The `PermissionService` already supports this via `require_permission(db, user, "tags.manage", card_id=..., card_permission="card.edit")`.
- No new permission keys.
- No bulk-replace endpoint — existing POST is idempotent add, DELETE is per-tag. TagsSection computes the diff.

### Frontend — shared components

- `frontend/src/components/TagPicker.tsx` — controlled `Autocomplete` styled by group. Props:
  ```ts
  interface TagPickerProps {
    groups: TagGroup[];
    value: string[];
    onChange: (ids: string[]) => void;
    typeKey?: string;      // filters groups by restrict_to_types
    label?: string;
    disabled?: boolean;
  }
  ```
  Behaviour: flat `Autocomplete multiple` with `groupBy={(o) => o.group_name}`. When a group has `mode: "single"`, selecting a new tag in that group removes any existing tag in the same group. Mandatory groups get a small red asterisk on the group header.

### Frontend — Card Detail

- `frontend/src/features/cards/sections/TagsSection.tsx`
  - Renders a row of tag chips grouped by `group_name` (using `card.tags[].group_name`).
  - "Edit" pencil button (gated by `canEdit`) opens a dialog with a `TagPicker` preloaded with current tag IDs.
  - On save, compute diff (added/removed) and fire POST + DELETE in parallel; then call `onCardUpdate()` to refetch.
  - Wrapped in `<ErrorBoundary label="tags" inline>`.
- `frontend/src/features/cards/CardDetailContent.tsx`
  - Add `"tags"` to the hardcoded default section order — inserted between `successors` and `relations`. All 14 seeded card types pick this up for free (they don't set `section_config`).
  - Add a `case "tags":` branch to `renderSection`.
  - Prop: `canEdit = perms.can_edit` (same gate as DescriptionSection).

### Frontend — CreateCardDialog

- Add a "Tags" `TagPicker` after the subtype/name fields.
- On submit: POST /cards first (unchanged path), capture new id, then POST `/cards/{id}/tags` with the selected ids before navigating. If the tag POST fails, surface a warning but still navigate (card was created).

### Frontend — Inventory

- `frontend/src/features/inventory/InventoryPage.tsx`
  - Load `/tag-groups` once on mount into module-level cache (same pattern as metamodel).
  - New column `tags` — renderer: stacked coloured `Chip`s, max 3 visible, "+N" for the rest.
  - Extend `Filters` interface with `tagIds: string[]`.
  - Client-side filter in `filteredCards`: AND across groups, OR within a group. Matches the existing relation filter pattern.
- `frontend/src/features/inventory/InventoryFilterSidebar.tsx`
  - One collapsible section per tag group (respecting `restrict_to_types` when a type filter is active).
  - Checkbox per tag; label shows tag colour as a coloured dot.

### Frontend — Excel

- `excelExport.ts`: new `Tags` column. Value: tag entries formatted as `${group_name}: ${tag_name}` joined by `", "`.
- `excelImport.ts`: parse the same format. Split on `","`, then each entry on the first `":"`. Look up by `(group_name, tag_name)` against `/tag-groups` snapshot. Unknown entries surface as a validation warning; known entries are applied via POST /cards/{id}/tags after the card create/update.

### Frontend — Web Portal

- `frontend/src/features/web-portals/PortalViewer.tsx`: new collapsible "Tags" section in the sidebar (only rendered when the portal has any cards with tags). Client-side filter like inventory. No backend change needed — portal endpoint already returns tags.

### Demo seed

- `backend/app/services/seed_demo.py`: today 118 Application, 13 BusinessContext, 11 ITComponent assignments. Extend:
  - **Business Domain** (global): add assignments to Initiative + Organization + BusinessCapability cards.
  - **Lifecycle Stage** (currently Application-only): extend `restrict_to_types` to include `Initiative` and add Initiative assignments.
  - New group **Initiative Theme** (restrict to Initiative) with tags Digital / Cost-Out / Compliance / Growth.
  - New group **Data Sensitivity** (restrict to DataObject) with tags Public / Internal / Confidential / Restricted.
  - New group **Provider Tier** (restrict to Provider) with tags Strategic / Preferred / Commodity.
  - Sensible colour palette aligned with the existing groups.

### Permissions / seed metamodel

- No new permission keys — leverages existing `tags.manage` + `card.edit`.
- `seed.py` not touched — the hardcoded section order in CardDetailContent covers all 14 built-in types.

### i18n

New keys (all namespaces: `cards`, `inventory`, `portal`, `common` as appropriate) across all 8 locales:

- `cards:sections.tags` — section title "Tags"
- `cards:tags.edit` — "Edit tags"
- `cards:tags.noTags` — "No tags yet"
- `cards:tags.mandatoryMissing` — visual flag for a mandatory group with no selection
- `inventory:columns.tags` — column header
- `inventory:filters.tags` — filter section header
- `portal:filters.tags` — portal filter header

### Tests

- Backend:
  - `POST /cards/{id}/tags` succeeds for a member user who has `card.edit` but not `tags.manage`.
  - Still 403s for a pure `viewer`.
- Frontend:
  - `TagPicker` single-mode swap semantics.
  - `TagsSection` computes the correct diff on save.

### Verification

- `cd backend && ruff format . && ruff check .` + unit tests
- `cd frontend && npm run build && npm run test:run`
- JSON parse check across all 8 `admin.json` / `cards.json` / `inventory.json` / etc.
- Manual smoke against `SEED_DEMO=true`: open any Application card → Tags section → add/remove tags → verify chips update and sidebar filter respects them; open Inventory and filter by a tag; export to Excel, edit tags cell, re-import.

### Version + changelog

- `/VERSION`: `0.46.0` → `0.47.0`
- `CHANGELOG.md`: new `## [0.47.0] - 2026-04-22` with `### Added` entry covering the Tags section on Card Detail, shared picker, inventory filter, Excel round-trip, web portal filter, and expanded demo seed.
