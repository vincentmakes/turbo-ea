/**
 * The inventory's Excel import dialog, driven with real workbooks: a file is
 * built with the vendored `xlsx`, handed to the hidden file input (or dropped
 * on the zone), parsed and validated by the real `excelImport` pipeline
 * against the kit's fixed inventory, and then applied through the scripted API
 * client. The four steps — upload, report, progress, done — are each pinned
 * with the strings the user reads and the calls the server receives.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import * as XLSX from "xlsx";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useCalculatedFields", () =>
  import("@/test/hooks").then((m) => m.useCalculatedFieldsModule()),
);

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { renderWithProviders, userWith } from "@/test/render";
import { CARDS, CARD_IDS, CARD_TYPES, RELATION_TYPES, TAG_GROUPS, USERS } from "@/test/fixtures/metamodel";
import type { User } from "@/types";
import ImportDialog from "./ImportDialog";

type Props = React.ComponentProps<typeof ImportDialog>;
type Row = Record<string, unknown>;

/* ------------------------------------------------------------------------- */
/*  Workbook + file helpers                                                    */
/* ------------------------------------------------------------------------- */

/** A workbook with one sheet per entry (sheet name → rows) plus an optional `_Meta` sheet. */
function workbook(sheets: Record<string, Row[]>, meta?: Record<string, string>): File {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  if (meta) {
    const rows = Object.entries(meta).map(([key, value]) => ({ key, value }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "_Meta");
  }
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "cards.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const app = (over: Row = {}): Row => ({
  type: "Application",
  name: "Billing Portal",
  attr_businessCriticality: "businessOperational",
  ...over,
});
const erp = (over: Row = {}): Row => ({
  id: CARD_IDS.erp,
  type: "Application",
  name: "ERP Core",
  ...over,
});

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const upload = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const importButton = () => screen.getByRole("button", { name: /Import \d+ row\(s\)/ });

/* ------------------------------------------------------------------------- */
/*  API scripting                                                             */
/* ------------------------------------------------------------------------- */

/** `POST /cards/resolve-refs` over the kit inventory: a bare name resolves when unique within its type. */
function resolveRefs(_path: string, body: unknown) {
  const refs = (body as { refs: { row: number; column: string; type: string; ref: string }[] }).refs;
  return {
    results: refs.map(({ row, column, type, ref }) => {
      const hits = CARDS.filter(
        (c) => c.type === type && c.name.toLowerCase() === ref.trim().toLowerCase(),
      );
      if (hits.length === 1) return { row, column, status: "resolved", id: hits[0].id };
      if (hits.length > 1) {
        return {
          row,
          column,
          status: "ambiguous",
          candidates: hits.map((c) => ({ id: c.id, path: c.name })),
        };
      }
      return { row, column, status: "missing" };
    }),
  };
}

type BulkCreateBody = { cards: { row_index: number; name: string }[] };
type BulkRelBody = { operations: { row_index: number; action: string }[] };

function scriptDefaults() {
  mockApi.on("get", "/relations?types=*", []);
  mockApi.on("get", "/users", USERS);
  mockApi.on("get", "/stakeholder-roles?type_key=*", []);
  mockApi.on("post", "/cards/resolve-refs", resolveRefs);
  mockApi.on("post", "/cards/bulk-create", (_p, body) => ({
    results: (body as BulkCreateBody).cards.map((c, i) => ({
      row_index: c.row_index,
      status: "created",
      id: `00000000-0000-4000-8000-00000000ff${String(i).padStart(2, "0")}`,
    })),
  }));
  mockApi.on("patch", "/cards/*", {});
  mockApi.on("post", "/relations/bulk", (_p, body) => ({
    results: (body as BulkRelBody).operations.map((o) => ({
      row_index: o.row_index,
      status: o.action === "delete" ? "deleted" : "upserted",
    })),
  }));
}

