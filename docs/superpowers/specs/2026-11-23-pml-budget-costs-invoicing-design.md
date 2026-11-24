# Project Master List financials

**Status** — Approved on 2026-11-23. This specification defines the release scope and acceptance criteria.

## Outcome

Rename the user-facing PPM module to **Project Master List (PML)**. On an initiative, a project manager can trace a planned budget to the costs recorded against it and the invoices recorded against each cost. **Actual Invoiced** is an internal tracker for existing invoices. It records their date, document reference and net amount against a Cost Item and totals those entries. The **Initiative card** displays the initiative's own **Actual Invoiced** total.

Administrators can configure financial row fields and calculated columns independently for **Planned Budget**, **Cost Items** and **Actual Invoiced**. An Aruba administrator can reproduce the agreed classifications and provider relationship using that configuration. Provider names, intercompany options, the purchase-order field and classification rules are instance data.

The Initiative card groups **Financials** under **Cost** and the initiative planning diagram under **Timeline**, both within **Cost & Timeline**. The Initiative's planned and actual dates are shown together on both the card summary and the internal PML plan.

## Mockup

[Open the interactive PML mockup](2026-11-23-pml-budget-costs-invoicing-design-assets/mockups.html). It shows the Budget & Costs hierarchy and invoice form, the Initiative card, the Portfolio tracks, and the administration screens. It uses example data. The requirements and acceptance criteria below define the behavior.

## Current behavior and approach

PPM already stores budget and cost lines separately against an Initiative. Planned Budget owns a fiscal year, description, category and amount. Cost Items record a description, category, amount and optional date. The tables and their printable project report share financial components. The Initiative's existing budget and actual cost values feed rollups and reports. The model has neither a link between budget and cost lines nor invoice records linked to costs.

| Approach | Consequence |
|---|---|
| **Extend the existing initiative financial tables** | Selected. Keep the existing budget and cost domain, add typed links and invoice rows, and give the three row types a shared field editor. This lets standard financial totals and configurable fields use the same views while preserving the financial history already recorded in PPM. |
| Model each financial row as a card | Standard card custom fields would be available, but budgets, costs and invoices would become inventory cards, with different access and lifecycle semantics and a larger migration of existing financial data. |
| Add an Aruba-specific schema or extension | Could ship the four fields quickly. Future fields and formulas would depend on changes to that schema or extension, where the agreed workflow puts those decisions in instance administration. |

Release scope covers the module rename, initiative financial tables, the Initiative card's invoiced total and Cost & Timeline presentation, printable project financials, admin configuration, financial links and calculations, and workspace transfer. Issuing invoices, tax calculation, credit notes, payment tracking, ERP synchronization, invoice attachments and financial spreadsheet import are outside this release.

## Initiative workspace

Use **Project Master List** on the module entry and page titles and **PML** where the interface uses the acronym. Update navigation, admin labels, in-product help and the manual in supported locales. **Planned Budget**, **Cost Items** and **Actual Invoiced** are the source English section labels. Existing links and integration identifiers continue to work.

In the initiative's **Budget & Costs** tab, present one expandable hierarchy. The top level is **Planned Budget** grouped by fiscal year, then **Cost Items** under each budget line, then **Actual Invoiced** under each cost line. Budget and Cost Item rows show their configured, visible calculated amounts while collapsed, subject to the reader's permissions. The tab shows a separate initiative-wide **Actual Invoiced** total above the hierarchy for authorized readers.

```text
Budget & Costs                  Actual Invoiced · Total 6,500
└─ Planned Budget · FY 2026                       + Add budget line
   └─ Platform FY26 · Aruba Software [budget Provider] · Planned 12,000
      Cost Items 10,000
      Invoiced 6,500 · To invoice 3,500              + Add cost item
      ├─ Cost Item · Renewal · Cost 8,000
      │  Origin Aruba Software / Licensing [selected child Provider]
      │  Invoiced 6,500 · To invoice 1,500           + Add invoice
      │  └─ Actual Invoiced
      │     ├─ 2026-10-14 · INV-00018 · 4,000
      │     └─ 2026-11-10 · INV-00051 · 2,500
      └─ Cost Item · Support · Cost 2,000
         Origin Aruba Software / Licensing [same child Provider]
         Invoiced 0 · To invoice 2,000               + Add invoice
```

Use the action next to the parent to create a child. **Add cost item** starts from a budget line and takes that line's identity from context. **Add invoice** starts from a Cost Item and takes that item's identity from context. Show the parent label as context in each form. The standard inputs and active editable custom fields are shown in the form. Relationship selection is available through explicit move or assignment actions. The API still receives and validates the parent reference. After a save, reveal the row inside its parent. Columns at each level follow the configuration for that row type. Financial summaries and calculated fields are read-only.

In form context and move choices, identify budget lines by description when available, fiscal year, category and amount. Identify Cost Items by description, date when available, and amount. If labels would otherwise look identical, add a short stable row identifier. In the printable project financials, render the same hierarchy fully expanded in read-only form.

### Planned Budget

