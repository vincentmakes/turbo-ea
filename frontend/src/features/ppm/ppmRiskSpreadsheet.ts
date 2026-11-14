/**
 * An initiative's PPM risks ⇄ `.xlsx`.
 *
 * The export is a valid import file: the same columns, in the same order, so a
 * project manager can export, edit in Excel and re-import. Like the Risk
 * Register's `reference`, the first column carries the risk's identity (its
 * id): a row whose id belongs to one of this initiative's risks updates that
 * risk, a row without one creates a new risk, and a risk missing from the file
 * is left alone — the import never deletes. An id the initiative does not have
 * rejects the row rather than silently creating a copy.
 *
 * Headers are written in the reader's language; on import a column is
 * recognised by its translated header, its English header or its raw key
 * (`title`, `probability`, …), case-insensitively. Unknown columns are
 * ignored, and so is `risk_score`, which the server computes. A column the
 * sheet lacks is left as it is on an update; a blank cell in a present
 * description, mitigation or owner column clears it. A blank probability,
 * impact or status takes the API's default on create (3, 3, open) and leaves
 * the value alone on update. An owner is matched against `GET /users` by
 * email, then by display name; one that matches nobody (or several people) is
 * reported as a warning and the owner is left unchanged — the row still
 * imports, as in the Risk Register.
 */
import i18n from "@/i18n";
import { buildSheetWorkbook, downloadSheet, exportTimestamp, readSheetRows } from "@/lib/sheetRows";
import type { PpmRisk } from "@/types";
import * as XLSX from "xlsx";
import { RISK_STATUSES, riskStatusLabelKey } from "./ppmRiskModel";

export type Translate = (key: string, opts?: Record<string, unknown>) => string;

export const PPM_RISK_SHEET = "Risks";

export const PPM_RISK_COLUMNS = [
  "id",
  "title",
  "description",
  "probability",
  "impact",
  "risk_score",
  "status",
  "owner",
  "mitigation",
] as const;

export type PpmRiskColumn = (typeof PPM_RISK_COLUMNS)[number];

/** The translation key of each column's header. */
const HEADER_KEYS: Record<PpmRiskColumn, string> = {
  id: "ppm:riskExportColumnId",
  title: "ppm:riskTitle",
  description: "common:labels.description",
  probability: "ppm:probability",
  impact: "ppm:impact",
  risk_score: "ppm:riskScore",
  status: "ppm:riskStatus",
  owner: "ppm:riskOwner",
  mitigation: "ppm:mitigation",
};

/** Extra raw headers accepted on import, beyond each column's own key. */
const HEADER_ALIASES: Partial<Record<PpmRiskColumn, string[]>> = {
  owner: ["owner_email", "owner_name"],
};

const defaultT: Translate = (key, opts) => i18n.t(key, opts) as string;
const englishT = (): Translate => {
  const en = i18n.getFixedT("en");
  return (key, opts) => en(key, opts) as string;
};

/** The header row, in `PPM_RISK_COLUMNS` order. */
export function ppmRiskHeaders(t: Translate = defaultT): string[] {
  return PPM_RISK_COLUMNS.map((c) => t(HEADER_KEYS[c]));
}

function statusLabel(status: string, t: Translate): string {
  return t(`ppm:${riskStatusLabelKey(status)}`);
}

/** One risk as a sheet row, in `PPM_RISK_COLUMNS` order. */
export function ppmRiskRow(risk: PpmRisk, t: Translate = defaultT): (string | number)[] {
  return [
    risk.id,
    risk.title,
    risk.description ?? "",
    risk.probability,
    risk.impact,
    risk.risk_score,
    statusLabel(risk.status, t),
    risk.owner_name ?? "",
    risk.mitigation ?? "",
  ];
}

/** The file name: the initiative's name made safe for a file system, then a timestamp. */
export function ppmRiskExportFileName(initiativeName: string, now: Date = new Date()): string {
  const safe = initiativeName
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return `${safe || "initiative"}_risks_${exportTimestamp(now)}.xlsx`;
}

