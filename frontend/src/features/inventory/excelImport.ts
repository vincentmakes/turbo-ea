import * as XLSX from "xlsx";

import { api } from "@/api/client";
import { fieldLabel, typeLabel } from "@/hooks/useResolveLabel";
import i18n from "@/i18n";
import type {
  CalculatedFieldsMap,
  Card,
  CardType,
  FieldDef,
  Relation,
  RelationType,
  TagGroup,
} from "@/types";

const t = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(key, { ns: "inventory", ...opts });

// ---- Public types --------------------------------------------------------

export interface ImportError {
  row: number;
  column?: string;
  message: string;
}

export interface ImportWarning {
  row?: number;
  column?: string;
  message: string;
}

export interface ParsedRow {
  /** Per-sheet visible row number (`i + 2`) — used for user-facing display. */
  rowIndex: number;
  /**
   * Workbook-wide unique correlation id, assigned by `validateMultiSheet()`
   * when merging sheets. This is what gets sent as the wire `row_index` and
   * used as a map/dedup key on both client and server, so it MUST be unique
   * across the whole workbook (unlike `rowIndex`, which restarts per sheet).
   * Undefined for the legacy single-sheet path, where `rowIndex` is already
   * unique and is used directly.
   */
  wireRow?: number;
  /** Originating sheet name — set by `validateMultiSheet()`, for display. */
  sheet?: string;
  id?: string;
  type: string;
  data: Record<string, unknown>;
  /** Raw parent_id from the file (UUID of existing or of another row in the file). Legacy. */
  parentId?: string;
  /** Decoded parent path segments from the `parent_path` column, root first. */
  parentPath?: string[];
  /**
   * Lookup key for this row's own full path, used so other rows can reference
   * it as a parent: `type|<lowercase_seg1>/<lowercase_seg2>/...`.
   */
  ownPathKey?: string;
  /** Lookup key for this row's parent path (`type|<lowercase parent_path>`). */
  parentPathKey?: string;
  /** Original card when updating an existing record */
  existing?: Card;
  /** For updates: the fields that actually changed (field → { old, new }) */
  changes?: Record<string, { old: unknown; new: unknown }>;
  /** Resolved tag ids to assign (undefined = `tags` column absent / not supplied) */
  tagIds?: string[];
}

/**
 * One queued mutation against the relation graph. Either an upsert (the
 * default — used for both create and update of attribute-bearing relations)
 * or an explicit delete (only emitted from the `Relations` sheet's `action`
 * column, or implicitly when an inline `rel:<key>` cell drops a target
 * that previously existed for that source/relation_type).
 */
export interface RelationOp {
  /** Row number from the originating sheet — 0 indicates the inline cell. */
  rowIndex: number;
  /**
   * Workbook-wide unique correlation id assigned by `validateMultiSheet()`,
   * used as the wire `row_index` so a `/relations/bulk` response can be tied
   * back to the exact op even when two sheets share a per-sheet row number.
   */
  wireRow?: number;
  sheet: string;
  action: "upsert" | "delete";
  /** Relation type key. */
  relationType: string;
  /** Resolved or to-be-resolved source. `sourceId` is filled in once we
   * know it (existing cards: at validation time; new cards: at apply time
   * after the bulk-create returns ids). */
  sourceRef: CardRefHandle;
  targetRef: CardRefHandle;
  /** Optional attribute payload — only populated from the Relations sheet. */
  attributes?: Record<string, unknown>;
  description?: string;
}

/**
 * Either a freshly-resolved server card (UUID known) or a reference to a
 * card row created in the same import batch (UUID assigned after bulk-create
 * returns). The `pathKey` flavour points at a `ParsedRow.ownPathKey`.
 */
export type CardRefHandle =
  | { kind: "id"; id: string }
  | { kind: "pathKey"; pathKey: string; type: string };

export interface RelationCellRef {
  rowIndex: number;
  sheet: string;
  column: string;
  /** Source card — either an existing UUID or the row's own path key. */
  sourceRef: CardRefHandle;
  /** Cell content split into individual `ref` strings. */
  targetRefs: string[];
  /** Relation type metadata. */
  relationType: string;
  targetTypeKey: string;
}

export interface MetaInfo {
  formatVersion?: string;
  exportedAt?: string;
  tenantUrl?: string;
  cardCount?: number;
  relationCount?: number;
}

export interface ImportReport {
  errors: ImportError[];
  warnings: ImportWarning[];
  creates: ParsedRow[];
  updates: ParsedRow[];
  skipped: number;
  totalRows: number;
  /** Relation upsert / delete operations queued by validation. */
  relationOps: RelationOp[];
  /** Meta-sheet info — used for the format-version banner. */
  meta?: MetaInfo;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  /** Per relation status — populated when relationOps is non-empty. */
  relationsUpserted: number;
  relationsDeleted: number;
  relationsFailed: number;
  failedDetails: { row: number; message: string }[];
}

/** Output of `parseWorkbook` — split per sheet so the validator can keep
 * the originating sheet name in errors. The legacy "single sheet, no
 * meta" path produces one `cards` entry with `sheet: <sheetName>`. */
export interface ParsedWorkbook {
  /** Card rows grouped by their sheet name. Sheet name → rows. */
  sheets: { sheet: string; rows: Record<string, unknown>[]; typeHint?: string }[];
  /** Relations-sheet rows, if a Relations sheet was present. */
  relationRows: Record<string, unknown>[];
  meta?: MetaInfo;
}

// ---- Helpers -------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_APPROVAL_STATUSES = new Set(["DRAFT", "APPROVED", "BROKEN", "REJECTED"]);
const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
const TRUTHY = new Set(["true", "yes", "1"]);
const FALSY = new Set(["false", "no", "0"]);
const MAX_PATH_DEPTH = 8;

/**
 * Decode a `" / "`-separated parent path into an array of segments. The
 * encoder escapes both `\` and `/` (`\\` and `\/`), so we walk char by char
 * to apply each escape correctly. Empty input → empty array.
 */
function decodePath(path: string): string[] {
  if (!path) return [];
  const segments: string[] = [];
  let cur = "";
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === "\\" && i + 1 < path.length) {
      // Escaped character — append the next char literally so both `\\`
      // (literal backslash) and `\/` (literal slash) round-trip cleanly.
      cur += path[i + 1];
      i++;
    } else if (ch === "/") {
      segments.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  segments.push(cur.trim());
  return segments.filter(Boolean);
}

/** Build a case-insensitive index key for `(type, segments)`. */
function pathKey(type: string, segments: string[]): string {
  return `${type}|${segments.map((s) => s.toLowerCase()).join("/")}`;
}

/** Mirror of `encodePathSegment()` in `excelExport.ts` — escape `\` and `/`
 * so a card name containing either character round-trips cleanly. */
function encodePathSegment(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
}

/**
 * Split a `rel:<key>` cell into individual target references. Semicolons
 * are the canonical separator (see `excelExport.ts`) because card names
 * commonly contain commas. As a transitional courtesy we fall back to
 * commas when the cell contains no semicolon — this keeps workbooks
 * exported before the convention switch importable. A cell containing
 * any `;` is treated as semicolon-separated, so a single new-format cell
 * with comma-bearing names parses correctly even when the cell happens
 * to also contain commas inside those names.
 */
function splitRelationCell(cell: string): string[] {
  const sep = cell.includes(";") ? ";" : ",";
  return cell
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Backend UUIDs are always lowercased (Python `str(uuid.UUID(...))`), but
 * a hand-typed or stale spreadsheet cell could carry uppercase hex. Use
 * this whenever a UUID string is used as a Map key so the diff doesn't
 * silently miss because of case alone.
 */
function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

/** Walk parent_id chain to produce the full ancestor segments (root first, including the card itself). */
function fullPathFor(card: Card, byId: Map<string, Card>): string[] {
  const segs: string[] = [];
  const seen = new Set<string>();
  let cur: Card | undefined = card;
  while (cur && !seen.has(cur.id) && segs.length < MAX_PATH_DEPTH) {
    seen.add(cur.id);
    segs.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return segs;
}

function sameTagSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const id of b) if (!setA.has(id)) return false;
  return true;
}

function str(v: unknown): string {
  if (v == null) return "";
  // Excel auto-formats date strings into native Date cells; convert back to
  // YYYY-MM-DD so lifecycle / date-attribute validation still works.
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).trim();
}

function fieldDefsForType(
  type: string,
  allTypes: CardType[],
): FieldDef[] {
  const ct = allTypes.find((x) => x.key === type);
  if (!ct) return [];
  return ct.fields_schema.flatMap((s) => s.fields);
}

/**
 * Topologically sort rows so that parents come before children.
 * Rows whose parent (by id or by path) references another row in the creates
 * list are placed after that row. Rows with no parent dependency come first.
 */