- Preserve the current standard fields, amount formatting, fiscal-year grouping and CapEx/OpEx totals.
- One budget line can have zero or more Cost Items. Each linked Cost Item contributes its full recorded cost to exactly one budget line. Splitting one Cost Item over multiple budget lines is outside this release.
- Show **Total Cost Items**, **Total Invoiced** and **Remaining to Invoice** on each budget line. Subtotals inside the budget hierarchy use the budget line's fiscal year and, for the CapEx and OpEx breakdown, the budget line's category. Use that grouping even when the linked cost has a different category or a linked invoice has a date in another year. In the existing cost charts and Actual totals by category, each Cost Item uses its own category.
- A budget line can be created before costs are known. Its linked-cost summaries start at zero.
- In the Aruba configuration, choose **Origine Costi** from the Provider picker on the budget line. This sets the default Provider and the scope of permitted child Provider selections on its Cost Items.

### Cost Items

- Preserve the existing standard fields and meaning of the recorded cost. A newly created Cost Item must belong to exactly one existing Planned Budget line in its own initiative. Each line keeps its existing cost amount, category and date.
- Create a Cost Item from **Add cost item** on its budget row. When an initiative has no budget lines, guide the user to add a budget line first. The API enforces the budget relationship, including on forged or stale submissions.
- The row action **Move to budget** reassigns the Cost Item and the contribution of all its invoices to the selected budget summaries. Its invoices continue to reference the same Cost Item.
- When configured, show the effective **Origine Costi**. By default it comes from the current budget's Provider. An editor can optionally choose a direct child of that Provider on the Cost Item. An unassigned legacy cost receives its first Provider when assigned. The server validates the optional child and computes the effective Provider from the two inputs. Workspace transfer preserves the budget Provider and any explicitly selected Cost Item child.
- Show **Total Invoiced** and **Remaining to Invoice** on the Cost Item row. Its position below the budget row identifies the budget. Render pre-existing costs awaiting a link in a separate expandable **Unassigned Cost Items** group at the same level as the budget groups. Those costs retain their nested invoices and provide **Assign to budget**.

### Actual Invoiced

| Standard field | Behavior |
|---|---|
| **Invoice date** | Required invoice date, separate from the date of the Cost Item. |
| **Invoice ID** | Required document reference entered as text. Preserve separators and leading zeros. The system uses its own stable row ID. |
| **Cost Item** | Required system reference to a Cost Item in the current initiative. Set from the parent when the user selects **Add invoice**. |
| **Invoice amount** | Required nonnegative amount excluding VAT, assigned to the linked Cost Item. Enter the net amount shown on the invoice for that allocation. Zero is valid. |

- Add, view, edit or remove tracking entries inside their Cost Item with the initiative's financial permissions. Use **Move to Cost Item** to change the parent within the initiative. One Cost Item may have zero or more invoice rows, such as deposit, installment and final invoice.
- When one real invoice covers several costs, each row records the amount assigned to its linked Cost Item. A document reference can therefore appear on several rows. Totals sum the entered row amounts.
- The nested invoice list shows the invoice date, document reference, amount and configured columns. Its position below the Cost Item identifies the associated cost. Custom fields can give an invoice row additional context, and calculated fields can derive values such as **Invoice year** from its date.
- Provider belongs to Planned Budget and Cost Items. The invoice has no Provider field or inherited Provider value in forms, lists, APIs, calculations or exports. A permitted editor can move an invoice to any valid Cost Item within the same initiative. Its parent link and affected totals update together.

### Compatibility and row lifecycle

- Migrate existing Cost Items without deleting them or guessing the proper Planned Budget. Existing unassigned rows remain readable and editable. An editor can associate each with a budget from the same initiative. Existing initiative cost totals still include unassigned rows.
- Compatible legacy imports can produce unassigned rows. A new interactive or API-created Cost Item requires a budget. After a Cost Item is assigned, changing the link requires another valid budget in the same initiative.
- A budget line with Cost Items or a Cost Item with invoice rows cannot be individually deleted until its dependent rows have been reassigned or removed. A rejected operation leaves the links and financial values intact and explains which dependency blocks deletion.
- Whole-initiative deletion follows the existing initiative lifecycle and disposes of its financial rows and their dependants as part of the same successful operation.

## Financial calculations

For these summaries, **Cost Item amount** means the recorded cost used by the existing Actual totals. Invoice rows represent how much of that cost is invoiced. Both figures are visible independently. Invoice writes affect invoice summaries and leave the Cost Item amount editable through the cost form.

Use amounts excluding VAT for Planned Budget, Cost Items and Actual Invoiced. These are the amounts entered and used in all calculations. The form and documentation label that basis explicitly. Preserve historical amounts as recorded. VAT calculation and credit notes are outside the first release.

| Level | System-calculated field | Definition |
|---|---|---|
| Cost Item | **Total Invoiced** | Sum of Invoice amount over the invoice rows linked to the Cost Item. |
| Cost Item | **Remaining to Invoice** | Recorded Cost Item amount minus its Total Invoiced. |
| Planned Budget line | **Total Cost Items** | Sum of the recorded amounts of the Cost Items linked to the line. |
| Planned Budget line | **Total Invoiced** | Sum of Total Invoiced over the Cost Items linked to the line. |
| Planned Budget line | **Remaining to Invoice** | Sum of Remaining to Invoice over the Cost Items linked to the line. |
| Initiative card | **Actual Invoiced** | Sum of all invoice amounts for the initiative's own Cost Items, including legacy Cost Items with no budget link. |

An empty sum is zero. Retain a negative remaining amount when invoices exceed the recorded cost so the excess is visible. The Planned Budget amount is a separate input. **Remaining to Invoice** on a budget line measures invoicing against its linked costs. The difference between the Planned Budget amount and Total Cost Items measures how much budget is yet to be assigned.

