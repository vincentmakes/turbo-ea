# Diagrams

The **Diagrams** module lets you create **visual architecture diagrams** using an embedded [DrawIO](https://www.drawio.com/) editor — fully integrated with your card inventory. You can drag cards onto the canvas, connect them with relations, and keep the diagram synchronized with your EA data.

![Diagrams Gallery](../assets/img/en/16_diagrams.png)

## Diagram Gallery

The gallery shows all diagrams as **thumbnail cards** or in a **list view** (toggle via the view icon in the toolbar). Each diagram displays its name, type, and a visual preview of its contents.

**Actions from the gallery:**

- **Create** — Click **+ New Diagram** to create a diagram with a name, optional description, and an optional link to an Initiative card
- **Open** — Click any diagram to launch the editor
- **Edit details** — Rename, update the description, or reassign the linked initiative
- **Delete** — Remove a diagram (with confirmation)

## The Diagram Editor

Opening a diagram launches a full-screen **DrawIO editor** in a same-origin iframe. The standard DrawIO toolbar is available for shapes, connectors, text, formatting, and layout.

### Inserting Cards

Use the **Card Sidebar** (toggle via the sidebar icon) to browse your inventory. You can:

- **Search** for cards by name
- **Filter** by card type
- **Drag a card** onto the canvas — it appears as a styled shape with the card's name and type icon
- Use the **Card Picker Dialog** for advanced search and multi-select

### Creating Cards from the Diagram

If you draw a shape that doesn't correspond to an existing card, you can create one directly:

1. Select the unlinked shape
2. Click **Create Card** in the sync panel
3. Fill in the type, name, and optional fields
4. The shape is automatically linked to the new card

### Creating Relations from Edges

When you draw a connector between two card shapes:

1. Select the edge
2. The **Relation Picker** dialog appears
3. Choose the relation type (only valid types for the connected card types are shown)
4. The relation is created in the inventory and the edge is stamped as synced

### Card Synchronization

The **Sync Panel** keeps your diagram and inventory in sync:

- **Synced cards** — Shapes linked to inventory cards show a green sync indicator
- **Unsynced shapes** — Shapes not yet linked to cards are flagged for action
- **Expand/collapse groups** — Navigate hierarchical card groups directly on the canvas

### Linking to Initiatives

Diagrams can be linked to **Initiative** cards, making them appear in the [EA Delivery](delivery.md) module alongside SoAW documents. This provides a complete view of all architecture artifacts for a given initiative.
