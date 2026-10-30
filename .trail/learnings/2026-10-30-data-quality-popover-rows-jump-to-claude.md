---
title: Data-quality popover rows jump to where a slot is filled
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 69, tokens: 281589 }
id: l-d6ad03d7
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/CardDetailContent.tsx
  - frontend/src/hooks/useSyncedExpanded.ts
  - frontend/src/features/cards/sections/DataQualityPill.tsx
  - frontend/src/features/cards/CardDetail.tsx
  - frontend/src/components/CardDetailSidePanel.tsx
---

## Decided
- A popover row jumps by DOM id, not by route or hash: `jumpTargetFor` (dataQualityJump.ts) maps a factor to a tab plus an anchor; each section's Accordion root carries that id, and `CardDetailContent` opens the tab, asks the section to expand through `useSyncedExpanded(initial, expandOn)`, then scrolls 250 ms later because the Card tab body unmounts on other tabs and must mount first. A hash would also have to work in the side panel, whose scroll container is the Drawer paper and which has no URL of its own.
- `expandOn` is a nonce, not a boolean: clicking the same row twice must re-open a section the user collapsed in between, and a boolean that is already `true` never fires the effect again.
- The tooltip's rows stay text; a tooltip is not interactive. Without `onJump` the popover rows stay text too.
- A relation slot targets its `RelationGroup` (`card-relation-<rt>-<side>`) with the Relations section as fallback: relations load asynchronously, so the group may not exist yet when the scroll fires.

## Watch out
- The page's jump state carries the card id (`focusTarget?.cardId === card.id`): `CardDetail` stays mounted across a route change to another card, and `CardDetailContent` is keyed by card id, so an unkeyed jump would replay on the next card's mount (child effects run before the parent could clear it).
- Two attribute sections whose names slug alike share an id; the first one wins the scroll.