function renderDialog(overrides: Partial<Props> = {}, user?: User) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const result = renderWithProviders(
    <ImportDialog
      open
      onClose={onClose}
      onComplete={onComplete}
      existingCards={CARDS}
      allTypes={CARD_TYPES}
      relationTypes={RELATION_TYPES}
      tagGroups={TAG_GROUPS}
      {...overrides}
    />,
    { user },
  );
  return { ...result, onClose, onComplete };
}

/** Upload `file` and wait for the report step. */
async function uploadAndReport(file: File) {
  upload(file);
  expect(await screen.findByText(/File: cards\.xlsx/)).toBeInTheDocument();
}

beforeAll(() => {
  // jsdom's Blob has no `arrayBuffer()`; the dialog reads the file through it.
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  scriptDefaults();
});

/* ------------------------------------------------------------------------- */
/*  Tests                                                                     */
/* ------------------------------------------------------------------------- */

describe("ImportDialog — upload step", () => {
  it("opens on the drop zone and Cancel closes without completing", async () => {
    const { user, onClose, onComplete } = renderDialog();
    expect(screen.getByText("Import Cards")).toBeInTheDocument();
    expect(screen.getByText("Drop an Excel file here or click to browse")).toBeInTheDocument();
    expect(screen.getByText(/Export your current inventory first/)).toBeInTheDocument();
    expect(fileInput()).toHaveAttribute("accept", ".xlsx,.xls");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("opens the file picker when the zone is clicked", async () => {
    const { user } = renderDialog();
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    await user.click(screen.getByText("Drop an Excel file here or click to browse"));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("reports a file it cannot read", async () => {
    renderDialog();
    const broken = new File([new Uint8Array([1, 2, 3])], "broken.xlsx");
    Object.defineProperty(broken, "arrayBuffer", {
      value: () => Promise.reject(new Error("unreadable")),
    });
    upload(broken);
    expect(
      await screen.findByText("Failed to parse the file. Make sure it is a valid .xlsx or .xls file."),
    ).toBeInTheDocument();
    expect(screen.getByText("broken.xlsx")).toBeInTheDocument();
  });

  it("refuses a workbook holding a type this role may not create", async () => {
    const member = userWith("inventory.view", "inventory.create");
    member.type_permissions = { Application: { "inventory.create": false } };
    renderDialog({}, member);
    upload(workbook({ Application: [app()] }));
    expect(
      await screen.findByText("You are not allowed to create cards of these types: Application"),
    ).toBeInTheDocument();
    // Still on the upload step: nothing was fetched for the validation.
    expect(mockApi.calls).toHaveLength(0);
    expect(screen.getByText("cards.xlsx")).toBeInTheDocument();
  });

  it("accepts a dropped file", async () => {
    renderDialog();
    const zone = screen.getByText("Drop an Excel file here or click to browse").parentElement!;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [workbook({ Application: [app()] })] } });
    expect(await screen.findByText(/File: cards\.xlsx/)).toBeInTheDocument();
  });
});

describe("ImportDialog — report and import", () => {
  it("validates a create workbook, scopes the lookups to its types and imports it", async () => {
    const { user, onClose, onComplete } = renderDialog();
    await uploadAndReport(workbook({ Application: [app({ "rel:relAppToBC": "Finance" })] }));

    // The lookups the validation made: relations of the types touching
    // Application, the users and the per-type stakeholder roles.
    expect(mockApi.callsOf("get").map((c) => c.path)).toEqual([
      "/relations?types=relAppToITC%2CrelAppToBC%2CrelAppToApp",
      "/users",
      "/stakeholder-roles?type_key=Application",
    ]);
    expect(mockApi.callsOf("post", "/cards/resolve-refs")).toHaveLength(1);

    expect(screen.getByText("File: cards.xlsx — 1 row(s)")).toBeInTheDocument();
    expect(screen.getByText("1 to create")).toBeInTheDocument();
    expect(screen.getByText("0 to update")).toBeInTheDocument();
    expect(screen.getByText("1 relation to add")).toBeInTheDocument();
    expect(screen.getByText("Validation passed — ready to import.")).toBeInTheDocument();
    expect(screen.queryByText(/error/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Import 2 row\(s\)/ }));
    expect(await screen.findByText("Import Complete")).toBeInTheDocument();

    const created = mockApi.callsOf("post", "/cards/bulk-create")[0].body as BulkCreateBody;
    expect(created.cards).toHaveLength(1);
    expect(created.cards[0]).toMatchObject({
      type: "Application",
      name: "Billing Portal",
      attributes: { businessCriticality: "businessOperational" },
    });
    const rels = mockApi.callsOf("post", "/relations/bulk")[0].body as BulkRelBody;
    expect(rels.operations[0]).toMatchObject({
      action: "upsert",
      type: "relAppToBC",
      // The same-batch source was swapped for the id bulk-create handed out.
      source: { id: "00000000-0000-4000-8000-00000000ff00" },
      target: { id: CARD_IDS.finance },
    });

    expect(screen.getByText("1 created")).toBeInTheDocument();
    expect(screen.getByText("1 relation added")).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("previews every changed field of an update and patches the card", async () => {
    const { user } = renderDialog();
    await uploadAndReport(
      workbook({
        Application: [
          // An export-shaped row: every lifecycle column present, one of
          // them newly filled (a partial lifecycle would clear the others).
          erp({
            attr_businessCriticality: "businessCritical",
            attr_regions: "emea",
            lifecycle_plan: "2019-01-01",
            lifecycle_phaseIn: "2019-06-01",
            lifecycle_active: "2020-06-01",
            lifecycle_endOfLife: "2030-12-31",
          }),
        ],
      }),
    );
    expect(screen.getByText("0 to create")).toBeInTheDocument();
    expect(screen.getByText("1 to update")).toBeInTheDocument();

    const toggle = screen.getByText("Changes to review (1)");
    expect(toggle).toHaveTextContent("expand_more");
    await user.click(toggle);
    expect(toggle).toHaveTextContent("expand_less");

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    // The card name spans its rows; the field keys lose their storage prefix.
    expect(rows[0]).toHaveTextContent("ERP Core");
    const fields = rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(fields).toEqual([
      ["ERP Core", "lifecycle: phaseIn", "(empty)", "2019-06-01"],
      ["businessCriticality", "missionCritical", "businessCritical"],
      ["regions", "emea, amer", "emea"],
    ]);

    await user.click(screen.getByRole("button", { name: /Import 1 row\(s\)/ }));
    expect(await screen.findByText("Import Complete")).toBeInTheDocument();
    const patch = mockApi.callsOf("patch", `/cards/${CARD_IDS.erp}`)[0].body as Row;
    expect(patch).toMatchObject({
      attributes: expect.objectContaining({ businessCriticality: "businessCritical", regions: ["emea"] }),
      lifecycle: expect.objectContaining({ phaseIn: "2019-06-01" }),
    });
    expect(screen.getByText("1 updated")).toBeInTheDocument();
  });

  it("blocks the import on validation errors and lets the user start over", async () => {
    const { user } = renderDialog();
    await uploadAndReport(workbook({ Sheet1: [{ type: "Spaceship", name: "Rocket" }] }));
    expect(screen.getByText("1 error")).toBeInTheDocument();
    expect(screen.getByText("Errors (1) — fix these before importing")).toBeInTheDocument();
    // Validation messages carry the originating sheet as a prefix.
    expect(screen.getByText(/^Sheet1: Row 2: unknown type "Spaceship"$/)).toBeInTheDocument();
    expect(screen.queryByText("Validation passed — ready to import.")).not.toBeInTheDocument();
    expect(importButton()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Drop an Excel file here or click to browse")).toBeInTheDocument();
    expect(screen.queryByText(/File: cards\.xlsx/)).not.toBeInTheDocument();
  });

  it("lists warnings behind a toggle without blocking the import", async () => {
    const { user } = renderDialog();
    await uploadAndReport(workbook({ Application: [app({ bogus: "x" })] }));
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    const toggle = screen.getByText("Warnings (1)");
    expect(toggle).toHaveTextContent("expand_more");
    await user.click(toggle);
    expect(toggle).toHaveTextContent("expand_less");
    expect(
      screen.getByText(/^Application: Column "bogus" is not recognised and will be ignored$/),
    ).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it("reports an unchanged row as skipped with nothing to import", async () => {
    renderDialog();
    await uploadAndReport(workbook({ Application: [erp()] }));
    expect(
      screen.getByText("File: cards.xlsx — 1 row(s), 1 unchanged/empty row(s) skipped"),
    ).toBeInTheDocument();
    expect(screen.getByText("No rows to import.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import 0 row\(s\)/ })).toBeDisabled();
  });

  it("flags a workbook exported in another format version", async () => {
    renderDialog();
    await uploadAndReport(workbook({ Application: [app()] }, { format_version: "2" }));
    expect(
      screen.getByText(/exported with a different workbook format \(version 2\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it("applies the pre-selected type to a sheet without a type column", async () => {
    renderDialog({ preSelectedType: "Provider" });
    await uploadAndReport(workbook({ Sheet1: [{ name: "Globex" }] }));
    expect(screen.getByText("1 to create")).toBeInTheDocument();
    expect(mockApi.callsOf("get").map((c) => c.path)).toContain(
      "/stakeholder-roles?type_key=Provider",
    );
  });

  it("still validates when the lookups fail", async () => {
    mockApi.fail("get", "/relations?types=*", 500);
    mockApi.fail("get", "/users", 500);
    mockApi.fail("get", "/stakeholder-roles?type_key=*", 500);
    renderDialog();
    await uploadAndReport(workbook({ Application: [app()] }));
    expect(screen.getByText("1 to create")).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it("cannot be closed while the import runs", async () => {
    let finish!: (value: unknown) => void;
    mockApi.on("post", "/cards/bulk-create", () => new Promise((resolve) => (finish = resolve)));
    const { user, onClose } = renderDialog();
    await uploadAndReport(workbook({ Application: [app()] }));
    await user.click(importButton());
    expect(await screen.findByText("Importing...")).toBeInTheDocument();
    expect(screen.getByText("0 / 1 (0%)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    finish({
      results: [{ row_index: 1, status: "created", id: "00000000-0000-4000-8000-00000000ff00" }],
    });
    expect(await screen.findByText("Import Complete")).toBeInTheDocument();
  });

  it("lists the rows the server refused behind a toggle", async () => {
    mockApi.on("post", "/cards/bulk-create", (_p, body) => ({
      results: (body as BulkCreateBody).cards.map((c) => ({
        row_index: c.row_index,
        status: "failed",
        error: "name taken",
      })),
    }));
    const { user, onComplete } = renderDialog();
    await uploadAndReport(workbook({ Application: [app()] }));
    await user.click(importButton());
    expect(await screen.findByText("Import Complete")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.queryByText(/created/)).not.toBeInTheDocument();

    const toggle = screen.getByText("Failed rows (1)");
    await user.click(toggle);
    expect(toggle).toHaveTextContent("expand_less");
    expect(screen.getByText("Row 2: Application: name taken")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("counts a relation the server refused as failed", async () => {
    mockApi.fail("post", "/relations/bulk", 500, "boom");
    const { user } = renderDialog();
    await uploadAndReport(workbook({ Application: [app({ "rel:relAppToBC": "Finance" })] }));
    await user.click(importButton());
    expect(await screen.findByText("Import Complete")).toBeInTheDocument();
    expect(screen.getByText("1 created")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.queryByText(/relation added/)).not.toBeInTheDocument();
  });
});
