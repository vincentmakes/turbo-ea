---
title: "On a Layered Dependency View card the type line takes the first of the two lines, ahead of any picked field"
author: Claude
date: 2026-11-10
branch: claude/wizardly-pascal-z9mrny
cost: { minutes: 9, tokens: 123646 }
id: l-55b3ddf6
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - docs/guide/reports.ar.md
  - docs/guide/reports.da.md
  - docs/guide/reports.de.md
  - docs/guide/reports.es.md
  - docs/guide/reports.fr.md
  - docs/guide/reports.it.md
  - docs/guide/reports.md
  - docs/guide/reports.pt.md
---

## Decided
The card type is the first of a Layered Dependency View card's two caption lines, then subtype, alias and attribute fields in the order the Show on card menu lists them. It used to be a fallback drawn only when no other line existed, so ticking Alias beside Card type made the type vanish (#1377). The menu counts Card type as a pick and says the first two appear, and the DrawIO editor and the Create diagram export already put the type first, so the report card was the one surface out of step.

## Tried and ruled out
Letting picked fields keep both lines and showing the type only when there is room: that is the old behaviour, and it is what the reporter read as "an unticked option appears and a ticked one does not".

## Watch out
- Card type is ticked by default, so a reader with Card type plus two fields now sees type + the first field where they used to see both fields. This is intended; the second field is in the tooltip and unticking Card type gives both lines back. Do not "restore" the two fields.
- The bracketed line on a card is the card TYPE. A report that says "the subtype shows although unticked" is most likely reading the lane header (the layer, e.g. Business Architecture) as the type and the bracketed type as the subtype.
- The name drops to one line whenever two caption lines are shown in total, type included; the card has a fixed height and nothing clips it.

In the code:
- `cardLineBudget(showType, extraLineCount)` in `frontend/src/features/reports/ldvViewModel.ts` shares out `MAX_CARD_LINES`; `LdvNode` in `LayeredDependencyView.tsx` renders from it.
- The node data contract is unchanged (`showType` + `extraLines`), so `ldvDiagramExport.ts` still prepends its own type row.
- Guard tests: `LdvNode.test.tsx` (#1377 cases), `ldvViewModel.test.ts`.
