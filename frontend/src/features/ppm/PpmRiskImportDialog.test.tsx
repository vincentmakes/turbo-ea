/**
 * PpmRiskImportDialog — upload → client-side preview → row-by-row writes.
 *
 * The workbook is a real `.xlsx` built with the vendored xlsx, so the parser
 * and the planner run for real; only the template download is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { createTheme } from "@mui/material/styles";
import type { PpmRisk } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
// Mocked by its alias path so out-of-tree copies the mutation harness builds see it too.
vi.mock("@/features/ppm/ppmRiskSpreadsheet", async () => {
  const actual = await vi.importActual<typeof import("@/features/ppm/ppmRiskSpreadsheet")>(
    "@/features/ppm/ppmRiskSpreadsheet",
  );
  return { ...actual, downloadPpmRiskTemplate: vi.fn() };
});

import "@/i18n";
import { mockApi } from "@/test/apiMock";
import { downloadPpmRiskTemplate } from "@/features/ppm/ppmRiskSpreadsheet";
import PpmRiskImportDialog from "./PpmRiskImportDialog";

const HEADERS = ["Risk ID", "Risk Title", "Description", "Probability", "Impact", "Status", "Owner"];

const RISKS: PpmRisk[] = [
  {
    id: "r1",
    initiative_id: "i1",
    title: "Vendor delay",
    description: "Supplier late",
    probability: 4,
    impact: 3,
    risk_score: 12,
    mitigation: null,
    owner_id: "u1",
    owner_name: "Alice Admin",
    status: "open",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "r2",
    initiative_id: "i1",
    title: "Budget overrun",
    description: null,
    probability: 2,
    impact: 2,
    risk_score: 4,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const USERS = [
  { id: "u1", display_name: "Alice Admin", email: "alice@example.com", is_active: true },
  { id: "u2", display_name: "Bob Builder", email: "bob@example.com", is_active: true },
];

/** Row 2 updates r1, row 3 is unchanged r2, row 4 creates, row 5 is rejected. */
const MIXED: unknown[][] = [
  HEADERS,
  ["r1", "Vendor delay", "Supplier late", 5, 3, "Mitigating", "Alice Admin"],
  ["r2", "Budget overrun", "", 2, 2, "Open", ""],
  ["", "New risk", "Fresh", 1, 4, "", "bob@example.com"],
  ["", "", "no title", 9, 1, "", ""],
];

function fileFrom(bytes: ArrayBuffer, name: string): File {
  const file = new File([bytes], name);
  // jsdom's File has no `arrayBuffer()`; the dialog reads the upload through it.
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  return file;
}

function workbookFile(aoa: unknown[][], name = "risks.xlsx"): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Risks");
  return fileFrom(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, name);
}

function renderDialog(open = true) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <PpmRiskImportDialog
      open={open}
      initiativeId="i1"
      existingRisks={RISKS}
      onClose={onClose}
      onImported={onImported}
    />,
  );
  const fileInput = () => screen.getByTestId("ppm-risk-import-file") as HTMLInputElement;
  return { onClose, onImported, user, fileInput, view };
}

async function uploadMixed(user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement) {
  await user.upload(input, workbookFile(MIXED));
  await screen.findByText("1 to create");
}

const writes = () => mockApi.calls.filter((c) => c.method === "post" || c.method === "patch");
const rowItems = () =>
  Array.from(document.querySelectorAll("li[data-kind]")).map((li) => [
    li.getAttribute("data-kind"),
    li.textContent,
  ]);

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/users", USERS);
  mockApi.on("post", "/ppm/initiatives/i1/risks", (_p, body) => ({ id: "new", ...(body as object) }));
  mockApi.on("patch", /^\/ppm\/risks\//, (_p, body) => body);
  vi.mocked(downloadPpmRiskTemplate).mockClear();
});

