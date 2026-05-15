# Your First 30 Days with Turbo EA

So you've installed Turbo EA. The login screen works, the demo data loads, every menu item shows you something — and now you're staring at an empty inventory wondering where to actually start. This guide is for you.

It's a sequenced, opinionated walkthrough of the **first concrete EA initiative** most organisations run on Turbo EA: getting an application inventory under control and using it to answer real portfolio questions. It deliberately ignores the more advanced modules (Risk Register, Compliance, PPM, TurboLens AI) — those become useful once your inventory is alive, not before.

## Who this guide is for

- **Enterprise Architects** starting a fresh EA practice or migrating from spreadsheets, Confluence, or another tool.
- **Solution Architects and Application Owners** asked to "fill in the EA tool" without much context.
- **Admins** preparing the platform for a wider rollout.

You'll need the **admin** role (or at least `admin.metamodel` and `inventory.edit`) to follow every step. Read-only roles can still benefit — they just won't be able to make the metamodel changes in page 5.

## The crawl → walk → run arc

Don't try to model the entire enterprise in week one. The teams that succeed with EA tooling follow a phased path:

1. **Crawl** — One narrow scope (a business domain, a country, a platform). One card type (Applications). Five fields per card. Get to "good enough" data on 50–200 cards.
2. **Walk** — Add Business Capabilities from the bundled catalogue. Map applications to capabilities. Run your first portfolio analysis. Show it to a stakeholder.
3. **Run** — Expand to processes, interfaces, data objects. Add more custom fields. Open the more advanced modules.

This guide covers **crawl** and the beginning of **walk**. By the end of it, you'll have a working application portfolio with a TIME disposition (**T**olerate / **I**nvest / **M**igrate / **E**liminate) and a Portfolio Report you can put in front of a CIO.

## What's in this guide

| # | Page | What you'll do |
|---|------|---------------|
| 1 | [Plan your rollout](plan-your-rollout.md) | Scope the initiative, pick stakeholders, set a realistic data-quality target |
| 2 | [Start with your application inventory](start-with-applications.md) | Populate Applications via import, ServiceNow, or manual entry |
| 3 | [Leverage reference catalogues](leverage-reference-catalogues.md) | Skip months of hand-modelling by importing capabilities and processes |
| 4 | [Customise the metamodel — lightly](customise-the-metamodel.md) | Add one custom field (TIME) the right way |
| 5 | [Your first analysis: Application Harmonisation](your-first-analysis.md) | Map apps to capabilities, run the Portfolio Report and Capability Heatmap |

!!! tip "Best practice"
    Read all five pages in order before opening Turbo EA. The plan in your head is more valuable than the first 50 cards in the inventory.

## Prerequisites

- A running Turbo EA instance (see [Installation & Setup](../getting-started/setup.md)).
- An admin account (the first user to register becomes admin automatically).
- **Optional but recommended for first-time users:** start the stack with `SEED_DEMO=true` once to see what a populated inventory looks like (the NexaTech Industries fictional company). You can then reset with `RESET_DB=true` and start clean on your real data.
- A rough idea of the **business domain** you want to model first. "All of IT" is not a domain.

## What you'll skip — for now

These are powerful modules, but they assume you already have a populated inventory. Don't open them yet:

- **Risk Register** and **Compliance scanning** — useful once you have applications and capabilities to attach risks to.
- **PPM** (Project Portfolio Management) — useful once you have a project pipeline worth tracking.
- **TurboLens AI** (vendor analysis, duplicate detection, Architect wizard) — useful once you have enough cards for the AI to find patterns in.

You'll find a short "what's next" pointer to each of them on the [final page](your-first-analysis.md) of this guide.

Ready? Head to [Plan your rollout](plan-your-rollout.md).
