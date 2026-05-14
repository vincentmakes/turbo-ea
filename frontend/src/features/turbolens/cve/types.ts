import type { TurboLensCveFinding } from "@/types";

export type CveSeverity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type CveStatus = "open" | "acknowledged" | "in_progress" | "mitigated" | "accepted";
export type CvePriority = "critical" | "high" | "medium" | "low";
export type CveProbability = "very_high" | "high" | "medium" | "low" | "unknown";
export type TriState = "any" | "yes" | "no";
export type CveDateField = "created" | "modified";

export interface CveFilters {
  search: string;
  severities: Set<CveSeverity>;
  statuses: Set<CveStatus>;
  priorities: Set<CvePriority>;
  probabilities: Set<CveProbability>;
  cardTypes: Set<string>;
  patchAvailable: TriState;
  promotedToRisk: TriState;
  dateField: CveDateField;
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
}

export const emptyCveFilters = (): CveFilters => ({
  search: "",
  severities: new Set(),
  statuses: new Set(),
  priorities: new Set(),
  probabilities: new Set(),
  cardTypes: new Set(),
  patchAvailable: "any",
  promotedToRisk: "any",
  dateField: "modified",
  dateFrom: null,
  dateTo: null,
});

export const countActive = (f: CveFilters): number => {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.severities.size) n++;
  if (f.statuses.size) n++;
  if (f.priorities.size) n++;
  if (f.probabilities.size) n++;
  if (f.cardTypes.size) n++;
  if (f.patchAvailable !== "any") n++;
  if (f.promotedToRisk !== "any") n++;
  if (f.dateFrom || f.dateTo) n++;
  return n;
};

export const applyCveFilters = (
  rows: TurboLensCveFinding[],
  f: CveFilters,
): TurboLensCveFinding[] => {
  const search = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (search) {
      const hay = `${r.cve_id} ${r.card_name ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (f.severities.size && !f.severities.has(r.severity as CveSeverity)) return false;
    if (f.statuses.size && !f.statuses.has(r.status as CveStatus)) return false;
    if (f.priorities.size && !f.priorities.has(r.priority as CvePriority)) return false;
    if (f.probabilities.size && !f.probabilities.has(r.probability as CveProbability))
      return false;
    if (f.cardTypes.size && (!r.card_type || !f.cardTypes.has(r.card_type))) return false;
    if (f.patchAvailable === "yes" && !r.patch_available) return false;
    if (f.patchAvailable === "no" && r.patch_available) return false;
    if (f.promotedToRisk === "yes" && !r.risk_id) return false;
    if (f.promotedToRisk === "no" && r.risk_id) return false;
    if (f.dateFrom || f.dateTo) {
      const ts = f.dateField === "created" ? r.created_at : r.updated_at;
      if (!ts) return false;
      const day = ts.slice(0, 10);
      if (f.dateFrom && day < f.dateFrom) return false;
      if (f.dateTo && day > f.dateTo) return false;
    }
    return true;
  });
};