function topoSortCreates(rows: ParsedRow[]): ParsedRow[] {
  const byId = new Map<string, ParsedRow>();
  const byOwnPath = new Map<string, ParsedRow>();
  for (const r of rows) {
    if (r.id) byId.set(r.id, r);
    if (r.ownPathKey) byOwnPath.set(r.ownPathKey, r);
  }

  const sorted: ParsedRow[] = [];
  const visited = new Set<string | number>();

  function visit(row: ParsedRow) {
    // Key by the workbook-wide unique `wireRow` when present (multi-sheet):
    // `rowIndex` restarts per sheet, so keying by it collapses same-numbered
    // rows from different sheets into one and silently drops cards. Falls
    // back to `rowIndex` for the legacy single-sheet path where it's unique.
    const key = row.id ?? `row:${row.wireRow ?? row.rowIndex}`;
    if (visited.has(key)) return;
    visited.add(key);

    // Path-based parent reference (preferred for cross-instance imports)
    if (row.parentPathKey) {
      const parent = byOwnPath.get(row.parentPathKey);
      if (parent) visit(parent);
    }

    // Legacy id-based parent reference (same-instance round-trips)
    if (row.parentId) {
      const parent = byId.get(row.parentId);
      if (parent) visit(parent);
    }

    sorted.push(row);
  }

  for (const row of rows) visit(row);
  return sorted;
}

// ---- Core: build update patch --------------------------------------------

interface PatchResult {
  patch: Record<string, unknown>;
  /** Human-readable field-level changes: key → { old, new } */
  changes: Record<string, { old: unknown; new: unknown }>;
}

/**
 * Compare imported data against an existing card and return only the fields
 * that actually changed.  Returns an empty patch when nothing differs.
 */
function buildPatch(
  d: Record<string, unknown>,
  ex: Card,
): PatchResult {
  const patch: Record<string, unknown> = {};
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  // Normalise a string for comparison so that trivial whitespace differences
  // (trailing spaces, \r\n vs \n, etc.) introduced by the XLSX round-trip
  // don't flag as changes.
  const norm = (v: unknown): string =>
    (v == null ? "" : String(v)).trim().replace(/\r\n/g, "\n");

  if (d.name && norm(d.name) !== norm(ex.name)) {
    patch.name = d.name;
    changes.name = { old: ex.name, new: d.name };
  }

  for (const key of ["description", "subtype", "parent_id", "external_id", "alias"] as const) {
    const exVal = (ex as unknown as Record<string, unknown>)[key] ?? "";
    if (d[key] !== undefined && norm(d[key]) !== norm(exVal)) {
      patch[key] = d[key] || null;
      changes[key] = { old: exVal || null, new: d[key] || null };
    }
  }

  // Lifecycle: compare phase-by-phase
  if (d.lifecycle) {
    const newLc = d.lifecycle as Record<string, string>;
    const exLc = (ex.lifecycle || {}) as Record<string, string>;
    for (const phase of LIFECYCLE_PHASES) {
      if ((newLc[phase] ?? "") !== (exLc[phase] ?? "")) {
        patch.lifecycle = d.lifecycle;
        changes[`lifecycle_${phase}`] = {
          old: exLc[phase] ?? null,
          new: newLc[phase] ?? null,
        };
      }
    }
  }

  // Attributes: compare field-by-field (JSON.stringify handles arrays for
  // multiple_select round-trips; norm() handles trivial whitespace diffs
  // on plain-string attributes)
  if (d.attributes) {
    const newAttrs = d.attributes as Record<string, unknown>;
    const exAttrs = (ex.attributes || {}) as Record<string, unknown>;
    let attrChanged = false;
    for (const key of Object.keys(newAttrs)) {
      const nv = newAttrs[key];
      const ev = exAttrs[key];
      const differs = typeof nv === "string" && typeof ev === "string"
        ? norm(nv) !== norm(ev)
        : JSON.stringify(nv) !== JSON.stringify(ev);
      if (differs) {
        attrChanged = true;
        changes[`attr_${key}`] = { old: ev ?? null, new: nv };
      }
    }
    if (attrChanged) {
      patch.attributes = { ...exAttrs, ...newAttrs };
    }
  }

  return { patch, changes };
}

// ---- Core: parse workbook ------------------------------------------------

const META_SHEET_NAME = "_Meta";
const RELATIONS_SHEET_NAME = "Relations";

/**
 * Legacy single-sheet parser. Kept for backwards compatibility with callers
 * that only care about the first sheet. New code should use
 * `parseWorkbookSheets()` to get a structured view of every sheet.
 */
export function parseWorkbook(file: ArrayBuffer): Record<string, unknown>[] {
  // cellDates: true so that Excel-reformatted date cells come back as JS Date
  // objects (handled by str()) instead of opaque serial numbers.
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

/**
 * Multi-sheet parser: returns one entry per non-meta, non-relations sheet,
 * plus the relations rows and meta info. Sheet → type-key mapping is best
 * effort: the workbook produced by `exportToExcel()` uses the type's label
 * (or key) as the sheet name, and `parseWorkbookSheets()` tries both.
 *
 * Workbooks that don't follow the new layout (single sheet, no `_Meta`)
 * still parse correctly — the single sheet becomes the only entry and the
 * downstream validator falls back to the row's own `type` column or the
 * caller-supplied `preSelectedType`.
 */
export function parseWorkbookSheets(
  file: ArrayBuffer,
  allTypes: CardType[],
): ParsedWorkbook {
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  const out: ParsedWorkbook = { sheets: [], relationRows: [] };

  // Match a sheet name back to a card type. Match by translated label first,
  // then key, then label — all case-insensitive — so a file translated
  // by Excel on a German laptop still resolves to "Application" etc.
  function typeForSheet(sheet: string): string | undefined {
    const lower = sheet.trim().toLowerCase();
    for (const t of allTypes) {
      const candidates = new Set<string>();
      candidates.add(t.key.toLowerCase());
      candidates.add(t.label.toLowerCase());
      const translated = typeLabel(t, i18n.language);
      if (translated) candidates.add(translated.toLowerCase());
      if (candidates.has(lower)) return t.key;
    }
    return undefined;
  }

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    if (sheetName === META_SHEET_NAME) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const meta: MetaInfo = {};
      for (const r of rows) {
        const key = String(r["key"] ?? "").trim();
        const value = String(r["value"] ?? "").trim();
        if (key === "format_version") meta.formatVersion = value;
        else if (key === "exported_at") meta.exportedAt = value;
        else if (key === "tenant_url") meta.tenantUrl = value;
        else if (key === "card_count") meta.cardCount = Number(value) || undefined;
        else if (key === "relation_count") meta.relationCount = Number(value) || undefined;
      }
      out.meta = meta;
      continue;
    }

    if (sheetName === RELATIONS_SHEET_NAME) {
      out.relationRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
      });
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    out.sheets.push({ sheet: sheetName, rows, typeHint: typeForSheet(sheetName) });
  }

  return out;
}

// ---- Core: validate ------------------------------------------------------

