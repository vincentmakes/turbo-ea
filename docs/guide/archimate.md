# ArchiMate Diagrams

The **ArchiMate** editor draws [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/) diagrams on top of your cards: you place elements from the standard notation (Business Process, Application Component, Node and so on), connect them with the relationships the language allows, and optionally link each element to a card of your inventory. A diagram is stored as an **ArchiMate Model Exchange File** (the Open Group XML format, version 3.1), so it can be exchanged with other ArchiMate tools.

!!! warning "Release status"
    This release ships the ArchiMate foundation as a **sandbox for administrators**. The module is off by default, the diagrams are not listed in the [Diagrams](diagrams.md) menu, and they cannot yet be published or embedded. See [Known limits](#known-limits).

The top row shows the diagram name, **Card colors**, **Show on card** and **Sync**. Use **Sync** to refresh data from linked inventory cards. It preserves the ArchiMate element names. The row below holds the drawing tools, including zoom, SVG export and the properties panel. Use **Dot grid** to show or hide the dots behind the diagram. The browser remembers your choice for each diagram.

## Turn the module on

1. Open **Admin → Settings** and find the **ArchiMate diagrams** card (next to the other module switches).
2. Switch it on. The card shows **ArchiMate is on**.
3. Switch it off again at any time. Diagrams are kept; the pages are simply unreachable while the module is off, and anyone who follows a direct link sees the standard "module disabled" placeholder.

## Open the sandbox

While the module is on, ArchiMate diagrams are created and opened from the **Diagrams** page, and from the **Resources** tab of any card they reference. `/admin/architectureStudio` is still the list of your ArchiMate diagrams, where you can create, open and delete them; it needs a permission on at least one ArchiMate layer and the module switched on. In the editor, **Back** returns to the page you came from.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## Your first diagram

1. In the sandbox, type a **Name** under **New ArchiMate diagram** and press **Create**. The editor opens.
2. **Drop elements.** The palette lists the element types grouped by layer (Strategy, Business, Application, Technology, Physical, Motivation, Implementation & Migration, Other). Drag an entry onto the canvas, or use the keyboard: move to an entry and press **Enter** or **Space** to drop the element at the centre of the visible area. A new element opens its name for editing straight away.
3. **Draw a relationship.** Select an element: the context pad around it offers **Draw** *relationship* entries. Pick one, then click the target element. Only the pairs the ArchiMate relationship table allows can be connected: an entry is offered only if the language allows that relationship from this element to some element type, and a target the table does not allow is refused. Select a connection to change its **access type** (for Access) or its direction (for Association).
4. **Link an element to a card.** Select the element and use the context pad:
    - **Link to a card** opens a picker limited to the card types that map to this element type (see [The mapping](#mapping)).
    - **Create a card** asks for a card type and a name, creates the card and links it in one step.
    - **Open the linked card** and **Unlink the card** appear once a card is linked.

    Links are always explicit. Dropping an element **never** creates a card, and removing an element from the diagram (**Remove from the diagram**) **never** deletes a card. On save, the set of cards the diagram links to is synced with it, as for other diagrams.
5. **Save.** The editor saves by itself three seconds after your last change; the **Save** button saves immediately. The status shows *Saving…*, *Saved* or *Unsaved changes*.

!!! warning "A failed save stays on screen"
    If a save fails, the error remains visible with a **Try again** button, the diagram stays marked as unsaved and nothing is silently dropped. Leaving the page (closing the tab, using the browser's Back button or opening another page of the app) while there are unsaved or failed changes asks for confirmation first.

## The mapping {#mapping}

The **mapping** says which ArchiMate concept a Turbo EA card type, subtype or relation type corresponds to. The editor reads it to decide which cards can be linked to which element. Each card type, subtype and relation type carries an ArchiMate element or relationship type; a relation also carries a **direction flag** (when set, the ArchiMate relationship is drawn from the target card to the source card, for example "Organization *uses* Application" is an ArchiMate *Serving* from the application to the organization) and, for Access, an **access type**.

!!! note
    In this release the mapping is **read-only**: it holds the default values below. The administration screen to change it (**ARCHI MAP** in **Admin → Metamodel**) ships later. This release does not create or change card relations from a drawn relationship.

The element and relationship names are those of the Open Group exchange format. A card type whose element is empty (`—`) has no default mapping, so its cards cannot be linked until an element type is set. A subtype uses its own mapping when it has one and the card type's mapping otherwise.

### Card types and subtypes

| Card type | ArchiMate element |
|---|---|
| Objective | `Goal` |
| Objective › Business Goal | `Goal` |
| Objective › Value Gate | `Assessment` |
| Platform | `Grouping` |
| Initiative | `WorkPackage` |
| Organization | `BusinessActor` |
| Organization › Region | `Location` |
| Business Capability | `Capability` |
| Business Context | — |
| Business Context › Process | `BusinessProcess` |
| Business Context › Value Stream | `ValueStream` |
| Business Context › Customer Journey | `BusinessProcess` |
| Business Context › Business Product | `Product` |
| Business Context › ESG Capability | `Capability` |
| Business Process | `BusinessProcess` |
| Business Process › Process Category | `BusinessFunction` |
| Business Process › Process Group | `BusinessFunction` |
| Application | `ApplicationComponent` |
| Interface | `ApplicationInterface` |
| Data Object | `BusinessObject` |
| IT Component | `Node` |
| IT Component › Software | `SystemSoftware` |
| IT Component › Hardware | `Device` |
| IT Component › SaaS | `TechnologyService` |
| IT Component › PaaS | `TechnologyService` |
| IT Component › IaaS | `TechnologyService` |
| IT Component › Service | `TechnologyService` |
| IT Component › AI Model | `SystemSoftware` |
| Tech Category | `Grouping` |
| Provider | `BusinessActor` |

### Relation types

For an Access relationship, `crud` means the access type follows the relation's own Create/Read/Update/Delete flags: reading only gives Read, any create, update or delete gives Write, both give Read/Write, and none gives plain Access. Relations "succeeds" exist for every card type that has them and map to Association, except the Business Context one, which has its own row in the table.

| Relation | ArchiMate relationship | Note |
|---|---|---|
| Objective → Business Capability, *improves* | `Association` | — |
| Platform → Objective, *supports* | `Influence` | — |
| Platform → Application, *runs* | `Aggregation` | — |
| Platform → IT Component, *implements* | `Aggregation` | — |
| Initiative → Objective, *supports* | `Influence` | — |
| Initiative → Platform, *affects* | `Association` | — |
| Initiative → Business Capability, *improves* | `Association` | — |
| Initiative → Application, *affects* | `Association` | — |
| Initiative → Interface, *affects* | `Association` | — |
| Initiative → Data Object, *affects* | `Association` | — |
| Initiative → IT Component, *affects* | `Association` | — |
| Organization → Objective, *owns* | `Association` | — |
| Organization → Initiative, *owns* | `Assignment` | — |
| Organization → Business Context, *owns* | `Association` | — |
| Organization → Application, *uses* | `Serving` | drawn from the target to the source |
| Organization → IT Component, *owns* | `Association` | — |
| Application → Business Capability, *supports* | `Realization` | — |
| Application → Business Context, *supports* | `Association` | — |
| Application → Interface, *provides / consumes* | `Association` | — |
| Application → Data Object, *CRUD* | `Access` | access type from the CRUD flags |
| Application → IT Component, *uses* | `Serving` | drawn from the target to the source |
| IT Component → Tech Category, *belongs to* | `Aggregation` | drawn from the target to the source |
| IT Component → Platform, *implements* | `Aggregation` | drawn from the target to the source |
| Interface → Data Object, *transfers* | `Association` | — |
| Interface → IT Component, *uses* | `Association` | — |
| Provider → Initiative, *supports* | `Association` | — |
| Provider → Application, *offers* | `Association` | — |
| Provider → IT Component, *offers* | `Association` | — |
| Business Context → Business Capability, *is associated with* | `Association` | — |
| Business Process → Business Capability, *supports* | `Realization` | — |
| Business Process → Application, *is supported by* | `Serving` | drawn from the target to the source |
| Business Process → Data Object, *uses* | `Access` | access type from the CRUD flags |
| Business Process → IT Component, *uses* | `Serving` | drawn from the target to the source |
| Business Process → Business Process, *depends on* | `Association` | — |
| Business Process → Business Process, *calls* | `Triggering` | — |
| Business Process → Organization, *is owned by* | `Assignment` | drawn from the target to the source |
| Business Process → Initiative, *is affected by* | `Association` | — |
| Business Process → Objective, *supports* | `Influence` | — |
| Business Process → Business Context, *realizes* | `Realization` | — |
| Objective → Business Context, *is goal for* | `Association` | — |
| Business Context → Business Context, *succeeds* | `Triggering` | drawn from the target to the source |

Right-click a connector and choose **Straight** or **Orthogonal**. The connector keeps its routing when you move a node and when you save and reopen the diagram.

## The Exchange file {#exchange-file}

The toolbar offers **Export as Exchange file** and **Import an Exchange file**, plus **Export as SVG** for a picture.

- **Export** downloads the diagram as an ArchiMate Model Exchange File (`.xml`, format 3.1).
- **Import** replaces everything in the open diagram, after a confirmation (**Replace the diagram?**). Diagrams made with other tools (such as Archi) can be read if they follow the Open Group format.
- Files over 5 MB are refused, as are files with a DOCTYPE or entity declaration.

**What is not preserved on import:**

- **Folders** (the `organizations` section): they are dropped, and the editor tells you so.
- **Notes, groups and plain connections** from other tools: labels and containers without an element behind them, and connections without a relationship, are ignored.
- **Property types other than string**: every property definition is read as a string.
- **Other languages of a name**: only one name per element, relationship and view is kept.
- Fonts and other styling beyond the basics are not kept.

## Check the model

The **Check the model** button in the toolbar sends the current diagram to the server, which validates it against the Open Group exchange rules and lists every problem it finds (at most 100). Each message has a code; the `…` stands for the name or identifier concerned:

| Code | Message |
|---|---|
| `too_large` | The model is larger than 5 MB. |
| `xml_invalid` | The model is not well-formed XML. |
| `dtd_forbidden` | DOCTYPE and entity declarations are not allowed. |
| `wrong_root` | The root element is not an ArchiMate model. |
| `missing_identifier` | An element, relationship or diagram node has no identifier. |
| `unknown_element_type` | Unknown element type: … |
| `unknown_relationship_type` | Unknown relationship type: … |
| `unknown_access_type` | Unknown access type on … |
| `duplicate_identifier` | Duplicate identifier: … |
| `dangling_source` | The relationship … starts from something that does not exist. |
| `dangling_target` | The relationship … ends on something that does not exist. |
| `relationship_not_allowed` | ArchiMate does not allow the relationship …: either between these two elements, or from a relationship to itself. |
| `dangling_element_ref` | The diagram node … shows an element that does not exist. |
| `dangling_relationship_ref` | The diagram connection … shows a relationship that does not exist. |
| `connection_endpoint_mismatch` | The diagram connection … does not join the nodes of its relationship. |

The relationship check also refuses a relationship that points at another relationship unless it is an Association, Aggregation or Composition. If there is nothing to report, the dialog says **No problems found.**

## Keyboard shortcuts

Press **Keyboard shortcuts** in the toolbar for the list. Click the canvas first so it has the focus.

| Action | Shortcut |
|--------|----------|
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Copy | `Ctrl+C` |
| Paste | `Ctrl+V` |
| Delete | `Delete` / `Backspace` |
| Rename | `F2` / `Enter` |
| Select all | `Ctrl+A` |
| Zoom in | `Ctrl++` |
| Zoom out | `Ctrl+-` |
| Fit to screen | `Ctrl+0` |

On the palette, `Enter` or `Space` on a focused entry drops that element.

## Known limits {#known-limits}

- **One view is edited per file.** If an imported file holds several views, the first is edited and the others are kept untouched when you save.
- **Relationships between relationships** (an Association, Aggregation or Composition that points at another relationship) are read and written, and the checker accepts them, but they are not drawn.
- **Drawing a relationship needs the mouse.** The keyboard can drop elements, but not connect them.
- **Keyboard drops stack.** Every element dropped with `Enter` or `Space` lands at the centre of the visible area, so successive drops overlap until you move them.
- **No publishing yet.** ArchiMate diagrams cannot be published or embedded, and they do not appear in the **Diagrams** menu; reach them from the sandbox list or from the **Resources** tab of a card they reference.
- **Junctions have no label.** An And or Or junction is a bare dot.
- The mapping is read-only (see [The mapping](#mapping)), and folders are dropped on import (see [The Exchange file](#exchange-file)).

---

ArchiMate® is a registered trademark of The Open Group. Turbo EA draws the ArchiMate notation and is not certified by The Open Group.
