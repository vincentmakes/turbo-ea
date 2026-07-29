import type { CalculationRunReport } from "@/types";

/** Render a manual-run report as plain text, for pasting into a ticket.
 *
 * Pure, and in its own module so it can be unit-tested without mounting the
 * admin page (same shape as `recurrenceLabel.ts` on the risk side).
 *
 * Deliberately not translated: this is meant to travel to somewhere the
 * reader's locale is unknown, and the error strings it quotes come back from
 * the backend in English regardless.
 */
export function formatRunReport(report: CalculationRunReport, typeName: string): string {
  const lines: string[] = [
    `Recalculation — ${typeName}`,
    `${report.cards_processed} cards processed, ` +
      `${report.calculations_succeeded} succeeded, ${report.calculations_failed} failed`,
  ];
  for (const calc of report.calculations) {
    lines.push(
      "",
      `${calc.name} (${calc.target_field}) — ${calc.succeeded} ok, ${calc.failed} failed`,
    );
    for (const group of calc.failures) {
      lines.push(`  ${group.count}x ${group.error}`);
      const names = group.cards.map((c) => c.name).join(", ");
      lines.push(`    ${names}${group.cards_truncated ? ", …" : ""}`);
    }
  }
  return lines.join("\n");
}
