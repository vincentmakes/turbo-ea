/**
 * Page-level tests for the Calculated Fields admin: the list, the four inner
 * dialogs (edit, test, recalculation results, delete confirm) and the formula
 * editor's autocomplete and highlighter.
 *
 * The sibling `CalculationsAdmin.test.tsx` covers `formatRunReport`, the
 * recalculate flow with a failing report and the active toggle against a bare
 * api mock; this file drives everything else through the shared kit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor, fireEvent } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useCalculatedFields", () =>
  import("@/test/hooks").then((m) => m.useCalculatedFieldsModule()),
);

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { installClipboard } from "@/test/dom";
import { CARDS, CARD_IDS, CARD_TYPES, RELATION_TYPES, cardPage } from "@/test/fixtures/metamodel";
import { invalidateCalculatedFields } from "@/hooks/useCalculatedFields";
import type { Calculation, CalculationRunReport } from "@/types";
import CalculationsAdmin from "./CalculationsAdmin";
import { formatRunReport } from "./calculationRunReport";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COST_CALC: Calculation = {
  id: "calc-1",
  name: "Doubled cost",
  description: "See https://example.com/docs",
  target_type_key: "Application",
  target_field_key: "costTotalAnnual",
  formula: "data.costTotalAnnual * 2",
  is_active: true,
  execution_order: 1,
  blanks_as_zero: true,
  warnings: ["PLUCK key is missing the attributes. prefix"],
  last_run_at: "2026-09-30T10:00:00Z",
};

const LICENSE_CALC: Calculation = {
  id: "calc-2",
  name: "License total",
  target_type_key: "ITComponent",
  target_field_key: "licenseCost",
  formula: "1",
  is_active: false,
  execution_order: 2,
  last_run_at: "2026-09-29T08:00:00Z",
  last_error: "division by zero",
};

/** A calculation whose type the metamodel no longer carries. */
const GHOST_CALC: Calculation = {
  id: "calc-3",
  name: "Orphan",
  target_type_key: "Ghost",
  target_field_key: "nowhere",
  formula: "0",
  is_active: true,
  execution_order: 3,
};

const CALCS = [COST_CALC, LICENSE_CALC, GHOST_CALC];

const CLEAN_REPORT: CalculationRunReport = {
  cards_processed: 3,
  calculations_succeeded: 3,
  calculations_failed: 0,
  calculations: [
    {
      calculation_id: "calc-1",
      name: "Doubled cost",
      target_field: "costTotalAnnual",
      succeeded: 3,
      failed: 0,
      failures: [],
    },
  ],
};

const MIXED_REPORT: CalculationRunReport = {
  cards_processed: 2,
  calculations_succeeded: 1,
  calculations_failed: 1,
  calculations: [
    {
      calculation_id: "calc-1",
      name: "Doubled cost",
      target_field: "costTotalAnnual",
      succeeded: 1,
      failed: 1,
      failures: [
        {
          error: "Field(s) 'costTotalAnnual' are empty on this card",
          count: 1,
          cards: [{ id: CARD_IDS.crm, name: "CRM Cloud" }],
          cards_truncated: false,
        },
      ],
    },
  ],
};

const TEXTAREA_ID = "formula-editor-textarea";
const INSERT_HINT = "Tab or Enter to insert · Esc to dismiss";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function editorTextarea(): HTMLTextAreaElement {
  const el = document.getElementById(TEXTAREA_ID);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("formula editor is not mounted");
  return el;
}

