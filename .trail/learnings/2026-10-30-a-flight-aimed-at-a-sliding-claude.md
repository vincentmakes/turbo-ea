---
title: A flight aimed at a sliding-in sticky bar must wait for the slide to end
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 119, tokens: 618629 }
id: l-e42c0a7b
scope: repo
status: active
src: agent
touches:
  - docs/admin/settings.ar.md
  - docs/admin/settings.da.md
  - docs/admin/settings.de.md
  - docs/admin/settings.es.md
  - docs/admin/settings.fr.md
  - docs/admin/settings.it.md
  - docs/admin/settings.pt.md
  - docs/admin/settings.ru.md
  - docs/admin/settings.zh.md
  - docs/guide/card-details.ar.md
---

## Decided
The sticky score bar hands its figure element to the page only once its MUI `Slide` has finished entering (`onEntered`), and takes it back (`null`) on `onExit`; under reduced motion it hands it over as soon as it exists, because no orb flies then anyway. `GainFlight` treats a missing target differently from a missing origin: with an origin but no target it waits a fixed `TARGET_WAIT_MS` (500 ms, more than the Slide's 225 ms) for one to arrive, re-measuring when it does, and only then gives up and reports the impact at once.

## Tried and ruled out
Measuring the target once on mount from whatever element the page held. In the browser the save that raised the score was also the scroll that pushed the header off screen, so the sticky bar was still sliding in when the gain arrived; `getBoundingClientRect()` on a Slide child mid-transition is its pre-slide position above the viewport, and the orb flew off the top of the page (sampled end point y = -17 instead of 80) while the pill played the impact.

## Watch out
A fixed-position element inside a `Slide`/`Grow`/`Fade` reports its *current* transformed box, not its resting one. Any flight or pointer aimed at such an element has to be gated on the transition's `onEntered`, or it will aim at the wrong place in exactly the moment the transition is most likely running: right after the state change that caused both.

In the code: `frontend/src/features/cards/gamification/StickyScoreBar.tsx` (`entered` state, `ready = entered || reduced`, `onFigureRef` effect), `frontend/src/features/cards/gamification/GainFlight.tsx` (`TARGET_WAIT_MS`, `measuredRef`), tests in `StickyScoreBar.test.tsx` ("hands its figure to the page only once it has slid in") and `GainFlight.test.tsx` ("flies to a target that arrives during the wait").
