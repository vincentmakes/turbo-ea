/**
 * SpreadsheetImportDialog — upload → server dry-run preview → apply → done.
 *
 * The caller's `parse` runs on a real `.xlsx` (the principles parser), so the
 * file → items path is real; the server is the API mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import type { SpreadsheetImportResponse } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import "@/i18n";
import { mockApi } from "@/test/apiMock";
import { parsePrincipleWorkbook } from "@/features/admin/principles/principleSpreadsheet";
import SpreadsheetImportDialog from "./SpreadsheetImportDialog";

const ENDPOINT = "/metamodel/principles/bulk-import";

function workbookFile(rows: unknown[][], name = "principles.xlsx"): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Principles");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // jsdom's File has no `arrayBuffer()`; the dialog reads the upload through it.
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  return file;
}

const ROWS = [
  ["reference_number", "title"],
  ["P-001", "Reuse first"],
  ["", "Cloud first"],
  ["", ""],
  ["P-002", "Same"],
];

const PREVIEW: SpreadsheetImportResponse = {
  dry_run: true,
  created: 1,
  updated: 1,
  skipped: 1,
  failed: 1,
  results: [
    {
      row_index: 0,
      status: "updated",
      id: "p1",
      reference_number: "P-001",
      changed_fields: ["title"],
      error: null,
      warnings: ["Reference P-001 not found; matched P-009 by title"],
    },
    { row_index: 1, status: "created", id: null, reference_number: "P-003", error: null, warnings: [] },
    { row_index: 2, status: "failed", id: null, reference_number: null, error: "Title is required", warnings: [] },
    { row_index: 3, status: "skipped", id: "p2", reference_number: "P-002", error: null, warnings: [] },
  ],
};

function renderDialog(overrides: Partial<{ downloadTemplate: () => void }> = {}) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const downloadTemplate = overrides.downloadTemplate ?? vi.fn();
  const user = userEvent.setup();
  const view = render(
    <SpreadsheetImportDialog
      open
      onClose={onClose}
      onComplete={onComplete}
      title="Import things"
      intro="Upload a file of things."
      skippedHint="These change nothing."
      endpoint={ENDPOINT}
      parse={parsePrincipleWorkbook}
      downloadTemplate={downloadTemplate}
    />,
  );
  const fileInput = () => view.baseElement.querySelector('input[type="file"]') as HTMLInputElement;
  return { onClose, onComplete, downloadTemplate, user, fileInput };
}

const calls = () => mockApi.callsOf("post", ENDPOINT);

beforeEach(() => {
  mockApi.reset();
  mockApi.on("post", ENDPOINT, (_p, body) =>
    (body as { dry_run: boolean }).dry_run ? PREVIEW : { ...PREVIEW, dry_run: false },
  );
});

describe("SpreadsheetImportDialog", () => {
  it("starts on the upload step with the caller's text and template", async () => {
    const { user, downloadTemplate } = renderDialog();
    expect(screen.getByRole("heading", { name: "Import things" })).toBeInTheDocument();
    expect(screen.getByText("Upload a file of things.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Download template/ }));
    expect(downloadTemplate).toHaveBeenCalledTimes(1);
  });

  it("dry-runs the parsed rows and shows every outcome with its rows", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));

    await screen.findByText("1 to create");
    expect(screen.getByText("principles.xlsx")).toBeInTheDocument();
    expect(screen.getByText("1 to update")).toBeInTheDocument();
    expect(screen.getByText("1 unchanged or existing (skipped)")).toBeInTheDocument();
    expect(screen.getByText("1 with errors")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();

    const [dryRun] = calls();
    expect(dryRun.body).toEqual({
      dry_run: true,
      items: [
        // row_index is the sheet position (header = 0); the blank line is skipped.
        { row_index: 1, reference_number: "P-001", title: "Reuse first" },
        { row_index: 2, reference_number: "", title: "Cloud first" },
        { row_index: 4, reference_number: "P-002", title: "Same" },
      ],
    });

    const alerts = screen.getAllByRole("alert");
    const errors = alerts.find((a) => a.textContent?.includes("Some rows have errors"))!;
    await user.click(within(errors).getByRole("button", { name: "Show more" }));
    expect(within(errors).getByText("Row 3")).toBeInTheDocument();
    expect(within(errors).getByText("Title is required")).toBeInTheDocument();
    await user.click(within(errors).getByRole("button", { name: "Show less" }));

    const warnings = alerts.find((a) => a.textContent?.includes("could not be matched"))!;
    await user.click(within(warnings).getByRole("button", { name: "Show more" }));
    expect(within(warnings).getByText("Row 1")).toBeInTheDocument();
    expect(
      within(warnings).getByText("Reference P-001 not found; matched P-009 by title"),
    ).toBeInTheDocument();

    const updates = alerts.find((a) => a.textContent?.includes("will be updated"))!;
    await user.click(within(updates).getByRole("button", { name: "Show more" }));
    expect(within(updates).getByText("Row 1")).toBeInTheDocument();
    expect(within(updates).getByText("P-001: title")).toBeInTheDocument();

    const skipped = alerts.find((a) => a.textContent?.includes("These change nothing."))!;
    await user.click(within(skipped).getByRole("button", { name: "Show more" }));
    expect(within(skipped).getByText("Row 4")).toBeInTheDocument();
    expect(within(skipped).getByText("P-002")).toBeInTheDocument();
  });

  it("applies the same rows, reports the outcome and completes on Close", async () => {
    const { user, fileInput, onClose, onComplete } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await user.click(await screen.findByRole("button", { name: /Import 2 rows/ }));

    expect(await screen.findByRole("heading", { name: "1 created" })).toBeInTheDocument();
    expect(screen.getByText("1 updated")).toBeInTheDocument();
    expect(screen.getByText("1 row was skipped.")).toBeInTheDocument();
    expect(screen.getByText("1 row was not imported because of errors.")).toBeInTheDocument();
    const [dryRun, apply] = calls();
    expect(apply.body).toEqual({ ...(dryRun.body as object), dry_run: false });

    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Import when nothing would change and hides empty outcomes", async () => {
    mockApi.on("post", ENDPOINT, {
      dry_run: true,
      created: 0,
      skipped: 1,
      failed: 0,
      results: [PREVIEW.results[3]],
    } satisfies SpreadsheetImportResponse);
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    expect(await screen.findByRole("button", { name: /Import 0 rows/ })).toBeDisabled();
    expect(screen.queryByText(/to update/)).not.toBeInTheDocument();
    expect(screen.queryByText(/will be updated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/with errors/)).not.toBeInTheDocument();
    expect(screen.queryByText(/warning/)).not.toBeInTheDocument();
  });

  it("Back returns to a clean upload step; Cancel closes without completing", async () => {
    const { user, fileInput, onClose, onComplete } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await screen.findByText("1 to create");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeInTheDocument();
    expect(screen.queryByText("principles.xlsx")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("refuses a header-only workbook without calling the server", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([["title"]], "empty.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No rows found in the file.");
    expect(calls()).toHaveLength(0);
  });

  it("reports a file the parser cannot read", async () => {
    const { user, fileInput } = renderDialog();
    const broken = new File(["not a workbook"], "broken.xlsx");
    Object.defineProperty(broken, "arrayBuffer", {
      value: async () => {
        throw new Error("unreadable");
      },
    });
    await user.upload(fileInput(), broken);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read the spreadsheet. Make sure it is a valid .xlsx file.",
    );
    expect(calls()).toHaveLength(0);
  });

  it("shows the server's message when the preview request fails", async () => {
    mockApi.fail("post", ENDPOINT, 403, "Insufficient permissions");
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    // The ApiError's own message, not the generic fallback.
    expect(await screen.findByRole("alert")).toHaveTextContent(`POST ${ENDPOINT} failed`);
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeEnabled();
  });
});
