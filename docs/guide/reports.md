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

### AI Portfolio Insights

When AI is configured and portfolio insights are enabled by an admin, the portfolio report shows an **AI Insights** button. Clicking it sends a summary of your current view to the AI provider, which returns strategic insights about concentration risks, modernisation opportunities, lifecycle concerns, and portfolio balance. The insights panel is collapsible and can be regenerated after changing filters or grouping.

## Flexible Portfolio

![Flexible Portfolio — Data Object portfolio grouped by Application, coloured by Data Sensitivity](../assets/img/en/57_report_flexible_portfolio.png)

The **Flexible Portfolio** uses the same controls as the Application Portfolio but adds a **Card type** picker at the top of the toolbar. Use it to analyse a portfolio of Business Capabilities, Initiatives, IT Components, or any other visible card type with the same grouping, colouring, and filter experience.

The screenshot above shows a typical use case: pick **Data Object** as the card type, **Group by → Application** to see which apps own which data, and **Color by → Data Sensitivity** to surface where confidential data lives at a glance.

Switching the card type clears the group-by, colour-by, and filter selections (they reference field keys that don't exist on the new type) and the report re-loads with the fields, relations, and tags applicable to the chosen type. The report shares the same permission as the Application Portfolio (`reports.portfolio`) and saves independently of it.

### Relation subtypes

When a card's relations carry a "type" value — for example the **Usage Type** (Owner / User / Stakeholder) on Organization→Application relations, or the **Support Type** on Application→Business Capability relations — you can colour the cards by that value and filter on it. **Group the report by the related card type** to use them (e.g. *Group by → Organization* to unlock *Usage Type*): the subtype then appears under a **Relation Subtypes** group in the *Color by* dropdown and as its own filter row. Because each card is shown under one related card, it is coloured by *that* relation — an application that is a *User* of one organisation shows as User there, even if it is owned by another.

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

### Layered Dependency View

![Layered Dependency View](../assets/img/en/13b_dependencies_c4.png)

Toggle to the **Layered Dependency View** using the view-mode buttons in the toolbar. This is Turbo EA's house notation for showing dependencies between cards across the four EA layers — inspired by ArchiMate's layering and the C4 Model's "good defaults" philosophy, but distinct from both. The same view is reused on the Card Detail page (showing the card's immediate dependency neighbourhood) and in the [TurboLens Architect](turbolens.md#architecture-ai) wizard, so dependencies look the same everywhere.

**Reading the diagram**

- **Layered swim lanes** — Cards are grouped by architectural layer (Strategy & Transformation, Business Architecture, Application & Data, Technical Architecture) inside dashed boundary rectangles, in fixed order.
- **Type-coloured nodes with icons** — Each node is coloured by its card type and shows the card-type icon in its top-left corner, so types are recognisable at a glance even without colour.
- **Directional labelled edges** — Edges follow the metamodel relation direction (source → target) and carry the relation's forward label (e.g. *uses*, *supports*, *runs on*). When a relation is qualified with a value (such as a Support Type of *Leading*), it appears in brackets after the label — for example *supports [Leading]*.
- **Proposed cards** — In the TurboLens Architect wizard, not-yet-committed cards have a dashed border and a green **NEW** badge.

**Exploring and navigating**

- **Pan, zoom, minimap** — Drag the canvas to pan, scroll to zoom, and use the minimap to navigate large diagrams.
- **Click to inspect** — Click any node to open the card detail side panel.
- **Recenter** — Shift+click or long-press a card to center the diagram on it; the toolbar's **Back to card picker**, **Previous card**, and **Next card** buttons step through your navigation history.
- **Highlight mode** — Hover a card to highlight its connections; on touch devices, turn on **Highlight mode** in the controls panel to tap-highlight instead.
- **Expand mode** — Turn on **Expand mode** in the controls panel, then click a card to reveal all of its relations on demand.
- **Reveal parent / Reveal children** — Two targeted alternatives to Expand mode. Turn on **Reveal parent** (up-arrow) or **Reveal children** (down-arrow) in the controls panel, then click a card to add just its hierarchy parent or its direct children to the diagram. Revealed cards stay on the diagram — so you can layer parents and children together — and clear when you re-center or reset the view.
- **No center card required** — On the Dependencies report the Layered Dependency View shows all cards matching the current type filter, so you don't have to pick a starting card first.

**Customising the view** (from the toolbar)

- **Card display menu** — Toggle the **type** label and a **lifecycle-status dot**, turn on **hierarchy markers** (a small chevron on each card that has a parent above or children below not currently on the diagram — a hint to use the Reveal tools), and choose **extra attribute fields** to show on each card — the first two render on the card and the full set appears in the hover tooltip. Choices are remembered between visits.
- **Show end-of-life cards** — Related cards whose lifecycle has reached End of Life are hidden by default to keep the graph focused; turn this toggle on (in the **Card display** menu) to bring them back. The card you are centered on is always shown, even if it is itself end-of-life.
- **Show relationship values** — Many relations can be qualified with a value (e.g. an application *supports* a capability as *Leading*, *Supporting* or *No Support*). When on (the default), these values appear in brackets next to the relation label (*supports [Leading]*) and are included in image exports. Turn it off in the **Card display** menu for a cleaner view; relations without a value are unchanged either way.
- **Rearrange** — Drag a card to move it within its layer, or drag a whole **layer box** to move it with all its cards. **Reset view** (in the left toolbar) restores the automatic arrangement and clears any exploration.
- **Background** — Cycle the canvas background between grid, dots, and none.
- **Export and fullscreen** — Export the diagram to **PNG** or **SVG**, or open it in **fullscreen**.
- **Create diagram** — Turn the current view into a new, editable diagram in the [Diagram module](diagrams.md). It recreates the cards, relationships, and the four architecture layer lanes, and every shape stays linked to its inventory card. You're asked for a name, then taken straight to the new diagram. Available to users who can create diagrams.

## Cost Report

![Cost Report](../assets/img/en/34_report_cost.png)

The **Cost Report** provides financial analysis of your technology landscape:

- **Treemap view** — Nested rectangles sized by cost, with optional grouping (e.g., by organization or capability)
- **Bar chart view** — Cost comparison across components
- **Card Type** — Pick which card type the report is built around (Application, IT Component, Provider, …).

### Cost Source

When the selected card type has at least one relation type pointing to a type that owns a cost field, a **Cost Source** picker appears next to **Card Type**. It lets you choose where the numbers come from:

- **Direct (this card type)** — default; sums the cost field on the displayed cards themselves. Use this when looking at *Applications* or *IT Components* directly.
- **Aggregate from related cards** — tick one or more `Type · Field` entries (for example `Application · Total Annual Cost`, `IT Component · Total Annual Cost`). Each primary card's number then becomes the sum of that field across its related cards.

The picker is **multi-select**, so a single roll-up can combine several related types in one go. For example, when viewing **Provider** for *Microsoft*, ticking both `Application · Total Annual Cost` and `IT Component · Total Annual Cost` shows the vendor's full footprint — Teams, M365, Azure, and any other Microsoft-supplied components — as one number.

#### Why nothing gets counted twice

The picker is built so that double-counting is impossible by construction:

- Each entry is a unique `(target type, cost field)` pair — the dropdown offers each pair exactly once, even when several relation types reach the same target type.
- Within a single pair, two cards linked through multiple relation types still contribute their cost only once.
- Across different entries, no card can contribute twice: a card has exactly one type, and different cost fields on the same card are independent values.

A small **help icon (?)** next to the picker repeats this guarantee on hover.

The option list is generated from your metamodel — relation types and cost fields are discovered at render time, so any custom card type or relation you add becomes a valid Cost Source automatically.

### Drill into a rectangle

Whenever at least one Cost Source is active, the treemap rectangles are **clickable**. Clicking one replaces the chart with the breakdown of that rectangle's cost — the related cards that contributed to its roll-up, sized by their direct cost. A breadcrumb appears above the chart, e.g. **All Applications › NexaCore ERP**; click any segment to walk back up.

- **Single Cost Source active** — drill renders one treemap of the related cards (e.g. clicking *NexaCore ERP* with `IT Component · Total Annual Cost` ticked shows the IT Components linked to NexaCore ERP, sized by their annual cost).
- **Multiple Cost Sources active** — drill renders **one treemap per source side-by-side** (1 column on narrow viewports, 2 on wide ones). Each panel has its own header, its own total, and its own per-panel `% of total` in the tooltip — so different card types stay on their own scale instead of being squashed into a single chart.

The timeline slider, Cost Source selection, and other filters are preserved as you drill, and the drilled level is part of the saved-report config — saving a report while drilled in re-opens directly at that level. With **no** Cost Source active, clicking a rectangle opens the card side panel instead (there's nothing to break down).

## Matrix Report

![Matrix Report](../assets/img/en/35_report_matrix.png)

The **Matrix Report** creates a **cross-reference grid** between two card types. For example:

- **Rows** — Applications
- **Columns** — Business Capabilities
- **Cells** — Indicate whether a relation exists (and how many)

This is useful for identifying coverage gaps (capabilities with no supporting applications) or redundancies (capabilities supported by too many applications).

## Data Quality Report

![Data Quality Report](../assets/img/en/33_report_data_quality.png)

The **Data Quality Report** is a **completeness dashboard** that shows how well your architecture data is filled in. Based on the importance weights configured in each card type's **Data quality** tab (each field plus the built-in Description, Lifecycle, mandatory Relations and mandatory Tags factors):

- **Overall score** — Average data quality across all cards
- **By type** — Breakdown showing which card types have the best/worst completeness
- **Individual cards** — List of cards with the lowest data quality, prioritized for improvement

## End of Life (EOL) Report

![End of Life Report](../assets/img/en/32_report_eol.png)

The **EOL Report** shows the support status of technology products linked via the [EOL Administration](../admin/eol.md) feature:

- **Status distribution** — How many products are Supported, Approaching EOL, or End of Life
- **Timeline** — When products will lose support
- **Risk prioritization** — Focus on mission-critical components approaching EOL

## Saved Reports

![Saved Reports Gallery](../assets/img/en/36_saved_reports.png)

Save any report configuration for quick access later. Saved reports include a thumbnail preview and can be shared across the organization.

## Exporting Reports

Every report supports **Export to Excel (.xlsx)** and **Export to PowerPoint (.pptx)** from the **⋮** menu in the title bar (alongside Print and Copy link).

- **Excel** — Produces one sheet per data table currently rendered, with auto-sized columns and currency / number formatting preserved. Switch to the **Table view** before exporting to capture the underlying rows.
- **PowerPoint** — Generates a deck whose first slide combines the report title, generation timestamp, active filter summary, and the live chart at presentation quality. Subsequent slides paginate the data tables for share-ready handouts.

Active filters and grouping options applied at the moment of export are recorded on the title slide / header row, so exports stay self-explanatory.

## Process Map

The **Process Map** visualizes the organization's business process landscape as a structured map, showing process categories (Management, Core, Support) and their hierarchical relationships.
