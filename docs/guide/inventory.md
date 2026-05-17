# Inventory

The **Inventory** is the heart of Turbo EA. Here all **cards** (components) of the enterprise architecture are listed: applications, processes, business capabilities, organizations, providers, interfaces, and more.

![Inventory View with Filter Panel](../assets/img/en/23_inventory_filters.png)

## Inventory Screen Structure

### Left Filter Panel

The left sidebar panel allows you to **filter** cards by different criteria:

- **Search** — Free text search across card names
- **Types** — Filter by one or more card types: Objective, Platform, Initiative, Organization, Business Capability, Business Context, Business Process, Application, Interface, Data Object, IT Component, Tech Category, Provider, System
- **Subtypes** — When a type is selected, filter further by subtype (e.g., Application → Business Application, Microservice, AI Agent, Deployment)
- **Approval Status** — Draft, Approved, Broken, or Rejected
- **Lifecycle** — Filter by lifecycle phase: Plan, Phase In, Active, Phase Out, End of Life
- **Data Quality** — Threshold-based filtering: Good (80%+), Medium (50–79%), Poor (below 50%)
- **Tags** — Filter by tags from any tag group
- **Relations** — Filter by related cards across relation types
- **Custom attributes** — Filter by values in custom fields (text search, select options)
- **Show archived only** — Toggle to view archived (soft-deleted) cards
- **Clear all** — Reset all active filters at once

An **active filter count** badge shows how many filters are currently applied.

### Columns Tab

The **Columns** tab in the side panel lets you choose which additional columns to display in the grid. Available columns change dynamically based on the selected card types:

- **Single type selected** — All attribute fields defined for that type are available, plus relation columns and metadata columns
- **Multiple types selected** — Only fields that are **common across all selected types** are available
- **No type selected** — A hint message prompts you to select a card type first

Columns are grouped into four categories:

| Category | Description |
|----------|-------------|
| **Default columns** | Always-on columns: Type, Name, Path, Description, Subtype, Lifecycle, Approval Status, Data Quality. Untick any of these to hide them from the grid — useful when tightening a saved view to just the columns you actually use. |
| **Metadata** | Created, Modified, Created by, Modified by |
| **Attributes** | Custom fields defined in the metamodel (text, number, cost, date, select, etc.) |
| **Relations** | Related card types (e.g., Applications linked to a Business Capability) |

The **Path** column shows the card's hierarchy breadcrumb (e.g. `North America / Sales / Inside Sales`) without including the card's own name, so you can keep both Name and Path on screen at once.

Each category has a **Select all** checkbox to quickly toggle all columns in that group. A search field at the top lets you find specific columns by name. The badge on each section header shows how many columns from that group are currently visible.

When a card type is first selected, **all attribute and relation columns are enabled by default**. You can then uncheck columns you don't need. A **Reset** button at the bottom of the Columns tab restores the default column selection.

A **change indicator dot** appears on the Columns tab header when the column selection differs from the defaults. The same indicator appears on the **Filters** tab when any filters are active, making it easy to see at a glance which settings have been modified.

Your column selection, active filters, and sort order are **automatically persisted** in your browser. When you return to the inventory page, your previous configuration is restored. Saved views (bookmarks) also preserve the full column selection, so switching between views restores exactly the columns you had configured.

### Main Table

The inventory uses an **AG Grid** data table with powerful features:

| Column | Description |
|--------|-------------|
| **Type** | Card type with color-coded icon |
| **Name** | Component name (click to open card detail). Each name cell has a 👁 eye icon — click it to open the card detail in a side panel without leaving the grid. Ctrl/Cmd-click the name to open the card in a new browser tab. |
| **Path** | Hierarchy breadcrumb up to the card's parent — empty for root cards |
| **Description** | Brief description |
| **Lifecycle** | Current lifecycle state |
| **Approval Status** | Review status badge |
| **Data Quality** | Completeness percentage with visual ring |
| **Relations** | Relation counts with clickable popover showing related cards |

**Table features:**