An invoice counts once at its Cost Item and once in the summary of that item's linked budget line. Unassigned legacy Cost Items may receive invoices. Their item-level summaries are visible immediately, and their full contribution enters a budget line's summaries as soon as they are assigned. Budget and invoice references cannot cross initiatives, including between parent and child initiatives.

Any successful create, edit, delete or reassignment of a cost or invoice updates the affected summaries on the next read. Reassignments refresh both the former and the new parent. The server supplies authoritative amounts and totals for the detail and read-only project financials. Fiscal-year subtotals and the displayed grand totals aggregate the underlying rows once. The total must agree with the visible financial grouping and should be fetched with grouped operations rather than a query per row.

PML's **Total Actual**, the `costActual` card field and PML cost charts use recorded Cost Item amounts with the existing date and rollup rules. Planned budget totals use the Planned Budget line amounts. Preserve the Cost Report's existing input fields and totals. Some Cost Report paths aggregate all fields marked as costs, so explicitly exclude **Actual Invoiced** from those sums, their field selectors and editable cost history. Invoice dates and amounts feed the invoicing figures.

Existing fallback rows that show an initiative's descendants' budget or cost totals retain their current meaning. Those read-only fallback rows display an em dash for the new financial columns. An initiative with budgets of its own and only descendant costs has zero linked costs on its own budget lines. The new summaries follow the explicit row links in the current initiative in both the tab and the printable report.

Use decimal arithmetic for totals and residuals. Preserve the recorded amounts in forms, tables, print and workspace transfer.

### Actual Invoiced on the Initiative card

- In the Initiative card's financial area, display **Actual Invoiced** alongside **Budget** and **Actual Cost** as a separate read-only amount when PML is enabled. Use the Initiative metamodel and the existing cost field conventions. The financial display provides the total amount only. The PML tab retains the invoice dates, IDs and line-level details.
- Calculate directly from the invoice rows linked to the initiative's own Cost Items, across all fiscal years. Include invoices on historical costs that still have no budget. An initiative with no invoice rows displays zero to an authorized viewer. An initiative with invoiced descendants displays the total of its own cost items.
- Use the same initiative-wide amount for the **Budget & Costs** tab's **Actual Invoiced** total and the Initiative card. A filtered view can show a separate subtotal of the displayed rows. Budget totals include only their own linked costs. Moving a Cost Item to a different budget or moving an invoice between Cost Items in the same initiative updates the affected row-level totals and leaves the Initiative total equal to the sum of the same invoices.
- After a successful invoice create, amount edit, delete or import, the next card read reflects the new amount. Removing the last invoice resets the value to zero. Render this amount in a separate read-only presentation slot backed by the private financial projection. A Card attribute, import payload or card calculation cannot write an independent invoiced amount. The display slot preserves existing custom Card fields and their values, even if an administrator used a similar label or key.
- Invoicing data requires permission to read the initiative, read PML financial data (`ppm.view`) and view costs on that initiative. Apply the same rule to invoice rows, totals and residuals in the card, PML tab, APIs, print and derived output. Withhold the invoice branch and its counts, presence indicators and actions from viewers without invoice read access. Invoice mutation controls and requests additionally require `ppm.manage`. Published portals and other anonymous views omit the invoicing data. Existing Planned Budget and Cost Item inputs retain their established access rules.

### Cost & Timeline on the Initiative card

Place both groups inside **Cost & Timeline** on the Initiative card by default. Use the Initiative's metamodel for the date fields. Upgrade or configure the Timeline without duplicating or losing existing fields. Preserve intentional section names, visibility, subtype overrides and field placement. If the section is hidden, it is not recreated in the card display. The embedded PML displays reuse the existing financial and portfolio components or their shared presentation logic.

| Group | Fields and diagram |
|---|---|
| **Cost** | **Budget**, **Actual Cost**, **Actual Invoiced**, then **Financials**. Use the overlapping horizontal bars from the Licensing widget for the existing Total, CapEx and OpEx financial figures. Budget is the wider, lighter bar behind. Actual Cost is the narrower, solid bar in front, on the same scale and baseline. Show the two amounts, variance using the existing PML convention of Budget minus Actual Cost, and the ratio when Budget is positive. If Actual Cost exceeds Budget, its bar extends past Budget. Actual Invoiced remains a separate read-only amount. Apply Initiative, PML and cost visibility to the financial diagram. |
| **Timeline** | Show **Start Date**, **Actual Start**, **End Date**, **Actual End**, in that order. Below the fields, show the initiative planning diagram from the PML Portfolio view, scoped to this Initiative. Include its name, **Plan** and the quarterly axis, followed by **On Time**, **On Cost** and **On Scope**. |

**Start Date** and **End Date** are the planned dates. **Actual Start** and **Actual End** are optional editable dates recorded on the Initiative. Newly introduced fields start empty. Existing compatible fields keep their stored values. When the resulting row has both actual dates, the end must be on or after the start. Validate the merged pair on create, partial update, bulk edit and supported import. Either actual date can be cleared. Date edits follow the existing card field permissions.

Where the embedded **Financials** comparison displays existing descendant-derived figures, use only descendants whose costs the viewer may read. The invoiced amount remains scoped to this initiative's own invoices.

### Planned and actual dates in the Initiative plan

