# Customise the Metamodel — Lightly

Turbo EA's metamodel is fully **admin-configurable** — every card type, field, subtype, relation, and stakeholder role is data, not code. You will be tempted to redesign it. **Don't.**

The teams that succeed customise the metamodel **only when the default fields can't answer their question**. The teams that fail spend their first month renaming `Application` to `Solution`, adding 30 custom fields, and never get to a working report.

## The two-question test before adding a field

Before adding a single custom field, ask yourself:

1. **Will I filter, group, or report on this field?** If no, it belongs in the description or a tag — not a field.
2. **Is the same answer needed on every card of this type?** If no, it's a relation or an attachment, not a field.

If you can't answer "yes" to both, don't add the field.

## Worked example: add a TIME disposition

For an Application Portfolio Rationalisation, you need a single decision per application: **T**olerate / **I**nvest / **M**igrate / **E**liminate (the **TIME** framework, popularised by Gartner). The built-in metamodel doesn't ship a `timeDisposition` field, so this is one of the rare cases where adding a custom field is the right call.

We're going to add it as a `single_select` field on the `Application` type, with four colour-coded options, weight 1 so it contributes to data quality.

### Step 1 — Open the type editor

1. Go to **Admin → Metamodel**.
2. Click the **Application** type card.
3. The type drawer opens on the right. Switch to the **Fields** tab.

### Step 2 — Add the field

1. Pick the section you want the field to land in (or create a new section called "Portfolio Decision").
2. Click **+ Add field** in that section.
3. Fill in:
    - **Key**: `timeDisposition`  *(lower camel-case, no spaces, becomes the attribute key in JSON)*
    - **Label**: *Portfolio Disposition (TIME)*
    - **Type**: `single_select`
    - **Weight**: `1`  *(contributes to the Data Quality score)*
    - **Required**: leave **off** — required would block approval of every existing card.
4. Add the four options:

    | Key | Label | Colour |
    |-----|-------|--------|
    | `tolerate` | Tolerate | grey / neutral |
    | `invest` | Invest | green |
    | `migrate` | Migrate | amber |
    | `eliminate` | Eliminate | red |

5. **Add translations** for the label and each option in every locale you support — page 4 of [Admin → Metamodel](../admin/metamodel.md) covers the translation editor. Skipping this means non-English users see "timeDisposition" verbatim.
6. Save.

### Step 3 — Confirm it works

1. Open any Application card. The new field appears in its section, empty.
2. Pick a value, save. The Data Quality ring should tick up by a few percent.
3. Back in **Inventory**, the field is now available in the **Columns** tab and as a filter — you can already filter applications by TIME.

That's it. One field, ten minutes, immediately useful.

## Alternative: use a Tag Group instead

If the value is informational rather than queryable, a **Tag Group** (Admin → Tags) is lighter than a custom field — no metamodel change, no migration, easier to evolve. Use a Tag Group when:

- The value is descriptive ("Customer-facing", "Internal-only", "Acquired in 2024").
- You may add new options frequently.
- You don't need it in a filter dropdown but a search-as-you-type tag chip is fine.

Use a custom field when:

- You need the value on the Portfolio Report axes (X, Y, colour).
- You want it weighted into Data Quality.
- It's a controlled vocabulary that won't change often.

TIME disposition is in the custom-field camp because we'll use it as a Portfolio Report colour axis on the next page.

## Anti-patterns to avoid

These are the most common metamodel mistakes in first rollouts:

!!! warning "Don't rename built-in card types"
    Renaming `Application` to `Solution` looks tidy but breaks the conceptual mapping that Capability Heatmap, Portfolio Report, and the catalogues all assume. If your organisation calls them "Solutions", set the **label** translation — the underlying `key` stays as `Application`.

!!! warning "Don't add 30 custom fields on day one"
    Each custom field adds friction to data collection and dilutes the Data Quality score. Add one field, use it for a month, then add the next.

!!! warning "Don't make new fields `required` on day one"
    `Required` blocks approval for every existing card that doesn't have a value. Make a field required only **after** you've filled it in for 80%+ of the population.

!!! warning "Don't create custom card types instead of custom fields"
    "Mobile App" should be a subtype of `Application`, not a new card type. New types don't get capability mapping, portfolio reports, or catalogue imports for free.

## Other lightweight extensions you may want

These are common second-pass extensions, but **don't add them until you actually need them**:

| Need | Where to add | Type |
|------|-------------|------|
| Business value rating | Application | `single_select` (High/Medium/Low) — drives the Portfolio Report Y-axis |
| Technical fitness rating | Application | `single_select` — drives the X-axis |
| Cloud readiness | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Risk-of-loss category | Application, IT Component | `single_select` (Single point of failure, etc.) |
| Cost split | Application | `cost` fields for `costRunTotalAnnual`, `costChangeTotalAnnual` |

Each one passes the two-question test for portfolio analytics. Each one is also a fine candidate for a calculated formula instead of manual entry — which is what the next page covers.

Next: [Your first analysis: Application Harmonisation](your-first-analysis.md).
