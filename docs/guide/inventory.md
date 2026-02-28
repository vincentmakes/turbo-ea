# Inventory

The **Inventory** is the heart of Turbo EA. Here all **cards** (components) of the enterprise architecture are listed: applications, processes, business capabilities, organizations, providers, interfaces, and more.

![Inventory View with Filter Panel](../assets/img/en/23_inventory_filters.png)

### Inventory Screen Structure

#### Left Filter Panel

The left sidebar panel allows you to **filter** cards by different criteria:

- **Search**: Free text search field
- **Types**: Filter by card type: Objective, Platform, Initiative, Organization, Business Capability, Business Context, Business Process, Application, Interface, Data Object, IT Component, Tech Category, Provider
- **Approval Status**: Filter by approved, pending, or rejected cards
- **Lifecycle**: Filter by lifecycle state (Active, In Development, Retired, etc.)
- **Data Quality**: Filter by data completeness level
- **Show archived only**: Option to view archived cards
- **Save view**: Save filter configurations for reuse

#### Main Table (Center)

| Column | Description |
|--------|-------------|
| **Type** | Card category (color-coded) |
| **Name** | Component name |
| **Description** | Brief description of the component |
| **Lifecycle** | Current state (active, retired, etc.) |
| **Approval Status** | Whether it has been approved by responsible parties |
| **Data Quality** | Completeness percentage (progress bar) |

#### Toolbar (Top Right)

- **Grid Edit**: Edit multiple cards simultaneously in table mode
- **Export**: Download data to Excel format
- **Import**: Bulk upload data from Excel files
- **+ Create**: Create a new card

![Create Card Dialog](../assets/img/en/22_create_card.png)

### How to Create a New Card

1. Click the **+ Create** button (blue, top right corner)
2. In the dialog that appears:
   - Select the **Type** of card (Application, Process, Objective, etc.)
   - Enter the **Name** of the component
   - Optionally, add a **Description**
3. Optionally, click **Suggest with AI** to generate a description automatically (see [AI Description Suggestions](#ai-description-suggestions) below)
4. Click **CREATE**

### AI Description Suggestions

Turbo EA can use **AI to generate a description** for any card. This works on both the Create Card dialog and existing card detail pages.

**How it works:**

1. Enter a card name and select a type
2. Click the **sparkle icon** (✨) in the card header, or the **Suggest with AI** button in the Create Card dialog
3. The system performs a **web search** for the item name (using type-aware context — e.g., "SAP S/4HANA software application"), then sends the results to a **local LLM** (Ollama) to generate a concise, factual description
4. A suggestion panel appears with:
   - **Editable description** — review and modify the text before applying
   - **Confidence score** — indicates how certain the AI is (High / Medium / Low)
   - **Clickable source links** — the web pages the description was derived from
   - **Model name** — which LLM generated the suggestion
5. Click **Apply description** to save, or **Dismiss** to discard

**Key characteristics:**

- **Type-aware**: The AI understands the card type context. An "Application" search adds "software application", a "Provider" search adds "technology vendor", an "Organization" search adds "company", etc.
- **Privacy-first**: The LLM runs locally via Ollama — your data never leaves your infrastructure
- **Admin-controlled**: AI suggestions must be enabled by an administrator in Settings → AI Cards. Admins can choose which card types show the suggestion button, configure the LLM provider URL and model, and select the web search provider (DuckDuckGo, Google Custom Search, or SearXNG)
- **Permission-based**: Only users with the `ai.suggest` permission can use this feature (enabled by default for Admin, BPM Admin, and Member roles)
6. Click **CREATE**
