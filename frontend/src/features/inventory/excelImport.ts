import * as XLSX from "xlsx";
import type { Card, CardType, FieldDef } from "@/types";
import { api } from "@/api/client";

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
  rowIndex: number;
  id?: string;
  type: string;
  data: Record<string, unknown>;
  /** Raw parent_id from the file (UUID of existing or of another row in the file) */
  parentId?: string;
  /** Original card when updating an existing record */
  existing?: Card;
}

export interface ImportReport {
  errors: ImportError[];
  warnings: ImportWarning[];
  creates: ParsedRow[];
  updates: ParsedRow[];
  skipped: number;
  totalRows: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  failedDetails: { row: number; message: string }[];
}

// ---- Helpers -------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SEALS = new Set(["DRAFT", "APPROVED", "BROKEN", "REJECTED"]);
const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
const TRUTHY = new Set(["true", "yes", "1"]);
const FALSY = new Set(["false", "no", "0"]);

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function fieldDefsForType(
  type: string,
  allTypes: CardType[],
): FieldDef[] {
  const t = allTypes.find((x) => x.key === type);
  if (!t) return [];
  return t.fields_schema.flatMap((s) => s.fields);
}

/**
 * Topologically sort rows so that parents come before children.
 * Rows whose parentId references another row's id are placed after that row.
 * Rows with no parent dependency come first.
 */
function topoSortCreates(rows: ParsedRow[]): ParsedRow[] {
  // Build a set of ids available in the creates list
  const createIds = new Set<string>();
  for (const r of rows) {
    if (r.id) createIds.add(r.id);
  }

  // Index by id for quick lookup
  const byId = new Map<string, ParsedRow>();
  for (const r of rows) {
    if (r.id) byId.set(r.id, r);
  }

  const sorted: ParsedRow[] = [];
  const visited = new Set<string | number>();

  function visit(row: ParsedRow) {
    const key = row.id ?? row.rowIndex;
    if (visited.has(key)) return;
    visited.add(key);

    // If this row's parent is also being created, visit parent first
    if (row.parentId && createIds.has(row.parentId)) {
      const parent = byId.get(row.parentId);
      if (parent) visit(parent);
    }

    sorted.push(row);
  }

  for (const row of rows) visit(row);
  return sorted;
}

// ---- Core: parse workbook ------------------------------------------------

