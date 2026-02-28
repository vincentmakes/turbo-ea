# Reports

Turbo EA includes a powerful **visual reporting** module that allows analyzing the enterprise architecture from different perspectives. All reports can be [saved for reuse](saved-reports.md) with their current filter and axis configuration.

![Available Reports Menu](../assets/img/en/09_reports_menu.png)

## Portfolio Report

![Portfolio Report](../assets/img/en/10_report_portfolio.png)

The **Portfolio Report** displays a configurable **bubble chart** (or scatter plot) of your cards. You choose what each axis represents:

- **X axis** — Select any numeric or select field (e.g., Technical Suitability)
- **Y axis** — Select any numeric or select field (e.g., Business Criticality)
- **Bubble size** — Map to a numeric field (e.g., Annual Cost)
- **Bubble color** — Map to a select field or lifecycle state

This is ideal for portfolio analysis — plotting applications by business value vs. technical fitness, for example, to identify candidates for investment, replacement, or retirement.

## Capability Map

![Business Capability Map](../assets/img/en/11_capability_map.png)

The **Capability Map** shows a hierarchical **heatmap** of the organization's business capabilities. Each block represents a capability, with:

- **Hierarchy** — Main capabilities contain their sub-capabilities
- **Heatmap coloring** — Blocks are colored based on a selected metric (e.g., number of supporting applications, average data quality, or risk level)
- **Click to explore** — Click any capability to drill down into its details and supporting applications

## Lifecycle Report

![Lifecycle Report](../assets/img/en/12_lifecycle.png)

The **Lifecycle Report** shows a **timeline visualization** of when technology components were introduced and when they are planned to be retired. Critical for:

- **Retirement planning** — See which components are approaching end-of-life
- **Investment planning** — Identify gaps where new technology is needed
- **Migration coordination** — Visualize overlapping phase-in and phase-out periods

Components are displayed as horizontal bars spanning their lifecycle phases: Plan, Phase In, Active, Phase Out, and End of Life.

## Dependencies Report

![Dependencies Report](../assets/img/en/13_dependencies.png)

The **Dependencies Report** visualizes **connections between components** as a network graph. Nodes represent cards and edges represent relations. Features:

- **Depth control** — Limit how many hops from the center node to display (BFS depth limiting)
- **Type filtering** — Show only specific card types and relation types
- **Interactive exploration** — Click any node to recenter the graph on that card
- **Impact analysis** — Understand the blast radius of changes to a specific component

## Cost Report

The **Cost Report** provides financial analysis of your technology landscape:

- **Treemap view** — Nested rectangles sized by cost, with optional grouping (e.g., by organization or capability)
- **Bar chart view** — Cost comparison across components
- **Aggregation** — Costs can be summed from related cards using calculated fields

## Matrix Report

The **Matrix Report** creates a **cross-reference grid** between two card types. For example:

- **Rows** — Applications
- **Columns** — Business Capabilities
- **Cells** — Indicate whether a relation exists (and how many)

This is useful for identifying coverage gaps (capabilities with no supporting applications) or redundancies (capabilities supported by too many applications).

## Data Quality Report

The **Data Quality Report** is a **completeness dashboard** that shows how well your architecture data is filled in. Based on field weights configured in the metamodel:

- **Overall score** — Average data quality across all cards
- **By type** — Breakdown showing which card types have the best/worst completeness
- **Individual cards** — List of cards with the lowest data quality, prioritized for improvement

## End of Life (EOL) Report

The **EOL Report** shows the support status of technology products linked via the [EOL Administration](../admin/eol.md) feature:

- **Status distribution** — How many products are Supported, Approaching EOL, or End of Life
- **Timeline** — When products will lose support
- **Risk prioritization** — Focus on mission-critical components approaching EOL

## Process Map

The **Process Map** visualizes the organization's business process landscape as a structured map, showing process categories (Management, Core, Support) and their hierarchical relationships.