Today, the card's `startDate` and `endDate` feed the authenticated Portfolio response's existing `start_date` and `end_date`. The Portfolio's **Plan** column, quarter range and planned bar use those dates. The PML project's Overview and printable Timeline also read the card's existing fields. Use those same fields for the planned dates. Resolve the actual dates from the Initiative Metamodel through an explicit PML Timeline field mapping and expose separate fields in the internal Portfolio response.

Initiative includes the optional, built-in date fields **Actual Start** (`actualStart`) and **Actual End** (`actualEnd`). Users can edit their values. Administrators can change their labels or move them in the layout, while the field keys and date type are protected. The upgrade normalizes Aruba's legacy `ActualEnd` spelling and carries across its existing label, placement and values.

The built-in fields are the default sources for the private Timeline. In **Administration → Settings → PML → Timeline**, an administrator can map other distinct editable Initiative date fields. An existing compatible custom mapping is retained. Start Date and End Date are reserved for Plan. An alternative field in an active mapping must be remapped or cleared before it can be removed or changed to an incompatible type.

| Surface | Behavior |
|---|---|
| **Initiative card summary → Cost & Timeline → Timeline** | Show the four date fields and the single-initiative **Plan / Actual** diagram on the same quarterly axis. Set the single-initiative axis to include its visible planned and actual dates, including an early start or a late finish. |
| **PML → Portfolio** | Show **Plan** and **Actual** as distinguishable tracks for each initiative on the same shared quarter grid. The exact visible actual dates are accessible in desktop and mobile rows, including when a program is rendered as the group anchor or a date is outside the rolling window. Show an intersecting range clipped at the window edge. A date or range wholly outside the window has no mark on the axis. |
| **PML → Initiative → Overview and printable project report** | Show Start Date, Actual Start, End Date and Actual End in the Timeline summary, with explicit planned/actual labels and the same values as on the Initiative card. |

- **Plan** follows the existing Portfolio rule. When the initiative has neither planned date of its own, it can show the planned bounds of readable descendants, marked as derived. **Actual** uses the Initiative's own dates. With one actual date, use a labelled marker for the known boundary. With both, show a span. With neither, show an empty actual state.
- Keep one date source on the Initiative. Refresh the PML views from it after a successful card edit. Status indicators **On Time**, **On Cost** and **On Scope** come from the most recent visible PML status report. The card diagram and Portfolio use the same ordering, descending by report date, creation time and stable ID.
- Apply Initiative and PML read scope to the embedded diagrams and internal Portfolio data. Exclude hidden date fields from Portfolio date data, diagrams, axis bounds, tooltips, row details, Overview, printable parameters and printable Timeline. If only one actual boundary is visible, display that boundary as a marker and omit the hidden date. **On Cost** follows cost visibility. Anonymous Portfolio data and rendering keep their existing planned-date contract. The detailed Gantt continues to use its work-package and task schedule.
- An existing public Initiative card portal continues to honor its current field visibility. Mapping a date that the portal already displays keeps it visible there as a normal card field. Mapping a hidden date keeps it hidden. A newly created date field follows the same publishing defaults as other new card fields. The private PML schedule and invoiced data have no public card projection.

### Worked example

| Row | Amount | Total Cost Items | Total Invoiced | Remaining to Invoice |
|---|---:|---:|---:|---:|
| Planned Budget — Platform FY26 | 12,000 | 10,000 | 6,500 | 3,500 |
| Cost Item — Renewal | 8,000 | | 6,500 | 1,500 |
| Cost Item — Support | 2,000 | | 0 | 2,000 |
| Invoice INV-00018 → Renewal | 4,000 | | | |
| Invoice INV-00051 → Renewal | 2,500 | | | |

Moving the 2,500 invoice from Renewal to Support produces an invoiced total of 4,000 on Renewal and 2,500 on Support. Support's remaining amount is −500. The totals on Platform FY26 are still 6,500 invoiced and 3,500 remaining. Moving Support to another compatible budget moves its cost, invoiced amount and remaining amount together. The Cost Item's Provider selection follows the destination budget's hierarchy.

The Initiative card displays **6,500 Actual Invoiced** throughout those moves. If the same initiative also has a 300 invoice on an unassigned legacy Cost Item, its card and Budget & Costs tab show **6,800**. The 300 invoice is visible inside its cost under **Unassigned Cost Items**. Its amount enters a budget line's totals after assigning that cost.

## Administration

Place the configuration in **Administration → Settings → PML → Budget & Costs**. It applies to all initiatives in the instance. The page has **Planned Budget**, **Cost Items** and **Actual Invoiced** tabs. Each tab manages its row type; a Cost Item inherited field also depends on its configured Planned Budget source.

An administrator can add a field, edit its settings, reorder it, control whether it appears as a column and deactivate it. The hierarchy and print view use each row type's column configuration. Deactivating a field hides it from new entry and the display while preserving existing data. The forms show the editable standard identifiers and amounts. Required relationship references are populated from the parent context in the create forms. The server validates values submitted through every supported entry point.

