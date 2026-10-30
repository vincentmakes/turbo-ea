---
title: A breakdown jump opens the section in edit mode
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 9, tokens: 25282 }
id: l-c7618f1a
scope: repo
status: active
src: agent
touches:
  - frontend/src/hooks/useEditRequest.ts
  - frontend/src/features/cards/CardDetailContent.tsx
  - frontend/src/features/cards/dataQualityJump.ts
  - frontend/src/features/cards/sections/AttributeSection.tsx
  - frontend/src/features/cards/sections/RelationsSection.tsx
  - frontend/src/features/cards/sections/TagsSection.tsx
  - frontend/src/features/cards/sections/StakeholdersTab.tsx
---

## Decided
A data-quality jump also asks the target to open for editing: `CardDetailContent` keeps one request object per jump (`editOn(anchor)` for Card-tab sections, `addOn` for the Stakeholders tab) and each receiver acts on it through `useEditRequest(request, canAct, act)`. `canAct` is the edit right plus whatever loads after mount (tag groups; the relation list and relation types), so a request that arrives early is acted on once the section can. A field is focused through its edit wrapper's `data-field-key` (`focusFieldControl`). Without edit rights the jump stays expand-and-scroll.

## Watch out
The Card tab body and the Stakeholders tab unmount when the user switches tabs and remount with the last request still in their props, so a per-instance "acted on this nonce" ref is not enough: returning to the tab would drop the user into edit mode again. `useEditRequest` also records handled request objects in a module-level WeakSet, which is why `addOn` is an object `{ nonce }` and not the bare nonce number. Inside an async `act()` a `findBy*` never sees the effects it waits for; find first, then `act(() => el.click())`.