/** The export workbook: one sheet, one row per risk in the order given. */
export function buildPpmRiskWorkbook(
  risks: readonly PpmRisk[],
  t: Translate = defaultT,
): XLSX.WorkBook {
  return buildSheetWorkbook(
    PPM_RISK_SHEET,
    ppmRiskHeaders(t),
    risks.map((r) => ppmRiskRow(r, t)),
  );
}

/** Build and download the initiative's risks as an `.xlsx`. */
export function exportPpmRisks(risks: readonly PpmRisk[], initiativeName: string): void {
  XLSX.writeFile(buildPpmRiskWorkbook(risks), ppmRiskExportFileName(initiativeName));
}

/** A starter workbook: the headers and one illustrative row (no id, so it creates). */
export function downloadPpmRiskTemplate(t: Translate = defaultT): void {
  downloadSheet("initiative-risks-import-template.xlsx", PPM_RISK_SHEET, ppmRiskHeaders(t), [
    [
      "",
      "Key supplier misses the go-live date",
      "The integration partner is behind on the interface build.",
      4,
      3,
      12,
      statusLabel("open", t),
      "owner@example.com",
      "Weekly checkpoint with the supplier; fallback plan by month end",
    ],
  ]);
}

// ── Import ────────────────────────────────────────────────────────────────

/** Whether the bytes are an `.xlsx` (zip) or legacy `.xls` (OLE2) container. */
export function isSpreadsheetBytes(buffer: ArrayBuffer): boolean {
  // Stryker disable next-line MethodExpression: equivalent, only b[0]..b[3] are read, so the whole buffer and its first four bytes give the same answer
  const b = new Uint8Array(buffer.slice(0, 4));
  const zip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  return zip || ole;
}

/** The cells of one non-blank data row, keyed by column; a column the sheet lacks is absent. */
export interface PpmRiskSheetRow {
  /** 0-based sheet position (the header is row 0), so Excel's row number is this + 1. */
  sheetRow: number;
  cells: Partial<Record<PpmRiskColumn, string>>;
}

function normalise(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Every normalised header that names a column, mapped to that column. */
function headerIndex(t: Translate): Map<string, PpmRiskColumn> {
  const index = new Map<string, PpmRiskColumn>();
  const en = englishT();
  for (const col of PPM_RISK_COLUMNS) {
    const names = [col, t(HEADER_KEYS[col]), en(HEADER_KEYS[col]), ...(HEADER_ALIASES[col] ?? [])];
    for (const name of names) {
      const key = normalise(name);
      if (!index.has(key)) index.set(key, col);
    }
  }
  return index;
}

/**
 * Read the "Risks" sheet (else the first) into rows. Fully blank rows are
 * dropped; unknown columns are ignored. When two headers name the same column
 * the first non-blank cell wins. Throws when the bytes are not a spreadsheet.
 */
export function parsePpmRiskWorkbook(
  buffer: ArrayBuffer,
  t: Translate = defaultT,
): PpmRiskSheetRow[] {
  if (!isSpreadsheetBytes(buffer)) throw new Error("not a spreadsheet");
  const index = headerIndex(t);
  return readSheetRows(buffer, PPM_RISK_SHEET).map(({ sheetRow, cells: raw }) => {
    const cells: Partial<Record<PpmRiskColumn, string>> = {};
    for (const [header, value] of Object.entries(raw)) {
      const col = index.get(header);
      if (!col) continue;
      // Stryker disable next-line ConditionalExpression: equivalent for `value !== ""` -> true, which only adds overwriting a blank cell with a blank one; the other conditions here are pinned by the parse tests
      if (!(col in cells) || (cells[col] === "" && value !== "")) cells[col] = value;
    }
    return { sheetRow, cells };
  });
}

/** What `GET /users` gives every caller. */
export interface ImportUser {
  id: string;
  display_name: string;
  email?: string | null;
}

/** The body of `POST /ppm/initiatives/{id}/risks` or `PATCH /ppm/risks/{id}`. */
export interface PpmRiskWrite {
  title?: string;
  description?: string | null;
  probability?: number;
  impact?: number;
  mitigation?: string | null;
  owner_id?: string | null;
  status?: PpmRisk["status"];
}

interface PlanBase {
  sheetRow: number;
  title: string;
  warnings: string[];
}

export type PpmRiskImportRow =
  | (PlanBase & { kind: "create"; body: PpmRiskWrite })
  | (PlanBase & { kind: "update"; riskId: string; body: PpmRiskWrite; changed: string[] })
  | (PlanBase & { kind: "unchanged"; riskId: string })
  | (PlanBase & { kind: "rejected"; errors: string[] });

export interface PpmRiskImportPlan {
  rows: PpmRiskImportRow[];
  create: number;
  update: number;
  unchanged: number;
  rejected: number;
  warnings: number;
}

/** A whole number from 1 to 5, `null` for a blank cell, `NaN` for anything else. */
function score(value: string | undefined): number | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
  return /^[1-5]$/.test(v) ? Number(v) : Number.NaN;
}

