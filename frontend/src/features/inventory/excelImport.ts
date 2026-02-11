import * as XLSX from "xlsx";
import type { FactSheet, FactSheetType, FieldDef } from "@/types";
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
  /** Original fact sheet when updating an existing record */
  existing?: FactSheet;
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
  allTypes: FactSheetType[],
): FieldDef[] {
  const t = allTypes.find((x) => x.key === type);
  if (!t) return [];
  return t.fields_schema.flatMap((s) => s.fields);
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
  existingFactSheets: FactSheet[],
  allTypes: FactSheetType[],
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
    "id", "type", "name", "description", "subtype", "external_id", "alias",
    "quality_seal",
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
    const hl = h.toLowerCase();
    if (!knownCoreCols.has(hl) && !allAttrKeys.has(h) && !h.startsWith("attr_")) {
      warnings.push({ column: h, message: `Column "${h}" is not recognised and will be ignored` });
    }
  }

  // Index existing fact sheets by id for fast lookup
  const existingById = new Map<string, FactSheet>();
  for (const fs of existingFactSheets) {
    existingById.set(fs.id, fs);
  }

  // Track seen IDs to detect duplicates within the file
  const seenIds = new Map<string, number>(); // id → first row number

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
    const externalId = str(raw["external_id"]);
    const alias = str(raw["alias"] ?? raw["Alias"]);
    const qualitySeal = str(raw["quality_seal"]).toUpperCase();

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
    let matchedExisting: FactSheet | undefined;
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
          message: `Row ${rowNum}: no existing fact sheet with id "${id}"`,
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

    // Rule 9: quality_seal validation
    if (qualitySeal && !VALID_SEALS.has(qualitySeal)) {
      errors.push({
        row: rowNum,
        column: "quality_seal",
        message: `Row ${rowNum}: invalid quality_seal "${qualitySeal}" (valid: DRAFT, APPROVED, BROKEN, REJECTED)`,
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
    if (externalId) data.external_id = externalId;
    if (alias) data.alias = alias;
    if (Object.keys(lifecycle).length > 0) data.lifecycle = lifecycle;
    if (Object.keys(attributes).length > 0) data.attributes = attributes;

    const parsed: ParsedRow = { rowIndex: rowNum, type, data };

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

  // Creates
  for (const row of report.creates) {
    try {
      await api.post("/fact-sheets", row.data);
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
        await api.patch(`/fact-sheets/${row.id}`, patch);
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
