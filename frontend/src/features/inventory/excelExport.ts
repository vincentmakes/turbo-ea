import * as XLSX from "xlsx";
import type { Card, CardType } from "@/types";

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;

/**
 * Export the given cards to an XLSX file and trigger a download.
 *
 * When a single type is selected its attribute fields are expanded into
 * individual columns.  Otherwise only the core columns are exported.
 */
export function exportToExcel(
  cards: Card[],
  typeConfig: CardType | undefined,
  _allTypes: CardType[],
) {
  const rows: Record<string, unknown>[] = [];

  // Build the list of attribute field keys (only when a single type is active)
  const attrFields = typeConfig
    ? typeConfig.fields_schema.flatMap((s) => s.fields)
    : [];

  for (const card of cards) {
    const row: Record<string, unknown> = {
      id: card.id,
      type: card.type,
      name: card.name,
      description: card.description ?? "",
      subtype: card.subtype ?? "",
      parent_id: card.parent_id ?? "",
      external_id: card.external_id ?? "",
      alias: card.alias ?? "",
      approval_status: card.approval_status ?? "",
    };

    // Flatten lifecycle phases
    const lc = card.lifecycle || {};
    for (const phase of LIFECYCLE_PHASES) {
      row[`lifecycle_${phase}`] = lc[phase] ?? "";
    }

    // Type-specific attribute columns
    for (const field of attrFields) {
      const val = (card.attributes || {})[field.key];
      if (field.type === "multiple_select" && Array.isArray(val)) {
        row[`attr_${field.key}`] = val.join(", ");
      } else {
        row[`attr_${field.key}`] = val ?? "";
      }
    }

    rows.push(row);
  }

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns (rough heuristic: max of header length and longest value)
  const headers = Object.keys(rows[0] || {});
  ws["!cols"] = headers.map((h) => {
    let maxLen = h.length;
    for (const r of rows) {
      const v = String(r[h] ?? "");
      if (v.length > maxLen) maxLen = v.length;
    }
    return { wch: Math.min(maxLen + 2, 60) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cards");

  // Build filename
  const typeLabel = typeConfig?.label ?? "cards";
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${typeLabel}_export_${date}.xlsx`);
}
