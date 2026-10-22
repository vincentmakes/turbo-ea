# Your First Analysis: Application Harmonisation

This is the payoff. You have an application inventory, a capability map, and the built-in TIME Model field. Now you connect them and produce the two reports that justify the entire EA programme to a CIO:

- The **Application Portfolio** report, with every application grouped by **Business Criticality** and coloured by its **TIME** disposition (**T**olerate / **I**nvest / **M**igrate / **E**liminate).
- The **Capability Map**, a heatmap that shows where you have redundancy (multiple apps per capability) and fragility (single app per capability).

## Step 1 — Map applications to capabilities

The single most valuable relation in the entire metamodel is **Application → Business Capability** (`supports` / `is supported by`). You'll set it for every application in scope.

### Bulk path: inventory edit mode

1. Go to **Inventory**, filter by Type = `Application`.
2. Make sure the relation column **Business Capability** is visible (Columns tab → Relations).
3. Toggle **Grid Edit** mode in the toolbar.
4. Click the capability cell on each row and pick one or more capabilities. Each change is saved as soon as you make it.

For 50–200 apps, this takes an afternoon and one cup of coffee.

### Card-by-card path

For high-judgement mappings (or when a workshop with the Application Owner is involved), open each Application card and use the **Relations** section. You get the full picker with search, hierarchy preview, and the ability to set relation attributes.

### How many capabilities per application?

| Mapping count | What it means |
|--------------|---------------|
| **0** | Unmapped — your inventory is incomplete. Filter for these and fix. |
| **1** | The clean, ideal case — this app supports exactly one capability. |
| **2–3** | Fine — many apps span a couple of related capabilities. |
| **4+** | Suspect — you may be conflating "uses data from" with "supports". Re-check. |

!!! tip "Best practice"
    The first pass mapping is fast and rough. The second pass — done with the Application Owner reviewing — is what makes the data trustworthy. Plan for both.

## Step 2 — Rate criticality and fit

Three built-in fields in the **Assessment** section of every Application card feed the analysis. Fill them with the Application Owner — in a one-hour workshop you can typically rate 30–50 applications using **Grid Edit** with the three columns visible.

| Field | Options | What it answers |
|-------|---------|-----------------|
| **Business Criticality** | Mission Critical / Business Critical / Business Operational / Administrative | How much does the business depend on this app? |
| **Functional Suitability** | Perfect / Appropriate / Insufficient / Unreasonable | How well does it do what the business needs? |
| **Technical Suitability** | Fully Appropriate / Adequate / Unreasonable / Inappropriate | How healthy is the technology underneath? |

Business Criticality groups the report in Step 4. The two suitability ratings are what the TIME calculation in Step 3 reads.

Editing these fields on an approved card flips its approval status to **Broken**. Re-approve the cards in a batch after the workshop.

## Step 3 — Derive TIME with a calculated field

The built-in **TIME Model** field on Application (`timeModel`, four options: `tolerate` / `invest` / `migrate` / `eliminate`) is the decision column that drives the rest of the analysis. Rather than asking every Application Owner to pick one, derive it from the two suitability ratings with a **calculation** — the classic Gartner placement:

| | Technical Suitability high | Technical Suitability low |
|---|---|---|
| **Functional Suitability high** | **Invest** | **Migrate** |
| **Functional Suitability low** | **Tolerate** | **Eliminate** |

1. Go to **Admin → Metamodel → Calculations** and click **New Calculation**.
2. Set **Target Card Type** = `Application` and **Target Field** = **TIME Model**.
3. Paste the formula from [Customise the metamodel → Option: derive a field automatically with a Calculation](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). It uses the built-in suitability fields, so no custom field is needed.
4. Click **Validate**, save, then use **Test** on a few applications you know well to check the result.
5. Switch the calculation **Active** in the list, then click **Recalculate all** on its row to fill TIME Model on every application.

