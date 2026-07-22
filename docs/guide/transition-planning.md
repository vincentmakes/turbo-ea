# Transition Planning

Transition Planning is a manual planning tool in **EA Delivery** for modelling changes to your landscape — replacing an application with another for a certain organization, decommissioning a legacy system, or introducing a new platform — and communicating them as a **single before/after diagram**. It offers a similar outcome to the TurboLens Architect, but without any AI: you stay in full control of every proposed change.

The result is a Layered Dependency View showing the current and the planned state in one picture, with change indicators:

- **Red cross** — a card or relation marked for removal
- **Green plus** — a newly added card or relation
- **Blue swap arrows** — a replacement: the successor card and the connections it inherits

## Creating a plan

Open **EA Delivery** and use **Add → New transition plan** on an initiative (or create an unlinked plan and attach it later). A plan is built in four steps:

1. **Business objectives** *(optional)* — name the Objective cards this change supports. They appear in the Strategy layer of the diagram, so every stakeholder sees the *why* alongside the *what*, and they pre-populate the Initiative links when the plan is committed. **Derive scope from objectives** walks the strategy top-down — objective → the capabilities it drives → the applications supporting them — and pulls that slice straight into the baseline, so you plan from strategy rather than hunting for cards.
2. **Scope & baseline** — pick one or more scope cards (an Organization, a Business Capability, individual Applications, …) and a dependency depth (1–3). **Capture baseline** snapshots the surrounding landscape as the *before* picture. The snapshot keeps the diagram stable even as the live inventory changes; use **Refresh baseline** to re-capture it later — any planned change whose target has disappeared is flagged.
3. **Planned changes** — apply change operations from the toolbox:
    - **Add card** — bring an existing card into the picture, or propose a completely new one (name + type, with an optional estimated annual cost).
    - **Remove card** — mark a card for decommissioning. Its connections turn red, and an **impact summary** shows what depends on it before you commit to the removal.
    - **Replace card** — pick the card to replace and its successor (existing or proposed-new). The successor inherits the predecessor's relations, shown as blue swap edges; cut individual inherited relations with **Remove relation**.
    - **Add / remove relation** — draw new connections or cut existing ones. Relation types are validated against the metamodel.
4. **Live preview** — the merged before/after diagram updates as you plan, alongside a **Consequences** panel (see below). Save the plan at any time; it appears in the initiative's **Deliverables** section.

## Understanding the consequences

Transition Planning is more than a diagram editor — as you plan, a **Consequences** panel makes the change's architectural impact visible, and the same figures render on the shareable preview and are folded into the committed ADR:

- **Gap analysis** — a TOGAF-style Added / Removed / Changed / Retained summary of the change.
- **Impact / blast-radius** — removing or replacing a card surfaces what depends on it ("*N applications, M interfaces depend on this*"), drawn from the card's own impact analysis, so a removal is a considered decision.
- **Capability-coverage gaps** — if a business capability loses *all* its supporting applications in the target state, it is flagged. This catches a decommission or replacement that would leave a capability unsupported.
- **Cost & risk deltas** — the estimated annual cost before → after (with the delta), and the number of open risks on the affected cards. Proposed cards contribute their estimated cost, which is also written onto the created card at commit.

## Committing a plan

A draft plan can be **committed** (requires the *Commit transition plans* permission). Committing:

- creates an **Initiative** card (with your chosen name and start/end dates) linked to the supported Objectives,
- creates the selected **proposed cards** and **relations**, linking each new card to the Initiative,
- stamps an **end-of-life** lifecycle date (the initiative end date) on removed and replaced cards, so lifecycle reports and roadmaps reflect the plan,
- optionally creates a **draft Architecture Decision Record** documenting every change — including cut relations, which are documented only and never deleted.

!!! note
    Committing never archives or deletes anything. Removed cards receive an end-of-life date; actually decommissioning them stays a deliberate, human step through the normal inventory workflows.

After the commit, the plan becomes read-only and links to the created Initiative.

## Permissions

| Permission | Grants |
|------------|--------|
| `transition_plans.view` | View transition plans |
| `transition_plans.manage` | Create, edit, and delete plans |
| `transition_plans.commit` | Commit a plan (create Initiative, cards, relations, draft ADR, stamp end-of-life dates) |

Members can view, manage, and commit plans by default; viewers can only view them.
