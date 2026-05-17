# Leverage Reference Catalogues

The classic mistake at this stage: spending three weeks workshopping a bespoke business capability model, two more weeks aligning it with the executives, and then discovering the model is 80% identical to what every other company in your industry uses.

**Don't model from scratch.** Turbo EA ships three curated catalogues that give you a battle-tested starting point you can adapt in days instead of months:

- **Business Capability Catalogue** — multi-level capability hierarchies per industry (banking, retail, manufacturing, insurance, public sector, etc.) plus cross-industry macro capabilities.
- **Process Catalogue** — reference business processes per industry, ready to import as `BusinessProcess` cards.
- **Value Stream Catalogue** — end-to-end value streams to bracket the capability map.

This page focuses on the Business Capability Catalogue, because it's the one that powers the Capability Heatmap on the final page. The other two work the same way.

## Why start with capabilities

A **Business Capability** is *what the business does*, expressed in stable, technology-independent language — "Order Management", "Customer Onboarding", "Claims Handling". Capabilities barely change over the years; applications change all the time. That's why the application-to-capability mapping is the single most useful relation in the entire metamodel:

- It lets you ask **"how many applications support Customer Onboarding?"** — and spot redundancy.
- It lets you ask **"which capabilities depend on a single ageing application?"** — and spot fragility.
- It survives reorganisations, vendor swaps, and cloud migrations.

You don't need 500 capabilities to get value. You need **20–60 capabilities, two or three levels deep**, in your scope.

## Import a starter capability map

1. Navigate to **Capability Catalogue** in the main menu (under User Guide).
2. Use the filters at the top:
    - **Industry** — pick yours (or "Cross-industry" if nothing fits).
    - **Level** — start with L1 and L2 visible. You can always go deeper later.
3. Browse the tree. Expand a few branches to get a feel for the depth.
4. Tick the capabilities you want to import. **Selection cascades**: ticking an L1 ticks its descendants; ticking an L2 also ticks its L1 ancestor so the hierarchy stays connected.
5. Click **Create cards from selection**.

Turbo EA creates one `BusinessCapability` card per ticked node, preserves the parent-child hierarchy, and stamps each card with a stable `catalogueId` so re-imports are **idempotent** — running the import twice doesn't create duplicates.

Full reference: [Capability Catalogue](../guide/capability-catalogue.md).

!!! tip "Best practice"
    Pick a subtree, not the whole catalogue. For an Application Portfolio Rationalisation in the Sales domain, importing the L1 capability "Sales & Customer Management" plus its L2 children is usually enough — that's 10–15 capabilities, not 300.

## How deep to go

The right depth depends on what you'll do with it:

| Depth | When to use | Typical card count |
|-------|------------|--------------------|
| **L1 only** | Executive-level summaries, very small scopes | 8–12 |
| **L1 + L2** | The sweet spot for a first rollout — readable in one screen, useful in reports | 30–60 |
| **L1 + L2 + L3** | Detailed capability-based planning, large enterprises | 100–250 |
| **L4 and deeper** | Specific deep-dives, not for a starting baseline | varies |

Go to **L1 + L2** for your first pass. You can always import additional levels later via the same catalogue — the idempotent re-import will fit them in under the existing parents.

## A word on processes and value streams

The **Process Catalogue** and **Value Stream Catalogue** work the same way: filter, tick, mass-create. If your first use case is Application Portfolio Rationalisation, you can skip them for now — capability mapping is enough to drive the analysis on the final page.

You'll want them when:

- You move from "rationalise applications" to "optimise the order-to-cash value stream".
- You start building BPMN process flows on the resulting `BusinessProcess` cards (see [BPM](../guide/bpm.md)).

## What if my industry isn't in the catalogue?

Two options:

1. **Pick the closest industry** and prune. The "Cross-industry" entries (Finance, HR, IT, Procurement) apply to virtually every company.
2. **Combine catalogues** — import "Cross-industry" first, then top up with a few items from a specific industry catalogue.

Either way, **import first, customise after**. Renaming an imported capability or adding a child is much faster than typing the whole structure from scratch. And you keep the `catalogueId` so future catalogue updates merge cleanly.

!!! warning "Don't"
    Don't create custom card types for capabilities or processes just to "make them your own". The built-in types come with the right fields, the right relation types, and the right reports — custom equivalents will not.

## Verify before moving on

You're done with this page when:

- The capability map for your scope exists in the inventory (filter by Type = `Business Capability`).
- The hierarchy is intact — open a few L2 capabilities and check that the parent breadcrumb shows the right L1.
- The capability count is between 20 and 60.

You haven't mapped any applications to capabilities yet — that's on the final page. First, let's add one custom field to Applications to make the analysis really useful.

Next: [Customise the metamodel — lightly](customise-the-metamodel.md).