export function parseWorkbook(file: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(file, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

// ---- Core: validate ------------------------------------------------------

export function validateImport(
  rows: Record<string, unknown>[],
  existingCards: Card[],
  allTypes: CardType[],
  preSelectedType?: string,
): ImportReport {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const creates: ParsedRow[] = [];
  const updates: ParsedRow[] = [];
  let skipped = 0;

  if (rows.length === 0) {
    errors.push({ row: 0, message: "The file contains no data rows" });
    return { errors, warnings, creates, updates, skipped, totalRows: 0 };
  }

  // Check for required columns
  const headers = Object.keys(rows[0]);
  const hasNameCol = headers.some((h) => h.toLowerCase() === "name");
  const hasTypeCol = headers.some((h) => h.toLowerCase() === "type");

  if (!hasNameCol) {
    errors.push({ row: 0, column: "name", message: "Missing required column: name" });
  }
  if (!hasTypeCol && !preSelectedType) {
    errors.push({
      row: 0,
      column: "type",
      message: "Missing required column: type (or select a single type filter before importing)",
    });
  }

  // If structural errors already, return early
  if (errors.length > 0) {
    return { errors, warnings, creates, updates, skipped, totalRows: rows.length };
  }

  // Warn about unrecognised columns
  const knownCoreCols = new Set([
    "id", "type", "name", "description", "subtype", "parent_id",
    "external_id", "alias", "approval_status",
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
    if (!knownCoreCols.has(h) && !knownCoreCols.has(h.toLowerCase()) && !allAttrKeys.has(h) && !h.startsWith("attr_")) {
      warnings.push({ column: h, message: `Column "${h}" is not recognised and will be ignored` });
    }
  }

  // Index existing cards by id for fast lookup
  const existingById = new Map<string, Card>();
  for (const card of existingCards) {
    existingById.set(card.id, card);
  }

  // Track seen IDs to detect duplicates within the file
  const seenIds = new Map<string, number>(); // id → first row number

  // Collect all ids present in the file (for parent_id cross-referencing)
  const fileIds = new Set<string>();
  for (const raw of rows) {
    const id = str(raw["id"] ?? raw["Id"] ?? raw["ID"]);
    if (id && UUID_RE.test(id)) fileIds.add(id);
  }

  const typeKeys = new Set(allTypes.filter((t) => !t.is_hidden).map((t) => t.key));

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
    const parentId = str(raw["parent_id"]);
    const externalId = str(raw["external_id"]);
    const alias = str(raw["alias"] ?? raw["Alias"]);
    const approvalStatus = str(raw["approval_status"]).toUpperCase();

    // Rule 2: name required
    if (!name) {
      errors.push({ row: rowNum, column: "name", message: `Row ${rowNum}: name is required` });
      continue;
    }

    // Rule 4: type must be valid
    if (!typeKeys.has(type)) {
      errors.push({
        row: rowNum,
        column: "type",
        message: `Row ${rowNum}: unknown type "${type}"`,
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
          message: `Row ${rowNum}: invalid id format "${id}"`,
        });
        continue;
      }

      // Rule 8: duplicate id in file
      const prevRow = seenIds.get(id);
      if (prevRow !== undefined) {
        errors.push({
          row: rowNum,
          column: "id",
          message: `Row ${rowNum}: duplicate id "${id}" (also on row ${prevRow})`,
        });
        continue;
      }
      seenIds.set(id, rowNum);

      // Rule 6: id must match existing
      matchedExisting = existingById.get(id);
      if (!matchedExisting) {
        errors.push({
          row: rowNum,
          column: "id",
          message: `Row ${rowNum}: no existing card with id "${id}"`,
        });
        continue;
      }

      // Rule 7: type must match
      if (matchedExisting.type !== type) {
        errors.push({
          row: rowNum,
          column: "type",
          message: `Row ${rowNum}: type mismatch — file has "${type}", existing has "${matchedExisting.type}"`,
        });
        continue;
      }
    }

    // Validate parent_id if provided
    if (parentId) {
      if (!UUID_RE.test(parentId)) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: `Row ${rowNum}: invalid parent_id format "${parentId}"`,
        });
        continue;
      }
      // parent must exist in DB or be another row in the file
      if (!existingById.has(parentId) && !fileIds.has(parentId)) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: `Row ${rowNum}: parent_id "${parentId}" not found — must reference an existing card or another row in this file`,
        });
        continue;
      }
      // parent must not be self
      if (parentId === id) {
        errors.push({
          row: rowNum,
          column: "parent_id",
          message: `Row ${rowNum}: parent_id cannot reference itself`,
        });
        continue;
      }
    }

    // Rule 9: approval_status validation
    if (approvalStatus && !VALID_SEALS.has(approvalStatus)) {
      errors.push({
        row: rowNum,
        column: "approval_status",
        message: `Row ${rowNum}: invalid approval_status "${approvalStatus}" (valid: DRAFT, APPROVED, BROKEN, REJECTED)`,
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
            message: `Row ${rowNum}: lifecycle_${phase} expects a date (YYYY-MM-DD), got "${val}"`,
          });
        } else {
          lifecycle[phase] = val;
        }
      }
    }

    // Build attributes object, validating against field defs
    const fieldDefs = fieldDefsForType(type, allTypes);
    const attributes: Record<string, unknown> = {};
    let rowHasAttrError = false;

    for (const field of fieldDefs) {
      const colKey = `attr_${field.key}`;
      const rawVal = raw[colKey];
      const val = str(rawVal);

      if (!val) {
        // Rule 14: required fields on creates
        if (field.required && !id) {
          errors.push({
            row: rowNum,
            column: colKey,
            message: `Row ${rowNum}: required field "${field.label}" is empty`,
          });
          rowHasAttrError = true;
        }
        continue;
      }

      // Validate by field type
      switch (field.type) {
        case "number": {
          // Rule 11
          const num = Number(val);
          if (isNaN(num)) {
            errors.push({
              row: rowNum,
              column: colKey,
              message: `Row ${rowNum}: "${field.label}" expects a number, got "${val}"`,
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
              message: `Row ${rowNum}: "${field.label}" expects true/false, got "${val}"`,
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
              message: `Row ${rowNum}: "${field.label}" expects a date (YYYY-MM-DD), got "${val}"`,
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
                message: `Row ${rowNum}: invalid value "${val}" for field "${field.label}" (valid: ${validKeys.join(", ")})`,
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
                  message: `Row ${rowNum}: invalid value "${part}" for field "${field.label}" (valid: ${validKeys.join(", ")})`,
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

    const parsed: ParsedRow = { rowIndex: rowNum, type, data, parentId: parentId || undefined };

    if (id && matchedExisting) {
      parsed.id = id;
      parsed.existing = matchedExisting;
      updates.push(parsed);
    } else {
      creates.push(parsed);
    }
  }

  return { errors, warnings, creates, updates, skipped, totalRows: rows.length };
}

// ---- Core: execute import ------------------------------------------------

export async function executeImport(
  report: ImportReport,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const total = report.creates.length + report.updates.length;
  let done = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  const failedDetails: { row: number; message: string }[] = [];

  // Map old id (from file) → new id (from server) for parent_id resolution
  const idMapping = new Map<string, string>();

  // Topologically sort creates so parents are created before children
  const sortedCreates = topoSortCreates(report.creates);

  // Creates
  for (const row of sortedCreates) {
    try {
      const payload = { ...row.data };

      // Resolve parent_id: if the parent was just created, use its new id
      if (row.parentId && idMapping.has(row.parentId)) {
        payload.parent_id = idMapping.get(row.parentId);
      }

      const result = await api.post<{ id: string }>("/cards", payload);

      // Track the mapping from file id → server id
      if (row.id && result.id) {
        idMapping.set(row.id, result.id);
      }
      created++;
    } catch (e) {
      failed++;
      failedDetails.push({
        row: row.rowIndex,
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
    done++;
    onProgress?.(done, total);
  }

  // Updates
  for (const row of report.updates) {
    try {
      // Only send changed fields
      const patch: Record<string, unknown> = {};
      const d = row.data;
      const ex = row.existing!;

      if (d.name && d.name !== ex.name) patch.name = d.name;
      if (d.description !== undefined && d.description !== (ex.description ?? ""))
        patch.description = d.description || null;
      if (d.subtype !== undefined && d.subtype !== (ex.subtype ?? ""))
        patch.subtype = d.subtype || null;
      if (d.parent_id !== undefined && d.parent_id !== (ex.parent_id ?? ""))
        patch.parent_id = d.parent_id || null;
      if (d.external_id !== undefined && d.external_id !== (ex.external_id ?? ""))
        patch.external_id = d.external_id || null;
      if (d.alias !== undefined && d.alias !== (ex.alias ?? ""))
        patch.alias = d.alias || null;
      if (d.lifecycle) patch.lifecycle = d.lifecycle;
      if (d.attributes) {
        // Merge with existing attributes
        patch.attributes = { ...(ex.attributes || {}), ...(d.attributes as Record<string, unknown>) };
      }

      if (Object.keys(patch).length > 0) {
        await api.patch(`/cards/${row.id}`, patch);
      }
      updated++;
    } catch (e) {
      failed++;
      failedDetails.push({
        row: row.rowIndex,
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
    done++;
    onProgress?.(done, total);
  }

  return { created, updated, failed, failedDetails };
}
