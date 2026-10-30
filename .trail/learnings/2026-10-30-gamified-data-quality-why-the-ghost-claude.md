---
title: "Gamified data quality: why the ghost leads, why the pop alternates, why the header hook takes an element"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 98, tokens: 401978 }
id: l-55e9af13
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/CardDetail.tsx
  - frontend/src/features/cards/sections/DataQualityPill.tsx
---

## Decided
- The gain "ghost" in `ScoreBar` LEADS: it jumps to the new score at once (band colour at 35 %) and the solid fill holds at the old score for `GHOST_HOLD_MS` (400 ms), then fills into it over `FILL_MS`. The approved plan described the game-damage pattern (ghost lingers at the OLD value while the fill moves); for a gain the fill is always at or above the old value, so a trailing ghost sits entirely under the fill and is never seen. Leading is what keeps "the size of the gain readable".
- Transitions only run while a gain plays (`animate`, `ghostFrom < value`, no reduced motion). A drop, an unchanged score and a first mount set the transform with `transition: none` — "never punish" is enforced in the bar, not left to callers.
- Replaying a CSS animation without remounting: the pill root alternates `dq-pop` / `dq-pop dq-pop-alt` by nonce parity, two identical keyframes under two names. Remounting the pill (a `key`) would detach the breakdown popover's anchor.
- The glow is a ring that scales and fades (`transform` + `opacity`), not a `box-shadow` pulse as the plan said: the motion rule is compositor-only properties, and the pill root's `overflow: hidden` would clip a shadow anyway, so the ring is a sibling inside a wrapper that only exists with `animate`.
- `useHeaderOffscreen` takes the element (callback ref held in state), not a ref object: the card header mounts only after the card loads, and an effect keyed on a ref object never sees it arrive. It also checks `boundingClientRect.top < 64` so a header below the fold does not count as gone.
- `useGamificationEnabled()` returns a plain boolean (not the `{x, loaded, invalidate}` object of the sponsor hook): its only readers branch on it.

## Watch out
- MUI `sx` multiplies a numeric `borderRadius` by `theme.shape.borderRadius` (4): `radius={5}` was 20 px. `ScoreBar` turns a number into px itself.
- Keyframes injected through a raw `<style>` are not run through `stylis-plugin-rtl`, while `sx` is. Keep X translations out of the injected CSS (the float only moves on Y; centring is done with flex in `sx`), or RTL layouts drift.
- jsdom's `matchMedia` stub (`src/test/matchMedia.ts`) only parses width queries, so `(prefers-reduced-motion: reduce)` is always false in tests; mock `./useReducedMotion` to test the static fallback.
