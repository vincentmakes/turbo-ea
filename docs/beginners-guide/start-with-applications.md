# Start With Your Application Inventory

Turbo EA ships with 13 card types out of the box. You will be tempted to populate them all. Don't.

**Start with Applications**. Applications are the highest-leverage card type in any first rollout:

- They are the easiest to source — IT departments almost always have a list somewhere (CMDB, licence tracker, finance system, even a spreadsheet).
- They anchor every other layer — once you have Applications, mapping to Capabilities, Processes, and IT Components becomes incremental enrichment rather than a green-field exercise.
- They drive the first useful report (Portfolio Rationalisation) with the fewest dependencies.

Other card types come later. A common second wave is Business Capabilities (page 4) and then Interfaces or Data Objects.

## What "minimum viable" looks like

For every Application card in your initial scope, populate these fields and **only** these fields:

| Field | Why it matters | Where it comes from |
|-------|---------------|---------------------|
| **Name** | Identity. Use the name people actually use, not the licence label. | Your existing source |
| **Description** | One sentence: what does this app do for the business? | Owner interview, or AI suggestion (see [Inventory](../guide/inventory.md#ai-description-suggestions)) |
| **Lifecycle phase** | Plan / Phase In / Active / Phase Out / End of Life | CMDB, or owner interview |
| **Business Owner** (stakeholder) | The person accountable for the app | Org chart |
| **Cost — Total Annual** | Used by the Portfolio Report and TIME formula | Finance, or rough estimate |

Five fields. That's it. The Data Quality ring will read ~50% and that's fine — you can refine in pass two.

!!! warning "Don't"
    Don't try to fill the **End of Life date**, **Vendor**, **Technology stack**, and 12 custom fields on the first pass. You will burn out around card 30.

## Three ways to populate the inventory

Pick the path that matches your data source. You can mix them — import the bulk, then manually fix the long tail.

### Path A — Excel / CSV import (recommended for most starts)

If your applications live in a spreadsheet (or you can export them from a CMDB), this is the fastest path. **Don't start by hand-crafting the spreadsheet** — let Turbo EA give you the template.

1. **Create one dummy Application card manually**. Go to **Inventory → + Create**, type = `Application`, name something like *"_TEMPLATE — delete me"*. Fill in the five minimum fields (description, lifecycle, owner, cost) so the export contains real values you can use as examples.
2. **Filter the inventory to Type = `Application`** and click **Export** in the toolbar. You get an `.xlsx` file with one row of real data and a column per field — that's your template. The column headers match the field keys the importer expects.
3. **Edit the spreadsheet offline**: keep the column structure, replace the single row with all your real applications, and delete the dummy row at the end (or leave it — you'll remove the card from Turbo EA after the import).
4. **Import the edited file**: **Inventory → Import**, drag in the `.xlsx`. The validation report shows you exactly which rows will create new cards, which will update existing cards (matched by name or ID), and which will fail.
5. Run the import, then archive the `_TEMPLATE` card.

Full reference: [Inventory → Excel Import](../guide/inventory.md#excel-import).

**Tip for first import:** include just the five minimum fields, plus a column for Business Owner email (the importer will try to match it to existing users). Skip everything else. You can do a second import later with more columns by repeating the export-edit-import loop.

### Path B — ServiceNow sync

If you have a ServiceNow CMDB and admin access to its API, the integration pulls Application records directly.

1. Go to **Admin → ServiceNow Integration**.
2. Create a connection (URL, credentials — credentials are stored encrypted).
3. Define a mapping: ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, with field-level rules.
4. Run a **pull** sync. By default records land in a **staging** area for admin review before being applied.

See [Admin → ServiceNow Integration](../admin/servicenow.md) for the full configuration. Treat the first sync as exploratory — review what came in, refine the mapping, then run it for real.

### Path C — Manual entry

For small estates (under ~30 apps) or when no usable source exists:

1. **Inventory** → **+ Create** (top-right).
2. Type = **Application**, fill in Name and (optionally) Description.
3. Click **Suggest with AI** if you want a starter description pulled from a web search.
4. Save and move on. You'll fill in the rest from the card detail page.

Manual entry is slow but produces the highest-quality data because every card is owner-touched on entry.

## Use the approval workflow as a quality gate

Every card carries an **Approval Status**: Draft → Approved → (Broken if substantively edited after approval).

A practical workflow:

1. New cards land as **Draft**. The Architect (you) does a quick pass — name correct, description sensible, lifecycle right.
2. Once the minimum fields are filled, **approve** the card. This signals to downstream consumers that the card is trustworthy.
3. If anyone later edits a substantive field, Turbo EA automatically flips the status to **Broken** until re-approved.

Filter the inventory by `Approval Status = Approved` to get a clean view for the portfolio report at the end of this guide.

!!! tip "Best practice"
    Approve in batches at the end of each day. It forces you to re-read what you imported and catch the worst data-quality issues early.

## When to stop populating and move on

You are done with this page when:

- Every application in your scope has a card.
- Every card has the five minimum fields filled.
- Average data quality across the set is **≥ 40%**.
- At least 50% of cards are approved.

Don't wait for perfection. Move to the next page — [Leverage reference catalogues](leverage-reference-catalogues.md) — and come back to enrich after you've mapped capabilities.
