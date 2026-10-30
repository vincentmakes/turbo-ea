---
title: "Gamified data quality: the gain flies from the saved section"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 107, tokens: 493037 }
id: l-84abb440
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/CardDetailContent.tsx
  - frontend/src/features/cards/gamification/useScoreGain.ts
  - frontend/src/features/cards/gamification/GainFlight.tsx
---

CardDetailContent reports a save origin (`onSaveOrigin(anchor)`) AFTER the PATCH / refetch resolves and right before `onCardUpdate`, in the same tick, so React batches both setStates into one render; `useScoreGain` relies on that: the render that sees a new origin nonce is the render that sees the new score, so it stamps the anchor then, and drops a new origin whose save left the score unchanged. Reporting before the PATCH was ruled out: a failed or score-neutral save would leave a stale origin that a later header save (name, subtype) would then fly from. `GainFlight` measures both ends once on mount (keyed by the change nonce) and calls `onImpact` at once when the origin element, the target or motion is missing, because the pill and sticky bar hold a gain with an `originAnchor` until `impactNonce` matches; anything that skips the flight without calling `onImpact` would freeze the pill at the old score.