export function validateImport(
  rows: Record<string, unknown>[],
  existingCards: Card[],
  allTypes: CardType[],
  preSelectedType?: string,
  tagGroups: TagGroup[] = [],
  calculatedFields: CalculatedFieldsMap = {},
): ImportReport {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const creates: ParsedRow[] = [];
  const updates: ParsedRow[] = [];
  let skipped = 0;

  if (rows.length === 0) {
    errors.push({ row: 0, message: t("import.errors.noDataRows") });
    return {
      errors,
      warnings,
      creates,
      updates,
      skipped,
      totalRows: 0,
      relationOps: [],
    };
  }

  // Check for required columns
  const headers = Object.keys(rows[0]);
  const hasNameCol = headers.some((h) => h.toLowerCase() === "name");
  const hasTypeCol = headers.some((h) => h.toLowerCase() === "type");

  if (!hasNameCol) {
    errors.push({ row: 0, column: "name", message: t("import.errors.missingColumn", { column: "name" }) });
  }
  if (!hasTypeCol && !preSelectedType) {
    errors.push({
      row: 0,
      column: "type",
      message: t("import.errors.missingTypeColumn"),
    });
  }

  // If structural errors already, return early
  if (errors.length > 0) {
    return {
      errors,
      warnings,
      creates,
      updates,
      skipped,
      totalRows: rows.length,
      relationOps: [],
    };
  }

  // Warn about unrecognised columns
  const knownCoreCols = new Set([
    "id", "type", "name", "description", "subtype", "parent_id", "parent_path",
    "external_id", "alias", "approval_status", "tags",
    ...LIFECYCLE_PHASES.map((p) => `lifecycle_${p}`),
  ]);
  // Build set of all known attribute columns across all types
  const allAttrKeys = new Set<string>();
  for (const t of allTypes) {
    for (const s of t.fields_schema) {
      for (const f of s.fields) {
        allAttrKeys.add(`attr_${f.key}`);
      }
    }
  }
  for (const h of headers) {
    // `rel:<relation_type_key>` columns are the inline relation cells —
    // recognised and parsed by `validateMultiSheet()`'s second pass. The
    // legacy per-sheet validator must not warn about them just because
    // it doesn't itself process them.
    if (h.startsWith("rel:")) continue;
    if (
      !knownCoreCols.has(h) &&
      !knownCoreCols.has(h.toLowerCase()) &&
      !allAttrKeys.has(h) &&
      !h.startsWith("attr_")
    ) {
      warnings.push({ column: h, message: t("import.warnings.unrecognisedColumn", { column: h }) });
    }
  }

  // Index existing cards by id for fast lookup
  const existingById = new Map<string, Card>();
  for (const card of existingCards) {
    existingById.set(card.id, card);
  }

  // Index existing cards by (type, full ancestor path) for parent_path resolution.
  // When two existing cards share the same path key (same name, same parent
  // chain, same type) we mark it as ambiguous so the import emits a warning
  // and the user can disambiguate by including an `id` column.
  const existingByPath = new Map<string, string>();
  const existingPathConflicts = new Set<string>();
  for (const card of existingCards) {
    const segs = fullPathFor(card, existingById);
    const k = pathKey(card.type, segs);
    if (existingByPath.has(k)) existingPathConflicts.add(k);
    else existingByPath.set(k, card.id);
  }

  // Track seen IDs to detect duplicates within the file
  const seenIds = new Map<string, number>(); // id → first row number

  // Collect all ids present in the file (for parent_id cross-referencing)
  // and pre-compute each row's own path key so child rows can reference
  // parent rows by path even when forward-declared.
  const fileIds = new Set<string>();
  const fileByOwnPathKey = new Map<string, number>(); // path key → 0-based row index
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const id = str(raw["id"] ?? raw["Id"] ?? raw["ID"]);
    if (id && UUID_RE.test(id)) fileIds.add(id);
    const ppRaw = str(raw["parent_path"]);
    const name = str(raw["name"] ?? raw["Name"]);
    const rowType = str(raw["type"] ?? raw["Type"]) || preSelectedType || "";
    if (name && rowType) {
      const segs = ppRaw ? [...decodePath(ppRaw), name] : [name];
      const k = pathKey(rowType, segs);
      // First-write-wins; collisions are flagged later as duplicates.
      if (!fileByOwnPathKey.has(k)) fileByOwnPathKey.set(k, i);
    }
  }

  const typeKeys = new Set(allTypes.filter((t) => !t.is_hidden).map((t) => t.key));

  // Tag lookup: "group_name|tag_name" (lowercased) → id. Also allow bare "tag_name"
  // when the tag name is unique across groups so exports that didn't carry the
  // group prefix can still round-trip.
  const tagByGroupTag = new Map<string, string>();
  const tagByNameOnly = new Map<string, string | null>(); // null marks ambiguous
  for (const g of tagGroups) {
    for (const tg of g.tags) {
      const gt = `${g.name.trim().toLowerCase()}|${tg.name.trim().toLowerCase()}`;
      tagByGroupTag.set(gt, tg.id);
      const bare = tg.name.trim().toLowerCase();
      if (tagByNameOnly.has(bare)) tagByNameOnly.set(bare, null);
      else tagByNameOnly.set(bare, tg.id);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +2 because row 1 is the header, data starts at 2
    const raw = rows[i];

    // Skip fully blank rows
    const allEmpty = Object.values(raw).every((v) => str(v) === "");
    if (allEmpty) {
      skipped++;
      continue;
    }

    const name = str(raw["name"] ?? raw["Name"]);
    const id = str(raw["id"] ?? raw["Id"] ?? raw["ID"]);
    const type = str(raw["type"] ?? raw["Type"]) || preSelectedType || "";
    const description = str(raw["description"] ?? raw["Description"]);
    const subtype = str(raw["subtype"] ?? raw["Subtype"]);
    let parentId = str(raw["parent_id"]);
    const parentPathRaw = str(raw["parent_path"]);
    const externalId = str(raw["external_id"]);
    const alias = str(raw["alias"] ?? raw["Alias"]);
    const approvalStatus = str(raw["approval_status"]).toUpperCase();

    // Rule 2: name required
    if (!name) {
      errors.push({ row: rowNum, column: "name", message: t("import.errors.nameRequired", { row: rowNum }) });
      continue;
    }

    // Rule 4: type must be valid
    if (!typeKeys.has(type)) {
      errors.push({
        row: rowNum,
        column: "type",
        message: t("import.errors.unknownType", { row: rowNum, type }),
      });
      continue;
    }

    // Rule 5: if id present, must be valid UUID
    let matchedExisting: Card | undefined;
    if (id) {
      if (!UUID_RE.test(id)) {
        errors.push({
          row: rowNum,
          column: "id",
          message: t("import.errors.invalidId", { row: rowNum, id }),
        });
        continue;
      }

      // Rule 8: duplicate id in file
      const prevRow = seenIds.get(id);
      if (prevRow !== undefined) {
        errors.push({
          row: rowNum,
          column: "id",
          message: t("import.errors.duplicateId", { row: rowNum, id, prevRow }),
        });
        continue;
      }
      seenIds.set(id, rowNum);

      // Rule 6: id must match existing — but for cross-instance imports the
      // source UUID won't exist locally, so demote to a "create" with a
      // warning instead of failing the row outright.
      matchedExisting = existingById.get(id);
      if (!matchedExisting) {
        warnings.push({
          row: rowNum,
          column: "id",
          message: t("import.warnings.idNotFoundCreating", { row: rowNum, id }),
        });
        // Fall through: the row will be classified as a create below; we
        // intentionally drop the file id so the server generates a fresh one.
        seenIds.delete(id);
      } else if (matchedExisting.type !== type) {
        // Rule 7: type must match for an update
        errors.push({
          row: rowNum,
          column: "type",
          message: t("import.errors.typeMismatch", { row: rowNum, fileType: type, existingType: matchedExisting.type }),
        });
        continue;
      }
    }

    // Resolve parent_path (preferred for cross-instance imports). Path-based
    // resolution wins over `parent_id` when both are provided, so an exported
    // file from another tenant still wires up hierarchy correctly.
    let parentSegments: string[] | undefined;
    let parentPathKey: string | undefined;
    let pathRowError = false;
    if (parentPathRaw) {
      parentSegments = decodePath(parentPathRaw);
      if (parentSegments.length === 0) {
        // Treat malformed path (only escapes / whitespace) as missing.
        parentSegments = undefined;
      } else {
        parentPathKey = pathKey(type, parentSegments);

        // Self-reference: a row whose parent_path is its own path.
        const ownKey = pathKey(type, [...parentSegments, name]);
        if (parentPathKey === ownKey) {
          errors.push({
            row: rowNum,
            column: "parent_path",
            message: t("import.errors.parentSelfReference", { row: rowNum }),
          });
          continue;
        }

        const existingMatch = existingByPath.get(parentPathKey);
        if (existingMatch) {
          // Use the existing card's id directly — overrides any stale parent_id.
          parentId = existingMatch;
          if (existingPathConflicts.has(parentPathKey)) {
            warnings.push({
              row: rowNum,
              column: "parent_path",
              message: t("import.warnings.ambiguousParentPath", { row: rowNum, path: parentPathRaw }),
            });
          }
        } else if (fileByOwnPathKey.has(parentPathKey)) {
          // Parent will be created earlier in the file via topo sort; clear
          // any legacy parent_id since it would point at the source-instance
          // UUID and confuse executeImport.
          parentId = "";
        } else {
          errors.push({
            row: rowNum,
            column: "parent_path",
            message: t("import.errors.invalidParentPath", { row: rowNum, path: parentPathRaw }),
          });
          pathRowError = true;
        }
      }
    }
    if (pathRowError) continue;

    // Validate parent_id (legacy / same-instance round-trips). Skipped when
    // parent_path already resolved to an existing card or a file row.
    if (parentId && !parentPathKey) {
      if (!UUID_RE.test(parentId)) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: t("import.errors.invalidParentId", { row: rowNum, parentId }),
        });
        continue;
      }
      // parent must exist in DB or be another row in the file
      if (!existingById.has(parentId) && !fileIds.has(parentId)) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: t("import.errors.parentNotFound", { row: rowNum, parentId }),
        });
        continue;
      }
      // parent must not be self
      if (parentId === id) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: t("import.errors.parentSelfReference", { row: rowNum }),
        });
        continue;
      }
    }

    // Rule 9: approval_status validation
    if (approvalStatus && !VALID_APPROVAL_STATUSES.has(approvalStatus)) {
      errors.push({
        row: rowNum,
        column: "approval_status",
        message: t("import.errors.invalidApprovalStatus", { row: rowNum, status: approvalStatus }),
      });
      continue;
    }

    // Build lifecycle object
    const lifecycle: Record<string, string> = {};
    for (const phase of LIFECYCLE_PHASES) {
      const val = str(raw[`lifecycle_${phase}`]);
      if (val) {
        // Rule 13: lifecycle dates
        if (!DATE_RE.test(val)) {
          errors.push({
            row: rowNum,
            column: `lifecycle_${phase}`,
            message: t("import.errors.invalidDate", { row: rowNum, field: `lifecycle_${phase}`, value: val }),
          });
        } else {
          lifecycle[phase] = val;
        }
      }
    }

    // Build attributes object, validating against field defs
    const fieldDefs = fieldDefsForType(type, allTypes);
    const calcFieldsForType = new Set(calculatedFields[type] || []);
    const attributes: Record<string, unknown> = {};
    let rowHasAttrError = false;

    for (const field of fieldDefs) {
      const colKey = `attr_${field.key}`;
      const rawVal = raw[colKey];
      const val = str(rawVal);

      // Read-only fields (admin-marked or calculated) cannot be set via
      // import. On a round-trip the exporter emits the current value back,
      // and re-importing it is a no-op — so only warn when the user has
      // actually supplied a *different* value than what's on the existing
      // card. Otherwise we'd spam one warning per (row, calc-field)
      // combination on every re-import of an untouched workbook.
      const isReadOnly = field.readonly === true || calcFieldsForType.has(field.key);
      if (isReadOnly) {
        if (val) {
          const existingVal = matchedExisting?.attributes?.[field.key];
          const existingStr =
            existingVal == null
              ? ""
              : Array.isArray(existingVal)
                ? existingVal.join(", ")
                : String(existingVal);
          if (val.trim() !== existingStr.trim()) {
            warnings.push({
              row: rowNum,
              column: colKey,
              message: t("import.warnings.readOnlyFieldIgnored", {
                row: rowNum,
                field: fieldLabel(field, i18n.language),
              }),
            });
          }
        }
        continue;
      }

      if (!val) {
        // A missing required attribute is a data-quality concern, not a data
        // integrity one — the backend creates the card regardless and the
        // quality score will reflect the gap. Surface a warning so users
        // notice, but don't block cross-instance migrations on incomplete
        // source data.
        if (field.required && !matchedExisting) {
          warnings.push({
            row: rowNum,
            column: colKey,
            message: t("import.errors.requiredFieldEmpty", { row: rowNum, field: fieldLabel(field, i18n.language) }),
          });
        }
        continue;
      }

      // Validate by field type
      switch (field.type) {
        case "cost":
        case "number": {
          // Rule 11
          const num = Number(val);
          if (isNaN(num)) {
            errors.push({
              row: rowNum,
              column: colKey,
              message: t("import.errors.expectsNumber", { row: rowNum, field: fieldLabel(field, i18n.language), value: val }),
            });
            rowHasAttrError = true;
          } else {
            attributes[field.key] = num;
          }
          break;
        }
        case "boolean": {
          // Rule 12
          const lower = val.toLowerCase();
          if (TRUTHY.has(lower)) {
            attributes[field.key] = true;
          } else if (FALSY.has(lower)) {
            attributes[field.key] = false;
          } else {
            errors.push({
              row: rowNum,
              column: colKey,
              message: t("import.errors.expectsBoolean", { row: rowNum, field: fieldLabel(field, i18n.language), value: val }),
            });
            rowHasAttrError = true;
          }
          break;
        }
        case "date": {
          // Rule 13
          if (!DATE_RE.test(val)) {
            errors.push({
              row: rowNum,
              column: colKey,
              message: t("import.errors.invalidDate", { row: rowNum, field: fieldLabel(field, i18n.language), value: val }),
            });
            rowHasAttrError = true;
          } else {
            attributes[field.key] = val;
          }
          break;
        }
        case "single_select": {
          // Rule 10
          if (field.options && field.options.length > 0) {
            const validKeys = field.options.map((o) => o.key);
            if (!validKeys.includes(val)) {
              errors.push({
                row: rowNum,
                column: colKey,
                message: t("import.errors.invalidSelectValue", { row: rowNum, value: val, field: fieldLabel(field, i18n.language), valid: validKeys.join(", ") }),
              });
              rowHasAttrError = true;
            } else {
              attributes[field.key] = val;
            }
          } else {
            attributes[field.key] = val;
          }
          break;
        }
        case "multiple_select": {
          const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
          if (field.options && field.options.length > 0) {
            const validKeys = field.options.map((o) => o.key);
            for (const part of parts) {
              if (!validKeys.includes(part)) {
                errors.push({
                  row: rowNum,
                  column: colKey,
                  message: t("import.errors.invalidSelectValue", { row: rowNum, value: part, field: fieldLabel(field, i18n.language), valid: validKeys.join(", ") }),
                });
                rowHasAttrError = true;
              }
            }
            if (!rowHasAttrError) {
              attributes[field.key] = parts;
            }
          } else {
            attributes[field.key] = parts;
          }
          break;
        }
        default:
          // text — accept as-is
          attributes[field.key] = val;
      }
    }

    if (rowHasAttrError) continue;

    // Parse optional Tags column: "Group: Tag, Group: Tag" (or bare "Tag")
    let parsedTagIds: string[] | undefined;
    const tagsCell = str(raw["tags"] ?? raw["Tags"]);
    if (tagsCell !== "") {
      parsedTagIds = [];
      const entries = tagsCell
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const entry of entries) {
        const colonIdx = entry.indexOf(":");
        let resolved: string | null | undefined;
        if (colonIdx > 0) {
          const groupName = entry.slice(0, colonIdx).trim().toLowerCase();
          const tagName = entry.slice(colonIdx + 1).trim().toLowerCase();
          resolved = tagByGroupTag.get(`${groupName}|${tagName}`);
        } else {
          resolved = tagByNameOnly.get(entry.toLowerCase());
        }
        if (resolved == null) {
          warnings.push({
            row: rowNum,
            column: "tags",
            message: t("import.warnings.unknownTag", { row: rowNum, value: entry }),
          });
        } else if (!parsedTagIds.includes(resolved)) {
          parsedTagIds.push(resolved);
        }
      }
    }

    // Build the data payload
    const data: Record<string, unknown> = {
      type,
      name,
    };
    if (description) data.description = description;
    if (subtype) data.subtype = subtype;
    if (parentId) data.parent_id = parentId;
    if (externalId) data.external_id = externalId;
    if (alias) data.alias = alias;
    if (Object.keys(lifecycle).length > 0) data.lifecycle = lifecycle;
    if (Object.keys(attributes).length > 0) data.attributes = attributes;

    const parsed: ParsedRow = {
      rowIndex: rowNum,
      type,
      data,
      parentId: parentId || undefined,
      parentPath: parentSegments,
      parentPathKey,
      ownPathKey: pathKey(type, parentSegments ? [...parentSegments, name] : [name]),
      tagIds: parsedTagIds,
    };

    if (id && matchedExisting) {
      parsed.id = id;
      parsed.existing = matchedExisting;
      // Classify as update when either regular fields or tags actually changed
      const { patch, changes } = buildPatch(data, matchedExisting);
      const tagsChanged =
        parsedTagIds !== undefined &&
        !sameTagSet(
          parsedTagIds,
          (matchedExisting.tags || []).map((tg) => tg.id),
        );
      if (Object.keys(patch).length > 0 || tagsChanged) {
        parsed.changes = changes;
        if (tagsChanged && parsedTagIds) {
          const newTagIds = parsedTagIds;
          parsed.changes = {
            ...(parsed.changes || {}),
            tags: {
              old: (matchedExisting.tags || []).map((tg) => tg.name).join(", "),
              new: newTagIds
                .map((id) => {
                  for (const g of tagGroups) {
                    const tg = g.tags.find((x) => x.id === id);
                    if (tg) return tg.name;
                  }
                  return id;
                })
                .join(", "),
            },
          };
        }
        updates.push(parsed);
      } else {
        skipped++;
      }
    } else {
      creates.push(parsed);
    }
  }

  return {
    errors,
    warnings,
    creates,
    updates,
    skipped,
    totalRows: rows.length,
    relationOps: [],
  };
}

