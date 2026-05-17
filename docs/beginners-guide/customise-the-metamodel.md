# Customise the Metamodel — Lightly

Turbo EA's metamodel is fully **admin-configurable** — every card type, field, subtype, relation, and stakeholder role is data, not code. You will be tempted to redesign it. **Don't.**

The teams that succeed customise the metamodel **only when the default fields can't answer their question**. The teams that fail spend their first month renaming `Application` to `Solution`, adding 30 custom fields, and never get to a working report.

## What's already in the metamodel

Before adding anything, know what you already have. The built-in **Application** card type ships with these fields out of the box (among others):

| Built-in field | Type | What it's for |
|----------------|------|--------------|
| `businessCriticality` | `single_select` | Mission-critical / Important / Useful / Marginal |
| `functionalSuitability` | `single_select` | Perfect / Appropriate / Insufficient / Unreasonable |
| `technicalSuitability` | `single_select` | Fully Appropriate / Adequate / Unreasonable / Inappropriate |
| `timeModel` | `single_select` (required) | **Tolerate / Invest / Migrate / Eliminate** — the canonical Gartner TIME disposition |
| `riskLevel` | `single_select` | Low / Medium / High / Critical |
| `businessValue` | `single_select` | Drives the Portfolio Report Y axis |
| `costTotalAnnual` | `cost` | Total annual cost |
| `lifecycle.*` | dates | Plan / Phase In / Active / Phase Out / End of Life |

Everything an Application Portfolio Rationalisation needs is already there, including **TIME Model**. You don't need to add a TIME field — you fill it in (manually or via a calculation, see [Your First Analysis](your-first-analysis.md)). The same is true for `functionalSuitability` and `technicalSuitability`, the two suitability dimensions that classically drive a TIME placement.

## The two-question test before adding a field

When you do find yourself needing a field that's genuinely not in the metamodel, ask yourself:

1. **Will I filter, group, or report on this field?** If no, it belongs in the description or a tag — not a field.
2. **Is the same answer needed on every card of this type?** If no, it's a relation or an attachment, not a field.

If you can't answer "yes" to both, don't add the field.

## If you really do need a custom field

For the rare case where a genuinely new field is needed (e.g., a `cloudReadiness` flag, a regulatory classification, a customer-segment marker), the workflow is:

1. Go to **Admin → Metamodel**, click the type, switch to the **Fields** tab.
2. Pick the section (or create a new one) and click **+ Add field**.
3. Fill in:
    - **Key** in lower camel-case (e.g., `cloudReadiness`) — becomes the attribute key in JSON and in formulas.
    - **Label** (and a translation for every locale you support — non-English users will see the raw key otherwise).
    - **Type** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Weight** — `0` to exclude from Data Quality, `1`+ to include and weight it.
    - **Required** — leave **off** for the first rollout; required blocks approval of every existing card.
4. For select types, add the options (key + label + colour) and translate each option.
5. Save.

The field is immediately available in **Inventory** (Columns, filters), on the Card Detail, and in **Calculations** formulas as `<fieldKey>`. Full reference: [Admin → Metamodel](../admin/metamodel.md).

## Option: derive a field automatically with a Calculation { #option-derive-a-field-automatically-with-a-calculation }

Beside the standard option of having users fill a field manually, Turbo EA can **compute a field value automatically** from other fields on the same card — including the built-in ones — using the **Calculations** feature. The computed field becomes read-only and carries a "calculated" badge so users can't drift from the rule.

The canonical example is the **TIME Model** calculation that derives the built-in `timeModel` field on Application from a business-fit and a technical-fit dimension. It ships as one of the entries in the **Formula Reference** panel inside **Admin → Metamodel → Calculations** when you create a new calculation, so you can pick it from the panel directly. Target type = `Application`, target field = `timeModel`; the panel-provided formula is reproduced in [Admin → Calculations → Example Formulas](../admin/calculations.md#example-formulas).

The formula assumes two `single_select` fields named `businessFit` and `technicalFit` with options `excellent` / `adequate` / `insufficient` / `unreasonable`. They are not in the built-in metamodel — add them on Application per the custom-field steps above if you want to use this calculation.

!!! warning "Don't"
    A calculated TIME is a **starting hypothesis**, not a verdict. Either review every result with the Application Owner before trusting it, or turn the calculation off and rely on manual entry once the validation workshop is done.

The hybrid pattern that works well in practice: keep the calculation on while you're building the inventory and you mostly have suitability data; turn it off for the validation workshop; then leave it off so manual decisions stick.

## Alternative: use a Tag Group instead

If the value is informational rather than queryable, a **Tag Group** (Admin → Tags) is lighter than a custom field — no metamodel change, no migration, easier to evolve. Use a Tag Group when:

- The value is descriptive ("Customer-facing", "Internal-only", "Acquired in 2024").
- You may add new options frequently.
- You don't need it in a filter dropdown but a search-as-you-type tag chip is fine.

Use a custom field when:

- You need the value on the Portfolio Report axes (X, Y, colour).
- You want it weighted into Data Quality.
- It's a controlled vocabulary that won't change often.

## Anti-patterns to avoid

These are the most common metamodel mistakes in first rollouts:

!!! warning "Don't rename built-in card types"
    Renaming `Application` to `Solution` looks tidy but breaks the conceptual mapping that Capability Heatmap, Portfolio Report, and the catalogues all assume. If your organisation calls them "Solutions", set the **label** translation — the underlying `key` stays as `Application`.

!!! warning "Don't add 30 custom fields on day one"
    Each custom field adds friction to data collection and dilutes the Data Quality score. Add one field, use it for a month, then add the next.

!!! warning "Don't duplicate built-in fields"
    Before adding `timeDisposition`, `funcFit`, `techFit`, or `appBusinessValue`, check the existing field list — chances are an equivalent built-in field already exists (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). Duplicates split your data and break reports.

!!! warning "Don't make new fields `required` on day one"
    `Required` blocks approval for every existing card that doesn't have a value. Make a field required only **after** you've filled it in for 80%+ of the population.

!!! warning "Don't create custom card types instead of custom fields"
    "Mobile App" should be a subtype of `Application`, not a new card type. New types don't get capability mapping, portfolio reports, or catalogue imports for free.

## Other lightweight extensions you may want

These are common second-pass extensions, but **don't add them until you actually need them**:

| Need | Where to add | Type |
|------|-------------|------|
| Cloud readiness | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Customer-facing flag | Application | `boolean` |
| Regulatory classification | Application, DataObject | `multiple_select` (GDPR, PCI-DSS, …) |
| Risk-of-loss category | Application, IT Component | `single_select` (Single point of failure, etc.) |
| Cost split | Application | additional `cost` fields for `costRunTotalAnnual`, `costChangeTotalAnnual` |

Each one passes the two-question test for portfolio analytics. Several of them are also fine candidates for a **calculated** formula instead of manual entry — which is what the next page covers, using `timeModel` itself as the worked example.

Next: [Your first analysis: Application Harmonisation](your-first-analysis.md).
