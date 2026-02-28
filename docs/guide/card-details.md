# Card Details

Clicking on any card in the inventory opens the **detail view** where you can view and edit all information about the component.

![Card Detail View](../assets/img/en/04_card_detail.png)

## Card Header

The top of the card shows:

- **Type icon and label** — Color-coded card type indicator
- **Card name** — Editable inline
- **Subtype** — Secondary classification (if applicable)
- **Approval status badge** — Draft, Approved, Broken, or Rejected
- **AI suggest button** — Click to generate a description with AI (visible when AI is enabled for this card type and the user has edit permission)
- **Data quality ring** — Visual indicator of information completeness (0–100%)
- **Actions menu** — Archive, delete, and approval actions

### Approval Workflow

Cards can go through an approval cycle:

| Status | Meaning |
|--------|---------|
| **Draft** | Default state, not yet reviewed |
| **Approved** | Reviewed and accepted by a responsible party |
| **Broken** | Was approved, but has been edited since — needs re-review |
| **Rejected** | Reviewed and rejected, needs corrections |

When an approved card is edited, its status automatically changes to **Broken** to indicate it needs re-review.

## Detail Tab (Main)

The detail tab is organized into **sections** that can be reordered and configured by an administrator per card type (see [Card Layout Editor](../admin/metamodel.md#card-layout-editor)).

### Description Section

- **Description** — Rich text description of the component. Supports the AI suggestion feature for automatic generation
- **Additional description fields** — Some card types include extra fields in the description section (e.g., alias, external ID)

### Lifecycle Section

The lifecycle model tracks a component through five phases:

| Phase | Description |
|-------|-------------|
| **Plan** | Under consideration, not yet started |
| **Phase In** | Being implemented or deployed |
| **Active** | Currently operational |
| **Phase Out** | Being decommissioned |
| **End of Life** | No longer in use or supported |

Each phase has a **date picker** so you can record when the component entered or will enter that phase. A visual timeline bar shows the component's position in its lifecycle.

### Custom Attribute Sections

Depending on the card type, you will see additional sections with **custom fields** configured in the metamodel. Field types include:

- **Text** — Free text input
- **Number** — Numeric value
- **Cost** — Numeric value displayed with the platform's configured currency
- **Boolean** — On/off toggle
- **Date** — Date picker
- **URL** — Clickable link (validated for http/https/mailto)
- **Single select** — Dropdown with predefined options
- **Multiple select** — Multi-selection with chip display

Fields marked as **calculated** show a badge and cannot be edited manually — their values are computed by [admin-defined formulas](../admin/calculations.md).

### Hierarchy Section

For card types that support hierarchy (e.g., Organization, Business Capability, Application):

- **Parent** — The card's parent in the hierarchy (click to navigate)
- **Children** — List of child cards (click any to navigate)
- **Hierarchy breadcrumb** — Shows the full path from root to current card

### Relations Section

Shows all connections to other cards, grouped by relation type. For each relation:

- **Related card name** — Click to navigate to the related card
- **Relation type** — The nature of the connection (e.g., "uses", "runs on", "depends on")
- **Add relation** — Click **+** to create a new relation by searching for cards
- **Remove relation** — Click the delete icon to remove a relation

### Tags Section

Apply tags from the configured [tag groups](../admin/tags.md). Depending on the group mode, you can select one tag (single select) or multiple tags (multi select).

### Documents Section

Attach links to external resources:

- **Add document** — Enter a URL and an optional label
- **Click to open** — Links open in a new tab
- **Remove** — Delete a document link

### EOL Section

If the card is linked to an [endoflife.date](https://endoflife.date/) product (via [EOL Administration](../admin/eol.md)):

- **Product name and version**
- **Support status** — Color-coded: Supported, Approaching EOL, End of Life
- **Key dates** — Release date, active support end, security support end, EOL date

## Comments Tab

![Card Comments Section](../assets/img/en/05_card_comments.png)

- **Add comments** — Leave notes, questions, or decisions about the component
- **Threaded replies** — Reply to specific comments to create conversation threads
- **Timestamps** — See when each comment was posted and by whom

## Todos Tab

![Todos Associated with a Card](../assets/img/en/06_card_todos.png)

- **Create todos** — Add tasks linked to this specific card
- **Assign** — Set a responsible person for each task
- **Due date** — Set deadlines
- **Status** — Toggle between Open and Done

## Stakeholders Tab

![Card Stakeholders](../assets/img/en/07_card_stakeholders.png)

Stakeholders are people with a specific **role** on this card. The available roles depend on the card type (configured in the [metamodel](../admin/metamodel.md)). Common roles include:

- **Application Owner** — Responsible for business decisions
- **Technical Owner** — Responsible for technical decisions
- **Custom roles** — Additional roles as defined by your administrator

Stakeholder assignments affect **permissions**: a user's effective permissions on a card are the combination of their app-level role and any stakeholder roles they hold on that card.

## History Tab

![Card Change History](../assets/img/en/08_card_history.png)

Shows the **complete audit trail** of changes made to the card: **who** made the change, **when** it was made, and **what** was modified (previous value vs. new value). This enables full traceability of all modifications over time.

## Process Flow Tab (Business Process cards only)

For **Business Process** cards, an additional **Process Flow** tab appears with an embedded BPMN diagram viewer/editor. See [BPM](bpm.md) for details on process flow management.

## Archiving

Cards can be **archived** (soft-deleted) via the actions menu. Archived cards:

- Are hidden from the default inventory view (visible only with the "Show archived" filter)
- Are automatically **permanently deleted after 30 days**
- Can be restored before the 30-day window expires