From then on, TIME Model is recomputed every time an application is saved, shows a **calculated** badge, and can no longer be edited by hand. An application missing either suitability rating gets no TIME value — that is deliberate: it shows you which ratings are still missing.

!!! warning "Don't"
    A calculated TIME is a **starting hypothesis**, not a verdict. Review the results with the Application Owners before presenting them. Where a decision has to override the formula, turn the calculation off (the **Active** switch) and edit TIME Model by hand in **Grid Edit**.

Reference: [Admin → Calculations](../admin/calculations.md).

## Step 4 — Run the Application Portfolio report

1. Go to **Reports → Application Portfolio**.
2. Set **Group by** = **Business Criticality**.
3. Set **Color apps by** = **TIME Model**.
4. Click the bookmark icon (**Save report**) and name the view ("Application Portfolio — Sales Domain"). You'll find it again under **Reports → Saved Reports**.

Each Business Criticality level becomes a box, with one chip per application coloured by its TIME disposition and a bar showing the mix. To focus on one domain, use the **Related By** filter with the capabilities in your scope.

What to look for:

- **Mission Critical and Business Critical apps marked Migrate** — your most consequential modernisation decisions. These come first.
- **Administrative and Business Operational apps marked Eliminate or Migrate** — your fastest simplification wins: retire them or consolidate them onto another platform.
- **Mission Critical apps marked Invest** — confirm they're actually getting the investment.
- **Apps with no colour** (TIME *Not set*) — one of the two suitability ratings is missing. Go back to Step 2.

Reference: [Reports → Portfolio Report](../guide/reports.md#portfolio-report).

## Step 5 — Run the Capability Map

1. Go to **Reports → Capability Map**.
2. Keep the **Heatmap Metric** on **Application Count**: the cell colour intensity is proportional to the number of applications supporting that capability.
3. Optional: turn on **Show Applications** and set **Color Apps By** = **TIME Model** to see the TIME disposition of the apps inside each capability.

What to look for:

- **Hot cells** (many apps per capability) — candidate redundancy. The most common business case for an Application Portfolio Rationalisation lives here.
- **Cold cells** with applications you'd expect — gaps in your mapping, or genuinely under-supported capabilities.
- **White cells** in the middle of an active branch — unmapped applications, or unmodelled capabilities.

Reference: [Reports → Capability Map](../guide/reports.md#capability-map).

## Step 6 — Present and iterate

You now have a defensible portfolio view. Put the two reports in front of the Sales CIO (or whoever owns your scope) and:

- Confirm the TIME calls on the Mission Critical and Business Critical applications.
- Identify the top 3 hot cells in the heatmap as candidate rationalisation projects.
- Capture follow-ups as comments or todos on the applications themselves — Turbo EA tracks them per card.

That's it. You have a working EA practice on Turbo EA.

## What's next

Once your application portfolio is alive and trusted, these become high-value next steps. None of them are useful before you have a populated inventory — which is why this guide deliberately deferred them.

| Module | When to open it | Where to find it |
|--------|----------------|------------------|
| **Risk Register** | When you're ready to track architecture risks against applications and capabilities (TOGAF Phase G). | [Risk Register](../guide/risks.md) |
| **GRC / Compliance** | When you need to map applications and capabilities against regulations (GDPR, NIS2, EU AI Act, DORA, SOC 2, ISO 27001). | [GRC](../guide/grc.md) |
| **PPM** | When the rationalisation decisions become projects with budgets, schedules, and status reports. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | When you have enough cards for AI to find vendor duplicates, modernisation candidates, and architecture recommendations. | [TurboLens](../guide/turbolens.md) |
| **BPM** | When you're ready to model the processes that sit on top of your applications. | [BPM](../guide/bpm.md) |
| **Diagrams** | When you need free-form architecture diagrams that stay in sync with the inventory. | [Diagrams](../guide/diagrams.md) |
| **EA Delivery** | When you start producing TOGAF-style Statements of Architecture Work and Architecture Decision Records. | [EA Delivery](../guide/delivery.md) |

Welcome to Turbo EA.
