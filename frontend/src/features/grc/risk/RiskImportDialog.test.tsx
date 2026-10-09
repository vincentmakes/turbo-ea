/**
 * RiskImportDialog — upload → server dry-run preview → apply.
 *
 * The workbook is a real `.xlsx` built with the vendored xlsx so the
 * client-side parser runs for real; only the template download is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { createTheme } from "@mui/material/styles";
import type { RiskImportResponse } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
// Mocked by its alias path, not "./riskImport", so the out-of-tree copies the
// mutation harness builds (which import it by absolute path) see the same mock.
vi.mock("@/features/grc/risk/riskImport", async () => {
  const actual = await vi.importActual<typeof import("@/features/grc/risk/riskImport")>(
    "@/features/grc/risk/riskImport",
  );
  return { ...actual, downloadRiskTemplate: vi.fn() };
});

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { downloadRiskTemplate } from "@/features/grc/risk/riskImport";
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
/** The palette the dialog renders against (no ThemeProvider: MUI's default theme). */
const PALETTE = createTheme().palette;

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

/** A preview with nothing to report beyond the rows it would create. */
const CLEAN: RiskImportResponse = {
  dry_run: true,
  created: 2,
  failed: 0,
  skipped: 0,
  results: [
    { row_index: 0, status: "created", id: null, reference: null, error: null, warnings: [] },
    { row_index: 1, status: "created", id: null, reference: null, error: null, warnings: [] },
  ],
};

/** A promise the test settles by hand, to observe the dialog mid-request. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The dialog's content area (between the title and the actions). */
const content = () => screen.getByRole("dialog").querySelector(".MuiDialogContent-root") as HTMLElement;

const alertWith = (text: string) =>
  screen.getAllByRole("alert").find((a) => a.textContent?.includes(text))!;