// ---- Multi-sheet validation ----------------------------------------------

/**
 * Top-level validator for the new multi-sheet workbook format. Wraps the
 * legacy single-sheet `validateImport()` for each card sheet, then parses
 * the inline `rel:<key>` columns and the optional `Relations` sheet into
 * a `relationOps` list. Refs that don't match a row in the workbook nor an
 * existing card are flagged with `errors`.
 */
export async function validateMultiSheet(
  parsed: ParsedWorkbook,
  existingCards: Card[],
  allTypes: CardType[],
  relationTypes: RelationType[],
  existingRelations: Relation[],
  preSelectedType?: string,
  tagGroups: TagGroup[] = [],
  calculatedFields: CalculatedFieldsMap = {},
): Promise<ImportReport> {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const creates: ParsedRow[] = [];
  const updates: ParsedRow[] = [];
  let skipped = 0;
  let totalRows = 0;
  // Monotonic counter used to hand every merged row a workbook-wide unique
  // `wireRow`. `validateImport()`'s per-sheet `rowIndex` (`i + 2`) restarts at
  // 2 for each sheet, so it collides across sheets and cannot be used as a
  // correlation / dedup key once the sheets are flattened into one batch.
  let wireCounter = 0;

  const meta = parsed.meta;
  // Banner-trigger: a format mismatch is non-fatal — surface as a warning.
  if (meta?.formatVersion && meta.formatVersion !== "2") {
    warnings.push({
      message: t("import.warnings.formatVersionMismatch", {
        version: meta.formatVersion,
      }),
    });
  }

  // Run the per-sheet validation; type hint from the sheet name becomes
  // the preSelectedType for that sheet.
  for (const sheet of parsed.sheets) {
    const sheetReport = validateImport(
      sheet.rows,
      existingCards,
      allTypes,
      sheet.typeHint ?? preSelectedType,
      tagGroups,
      calculatedFields,
    );
    errors.push(
      ...sheetReport.errors.map((e) => ({
        ...e,
        message: `${sheet.sheet}: ${e.message}`,
      })),
    );
    warnings.push(
      ...sheetReport.warnings.map((w) => ({
        ...w,
        message: `${sheet.sheet}: ${w.message}`,
      })),
    );
    // Tag each row with its sheet name (for display) and a workbook-wide
    // unique `wireRow` (for correlation). `rowIndex` stays the per-sheet
    // visible Excel row number.
    for (const r of sheetReport.creates) {
      r.sheet = sheet.sheet;
      r.wireRow = ++wireCounter;
    }
    for (const r of sheetReport.updates) {
      r.sheet = sheet.sheet;
      r.wireRow = ++wireCounter;
    }
    creates.push(...sheetReport.creates);
    updates.push(...sheetReport.updates);
    skipped += sheetReport.skipped;
    totalRows += sheetReport.totalRows;
  }

  // Collect relation cell references from inline `rel:<key>` columns and
  // the Relations sheet. The collector builds CardRefHandles so the apply
  // step can later swap pathKeys for the resolved UUID once bulk-create
  // returns.
  const relationOps: RelationOp[] = [];
  const inlineRefs: RelationCellRef[] = [];

  // Track all freshly-parsed creates' own path keys so a relation cell
  // can point at a row created in the same workbook.
  const fileByOwnPathKey = new Map<string, ParsedRow>();
  for (const r of creates) {
    if (r.ownPathKey) fileByOwnPathKey.set(r.ownPathKey, r);
  }

  // Bare-name index of same-batch creates. The exporter writes a relation
  // target as just its name when that name is unique for its type — even for
  // hierarchical cards, whose `ownPathKey` is parent-qualified. So a
  // bare-name ref to a new child card misses `fileByOwnPathKey`; this index
  // lets us still recognise it as a same-batch row and express it as a
  // name+path ref the backend resolves after creating the cards. `null`
  // marks an ambiguous bare name (2+ creates of the same type share it) —
  // those fall through to the full-path / backend resolver.
  const fileByTypeName = new Map<string, ParsedRow | null>();
  for (const r of creates) {
    const nm = str(r.data.name).toLowerCase();
    if (!nm) continue;
    const k = `${r.type}|${nm}`;
    fileByTypeName.set(k, fileByTypeName.has(k) ? null : r);
  }

  /** Match a ref against a card created in this same workbook, by full path
   * first (exact) then by a unique bare name. Returns the matched row, or
   * undefined when there's no unambiguous same-batch card. */
  function sameBatchCreate(type: string, ref: string): ParsedRow | undefined {
    const segs = decodePath(ref);
    if (segs.length === 0) return undefined;
    const full = fileByOwnPathKey.get(pathKey(type, segs));
    if (full) return full;
    if (segs.length === 1) {
      const byName = fileByTypeName.get(`${type}|${segs[0].trim().toLowerCase()}`);
      if (byName) return byName; // null (ambiguous) → undefined
    }
    return undefined;
  }

  // ----- Two-pass ref resolution ----------------------------------------
  // The previous implementation matched relation targets against
  // `existingCards`, which is whatever slice of the Inventory grid the user
  // had filtered to. That left cross-type targets (e.g. an ITComponent
  // referenced from an Application sheet while the grid is filtered to
  // Applications) reporting as "missing" even when the card actually
  // exists in the DB. The fix is to defer to the backend's
  // `POST /cards/resolve-refs`, which sees the full corpus. Same-batch
  // refs (pointing at rows the workbook itself creates) stay client-side.
  //
  // Pass 1: walk every sheet + the Relations sheet and collect each ref
  // that *isn't* a same-batch row. Stage them by a canonical key so
  // identical refs in different cells share one server lookup.

  /** Normalised lookup key matching what we'll send to the backend. */
  function refLookupKey(type: string, ref: string): string {
    const segs = decodePath(ref);
    return `${type}|${segs.map((s) => s.trim().toLowerCase()).join("/")}`;
  }

  type StagedRef = { type: string; ref: string };
  const refsToResolve = new Map<string, StagedRef>();

  function stageRef(type: string, ref: string): void {
    const segs = decodePath(ref);
    if (segs.length === 0) return;
    if (sameBatchCreate(type, ref)) return; // same-batch hit, no server call
    const key = refLookupKey(type, ref);
    if (!refsToResolve.has(key)) {
      refsToResolve.set(key, { type, ref });
    }
  }

  for (const sheet of parsed.sheets) {
    if (sheet.rows.length === 0) continue;
    const sheetType = sheet.typeHint ?? preSelectedType;
    if (!sheetType) continue;
    const headers = Object.keys(sheet.rows[0]);
    const relCols = headers.filter((h) => h.startsWith("rel:"));
    for (const raw of sheet.rows) {
      const name = str(raw["name"] ?? raw["Name"]);
      if (!name) continue;
      const parentPathRaw = str(raw["parent_path"]);
      // Always stage the row's source ref, even when `id` is a valid UUID.
      // The diff pass uses the UUID directly when it can, but having the
      // ref staged means `resolveRef()` has a fallback for workbooks whose
      // UUIDs point at a different tenant (cross-instance migration) or
      // were hand-edited away. Cheap — refs are deduped by canonical key.
      const ownPath = parentPathRaw
        ? [...decodePath(parentPathRaw), name]
        : [name];
      const ownKey = pathKey(sheetType, ownPath);
      if (!fileByOwnPathKey.has(ownKey)) {
        stageRef(sheetType, ownPath.map(encodePathSegment).join(" / "));
      }
      for (const col of relCols) {
        const relTypeKey = col.slice(4);
        const rt = relationTypes.find((r) => r.key === relTypeKey);
        if (!rt) continue;
        const cellRaw = str(raw[col]);
        if (!cellRaw) continue;
        for (const part of splitRelationCell(cellRaw)) {
          stageRef(rt.target_type_key, part);
        }
      }
    }
  }
  for (const raw of parsed.relationRows) {
    const relType = str(raw["relation_type"]);
    if (!relType) continue;
    const rt = relationTypes.find((r) => r.key === relType);
    if (!rt) continue;
    const sourceTypeKey = str(raw["source_type"]) || rt.source_type_key;
    const targetTypeKey = str(raw["target_type"]) || rt.target_type_key;
    const sourceRefStr = str(raw["source_ref"]);
    const targetRefStr = str(raw["target_ref"]);
    if (sourceRefStr) stageRef(sourceTypeKey, sourceRefStr);
    if (targetRefStr) stageRef(targetTypeKey, targetRefStr);
  }

  // Pass 2: ask the backend to resolve them all in one round-trip. Even a
  // single ref goes through the endpoint — keeps the code path uniform and
  // gives us consistent ambiguity reporting.
  const refResults = new Map<string, {
    status: "resolved" | "ambiguous" | "missing";
    id?: string;
    candidates?: { id: string; path: string }[];
  }>();
  if (refsToResolve.size > 0) {
    type ResolveResp = {
      results: {
        row: number;
        column: string;
        status: "resolved" | "ambiguous" | "missing";
        id?: string;
        candidates?: { id: string; path: string }[];
      }[];
    };
    const refsArr = Array.from(refsToResolve.entries());
    const CHUNK = 1000; // backend caps refs at 5000 per request
    for (let i = 0; i < refsArr.length; i += CHUNK) {
      const chunk = refsArr.slice(i, i + CHUNK);
      const payload = {
        refs: chunk.map(([key, sr], idx) => ({
          // `row` / `column` are only used to pin the response back to the
          // staged entry — the importer doesn't display them anywhere.
          row: i + idx,
          column: key,
          type: sr.type,
          ref: sr.ref,
        })),
      };
      try {
        const resp = await api.post<ResolveResp>("/cards/resolve-refs", payload);
        for (const r of resp.results) {
          const stagedEntry = refsArr[r.row];
          if (!stagedEntry) continue;
          refResults.set(stagedEntry[0], {
            status: r.status,
            id: r.id,
            candidates: r.candidates,
          });
        }
      } catch {
        // If the resolve endpoint fails wholesale, fall back to per-ref
        // missing so the user sees a clear error rather than a silent
        // empty diff.
        for (const [key] of chunk) {
          refResults.set(key, { status: "missing" });
        }
      }
    }
  }

  /**
   * Resolve a single ref string into a CardRefHandle. Order of precedence:
   *   1. row in the same workbook (matched by name + parent path)
   *   2. backend `POST /cards/resolve-refs` result (resolved or ambiguous)
   *   3. otherwise: error.
   */
  function resolveRef(
    targetTypeKey: string,
    ref: string,
    rowIndex: number,
    _sheet: string,
    column: string,
  ): CardRefHandle | undefined {
    const segs = decodePath(ref);
    if (segs.length === 0) return undefined;
    // Same-batch row? Match by full path, then by unique bare name (the
    // exporter writes bare names for uniquely-named cards, including
    // hierarchical ones). Express it as the matched row's own path key so
    // the apply step hands the backend a name+path ref it resolves after
    // creating the cards.
    const fileMatch = sameBatchCreate(targetTypeKey, ref);
    if (fileMatch?.ownPathKey) {
      return { kind: "pathKey", pathKey: fileMatch.ownPathKey, type: targetTypeKey };
    }
    const lookupKey = refLookupKey(targetTypeKey, ref);
    const r = refResults.get(lookupKey);
    if (r?.status === "resolved" && r.id) {
      return { kind: "id", id: normalizeId(r.id) };
    }
    if (r?.status === "ambiguous") {
      const hints = (r.candidates ?? []).slice(0, 3).map((c) => c.path).join("; ");
      errors.push({
        row: rowIndex,
        column,
        message: t("import.errors.relationTargetAmbiguous", {
          type: targetTypeKey,
          ref,
          hints,
        }),
      });
      return undefined;
    }
    // Missing (or no result fetched — e.g. unstaged because both names
    // were blank-trimmed empty). Emit the missing error.
    errors.push({
      row: rowIndex,
      column,
      message: t("import.errors.relationTargetMissing", {
        type: targetTypeKey,
        ref,
      }),
    });
    return undefined;
  }

  // ----- Inline `rel:<key>` columns on card sheets -------------------------
  // Build a lookup: source card identity → set of existing relations of each type.
  // We use this to compute deletes (cell empty → drop everything) and noops.
  // cardId → type → target ids. Keys are normalised so a stray uppercase
  // hex character in the source spreadsheet can't silently miss the diff.
  const outgoingByCard = new Map<string, Map<string, string[]>>();
  // Triple-key (type|source|target) → existing relation so the Relations
  // sheet's diff can decide whether a row is a no-op (relation already
  // exists with identical attributes/description) or a real upsert.
  const relationByTriple = new Map<string, Relation>();
  for (const rel of existingRelations) {
    const sid = normalizeId(rel.source_id);
    const tid = normalizeId(rel.target_id);
    let perType = outgoingByCard.get(sid);
    if (!perType) {
      perType = new Map();
      outgoingByCard.set(sid, perType);
    }
    const list = perType.get(rel.type) || [];
    list.push(tid);
    perType.set(rel.type, list);
    relationByTriple.set(`${rel.type}|${sid}|${tid}`, rel);
  }

  for (const sheet of parsed.sheets) {
    if (sheet.rows.length === 0) continue;
    const sheetType = sheet.typeHint ?? preSelectedType;
    if (!sheetType) continue;

    const headers = Object.keys(sheet.rows[0]);
    const relColumns = headers.filter((h) => h.startsWith("rel:"));
    if (relColumns.length === 0) continue;

    // Map relation type key → RelationType, filtered to those with this
    // sheet's type as source. Reject columns referring to relation types
    // that don't match or that carry attributes (those belong on the
    // Relations sheet).
    const validRelTypes = new Map<string, RelationType>();
    for (const rt of relationTypes) {
      if (rt.source_type_key !== sheetType) continue;
      if (rt.attributes_schema && rt.attributes_schema.length > 0) continue;
      validRelTypes.set(rt.key, rt);
    }

    for (let i = 0; i < sheet.rows.length; i++) {
      const raw = sheet.rows[i];
      const rowNum = i + 2;
      const name = str(raw["name"] ?? raw["Name"]);
      const idCell = str(raw["id"] ?? raw["Id"] ?? raw["ID"]);
      const parentPathRaw = str(raw["parent_path"]);
      if (!name) continue;

      // Locate the source. A row that this same workbook is *creating*
      // (`fileByOwnPathKey`, which holds only creates) must source its
      // relations from the pathKey, so the apply step resolves them to the
      // NEW server id. Trusting the `id` column here instead would carry a
      // stale, cross-instance UUID — the card's id from the *source* instance
      // an export came from — which is absent in a fresh target and fails
      // the relation insert with a foreign-key violation. The `id` column is
      // only authoritative for cards that already exist in the target (an
      // update / same-instance re-import), where it also enables the
      // relation delete-diff below.
      let sourceRef: CardRefHandle | undefined;
      const ownPath = parentPathRaw
        ? [...decodePath(parentPathRaw), name]
        : [name];
      const ownKey = pathKey(sheetType, ownPath);
      if (fileByOwnPathKey.has(ownKey)) {
        sourceRef = { kind: "pathKey", pathKey: ownKey, type: sheetType };
      } else if (idCell && UUID_RE.test(idCell)) {
        sourceRef = { kind: "id", id: normalizeId(idCell) };
      } else {
        // Fallback for rows whose `id` cell is missing / non-UUID — try
        // to resolve against existing cards via the staged name+path ref.
        const handle = resolveRef(
          sheetType,
          ownPath.map(encodePathSegment).join(" / "),
          rowNum,
          sheet.sheet,
          "row",
        );
        if (!handle) continue; // resolveRef already pushed an error
        sourceRef = handle;
      }

      for (const col of relColumns) {
        const relTypeKey = col.slice(4);
        const rt = validRelTypes.get(relTypeKey);
        if (!rt) {
          warnings.push({
            row: rowNum,
            column: col,
            message: t("import.warnings.unknownRelationType", { type: relTypeKey }),
          });
          continue;
        }
        const cellRaw = str(raw[col]);
        const targetRefs = cellRaw ? splitRelationCell(cellRaw) : [];
        const targetHandles: CardRefHandle[] = [];
        let resolvedAll = true;
        for (const tr of targetRefs) {
          const handle = resolveRef(rt.target_type_key, tr, rowNum, sheet.sheet, col);
          if (!handle) {
            resolvedAll = false;
            continue;
          }
          targetHandles.push(handle);
        }
        if (!resolvedAll) continue;

        // For existing sources, compute the diff against `existingRelations`
        // so we can emit upsert + delete ops. For new sources (pathKey),
        // every target is an upsert.
        if (sourceRef.kind === "id") {
          const existingTargets = outgoingByCard.get(sourceRef.id)?.get(rt.key) || [];
          const existingSet = new Set(existingTargets);
          const newIds = new Set<string>();
          for (const h of targetHandles) {
            if (h.kind === "id") newIds.add(h.id);
          }
          // Only queue an upsert when the target isn't already in the live
          // graph for this (source, type) — otherwise the preview's
          // "relations to add" count would balloon to include every
          // already-present edge, even on a no-op round-trip. Same-batch
          // pathKey targets are never existing by definition, so they
          // always count as a new upsert.
          for (const h of targetHandles) {
            const alreadyExists = h.kind === "id" && existingSet.has(h.id);
            if (alreadyExists) continue;
            relationOps.push({
              rowIndex: rowNum,
              sheet: sheet.sheet,
              action: "upsert",
              relationType: rt.key,
              sourceRef,
              targetRef: h,
            });
          }
          // Delete relations that disappeared from the cell.
          for (const tid of existingTargets) {
            if (!newIds.has(tid)) {
              relationOps.push({
                rowIndex: rowNum,
                sheet: sheet.sheet,
                action: "delete",
                relationType: rt.key,
                sourceRef,
                targetRef: { kind: "id", id: tid },
              });
            }
          }
        } else {
          for (const h of targetHandles) {
            relationOps.push({
              rowIndex: rowNum,
              sheet: sheet.sheet,
              action: "upsert",
              relationType: rt.key,
              sourceRef,
              targetRef: h,
            });
          }
        }

        inlineRefs.push({
          rowIndex: rowNum,
          sheet: sheet.sheet,
          column: col,
          sourceRef,
          targetRefs,
          relationType: rt.key,
          targetTypeKey: rt.target_type_key,
        });
      }
    }
  }

  // ----- Relations sheet --------------------------------------------------
  if (parsed.relationRows.length > 0) {
    for (let i = 0; i < parsed.relationRows.length; i++) {
      const raw = parsed.relationRows[i];
      const rowNum = i + 2;
      const relType = str(raw["relation_type"]);
      if (!relType) {
        errors.push({
          row: rowNum,
          column: "relation_type",
          message: t("import.errors.relationTypeRequired"),
        });
        continue;
      }
      const rt = relationTypes.find((r) => r.key === relType);
      if (!rt) {
        errors.push({
          row: rowNum,
          column: "relation_type",
          message: t("import.errors.unknownRelationType", { type: relType }),
        });
        continue;
      }
      const action = (str(raw["action"]) || "upsert").toLowerCase();
      if (action !== "upsert" && action !== "delete") {
        errors.push({
          row: rowNum,
          column: "action",
          message: t("import.errors.invalidRelationAction", { action }),
        });
        continue;
      }
      const sourceTypeKey = str(raw["source_type"]) || rt.source_type_key;
      const targetTypeKey = str(raw["target_type"]) || rt.target_type_key;
      const sourceRefStr = str(raw["source_ref"]);
      const targetRefStr = str(raw["target_ref"]);
      const sourceHandle = resolveRef(
        sourceTypeKey,
        sourceRefStr,
        rowNum,
        RELATIONS_SHEET_NAME,
        "source_ref",
      );
      const targetHandle = resolveRef(
        targetTypeKey,
        targetRefStr,
        rowNum,
        RELATIONS_SHEET_NAME,
        "target_ref",
      );
      if (!sourceHandle || !targetHandle) continue;
      // Parse attr_* columns into an attributes payload using the relation type's schema.
      const attrFields = rt.attributes_schema || [];
      const attributes: Record<string, unknown> = {};
      for (const f of attrFields) {
        const cell = str(raw[`attr_${f.key}`]);
        if (cell === "") continue;
        // Type coercion mirrors the card attribute path; cost/number → Number, boolean, etc.
        if (f.type === "number" || f.type === "cost") {
          const n = Number(cell);
          if (!isNaN(n)) attributes[f.key] = n;
        } else if (f.type === "boolean") {
          const lower = cell.toLowerCase();
          if (TRUTHY.has(lower)) attributes[f.key] = true;
          else if (FALSY.has(lower)) attributes[f.key] = false;
        } else {
          attributes[f.key] = cell;
        }
      }
      relationOps.push({
        rowIndex: rowNum,
        sheet: RELATIONS_SHEET_NAME,
        action: action as "upsert" | "delete",
        relationType: relType,
        sourceRef: sourceHandle,
        targetRef: targetHandle,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        description: str(raw["description"]) || undefined,
      });
    }
  }

  // Drop Relations-sheet upserts that would re-write a relation
  // identically to what the live graph already has — those are no-ops
  // and shouldn't inflate the "relations to add" count on a round-trip
  // (the dominant noise source on attribute-bearing relations like
  // `relAppToITC`, where every export row roundtrips as an upsert).
  // Deletes pass through unchanged; upserts on resolved-by-name refs
  // whose target row was created in the same batch (pathKey targets)
  // also pass through, because they can't have an existing relation yet.
  function attributesMatch(
    proposed: Record<string, unknown> | undefined,
    current: Record<string, unknown> | null | undefined,
  ): boolean {
    const a = proposed ?? {};
    const b = current ?? {};
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      // JSON.stringify handles arrays / nested objects; primitives compare
      // by value. Same approach the inline-cell diff uses.
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
    }
    return true;
  }
  const dedupedOps: RelationOp[] = [];
  for (const op of relationOps) {
    if (op.sheet !== RELATIONS_SHEET_NAME || op.action !== "upsert") {
      dedupedOps.push(op);
      continue;
    }
    if (op.sourceRef.kind !== "id" || op.targetRef.kind !== "id") {
      dedupedOps.push(op);
      continue;
    }
    const key = `${op.relationType}|${op.sourceRef.id}|${op.targetRef.id}`;
    const existing = relationByTriple.get(key);
    if (!existing) {
      dedupedOps.push(op);
      continue;
    }
    const sameAttrs = attributesMatch(op.attributes, existing.attributes);
    const sameDescription =
      (op.description ?? "").trim() === (existing.description ?? "").trim();
    if (sameAttrs && sameDescription) continue; // no-op, drop
    dedupedOps.push(op);
  }
  relationOps.length = 0;
  relationOps.push(...dedupedOps);

  // Hand every relation op a workbook-wide unique `wireRow` so a
  // `/relations/bulk` response can be tied back to the exact op for
  // failure reporting even when two sheets share a per-sheet row number.
  for (const op of relationOps) op.wireRow = ++wireCounter;

  void inlineRefs;
  return {
    errors,
    warnings,
    creates,
    updates,
    skipped,
    totalRows,
    relationOps,
    meta,
  };
}

