---
title: "Charts are drawn with one shared ECharts layer; the Recharts SDK entries are deprecated at a minor, not removed"
author: Claude
date: 2026-10-30
branch: worktree-agent-ac4fbed3b28416872
cost: { minutes: 68, tokens: 304385 }
id: l-48ffaf1e
scope: repo
status: active
src: agent
touches:
  - frontend/src/components/charts/EChart.tsx
  - frontend/src/components/charts/echartsTheme.ts
  - frontend/src/components/charts/chrome.ts
  - frontend/src/test/echartMock.tsx
  - frontend/src/lib/extensionHost.tsx
  - frontend/src/hooks/useChartTheme.ts
  - ".claude/rules/extensions-ui.md"
---

## Decided
- Every core chart (homepage dashboards, and now the Cost and Data Quality reports) is drawn through one shared layer in `frontend/src/components/charts/`: `EChart.tsx` (the wrapper), `echartsTheme.ts` (`useEChartsTheme` / `buildEChartsChrome`, the MUI-derived chrome that handles light, dark and RTL once) and `chrome.ts` (pure option helpers: `tooltip`, `axisLabel`, `grid`, `legend`, `valueLabel`, `treemapLabel`, `niceMax`, `escapeHtml`). A report chart builds its option in a pure `*ChartOption.ts` module so the option is unit-testable without a canvas.
- Report charts render at `EXPORT_DPR = 2` (backing-store scale) because `reportExport.ts` and saved-report thumbnails capture with html-to-image at `pixelRatio: 2`; a canvas at a DPR-1 screen's scale would be upscaled into a blurry PPTX image (unlike Recharts' SVG, a canvas does not re-rasterise).
- Migrated report charts set `legend.selectedMode: false`: Recharts legends never toggled series, so a clickable ECharts legend would be a behaviour change nobody asked for. Dashboards keep the default.
- Every card or metamodel string that reaches a tooltip `formatter` passes through `escapeHtml`: ECharts renders formatter output as HTML, Recharts rendered text.
- UI SDK 1.32 adds `loadECharts` (lazy, the `loadAgGrid` shape: wrapper + `EXPORT_DPR` / `ECHART_CLASS`, `useEChartsTheme`, `buildEChartsChrome`, the `chrome` namespace). `loadRecharts` (1.8) and `useChartTheme` (1.9) are deprecated at this minor and removed at UI SDK 2.0, because private extensions in the vendor's repo may still chart with them; `recharts` stays in `package.json` until then. The host must never import `components/charts` statically (it would put ECharts in the eager main bundle); a source-scan test in `extensionHost.test.tsx` pins that.
- The migration ships as two PRs (reports + SDK first, BPM + PPM + cleanup second) to keep each PR's Stryker mutation job inside its time budget.

## Tried and ruled out
- Removing `recharts` now with a UI SDK 2.0 bump: the host only checks the SDK major, so every private extension that charts would stop loading before it could migrate.
- Keeping Recharts and its per-chart RTL hacks (`lib/rechartsRtl.tsx`): each chart mirrored axes and labels by hand; ECharts takes RTL once from the theme chrome.

## Watch out
- jsdom cannot initialise ECharts (no canvas): every test that mounts a chart component mocks `@/components/charts/EChart` with `src/test/echartMock.tsx` and asserts on the captured option, clicking through `echartState.click(...)`.
- The worktree isolation the harness gives a subagent starts at origin/main, not at the branch the orchestrator is on: `git merge --ff-only <branch tip>` before editing.
- `npm ci` needs npm 11 (`npx --yes npm@11 ci`) because npm 10 refuses the nested overrides in `package.json`.
- `vite build` runs out of memory in the cloud session; leave the build (and the single-`echarts`-chunk check) to CI.

In the code: `frontend/src/components/charts/EChart.tsx`, `frontend/src/components/charts/echartsTheme.ts`, `frontend/src/components/charts/chrome.ts`, `frontend/src/test/echartMock.tsx`, `frontend/src/lib/extensionHost.tsx` (`loadECharts`), `frontend/src/hooks/useChartTheme.ts`, `.claude/rules/extensions-ui.md`.
