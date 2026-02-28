# Surveys

The **Surveys** module (**Admin > Surveys**) enables administrators to create **data-maintenance surveys** that collect structured information from stakeholders about specific cards.

## Use Case

Surveys help keep your architecture data current by reaching out to the people closest to each component. For example:

- Ask application owners to confirm business criticality and lifecycle dates annually
- Collect technical suitability assessments from IT teams
- Gather cost updates from budget owners

## Survey Lifecycle

Each survey progresses through three states:

| Status | Meaning |
|--------|---------|
| **Draft** | Being designed, not yet visible to respondents |
| **Active** | Open for responses, assigned stakeholders see it in their Todos |
| **Closed** | No longer accepting responses |

## Creating a Survey

1. Navigate to **Admin > Surveys**
2. Click **+ New Survey**
3. The **Survey Builder** opens with the following configuration:

### Target Type

Select which card type the survey applies to (e.g., Application, IT Component). The survey will be sent for each card of this type that matches your filters.

### Filters

Optionally narrow the scope by filtering cards (e.g., only Active applications, only cards owned by a specific organization).

### Questions

Design your questions. Each question can be:

- **Free text** — Open-ended response
- **Single select** — Choose one option from a list
- **Multiple select** — Choose multiple options
- **Number** — Numeric input
- **Date** — Date picker
- **Boolean** — Yes/No toggle

### Auto-Actions

Configure rules that automatically update card attributes based on survey responses. For example, if a respondent selects "Mission Critical" for business criticality, the card's `businessCriticality` field can be updated automatically.

## Sending a Survey

Once your survey is in **Active** status:

1. Click **Send** to distribute the survey
2. Each targeted card generates a todo for the assigned stakeholders
3. Stakeholders see the survey in their **My Surveys** tab on the [Tasks page](../guide/tasks.md)

## Viewing Results

Navigate to **Admin > Surveys > [Survey Name] > Results** to see:

- Response status per card (responded, pending)
- Individual responses with per-question answers
- An **Apply** action to commit auto-action rules to card attributes
