# Your First Analysis: Application Harmonisation

This is the payoff. You have an application inventory, a capability map, and a TIME disposition field. Now you connect them and produce the two reports that justify the entire EA programme to a CIO:

- A **Portfolio Report** that shows every application sized by cost, coloured by TIME disposition.
- A **Capability Heatmap** that shows where you have redundancy (multiple apps per capability) and fragility (single app per capability).

## Step 1 — Map applications to capabilities

The single most valuable relation in the entire metamodel is **Application → Business Capability** (`supports` / `supported by`). You'll set it for every application in scope.

### Bulk path: inventory edit mode

1. Go to **Inventory**, filter by Type = `Application`.
2. Make sure the relation column **Business Capability** is visible (Columns tab → Relations).
3. Toggle **Grid Edit** mode in the toolbar.
4. Click the capability cell on each row and pick one or more capabilities.
5. Save.

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

## Step 2 — Pick how you'll fill the TIME Model

The built-in **TIME Model** field on Application (`timeModel`, required, four options: `tolerate` / `invest` / `migrate` / `eliminate`) is the decision column that drives the rest of the analysis. You have two ways to populate it.

### Option A — Manual TIME entry (recommended for the first pass)

With the Application Owner in a one-hour workshop you can typically classify 30–50 applications:

- **Tolerate** — works, low cost, not a strategic differentiator. Leave alone.
- **Invest** — strategic, growth area, fund improvements.
- **Migrate** — replace or move to a new platform within the planning horizon.
- **Eliminate** — duplicate, end-of-life, decommission.

Use the inventory **Grid Edit** mode with the **TIME Model** column visible to capture decisions at speed.

### Option B — Calculated TIME via a formula

Rather than asking each Application Owner to set TIME manually, you can derive `timeModel` automatically from the two built-in suitability dimensions (`functionalSuitability` × `technicalSuitability`) using the **Calculations** feature. This is the canonical Gartner four-quadrant placement.

The worked example — the formula, the quadrant table, and the recommended hybrid pattern — lives in [Customise the metamodel → Option: derive a field automatically with a Calculation](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Use it as a starting recommendation that the owners then validate, not as a verdict.

## Step 3 — Run the Portfolio Report

1. Go to **Reports → Portfolio**.
2. Configure the axes:
    - **Card type**: `Application`
    - **X axis**: `technicalSuitability` (the built-in technical-fit field).
    - **Y axis**: `functionalSuitability` or `businessValue` (built-in business-fit fields).
    - **Size**: `costTotalAnnual` — the bigger the spend, the bigger the bubble.
    - **Colour**: `timeModel` — this is what makes the report decision-ready.
3. Save the configuration as a named view ("Application Portfolio — Sales Domain") so you can come back to it.

What to look for:

- **Big red bubbles** (high-cost Eliminate candidates) — your fastest savings.
- **Big amber bubbles** (high-cost Migrate candidates) — your most consequential transformation decisions.
- **Clusters in the top-right of the matrix** that aren't green — strategic apps that aren't getting the investment.

Reference: [Reports](../guide/reports.md).

## Step 4 — Run the Capability Heatmap

1. Go to **Reports → Capability Map**.
2. The heatmap shows your business capability hierarchy with cell colour intensity proportional to the **number of applications supporting that capability**.

What to look for:

- **Hot cells** (many apps per capability) — candidate redundancy. The most common business case for an Application Portfolio Rationalisation lives here.
- **Cold cells** with applications you'd expect — gaps in your mapping, or genuinely under-supported capabilities.
- **White cells** in the middle of an active branch — unmapped applications, or unmodelled capabilities.

Reference: [Reports → Capability Map](../guide/reports.md).

## Step 5 — Present and iterate

You now have a defensible portfolio view. Put the two reports in front of the Sales CIO (or whoever owns your scope) and:

- Confirm the TIME calls on the top 10 highest-cost applications.
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
