# Excel Export/Import Plan for Inventory

## Overview
Add Excel (XLSX) export and import to the Inventory page using SheetJS (frontend-only approach — no backend changes needed for the Excel format). The import flow includes a simulation/validation step that produces a detailed error report before any data is written.

---

## Architecture Decision: Frontend-only SheetJS

SheetJS (`xlsx` npm package) handles all Excel parsing/generation in the browser. The backend already has `POST /fact-sheets` (create) and `PATCH /fact-sheets/{id}` (update) endpoints, plus `GET /fact-sheets` for loading existing data. No new backend endpoints are needed.

---

## Step 1 — Install SheetJS

```
npm install xlsx
```

---

## Step 2 — Export Feature (`frontend/src/features/inventory/excelExport.ts`)

Utility module with an `exportToExcel(factSheets, typeConfig, types)` function:

### Export columns (in order):
| Column | Source | Notes |
|--------|--------|-------|
| `id` | `fs.id` | The GUID — used as matching key on re-import |
| `type` | `fs.type` | Type key (e.g. "Application") |
| `name` | `fs.name` | Required |
| `description` | `fs.description` | Optional |
| `subtype` | `fs.subtype` | Optional |
| `external_id` | `fs.external_id` | Optional |
| `alias` | `fs.alias` | Optional |
| `quality_seal` | `fs.quality_seal` | DRAFT/APPROVED/BROKEN/REJECTED |
| `lifecycle_plan` | `fs.lifecycle.plan` | Flattened lifecycle dates |
| `lifecycle_phaseIn` | `fs.lifecycle.phaseIn` | |
| `lifecycle_active` | `fs.lifecycle.active` | |
| `lifecycle_phaseOut` | `fs.lifecycle.phaseOut` | |
| `lifecycle_endOfLife` | `fs.lifecycle.endOfLife` | |
| `attr_<key>` | `fs.attributes[key]` | One column per field in the type's fields_schema (only when single type selected) |

### Behavior:
- Uses `XLSX.utils.json_to_sheet` + `XLSX.writeFile`
- File name: `{typeLabel}_export_{date}.xlsx` or `fact_sheets_export_{date}.xlsx`
- The `id` column is always first — this is the GUID that drives import matching

---

## Step 3 — Import Feature (`frontend/src/features/inventory/excelImport.ts`)

### 3a. Parse & Validate (simulation)

Function: `validateImport(workbook, existingFactSheets, typeConfig, allTypes) → ImportReport`

**Validation rules:**

| # | Rule | Error message |
|---|------|---------------|
| 1 | `name` column must exist | "Missing required column: name" |
| 2 | Each row must have a non-empty `name` | "Row {n}: name is required" |
| 3 | `type` column must exist (or a single type must be pre-selected) | "Missing required column: type (or select a type filter first)" |
| 4 | Each row must have a valid `type` matching a known FactSheetType key | "Row {n}: unknown type '{value}'" |
| 5 | If `id` is present and non-empty, it must be a valid UUID format | "Row {n}: invalid id format '{value}'" |
| 6 | If `id` is present and non-empty, it must match an existing fact sheet | "Row {n}: no existing fact sheet with id '{value}'" |
| 7 | If `id` matches an existing fact sheet, the `type` must match | "Row {n}: type mismatch — file has '{fileType}', existing has '{existingType}'" |
| 8 | Duplicate `id` values within the file | "Row {n}: duplicate id '{value}' (also on row {other})" |
| 9 | `quality_seal` if present must be one of DRAFT/APPROVED/BROKEN/REJECTED | "Row {n}: invalid quality_seal '{value}'" |
| 10 | `single_select` attribute values must match a known option key | "Row {n}: invalid value '{value}' for field '{label}' (valid: {options})" |
| 11 | `number` attribute values must be numeric | "Row {n}: '{label}' expects a number, got '{value}'" |
| 12 | `boolean` attribute values must be true/false/yes/no/1/0 | "Row {n}: '{label}' expects true/false, got '{value}'" |
| 13 | `date` attribute or lifecycle values must be valid dates (YYYY-MM-DD) | "Row {n}: '{label}' expects a date (YYYY-MM-DD), got '{value}'" |
| 14 | `required` attribute fields must not be empty for creates | "Row {n}: required field '{label}' is empty" |

**ImportReport structure:**
```ts
interface ImportReport {
  errors: ImportError[];        // blocking errors
  warnings: ImportWarning[];    // non-blocking (e.g. "column 'foo' ignored — not recognized")
  creates: ParsedRow[];         // rows without id → will create
  updates: ParsedRow[];         // rows with matching id → will update
  skipped: number;              // empty rows skipped
  totalRows: number;
}
```

### 3b. Execute Import

Function: `executeImport(report, apiClient) → ImportResult`

- For each `creates` row: `POST /fact-sheets` with the parsed data
- For each `updates` row: `PATCH /fact-sheets/{id}` with changed fields
- Runs sequentially to avoid overwhelming the backend
- Returns success/failure count

---

## Step 4 — Import Dialog UI (`frontend/src/features/inventory/ImportDialog.tsx`)

Multi-step dialog:

### Step 1: File Upload
- Drag-and-drop zone or file picker (accept `.xlsx`, `.xls`)
- Shows file name and size after selection

### Step 2: Validation Report
- Parse file with SheetJS, run validation
- Show summary: "{N} to create, {M} to update, {K} errors"
- If errors: show scrollable error list with row numbers and messages
- If warnings: show collapsible warning list
- "Import" button disabled when errors > 0
- "Cancel" and "Import" buttons

### Step 3: Progress & Result
- Progress bar during import
- Final summary: "{N} created, {M} updated, {K} failed"
- "Done" button closes dialog and refreshes inventory

---

## Step 5 — Wire into InventoryPage

Add to the toolbar (next to "Grid Edit" and "Create" buttons):
- **Export** button: calls `exportToExcel` with current `filteredData` and `typeConfig`
- **Import** button: opens the `ImportDialog`

Both buttons in the header bar, between "Grid Edit" and "Create".

---

## File changes summary

| File | Action |
|------|--------|
| `frontend/package.json` | Add `xlsx` dependency |
| `frontend/src/features/inventory/excelExport.ts` | New — export logic |
| `frontend/src/features/inventory/excelImport.ts` | New — parse, validate, execute import |
| `frontend/src/features/inventory/ImportDialog.tsx` | New — multi-step import dialog component |
| `frontend/src/features/inventory/InventoryPage.tsx` | Add Export + Import buttons to toolbar |

No backend changes needed — SheetJS runs in the browser, and the existing REST API handles create/update.
