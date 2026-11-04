/**
 * Risk Register spreadsheet import helpers.
 *
 * Mirrors the export side in ``mitigation/taskHistoryExport.ts`` but for the
 * inbound direction:
 *
 * * ``parseRiskWorkbook(buffer)`` — read an ``.xlsx`` into ``RiskImportItem``
 *   rows. Headers are matched case-insensitively; the ``cards`` column is
 *   split on ``;``; dates are coerced to ``YYYY-MM-DD``. Validation and
 *   owner/card resolution happen server-side via ``POST /risks/bulk-import``.
 * * ``downloadRiskTemplate()`` — write a one-sheet starter workbook with the
 *   canonical headers + one example row so users know exactly what to fill in.
 *
 * The "Risks" sheet exported by the register is intentionally NOT a valid
 * import file: it carries derived ``initial_level`` / ``residual_level`` but
 * not the writable ``initial_probability`` / ``initial_impact`` inputs. The
 * template below carries the writable columns instead.
 */
import * as XLSX from "xlsx";
import { autoFitColumns, cellText, headerKey } from "@/lib/sheetRows";
import type { RiskImportItem } from "@/types";

// Canonical import columns, in template order. Header matching on parse is
// case-insensitive and tolerant of extra/unknown columns.
export const RISK_IMPORT_COLUMNS = [
  "title",
  "description",
  "category",
  "initial_probability",
  "initial_impact",
  "residual_probability",
  "residual_impact",
  "status",
  "owner_email",
  "target_resolution_date",
  "cards",
] as const;

/**
 * Parse the first sheet (or a sheet literally named "Risks") into import rows.
 * Fully blank rows are skipped. ``row_index`` is the zero-based position
 * among the non-blank data rows, used to pair backend results back to a row.
 */
export function parseRiskWorkbook(buffer: ArrayBuffer): RiskImportItem[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === "risks") ?? wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  const items: RiskImportItem[] = [];
  for (const rawRow of raw) {
    // Re-key every cell by normalised header so "Initial Probability",
    // "initial_probability", and "INITIAL_PROBABILITY" all land the same.
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawRow)) {
      row[headerKey(k)] = cellText(v);
    }

    const title = row.title ?? "";
    // Skip rows that have no meaningful content at all.
    const hasContent = Object.values(row).some((v) => v !== "");
    if (!hasContent) continue;

    const cards = (row.cards ?? "")
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean);

    items.push({
      row_index: items.length,
      title,
      description: row.description || "",
      category: row.category || undefined,
      initial_probability: row.initial_probability || undefined,
      initial_impact: row.initial_impact || undefined,
      residual_probability: row.residual_probability || undefined,
      residual_impact: row.residual_impact || undefined,
      status: row.status || undefined,
      // Accept either "owner_email" or a bare "owner" column.
      owner_email: row.owner_email || undefined,
      owner_name: row.owner || undefined,
      target_resolution_date: row.target_resolution_date || undefined,
      card_names: cards,
      // Carried so the importer can skip rows that match an existing risk.
      // Populated when re-importing an exported register (the export's
      // "Risks" sheet has a `reference` column); blank for new rows.
      reference: row.reference || undefined,
    });
  }
  return items;
}

/** Build + download a starter workbook with one illustrative example row. */
export function downloadRiskTemplate(): void {
  const headers = [...RISK_IMPORT_COLUMNS];
  const example = [
    "Single sign-on outage risk",
    "Loss of access if the IdP is unavailable",
    "operational",
    "medium",
    "high",
    "low",
    "high",
    "identified",
    "owner@example.com",
    "2026-12-31",
    "NexaCore ERP; Identity Platform",
  ];
  const aoa = [headers, example];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoFitColumns(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Risks");
  XLSX.writeFile(wb, "risk-import-template.xlsx");
}
