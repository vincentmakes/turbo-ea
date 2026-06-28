# Diagrams

The **Diagrams** module lets you create **visual architecture diagrams** using an embedded [DrawIO](https://www.drawio.com/) editor — fully integrated with your card inventory. Drag cards onto the canvas, connect them with relations, drill into hierarchies, and recolor by any attribute — the diagram stays in sync with your EA data.

![Diagrams Gallery](../assets/img/en/16_diagrams.png)

## Diagram Gallery

The gallery lists every diagram as a compact card with a thumbnail, name, author, and the number of cards it references. **Create**, **Open**, **Edit details**, organise, or **Delete** any diagram.

### Finding diagrams

- **Filter sidebar** — the left rail narrows the gallery to **All diagrams**, **Created by me**, or your **Favorites**. Collapse it to a slim rail with the chevron; on small screens the **Filters** button opens it as a slide-in panel.
- **Search** — the search box matches a diagram's name, its author, and the names of the cards drawn inside it, so you can find a diagram by what it contains.
- **Sort** — order by recently updated, recently created, or name.
- **Favorites** — click the star on any card to add it to your personal favorites; the **Favorites** filter then shows them all.

### Groups

Organize related diagrams into **groups** — shared, workspace-wide labels. A diagram can belong to several groups at once. In card view the gallery shows each group as a collapsible heading, with anything unassigned under **Ungrouped**.

- Use **Manage groups** in the sidebar to create, rename, recolour, or delete groups.
- Use **Add to groups…** from a diagram's menu to place it in one or more groups (you can create a new group inline).
- Selecting a group in the sidebar filters the gallery to just that group.


## The Diagram Editor

Opening a diagram launches the full-screen DrawIO editor in a same-origin iframe. The native DrawIO toolbar is available for shapes, connectors, text, and layout — every Turbo EA action is exposed via the right-click context menu, the toolbar Sync button, and the chevron overlay that sits on top of each card.

### Inserting cards

Use the **Insert Cards** dialog (opened from the toolbar or the right-click menu) to add cards to the canvas:

- Type **chips with live counts** on the left rail filter the results.
- Search by name on the right rail; each row carries a checkbox.
- **Insert selected** adds the picked cards in a grid; **Insert all** adds every card matching the current filter (with a confirm step past 50 results).

The same dialog opens in single-select mode for **Change Linked Card** and **Link to Existing Card**.

Each card on the canvas shows its **card-type icon** as a small white glyph in the top-left corner, next to the type colour — so a card's type is conveyed by both icon and colour. This matches the icons used across the app and improves readability for colour-blind users. The icon appears on cards inserted from now on. To add icons to cards already on an older diagram, click **Apply card-type icons** in the editor toolbar.

### Right-click actions

- **Synced cards**: *Open Card*, *Change Linked Card*, *Unlink Card*, *Remove from diagram*.
- **Plain shapes / unlinked cells**: *Link to Existing Card*, *Convert to Card* (keeps the shape's geometry, turns it into a pending card seeded with the shape's label), *Convert to Container* (turns the shape into a swimlane so other cards can be nested inside).

### The Expand menu

Every synced card carries a small chevron overlay. Clicking it opens a menu with three sections, each populated in one round-trip:

- **Show Dependency** — neighbours via outgoing or incoming relations, grouped by relation type with counts. Each row is a checkbox; commit with **Insert (N)**.
- **Drill-Down** — turns the current card into a swimlane container with its `parent_id` children nested inside. Pick which children to include or *Drill into all*.
- **Roll-Up** — wraps the current card + selected siblings (cards sharing the same `parent_id`) inside a new parent container.

Rows with count = 0 are greyed out, and neighbours / children already on the canvas are skipped automatically.

### Hierarchy on the canvas

Containers correspond to a card's `parent_id`:

- **Dragging a card into** a same-type container opens *"Add «child» as a child of «parent»?"*. **Yes** queues a hierarchy change; **No** snaps the card back.
- **Dragging a card out** of a container prompts to detach (set `parent_id = null`).
- **Cross-type drops** snap back silently — the hierarchy is restricted to cards of the same type.
- All confirmed moves land in the **Hierarchy Changes** bucket in the Sync drawer with *Apply* and *Discard* actions.

### Removing cards from the diagram

Deleting a card from the canvas is treated as a **visual-only** gesture — *"I don't want to see this here"*. The card stays in inventory; its connected relation-edges silently disappear with it. Hand-drawn arrows that aren't registered EA relations are never auto-removed. **Archival is a job for the Inventory page**, not the diagram.

### Edge deletions

Removing an edge that carries a real relation opens *"Delete the relation between SOURCE and TARGET?"*:

- **Yes** queues the deletion in the Sync drawer; **Sync All** issues the backend `DELETE /relations/{id}`.
- **No** restores the edge in place (style and endpoints preserved).

### View perspectives

The **View** dropdown in the toolbar recolors every card on the canvas by an attribute:

- **Card colors** (default) — each card uses its card-type color.
- **Approval status** — recolors by `approved` / `pending` / `broken`.
- **Field values** — pick any single-select field on the card types currently on the canvas (e.g., *Lifecycle*, *Status*). Cells with no value fall back to a neutral grey.

A floating legend in the bottom-left of the canvas shows the active mapping. The chosen view is saved with the diagram.

### Sync drawer

The **Sync** button in the toolbar opens the side drawer with everything queued for the next sync:

- **New Cards** — shapes converted to pending cards, ready to be pushed to inventory.
- **New Relations** — edges drawn between cards, ready to be created in inventory.
- **Removed Relations** — relation-edges deleted from the canvas, queued for `DELETE /relations/{id}`. *Keep in inventory* re-inserts the edge.
- **Hierarchy Changes** — confirmed drag-into / drag-out container moves, queued as `parent_id` updates.
- **Inventory Changed** — cards updated in inventory since the diagram was opened, ready to be pulled back into the canvas.

The toolbar Sync button shows a pulsing "N unsynced" pill whenever pending work exists. Leaving the tab with unsynced changes triggers a browser warning, and the canvas autosaves to local storage every five seconds so an accidental refresh can be restored on reopen.

### Linking diagrams to cards

Diagrams can be linked to **any card** from the card's **Resources** tab (see [Card Details](card-details.md#resources-tab)). When linked to an **Initiative** card, the diagram also appears in the [EA Delivery](delivery.md) module alongside SoAW documents.
