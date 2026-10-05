/**
 * The user import dialog's four steps — upload, report, progress, done —
 * driven with a stubbed `userExcelImport` pipeline so each report shape can
 * be handed over directly. The pipeline itself is covered by
 * `userExcelImport.pipeline.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  parse: vi.fn(),
  validate: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("./userExcelImport", () => ({
  parseUserWorkbook: h.parse,
  validateUserImport: h.validate,
  executeUserImport: h.execute,
}));

import type { AppRole } from "@/types";
import { MEMBER_USER, USERS } from "@/test/fixtures/metamodel";
import UserImportDialog from "./UserImportDialog";
import type { ParsedUserRow, UserImportReport, UserImportResult } from "./userExcelImport";

const ROLES: AppRole[] = [
  {
    id: "role-member",
    key: "member",
    label: "Member",
    is_system: true,
    is_default: true,
    is_archived: false,
    color: "#000",
    permissions: {},
    sort_order: 0,
  },
];

const CREATE_A: ParsedUserRow = { rowIndex: 2, email: "a@test.local", display_name: "A", role: "member" };
const CREATE_B: ParsedUserRow = { rowIndex: 3, email: "b@test.local", display_name: "B", role: "member" };
const UPDATE_MEMBER: ParsedUserRow = {
  rowIndex: 4,
  email: MEMBER_USER.email,
  display_name: "T. Member",
  role: "member",
  locale: "de",
  existing: MEMBER_USER,
  changes: {
    display_name: { old: "Test Member", new: "T. Member" },
    locale: { old: null, new: "de" },
  },
};

const CLEAN_REPORT: UserImportReport = {
  errors: [],
  warnings: [{ row: 5, message: "Row 5: unknown locale, kept the default" }],
  creates: [CREATE_A, CREATE_B],
  updates: [UPDATE_MEMBER],
  skipped: 1,
  totalRows: 4,
};

const BLOCKED_REPORT: UserImportReport = {
  errors: [{ row: 2, message: "Row 2: invalid email" }],
  warnings: [],
  creates: [CREATE_A],
  updates: [],
  skipped: 0,
  totalRows: 1,
};

const EMPTY_REPORT: UserImportReport = {
  errors: [],
  warnings: [],
  creates: [],
  updates: [],
  skipped: 2,
  totalRows: 2,
};

const ROWS = [{ email: "a@test.local" }];

// jsdom 25 ships `File` without `arrayBuffer()`, which the dialog awaits before
// parsing; read the bytes through `FileReader` instead for the test's lifetime.
const hadArrayBuffer = typeof Blob.prototype.arrayBuffer === "function";
beforeAll(() => {
  if (hadArrayBuffer) return;
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
});
afterAll(() => {
  if (hadArrayBuffer) return;
  delete (Blob.prototype as Partial<Blob>).arrayBuffer;
});

function renderDialog() {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const user = userEvent.setup();
  render(
    <UserImportDialog open onClose={onClose} onComplete={onComplete} existingUsers={USERS} roles={ROLES} />,
  );
  return { user, onClose, onComplete, dialog: screen.getByRole("dialog") };
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input is not mounted");
  return input;
}

async function pickFile(name = "users.xlsx") {
  const file = new File([new Uint8Array([1, 2, 3])], name);
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await waitFor(() => expect(h.parse).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  h.parse.mockReset().mockReturnValue(ROWS);
  h.validate.mockReset().mockReturnValue(CLEAN_REPORT);
  h.execute.mockReset();
});

describe("UserImportDialog upload step", () => {
  it("shows the drop zone and cancels without completing", async () => {
    const { user, onClose, onComplete, dialog } = renderDialog();

    expect(within(dialog).getByText("Import Users")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Drag and drop an .xlsx file here, or click to browse"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Export the current user list first/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("parses a picked file through the pipeline with the existing users and roles", async () => {
    const { dialog } = renderDialog();

    await pickFile();

    expect(h.parse.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
    expect(h.validate).toHaveBeenCalledWith(ROWS, USERS, ROLES);
    expect(await within(dialog).findByText("users.xlsx — 4 rows, 1 skipped")).toBeInTheDocument();
  });

  it("accepts a dropped file too", async () => {
    const { dialog } = renderDialog();

    const zone = within(dialog).getByText("Drag and drop an .xlsx file here, or click to browse")
      .parentElement as HTMLElement;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [new File([new Uint8Array([1])], "drop.xlsx")] } });

    expect(await within(dialog).findByText("drop.xlsx — 4 rows, 1 skipped")).toBeInTheDocument();
  });

  it("stays on the upload step with the file name and an error when parsing fails", async () => {
    h.parse.mockImplementation(() => {
      throw new Error("not a workbook");
    });
    const { dialog } = renderDialog();

    await pickFile("broken.xlsx");

    expect(
      await within(dialog).findByText(
        "Could not parse the workbook. Make sure it is a valid .xlsx file.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("broken.xlsx")).toBeInTheDocument();
    expect(h.validate).not.toHaveBeenCalled();
  });
});

describe("UserImportDialog report step", () => {
  it("summarises creates, updates and warnings, previews the changes and goes back", async () => {
    const { user, dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    expect(within(dialog).getByText("1 to update")).toBeInTheDocument();
    expect(within(dialog).getAllByText("1 warning")).toHaveLength(2);
    expect(within(dialog).getByText("Validation passed. Ready to import.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Send invite emails to new users")).toBeChecked();
    expect(within(dialog).getByRole("button", { name: /Import 3 rows/ })).toBeEnabled();

    await user.click(within(dialog).getByText("1 warning", { selector: "h6" }));
    expect(within(dialog).getByText("Row 5: unknown locale, kept the default")).toBeInTheDocument();

    await user.click(within(dialog).getByText("1 change to review"));
    const table = within(dialog).getByRole("table");
    expect(within(table).getByText(MEMBER_USER.email)).toBeInTheDocument();
    expect(within(table).getByText("display_name")).toBeInTheDocument();
    expect(within(table).getByText("Test Member")).toBeInTheDocument();
    expect(within(table).getByText("T. Member")).toBeInTheDocument();
    expect(within(table).getByText("(empty)")).toBeInTheDocument();
    expect(within(table).getByText("de")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(
      within(dialog).getByText("Drag and drop an .xlsx file here, or click to browse"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/users\.xlsx/)).not.toBeInTheDocument();
  });

  it("blocks the import while the report has errors", async () => {
    h.validate.mockReturnValue(BLOCKED_REPORT);
    const { dialog } = renderDialog();
    await pickFile();

    expect(await within(dialog).findByText("1 error")).toBeInTheDocument();
    expect(within(dialog).getByText("1 error blocks the import")).toBeInTheDocument();
    expect(within(dialog).getByText("Row 2: invalid email")).toBeInTheDocument();
    expect(within(dialog).queryByText("Validation passed. Ready to import.")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import 1 row$/ })).toBeDisabled();
  });

  it("says when there is nothing to import", async () => {
    h.validate.mockReturnValue(EMPTY_REPORT);
    const { dialog } = renderDialog();
    await pickFile();

    expect(
      await within(dialog).findByText("Nothing to import. All rows are unchanged or empty."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Send invite emails to new users")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import 0 rows/ })).toBeDisabled();
  });
});

describe("UserImportDialog import", () => {
  it("runs the import without invites, shows progress, then the outcome, and completes on Done", async () => {
    let finish!: (r: UserImportResult) => void;
    let progress!: (done: number, total: number) => void;
    h.execute.mockImplementation((_report, _invites, onProgress) => {
      progress = onProgress;
      return new Promise<UserImportResult>((resolve) => {
        finish = resolve;
      });
    });
    const { user, onClose, onComplete, dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    await user.click(within(dialog).getByLabelText("Send invite emails to new users"));
    await user.click(within(dialog).getByRole("button", { name: /Import 3 rows/ }));

    await waitFor(() => expect(h.execute).toHaveBeenCalledTimes(1));
    expect(h.execute.mock.calls[0][0]).toBe(CLEAN_REPORT);
    expect(h.execute.mock.calls[0][1]).toBe(false);
    expect(within(dialog).getByText("Importing…")).toBeInTheDocument();
    expect(within(dialog).getByText("0 / 3 (0%)")).toBeInTheDocument();
    // Closing is refused mid-import.
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    progress(1, 3);
    expect(await within(dialog).findByText("1 / 3 (33%)")).toBeInTheDocument();

    finish({
      created: 2,
      updated: 1,
      failed: 0,
      failedDetails: [{ row: 2, message: "a@test.local: SMTP refused" }],
    });
    expect(await within(dialog).findByText("Import complete")).toBeInTheDocument();
    expect(within(dialog).getByText("2 created")).toBeInTheDocument();
    expect(within(dialog).getByText("1 updated")).toBeInTheDocument();
    expect(within(dialog).queryByText(/^\d+ failed$/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByText("1 row failed"));
    expect(within(dialog).getByText("Row 2: a@test.local: SMTP refused")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports failed rows with the failure chip", async () => {
    h.execute.mockResolvedValue({
      created: 1,
      updated: 0,
      failed: 2,
      failedDetails: [
        { row: 3, message: "duplicate" },
        { row: 4, message: "forbidden" },
      ],
    });
    const { user, dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    await user.click(within(dialog).getByRole("button", { name: /Import 3 rows/ }));

    expect(await within(dialog).findByText("Import complete")).toBeInTheDocument();
    expect(h.execute.mock.calls[0][1]).toBe(true);
    expect(within(dialog).getByText("1 created")).toBeInTheDocument();
    expect(within(dialog).getByText("2 failed")).toBeInTheDocument();
    expect(within(dialog).queryByText(/updated$/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByText("2 rows failed"));
    expect(within(dialog).getByText("Row 3: duplicate")).toBeInTheDocument();
    expect(within(dialog).getByText("Row 4: forbidden")).toBeInTheDocument();
  });
});
