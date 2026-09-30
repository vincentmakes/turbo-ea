/**
 * Print / PDF summary of a single compliance finding.
 *
 * Mirrors what `FindingDetailDrawer` shows (regulation, article, scope,
 * severity, status, lifecycle decision, requirement, gap, evidence,
 * remediation, review trail) as an HTML body for the shared pop-up print
 * path in `@/lib/printDocument`. The regulation label is resolved by the
 * caller, because it comes from the `useComplianceRegulations` cache.
 */
import i18n from "@/i18n";
import {
  formatDateTimeWith,
  getCachedDateFormat,
} from "@/hooks/useDateFormat";
import {
  chipRow,
  escapeHtml,
  metaTable,
  printDocument,
  section,
  textBlock,
  writePrintDocument,
  type PrintDocumentOptions,
} from "@/lib/printDocument";
import type { TurboLensComplianceFinding } from "@/types";

const tAdmin = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`admin:${key}`, opts as never));
const tCards = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`cards:${key}`, opts as never));
const tDelivery = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:${key}`, opts as never));

/** `data_governance` → `Data Governance`, the drawer's own rendering of a category slug. */
function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "";
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The inner HTML body for one finding. Pure; exported for tests. */
export function buildFindingPrintBody(
  finding: TurboLensComplianceFinding,
  regulationLabel: string,
): string {
  const fmt = getCachedDateFormat();
  const dateTime = (iso: string | null | undefined) => (iso ? formatDateTimeWith(fmt, iso) : "");
  const title = finding.regulation_article || tCards("compliance.drawer.untitled");

  let html = `<div class="doc-caption">${escapeHtml(tCards("compliance.drawer.untitled"))}</div>`;
  html += `<h1>${escapeHtml(title)}</h1>`;
  html += `<p class="doc-subtitle">${escapeHtml(regulationLabel)}${
    finding.card_name ? ` &middot; ${escapeHtml(finding.card_name)}` : ""
  }</p>`;
  html += chipRow([
    tAdmin(`compliance_severity_${finding.severity}`),
    tAdmin(`compliance_status_${finding.status}`),
    finding.decision ? tAdmin(`compliance_decision_${finding.decision}`) : null,
    finding.ai_detected ? tAdmin("compliance_ai_detected") : null,
  ]);

  html += metaTable([
    [tCards("compliance.cardTab.col.regulation"), regulationLabel],
    [tCards("compliance.grid.col.article"), finding.regulation_article],
    [
      tCards("compliance.grid.col.card"),
      finding.card_name
        ? `${finding.card_name}${finding.card_type ? ` (${finding.card_type})` : ""}`
        : tAdmin("compliance_scope_landscape"),
    ],
    [tCards("compliance.drawer.category"), categoryLabel(finding.category)],
    [tCards("compliance.drawer.linkedRisk"), finding.risk_reference ?? ""],
    [tCards("compliance.grid.col.created"), dateTime(finding.created_at)],
    [tCards("compliance.grid.col.modified"), dateTime(finding.updated_at)],
  ]);

  html += section(tCards("compliance.grid.col.requirement"), textBlock(finding.requirement));
  const gap = finding.gap_description && finding.gap_description.trim() !== "—" ? finding.gap_description : "";
  html += section(tCards("compliance.drawer.gap"), textBlock(gap));
  html += section(tCards("compliance.drawer.evidence"), textBlock(finding.evidence));
  html += section(tCards("compliance.drawer.remediation"), textBlock(finding.remediation));

  if (finding.reviewer_name || finding.reviewed_at) {
    const who = tCards("compliance.drawer.reviewedBy", {
      name: finding.reviewer_name ?? "",
      date: dateTime(finding.reviewed_at),
    });
    html += section(
      tCards("compliance.drawer.reviewed"),
      textBlock(finding.review_note ? `${who} — ${finding.review_note}` : who),
    );
  }

  return html;
}

/** Title, body and footer for the pop-up. Pure; exported for tests. */
export function findingPrintDocument(
  finding: TurboLensComplianceFinding,
  regulationLabel: string,
): PrintDocumentOptions {
  const article = finding.regulation_article || tCards("compliance.drawer.untitled");
  return {
    title: `${regulationLabel} — ${article}`,
    bodyHtml: buildFindingPrintBody(finding, regulationLabel),
    footerParts: [
      tDelivery("export.printed", { date: formatDateTimeWith(getCachedDateFormat(), new Date()) }),
    ],
  };
}

/** Open the print dialog for one finding (the drawer holds its data, so no pre-opened window). */
export function printFinding(
  finding: TurboLensComplianceFinding,
  regulationLabel: string,
  win?: Window | null,
): void {
  const opts = findingPrintDocument(finding, regulationLabel);
  if (win) writePrintDocument(win, opts);
  else printDocument(opts);
}
