/**
 * The relation "type values" editor: built-in dimensions and values are locked
 * but hideable, custom ones are editable, new dimensions and values can be
 * added, and the cleaned `attributes_schema` is PATCHed. `ColorPicker` is
 * stubbed with a plain input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/components/ColorPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (c: string) => void }) => (
    <input aria-label="color" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { mockApi } from "@/test/apiMock";
import { makeField, makeOption, makeRelationType } from "@/test/fixtures/metamodel";
import RelationTypeValuesDialog from "./RelationTypeValuesDialog";

const REL = makeRelationType({
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  attributes_schema: [
    makeField({
      key: "usageType",
      label: "Usage type",
      type: "single_select",
      built_in: true,
      options: [
        makeOption({ key: "owner", label: "Owner", color: "#111111", built_in: true }),
        makeOption({ key: "user", label: "User", built_in: true, hidden: true }),
        makeOption({ key: "partner", label: "Partner", color: "#222222" }),
      ],
    }),
    // Not a picker, so the dialog neither shows nor touches it.
    makeField({ key: "note", label: "Note", type: "text" }),
  ],
});
const EMPTY_REL = makeRelationType({
  key: "relAppToBC",
  label: "supports",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  attributes_schema: [],
});
const PATH = `/metamodel/relation-types/${REL.key}`;

function renderDialog(relationType = REL) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(
    <RelationTypeValuesDialog open relationType={relationType} onClose={onClose} onSaved={onSaved} />,
  );
  return { user, onClose, onSaved, dialog: screen.getByRole("dialog") };
}

/** A built-in value's row: lock glyph, swatch, label, optional Hidden chip and its eye button. */
function valueRow(dialog: HTMLElement, label: string): HTMLElement {
  const row = within(dialog).getByText(label).parentElement;
  if (!row) throw new Error(`no row for value ${label}`);
  return row;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save" });
}

async function save(user: UserEvent) {
  await user.click(saveButton());
  await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
  return (mockApi.callsOf("patch", PATH)[0].body as { attributes_schema: unknown[] }).attributes_schema;
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("patch", /^\/metamodel\/relation-types\//, {});
});

describe("RelationTypeValuesDialog", () => {
  it("renders the built-in dimension locked, its values by state, and skips non-picker fields", () => {
    const { dialog } = renderDialog();

    expect(within(dialog).getByText("Usage type")).toBeInTheDocument();
    expect(within(dialog).getByText("Built-in")).toBeInTheDocument();
    expect(within(dialog).queryByText("Note")).not.toBeInTheDocument();

    expect(within(dialog).getByText("Owner")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Hide value" })).toBeInTheDocument();
    expect(within(dialog).getByText("User")).toBeInTheDocument();
    expect(within(dialog).getByText("Hidden")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Show value" })).toBeInTheDocument();

    // The custom value is editable, but its stored key stays locked.
    const key = within(dialog).getByLabelText("Key");
    expect(key).toHaveValue("partner");
    expect(key).toBeDisabled();
    expect(within(dialog).getByText("Key is locked")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Label")).toHaveValue("Partner");
    expect(within(dialog).getByLabelText("color")).toHaveValue("#222222");
    expect(saveButton()).toBeEnabled();
  });

  it("shows the empty note for a relation without pickers and saves an empty schema", async () => {
    const { user, onSaved, onClose, dialog } = renderDialog(EMPTY_REL);

    expect(
      within(dialog).getByText("This relation has no type values yet. Add one below."),
    ).toBeInTheDocument();
    await user.click(saveButton());

    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/metamodel/relation-types/${EMPTY_REL.key}`)).toHaveLength(1),
    );
    expect(mockApi.callsOf("patch")[0].body).toEqual({ attributes_schema: [] });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides and shows built-in values, keeps the text field and strips editor markers", async () => {
    const { user, dialog } = renderDialog();

    await user.click(within(valueRow(dialog, "Owner")).getByRole("button", { name: "Hide value" }));
    await user.click(within(valueRow(dialog, "User")).getByRole("button", { name: "Show value" }));
    const schema = await save(user);

    expect(schema).toEqual([
      {
        key: "usageType",
        label: "Usage type",
        type: "single_select",
        built_in: true,
        options: [
          { key: "owner", label: "Owner", color: "#111111", built_in: true, hidden: true },
          // A value without a colour is persisted with the picker's default.
          { key: "user", label: "User", color: "#1976d2", built_in: true, hidden: false },
          { key: "partner", label: "Partner", color: "#222222" },
        ],
      },
      { key: "note", label: "Note", type: "text", options: [] },
    ]);
    for (const field of schema as Array<Record<string, unknown>>) {
      expect(field).not.toHaveProperty("_original");
    }
  });

  it("adds a value with a key, label and colour, and blocks saving until both are filled", async () => {
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: /Add value/ }));
    expect(saveButton()).toBeDisabled();

    const keys = within(dialog).getAllByLabelText("Key");
    const labels = within(dialog).getAllByLabelText("Label");
    const colors = within(dialog).getAllByLabelText("color");
    await user.type(keys[keys.length - 1], "Vendor-1");
    expect(saveButton()).toBeDisabled();
    await user.type(labels[labels.length - 1], "Vendor");
    expect(saveButton()).toBeEnabled();
    // The stub shows the default colour while the option has none, so clearing it
    // would snap back to that default; set the value in one change instead.
    fireEvent.change(colors[colors.length - 1], { target: { value: "#ff0000" } });

    const schema = (await save(user)) as Array<{ options: unknown[] }>;
    expect(schema[0].options[3]).toEqual({
      key: "Vendor1",
      label: "Vendor",
      color: "#ff0000",
      translations: { en: "Vendor" },
    });
  });

  it("flags a duplicate value key and refuses to save", async () => {
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: /Add value/ }));
    const keys = within(dialog).getAllByLabelText("Key");
    const labels = within(dialog).getAllByLabelText("Label");
    await user.type(keys[keys.length - 1], "owner");
    await user.type(labels[labels.length - 1], "Owner again");

    expect(within(dialog).getByText("This key is already used in this list")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("removes a custom value", async () => {
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: "close" }));
    expect(within(dialog).queryByLabelText("Label")).not.toBeInTheDocument();

    const schema = (await save(user)) as Array<{ options: Array<{ key: string }> }>;
    expect(schema[0].options.map((o) => o.key)).toEqual(["owner", "user"]);
  });

  it("adds a new type dimension, names it in the current locale, and can remove it again", async () => {
    const { user, dialog } = renderDialog(EMPTY_REL);

    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    expect(saveButton()).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type name (English)"), "Criticality");
    expect(saveButton()).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type key (e.g. usageType)"), "criticality");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toEqual({
      attributes_schema: [
        {
          key: "criticality",
          label: "Criticality",
          type: "single_select",
          options: [],
          translations: { en: "Criticality" },
        },
      ],
    });
  });

  it("drops a dimension from its delete button", async () => {
    const { user, dialog } = renderDialog(EMPTY_REL);

    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    expect(within(dialog).getByLabelText("Type name (English)")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(within(dialog).queryByLabelText("Type name (English)")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("This relation has no type values yet. Add one below."),
    ).toBeInTheDocument();
  });

  it("shows the server's detail when saving fails and stays open", async () => {
    mockApi.fail("patch", PATH, 400, "Key already exists on this relation");
    const { user, onSaved, onClose, dialog } = renderDialog();

    await user.click(saveButton());

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Key already exists on this relation",
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("cancels without saving", async () => {
    const { user, onClose, dialog } = renderDialog();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });
});
