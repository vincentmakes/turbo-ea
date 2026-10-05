/**
 * RiskImportDialog — upload → server dry-run preview → apply.
 *
 * The workbook is a real `.xlsx` built with the vendored xlsx so the
 * client-side parser runs for real; only the template download is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import type { RiskImportResponse } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("./riskImport", async () => {
  const actual = await vi.importActual<typeof import("./riskImport")>("./riskImport");
  return { ...actual, downloadRiskTemplate: vi.fn() };
});

import { mockApi } from "@/test/apiMock";
import { downloadRiskTemplate } from "./riskImport";
import RiskImportDialog from "./RiskImportDialog";

/** An `.xlsx` File whose first sheet holds `rows` (an empty list writes the header only). */
function workbookFile(rows: Record<string, unknown>[], name = "risks.xlsx"): File {
  const ws = rows.length
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([["Title", "Category"]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Risks");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return fileFrom(bytes, name);
}

function fileFrom(bytes: ArrayBuffer, name: string): File {
  const file = new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // jsdom's File has no `arrayBuffer()`; the dialog reads the upload through it.
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  return file;
}

const ROWS = [
  {
    Title: "SSO outage",
    Description: "IdP down",
    Category: "operational",
    "Initial Probability": "medium",
    "Initial Impact": "high",
    owner_email: "owner@example.com",
    target_resolution_date: "2026-12-31",
    cards: "NexaCore ERP; Identity Platform",
  },
  { Title: "", Category: "security", cards: "" },
  { Title: "Already there", reference: "R-000001", cards: "" },
];

const PREVIEW: RiskImportResponse = {
  dry_run: true,
  created: 1,
  failed: 1,
  skipped: 1,
  results: [
    { row_index: 0, status: "created", id: null, reference: null, error: null, warnings: ["Owner owner@example.com not found"] },
    { row_index: 1, status: "failed", id: null, reference: null, error: "Title is required", warnings: [] },
    { row_index: 2, status: "skipped", id: "r1", reference: "R-000001", error: null, warnings: [] },
  ],
};

function renderDialog() {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const user = userEvent.setup();
  const view = render(<RiskImportDialog open onClose={onClose} onComplete={onComplete} />);
  const fileInput = () => view.container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
  return { onClose, onComplete, user, fileInput };
}

const bulkImports = () => mockApi.callsOf("post", "/risks/bulk-import");

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", "/risks/bulk-import", (_p, body) =>
    (body as { dry_run: boolean }).dry_run ? PREVIEW : { ...PREVIEW, dry_run: false },
  );
  vi.mocked(downloadRiskTemplate).mockClear();
});

