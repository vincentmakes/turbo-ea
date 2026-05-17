# Plan Your Rollout

Before you create a single card, spend an hour answering four questions. The teams that skip this step end up with an inventory nobody trusts, because nobody agreed what it was for.

## 1. Define a narrow scope

The single biggest mistake in EA rollouts is trying to model the whole enterprise at once. Pick **one** of the following:

- A **business domain** (e.g., Sales, Finance, Customer Service, Manufacturing).
- A **legal entity** or **region** (a subsidiary, a country, a recently acquired business unit).
- A **platform** (e.g., the e-commerce stack, the data platform, the ERP estate).

A good first scope contains roughly **50–200 applications**. Less than that and there's nothing to analyse; more than that and you'll run out of energy before getting to the analysis.

!!! warning "Don't"
    Don't pick "the whole company" or "all of IT". You will spend three months chasing data and never get to a working report.

## 2. Pick the right first use case

The use case decides which fields matter, which stakeholders you need, and which report you'll show at the end. The most common — and the one this guide assumes from page 3 onwards — is:

> **Application Portfolio Rationalisation**
>
> Inventory the applications in scope, classify each one by business value and technical fitness, and decide what to **T**olerate, **I**nvest in, **M**igrate, or **E**liminate (the TIME framework).

Other valid first use cases — but pick **one**:

| Use case | What you'll mostly populate | What you'll skip |
|----------|----------------------------|------------------|
| **Application Portfolio Rationalisation** | Applications, costs, lifecycle, business value | Detailed process model, interfaces |
| **Capability-based planning** | Business Capabilities, Applications, capability heatmap | Cost detail, technology stack |
| **Cloud migration assessment** | Applications, IT Components, deployment model | Business value, processes |
| **M&A integration** | Both portfolios as Applications, overlap analysis | Long-term lifecycle dates |

If you're not sure, **pick Application Portfolio Rationalisation**. It's the most universally useful starting point and the rest of this guide is written around it.

## 3. Identify your stakeholders

Turbo EA has a built-in **Stakeholder** model (see [Card Details](../guide/card-details.md)): every card carries a list of people in defined roles (Business Owner, Technical Owner, etc.), defined per card type in the metamodel. Decide up front who fills each role for an Application:

- **Application Owner** — accountable for the application in the business. One person per app. They sign off on TIME disposition.
- **Technical Owner** — accountable for keeping it running. Often the engineering manager.
- **Architect** — you, probably. Acts as the EA-side reviewer and approves cards.

You don't need to assign stakeholders on day one for every card, but you do need to know who they *will* be — because in week three you'll be sending them surveys to validate the data.

!!! tip "Best practice"
    A real name in the Application Owner role is worth more than ten perfectly-filled custom fields. If you only ever populate one field beyond the name and lifecycle, make it the Application Owner.

## 4. Set a realistic data-quality target

Turbo EA computes a **Data Quality** score (0–100%) for every card, based on the weighted fields defined in the metamodel. It's the single best leading indicator of whether your inventory is usable.

Realistic targets for the first 90 days:

| Phase | Target avg. data quality (Applications) | What's filled |
|-------|----------------------------------------|---------------|
| End of week 2 (Crawl) | **40–60%** | Name, Lifecycle phase, Description, Business Owner |
| End of week 6 (Walk) | **60–75%** | + Capability mapping, Cost, TIME disposition |
| End of month 3 (Run) | **75–90%** | + Technology stack, interfaces, custom domain fields |

Don't push for 100%. The last 10% costs more than the first 60% and rarely changes a decision.

## 5. Commit a single deliverable

End your planning session with a written statement like:

> *"By the end of week 6, the Sales domain inventory will contain every application with annual cost > 50k€, each mapped to at least one Business Capability and carrying a TIME disposition. We will present the Portfolio Report to the Sales CIO in week 7."*

Stick it on a wiki, in a kickoff slide, in a Slack channel description — somewhere visible. That sentence is what stops the rollout from drifting into "we're still gathering data" purgatory.

Next: [Start with your application inventory](start-with-applications.md).