/** A status from its raw key or its label (translated or English), case-insensitive. */
function parseStatus(value: string, t: Translate): PpmRisk["status"] | undefined {
  // Stryker disable next-line MethodExpression: equivalent for trim(), the only caller passes an already trimmed cell; lower-casing is pinned by the status tests
  const v = value.trim().toLowerCase();
  const en = englishT();
  return RISK_STATUSES.find(
    (s) =>
      s === v ||
      statusLabel(s, t).toLowerCase() === v ||
      statusLabel(s, en).toLowerCase() === v,
  );
}

type OwnerMatch = { id: string } | { problem: "unknown" | "ambiguous" };

function matchOwner(value: string, users: readonly ImportUser[]): OwnerMatch {
  // Stryker disable next-line MethodExpression: equivalent for trim(), the only caller passes an already trimmed cell; lower-casing is pinned by the owner tests
  const v = value.trim().toLowerCase();
  const byEmail = users.filter((u) => (u.email ?? "").trim().toLowerCase() === v);
  if (byEmail.length === 1) return { id: byEmail[0].id };
  const byName = users.filter((u) => u.display_name.trim().toLowerCase() === v);
  if (byName.length === 1) return { id: byName[0].id };
  // Stryker disable next-line EqualityOperator,StringLiteral: equivalent, a total of exactly 1 returned above (> 1 and >= 1 agree here), and "unknown" is only ever compared with "ambiguous"
  return { problem: byEmail.length + byName.length > 1 ? "ambiguous" : "unknown" };
}

/**
 * Classify every parsed row against the initiative's risks: create, update,
 * unchanged or rejected (with the reasons). An update body carries only the
 * fields that differ from the stored risk.
 */