describe("RiskImportDialog", () => {
  it("starts on the upload step and offers the template", async () => {
    const { user } = renderDialog();
    expect(screen.getByRole("heading", { name: "Import risks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Download template/ }));
    expect(downloadRiskTemplate).toHaveBeenCalledTimes(1);
  });

  it("parses the workbook, dry-runs it and renders the preview counts and details", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));

    await screen.findByText("1 to create");
    expect(screen.getByText("risks.xlsx")).toBeInTheDocument();
    expect(screen.getByText("1 with errors")).toBeInTheDocument();
    expect(screen.getByText("1 already exist (skipped)")).toBeInTheDocument();
    expect(screen.getByText("1 warnings")).toBeInTheDocument();

    // The parsed rows are what the server was asked to preview.
    const [dryRun] = bulkImports();
    const body = dryRun.body as { items: Record<string, unknown>[]; dry_run: boolean };
    expect(body.dry_run).toBe(true);
    expect(body.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      row_index: 0,
      title: "SSO outage",
      description: "IdP down",
      category: "operational",
      initial_probability: "medium",
      initial_impact: "high",
      owner_email: "owner@example.com",
      target_resolution_date: "2026-12-31",
      card_names: ["NexaCore ERP", "Identity Platform"],
    });
    expect(body.items[1]).toMatchObject({ row_index: 1, title: "", card_names: [] });
    expect(body.items[2]).toMatchObject({ row_index: 2, reference: "R-000001" });

    // Each block expands to its rows.
    const alerts = screen.getAllByRole("alert");
    const errors = alerts.find((a) => a.textContent?.includes("Some rows have errors"))!;
    await user.click(within(errors).getByRole("button", { name: "Show more" }));
    expect(within(errors).getByText("Row 2")).toBeInTheDocument();
    expect(within(errors).getByText("Title is required")).toBeInTheDocument();
    await user.click(within(errors).getByRole("button", { name: "Show less" }));

    const warnings = alerts.find((a) => a.textContent?.includes("couldn't be matched"))!;
    await user.click(within(warnings).getByRole("button", { name: "Show more" }));
    expect(within(warnings).getByText("Row 1")).toBeInTheDocument();
    expect(within(warnings).getByText("Owner owner@example.com not found")).toBeInTheDocument();

    const skipped = alerts.find((a) => a.textContent?.includes("never updates existing risks"))!;
    await user.click(within(skipped).getByRole("button", { name: "Show more" }));
    expect(within(skipped).getByText("Row 3")).toBeInTheDocument();
    expect(within(skipped).getByText("R-000001")).toBeInTheDocument();
  });

  it("applies the import, reports the outcome and completes on Close", async () => {
    const { user, fileInput, onClose, onComplete } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await user.click(await screen.findByRole("button", { name: /Import 1 risks/ }));

    expect(await screen.findByRole("heading", { name: "Imported 1 risks" })).toBeInTheDocument();
    expect(screen.getByText("1 rows were skipped (already exist).")).toBeInTheDocument();
    expect(screen.getByText("1 rows were skipped due to errors.")).toBeInTheDocument();
    const [, apply] = bulkImports();
    expect(apply.body).toMatchObject({ dry_run: false });
    expect((apply.body as { items: unknown[] }).items).toHaveLength(3);

    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Import when the preview would create nothing", async () => {
    mockApi.on("post", "/risks/bulk-import", {
      ...PREVIEW,
      created: 0,
      failed: 0,
      skipped: 1,
      results: [PREVIEW.results[2]],
    });
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    expect(await screen.findByRole("button", { name: /Import 0 risks/ })).toBeDisabled();
    expect(screen.queryByText(/with errors/)).not.toBeInTheDocument();
    expect(screen.queryByText(/warnings/)).not.toBeInTheDocument();
  });

  it("Back returns to a clean upload step", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await screen.findByText("1 to create");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeInTheDocument();
    expect(screen.queryByText("risks.xlsx")).not.toBeInTheDocument();
  });

  it("rejects a workbook with only a header row", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([], "empty.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No rows found in the file.");
    expect(bulkImports()).toHaveLength(0);
    expect(screen.getByText("empty.xlsx")).toBeInTheDocument();
  });

  it("reports a file the parser cannot read", async () => {
    const { user, fileInput } = renderDialog();
    // A zip signature followed by garbage: xlsx recognises the container and
    // throws, whereas plain text would be read as an empty CSV.
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 20 }, (_, i) => i + 1)]);
    await user.upload(fileInput(), fileFrom(corrupt.buffer as ArrayBuffer, "bad.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not read the spreadsheet/);
    expect(bulkImports()).toHaveLength(0);
  });

  it("shows the server's message when the dry run is refused", async () => {
    mockApi.fail("post", "/risks/bulk-import", 400, "too many rows");
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    expect(await screen.findByRole("alert")).toHaveTextContent("POST /risks/bulk-import failed");
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeInTheDocument();
  });

  it("shows the server's message when the apply fails and stays on the preview", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await screen.findByText("1 to create");
    mockApi.fail("post", "/risks/bulk-import", 500);
    await user.click(screen.getByRole("button", { name: /Import 1 risks/ }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").some((a) => /bulk-import failed/.test(a.textContent ?? ""))).toBe(true),
    );
    expect(screen.getByRole("button", { name: /Import 1 risks/ })).toBeEnabled();
  });

  it("Cancel closes without completing", async () => {
    const { user, onClose, onComplete } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
