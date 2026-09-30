/**
 * Print / PDF dossier of a single Risk Register entry.
 *
 * Mirrors the sections of `RiskDetailPage` (identification, initial and
 * residual assessment, mitigation tasks with their recent cycles, affected
 * cards, workflow, audit) as an HTML body for the shared pop-up print path
 * in `@/lib/printDocument`. Pure and free of React so it is unit-testable and
 * cheap to import into the page chunk.
 */
import i18n from "@/i18n";
import {
  formatDateTimeWith,
  formatDateWith,
  getCachedDateFormat,
} from "@/hooks/useDateFormat";
import { formatRecurrence } from "@/lib/recurrence/recurrenceLabel";
import {
  chipRow,
  escapeHtml,
  metaTable,
  printDocument,
  section,
  tableHtml,
  textBlock,
  writePrintDocument,
  type PrintDocumentOptions,
} from "@/lib/printDocument";
import type { MitigationTask, Risk } from "@/types";

const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`grc:${key}`, opts as never));
const tCommon = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`common:${key}`, opts as never));
const tDelivery = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:${key}`, opts as never));

/** How many cycles per task the dossier lists, newest first. */
export const PRINTED_CYCLES_PER_TASK = 10;

/** The inner HTML body for one risk and its mitigation tasks. Pure; exported for tests. */
export function buildRiskPrintBody(risk: Risk, tasks: MitigationTask[]): string {
  const fmt = getCachedDateFormat();
  const date = (iso: string | null | undefined) => (iso ? formatDateWith(fmt, iso) : "");
  const dateTime = (iso: string | null | undefined) => (iso ? formatDateTimeWith(fmt, iso) : "");

  let html = `<div class="doc-caption">${escapeHtml(t("risks.title"))}</div>`;
  html += `<h1>${escapeHtml(risk.reference)} — ${escapeHtml(risk.title)}</h1>`;
  html += chipRow([
    t(`risks.level.${risk.residual_level ?? risk.initial_level}`),
    t(`risks.status.${risk.status}`),
    risk.source_type !== "manual" ? t(`risks.source.${risk.source_type}`) : null,
  ]);

  // Identification
  const source =
    t(`risks.source.${risk.source_type}`) + (risk.source_ref ? ` (${risk.source_ref})` : "");
  html += section(
    t("risks.section.identification"),
    metaTable([
      [t("risks.field.description"), risk.description],
      [t("risks.field.category"), t(`risks.category.${risk.category}`)],
      [t("risks.field.source"), source],
      [t("risks.field.owner"), risk.owner_name],
      [t("risks.field.targetDate"), date(risk.target_resolution_date)],
    ]),
  );

  // Initial assessment
  html += section(
    t("risks.section.assessment"),
    metaTable([
      [t("risks.field.probability"), t(`risks.probability.${risk.initial_probability}`)],
      [t("risks.field.impact"), t(`risks.impact.${risk.initial_impact}`)],
      [t("risks.field.level"), t(`risks.level.${risk.initial_level}`)],
    ]),
  );

  // Residual assessment
  html += section(
    t("risks.section.residual"),
    risk.residual_level
      ? metaTable([
          [
            t("risks.field.probability"),
            risk.residual_probability ? t(`risks.probability.${risk.residual_probability}`) : "",
          ],
          [t("risks.field.impact"), risk.residual_impact ? t(`risks.impact.${risk.residual_impact}`) : ""],
          [t("risks.field.level"), t(`risks.level.${risk.residual_level}`)],
        ])
      : textBlock(t("risks.residual.noneYet")),
  );

  // Mitigation tasks, each with its most recent cycles
  const taskHtml = tasks
    .map((task) => {
      let block = `<h3>${escapeHtml(task.reference)} — ${escapeHtml(task.title)}</h3>`;
      block += metaTable([
        [t("risks.tasks.field.owner"), task.owner_name],
        [t("risks.tasks.field.recurring"), formatRecurrence(task.recurrence_unit, task.recurrence_interval, t)],
        [t("risks.tasks.field.leadTime"), task.lead_time_days ? String(task.lead_time_days) : ""],
        [tCommon("labels.status"), task.is_active ? "" : t("risks.tasks.badge.inactive")],
      ]);
      block += textBlock(task.description);
      const cycles = [...(task.occurrences ?? [])]
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, PRINTED_CYCLES_PER_TASK);
      block += tableHtml(
        [
          "#",
          t("risks.tasks.field.dueDate"),
          t("risks.tasks.field.owner"),
          tCommon("labels.status"),
          t("risks.tasks.history.completedLabel"),
        ],
        cycles.map((o) => [
          String(o.sequence),
          date(o.due_date),
          o.assigned_owner_name ?? t("risks.tasks.history.unassigned"),
          t(`risks.tasks.status.${o.status}`),
          o.completed_at
            ? `${dateTime(o.completed_at)}${
                o.completed_by_name ? ` ${t("risks.tasks.history.byShort", { name: o.completed_by_name })}` : ""
              }${o.completion_notes ? ` — ${o.completion_notes}` : ""}`
            : "",
        ]),
      );
      return block;
    })
    .join("");
  html += section(t("risks.tasks.section.title"), taskHtml);

  // Affected cards
  html += section(
    t("risks.section.cards"),
    tableHtml(
      [tCommon("labels.name"), tCommon("labels.type")],
      risk.cards.map((c) => [c.card_name, c.card_type]),
    ),
  );

  // Workflow / acceptance
  html += section(
    t("risks.section.workflow"),
    metaTable([
      [t("risks.col.status"), t(`risks.status.${risk.status}`)],
      [t("risks.field.acceptedAt"), dateTime(risk.accepted_at)],
      [t("risks.field.acceptanceRationale"), risk.acceptance_rationale],
    ]),
  );

  // Audit
  html += section(
    t("risks.section.audit"),
    metaTable([
      [tCommon("labels.createdAt"), dateTime(risk.created_at)],
      [t("risks.field.updatedAt"), dateTime(risk.updated_at)],
    ]),
  );

  return html;
}

/** Title, body and footer for the pop-up. Pure; exported for tests. */
export function riskPrintDocument(risk: Risk, tasks: MitigationTask[]): PrintDocumentOptions {
  return {
    title: `${risk.reference} — ${risk.title}`,
    bodyHtml: buildRiskPrintBody(risk, tasks),
    footerParts: [
      tDelivery("export.printed", { date: formatDateTimeWith(getCachedDateFormat(), new Date()) }),
    ],
  };
}

/**
 * Open the print dialog for one risk. Pass `win` when the window was opened
 * before an `await` (see `openPrintWindow`); otherwise it opens its own.
 */
export function printRisk(risk: Risk, tasks: MitigationTask[], win?: Window | null): void {
  const opts = riskPrintDocument(risk, tasks);
  if (win) writePrintDocument(win, opts);
  else printDocument(opts);
}