// ---- Core: execute import ------------------------------------------------

export async function executeImport(
  report: ImportReport,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const total =
    report.creates.length + report.updates.length + report.relationOps.length;
  let done = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let relationsUpserted = 0;
  let relationsDeleted = 0;
  let relationsFailed = 0;
  const failedDetails: { row: number; message: string }[] = [];

  // Map old id (from file) → new id (from server) for parent_id resolution
  const idMapping = new Map<string, string>();
  // Map row's own path key → server id, so subsequent rows can resolve their
  // parent path against newly-created file rows.
  const pathToId = new Map<string, string>();

  // Topologically sort creates so parents are created before children
  const sortedCreates = topoSortCreates(report.creates);

  // Creates
  for (const row of sortedCreates) {
    try {
      const payload = { ...row.data };

      // Resolve parent reference, in priority order:
      //   1. parent_path that points at another file row → use freshly-created id
      //   2. legacy parent_id mapped via idMapping
      // Existing-card parent paths were already resolved into payload.parent_id
      // during validation, so they pass through unchanged.
      if (row.parentPathKey && pathToId.has(row.parentPathKey)) {
        payload.parent_id = pathToId.get(row.parentPathKey);
      } else if (row.parentId && idMapping.has(row.parentId)) {
        payload.parent_id = idMapping.get(row.parentId);
      }

      const result = await api.post<{ id: string }>("/cards", payload);

      // Track the mapping from file id → server id
      if (row.id && result.id) {
        idMapping.set(row.id, result.id);
      }
      // Track the mapping from own path key → server id for child rows
      if (row.ownPathKey && result.id) {
        pathToId.set(row.ownPathKey, result.id);
      }
      // Assign tags if any were resolved for this row
      if (row.tagIds && row.tagIds.length > 0 && result.id) {
        try {
          await api.post(`/cards/${result.id}/tags`, row.tagIds);
        } catch {
          // Non-fatal: card was created; surface no extra failure here.
        }
      }
      created++;
    } catch (e) {
      failed++;
      failedDetails.push({
        row: row.rowIndex,
        message: e instanceof Error ? e.message : t("import.errors.unknown"),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  // Updates
  for (const row of report.updates) {
    try {
      const { patch } = buildPatch(row.data, row.existing!);
      let didSomething = false;
      if (Object.keys(patch).length > 0) {
        await api.patch(`/cards/${row.id}`, patch);
        didSomething = true;
      }
      // Sync tags when the row supplied a Tags column
      if (row.tagIds !== undefined && row.existing) {
        const oldIds = new Set((row.existing.tags || []).map((tg) => tg.id));
        const newIds = new Set(row.tagIds);
        const toAdd = [...newIds].filter((id) => !oldIds.has(id));
        const toRemove = [...oldIds].filter((id) => !newIds.has(id));
        if (toAdd.length > 0) {
          await api.post(`/cards/${row.id}/tags`, toAdd);
          didSomething = true;
        }
        for (const id of toRemove) {
          await api.delete(`/cards/${row.id}/tags/${id}`);
          didSomething = true;
        }
      }
      if (didSomething) updated++;
    } catch (e) {
      failed++;
      failedDetails.push({
        row: row.rowIndex,
        message: e instanceof Error ? e.message : t("import.errors.unknown"),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  // ----- Relation operations --------------------------------------------
  // The legacy single-sheet entrypoint never queues relation ops, so this
  // loop is a no-op for those callers. New `executeMultiSheetImport` does
  // its own bulk relation apply (chunked) so we don't double-up here.
  for (const op of report.relationOps) {
    try {
      const payload: {
        action: "upsert" | "delete";
        type: string;
        source: { id?: string; type?: string; name?: string; parent_path?: string[] };
        target: { id?: string; type?: string; name?: string; parent_path?: string[] };
        attributes?: Record<string, unknown>;
        description?: string;
      } = {
        action: op.action,
        type: op.relationType,
        source: refHandleToPayload(op.sourceRef),
        target: refHandleToPayload(op.targetRef),
        attributes: op.attributes,
        description: op.description,
      };
      const resp = await api.post<{
        results: { status: "upserted" | "deleted" | "noop" | "failed"; error?: string }[];
      }>("/relations/bulk", { operations: [{ row_index: op.rowIndex, ...payload }] });
      const r = resp.results[0];
      if (r.status === "upserted") relationsUpserted++;
      else if (r.status === "deleted") relationsDeleted++;
      else if (r.status === "failed") {
        relationsFailed++;
        failedDetails.push({ row: op.rowIndex, message: r.error ?? t("import.errors.unknown") });
      }
    } catch (e) {
      relationsFailed++;
      failedDetails.push({
        row: op.rowIndex,
        message: e instanceof Error ? e.message : t("import.errors.unknown"),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  return {
    created,
    updated,
    failed,
    relationsUpserted,
    relationsDeleted,
    relationsFailed,
    failedDetails,
  };
}

function refHandleToPayload(
  handle: CardRefHandle,
): { id?: string; type?: string; name?: string; parent_path?: string[] } {
  if (handle.kind === "id") return { id: handle.id };
  // pathKey form: `type|seg1/seg2/.../name` (lowercased). We can't recover
  // the casing, but the resolver is case-insensitive so that's fine.
  const segs = handle.pathKey.split("|")[1]?.split("/") ?? [];
  if (segs.length === 0) return { type: handle.type };
  const name = segs[segs.length - 1];
  const parentPath = segs.slice(0, -1);
  return { type: handle.type, name, parent_path: parentPath };
}

/**
 * Multi-sheet executor. Uses the backend bulk endpoints so a 500-row
 * workbook doesn't fire 500 HTTP requests. Cards are created (and committed)
 * first, then relations are applied against the now-persisted cards — so a
 * relation failure can never leave a card half-created, and same-batch
 * targets resolve via the server-assigned UUIDs captured from bulk-create.
 *
 * Phases:
 *   1. `POST /cards/bulk-create` (chunked) for new cards. Captures the
 *      server-assigned UUID for each row's own path key so relation ops
 *      that referenced a same-batch row can swap their pathKey for a real id.
 *   2. Per-row `PATCH /cards/{id}` for updates — kept per-row because
 *      the patch logic still computes a diff against the existing card
 *      and applying that as a bulk would need a richer endpoint. Tags
 *      stay per-row for the same reason.
 *   3. `POST /relations/bulk` (chunked) for the queued relation operations.
 */
export async function executeMultiSheetImport(
  report: ImportReport,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const total =
    report.creates.length + report.updates.length + report.relationOps.length;
  let done = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let relationsUpserted = 0;
  let relationsDeleted = 0;
  let relationsFailed = 0;
  const failedDetails: { row: number; message: string }[] = [];

  // Record a failure using the per-sheet visible row number for `row` and
  // prefixing the sheet name into the message (mirroring how validation
  // errors are formatted), so the user sees "Provider: ..." rather than a
  // bare — and now workbook-global — correlation id.
  const pushFailure = (
    src: { rowIndex: number; sheet?: string },
    message: string,
  ) => {
    failedDetails.push({
      row: src.rowIndex,
      message: src.sheet ? `${src.sheet}: ${message}` : message,
    });
  };

  // pathKey → server uuid, populated as bulk-create finishes.
  const pathToId = new Map<string, string>();
  // file row's `parsed.id` (legacy parent_id form) → server id
  const idMapping = new Map<string, string>();

  // Build the bulk-create payload from the topo-sorted creates so that
  // parents land before children inside the chunk.
  const sortedCreates = topoSortCreates(report.creates);
  const CHUNK = 200;
  for (let i = 0; i < sortedCreates.length; i += CHUNK) {
    const chunk = sortedCreates.slice(i, i + CHUNK);
    const body = {
      cards: chunk.map((row) => {
        const d = row.data as Record<string, unknown>;
        const parentSegments = row.parentPath;
        const lastSeg = parentSegments && parentSegments.length > 0
          ? parentSegments[parentSegments.length - 1]
          : undefined;
        const parentPath = parentSegments && parentSegments.length > 1
          ? parentSegments.slice(0, -1)
          : parentSegments && parentSegments.length === 1
            ? []
            : undefined;
        // Prefer resolved parent ids (parent referenced an existing card)
        // over name-based refs. Otherwise hand a name+path to the server.
        const parentId = (d.parent_id as string | undefined)
          ?? (row.parentId && idMapping.has(row.parentId)
            ? idMapping.get(row.parentId)
            : undefined);
        return {
          row_index: row.wireRow ?? row.rowIndex,
          type: row.type,
          name: (d.name as string) ?? "",
          subtype: d.subtype as string | undefined,
          description: d.description as string | undefined,
          parent_id: parentId,
          parent_name: parentId ? undefined : lastSeg,
          parent_path: parentId ? undefined : parentPath,
          lifecycle: d.lifecycle as Record<string, unknown> | undefined,
          attributes: d.attributes as Record<string, unknown> | undefined,
          external_id: d.external_id as string | undefined,
          alias: d.alias as string | undefined,
        };
      }),
    };
    try {
      const resp = await api.post<{
        results: { row_index: number; status: "created" | "failed"; id?: string; error?: string }[];
      }>("/cards/bulk-create", body);
      for (const r of resp.results) {
        const row = chunk.find((c) => (c.wireRow ?? c.rowIndex) === r.row_index);
        if (!row) continue;
        if (r.status === "created" && r.id) {
          created++;
          if (row.id) idMapping.set(row.id, r.id);
          if (row.ownPathKey) pathToId.set(row.ownPathKey, r.id);
          if (row.tagIds && row.tagIds.length > 0) {
            try {
              await api.post(`/cards/${r.id}/tags`, row.tagIds);
            } catch {
              // Non-fatal — same behaviour as legacy importer.
            }
          }
        } else {
          failed++;
          pushFailure(row, r.error ?? t("import.errors.unknown"));
        }
      }
    } catch (e) {
      // Whole-chunk failure — count everything as failed so the user sees the totals.
      for (const row of chunk) {
        failed++;
        pushFailure(row, e instanceof Error ? e.message : t("import.errors.unknown"));
      }
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  // Per-row updates (existing endpoint). Tags follow the same logic as the
  // legacy importer.
  for (const row of report.updates) {
    try {
      const { patch } = buildPatch(row.data, row.existing!);
      let didSomething = false;
      if (Object.keys(patch).length > 0) {
        await api.patch(`/cards/${row.id}`, patch);
        didSomething = true;
      }
      if (row.tagIds !== undefined && row.existing) {
        const oldIds = new Set((row.existing.tags || []).map((tg) => tg.id));
        const newIds = new Set(row.tagIds);
        const toAdd = [...newIds].filter((id) => !oldIds.has(id));
        const toRemove = [...oldIds].filter((id) => !newIds.has(id));
        if (toAdd.length > 0) {
          await api.post(`/cards/${row.id}/tags`, toAdd);
          didSomething = true;
        }
        for (const id of toRemove) {
          await api.delete(`/cards/${row.id}/tags/${id}`);
          didSomething = true;
        }
      }
      if (didSomething) updated++;
    } catch (e) {
      failed++;
      pushFailure(row, e instanceof Error ? e.message : t("import.errors.unknown"));
    }
    done++;
    onProgress?.(done, total);
  }

  // Relation ops in chunks of 200. We rewrite pathKey refs into name+path
  // refs (or, when the bulk-create has already assigned an id, into the
  // resolved UUID directly) just before sending.
  function materialize(handle: CardRefHandle): {
    id?: string;
    type?: string;
    name?: string;
    parent_path?: string[];
  } {
    if (handle.kind === "id") return { id: handle.id };
    const resolved = pathToId.get(handle.pathKey);
    if (resolved) return { id: resolved };
    return refHandleToPayload(handle);
  }

  for (let i = 0; i < report.relationOps.length; i += CHUNK) {
    const chunk = report.relationOps.slice(i, i + CHUNK);
    // Correlate the response's echoed `row_index` back to the exact op so a
    // failure is attributed to the right sheet + visible row, even when two
    // sheets share a per-sheet row number.
    const opByWire = new Map<number, RelationOp>();
    for (const op of chunk) opByWire.set(op.wireRow ?? op.rowIndex, op);
    const body = {
      operations: chunk.map((op) => ({
        row_index: op.wireRow ?? op.rowIndex,
        action: op.action,
        type: op.relationType,
        source: materialize(op.sourceRef),
        target: materialize(op.targetRef),
        attributes: op.attributes,
        description: op.description,
      })),
    };
    try {
      const resp = await api.post<{
        results: { row_index: number; status: string; error?: string }[];
      }>("/relations/bulk", body);
      for (const r of resp.results) {
        if (r.status === "upserted") relationsUpserted++;
        else if (r.status === "deleted") relationsDeleted++;
        else if (r.status === "failed") {
          relationsFailed++;
          const op = opByWire.get(r.row_index);
          pushFailure(op ?? { rowIndex: r.row_index }, r.error ?? t("import.errors.unknown"));
        }
      }
    } catch (e) {
      for (const op of chunk) {
        relationsFailed++;
        pushFailure(op, e instanceof Error ? e.message : t("import.errors.unknown"));
      }
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  return {
    created,
    updated,
    failed,
    relationsUpserted,
    relationsDeleted,
    relationsFailed,
    failedDetails,
  };
}
