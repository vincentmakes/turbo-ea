---
title: "The card preview panel decides which card it shows, so it can ask before unsaved edits are dropped; its guard ignores same-page URL changes and browser Back"
author: Claude
date: 2026-11-13
branch: claude/determined-tesla-sryiwz
cost: { minutes: 23, tokens: 176867 }
id: l-6ef412f6
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/CardDetailSidePanel.tsx
  - frontend/src/hooks/useUnsavedChangesGuard.ts
  - frontend/src/features/inventory/InventoryPage.tsx
---

## Decided
Issue #1397: the preview side panel dropped unsaved section edits silently (the full card page already warned, #843). The fix lives in the panel, not in its ~20 callers: the panel keeps its own "shown card" and only follows the parent's request after asking when a section is dirty. If the user says no, it keeps the card and hands the id back through an optional callback so the parent can restore its state (only the Inventory needs it: it is the one non-modal caller, where another row can be clicked while the panel is open). Close button, Escape and backdrop go through one guarded close.

## Tried and ruled out
- Guarding in each caller (wrapping every preview setter): ~20 callers plus extension reports that cannot be changed.
- Using the page-level unsaved-changes guard as is: the Inventory writes its filters to the query string while the panel is open, so every filter change would prompt "Leave without saving?". The guard got a path-only mode.
- Keeping the Back/Forward history sentinel in path-only mode: a same-path replace rewrites the sentinel entry (Back then rewinds the query string instead of leaving, even when declined) and a same-path push stacks above it and leaves dead entries. Path-only mode skips it, so browser Back with a dirty panel leaves without asking. Owner may revisit.

## Watch out
- One request must be asked once: the panel remembers a declined target (StrictMode / parent re-render before it restores state) and an approved close (the parent's open=false that follows its own confirmed close).
- `vite build` runs out of heap in a cloud session; `NODE_OPTIONS=--max-old-space-size=8192` fixes it.

In the code: frontend/src/components/CardDetailSidePanel.tsx (shownId, requestClose, onKeepCard), frontend/src/hooks/useUnsavedChangesGuard.ts ({ pathOnly }), frontend/src/features/inventory/InventoryPage.tsx (onKeepCard={setPreviewCardId}).
