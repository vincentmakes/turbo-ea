---
title: "On an inverted ECharts axis the markLine start is the right edge, so an RTL end label uses insideEnd"
author: Claude
date: 2026-10-30
branch: claude/echarts-bpm-ppm
cost: { minutes: 45, tokens: 119613 }
id: l-952b73b6
scope: repo
status: active
src: agent
touches:
  - "frontend/src/features/ppm/cumulativeChartOption.ts#budgetLabelPosition"
  - "frontend/src/features/ppm/cumulativeChartOption.ts#budgetAxisMax"
  - frontend/src/features/bpm/useBpmFieldOptions.ts
  - frontend/src/components/charts/EChart.tsx
---

## Decided
- The PPM cost charts' budget reference lines are a `markLine` on the first line series. Their in-place label uses `insideEnd*` in BOTH directions: with `xAxis.inverse: true` the axis extent runs `[width, 0]`, so ECharts' markLine "start" is the right edge and "end" the left edge. `insideStart` in RTL would park the label next to the y axis, at the earliest month (verified in `MarkLineView.updateSingleMarkerEndLayout` and `Grid.updateAxisExtentTransByGridRect`).
- The label goes `insideEndBottom` when the budget is the axis top (`budgetLabelPosition`), so it is never clipped above the grid.
- The y axis `max` is extended to the budget only when the budget exceeds the data (`budgetAxisMax`): the contract Recharts' `ifOverflow="extendDomain"` gave, so a budget above every month's spend stays visible.

## Tried and ruled out
- Mirroring the label position by `isRtl` (`insideStart*` in RTL): wrong edge, because the inverted axis already flips what "start" means.
- An invisible series carrying the budget value to stretch the axis: a `max` function is enough and adds no phantom series to the legend or tooltip.

## Watch out
- `markLine` needs `MarkLineComponent` registered in `components/charts/EChart.tsx`; without it the budget lines silently do not draw.
- The BPM maturity and automation axes resolve their labels through the metamodel option labels (`useBpmFieldOptions`), never the raw stored keys; drill-down URLs still use the raw key.

In the code: `frontend/src/features/ppm/cumulativeChartOption.ts` (`budgetLabelPosition`, `budgetAxisMax`), `frontend/src/features/bpm/useBpmFieldOptions.ts`, `frontend/src/components/charts/EChart.tsx`.