| Configuration | Behavior |
|---|---|
| Label and help | The label is display text, and the help describes what to enter. A stable key preserves stored values and dependencies across label changes. |
| Type | Text, number, date, yes/no, single select, card reference and calculated. |
| Options | Single-select options have stable identities. Renaming an option updates its display label. Deactivation keeps existing values readable and excludes the option from new choices. |
| Required and default | Available for editable fields where applicable. Defaults apply when creating a row. Existing stored values stay intact when defaults change. |
| Visibility and order | Set per section for the tables and their printable representation. Field deactivation is available for definitions that are no longer used. |
| Card reference | Configure the allowed metamodel card type. The field stores a validated card ID and displays the readable card's name. A compatible relation type can optionally be selected for automatic linkage to the initiative. Actual Invoiced supports references to other card types and excludes Provider from its configured fields, rules and relation targets. |
| Inherited Provider | On Cost Items, optionally expose the parent Planned Budget's configured Provider as the default. If child selection is enabled, permit choosing a direct child of that Provider as the effective Provider on a Cost Item. Expose these Provider values to Cost Item formulas. |
| Calculated | Configure result type, inputs and expression or ordered rules. The result is read-only for the project editor. |

### Field lifecycle

Use stable instance configuration that can be transferred with the financial data. Preserve historical row values across label changes, column reordering and field deactivation. Reject changes that would invalidate a live formula or active automatic relation configuration and identify the affected field. A type change on a populated field requires a new definition with a different key, so switching types does not silently convert stored data. For an older row with no value for a newly required field, display the blank value and enforce the requirement when the row is next saved. Opening or listing existing rows remains possible.

An active inherited field also protects its Planned Budget source from deactivation or an incompatible type change. Identify the dependency in the administration error. Column visibility is independent of field activation, so the source may be hidden from the budget summary while it continues to provide the inherited value.

A saved but unreadable reference is already populated. A partial edit to another field preserves that reference and does not require the editor to submit it. Omission of a custom field in a patch preserves the stored value. For a referenced card that has been archived, existing financial rows keep their reference and display the archived state when the card is readable. Exclude archived cards from new selections. For a deleted card, keep the financial row and show that the reference is unavailable. Rules and defaults no longer resolve that card, and the admin editor identifies the unavailable selection for correction.

### Calculated fields

Use a single editor across all three sections. It has inputs for a label, result type, source fields, calculation and preview. An administrator can define a bounded expression or a list of ordered **If → Then** rules with a fallback. Conditions can compare supported field values and use boolean combinations. Rules are evaluated from top to bottom and the first match supplies the result. An explicit fallback can be empty.

- A formula can use standard scalar fields and custom fields available on its own row. For classification, expose both the effective Cost Item Provider and the parent budget's Provider as read-only inputs where configured. A formula can reference other valid calculations on the same row and compare a card reference to a card selected in configuration using its stable ID. Local values and stable option IDs support the comparisons needed for classification.
- The initial editor covers simple numeric arithmetic, comparisons, boolean conditions and basic date extraction. Use the project's restricted evaluation conventions. Formula evaluation uses explicit typed inputs and an allowlisted set of operations. Arbitrary code execution and access to unrelated rows, requests or storage are outside the evaluator.
- Validate both the configured result type and the full dependency graph before saving a definition. Show an informative error for an unknown field, invalid expression, type mismatch or circular reference. The preview uses example values and the same rule semantics as the displayed result.
- Evaluate authoritative results from the current definition and values. Missing inputs can be handled by a rule or yield a blank result. An invalid value or arithmetic error affects that result, with an intelligible error in the preview or field display. The underlying row and standard financial totals remain usable.
- The five financial table summary columns and the Initiative card total use the fixed definitions in this spec. The table columns support column configuration. Free-form multi-row expressions are outside the initial editor. This gives the user the required cross-row totals without making arbitrary row queries part of custom field evaluation.

### Automatic Provider relationship

The Aruba Provider Metamodel already has **Supports Hierarchy (Parent / Child)** enabled and the **supports** relation from Provider to Initiative, as read via the Turbo EA connector. The built-in Provider type starts with hierarchy disabled on a fresh installation. Aruba configures **Origine Costi** as a Planned Budget card-reference field for **Provider**, with that existing relation. When creating or editing a budget line, the picker shows readable Provider cards. A Cost Item defaults to that Provider and can optionally select one of its direct Provider children in the existing card hierarchy. When a child is selected, connect it to the Initiative using the same relation type. Store the selected budget Provider and optional child by ID.

Apply card read scope to both Provider selectors. Require the budget Provider itself to be readable before looking up or counting its children. A hidden parent yields an empty choice list even if one of its children is readable elsewhere. List active eligible children and check the actual parent relationship on new assignment, reassignment and ordinary import. A stored child reference continues to identify that child if the Provider taxonomy is later reorganized or its hierarchy is disabled. Disable new child selection while the hierarchy is disabled. A subsequent move or Provider reassignment must satisfy the destination budget's selection rule. Use the existing relation writer in the same transaction as the budget or Cost Item change. An editor needs `relations.manage` to create a missing relation. Reuse preserves the existing relation's attributes and description. A denied creation leaves the financial change unapplied and gives an actionable error. Retain established relations when a financial row is edited or removed, including when other budgets or costs use them.

### Provider changes on budgets and costs

- Change the budget Provider or Cost Item child through the normal selectors. If a budget Provider change invalidates explicit child selections, identify the affected costs and allow the editor to return them to budget inheritance explicitly before saving the change. For a Cost Item move, validate its selection against the destination budget or let the editor select that budget's default or an eligible child in the move form.
- Apply the same Provider rules to all Cost Items. Enabling inheritance displays the configured budget default for linked costs without a child selection. Preserve explicit selections as described above, along with unavailable references. Provider edits, reconfiguration and Cost Item moves have no invoice-dependent conditions.
- For individual Cost Item deletion, check invoice read access before consulting linked invoice rows. Return the same denial to an unauthorized editor whether the cost has invoices or not. Authorized editors receive a dependency message when invoices are linked.

