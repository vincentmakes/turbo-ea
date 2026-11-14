# Card Details

Clicking on any card in the inventory opens the **detail view** where you can view and edit all information about the component.

![Card Detail View](../assets/img/en/04_card_detail.png)

## Card Header

The top of the card shows:

- **Type icon and label** — Color-coded card type indicator
- **Card name** — Editable inline
- **Alias** — The card's other name, shown under the title when set. Click the title's edit pencil to change the name and the alias together. Aliases are matched by every search box, so a card can be found by the name your organisation actually uses for it.
- **Subtype** — Secondary classification (if applicable)
- **Origin chip** — Shown when the card was not created in the web interface: **MCP** for a card an AI assistant created through the [MCP server](../admin/mcp.md), **API** for a script or integration, **Extension** for an installed extension, **System** for a background job. Hover it to see who created the card and when — the person stays the creator; the chip says which channel they used. Cards created in the web interface, and cards created before Turbo EA recorded the channel, show no chip.
- **Approval status badge** — Draft, Approved, Broken, or Rejected
- **AI suggest button** — Click to generate a description with AI (visible when AI is enabled for this card type and the user has edit permission)
- **Data quality ring** — Visual indicator of information completeness (0–100%). Hover it to see the three things that would raise the score most, each with how many points it would add (for example *Fill Business Criticality +12.5%*). Click it (or focus it and press Enter) to open the full breakdown as a panel on the right of the page that stays open while you edit: every slot still to fill, sorted by how much it adds, and an **Already counted** list of what is in place. Each item still to fill is a link: clicking it opens the section where it is filled **in edit mode**, with that field focused (or the **Add relation** dialog for the relation type, the tag editor, or the **Stakeholders** tab's add form), and the panel stays open. Without the right to edit that part of the card, the link only opens the section and scrolls to it. While a required field is empty the score stays at 0%; the breakdown names those fields and shows what the score would be without them. Close the panel with the **Close** button in its header; your browser remembers whether it is open, so it is still there on the next card. On a window narrower than 900 px it opens as a drawer instead, which closes when you follow one of its links.

![Data quality breakdown panel](../assets/img/en/63_card_data_quality_breakdown.png)

When you create a **Data Object**, choose one of the subtypes configured for that card type. The same choice is available when you create a Data Object from the hierarchy, a predecessor or successor, an inventory relation cell, or an ArchiMate element.

When an administrator turns on [TurboRPG](../admin/settings.md#turborpg-gamified-data-quality) mode (gamified data quality), every save that raises the score is celebrated like gaining health in a game: a glowing **+X%** leaves the section you just saved, flies to the score and hits it — the ring flashes and glows, its fill grows to the new score and the figure counts up. Once you scroll past the header, a slim score bar pinned under the top bar keeps the score in view and the gain lands on it instead. Click the bar's score — the chip with the chevron — to open the same breakdown as the ring. Reaching the green band (80%) and reaching 100% are milestones with a short burst of confetti. Clearing or removing data plays the toned-down reverse: a red **−X%** flies off the score back to the section, and the bar drains and counts down, with no flash or confetti. With reduced motion turned on in your operating system nothing flies; you see a static **+X%** or **−X%** instead.

- **Actions menu** — Archive, delete, and approval actions. Also includes a one-click **Observe this card** toggle (when the card type defines an Observer role) so any user with view access can follow the card without going through the Stakeholders tab.

### Custom Logo

Cards of a type that allows it can carry their own **logo** instead of the
generic type icon — so an Application for SAP, Kafka or Jira shows that
product's own mark. Recognisable logos make an inventory much faster to scan,
especially for people who are reading it rather than maintaining it.

Hover the icon at the top-left of the card and click it to **upload**,
**replace** or **remove** the image. The type icon does not disappear: it moves
to a small badge on the corner of the logo, so you can still tell at a glance
what kind of card you are looking at.

- **Accepted formats** — PNG, JPEG, WebP or GIF, up to 1 MB. SVG is not
  accepted, because it can carry scripts.
- **Where it shows** — the card header, the optional **Logo** column in the
  [Inventory](inventory.md), and any published web portal built on that card
  type.
- **When there is no logo** — the card falls back to its type icon, exactly as
  before.

Logos are available on card types where an administrator has switched them on;
out of the box that is Application and IT Component. See
[Meta Model](../admin/metamodel.md).

Click the logo and choose **Choose a brand icon…** to pick from a built-in
pack of several thousand brand marks — search for the product by name and
select it; no image file is needed. **Upload** takes your own file instead.
An AI assistant connected over [MCP](../admin/mcp.md) can set logos the same
way in bulk, and where a product is not in the pack it will fetch the mark
itself and upload it.

The same menu is available from the **Logo** column in the
[Inventory](inventory.md) — hover a logo cell and click — so marks can be put
on a freshly imported landscape without opening every card. It is one card at a
time on purpose: a logo is not offered to fill-down or Mass Edit.

### Approval Workflow

Cards can go through an approval cycle:

| Status | Meaning |
|--------|---------|
| **Draft** | Default state, not yet reviewed |
| **Approved** | Reviewed and accepted by a responsible party |
| **Broken** | Was approved, but has been edited since — needs re-review |
| **Rejected** | Reviewed and rejected, needs corrections |

When an approved card is edited, its status automatically changes to **Broken** to indicate it needs re-review. Archiving a card's parent has the same effect on any approved children it moves in the hierarchy. Everyone with a stakeholder role on the card is notified — except whoever made the change — and the flip is recorded on the card's **History** tab. One action that breaks several cards, such as a mass edit, sends each person a single summary rather than one notification per card.

## Detail Tab (Main)

The detail tab is organized into **sections** that can be reordered and configured by an administrator per card type (see [Card Layout Editor](../admin/metamodel.md#card-layout-editor)).

### Description Section

- **Description** — Rich text description of the component. Supports the AI suggestion feature for automatic generation
- **Additional description fields** — An administrator can file any of a card type's own fields under Description, so this section may carry extra fields beyond the description itself
- **Links** — A web address (`http://` or `https://`) typed into the description, any text field, a comment or a to-do becomes a link that opens in a new tab

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

If a phase is dated after a phase that should follow it — for example **Phase Out** after **End of Life** — a warning icon appears next to that date, and the same warning shows under the field while editing. It is only a hint: the dates can still be saved as entered.

An info icon beside each phase on the timeline explains what the phase means — hover over it to read the definition. It shows a default explanation unless your administrator changed it to describe how your organisation uses the phase, or removed it. The timeline, with its icons, stays on screen while you edit the dates. The texts are set under **Admin → Metamodel → Lifecycle phases** (see [Lifecycle phases](../admin/metamodel.md#lifecycle-phases)).

### Custom Attribute Sections

Depending on the card type, you will see additional sections with **custom fields** configured in the metamodel. Field types include:

- **Text** — Free text input
- **Multi-line Text** — Free text input that preserves line breaks, rendered as an auto-growing text area
- **Number** — Numeric value
- **Cost** — Numeric value displayed with the platform's configured currency
- **Boolean** — Chosen from a Yes / No list, with **None** to clear it; shown as a green *Yes* or blue *No* pill, — when unset
- **Date** — Date picker
- **URL** — Clickable link (validated for http/https/mailto)
- **Single select** — Dropdown with predefined options
- **Multiple select** — Multi-selection with chip display

Where your administrator has written **help text** for a field, an info icon appears beside its label: hover over it (or tab to it with the keyboard) to read what the field means. While you edit the section, the same icon sits beside the field. In the Inventory, hovering the field's column header shows it too.

Fields marked as **calculated** show a badge and cannot be edited manually — their values are computed by [admin-defined formulas](../admin/calculations.md).

### Costs Section (Application and IT Component)

Applications and IT Components record their cost as a list of **cost items** (for example licences, hosting, support), not as a single typed number. The **Costs** section shows one fiscal year at a time, with a **‹ ›** navigator over six years: the four before the current one, the current one and the **Forecast**.

- **TCO** — The total cost of ownership of the year is the sum of its items. It is never typed by hand.
- **Chart and tiles** — A stacked bar shows how the TCO splits across items. Each item has a tile with its **annual amount** and **renewal date**; a renewal within 90 days is shown in orange. Costs are always annual.
- **Adding and editing** — Add, edit or delete an item in a dialog. Items come from the catalogue an administrator manages under [Metamodel → Cost items](../admin/metamodel.md#cost-items).
- **Copy to Forecast** — Copies the items of the year you are viewing into the Forecast year, to start a plan from the current figures.

**A new fiscal year.** When the fiscal year changes and a card has no costs for the new current year yet, the section shows the previous year's items marked **not confirmed**, with their renewal dates moved forward. They stay that way until someone confirms them or edits an amount. The Forecast and past years never fall back to another year.

**Who can see and edit costs.** You can **view** costs with the `costs.view` permission, or when you hold any stakeholder role on the card. You can **edit** costs with the `costs.edit` permission, or when you hold a stakeholder role on the card that allows editing the card (for example Responsible). Observers can only view. By default only administrators hold `costs.edit`; existing roles keep `costs.view`.

The card's **Total annual cost** field (`costTotalAnnual`) is derived from the current year's items and is read-only: the grid, spreadsheet import, drag-fill, the API, MCP, ServiceNow and LeanIX can no longer set it, and a value sent is overwritten. A card with no cost items has an empty cost field, not 0. Initiatives and Providers keep their ordinary cost fields.

### Licensing Section (Application and IT Component)

The **Licensing** section records, year by year, how many licenses the card has under contract and how many are really used. It sits next to Costs and has the same **‹ ›** navigator over six years: the four before the current one, the current one and the **Forecast**. Which metrics the card tracks (**Users**, **Installations**) comes from its **Licensing model**, shown at the top of the section. Anyone who can edit the card changes it with **Edit** there: tick **Users** and/or **Installations**, then **Save**. The model is not shown among the card's other fields.

![Licensing section](../assets/img/en/104_card_licensing.png)

- **Per metric and license type** — Each metric has a block with one tile per license type showing the **licensed** count, the **actual** count, the **utilisation %** and a status: **Compliant**, **Approaching** (from 80 %), **Over-licensed** (actual above licensed) or **No data**. A stacked bar sums the types. License types come from the catalogue an administrator manages under [Metamodel → License types](../admin/metamodel.md#license-types).
- **Adding and editing** — Add, edit or delete a count in a dialog. Leaving **Actual** empty means "no data", which is different from 0.
- **Forecast** — The Forecast year takes the licensed count only. **Copy to Forecast** copies the licensed counts of the year you are viewing.

**A new fiscal year.** When a card has no licensing data for the new current year yet, the section shows the previous year's licensed counts marked **not confirmed**, with no actual count, so a new year never inherits last year's consumption. They stay that way until someone confirms them or edits a count.

**Who can see and edit licenses.** You can **view** them with the `licenses.view` permission, or when you hold any stakeholder role on the card. You can **edit** them with the `licenses.edit` permission, or when you hold a stakeholder role on the card that allows editing the card. By default only administrators hold `licenses.edit`. A change appears in the History tab as **Licenses updated**, naming the license types touched but not the counts, and it cannot be rolled back.

### Hierarchy Section

For card types that support hierarchy (e.g., Organization, Business Capability, Application):

- **Parent** — The card's parent in the hierarchy (click to navigate)
- **Children** — List of child cards (click any to navigate)
- **Open in new tab** — The parent, children and breadcrumb are links: middle-click or Ctrl/Cmd-click one (or right-click → *Open in new tab*) to open that card in a new browser tab while this one stays put
- **Group by subtype** — When a card has many children of different subtypes (for example business units, regions and teams under one company), they are automatically grouped into collapsible subtype sections, each with a count, with a trailing **No subtype** section for unclassified children. Use the group/list toggle next to the **Children** count to switch between the grouped and flat views.
- **Hierarchy breadcrumb** — Shows the full path from root to current card
- **Link type** — When an administrator has configured link types for this card type, each parent-child link can be labelled — for example one subsidiary that is *commercial* and another that is *sales*. The label sits on the child, so the parent's card shows a label beside every child and the child's card shows its own beside its parent. Removing or moving a card to the top level clears its label, and the change is recorded on the **History** tab.

### Relations Section

Shows all connections to other cards, grouped by relation type. For each relation:

- **Related card name** — Click to navigate to the related card. Middle-click or Ctrl/Cmd-click it (or right-click → *Open in new tab*) to open it in a new browser tab instead — the same works in the **+N in sub-items** list, the Lineage lists and a stakeholder's hover card
- **Relation type** — The nature of the connection (e.g., "uses", "runs on", "depends on")
- **Add relation** — Click **+** to open the add dialog for that relation. It lists matching cards as you type (best matches first, more load as you scroll) and hides the ones already linked, with a caption showing how many. Clicking a card links it straight away and it appears as a chip at the top — click a chip's **×** to undo that one. The dialog stays open so you can add as many as you like, and on a phone it opens full-screen. Relations that have no section of their own are reached from the **Add Relation** button at the bottom of the section. When the linked type is hierarchical — Business Capability, Organization and the like — the dialog shows it as an indented tree instead of an alphabetical list, so you can pick a sub-capability by its branch. Searching keeps a match's parents visible for context, and cards you can't pick (already linked, just added, or this card itself) stay in place greyed out so the levels around them still read correctly.
- **Ordering** — Related cards are listed alphabetically by name
- **Remove relation** — Click the delete icon to remove a relation
- **Group by subtype** — When a relation section has many related cards, they are automatically grouped into collapsible subtype buckets (each with a count), with a trailing **No subtype** bucket for unclassified cards. Use the group/list toggle in the section header to switch between the grouped and flat views.
- **Cards linked to sub-items** — When a card has sub-items, each relation group shows a **+N in sub-items** chip counting the cards linked further down the hierarchy — for example, the applications attached to a capability's sub-capabilities. Click it to open a read-only list where each row names the sub-item holding the link (a card reached through several sub-items appears once, with each one listed). The count only includes cards that are not already listed in the group above it. To change a link, open the sub-item that owns it. The list is grouped into collapsible subtype sections, so the subtype is named once per section instead of on every row. Within a section, cards whose lifecycle phase needs attention come first (end of life, then phasing out), and each card's phase is shown as a coloured dot next to its name — hover it for the phase name.

![Relation groups showing the sub-items roll-up chip](../assets/img/en/59_card_subitem_chip.png)

![Cards linked through sub-items, grouped by subtype](../assets/img/en/60_card_subitem_relations.png)

### Dependencies Section

A [Layered Dependency View](reports.md) of the card and everything one hop away, grouped into the four architecture layers. Shift-click a card to re-centre on it and walk the landscape without leaving the page.

The **open in new tab** icon in the view's toolbar opens the full [Dependencies report](reports.md) in a new tab, centred on whatever the view is centred on at that moment — so a card you navigated to, not necessarily the one you started from. Use it when you need what the report adds around the same picture: time travel, the transition marks, the table view, and saving the view as a report.

### Tags Section

Apply tags from the configured [tag groups](../admin/tags.md). Depending on the group mode, you can select one tag (single select) or multiple tags (multi select).

### Resources Tab

The **Resources** tab consolidates all supporting materials for a card:

- **File Attachments** — Upload and manage files (documents, spreadsheets, presentations, OpenDocument and legacy Office files, images, archives, Outlook and e-mail messages, CSV, Markdown, JSON and XML — up to 20 MB). When uploading, select a **document category** from: Architecture, Security, Compliance, Operations, Meeting Notes, Design, or Other. The category appears as a chip next to each file. Use the replace icon next to a file to upload a new version in its place — the entry is then dated and attributed as a fresh upload, and the previous version remains only in the card's History tab — and the pencil icon to rename it or change its category; the extension must stay the same.
- **Document Links** — URL-based document references. When adding a link, select a **link type** from: Documentation, Security, Compliance, Architecture, Operations, Support, or Other. The link type appears as a chip next to each link, and the icon changes based on the selected type. Use the pencil icon next to a link to change its name, URL or link type; the URL must start with `http://`, `https://` or `mailto:`, and every change is recorded in the card's History tab.
- **Diagrams** — Link existing [diagrams](diagrams.md) to this card. Linked diagrams appear as thumbnail previews that you can click to open in the diagram editor. Use the **Link Diagram** button to search for and attach an existing diagram, or click the unlink icon to remove the association. [ArchiMate diagrams](archimate.md) that reference the card through one of their elements are listed too, marked **ArchiMate**, and open in the Architecture Studio; their links come from the model, so they cannot be linked or unlinked here, and you only see the ones on layers you may view.

### EOL Section

Shown on Applications and IT Components by default, and on any other card type whose administrator [turned it on](../admin/eol.md#end-of-life-on-other-card-types). If the card is linked to an [endoflife.date](https://endoflife.date/) product (via [EOL Administration](../admin/eol.md)):

- **Product name and version** — a custom product is named by its title and marked **Custom**
- **Support status** — Color-coded, by the same rule as the EOL report: Supported, Approaching EOL (within six months of the EOL date, or once active support has ended), End of Life
- **Key dates** — Release date, active support end, EOL date, the latest version and its release date
- **Release notes** — the product's page on endoflife.date, or the **Vendor page** of a custom product

**Link**, **Change** and **Unlink** appear only if you may edit the card. Users with the **Manage EOL** permission can define a [custom EOL product](../admin/eol.md#custom-eol-products) right from this section, through the **Define it as a custom product…** link under the product search: the form opens with the card's name (or what you typed) as the product name, and the card is linked to the new product on save. They also get a shortcut to **Manage custom products** in Settings, and can add a missing release cycle from the cycle list. Everyone else sees a hint to ask an EOL manager when endoflife.date has no match. Custom products behave like endoflife.date products everywhere else.

## Comments Tab

![Card Comments Section](../assets/img/en/05_card_comments.png)

- **Add comments** — Leave notes, questions, or decisions about the component
- **Threaded replies** — Reply to specific comments to create conversation threads
- **Timestamps** — See when each comment was posted and by whom. A comment an AI assistant posted through the MCP server carries an **MCP** chip beside the author
- **Links** — A web address in a comment is clickable and opens in a new tab

## Todos Tab

![Todos Associated with a Card](../assets/img/en/06_card_todos.png)

- **Create todos** — Add tasks linked to this specific card
- **Assign** — Set a responsible person for each task
- **Due date** — Set deadlines
- **Status** — Toggle between Open and Done
- **Recurring** — Switch on **Repeats** to make a todo repeat on a schedule (every N days, weeks, months, or years); completing it automatically creates the next occurrence

## Stakeholders Tab

![Card Stakeholders](../assets/img/en/07_card_stakeholders.png)

Stakeholders are people with a specific **role** on this card. The available roles depend on the card type (configured in the [metamodel](../admin/metamodel.md)). Common roles include:

- **Application Owner** — Responsible for business decisions
- **Technical Owner** — Responsible for technical decisions
- **Custom roles** — Additional roles as defined by your administrator

Stakeholder assignments affect **permissions**: a user's effective permissions on a card are the combination of their app-level role and any stakeholder roles they hold on that card.

Where a role has a **colour** set in the metamodel, its group is marked with it, so you can pick out an owner from an observer at a glance.

Where a role has a **description**, an info icon appears beside its name: hover over it to read what the role means. The description also shows under the role's name in the role picker when you add a stakeholder.

### Searching and inviting

Pick a stakeholder via the **searchable autocomplete** — start typing and the dropdown filters on both name and email (email appears as the secondary line so two users with the same name can be told apart at a glance).

If the email you type doesn't match an existing user, an **"Invite «email» as a new user"** option appears at the end of the dropdown. Selecting it expands an inline mini-form right inside the picker — optionally edit the display name, and submit. The new user receives the **default role** set in [Users & Roles](../admin/users.md#roles). The new user is invited via the standard invitation email **and** assigned the chosen stakeholder role on the card in a single action, so you never have to leave the card to onboard a contributor.

The invite path requires the **`users.invite`** permission, a delegated form of `admin.users` that admins can grant to trusted members. A privilege-escalation guard prevents non-admins from inviting users into any other role: without `admin.users`, an invited user can only receive the default role, Member or Viewer.

## History Tab

![Card Change History](../assets/img/en/08_card_history.png)

Shows the **complete audit trail** of changes made to the card: **who** made the change, **when** it was made, and **what** was modified (previous value vs. new value). This enables full traceability of all modifications over time.

A change that did not come from the web interface carries a chip beside the person's name: **MCP** when an AI assistant made it through the [MCP server](../admin/mcp.md) on that person's behalf, **API**, **Extension** or **System** otherwise.

A change to the card's costs appears as **Costs updated** with a readable summary of the items touched. Amounts are shown only to users who can see costs on that card, and a cost change cannot be rolled back from the audit log.

Everything that moves the card's **Modified** date appears here — an edit by hand, a spreadsheet import, a platform migration or ServiceNow sync, a tag change, a bulk edit, or a hierarchy move that pulled this card along. System housekeeping changes neither: recalculating data-quality scores, re-running calculated fields, and backfilling hierarchy levels or card IDs leave both the history and the **Modified** date alone.

## ADRs Tab

Every card carries an **ADRs** tab listing the [Architecture Decision Records](delivery.md) linked to it — the current revision of each decision, plus any revision being drafted — showing each decision's reference, title, standing (or its status while it is not signed yet), all of its linked cards, and when it was last modified. Click a row to open the decision; earlier revisions are reached from it.

If you are allowed to manage ADR links, the tab also offers **Link ADR** to attach an existing decision and **Create ADR** to start a new one that is pre-linked to this card, plus an unlink action on every row. On cards with no linked decisions the tab is hidden unless you hold that permission, so read-only users never see an empty tab.

Below the list, **Mentioned in** lists the decisions and Statements of Architecture Work whose text mentions this card, and those whose discussion mentions it (marked *in the discussion*), with each document's reference or revision and its standing or status. A mention does not link the card to the decision; it only shows here. The list shows only the documents you can open and is left out when there are none. See [Mentions](grc.md#decision-mentions).

## Risks Tab (GRC enabled, when present)

When the [GRC module](grc.md) is enabled **and** the card has at least one linked risk, a **Risks** tab appears listing every risk linked to the card with a one-click path back to the [Risk Register](risks.md). The tab is auto-hidden when no risk is linked, so cards with no GRC activity don't carry an empty tab.

## Compliance Tab (GRC enabled, when present)

When the [GRC module](grc.md) is enabled **and** the card has at least one linked compliance finding, a **Compliance** tab appears listing every finding currently linked to the card. The same Acknowledge / Accept / **Create risk** / **Open risk** actions as the [GRC Compliance grid](compliance.md) are available so the card owner can triage their own findings without leaving the card. Auto-hidden when no finding is linked.

## Process Flow Tab (Business Process cards only)

For **Business Process** cards, an additional **Process Flow** tab appears with an embedded BPMN diagram viewer/editor. See [BPM](bpm.md) for details on process flow management.

## PPM Tab (Initiative cards only)

When the [PPM module](ppm.md) is enabled, **Initiative** cards display an additional **PPM** tab as the last tab. Clicking this tab navigates to the PPM Initiative Detail View where you can manage status reports, budgets, risks, tasks, and Gantt timelines.

## Archiving

Cards can be **archived** (soft-deleted) via the actions menu. Archived cards:

- Are hidden from the default inventory view (visible only with the "Show archived" filter)
- Are automatically **permanently deleted after 30 days**
- Can be restored before the 30-day window expires
