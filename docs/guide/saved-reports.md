# Saved Reports

Turbo EA lets you **save report configurations** so you can quickly return to specific views without reconfiguring filters and axes each time.

## Saving a Report

From any report page (Portfolio, Capability Map, Lifecycle, Dependencies, Cost, Matrix, Data Quality, or EOL):

1. Configure the report with your desired filters, groupings, and axis selections
2. Click the **Save** button in the report toolbar
3. Enter a **name** for the saved report
4. Choose the **visibility**:

| Visibility | Who can see it |
|------------|---------------|
| **Private** | Only you |
| **Shared** | You and specific users you select |
| **Public** | All users of the platform |

For shared reports, you can grant **edit permissions** to specific users, allowing them to update the saved configuration.

5. Click **Save** — a thumbnail is automatically captured from the current visualization

## Saved Reports Gallery

Navigate to **Reports > Saved Reports** to browse all saved reports you have access to. The gallery shows thumbnail previews organized into tabs:

- **My Reports** — Reports you created
- **Shared with Me** — Reports others have shared with you
- **Public** — Reports visible to everyone

### Actions

- **Open** — Click a report to load it with the saved configuration
- **Edit** — Update the name, visibility, or sharing settings
- **Duplicate** — Create a copy with a new name
- **Delete** — Remove the saved report (only the creator or users with edit permissions can delete)

## Custom Reports with Your AI Assistant

Beyond the built-in report types, Turbo EA can build **fully custom reports** from a plain-language description, using an AI assistant connected through the **MCP server**.

### How it works

1. Connect the Turbo EA MCP server to your AI assistant (for example Claude Code) — see the **MCP Integration** guide.
2. Describe the report you want in plain language, e.g. *"Count applications by business criticality as a pie chart"* or *"Total annual cost of IT components grouped by provider"*.
3. The assistant calls `get_report_builder_schema` to read your live metamodel (card types, fields, relations, tags), assembles a safe report **specification**, and previews it against your real workspace data with `preview_custom_report` — so you see actual results before anything is saved.
4. When you are happy, the assistant **publishes** the report with `create_saved_report`. It appears on the **Saved Reports** gallery and opens as a native, interactive report.

### What custom reports can do

- **Metamodel-aware**: your card types, subtypes, fields, relations, and tags are reflected automatically — no coding required.
- **Group and aggregate**: group by an attribute, subtype, lifecycle phase, tag group, or related card, and measure with count, sum, average, minimum, or maximum.
- **Filter and traverse**: filter the source cards and optionally follow one relation hop to related cards.
- **Many visualizations**: render as a table, bar/column/pie/donut/scatter/treemap/line chart, or KPI tiles.
- **Safe and governed**: reports are read-only, run entirely on declarative rules (no code, no SQL), and cost fields stay behind the **View costs** permission — exactly like every other report.

Custom reports are saved exactly like any other report, so the same private / shared / public visibility and sharing options apply.

### Building one by hand

You don't need the AI assistant. Open **Reports > Saved Reports**, create a Custom Report, and click **Build a report** to open a point-and-click builder: pick a card type, add filters, choose how to group (dimensions) and what to measure, and select a chart type. A live preview updates as you go; **Save** to publish.