### Aruba configuration example

Configure **Origine Costi** on the Planned Budget tab, then expose it on Cost Items with direct-child selection and configure the other three fields there. An installation with empty field configuration has the standard financial fields and system calculations.

| Field | Scope | Setup |
|---|---|---|
| **Origine Costi** | Planned Budget, Cost Items | Choose the default Provider on Planned Budget. A Cost Item inherits it or selects a direct child. |
| **Gestione intercompany** | Cost Items | Single select with `Plafond`, `Canone`, `Progetto` and `N.A.`. |
| **Origine Costi Aggregato** | Cost Items | Calculated text using the ordered classification below and the effective Provider. The budget Provider can provide a fallback for an unclassified child. |
| **OdA — Ordine d’acquisto** | Cost Items | Text. Example value `ODA-000427`. |

For example, choose **Aruba Software** on a Planned Budget line. One Cost Item keeps **Aruba Software**. Another can choose a child such as **Aruba Software / Licensing** if that Provider exists. The second Cost Item can carry `Canone` and purchase order `ODA-000427`. **Actual Invoiced** can receive its own row-local field definitions in administration, such as a calculated **Invoice year**.

For a Provider that supplies different kinds of purchases, Aruba can configure an optional **Tipo di spesa** single select to make the classification explicit on the Cost Item. It can be hidden from the main table while remaining available in the form. For example, two rows for the same external Provider can select `Licenze` and `Servizi esterni` and produce different aggregates. The rule setup chooses real Provider cards. The values **Licenze** and **Fornitore Esterno** from the original workbook describe the purchase category or provider classification.

| Order | Rule | Calculated value |
|---:|---|---|
| 1 | The row identifies a licence purchase. | **Licenze** |
| 2 | The row identifies an external service or uses the configured default for an external-service Provider. | **Servizi Esterni** |
| 3 | The effective Provider is Aruba Spa, Aruba PEC or Actalis, or an unclassified child uses that classification from the budget Provider. | **Servizi interni** |
| 4 | The effective Provider is Aruba Software, Aruba System, Aruba Cybersecurity, Aruba Marketing, Aruba Service Desk, Aruba Enterprise or Aruba DC&Infra, or an unclassified child uses that classification from the budget Provider. | **Servizi Intercompany** |
| 5 | No rule matches. | Empty until the administrator adds a matching rule or the user completes the row. |

The first two rules allow two Cost Items under the same budget and Provider to yield **Licenze** on a renewal and **Servizi Esterni** on a support purchase. Provider defaults are expressed through the selected Provider identities in the rules. The product does not require hard-coded Aruba identities or names.

## Permissions, storage and transfer

- Use `ppm.view` and `ppm.manage` with the existing initiative read scope for financial row reads and writes. The configuration editor uses `admin.settings`. Readers receive the display metadata, eligible options and values needed for their financial tables. Expression source and card identities in rule definitions stay on the administration side and respect card read scope there as well. Apply CardReadScope to the initiative, referenced Provider and other card references. Return an unavailable value without the card's name or ID when access is denied. Suppress computed values that depend directly or transitively on an unreadable card reference. Preserve the underlying reference during unrelated edits.
- Use stable row identities and database foreign keys for Budget → Cost → Invoice. Validate same-initiative ownership during writes and imports. Complete link and relation changes transactionally. Code that writes derived card attributes or relations follows the existing event and audit conventions.
- Add the invoice entity and field configuration to workspace transfer. Apply definitions and budgets before Cost Items and Cost Items before invoice rows. Remap all references to the linked cost or budget, the initiative and other cards, including card IDs inside configured values and rules. Validate that required parents resolved in the destination and report invalid new-format links without silently reassigning them.
- Include the PML Timeline mapping in workspace configuration transfer with its case-sensitive Initiative field keys. Validate it against the destination Metamodel after resolving the selected type definitions. A restore preserves both the mapping and the card values without seeding duplicate fields. An import that omits the mapping keeps the destination configuration, reports source keys that cannot serve the same Timeline roles and protects the definitions still used by the destination mapping. Preview and apply report an unresolved or incompatible mapping and preserve the previous valid configuration. Neither path substitutes fields or renames stored values implicitly.
- Export existing Provider assignments that became historical through a taxonomy change with an explicit historical state. A workspace restore can preserve that same budget and child association after resolving both references, and reports it as historical in preview and apply. A newly imported assignment without that state must satisfy the current hierarchy. Later user-initiated assignments and moves also follow the current hierarchy.
- Validate budget and Cost Item Provider references in selected imports against the resulting hierarchy, using the same historical-association rules as a full restore. Resolve invoice parents separately by Cost Item ID. A Provider change does not affect a matching destination invoice or its parent reference.
- A legacy bundle without the new fields or invoice section remains importable. A new-format round trip into an empty workspace preserves editable data, custom definitions, classification inputs and links. Derive the Initiative card's invoiced total during workspace finalization from the resolved invoice rows. Ignore any independent card total sent in a bundle.
- Unassigned legacy Cost Items, including those with invoices, can round-trip through a current-format bundle with an explicitly empty budget reference. Carry references to already-deleted Providers as an explicit unavailable state, with a distinct opaque historical identity for each deleted Provider. Restore their financial rows without recreating a deleted card. Having the same unavailable display label does not make two historical Provider identities equal. A reference declared present in the source that cannot be resolved after remapping is an import error. With selected sections, resolve each parent from the imported data or an explicitly matched destination record and report the dependency if neither is available.
- Apply the same validation in preview and import, including on populated destinations. When an incoming field definition conflicts by section and stable key with an incompatible destination definition, report the definition and dependent rows. Preserve destination definitions and values. Use stable row identities for retry and matching so a repeated import does not duplicate invoice rows.
- Regenerate OpenAPI for the financial and configuration contract changes. Update the English user and admin manual and the supported locale copies, including where to find the renamed module, how to set up the fields and how the three levels calculate totals.

