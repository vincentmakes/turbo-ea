---
title: "EA Delivery opens for a reader of SoAWs or of decisions, each kind of document follows its own permission, and a card's ADRs tab stays hidden when empty for re…"
author: Claude
date: 2026-11-13
branch: claude/hopeful-bardeen-4c0keb
cost: { minutes: 31, tokens: 418221 }
id: l-8b54c8a2
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/cardTabs.ts
  - frontend/src/features/cards/CardDetailContent.tsx
  - frontend/src/features/ea-delivery/deliveryAccess.ts
  - frontend/src/lib/routePermissions.ts
  - frontend/src/features/ppm/PpmHome.tsx
  - frontend/src/features/ea-delivery/initiatives/useInitiativeData.ts
  - frontend/src/features/reports/EaDeliveryReport.tsx
  - frontend/src/features/ea-delivery/initiatives/NewArtefactSplitButton.tsx
---

## Decided
Issue #1400: a role with every SoAW permission removed and only `adr.view` + `adr.comment` still saw the SoAW tab on an Initiative card, and no ADRs tab on other cards. The owner's rulings (2026-11-13):

- The SoAW tab on an Initiative card needs `soaw.view`. Its New SoAW and delete actions need `soaw.manage`, not the right to edit the card, because that is what the API checks.
- The ADRs tab rule is kept as designed and documented: on a card with no linked decision the tab is hidden unless the role can link one (`adr.manage` or the card-level link permission). That half of the issue is expected behaviour, not a bug.
- EA Delivery lists SoAWs, diagrams and decisions, so the page opens for a role holding `soaw.view` or `adr.view`. A kind the role may not view is neither requested nor shown; "New artefact" and "+ Add" offer only the kinds the role may create, and disappear for a reader. The EA Delivery tab inside PPM follows the same gate as the standalone page.

## Tried and ruled out
- Always showing the ADRs tab to any `adr.view` holder: it would reverse the "no empty tab for read-only users" rule that Risks and Compliance follow too.
- Fixing only the card tab: a decision reader would still have had no page listing decisions per initiative, and under PPM the EA Delivery tab opened onto a failed load, because one refused list failed all four requests.
- Offering to create a kind the role cannot view: the new document's page would refuse to open, so "creatable" is a subset of "viewable".

## Watch out
- Left as it was: EA Delivery for a role without `inventory.view` still fails on the initiative list, and with PPM on a role without `ppm.view` has no menu entry for EA Delivery (the page is reachable by URL only).
- The decision register is under GRC, Governance; EA Delivery only lists decisions per initiative.
- For a live check with "View as role": the demo seed creates users, so a freshly registered account is a member, not the admin; registration refuses `.test` e-mail domains.
- In a cloud session `npm ci` in `frontend/` only works with Node 24 (as CI uses); with Node 22 it reports the lock file out of sync. `tsc -b` needs a larger heap than the default (`NODE_OPTIONS=--max-old-space-size=6144`).

In the code: `frontend/src/features/ea-delivery/deliveryAccess.ts` (the one definition of viewable / creatable kinds), `frontend/src/features/cards/cardTabs.ts` (`canViewSoaw`), `frontend/src/lib/routePermissions.ts` (`/reports/ea-delivery` → `["soaw.view", "adr.view"]`), `frontend/src/features/ppm/PpmHome.tsx`, `frontend/src/features/ea-delivery/initiatives/useInitiativeData.ts`.
