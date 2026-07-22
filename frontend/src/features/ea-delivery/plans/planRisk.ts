/**
 * Risk fan-out for Transition Planning. There is no bulk "risk counts for
 * these cards" endpoint, so we fan out `GET /cards/{id}/risks` across the
 * (small) set of real cards the plan touches and dedupe client-side. Kept in
 * its own module so the pure `summarizeRisks` in planInsights stays testable.
 */
import { api } from "@/api/client";
import type { Risk } from "@/types";
import { summarizeRisks, type RiskSummary } from "./planInsights";

/** Fetch and summarise risks across the affected card ids. Failures on
 *  individual cards are tolerated (treated as no risks). */
export async function fetchAffectedRiskSummary(cardIds: string[]): Promise<RiskSummary> {
  if (cardIds.length === 0) return { total: 0, high: 0 };
  const lists = await Promise.all(
    cardIds.map((id) =>
      api.get<Risk[]>(`/cards/${id}/risks`).catch(() => [] as Risk[]),
    ),
  );
  return summarizeRisks(lists);
}
