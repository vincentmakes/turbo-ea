/**
 * The hierarchy link-label editor: stored keys stay locked, new labels need a
 * valid key and a label, removing a stored label asks about the cards using
 * it, and the cleaned list is PATCHed onto the card type. `ColorPicker` is
 * stubbed with a plain input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/components/ColorPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (c: string) => void }) => (
    <input aria-label="color" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { mockApi } from "@/test/apiMock";
import { installConfirm } from "@/test/dom";
import { makeCardType, makeOption } from "@/test/fixtures/metamodel";
import HierarchyLabelsDialog from "./HierarchyLabelsDialog";

const SITE = makeCardType({
  key: "Site",
  label: "Site",
  has_hierarchy: true,
  hierarchy_labels: [
    makeOption({ key: "primary", label: "Primary", color: "#123456" }),
    makeOption({ key: "backup", label: "Backup" }),
  ],
});
const BARE = makeCardType({ key: "Region", label: "Region", has_hierarchy: true });
const PATH = "/metamodel/types/Site";
const usagePath = (key: string) => `${PATH}/hierarchy-label-usage?label_key=${key}`;

function renderDialog(cardType = SITE) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<HierarchyLabelsDialog open cardType={cardType} onClose={onClose} onSaved={onSaved} />);
  return { user, onClose, onSaved, dialog: screen.getByRole("dialog") };
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" });
}

async function savedLabels(user: UserEvent, path = PATH) {
  await user.click(saveButton());
  await waitFor(() => expect(mockApi.callsOf("patch", path)).toHaveLength(1));
  return (mockApi.callsOf("patch", path)[0].body as { hierarchy_labels: unknown[] }).hierarchy_labels;
}

let confirm: ReturnType<typeof installConfirm>;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("patch", /^\/metamodel\/types\//, {});
  confirm = installConfirm(true);
});

afterEach(() => {
  confirm.mockRestore();
});

describe("HierarchyLabelsDialog", () => {
  it("renders stored labels with locked keys and their colours", () => {
    const { dialog } = renderDialog();

    const keys = within(dialog).getAllByLabelText("Key");
    expect(keys.map((k) => (k as HTMLInputElement).value)).toEqual(["primary", "backup"]);
    for (const k of keys) expect(k).toBeDisabled();
    expect(
      within(dialog).getAllByText("Cards already store this key, so it cannot be renamed."),
    ).toHaveLength(2);
    const labels = within(dialog).getAllByLabelText("Label (English)");
    expect(labels.map((l) => (l as HTMLInputElement).value)).toEqual(["Primary", "Backup"]);
    const colors = within(dialog).getAllByLabelText("color");
    expect(colors.map((c) => (c as HTMLInputElement).value)).toEqual(["#123456", "#1976d2"]);
    expect(saveButton()).toBeEnabled();
  });

  it("adds a label, requiring a valid key and a label, and saves the cleaned list", async () => {
    const { user, onSaved, onClose, dialog } = renderDialog(BARE);

    expect(within(dialog).getByText("No link types defined")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    expect(within(dialog).queryByText("No link types defined")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Key"), "commercial");
    expect(saveButton()).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Label (English)"), "  Commercial ");
    expect(saveButton()).toBeEnabled();

    const labels = await savedLabels(user, "/metamodel/types/Region");
    expect(labels).toEqual([
      {
        key: "commercial",
        label: "  Commercial ",
        color: "#1976d2",
        translations: { en: "Commercial" },
      },
    ]);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("edits a stored label's text and colour, keeping the key", async () => {
    const { user, dialog } = renderDialog();

    const backupLabel = within(dialog).getAllByLabelText("Label (English)")[1];
    await user.clear(backupLabel);
    await user.type(backupLabel, "Standby");
    // The stub shows the default colour while the label has none, so clearing it
    // would snap back to that default; set the value in one change instead.
    fireEvent.change(within(dialog).getAllByLabelText("color")[1], { target: { value: "#00ff00" } });

    const labels = await savedLabels(user);
    expect(labels).toEqual([
      { key: "primary", label: "Primary", color: "#123456" },
      { key: "backup", label: "Standby", color: "#00ff00", translations: { en: "Standby" } },
    ]);
    for (const l of labels as Array<Record<string, unknown>>) {
      expect(l).not.toHaveProperty("_original");
    }
  });

  it("asks before removing a stored label that cards use, and honours the answer", async () => {
    mockApi.on("get", usagePath("primary"), { card_count: 3 });
    const { user, dialog } = renderDialog();

    confirm.mockReturnValueOnce(false);
    await user.click(within(dialog).getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^3 cards use this link type\./));
    expect(within(dialog).getAllByLabelText("Key")).toHaveLength(2);

    await user.click(within(dialog).getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(within(dialog).getAllByLabelText("Key")).toHaveLength(1));
    expect(within(dialog).getByLabelText("Key")).toHaveValue("backup");
  });

  it("removes without asking when no card uses the label, or when the count cannot be fetched", async () => {
    mockApi.on("get", usagePath("primary"), { card_count: 0 });
    mockApi.fail("get", usagePath("backup"));
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(within(dialog).getAllByLabelText("Key")).toHaveLength(1));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(dialog).queryByLabelText("Key")).not.toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
    expect(within(dialog).getByText("No link types defined")).toBeInTheDocument();
  });

  it("removes a label added in this dialog without fetching its usage", async () => {
    const { user, dialog } = renderDialog(BARE);

    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(dialog).queryByLabelText("Key")).not.toBeInTheDocument());
    expect(mockApi.callsOf("get")).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("flags duplicate keys and refuses to save", async () => {
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    const keys = within(dialog).getAllByLabelText("Key");
    await user.type(keys[keys.length - 1], "primary");
    const labels = within(dialog).getAllByLabelText("Label (English)");
    await user.type(labels[labels.length - 1], "Primary again");

    expect(within(dialog).getAllByText("This key is already used in this list")).toHaveLength(1);
    expect(saveButton()).toBeDisabled();
  });

  it("shows the server's detail when saving fails and stays open", async () => {
    mockApi.fail("patch", PATH, 400, "Label key in use");
    const { user, onSaved, onClose, dialog } = renderDialog();

    await user.click(saveButton());

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Label key in use");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the dialog title and the explanation", () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByText("Hierarchy link types")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Label each parent-child link in a card type's hierarchy/),
    ).toBeInTheDocument();
  });

  it("renders an empty list and never saves while no card type is given", async () => {
    const user = userEvent.setup();
    render(<HierarchyLabelsDialog open cardType={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("No link types defined")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Key")).not.toBeInTheDocument();
    await user.click(saveButton());
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads the labels when the card type changes", async () => {
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = render(<HierarchyLabelsDialog open cardType={SITE} {...props} />);
    expect(screen.getAllByLabelText("Key")).toHaveLength(2);

    rerender(<HierarchyLabelsDialog open cardType={BARE} {...props} />);
    await waitFor(() => expect(screen.queryByLabelText("Key")).not.toBeInTheDocument());
    expect(screen.getByText("No link types defined")).toBeInTheDocument();
  });

  it("clears a previous save error when the dialog is reopened", async () => {
    mockApi.fail("patch", PATH, 400, "Label key in use");
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    const user = userEvent.setup();
    const { rerender } = render(<HierarchyLabelsDialog open cardType={SITE} {...props} />);
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Label key in use");

    rerender(<HierarchyLabelsDialog open={false} cardType={SITE} {...props} />);
    rerender(<HierarchyLabelsDialog open cardType={SITE} {...props} />);
    await waitFor(() => expect(screen.getAllByLabelText("Key")).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Save while the request is in flight and re-enables it after a failure", async () => {
    let reject: (e: unknown) => void = () => {};
    mockApi.on("patch", PATH, () => new Promise((_, rej) => (reject = rej)));
    const { user, dialog } = renderDialog();

    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
    expect(saveButton()).toBeDisabled();

    reject(new Error("network down"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("network down");
    expect(saveButton()).toBeEnabled();
  });

  it("clears the error on a successful retry", async () => {
    mockApi.fail("patch", PATH, 400, "Label key in use");
    const { user, dialog, onSaved } = renderDialog();
    await user.click(saveButton());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Label key in use");

    mockApi.on("patch", PATH, {});
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to the error message when the server detail is not a string", async () => {
    mockApi.fail("patch", PATH, 422, [{ msg: "bad" }]);
    const { user, dialog } = renderDialog();
    await user.click(saveButton());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "PATCH /metamodel/types/Site failed",
    );
  });

  it("shows a generic message when the failure is not an Error at all", async () => {
    mockApi.on("patch", PATH, () => Promise.reject("nope"));
    const { user, dialog } = renderDialog();
    await user.click(saveButton());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Failed to save the hierarchy link types",
    );
  });

  it("refuses to save while any one row is incomplete", async () => {
    const { user, dialog } = renderDialog();
    expect(saveButton()).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    expect(saveButton()).toBeDisabled();
  });

  it("needs a key on a new row even when its label is filled in", async () => {
    const { user, dialog } = renderDialog(BARE);
    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    await user.type(within(dialog).getByLabelText("Label (English)"), "Commercial");
    expect(saveButton()).toBeDisabled();
  });

  it("treats a whitespace-only label as missing", async () => {
    const { user, dialog } = renderDialog(BARE);
    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    await user.type(within(dialog).getByLabelText("Key"), "commercial");
    const label = within(dialog).getByLabelText("Label (English)");
    expect(label).toHaveAttribute("aria-invalid", "true");
    await user.type(label, "   ");
    expect(label).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
    await user.type(label, "x");
    expect(label).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();
  });

  it("marks stored labels as valid and a stored label without any text as invalid", () => {
    const type = makeCardType({
      key: "Site",
      has_hierarchy: true,
      hierarchy_labels: [
        makeOption({ key: "primary", label: "Primary" }),
        makeOption({ key: "nameless", label: undefined as unknown as string }),
      ],
    });
    const { dialog } = renderDialog(type);
    const labels = within(dialog).getAllByLabelText("Label (English)");
    expect(labels[0]).toHaveAttribute("aria-invalid", "false");
    expect(labels[1]).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
  });

  it("does not report two empty new keys as duplicates", async () => {
    const { user, dialog } = renderDialog(BARE);
    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    await user.click(within(dialog).getByRole("button", { name: /Add link type/ }));
    expect(within(dialog).getAllByLabelText("Key")).toHaveLength(2);
    expect(within(dialog).queryByText("This key is already used in this list")).not.toBeInTheDocument();
  });

  it("cancels without saving", async () => {
    const { user, onClose, dialog } = renderDialog();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });
});
