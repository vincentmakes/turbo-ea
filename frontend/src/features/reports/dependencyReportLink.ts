/**
 * Deep link into the Dependencies report, centred on a card.
 *
 * The bridge out of the card-detail Dependencies section: that section renders
 * the same Layered Dependency View but has none of the report around it — no
 * time travel, no transition marks, no table view, no saving the view. Rather
 * than duplicate any of that, the section hands you to the report already
 * centred where you are.
 *
 * Sibling of `portfolioInventoryLink.ts` — a pure builder, so the URL shape is
 * pinned by a test rather than by whichever component happens to construct it.
 *
 * Deliberately carries the centre and the chart mode and nothing else. The
 * section's expansion set, revealed parents/children and navigation history
 * have no faithful equivalent in the report (its expansion model is its own),
 * and a link that promised to restore them would restore them wrongly.
 */

export type DependencyChartMode = "c4" | "tree";

export function buildDependencyReportUrl(opts: {
  /** The card the report should centre on. */
  centerId: string;
  /** Which chart the report should open on. Defaults to the Layered
   *  Dependency View, since that is what the card section shows. */
  mode?: DependencyChartMode;
}): string {
  const params = new URLSearchParams();
  params.set("center", opts.centerId);
  params.set("mode", opts.mode ?? "c4");
  return `/reports/dependencies?${params.toString()}`;
}