export function planPpmRiskImport(
  rows: readonly PpmRiskSheetRow[],
  existing: readonly PpmRisk[],
  users: readonly ImportUser[],
  t: Translate = defaultT,
): PpmRiskImportPlan {
  const byId = new Map(existing.map((r) => [r.id, r] as const));
  const seenIds = new Map<string, number>();
  const label = (col: PpmRiskColumn) => t(HEADER_KEYS[col]);
  const planned: PpmRiskImportRow[] = rows.map(({ sheetRow, cells }) => {
    const title = cells.title ?? "";
    const errors: string[] = [];
    const warnings: string[] = [];

    const id = (cells.id ?? "").trim();
    const current = id ? byId.get(id) : undefined;
    if (id) {
      const earlier = seenIds.get(id);
      if (earlier !== undefined) {
        errors.push(t("ppm:riskImportErrorDuplicateId", { value: id, row: earlier + 1 }));
      } else {
        seenIds.set(id, sheetRow);
        if (!current) errors.push(t("ppm:riskImportErrorUnknownId", { value: id }));
      }
    }

    if (title.trim() === "") errors.push(t("ppm:riskImportErrorTitle"));

    const probability = score(cells.probability);
    if (Number.isNaN(probability)) {
      errors.push(t("ppm:riskImportErrorScore", { field: label("probability"), value: cells.probability }));
    }
    const impact = score(cells.impact);
    if (Number.isNaN(impact)) {
      errors.push(t("ppm:riskImportErrorScore", { field: label("impact"), value: cells.impact }));
    }

    const statusCell = (cells.status ?? "").trim();
    const status = statusCell ? parseStatus(statusCell, t) : undefined;
    if (statusCell && !status) {
      errors.push(
        t("ppm:riskImportErrorStatus", {
          value: statusCell,
          allowed: RISK_STATUSES.map((s) => statusLabel(s, t)).join(", "),
        }),
      );
    }

    if (errors.length > 0) return { kind: "rejected", sheetRow, title, warnings, errors };

    // Owner: undefined = leave as it is, null = clear, string = set.
    let ownerId: string | null | undefined;
    if ("owner" in cells) {
      const ownerCell = (cells.owner ?? "").trim();
      if (ownerCell === "") {
        ownerId = null;
        // Stryker disable next-line BlockStatement: equivalent, keeping the current owner_id and leaving the owner undefined both end in "owner unchanged" below
      } else if (current && ownerCell.toLowerCase() === (current.owner_name ?? "").toLowerCase()) {
        ownerId = current.owner_id;
      } else {
        const match = matchOwner(ownerCell, users);
        if ("id" in match) {
          ownerId = match.id;
        } else {
          const key =
            match.problem === "ambiguous"
              ? "ppm:riskImportWarnOwnerAmbiguous"
              : "ppm:riskImportWarnOwnerUnknown";
          warnings.push(t(key, { value: ownerCell }));
        }
      }
    }

    const text = (col: "description" | "mitigation"): string | null | undefined =>
      col in cells ? cells[col] || null : undefined;
    const description = text("description");
    const mitigation = text("mitigation");

    if (!current) {
      const body: PpmRiskWrite = {
        title,
        probability: probability ?? 3,
        impact: impact ?? 3,
        status: status ?? "open",
      };
      if (description) body.description = description;
      if (mitigation) body.mitigation = mitigation;
      if (ownerId) body.owner_id = ownerId;
      return { kind: "create", sheetRow, title, warnings, body };
    }

    const body: PpmRiskWrite = {};
    const changed: string[] = [];
    const differs = (a: string | null | undefined, b: string | null | undefined) =>
      (a ?? "").trim() !== (b ?? "").trim();
    if (title !== current.title.trim()) {
      body.title = title;
      changed.push(label("title"));
    }
    if (description !== undefined && differs(description, current.description)) {
      body.description = description;
      changed.push(label("description"));
    }
    if (probability !== null && probability !== current.probability) {
      body.probability = probability;
      changed.push(label("probability"));
    }
    if (impact !== null && impact !== current.impact) {
      body.impact = impact;
      changed.push(label("impact"));
    }
    if (status && status !== current.status) {
      body.status = status;
      changed.push(label("status"));
    }
    if (ownerId !== undefined && ownerId !== current.owner_id) {
      body.owner_id = ownerId;
      changed.push(label("owner"));
    }
    if (mitigation !== undefined && differs(mitigation, current.mitigation)) {
      body.mitigation = mitigation;
      changed.push(label("mitigation"));
    }
    if (changed.length === 0) {
      return { kind: "unchanged", sheetRow, title, warnings, riskId: current.id };
    }
    return { kind: "update", sheetRow, title, warnings, riskId: current.id, body, changed };
  });

  const count = (kind: PpmRiskImportRow["kind"]) => planned.filter((r) => r.kind === kind).length;
  return {
    rows: planned,
    create: count("create"),
    update: count("update"),
    unchanged: count("unchanged"),
    rejected: count("rejected"),
    warnings: planned.reduce((n, r) => n + r.warnings.length, 0),
  };
}
