/**
 * The two Initiative cost fields the PPM module feeds: **Budget** from the
 * PPM budget lines and **Actual Cost** from the PPM cost lines' actuals. The
 * backend's twin is `PPM_COST_FIELDS` in `app/services/ppm_fiscal_costs.py`
 * (the cost sync writes these fields, calculations leave them alone, and the
 * Cost report counts their current fiscal year's lines).
 */
export const PPM_INITIATIVE_TYPE = "Initiative";
export const PPM_BUDGET_FIELD = "costBudget";
export const PPM_ACTUAL_FIELD = "costActual";
export const PPM_COST_FIELDS: readonly string[] = [PPM_BUDGET_FIELD, PPM_ACTUAL_FIELD];

/** Whether `fieldKey` on a card of `typeKey` is fed by PPM lines. */
export function isPpmCostField(typeKey: string | null | undefined, fieldKey: string): boolean {
  return typeKey === PPM_INITIATIVE_TYPE && PPM_COST_FIELDS.includes(fieldKey);
}
