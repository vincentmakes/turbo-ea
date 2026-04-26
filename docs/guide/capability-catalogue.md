# Capability Catalogue

Turbo EA ships with the **[Business Capability Reference Catalogue](https://capabilities.turbo-ea.org)** — a curated, open catalogue of business capabilities maintained at [github.com/vincentmakes/turbo-ea-capabilities](https://github.com/vincentmakes/turbo-ea-capabilities). The Capability Catalogue page lets you browse this reference and create matching `BusinessCapability` cards in bulk, instead of typing them in one by one.

## Opening the page

Click the user icon in the top-right corner of the app, then **Capability Catalogue**. The page is available to anyone with the `inventory.view` permission.

## What you see

- **Header** — the active catalogue version, the number of capabilities it contains, and (for admins) controls to check for and fetch updates.
- **Filter bar** — full-text search across id, name, description and aliases, plus level chips (L1 → L4), an industry multi-select, and a "Show deprecated" toggle.
- **Action bar** — match counters, the global level stepper (expand/collapse all L1s one level at a time), expand/collapse all, select-visible, clear selection.
- **L1 grid** — one card per top-level capability. The L1 name sits in a pale-blue header band; child capabilities are listed underneath, indented with a faint vertical rail to convey depth — the same hierarchy idiom used elsewhere in the app, so the page doesn't carry its own visual identity. Names wrap to multiple lines instead of being truncated. Each L1 header also exposes its own `−` / `+` stepper pill: `+` opens the next level of descendants for that L1 only, `−` closes the deepest open level. The two buttons are always visible (the inactive direction goes disabled), the action is scoped to that one L1 — other branches stay put — and the global level stepper at the top of the page is unaffected.

## Selecting capabilities

Tick the checkbox next to any capability to add it to the selection. Selection cascades down the subtree in both directions but never touches ancestors:

- **Ticking** an unselected capability adds it plus every selectable descendant.
- **Unticking** a selected capability removes it plus every selectable descendant.

So unticking a single child only removes that child and what's below — its parent and siblings stay selected. Unticking a parent removes the whole subtree in one action. To assemble an "L1 + a couple of leaves" selection, pick the L1 (which seeds the whole subtree) and then untick the L2/L3 capabilities you don't want — the L1 stays selected and its checkbox stays ticked.

The page picks up the app-wide light/dark theme automatically — dark mode renders the same neutral layout on `#1e1e1e` paper with lifted-lavender text and accents.

Capabilities that **already exist** in your inventory appear with a **green check icon** instead of a checkbox. They cannot be selected — you can never create the same Business Capability twice through the catalogue. Matching prefers the `attributes.catalogueId` stamp left by a previous import (so the green tick survives display-name edits) and falls back to a case-insensitive display-name match for cards you created by hand.

## Mass-creating cards

When you have one or more capabilities selected, a sticky **Create N capabilities** button appears at the bottom of the page. It uses the regular `inventory.create` permission — if your role doesn't allow card creation, the button is disabled.

On confirmation, Turbo EA:

- Creates one `BusinessCapability` card per selected catalogue entry.
- **Preserves the catalogue hierarchy** automatically — when both the parent and the child are selected (or the parent already exists locally), the new child card's `parent_id` is wired to the right card.
- **Skips existing matches** silently. The result dialog shows how many were created and how many were skipped.
- Stamps each new card's `attributes` with `catalogueId`, `catalogueVersion`, `catalogueImportedAt`, and `capabilityLevel` so you can trace where it came from.

Re-running the same import is safe — it's idempotent.

**Bidirectional linking.** The hierarchy is repaired in both directions, so the order in which you import doesn't matter:

- Selecting only a child whose catalogue **parent already exists** as a card grafts the new child onto that existing parent automatically.
- Selecting only a parent whose catalogue **children already exist** as cards re-parents those children under the new card — regardless of where they currently sit (top-level or hand-nested under another card). The catalogue is the source of truth for hierarchy on import; if you'd prefer a different parent for a specific card, edit it after the import. The result dialog reports how many cards were re-linked alongside the created and skipped counts.

## Detail view

Click any capability name to open a detail dialog showing its breadcrumb, description, industry, aliases, references, and a fully-expanded view of its subtree. Existing matches in the subtree are flagged with a green tick.

## Updating the catalogue (admins)

The catalogue ships **bundled** as a Python dependency, so the page works offline / in airgapped deployments. Admins (`admin.metamodel`) can pull a newer version on demand:

1. Click **Check for update**. Turbo EA queries `https://capabilities.turbo-ea.org/api/version.json` and tells you whether a newer version is available.
2. If yes, click the **Fetch v…** button that appears. Turbo EA downloads the latest catalogue and stores it as a server-side override, taking effect immediately for all users.

The active catalogue version is always shown in the header chip. The override is preferred over the bundled package only when its version is strictly greater — so a Turbo EA upgrade that ships a newer bundled catalogue will continue to work as expected.

The remote URL is configurable via the `CAPABILITY_CATALOGUE_URL` environment variable for self-hosted deployments that mirror the public catalogue internally.