## Acceptance criteria

| Scenario | Expected result |
|---|---|
| Open the module as a PML user | Navigation, module pages, settings and the manual use Project Master List or PML. Existing links resolve. |
| Open previous data after upgrade | Budget history and Cost Items are readable. Unassigned costs still count in the initiative's Actual total. Assigning one adds its full financial contribution to the selected budget line. |
| Open an initiative with only descendant costs | Existing derived figures retain their meaning in the tab and print view. Its budget lines include only explicitly linked Cost Items in the new summaries. |
| Create a Cost Item in a budget row | The form inherits the parent budget and displays a readable label, including when its description is absent. The saved row appears under that budget. The API rejects missing, removed or foreign-initiative parent references without writing a row. |
| Compare a CapEx budget with an OpEx Cost Item | The child contributes to the CapEx budget's hierarchy subtotals. Its recorded cost still contributes to OpEx in the existing Actual cost views and charts. |
| Add invoices from a Cost Item row | The form inherits the parent Cost Item and displays its label. Date, ID and amount are entered by the user. The new invoices appear under that Cost Item. Multiple invoices sum correctly, including a zero amount, fractional amounts and an amount exceeding the cost. Negative input is rejected and a negative residual is displayed. |
| Invoice a historical cost with fractional amounts | A Cost Item with a recorded amount of 100.13 and an invoice of 30.11 shows 30.11 invoiced and 70.02 remaining. |
| Edit, delete or move a linked row | Both affected parents' summaries match the recorded links. Moving a Cost Item transfers its invoice contribution to the new budget. Re-entering the view, printing or refreshing produces the same numbers. |
| Open the Initiative card after invoice changes | The card and Budget & Costs tab show the same total, including invoices from unassigned legacy costs. Reassigning rows within the initiative leaves its total stable. Deleting the last invoice returns the total to zero. Invoices from child initiatives do not contribute. |
| Open Cost & Timeline on the Initiative card | Financials overlays Actual Cost on Budget for Total, CapEx and OpEx. With Budget 12,000 and Actual Cost 11,000, the narrower bar ends within Budget and displays 92% with a variance of +1,000. Above budget it extends past Budget. Budget 0 and Actual Cost 3,000 display a variance of −3,000 and omit the ratio. Actual Invoiced appears separately. Timeline shows Start Date, Actual Start, End Date and Actual End, the initiative plan and the latest On Time, On Cost and On Scope assessments. |
| Edit actual dates | The card accepts a partial actual span. Submitting only an actual end before the stored actual start is rejected, including through bulk edit or import. The diagram updates the actual dates without editing the planned dates or the reported health assessments. |
| Compare the Initiative card and PML plan | With the view date fixed at 2026-07-01, planned dates 2026-04-01 to 2026-09-30 and actual dates 2026-05-15 to 2026-11-10, the card and internal Portfolio show two distinct tracks and the late finish. Overview and print show all four dates. Clearing the actual end leaves an actual start marker. |
| View a program used as a Portfolio group anchor | Its visible actual dates are available on desktop and mobile, including when an actual date falls outside the quarter window. |
| Hide Actual End for an Initiative subtype | A populated Actual End is omitted from the Timeline, axis bounds, Portfolio data and row details, Overview and printed summaries. The visible Actual Start appears as a marker. |
| Compare an internal Portfolio row without actual dates and its anonymous view | The internal row shows an empty Actual state. The anonymous view displays the existing Plan alone, with no Actual data or labels. |
| Map Actual End on an Initiative with an existing public card portal | The existing visibility setting is honored. A date already shown remains visible and a hidden date stays hidden. The portal has no private PML schedule or invoiced data. |
| Open a program with descendant plans | The diagram marks a plan derived from readable descendants when both own planned dates are blank. The actual track uses only the program's own recorded actual dates. |
| Open a card after upgrading a customized metamodel | Existing labels, hidden fields and subtype overrides are respected. The diagram and its axis do not expose dates hidden in that layout. |
| Upgrade the existing Aruba Metamodel | The built-in date fields use `actualStart` and `actualEnd`. The upgrade carries existing labels, values and portal visibility across the case change. The Metamodel protects both built-in date fields from removal. |
| Transfer a workspace with mapped actual dates | The full restore preserves `actualStart`, `actualEnd`, their mapping and their stored date values. A partial import with incompatible target fields reports the conflict and leaves the destination Timeline mapping intact. |
| Configure Timeline with one existing actual date field | The existing editable date can be mapped while the administrator creates the missing side. Plan fields and non-editable values are unavailable as Actual sources. Removing an active source is rejected with a dependency message. |
| Open or print a budget hierarchy | Expanding a budget reveals only its Cost Items. Expanding a Cost Item reveals only its invoices. Unassigned legacy Cost Items and their invoices sit in their own group. Print shows the hierarchy fully expanded. |
| Compare Cost Report before and after recording an invoice | With only Budget 100 and Actual Cost 80 on an eligible Initiative, the existing all-cost-fields report continues to show 180 after an invoice for 60. The Initiative card shows 60 as Actual Invoiced. Editable cost history has no invoice entry. |
| Try to delete a referenced budget or cost | A clear dependency error leaves the data intact. The parent can be deleted after its children have been moved or removed. |
| Configure fields on all three tabs | Each tab can store, display, hide and reorder its own fields. Adding a definition to one tab does not alter the others. |
| Configure a card reference on Actual Invoiced | The editor and the shared settings validation allow compatible card types other than Provider. Saving, previewing or importing a Provider definition or reference is rejected. |
| Configure formulas and rules | Preview and saved values agree. Updating an input recomputes the result. Invalid expressions, types and dependency cycles cannot be saved. A row editor cannot override a computed value. |
| Configure Aruba's fields on a clean instance | Choose the Provider on Planned Budget. A Cost Item uses it by default or can select an eligible direct child. Each Provider relation appears once per initiative and OdA retains leading zeros. |
| Restore a Cost Item after Provider hierarchy changes | If its recorded child Provider has been reparented, the transfer preserves the explicit historical association and reports it. A newly selected child outside the destination budget Provider's hierarchy is rejected. |
| Change the Provider of a cost with invoices | A permitted budget or Cost Item edit follows the ordinary Provider hierarchy and relation authorization rules. Each existing invoice keeps its cost link and its recorded date, amount and document ID. |
| Move an invoice within an initiative | The permitted editor can select a target Cost Item with a different Provider. The former and destination cost totals update, and the Initiative total is stable. A foreign Initiative target is rejected. |
| Attempt to delete a Cost Item without invoice read access | A user with ordinary PML write access receives the same denial with or without dependent invoice rows. Provider changes continue to use their own permissions. |
| Compare net amounts | A Cost Item entered at 1,000 and an invoice entered at 700 display a 300 residual. The stored and displayed amounts exclude VAT and match what the user entered. |
| Change the configuration of an inherited Provider | Hiding its source budget column is allowed. Deactivating or replacing the source with an incompatible type while the inherited definition is active is rejected with a dependency message. |
| Configure Tipo di spesa for a mixed Provider | Two Cost Items under the same external Provider's budget with values `Licenze` and `Servizi esterni` produce **Licenze** and **Servizi Esterni** respectively. |
| Read or write as a restricted role | Initiative, Provider and configuration permissions are enforced at API boundaries. An unrelated edit preserves a saved unreadable Provider, even if the field is required. A denied operation cannot create a relation or leak a hidden Provider identity through a calculated value. |
| Read or attempt to edit Actual Invoiced on the Initiative card | The same initiative, PML and cost read access rules apply to the card total and to invoice details, totals and residuals in the tab, API and print. The invoicing data is absent in anonymous output. A manual field edit cannot change the amount. |
| Archive or delete a Provider used on Planned Budget | Archiving keeps existing readable references and removes the Provider from new selections. If a Provider is permanently deleted through the standard card lifecycle, the budget and its Cost Items are preserved and show the reference as unavailable. |
| Transfer data to an empty workspace | Budget and cost links, invoice IDs and amounts, custom fields, rules and Provider IDs are remapped and financial summaries agree with the source. Already-deleted Providers remain unavailable. An older bundle still imports. |
| Import into a populated workspace | Preview and apply agree on incompatible field definitions and unresolved nonempty references. An unassigned legacy cost with invoices remains valid. A repeat of the same successful import creates no duplicate invoice rows. |
| Import a budget or Cost Item without the invoice section into a populated workspace | Preview and apply validate the Provider against the budget hierarchy and the normal match rules. Existing invoice links and values are preserved. |