describe("PpmRiskImportDialog", () => {
  it("does not load users while closed", () => {
    renderDialog(false);
    expect(mockApi.calls).toEqual([]);
  });

  it("starts on the upload step and offers the template", async () => {
    const { user } = renderDialog();
    expect(screen.getByRole("heading", { name: "Import risks" })).toBeInTheDocument();
    expect(screen.getByText(/A row with a Risk ID from an export updates that risk/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Download template/ }));
    expect(downloadPpmRiskTemplate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("previews create, update, unchanged and rejected rows without writing", async () => {
    const { user, fileInput } = renderDialog();
    await uploadMixed(user, fileInput());

    expect(screen.getByText("risks.xlsx")).toBeInTheDocument();
    expect(screen.getByText("1 to update")).toBeInTheDocument();
    expect(screen.getByText("1 unchanged")).toBeInTheDocument();
    expect(screen.getByText("1 with errors")).toBeInTheDocument();
    expect(screen.queryByText(/warnings/)).not.toBeInTheDocument();
    expect(screen.getByText(/Some rows have errors/)).toBeInTheDocument();
    expect(rowItems()).toEqual([
      ["update", "UpdateRow 2 · Vendor delayChanges: Probability, Status"],
      ["unchanged", "UnchangedRow 3 · Budget overrun"],
      ["create", "NewRow 4 · New risk"],
      [
        "rejected",
        "RejectedRow 5Title is required · Probability must be a whole number from 1 to 5, not 9",
      ],
    ]);
    expect(screen.getByRole("button", { name: /Import 2 changes$/ })).toBeEnabled();
    expect(writes()).toEqual([]);
  });

  it("writes creates and updates to their endpoints, then reports and calls onImported once", async () => {
    const { user, fileInput, onImported, onClose } = renderDialog();
    await uploadMixed(user, fileInput());
    await user.click(screen.getByRole("button", { name: /Import 2 changes$/ }));

    await screen.findByText("Import finished");
    expect(writes()).toEqual([
      { method: "patch", path: "/ppm/risks/r1", body: { probability: 5, status: "mitigating" } },
      {
        method: "post",
        path: "/ppm/initiatives/i1/risks",
        body: {
          title: "New risk",
          description: "Fresh",
          probability: 1,
          impact: 4,
          status: "open",
          owner_id: "u2",
        },
      },
    ]);
    expect(screen.getByText("1 created, 1 updated, 0 failed")).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("continues past a failed row and names it with its reason", async () => {
    mockApi.fail("patch", "/ppm/risks/r1", 409, "conflict");
    const { user, fileInput, onImported } = renderDialog();
    await uploadMixed(user, fileInput());
    await user.click(screen.getByRole("button", { name: /Import 2 changes$/ }));

    await screen.findByText("1 created, 0 updated, 1 failed");
    expect(writes().map((c) => c.path)).toEqual(["/ppm/risks/r1", "/ppm/initiatives/i1/risks"]);
    const failed = screen.getByText("PATCH /ppm/risks/r1 failed").closest("li")!;
    expect(failed).toHaveTextContent("Row 2 · Vendor delayPATCH /ppm/risks/r1 failed");
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("words a non-API failure generically", async () => {
    mockApi.on("post", "/ppm/initiatives/i1/risks", () => {
      throw new TypeError("network down");
    });
    mockApi.fail("patch", "/ppm/risks/r1");
    const { user, fileInput, onImported } = renderDialog();
    await uploadMixed(user, fileInput());
    await user.click(screen.getByRole("button", { name: /Import 2 changes$/ }));

    await screen.findByText("0 created, 0 updated, 2 failed");
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("writes nothing and offers no import when every row is unchanged or rejected", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(
      fileInput(),
      workbookFile([HEADERS, ["r2", "Budget overrun", "", 2, 2, "Open", ""], ["", ""," x", 1, 1, "", ""]]),
    );
    await screen.findByText("0 to create");
    expect(screen.getByText("0 to update")).toBeInTheDocument();
    expect(screen.getByText("Nothing to import: every row is unchanged or rejected.")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: /Import 0 changes$/ });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(writes()).toEqual([]);
  });

  it("writes once on a double click and cannot be closed while writing", async () => {
    let release!: () => void;
    mockApi.on(
      "post",
      "/ppm/initiatives/i1/risks",
      () => new Promise((resolve) => (release = () => resolve({ id: "new" }))),
    );
    const { user, fileInput, onClose, onImported } = renderDialog();
    await user.upload(fileInput(), workbookFile([HEADERS, ["", "Only one", "", 1, 1, "", ""]]));
    const apply = await screen.findByRole("button", { name: /Import 1 change$/ });

    act(() => {
      apply.click();
      apply.click();
    });
    expect(await screen.findByRole("button", { name: /Importing…$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => release());
    await screen.findByText("1 created, 0 updated, 0 failed");
    expect(mockApi.callsOf("post")).toHaveLength(1);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("rejects a file that is not a spreadsheet and writes nothing", async () => {
    const { user, fileInput } = renderDialog();
    const text = new TextEncoder().encode("Risk Title\nA\n").buffer as ArrayBuffer;
    await user.upload(fileInput(), fileFrom(text, "renamed.xlsx"));
    expect(
      await screen.findByText("Could not read the spreadsheet. Make sure it is a valid .xlsx file."),
    ).toBeInTheDocument();
    expect(screen.getByText("renamed.xlsx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("rejects an empty sheet", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([HEADERS]));
    expect(await screen.findByText("No rows found in the file.")).toBeInTheDocument();
    expect(screen.queryByText("0 to create")).not.toBeInTheDocument();
  });

  it("clears the error on the next pick and goes back to the upload step", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([HEADERS]));
    await screen.findByText("No rows found in the file.");
    await uploadMixed(user, fileInput());
    expect(screen.queryByText("No rows found in the file.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Choose \.xlsx file/ })).toBeInTheDocument();
    expect(screen.queryByText("risks.xlsx")).not.toBeInTheDocument();
    expect(fileInput().value).toBe("");
  });

  it("reports an unknown owner on the row", async () => {
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile([HEADERS, ["", "A", "", 1, 1, "", "Zed"]]));
    await screen.findByText("1 warnings");
    expect(
      screen.getByText("No user matches the owner Zed; the owner is left unchanged"),
    ).toBeInTheDocument();
  });

  it("says when the users cannot be loaded and offers no import", async () => {
    mockApi.fail("get", "/users");
    const { user, fileInput } = renderDialog();
    expect(
      await screen.findByText("Could not load the users to match owners. Try again later."),
    ).toBeInTheDocument();
    await user.upload(fileInput(), workbookFile(MIXED));
    await screen.findByText("risks.xlsx");
    expect(screen.queryByText("1 to create")).not.toBeInTheDocument();
    expect(screen.queryByText("Reading file…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import 0 changes$/ })).toBeDisabled();
  });

  it("shows that it is waiting for the users before previewing", async () => {
    mockApi.on("get", "/users", () => new Promise(() => {}));
    const { user, fileInput } = renderDialog();
    await user.upload(fileInput(), workbookFile(MIXED));
    expect(await screen.findByText("Reading file…")).toBeInTheDocument();
  });

  it("cancels from the upload step", async () => {
    const { user, onClose, onImported } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled();
  });

  describe("what each step shows", () => {
    const captions = () =>
      Array.from(document.querySelectorAll(".MuiTypography-caption")).map((e) => e.textContent);
    const chipLabels = () =>
      Array.from(document.querySelectorAll(".MuiChip-label")).map((e) => e.textContent);
    const importButton = () => screen.queryByRole("button", { name: /Import \d+ changes?$/ });
    // The dialog renders without a ThemeProvider, so it uses MUI's default palette.
    const palette = createTheme().palette;

    it("starts clean: no file name, no alert and no import button", async () => {
      renderDialog();
      await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(1));
      await act(async () => {});
      expect(captions()).toEqual([]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(importButton()).not.toBeInTheDocument();
    });

    it("opens the file picker from the choose button", async () => {
      const { user, fileInput } = renderDialog();
      const click = vi.spyOn(fileInput(), "click");
      await user.click(screen.getByRole("button", { name: /Choose \.xlsx file/ }));
      expect(click).toHaveBeenCalledTimes(1);
    });

    it("shows a rejected file's name as a caption, and cancelling forgets the file and the error", async () => {
      const { user, fileInput, onClose } = renderDialog();
      await user.upload(fileInput(), workbookFile([HEADERS]));
      expect(await screen.findByText("No rows found in the file.")).toBeInTheDocument();
      expect(screen.getByText("risks.xlsx")).toHaveClass("MuiTypography-caption");
      expect(fileInput().value).not.toBe("");

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(captions()).toEqual([]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fileInput().value).toBe("");
    });

    it("going back to the upload step shows no file name and no alert", async () => {
      const { user, fileInput } = renderDialog();
      await uploadMixed(user, fileInput());
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(captions()).toEqual([]);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the error when the picker closes without a file", async () => {
      const { user, fileInput } = renderDialog();
      await user.upload(fileInput(), workbookFile([HEADERS]));
      await screen.findByText("No rows found in the file.");
      fireEvent.change(fileInput(), { target: { files: [] } });
      await act(async () => {});
      expect(screen.getByText("No rows found in the file.")).toBeInTheDocument();
      expect(screen.getByText("risks.xlsx")).toBeInTheDocument();
    });

    it("previews a clean file with only the counts that apply and no alert", async () => {
      const { user, fileInput } = renderDialog();
      await user.upload(fileInput(), workbookFile([HEADERS]));
      await screen.findByText("No rows found in the file.");
      await user.upload(fileInput(), workbookFile([HEADERS, ["", "Only one", "", 1, 1, "", ""]]));
      await screen.findByText("1 to create");

      expect(chipLabels()).toEqual(["1 to create", "0 to update", "New"]);
      expect(screen.queryAllByRole("alert")).toEqual([]);
      const list = screen.getByRole("list", { name: "Import risks" });
      expect(list).toHaveTextContent("Row 2 · Only one");
      expect(importButton()).toBeEnabled();
    });

    it("links the addresses in a row's title, in the preview and in the failures", async () => {
      mockApi.fail("post", "/ppm/initiatives/i1/risks", 422, "bad");
      const { user, fileInput } = renderDialog();
      await user.upload(
        fileInput(),
        workbookFile([HEADERS, ["", "See https://example.com/r1", "", 1, 1, "", ""]]),
      );
      await screen.findByText("1 to create");
      expect(screen.getByRole("link", { name: "https://example.com/r1" })).toHaveAttribute(
        "href",
        "https://example.com/r1",
      );

      await user.click(screen.getByRole("button", { name: /Import 1 change$/ }));
      await screen.findByText("0 created, 0 updated, 1 failed");
      expect(screen.getByRole("link", { name: "https://example.com/r1" })).toHaveAttribute(
        "href",
        "https://example.com/r1",
      );
    });

    it("finishes with a success mark and no failure list when every row was written", async () => {
      const { user, fileInput } = renderDialog();
      await user.upload(fileInput(), workbookFile([HEADERS, ["", "Only one", "", 1, 1, "", ""]]));
      await user.click(await screen.findByRole("button", { name: /Import 1 change$/ }));
      await screen.findByText("1 created, 0 updated, 0 failed");

      expect(screen.getByText("check_circle")).toHaveStyle({ color: palette.success.main });
      expect(screen.queryByText("warning")).not.toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(importButton()).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    });

    it("finishes with a warning mark and the failure list when a row failed", async () => {
      mockApi.fail("post", "/ppm/initiatives/i1/risks", 422, "bad");
      const { user, fileInput } = renderDialog();
      await user.upload(fileInput(), workbookFile([HEADERS, ["", "Only one", "", 1, 1, "", ""]]));
      await user.click(await screen.findByRole("button", { name: /Import 1 change$/ }));
      await screen.findByText("0 created, 0 updated, 1 failed");

      expect(screen.getByText("warning")).toHaveStyle({ color: palette.warning.main });
      expect(screen.queryByText("check_circle")).not.toBeInTheDocument();
      expect(screen.getByRole("list")).toHaveTextContent("Row 2 · Only one");
    });

    it("does not raise the users error over a finished import shown again", async () => {
      const { user, fileInput, view } = renderDialog();
      await user.upload(fileInput(), workbookFile([HEADERS, ["", "Only one", "", 1, 1, "", ""]]));
      await user.click(await screen.findByRole("button", { name: /Import 1 change$/ }));
      await screen.findByText("1 created, 0 updated, 0 failed");

      const props = {
        initiativeId: "i1",
        existingRisks: RISKS,
        onClose: vi.fn(),
        onImported: vi.fn(),
      };
      view.rerender(<PpmRiskImportDialog open={false} {...props} />);
      mockApi.fail("get", "/users");
      view.rerender(<PpmRiskImportDialog open {...props} />);
      await waitFor(() => expect(mockApi.callsOf("get", "/users")).toHaveLength(2));
      await act(async () => {});
      expect(await screen.findByText("1 created, 0 updated, 0 failed")).toBeInTheDocument();
      expect(
        screen.queryByText("Could not load the users to match owners. Try again later."),
      ).not.toBeInTheDocument();
    });
  });
});