/** The highlighter's `<pre>`, rendered by the editor right before its textarea. */
function editorHighlight(): string {
  const pre = editorTextarea().previousElementSibling;
  if (!(pre instanceof HTMLPreElement)) throw new Error("highlight layer is not mounted");
  return pre.innerHTML;
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no table row for ${name}`);
  return row;
}

async function renderPage() {
  const utils = renderWithProviders(<CalculationsAdmin />);
  await screen.findByText(COST_CALC.name);
  return utils;
}

async function openNewDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: /New Calculation$/ }));
  return screen.getByRole("dialog");
}

async function openEditDialog(user: UserEvent, calcName: string): Promise<HTMLElement> {
  await user.click(within(rowOf(calcName)).getByRole("button", { name: "Edit" }));
  return screen.getByRole("dialog");
}

/** Pick an option in a MUI `Select` and wait for its menu to unmount. */
async function pickOption(user: UserEvent, combobox: HTMLElement, option: string) {
  await user.click(combobox);
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

/** A new-calculation dialog with the target type already chosen. */
async function openEditorFor(user: UserEvent, typeLabel = "Application") {
  const dialog = await openNewDialog(user);
  await pickOption(user, within(dialog).getAllByRole("combobox")[0], typeLabel);
  return dialog;
}

/** The open suggestion list (the Popper's paper), found through its footer hint. */
async function suggestionList() {
  const hint = await screen.findByText(INSERT_HINT);
  const paper = hint.closest(".MuiPaper-root");
  if (!(paper instanceof HTMLElement)) throw new Error("suggestion list is not open");
  return within(paper);
}

async function expectNoDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  mockApi.on("get", "/calculations", CALCS);
  vi.mocked(invalidateCalculatedFields).mockClear();
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe("CalculationsAdmin list", () => {
  it("renders every calculation with its type and field labels, run status and a linkified description", async () => {
    await renderPage();
    expect(mockApi.callsOf("get", "/calculations")).toHaveLength(1);

    const cost = rowOf("Doubled cost");
    expect(within(cost).getByText("Application")).toBeInTheDocument();
    // The field label comes from the metamodel, never the key.
    expect(within(cost).getByText("Total Annual Cost")).toBeInTheDocument();
    expect(within(cost).queryByText("costTotalAnnual")).not.toBeInTheDocument();
    expect(within(cost).getByText("Warning")).toBeInTheDocument();
    expect(within(cost).getByText("OK")).toBeInTheDocument();
    expect(within(cost).queryByText("Never")).not.toBeInTheDocument();
    expect(within(cost).getByRole("link", { name: "https://example.com/docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(within(cost).getByRole("checkbox")).toBeChecked();

    const license = rowOf("License total");
    expect(within(license).getByText("IT Component")).toBeInTheDocument();
    expect(within(license).getByText("License Cost")).toBeInTheDocument();
    expect(within(license).getByText("Error")).toBeInTheDocument();
    expect(within(license).queryByText("OK")).not.toBeInTheDocument();
    expect(within(license).getByRole("checkbox")).not.toBeChecked();

    // A type the metamodel does not know falls back to the raw keys.
    const ghost = rowOf("Orphan");
    expect(within(ghost).getByText("Ghost")).toBeInTheDocument();
    expect(within(ghost).getByText("nowhere")).toBeInTheDocument();
    expect(within(ghost).getByText("Never")).toBeInTheDocument();
  });

  it("filters the table by target type, offering only visible types", async () => {
    const { user } = await renderPage();

    const filter = screen.getByRole("combobox");
    await user.click(filter);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "All types" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Application" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Secret" })).not.toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: "IT Component" }));

    await waitFor(() => expect(screen.queryByText("Doubled cost")).not.toBeInTheDocument());
    expect(screen.getByText("License total")).toBeInTheDocument();
    expect(screen.queryByText("Orphan")).not.toBeInTheDocument();

    await pickOption(user, filter, "All types");
    expect(await screen.findByText("Doubled cost")).toBeInTheDocument();
    expect(screen.getByText("Orphan")).toBeInTheDocument();
  });

  it("shows the empty state when the filter matches nothing", async () => {
    const { user } = await renderPage();
    await pickOption(user, screen.getByRole("combobox"), "Provider");
    expect(await screen.findByText("No calculations defined")).toBeInTheDocument();
    expect(
      screen.getByText("Create a calculation to auto-populate card fields based on formulas."),
    ).toBeInTheDocument();
  });

  it("reports a failed list fetch in a dismissible alert", async () => {
    mockApi.fail("get", "/calculations");
    const { user } = renderWithProviders(<CalculationsAdmin />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ApiError: GET /calculations failed");
    expect(screen.getByText("No calculations defined")).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("activates an inactive calculation, drops the calculated-fields cache and reloads", async () => {
    mockApi.on("post", "/calculations/calc-2/activate", {});
    const { user } = await renderPage();

    await user.click(within(rowOf("License total")).getByRole("checkbox"));

    await waitFor(() => expect(mockApi.callsOf("post", "/calculations/calc-2/activate")).toHaveLength(1));
    expect(invalidateCalculatedFields).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockApi.callsOf("get", "/calculations")).toHaveLength(2));
  });

  it("reports a failed toggle in the page alert", async () => {
    mockApi.fail("post", "/calculations/calc-2/activate");
    const { user } = await renderPage();

    await user.click(within(rowOf("License total")).getByRole("checkbox"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ApiError: POST /calculations/calc-2/activate failed",
    );
    expect(invalidateCalculatedFields).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("CalculationsAdmin delete", () => {
  it("asks for confirmation, cancels, then deletes and reloads", async () => {
    mockApi.on("delete", "/calculations/calc-1", {});
    const { user } = await renderPage();

    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Delete" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete Calculation")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Are you sure you want to delete "Doubled cost"? This cannot be undone.',
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    // Escape is the dialog's own way out and deletes nothing either.
    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await expectNoDialog();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Delete" }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockApi.callsOf("delete", "/calculations/calc-1")).toHaveLength(1));
    await expectNoDialog();
    expect(invalidateCalculatedFields).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockApi.callsOf("get", "/calculations")).toHaveLength(2));
  });

  it("reports a failed delete in the page alert", async () => {
    mockApi.fail("delete", "/calculations/calc-3", 409, "in use");
    const { user } = await renderPage();

    await user.click(within(rowOf("Orphan")).getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    // The confirm dialog stays open on failure, so the page alert sits behind
    // the modal (aria-hidden) until it is cancelled.
    expect(
      await screen.findByText("ApiError: DELETE /calculations/calc-3 failed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await expectNoDialog();
    expect(screen.getByRole("alert")).toHaveTextContent("ApiError: DELETE /calculations/calc-3 failed");
    expect(invalidateCalculatedFields).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Recalculate + result dialog
// ---------------------------------------------------------------------------

describe("CalculationsAdmin recalculate", () => {
  let clipboard: ReturnType<typeof installClipboard>;

  beforeEach(() => {
    // Before `userEvent.setup()` (which `renderWithProviders` runs), as the kit requires.
    clipboard = installClipboard();
  });
  afterEach(() => clipboard());

  it("runs the type's calculations, reloads the list and offers the detail dialog with a copyable report", async () => {
    mockApi.on("post", "/calculations/recalculate/Application", CLEAN_REPORT);
    const { user } = await renderPage();
    // `userEvent.setup()` swaps in its own clipboard stub after the kit's, so
    // spy on whichever object is live rather than on the kit's mock.
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Recalculate all" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Application:");
    expect(alert).toHaveTextContent("Processed 3 cards: 3 succeeded, 0 failed");
    expect(alert).toHaveClass("MuiAlert-standardSuccess");
    await waitFor(() => expect(mockApi.callsOf("get", "/calculations")).toHaveLength(2));

    await user.click(within(alert).getByRole("button", { name: "View details" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Recalculation results — Application")).toBeInTheDocument();
    expect(within(dialog).getByText("3 cards ok")).toBeInTheDocument();
    expect(within(dialog).getByText("Every card computed cleanly.")).toBeInTheDocument();

    // A refused clipboard leaves the button as it was; a granted one flips it.
    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(within(dialog).getByRole("button", { name: /Copy report$/ }));
    expect(within(dialog).getByRole("button", { name: /Copy report$/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Copy report$/ }));
    expect(await within(dialog).findByRole("button", { name: /Copied$/ })).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith(formatRunReport(CLEAN_REPORT, "Application"));

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await expectNoDialog();
  });

  it("warns when some cards failed and lists the failing card without an overflow note", async () => {
    mockApi.on("post", "/calculations/recalculate/Application", MIXED_REPORT);
    const { user } = await renderPage();

    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Recalculate all" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("MuiAlert-standardWarning");
    expect(alert).toHaveTextContent("Processed 2 cards: 1 succeeded, 1 failed");

    await user.click(within(alert).getByRole("button", { name: "View details" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("1 card ok")).toBeInTheDocument();
    expect(within(dialog).getByText("1 card failed")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "CRM Cloud" })).toHaveAttribute(
      "href",
      `/cards/${CARD_IDS.crm}`,
    );
    expect(within(dialog).queryByText(/more/)).not.toBeInTheDocument();
  });

  it("reports a failed run as an error without a details button", async () => {
    mockApi.fail("post", "/calculations/recalculate/Ghost");
    const { user } = await renderPage();

    await user.click(within(rowOf("Orphan")).getByRole("button", { name: "Recalculate all" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("MuiAlert-standardError");
    expect(alert).toHaveTextContent("Ghost:");
    expect(alert).toHaveTextContent("Error: ApiError: POST /calculations/recalculate/Ghost failed");
    expect(within(alert).queryByRole("button", { name: "View details" })).not.toBeInTheDocument();
    // The list is not re-read after a failed run.
    expect(mockApi.callsOf("get", "/calculations")).toHaveLength(1);

    await user.click(within(alert).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

describe("CalculationsAdmin edit dialog", () => {
  it("creates a calculation: required-field guard, eligible targets, every control, validate, save", async () => {
    mockApi.on("post", "/calculations/validate", {
      valid: true,
      preview_result: 42,
      warnings: ["Formula references no relation"],
    });
    mockApi.on("post", "/calculations", { ...COST_CALC, id: "calc-9" });
    const { user } = await renderPage();

    const dialog = await openNewDialog(user);
    expect(within(dialog).getByText("New Calculation")).toBeInTheDocument();
    // Nothing to validate yet, and nothing to reference either.
    expect(within(dialog).getByRole("button", { name: "Validate" })).toBeDisabled();
    expect(within(dialog).queryByText("Available Fields (data.<fieldKey>)")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Relation Types")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(
      within(dialog).getByText("Name, target type, target field, and formula are required."),
    ).toBeInTheDocument();
    expect(mockApi.callsOf("post")).toHaveLength(0);

    await user.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Margin");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Cost × 2");

    const [typeSelect, fieldSelect] = within(dialog).getAllByRole("combobox");
    expect(fieldSelect).toHaveAttribute("aria-disabled", "true");
    await user.click(typeSelect);
    let listbox = await screen.findByRole("listbox");
    expect(within(listbox).queryByRole("option", { name: "Secret" })).not.toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: "Application" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    // Only number / cost / percentage / text / single_select / boolean fields may be targets.
    await user.click(fieldSelect);
    listbox = await screen.findByRole("listbox");
    const offered = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(offered).toEqual([
      "Alias (text)",
      "Business Criticality (single_select)",
      "Total Annual Cost (cost)",
      "Cloud Hosted (boolean)",
      "Test Coverage (percentage)",
      "Vendor Score (number)",
    ]);
    await user.click(within(listbox).getByRole("option", { name: "Total Annual Cost (cost)" }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    const order = within(dialog).getByRole("spinbutton", { name: "Execution Order" });
    expect(order).toHaveValue(0);
    await user.clear(order);
    await user.type(order, "5");
    expect(order).toHaveValue(5);

    const blanks = within(dialog).getByRole("checkbox", { name: "Treat blank numbers as zero" });
    expect(blanks).not.toBeChecked();
    await user.click(blanks);
    expect(blanks).toBeChecked();

    await user.type(editorTextarea(), "data.costTotalAnnual * 2");
    expect(editorTextarea()).toHaveValue("data.costTotalAnnual * 2");

    await user.click(within(dialog).getByRole("button", { name: "Validate" }));
    expect(await within(dialog).findByText("Valid")).toBeInTheDocument();
    expect(within(dialog).getByText("Preview: 42")).toBeInTheDocument();
    expect(within(dialog).getByText("Formula references no relation")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/calculations/validate")[0].body).toEqual({
      formula: "data.costTotalAnnual * 2",
      target_type_key: "Application",
    });

    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockApi.callsOf("post", "/calculations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/calculations")[0].body).toEqual({
      name: "Margin",
      description: "Cost × 2",
      target_type_key: "Application",
      target_field_key: "costTotalAnnual",
      formula: "data.costTotalAnnual * 2",
      execution_order: 5,
      blanks_as_zero: true,
    });
    expect(invalidateCalculatedFields).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockApi.callsOf("get", "/calculations")).toHaveLength(2));
    await expectNoDialog();
  });

  it("edits an existing calculation and resets the form for the next new one", async () => {
    mockApi.on("patch", "/calculations/calc-1", COST_CALC);
    const { user } = await renderPage();

    const dialog = await openEditDialog(user, "Doubled cost");
    expect(within(dialog).getByText("Edit Calculation")).toBeInTheDocument();
    const name = within(dialog).getByRole("textbox", { name: /^Name/ });
    expect(name).toHaveValue("Doubled cost");
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue(
      "See https://example.com/docs",
    );
    const [typeSelect, fieldSelect] = within(dialog).getAllByRole("combobox");
    expect(typeSelect).toHaveTextContent("Application");
    expect(fieldSelect).toHaveTextContent("Total Annual Cost (cost)");
    expect(within(dialog).getByRole("spinbutton", { name: "Execution Order" })).toHaveValue(1);
    expect(within(dialog).getByRole("checkbox", { name: "Treat blank numbers as zero" })).toBeChecked();
    expect(editorTextarea()).toHaveValue("data.costTotalAnnual * 2");

    await user.clear(name);
    await user.type(name, "Tripled cost");
    await user.clear(within(dialog).getByRole("textbox", { name: "Description" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockApi.callsOf("patch", "/calculations/calc-1")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/calculations/calc-1")[0].body).toEqual({
      name: "Tripled cost",
      description: null,
      target_type_key: "Application",
      target_field_key: "costTotalAnnual",
      formula: "data.costTotalAnnual * 2",
      execution_order: 1,
      blanks_as_zero: true,
    });
    expect(invalidateCalculatedFields).toHaveBeenCalledTimes(1);
    await expectNoDialog();

    // Opening "New" afterwards starts from a blank form, not the edited one.
    const fresh = await openNewDialog(user);
    expect(within(fresh).getByText("New Calculation")).toBeInTheDocument();
    expect(within(fresh).getByRole("textbox", { name: /^Name/ })).toHaveValue("");
    expect(within(fresh).getByRole("spinbutton", { name: "Execution Order" })).toHaveValue(0);
    expect(within(fresh).getByRole("checkbox", { name: "Treat blank numbers as zero" })).not.toBeChecked();
    expect(editorTextarea()).toHaveValue("");
  });

  it("changing the target type clears the target field", async () => {
    const { user } = await renderPage();
    const dialog = await openEditDialog(user, "Doubled cost");
    const [typeSelect, fieldSelect] = within(dialog).getAllByRole("combobox");

    await pickOption(user, typeSelect, "IT Component");
    expect(fieldSelect).not.toHaveTextContent("Total Annual Cost");
    await user.click(fieldSelect);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Version (text)",
      "License Cost (cost)",
    ]);
  });

  it("shows the backend's validation error, and a failed request as invalid", async () => {
    mockApi.on("post", "/calculations/validate", { valid: false, error: "Unknown field 'foo'" });
    const { user } = await renderPage();
    const dialog = await openEditDialog(user, "Doubled cost");

    await user.click(within(dialog).getByRole("button", { name: "Validate" }));
    expect(await within(dialog).findByText("Invalid")).toBeInTheDocument();
    expect(within(dialog).getByText("Unknown field 'foo'")).toBeInTheDocument();

    // Editing the formula discards the previous verdict.
    await user.type(editorTextarea(), "1");
    expect(within(dialog).queryByText("Invalid")).not.toBeInTheDocument();

    mockApi.fail("post", "/calculations/validate", 500, "boom");
    await user.click(within(dialog).getByRole("button", { name: "Validate" }));
    expect(await within(dialog).findByText("Invalid")).toBeInTheDocument();
    expect(
      within(dialog).getByText("ApiError: POST /calculations/validate failed"),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the error when saving fails", async () => {
    mockApi.fail("patch", "/calculations/calc-1", 422, "bad formula");
    const { user } = await renderPage();
    const dialog = await openEditDialog(user, "Doubled cost");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("ApiError: PATCH /calculations/calc-1 failed"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(invalidateCalculatedFields).not.toHaveBeenCalled();
  });

  it("cancels without saving", async () => {
    const { user } = await renderPage();
    const dialog = await openEditDialog(user, "License total");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await expectNoDialog();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Formula editor — autocomplete
// ---------------------------------------------------------------------------

describe("FormulaEditor suggestions", () => {
  it("suggests context variables after two characters, inserts with Enter, then lists the type's fields after data.", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "d");
    await waitFor(() => expect(screen.queryByText(INSERT_HINT)).not.toBeInTheDocument());
    await user.type(textarea, "a");
    let list = await suggestionList();
    expect(list.getByText("data")).toBeInTheDocument();
    expect(list.getByText("Card fields object")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(textarea).toHaveValue("data");
    await waitFor(() => expect(screen.queryByText(INSERT_HINT)).not.toBeInTheDocument());

    await user.clear(textarea);
    await user.type(textarea, "data.");
    list = await suggestionList();
    expect(list.getByText("Card name (text)")).toBeInTheDocument();
    // The chosen type's own fields, labelled from the metamodel.
    expect(list.getByText("Total Annual Cost (cost)")).toBeInTheDocument();
    expect(list.getByText("Alias (text)")).toBeInTheDocument();
    expect(list.getAllByText("Business Information").length).toBeGreaterThan(0);

    await user.type(textarea, "cost");
    await waitFor(() => expect(screen.queryByText("Card name (text)")).not.toBeInTheDocument());
    list = await suggestionList();
    expect(list.getByText("costTotalAnnual")).toBeInTheDocument();

    await user.keyboard("{Tab}");
    expect(textarea).toHaveValue("data.costTotalAnnual");
    expect(textarea).toHaveFocus();
  });

  // Regression (2.157.0): `applySuggestion` used to set a flag meant to swallow
  // an onChange echo the editor never sends (react-simple-code-editor only
  // calls `onValueChange` on a real input event), so the flag survived until
  // the user's NEXT keystroke and swallowed that one instead: typing "." right
  // after accepting "data" showed no field list until a second character.
  it("lists the fields as soon as a dot follows an accepted suggestion", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "da");
    await suggestionList();
    await user.keyboard("{Enter}");
    expect(textarea).toHaveValue("data");

    await user.type(textarea, ".");
    const list = await suggestionList();
    expect(list.getByText("Card name (text)")).toBeInTheDocument();
  });

  it("lists relation keys after relations. and relation_count., PPM measures after ppm., nothing deeper", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "relations.");
    let list = await suggestionList();
    expect(list.getByText("uses (Application → ITComponent)")).toBeInTheDocument();
    expect(list.getByText("relAppToBC")).toBeInTheDocument();
    expect(list.getByText("relAppToApp")).toBeInTheDocument();
    expect(list.queryByText("relProviderToITC")).not.toBeInTheDocument();

    await user.type(textarea, "relAppToITC.");
    await waitFor(() => expect(screen.queryByText(INSERT_HINT)).not.toBeInTheDocument());

    await user.clear(textarea);
    await user.type(textarea, "relation_count.relAppToB");
    list = await suggestionList();
    expect(list.getByText("relAppToBC")).toBeInTheDocument();
    expect(list.getByText("supports (Application → BusinessCapability)")).toBeInTheDocument();
    expect(list.queryByText("relAppToITC")).not.toBeInTheDocument();
    expect(list.queryByText("relAppToApp")).not.toBeInTheDocument();

    await user.clear(textarea);
    await user.type(textarea, "ppm.");
    list = await suggestionList();
    expect(list.getByText("Planned budget (capex)")).toBeInTheDocument();
    expect(list.getByText("Amounts per fiscal year (list)")).toBeInTheDocument();
    // Only the first twenty are listed after a bare dot.
    expect(list.getByText("tasksDone")).toBeInTheDocument();
    expect(list.queryByText("tasksBlocked")).not.toBeInTheDocument();

    await user.type(textarea, "risk");
    await waitFor(() => expect(screen.queryByText("tasksDone")).not.toBeInTheDocument());
    list = await suggestionList();
    expect(list.getByText("riskScoreMax")).toBeInTheDocument();
    expect(list.getAllByText("PPM risks — all, open, and the highest risk score")).toHaveLength(3);
    // Four multi-segment paths typed keystroke by keystroke take ~6 s on their
    // own, so the global 15 s is too tight on a loaded CI shard.
  }, 30_000);

  it("navigates with the arrow keys, clamping at both ends", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "su");
    expect(await screen.findByText("SUM(list) — Sum numbers")).toBeInTheDocument();
    expect(screen.getByText("Python sum()")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(textarea).toHaveValue("sum(");

    await user.clear(textarea);
    await user.type(textarea, "su");
    expect(await screen.findByText("Python sum()")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}{Enter}");
    expect(textarea).toHaveValue("SUM(");
  });

  it("inserts a suggestion on mouse down and closes the list 200 ms after blur", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "COA");
    const item = await screen.findByText("COALESCE(v1, v2, ...) — First non-null");
    fireEvent.mouseDown(item);
    expect(textarea).toHaveValue("COALESCE(");
    await waitFor(() => expect(screen.queryByText(INSERT_HINT)).not.toBeInTheDocument());

    await user.type(textarea, "da");
    expect(await screen.findByText("Card fields object")).toBeInTheDocument();
    fireEvent.blur(textarea);
    expect(screen.getByText("Card fields object")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Card fields object")).not.toBeInTheDocument());
  });

  it("shows nothing for a short or unmatched token and ignores navigation keys then", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "x");
    await user.keyboard("{ArrowDown}{ArrowUp}");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(INSERT_HINT)).not.toBeInTheDocument();

    await user.type(textarea, "zq");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(INSERT_HINT)).not.toBeInTheDocument();
    expect(textarea).toHaveValue("xzq");
  });

  it("dismisses the suggestions on Escape", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "da");
    expect(await screen.findByText("Card fields object")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Card fields object")).not.toBeInTheDocument());
    expect(textarea).toHaveValue("da");
  });

  // Regression (2.157.0): the hint says "Esc to dismiss", but the Escape keydown
  // was not stopped from bubbling, so MUI's Dialog also handled it as
  // "escapeKeyDown" and closed the whole edit dialog, discarding the form.
  it("keeps the edit dialog open when Escape only dismisses the suggestions", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);
    const textarea = editorTextarea();

    await user.type(textarea, "da");
    expect(await screen.findByText("Card fields object")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Card fields object")).not.toBeInTheDocument());

    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(editorTextarea()).toHaveValue("da");
  });
});

// ---------------------------------------------------------------------------
// Formula editor — highlighter
// ---------------------------------------------------------------------------

describe("FormulaEditor highlighter", () => {
  it("marks builtins, functions, context, properties, strings, numbers, keywords, constants, comments and punctuation", async () => {
    const { user } = await renderPage();
    await openEditorFor(user);

    const formula = [
      'len(data.name) # trailing',
      "# full comment",
      "\"a#b\" + 'it\\'s' >= 12.5 and None",
      "IF(x, children_count) < 3",
      "1 @",
    ].join("\n");
    fireEvent.change(editorTextarea(), { target: { value: formula } });
    expect(editorTextarea()).toHaveValue(formula);

    const html = editorHighlight();
    expect(html).toContain('<span class="hl-builtin">len</span><span class="hl-punct">(</span>');
    expect(html).toContain(
      '<span class="hl-context">data</span><span class="hl-punct">.</span><span class="hl-property">name</span>',
    );
    expect(html).toContain('<span class="hl-comment"># trailing</span>');
    expect(html).toContain('<span class="hl-comment"># full comment</span>');
    // A hash inside a string is not a comment, and an escaped quote does not end one.
    expect(html).toContain('<span class="hl-string">"a#b"</span>');
    expect(html).toContain("<span class=\"hl-string\">'it\\'s'</span>");
    expect(html).toContain('<span class="hl-punct">&gt;=</span>');
    expect(html).toContain('<span class="hl-number">12.5</span>');
    expect(html).toContain('<span class="hl-keyword">and</span>');
    expect(html).toContain('<span class="hl-constant">None</span>');
    expect(html).toContain('<span class="hl-function">IF</span>');
    expect(html).toContain('<span class="hl-context">children_count</span>');
    expect(html).toContain('<span class="hl-punct">&lt;</span>');
    // Text that matches no token is escaped and kept in place.
    expect(html).toContain('<span class="hl-number">1</span> @');
    // The gutter counts the lines.
    const gutter = editorTextarea().parentElement?.parentElement?.previousElementSibling;
    expect(gutter?.textContent).toBe("12345");
  });
});

// ---------------------------------------------------------------------------
// Formula reference
// ---------------------------------------------------------------------------

describe("FormulaReference", () => {
  it("lists the chosen type's fields, its relation types, the context variables, the functions and the examples", async () => {
    const { user } = await renderPage();
    const dialog = await openEditorFor(user);

    await user.click(within(dialog).getByRole("button", { name: /^Formula Reference/ }));

    expect(within(dialog).getByText("Available Fields (data.<fieldKey>)")).toBeInTheDocument();
    expect(within(dialog).getByText("data.costTotalAnnual")).toBeInTheDocument();
    expect(within(dialog).getByTitle("Total Annual Cost (cost)")).toBeInTheDocument();
    expect(within(dialog).getByText("data.vendorScore")).toBeInTheDocument();

    expect(within(dialog).getByText("Relation Types")).toBeInTheDocument();
    expect(within(dialog).getByText("relations.relAppToITC")).toBeInTheDocument();
    expect(within(dialog).getByTitle("uses (Application → ITComponent)")).toBeInTheDocument();
    expect(within(dialog).getByText("relations.relAppToApp")).toBeInTheDocument();
    expect(within(dialog).queryByText("relations.relProviderToITC")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Also: relation_count.<key>")).toBeInTheDocument();

    expect(within(dialog).getByText("Context Variables")).toBeInTheDocument();
    expect(within(dialog).getByText("Depth in the hierarchy (1 = root)")).toBeInTheDocument();
    expect(within(dialog).getByText("The parent card, or None for a root card")).toBeInTheDocument();

    expect(within(dialog).getByText("Built-in Functions")).toBeInTheDocument();
    expect(within(dialog).getByText("COALESCE(v1, v2, ...)")).toBeInTheDocument();
    expect(within(dialog).getByText("First non-null value")).toBeInTheDocument();

    expect(within(dialog).getByText("Example Formulas")).toBeInTheDocument();
    const example = within(dialog).getByText("Example Formulas").parentElement?.querySelector("pre");
    expect(example?.innerHTML).toContain('<span class="hl-comment"># Total Budget</span>');
    expect(example?.innerHTML).toContain('<span class="hl-function">MAP_SCORE</span>');
  });
});

// ---------------------------------------------------------------------------
// Test dialog
// ---------------------------------------------------------------------------

describe("TestDialog", () => {
  it("searches after two characters with a debounce, runs the test on the picked card and clears", async () => {
    mockApi.on(
      "get",
      /^\/cards\?/,
      cardPage(CARDS.filter((c) => c.type === "Application" && c.name.startsWith("ERP"))),
    );
    mockApi.on("post", "/calculations/calc-1/test", {
      success: true,
      computed_value: 500000,
      card_name: "ERP Core",
    });
    const { user } = await renderPage();

    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Test with card" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Test Calculation: Doubled cost")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Search for a Application to test this formula against. The result will not be saved.",
      ),
    ).toBeInTheDocument();
    const testButton = within(dialog).getByRole("button", { name: "Test" });
    expect(testButton).toBeDisabled();

    const input = within(dialog).getByRole("combobox", { name: "Search Application" });
    expect(input).toHaveAttribute("placeholder", "Type a application name...");

    await user.type(input, "E");
    expect(await screen.findByText("Type to search...")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(mockApi.callsOf("get", /^\/cards/)).toHaveLength(0);

    await user.type(input, "R");
    await waitFor(() => expect(mockApi.callsOf("get", /^\/cards/)).toHaveLength(1));
    expect(mockApi.callsOf("get", /^\/cards/)[0].path).toBe(
      "/cards?type=Application&search=ER&page_size=15",
    );
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("ERP Core")).toBeInTheDocument();
    expect(within(listbox).getByText("Business Application")).toBeInTheDocument();
    expect(within(listbox).getByText("ERP Legacy")).toBeInTheDocument();

    await user.click(within(listbox).getByText("ERP Core"));
    expect(input).toHaveValue("ERP Core");
    expect(testButton).toBeEnabled();

    // Reopening marks the picked card as selected, matched by id.
    await user.click(within(dialog).getByTitle("Open"));
    const reopened = await screen.findByRole("listbox");
    expect(within(reopened).getByRole("option", { name: /ERP Core/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(reopened).getByRole("option", { name: /ERP Legacy/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await user.click(within(dialog).getByTitle("Close"));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());

    await user.click(testButton);
    expect(await within(dialog).findByText(/Computed value for "ERP Core":/)).toBeInTheDocument();
    expect(within(dialog).getByText("500000")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/calculations/calc-1/test")[0].body).toEqual({
      card_id: CARD_IDS.erp,
    });

    await user.click(within(dialog).getByTitle("Clear"));
    expect(input).toHaveValue("");
    expect(testButton).toBeDisabled();
    await waitFor(() => expect(within(dialog).queryByText("500000")).not.toBeInTheDocument());

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await expectNoDialog();
  });

  it("shows the backend's failure, a thrown request, and an empty search", async () => {
    mockApi.on("get", /^\/cards\?/, cardPage([CARDS[4]]));
    mockApi.on("post", "/calculations/calc-1/test", { success: false, error: "division by zero" });
    const { user } = await renderPage();

    await user.click(within(rowOf("Doubled cost")).getByRole("button", { name: "Test with card" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("combobox");

    await user.type(input, "ERP");
    await user.click(await screen.findByText("ERP Core"));
    await user.click(within(dialog).getByRole("button", { name: "Test" }));
    expect(await within(dialog).findByText("division by zero")).toBeInTheDocument();

    mockApi.fail("post", "/calculations/calc-1/test", 500, "boom");
    await user.click(within(dialog).getByRole("button", { name: "Test" }));
    expect(
      await within(dialog).findByText("ApiError: POST /calculations/calc-1/test failed"),
    ).toBeInTheDocument();

    // A failed search is an empty list, not a crash.
    mockApi.fail("get", /^\/cards\?/, 500, "boom");
    await user.clear(input);
    await user.type(input, "ZZ");
    expect(await screen.findByText("No cards found")).toBeInTheDocument();
    expect(mockApi.callsOf("get", /^\/cards\?/).at(-1)?.path).toContain("search=ZZ");
  });

  it("falls back to the raw type key when the metamodel does not know the type", async () => {
    const { user } = await renderPage();
    await user.click(within(rowOf("Orphan")).getByRole("button", { name: "Test with card" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Test Calculation: Orphan")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Search for a Ghost to test this formula against. The result will not be saved."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Search Ghost" })).toBeInTheDocument();
  });
});