describe("RiskImportDialog — step by step", () => {
  it("shows nothing but the intro, the template link and the picker before a file is chosen", () => {
    renderDialog();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(/^Upload an \.xlsx file to create risks in bulk\. Each row becomes a new risk/),
    ).toBeInTheDocument();
    // No file name caption trails the picker yet.
    expect(content().textContent).toMatch(/Choose \.xlsx file$/);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import \d+ risks$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("opens the hidden file input from the Choose button", async () => {
    const { user, fileInput } = renderDialog();
    const clicked = vi.fn();
    fileInput().addEventListener("click", clicked);
    await user.click(screen.getByRole("button", { name: /Choose \.xlsx file/ }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("locks the picker while the dry run is in flight and ignores Escape until it lands", async () => {
    const pending = deferred<RiskImportResponse>();
    mockApi.on("post", "/risks/bulk-import", () => pending.promise);
    const { user, fileInput, onClose } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));

    const picker = await screen.findByRole("button", { name: /Reading file…/ });
    expect(picker).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => pending.resolve(CLEAN));
    expect(await screen.findByText("2 to create")).toBeInTheDocument();
  });

  it("keeps the current error when the file picker is dismissed without a file", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([], "empty.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No rows found in the file.");
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(screen.getByRole("alert")).toHaveTextContent("No rows found in the file.");
    expect(bulkImports()).toHaveLength(0);
  });

  it("clears a previous error once a readable file is picked, and a clean preview shows no blocks", async () => {
    mockApi.on("post", "/risks/bulk-import", (_p, body) =>
      (body as { dry_run: boolean }).dry_run ? CLEAN : { ...CLEAN, dry_run: false },
    );
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([], "empty.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No rows found in the file.");

    await user.upload(fileInput(), workbookFile(ROWS));
    expect(await screen.findByText("2 to create")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/with errors/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already exist/)).not.toBeInTheDocument();
    expect(screen.queryByText(/warnings/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Import 2 risks$/ })).toBeEnabled();
  });

  it("Cancel on the upload step clears the error and the picked file", async () => {
    const { user, fileInput, onClose } = renderDialog();
    await user.upload(fileInput(), workbookFile([], "empty.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No rows found in the file.");
    expect(fileInput().value).not.toBe("");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("empty.xlsx")).not.toBeInTheDocument();
    expect(fileInput().value).toBe("");
  });

  it("lists only the failed rows under errors and only the skipped rows under skipped", async () => {
    mockApi.on("post", "/risks/bulk-import", {
      dry_run: true,
      created: 1,
      failed: 1,
      skipped: 1,
      results: [
        { row_index: 0, status: "created", id: null, reference: null, error: null, warnings: [] },
        // A failure the server gave no message for, a skip it gave no reference for.
        { row_index: 1, status: "failed", id: null, reference: null, error: null, warnings: [] },
        { row_index: 2, status: "skipped", id: "r1", reference: null, error: null, warnings: [] },
      ],
    } satisfies RiskImportResponse);
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await screen.findByText("1 to create");

    const errors = alertWith("Some rows have errors");
    await user.click(within(errors).getByRole("button", { name: "Show more" }));
    expect(within(errors).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Row 2"]);

    const skipped = alertWith("never updates existing risks");
    await user.click(within(skipped).getByRole("button", { name: "Show more" }));
    expect(within(skipped).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Row 3"]);
  });

  it("toggles every details block and Back resets them, the error and the file input", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await screen.findByText("1 to create");

    for (const text of ["Some rows have errors", "couldn't be matched", "never updates existing risks"]) {
      const block = alertWith(text);
      await user.click(within(block).getByRole("button", { name: "Show more" }));
      expect(within(block).getByRole("button", { name: "Show less" })).toBeInTheDocument();
    }
    const warnings = alertWith("couldn't be matched");
    await user.click(within(warnings).getByRole("button", { name: "Show less" }));
    expect(within(warnings).getByRole("button", { name: "Show more" })).toBeInTheDocument();
    await user.click(within(warnings).getByRole("button", { name: "Show more" }));

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(content().textContent).toMatch(/Choose \.xlsx file$/);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    // A fresh preview starts with every block collapsed again.
    await user.upload(fileInput(), workbookFile(ROWS));
    await screen.findByText("1 to create");
    expect(screen.getAllByRole("button", { name: "Show more" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show less" })).not.toBeInTheDocument();
  });

  it("locks the dialog while the import runs, then reports a clean outcome", async () => {
    mockApi.on("post", "/risks/bulk-import", (_p, body) =>
      (body as { dry_run: boolean }).dry_run ? CLEAN : pending.promise,
    );
    const pending = deferred<RiskImportResponse>();
    const { user, fileInput, onClose, onComplete } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await user.click(await screen.findByRole("button", { name: /Import 2 risks$/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Import 2 risks$/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => pending.resolve({ ...CLEAN, dry_run: false }));
    const heading = await screen.findByRole("heading", { name: "Imported 2 risks" });
    const done = heading.parentElement as HTMLElement;
    // Coloured with the theme's success colour — a palette path like
    // "success.main" is not a CSS colour and would be dropped by the browser.
    expect(within(done).getByText("check_circle")).toHaveStyle({ color: PALETTE.success.main });
    expect(screen.queryByText(/rows were skipped/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The preview is gone, and so are its actions.
    expect(screen.queryByText("2 to create")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import \d+ risks$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The dialog is reset for the next time it opens.
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Imported/ })).not.toBeInTheDocument();
  });

  it("flags an import with failures with a warning icon", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await user.click(await screen.findByRole("button", { name: /Import 1 risks/ }));
    const heading = await screen.findByRole("heading", { name: "Imported 1 risks" });
    expect(within(heading.parentElement as HTMLElement).getByText("warning")).toHaveStyle({
      color: PALETTE.warning.main,
    });
    expect(screen.queryByText("1 to create")).not.toBeInTheDocument();
  });

  it("falls back to the generic message when the import fails without an API error", async () => {
    mockApi.on("post", "/risks/bulk-import", (_p, body) => {
      if ((body as { dry_run: boolean }).dry_run) return PREVIEW;
      throw new Error("socket hang up");
    });
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await user.click(await screen.findByRole("button", { name: /Import 1 risks/ }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain("Something went wrong"),
    );
    expect(screen.getByRole("button", { name: /Import 1 risks/ })).toBeEnabled();
  });
});

describe("RiskImportDialog — translated", () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
  });
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders every step in the user's language", async () => {
    const pending = deferred<RiskImportResponse>();
    mockApi.on("post", "/risks/bulk-import", (_p, body) =>
      (body as { dry_run: boolean }).dry_run ? pending.promise : { ...PREVIEW, dry_run: false },
    );
    const { user, fileInput } = renderDialog();
    expect(screen.getByRole("heading", { name: "Risiken importieren" })).toBeInTheDocument();
    expect(screen.getByText(/^Laden Sie eine \.xlsx-Datei hoch/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vorlage herunterladen/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\.xlsx-Datei auswählen/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();

    await user.upload(fileInput(), workbookFile(ROWS));
    expect(await screen.findByRole("button", { name: /Datei wird gelesen…/ })).toBeDisabled();
    await act(async () => pending.resolve(PREVIEW));

    expect(await screen.findByText("1 anzulegen")).toBeInTheDocument();
    expect(screen.getByText("1 mit Fehlern")).toBeInTheDocument();
    expect(screen.getByText("1 bereits vorhanden (übersprungen)")).toBeInTheDocument();
    expect(screen.getByText("1 Warnungen")).toBeInTheDocument();
    const errors = alertWith("Einige Zeilen enthalten Fehler");
    const warnings = alertWith("konnten nicht zugeordnet werden");
    const skipped = alertWith("aktualisiert niemals bestehende Risiken");
    for (const [block, row] of [
      [errors, "Zeile 2"],
      [warnings, "Zeile 1"],
      [skipped, "Zeile 3"],
    ] as const) {
      await user.click(within(block).getByRole("button", { name: "Mehr anzeigen" }));
      expect(within(block).getByRole("button", { name: "Weniger anzeigen" })).toBeInTheDocument();
      expect(within(block).getByText(row)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Zurück" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /1 Risiken importieren$/ }));
    expect(await screen.findByRole("heading", { name: "1 Risiken importiert" })).toBeInTheDocument();
    expect(screen.getByText("1 Zeilen wurden übersprungen (bereits vorhanden).")).toBeInTheDocument();
    expect(screen.getByText("1 Zeilen wurden aufgrund von Fehlern übersprungen.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Schließen" }));
  });

  it("reports an empty and an unreadable workbook in the user's language", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([], "empty.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Keine Zeilen in der Datei gefunden.");

    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 20 }, (_, i) => i + 1)]);
    await user.upload(fileInput(), fileFrom(corrupt.buffer as ArrayBuffer, "bad.xlsx"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Die Tabelle konnte nicht gelesen werden/),
    );
  });

  it("reports a failed import with the translated generic message", async () => {
    mockApi.on("post", "/risks/bulk-import", (_p, body) => {
      if ((body as { dry_run: boolean }).dry_run) return PREVIEW;
      throw new Error("socket hang up");
    });
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(ROWS));
    await user.click(await screen.findByRole("button", { name: /1 Risiken importieren$/ }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain("Etwas ist schiefgelaufen"),
    );
  });
});