## Design decisions proposed in this specification

- Product rename covers the user surface. Existing routes, permission keys and integration identifiers retain their established semantics.
- Show the system totals as read-only columns, with the Cost Item's recorded amount excluding VAT as the basis for Remaining to Invoice. Retain signed residuals. Enter and store invoice amounts excluding VAT as decimal values.
- Use one invoice row for one Cost Item's portion. The invoice reference is textual and may repeat for different allocations. Record nonnegative amounts in the first release. Credit notes and payment reconciliation are outside the feature.
- Use explicit reassignment before deletion of a financial parent with dependants. Keep Provider relationships on the initiative when a financial row changes or is removed. When a Provider itself is deleted through the existing card lifecycle, preserve the financial row and mark its reference unavailable.
- Treat custom field formulas as row-local and required summary totals as system calculations. The Initiative card uses the initiative's own invoices across all fiscal years. For Aruba, default to the budget Provider and offer direct-child selection on the Cost Item. Keep the optional per-row purchase classification and compare Providers by card identity. Unmatched rows can show a blank aggregate.
- Use the mapped optional Initiative dates for the Actual span or marker in the card and internal PML planning diagrams. The built-in defaults are `actualStart` and `actualEnd`. Show the same four dates in the PML Timeline summary and print.
- Apply the same cost visibility to the new invoice tracking details and summaries on every surface.
- Persist and transfer the instance schema. Use safe configuration evolution, including deactivation and stable field and option identities.
