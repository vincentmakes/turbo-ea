---
title: "The data quality breakdown opens as a docked side panel on click; the bar's score figure is the chip-button that opens it"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 10, tokens: 32634 }
id: l-24eba8cd
scope: repo
status: active
replaces: l-f391a567
src: agent
touches:
  - CHANGELOG.md
  - docs/admin/settings.md
  - docs/guide/card-details.md
  - frontend/UI_GUIDELINES.md
  - frontend/src/features/cards/CardDetail.gainFlight.test.tsx
  - frontend/src/features/cards/CardDetailContent.focus.test.tsx
  - frontend/src/features/cards/CardDetailContent.tsx
  - frontend/src/features/cards/dataQualityJump.test.ts
  - frontend/src/features/cards/dataQualityJump.ts
  - frontend/src/features/cards/gamification/StickyScoreBar.test.tsx
---

## Decided
A click on the score (the header ring, or the sticky bar's score figure) opens the full breakdown directly as a narrow docked panel on the right of the card page; it stays open across jumps, saves and the next card until its Close button, and the open state is remembered per browser. Hover keeps the top-three tooltip. Below the `md` breakpoint the same content opens in a temporary right drawer that closes before a jump. On the bar the figure itself is a small outlined chip-button with a trailing chevron (`93% ›`, tooltip "Raise score"), because nobody guesses that a bare figure is clickable. The panel is available to everyone; only the sticky bar is TurboRPG-only.

## Tried and ruled out
A click-popover plus a "pin" that turned it into the panel (and, before that, a pin on the bar that kept the bar on screen): the pin read as "pin the bar", a hidden click target was undiscoverable, and three surfaces for one thing were two too many. A separate outlined "Raise score" button beside the figure: right idea, too long for the bar.

## Watch out
Keep the hosts (ring tooltip, docked panel, small-screen drawer) over one `DataQualityBreakdownContent`; never fork the body. The ring without `onOpenBreakdown` (the card preview side panel) is tooltip-only on purpose. `useMediaQuery(..., { noSsr: true })` for the docked/drawer choice, or a remembered panel flashes up as a drawer on a wide window's first render.

In the code: `frontend/src/features/cards/sections/DataQualityBreakdownContent.tsx`, `DataQualityBreakdownPanel.tsx`, `DataQualityBreakdownHost.tsx`, `frontend/src/lib/dataQualityPanel.ts` (key `turboea_dq_panel_open`), `DataQualityPill.tsx` (`onOpenBreakdown` / `breakdownOpen`), `gamification/StickyScoreBar.tsx` (`sticky-score-figure` chip-button, `rightInset`), `CardDetail.tsx` (`card-detail-page-frame` padding, `panelDocked`).
