# Screenshot Placeholders

Drop your screenshots here. The HTML references the following filenames:

## Hero
- `dashboard.png` — Main product screenshot (1200x700 recommended)

## Product Showcase (between Features and Architecture)
- `inventory.png` — Inventory page with AG Grid (1100x600)
- `fact-sheet-detail.png` — Fact sheet detail view (540x400)
- `diagram-editor.png` — DrawIO diagram editor (540x400)
- `end-of-life.png` — End-of-Life tracking view (540x400)
- `web-portal.png` — Public web portal view (540x400)

## BPM Solution
- `bpmn-editor.png` — BPMN 2.0 process editor (1100x600)
- `bpmn-viewer.png` — Process viewer with EA overlays (540x400)
- `process-element-linker.png` — Link BPMN elements to EA fact sheets (540x400)
- `process-assessment.png` — Process assessment scores (540x400)
- `bpm-dashboard.png` — BPM dashboard & KPIs (540x400)
- `bpm-capability-heatmap.png` — Process-capability heatmap (540x400)

## Reports (tabbed showcase)
- `portfolio-report.png` — Portfolio bubble chart (800x500)
- `capability-heatmap.png` — Capability heatmap (800x500)
- `lifecycle-roadmap.png` — Lifecycle timeline (800x500)
- `dependency-graph.png` — Dependency network graph (800x500)
- `cost-treemap.png` — Cost treemap (800x500)
- `matrix-report.png` — Matrix cross-reference (800x500)
- `data-quality.png` — Data quality dashboard (800x500)

## How to use
Replace each `<div class="screenshot-placeholder">` in `index.html` with:
```html
<img src="assets/screenshots/FILENAME.png" alt="Description" class="screenshot-img">
```
