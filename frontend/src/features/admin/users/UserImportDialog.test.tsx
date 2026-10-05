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
// Mocked by its alias path, which resolves to the same module the dialog's
// relative import does, wherever a copy of this test runs from.
vi.mock("@/features/admin/users/userExcelImport", () => ({
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
  const element = (open: boolean) => (
    <UserImportDialog
      open={open}
      onClose={onClose}
      onComplete={onComplete}
      existingUsers={USERS}
      roles={ROLES}
    />
  );
  const { rerender } = render(element(true));
  /** Closes and reopens the dialog the way the Users page does, keeping its state. */
  const reopen = async () => {
    rerender(element(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(element(true));
    return screen.getByRole("dialog");
  };
  return { user, onClose, onComplete, reopen, dialog: screen.getByRole("dialog") };
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

const DROP_TEXT = "Drag and drop an .xlsx file here, or click to browse";

function dropZone(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByText(DROP_TEXT).parentElement as HTMLElement;
}

/** The h6 heading of a collapsible alert, whose text ends in its expand/collapse glyph. */
function toggleHeading(dialog: HTMLElement, text: RegExp): HTMLElement {
  return within(dialog).getByText(text, { selector: "h6" });
}

function report(overrides: Partial<UserImportReport>): UserImportReport {
  return { errors: [], warnings: [], creates: [], updates: [], skipped: 0, totalRows: 1, ...overrides };
}

/** Records unhandled promise rejections (an async handler that threw) for one test. */
function trackRejections() {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown) => seen.push(reason);
  process.on("unhandledRejection", onRejection);
  return {
    seen,
    stop: () => process.off("unhandledRejection", onRejection),
  };
}

describe("UserImportDialog upload step details", () => {
  it("starts with no file, no error and only the tip, and no report, progress or Done", () => {
    const { dialog } = renderDialog();

    expect(within(dialog).getByText("Accepted: .xlsx, .xls")).toBeInTheDocument();
    expect(within(dialog).getByText("Tip:")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Selected/)).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(within(dialog).queryByText("Importing…")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("opens the file browser when the drop zone is clicked", async () => {
    const { user, dialog } = renderDialog();
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});

    await user.click(within(dialog).getByText(DROP_TEXT));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("takes over dragging and dropping so the browser never opens the file itself", async () => {
    const { dialog } = renderDialog();
    const zone = dropZone(dialog);

    // `fireEvent` returns false once a handler called preventDefault().
    expect(fireEvent.dragOver(zone)).toBe(false);
    expect(
      fireEvent.drop(zone, { dataTransfer: { files: [new File([new Uint8Array([1])], "drop.xlsx")] } }),
    ).toBe(false);
    expect(await within(dialog).findByText("drop.xlsx — 4 rows, 1 skipped")).toBeInTheDocument();
  });

  it("ignores a drop or a pick that carries no file", async () => {
    const rejections = trackRejections();
    try {
      const { dialog } = renderDialog();

      fireEvent.drop(dropZone(dialog), { dataTransfer: { files: [] } });
      fireEvent.change(fileInput(), { target: { files: [] } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(rejections.seen).toEqual([]);
      expect(h.parse).not.toHaveBeenCalled();
      expect(within(dialog).queryByText(/Selected/)).not.toBeInTheDocument();
      expect(within(dialog).getByText(DROP_TEXT)).toBeInTheDocument();
    } finally {
      rejections.stop();
    }
  });

  it("clears the previous parse error as soon as another file is picked", async () => {
    h.parse.mockImplementation(() => {
      throw new Error("not a workbook");
    });
    const { dialog } = renderDialog();
    await pickFile("broken.xlsx");
    await within(dialog).findByText("Could not parse the workbook. Make sure it is a valid .xlsx file.");

    // A file still being read: the dialog shows its name and drops the old error meanwhile.
    const pending = { name: "next.xlsx", arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) };
    fireEvent.change(fileInput(), { target: { files: [pending] } });

    const picked = await within(dialog).findByText("next.xlsx");
    expect(picked.parentElement).toHaveTextContent(/^Selected: next\.xlsx$/);
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(within(dialog).queryByText(/Could not parse/)).not.toBeInTheDocument();
  });

  it("forgets the failed file when cancelled, so the same file can be picked again", async () => {
    h.parse.mockImplementation(() => {
      throw new Error("not a workbook");
    });
    const { user, onClose, dialog } = renderDialog();
    const input = fileInput();
    await user.upload(input, new File([new Uint8Array([1])], "broken.xlsx"));
    await within(dialog).findByText("Could not parse the workbook. Make sure it is a valid .xlsx file.");
    expect(input.value).not.toBe("");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
    expect(within(dialog).queryByText(/Could not parse/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Selected/)).not.toBeInTheDocument();
  });

  it("comes back clean after a parse error when cancelled and reopened", async () => {
    h.parse.mockImplementation(() => {
      throw new Error("not a workbook");
    });
    const { user, reopen, dialog } = renderDialog();
    await pickFile("broken.xlsx");
    await within(dialog).findByText("Could not parse the workbook. Make sure it is a valid .xlsx file.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const reopened = await reopen();
    expect(within(reopened).getAllByRole("alert")).toHaveLength(1);
    expect(within(reopened).queryByText(/Could not parse/)).not.toBeInTheDocument();
    expect(within(reopened).queryByText(/Selected/)).not.toBeInTheDocument();
  });
});

describe("UserImportDialog report step details", () => {
  it("shows only the report: no drop zone, no progress, one Cancel and no Done", async () => {
    const { dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    expect(within(dialog).queryByText(DROP_TEXT)).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Importing…")).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(within(dialog).queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    // A clean report has no error chip nor error list.
    expect(within(dialog).queryByText(/\d+ errors?/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "When enabled, every newly created user receives an invitation email with a sign-in link.",
      ),
    ).toBeInTheDocument();
  });

  it("cancels from the report and reopens on the upload step", async () => {
    const { user, onClose, onComplete, reopen, dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();

    const reopened = await reopen();
    expect(within(reopened).getByText(DROP_TEXT)).toBeInTheDocument();
    expect(within(reopened).queryByText(/Selected/)).not.toBeInTheDocument();
    expect(within(reopened).queryByText("2 to create")).not.toBeInTheDocument();
  });

  it("folds the warnings and the changes until clicked, and folds them again", async () => {
    const { user, dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    const warning = within(dialog).getByText("Row 5: unknown locale, kept the default");
    expect(toggleHeading(dialog, /^1 warning/).textContent).toBe("1 warningexpand_more");
    expect(warning).not.toBeVisible();
    expect(toggleHeading(dialog, /to review/).textContent).toBe("1 change to reviewexpand_more");
    expect(within(dialog).getByText("display_name")).not.toBeVisible();

    await user.click(toggleHeading(dialog, /^1 warning/));
    expect(toggleHeading(dialog, /^1 warning/).textContent).toBe("1 warningexpand_less");
    await waitFor(() => expect(warning).toBeVisible());
    await user.click(toggleHeading(dialog, /^1 warning/));
    expect(toggleHeading(dialog, /^1 warning/).textContent).toBe("1 warningexpand_more");
    await waitFor(() => expect(warning).not.toBeVisible());

    await user.click(toggleHeading(dialog, /to review/));
    expect(toggleHeading(dialog, /to review/).textContent).toBe("1 change to reviewexpand_less");
    await waitFor(() => expect(within(dialog).getByText("display_name")).toBeVisible());
    await user.click(toggleHeading(dialog, /to review/));
    expect(toggleHeading(dialog, /to review/).textContent).toBe("1 change to reviewexpand_more");
  });

  it("starts the next file folded, with invites back on, after going back", async () => {
    const { user, dialog } = renderDialog();
    await pickFile();
    await within(dialog).findByText("2 to create");

    await user.click(toggleHeading(dialog, /^1 warning/));
    await user.click(toggleHeading(dialog, /to review/));
    await user.click(within(dialog).getByLabelText("Send invite emails to new users"));
    expect(within(dialog).getByLabelText("Send invite emails to new users")).not.toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).queryByText(/Selected/)).not.toBeInTheDocument();
    fireEvent.change(fileInput(), { target: { files: [new File([new Uint8Array([1])], "again.xlsx")] } });
    await within(dialog).findByText("again.xlsx — 4 rows, 1 skipped");

    expect(toggleHeading(dialog, /^1 warning/).textContent).toBe("1 warningexpand_more");
    expect(toggleHeading(dialog, /to review/).textContent).toBe("1 change to reviewexpand_more");
    expect(within(dialog).getByLabelText("Send invite emails to new users")).toBeChecked();
  });

  it("lays the changes out one row per field, naming the user once", async () => {
    const consoleError = vi.spyOn(console, "error");
    const renamed: ParsedUserRow = {
      rowIndex: 6,
      email: "Viewer@Test.local",
      display_name: "V",
      role: "member",
      existing: USERS[2],
      changes: { role: { old: "viewer", new: "member" }, locale: { old: "", new: "fr" } },
    };
    const unmatched: ParsedUserRow = {
      rowIndex: 7,
      email: "ghost@test.local",
      display_name: "Ghost",
      role: "member",
      changes: { display_name: { old: "G", new: "Ghost" } },
    };
    const unchanged: ParsedUserRow = { rowIndex: 8, email: "same@test.local", display_name: "S", role: "member" };
    h.validate.mockReturnValue(report({ updates: [UPDATE_MEMBER, renamed, unmatched, unchanged] }));
    try {
      const { user, dialog } = renderDialog();
      await pickFile();
      await user.click(await within(dialog).findByText("4 changes to review"));

      const table = within(dialog).getByRole("table");
      expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
        "User",
        "Field",
        "Current",
        "New",
      ]);
      const rows = within(table).getAllByRole("row").slice(1);
      expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
        [MEMBER_USER.email, "display_name", "Test Member", "T. Member"],
        ["locale", "(empty)", "de"],
        // The existing account's address labels the row, not the spreadsheet's spelling.
        ["viewer@test.local", "role", "viewer", "member"],
        ["locale", "(empty)", "fr"],
        ["ghost@test.local", "display_name", "G", "Ghost"],
      ]);
      expect(consoleError.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("omits the skipped note, the warnings and the changes when there are none", async () => {
    h.validate.mockReturnValue(BLOCKED_REPORT);
    const { dialog } = renderDialog();
    await pickFile();

    expect(await within(dialog).findByText("users.xlsx — 1 rows")).toBeInTheDocument();
    expect(within(dialog).queryByText(/warnings?$/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/to review/)).not.toBeInTheDocument();
  });

  it("is ready to import when it only creates users", async () => {
    h.validate.mockReturnValue(report({ creates: [CREATE_A] }));
    const { dialog } = renderDialog();
    await pickFile();

    expect(await within(dialog).findByText("Validation passed. Ready to import.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Nothing to import/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import 1 row$/ })).toBeEnabled();
  });

  it("is ready to import when it only updates users, without the invite option", async () => {
    h.validate.mockReturnValue(report({ updates: [UPDATE_MEMBER] }));
    const { dialog } = renderDialog();
    await pickFile();

    expect(await within(dialog).findByText("Validation passed. Ready to import.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Nothing to import/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Send invite emails to new users")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import 1 row$/ })).toBeEnabled();
  });

  it("says nothing about an empty file while errors block it", async () => {
    h.validate.mockReturnValue(report({ errors: [{ row: 2, message: "Row 2: invalid email" }] }));
    const { dialog } = renderDialog();
    await pickFile();

    expect(await within(dialog).findByText("1 error blocks the import")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Nothing to import/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Validation passed/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Import 0 rows/ })).toBeDisabled();
  });

  it("does not claim validation passed when there is nothing to import", async () => {
    h.validate.mockReturnValue(EMPTY_REPORT);
    const { dialog } = renderDialog();
    await pickFile();

    await within(dialog).findByText(/Nothing to import/);
    expect(within(dialog).queryByText(/Validation passed/)).not.toBeInTheDocument();
  });
});

describe("UserImportDialog progress and outcome details", () => {
  function deferredImport() {
    const ctl = {} as {
      finish: (r: UserImportResult) => void;
      progress: (done: number, total: number) => void;
    };
    h.execute.mockImplementation((_report, _invites, onProgress) => {
      ctl.progress = onProgress;
      return new Promise<UserImportResult>((resolve) => {
        ctl.finish = resolve;
      });
    });
    return ctl;
  }

  async function startImport() {
    const ctx = renderDialog();
    await pickFile();
    await within(ctx.dialog).findByText("2 to create");
    await ctx.user.click(within(ctx.dialog).getByRole("button", { name: /Import 3 rows/ }));
    await waitFor(() => expect(h.execute).toHaveBeenCalledTimes(1));
    return ctx;
  }

  it("follows the total the import reports, refuses Escape while running, and shows only progress", async () => {
    const ctl = deferredImport();
    const { onClose, onComplete, dialog } = await startImport();

    expect(within(dialog).getByText("Importing…")).toBeInTheDocument();
    expect(within(dialog).queryByText("2 to create")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(DROP_TEXT)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    ctl.progress(1, 5);
    expect(await within(dialog).findByText("1 / 5 (20%)")).toBeInTheDocument();
    ctl.progress(0, 0);
    expect(await within(dialog).findByText("0 / 0 (0%)")).toBeInTheDocument();

    ctl.finish({ created: 2, updated: 1, failed: 0, failedDetails: [] });
    expect(await within(dialog).findByText("Import complete")).toBeInTheDocument();
    // Escape now closes, and completes.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a check mark and nothing else when every row went through", async () => {
    const ctl = deferredImport();
    const { dialog } = await startImport();

    ctl.finish({ created: 0, updated: 3, failed: 0, failedDetails: [] });
    expect(await within(dialog).findByText("Import complete")).toBeInTheDocument();
    expect(within(dialog).getByText("check_circle")).toBeInTheDocument();
    expect(within(dialog).queryByText("warning")).not.toBeInTheDocument();
    expect(within(dialog).getByText("3 updated")).toBeInTheDocument();
    expect(within(dialog).queryByText(/created$/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/failed$/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    // The report and the upload step are gone; only Done remains.
    expect(within(dialog).queryByText("2 to create")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Importing…")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("flags failures with a warning icon and an error list folded until clicked", async () => {
    const ctl = deferredImport();
    const { user, dialog } = await startImport();

    ctl.finish({ created: 1, updated: 0, failed: 1, failedDetails: [{ row: 3, message: "duplicate" }] });
    expect(await within(dialog).findByText("Import complete")).toBeInTheDocument();
    expect(within(dialog).getByText("warning")).toBeInTheDocument();
    expect(within(dialog).queryByText("check_circle")).not.toBeInTheDocument();

    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveClass("MuiAlert-standardError");
    const heading = toggleHeading(dialog, /row failed/);
    const detail = within(dialog).getByText("Row 3: duplicate");
    expect(heading.textContent).toBe("1 row failedexpand_more");
    expect(detail).not.toBeVisible();

    await user.click(heading);
    expect(toggleHeading(dialog, /row failed/).textContent).toBe("1 row failedexpand_less");
    await waitFor(() => expect(detail).toBeVisible());
    await user.click(toggleHeading(dialog, /row failed/));
    expect(toggleHeading(dialog, /row failed/).textContent).toBe("1 row failedexpand_more");
    await waitFor(() => expect(detail).not.toBeVisible());
  });

  it("raises rows that went through with a caveat as a warning, not an error", async () => {
    const ctl = deferredImport();
    const { dialog } = await startImport();

    ctl.finish({ created: 2, updated: 1, failed: 0, failedDetails: [{ row: 2, message: "SMTP refused" }] });
    expect(await within(dialog).findByText("Import complete")).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveClass("MuiAlert-standardWarning");
    expect(within(dialog).getByText("check_circle")).toBeInTheDocument();
  });

  it("folds the failed rows again for the next import after Done", async () => {
    const ctl = deferredImport();
    const { user, onComplete, dialog } = await startImport();
    ctl.finish({ created: 1, updated: 0, failed: 1, failedDetails: [{ row: 3, message: "duplicate" }] });
    await user.click(await within(dialog).findByText("1 row failed"));
    expect(toggleHeading(dialog, /row failed/).textContent).toBe("1 row failedexpand_less");

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(DROP_TEXT)).toBeInTheDocument();

    h.parse.mockClear();
    await pickFile();
    await within(dialog).findByText("2 to create");
    await user.click(within(dialog).getByRole("button", { name: /Import 3 rows/ }));
    await waitFor(() => expect(h.execute).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText("0 / 3 (0%)")).toBeInTheDocument();
    ctl.finish({ created: 1, updated: 0, failed: 1, failedDetails: [{ row: 3, message: "duplicate" }] });
    expect(await within(dialog).findByText("1 row failed")).toBeInTheDocument();
    expect(toggleHeading(dialog, /row failed/).textContent).toBe("1 row failedexpand_more");
  });
});