- **Sorting** — Click any column header to sort ascending/descending
- **Inline editing** — In grid edit mode, edit field values directly in the table
- **Multi-select** — Select multiple rows for bulk operations
- **Quick preview** — Use the eye icon next to any name to open the card detail in a side panel
- **Open in new tab** — Ctrl/Cmd-click a name to open the card in a new browser tab; main-nav links also support this
- **Column configuration** — Show, hide, and reorder columns (including the always-on default columns)

### Toolbar

- **Grid Edit** — Toggle inline editing mode to edit multiple cards in the table
- **Export** — Download data as an Excel (.xlsx) file
- **Import** — Bulk upload data from Excel files
- **+ Create** — Create a new card

![Create Card Dialog](../assets/img/en/22_create_card.png)

## How to Create a New Card

1. Click the **+ Create** button (blue, top right corner)
2. In the dialog that appears:
   - Select the **Type** of card (Application, Process, Objective, etc.)
   - Enter the **Name** of the component
   - Optionally, add a **Description**
3. Optionally, click **Suggest with AI** to generate a description automatically (see [AI Description Suggestions](#ai-description-suggestions) below)
4. Click **CREATE**

## AI Description Suggestions { #ai-description-suggestions }

Turbo EA can use **AI to generate a description** for any card. This works on both the Create Card dialog and existing card detail pages.

**How it works:**

1. Enter a card name and select a type
2. Click the **sparkle icon** in the card header, or the **Suggest with AI** button in the Create Card dialog
3. The system performs a **web search** for the item name (using type-aware context — e.g., "SAP S/4HANA software application"), then sends the results to an **LLM** to generate a concise, factual description
4. A suggestion panel appears with:
   - **Editable description** — review and modify the text before applying
   - **Confidence score** — indicates how certain the AI is (High / Medium / Low)
   - **Clickable source links** — the web pages the description was derived from
   - **Model name** — which LLM generated the suggestion
5. Click **Apply description** to save, or **Dismiss** to discard

**Key characteristics:**

- **Type-aware**: The AI understands the card type context. An "Application" search adds "software application", a "Provider" search adds "technology vendor", etc.
- **Privacy-first**: When using Ollama, the LLM runs locally — your data never leaves your infrastructure. Commercial providers (OpenAI, Google Gemini, Anthropic Claude, etc.) are also supported
- **Admin-controlled**: AI suggestions must be enabled by an administrator in [Settings > AI Suggestions](../admin/ai.md). Admins choose which card types show the suggestion button, configure the LLM provider, and select the web search provider
- **Permission-based**: Only users with the `ai.suggest` permission can use this feature (enabled by default for Admin, BPM Admin, and Member roles)

## Saved Views (Bookmarks)

You can save your current filter, column, and sort configuration as a **named view** for quick reuse.

### Creating a Saved View

1. Configure the inventory with your desired filters, columns, and sorting
2. Click the **bookmark** icon in the filter panel
3. Enter a **name** for the view
4. Choose the **visibility**:
   - **Private** — Only you can see it
   - **Shared** — Visible to specific users (with optional edit permissions)
   - **Public** — Visible to all users

### Using Saved Views

Saved views appear in the filter panel sidebar. Click any view to instantly apply its configuration. Views are organized into:

- **My Views** — Views you created
- **Shared with Me** — Views others shared with you
- **Public Views** — Views available to everyone

## Excel Import { #excel-import }

Click **Import** in the toolbar to bulk-create or update cards from an Excel file.

1. **Select a file** — Drag and drop an `.xlsx` file or click to browse
2. **Choose the card type** — Optionally restrict the import to a specific type
3. **Validation** — The system analyzes the file and shows a validation report:
   - Rows that will create new cards
   - Rows that will update existing cards (matched by name or ID)
   - Warnings and errors
4. **Import** — Click to proceed. A progress bar shows real-time status
5. **Results** — A summary shows how many cards were created, updated, or failed

## Excel Export

Click **Export** to download the current inventory view as an Excel file:

- **Multi-type export** — Exports all visible cards with core columns (name, type, description, subtype, lifecycle, approval status)
- **Single-type export** — When filtered to one type, the export includes expanded custom attribute columns (one column per field)
- **Lifecycle expansion** — Separate columns for each lifecycle phase date (Plan, Phase In, Active, Phase Out, End of Life)
- **Date-stamped filename** — The file is named with the export date for easy organization
