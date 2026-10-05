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

/** Three custom pickers: two with values, one stored without an options list. */
const CUSTOM_REL = makeRelationType({
  key: "relAppToITC",
  label: "runs on",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  attributes_schema: [
    makeField({
      key: "tier",
      label: "Tier",
      type: "single_select",
      options: [makeOption({ key: "gold", label: "Gold" }), makeOption({ key: "silver", label: "Silver" })],
    }),
    makeField({
      key: "region",
      label: "Region",
      type: "single_select",
      options: [makeOption({ key: "emea", label: "EMEA" })],
    }),
    makeField({ key: "zone", label: "Zone", type: "single_select" }),
  ],
});
const CUSTOM_PATH = `/metamodel/relation-types/${CUSTOM_REL.key}`;
const DIM_NAME = "Type name (English)";
const DIM_KEY = "Type key (e.g. usageType)";
const DUPLICATE = "This key is already used in this list";

type SavedField = { key: string; label: string; options: Array<{ key: string; label: string }> };

async function saveCustom(user: UserEvent): Promise<SavedField[]> {
  await user.click(saveButton());
  await waitFor(() => expect(mockApi.callsOf("patch", CUSTOM_PATH)).toHaveLength(1));
  return (mockApi.callsOf("patch", CUSTOM_PATH)[0].body as { attributes_schema: SavedField[] })
    .attributes_schema;
}

function values(els: HTMLElement[]): string[] {
  return els.map((el) => (el as HTMLInputElement).value);
}

describe("RelationTypeValuesDialog details", () => {
  it("shows its title and explanation, and no empty note when pickers exist", () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByText("Manage relation values")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Manage the "type" values for this relation \(e\.g\. Owner \/ User\)/),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("This relation has no type values yet. Add one below."),
    ).not.toBeInTheDocument();
  });

  it("puts the Hidden chip on the hidden built-in value only", () => {
    const { dialog } = renderDialog();
    expect(within(valueRow(dialog, "User")).getByText("Hidden")).toBeInTheDocument();
    expect(within(valueRow(dialog, "Owner")).queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("treats a relation type without a schema as having no pickers", () => {
    const { dialog } = renderDialog(
      makeRelationType({
        key: "relBare",
        source_type_key: "Application",
        target_type_key: "Application",
        attributes_schema: null as unknown as [],
      }),
    );
    expect(
      within(dialog).getByText("This relation has no type values yet. Add one below."),
    ).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("renders stored custom pickers editable, valid, and with their keys locked", () => {
    const { dialog } = renderDialog(CUSTOM_REL);

    const names = within(dialog).getAllByLabelText(DIM_NAME);
    expect(values(names)).toEqual(["Tier", "Region", "Zone"]);
    for (const n of names) expect(n).toHaveAttribute("aria-invalid", "false");
    for (const k of within(dialog).getAllByLabelText(DIM_KEY)) expect(k).toBeDisabled();
    expect(within(dialog).getAllByText("Field key cannot be changed after creation")).toHaveLength(3);

    // Zone has no options list, so only Tier's and Region's values render.
    expect(values(within(dialog).getAllByLabelText("Key"))).toEqual(["gold", "silver", "emea"]);
    for (const l of within(dialog).getAllByLabelText("Label")) {
      expect(l).toHaveAttribute("aria-invalid", "false");
    }
    expect(saveButton()).toBeEnabled();
  });

  it("adds a value only to the picker whose button was clicked, even one stored without options", async () => {
    const { user, dialog } = renderDialog(CUSTOM_REL);

    await user.click(within(dialog).getAllByRole("button", { name: /Add value/ })[2]);
    const keys = within(dialog).getAllByLabelText("Key");
    expect(keys).toHaveLength(4);
    await user.type(keys[3], "east");
    await user.type(within(dialog).getAllByLabelText("Label")[3], "East");

    const schema = await saveCustom(user);
    expect(schema.map((f) => f.options.map((o) => o.key))).toEqual([
      ["gold", "silver"],
      ["emea"],
      ["east"],
    ]);
  });

  it("removes a value from its own picker only", async () => {
    const { user, dialog } = renderDialog(CUSTOM_REL);

    await user.click(within(dialog).getAllByRole("button", { name: "close" })[0]);
    expect(values(within(dialog).getAllByLabelText("Key"))).toEqual(["silver", "emea"]);

    const schema = await saveCustom(user);
    expect(schema.map((f) => f.options.map((o) => o.key))).toEqual([["silver"], ["emea"], []]);
  });

  it("names and keys only the picker being edited", async () => {
    const { user, dialog } = renderDialog(CUSTOM_REL);

    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    await user.type(within(dialog).getAllByLabelText(DIM_NAME)[3], "Criticality");
    await user.type(within(dialog).getAllByLabelText(DIM_KEY)[3], "criticality");

    const schema = await saveCustom(user);
    expect(schema.map((f) => [f.key, f.label])).toEqual([
      ["tier", "Tier"],
      ["region", "Region"],
      ["zone", "Zone"],
      ["criticality", "Criticality"],
    ]);
  });

  it("deletes only the picker whose delete button was clicked", async () => {
    const { user, dialog } = renderDialog(CUSTOM_REL);
    await user.click(within(dialog).getAllByRole("button", { name: "Delete" })[1]);
    expect(values(within(dialog).getAllByLabelText(DIM_NAME))).toEqual(["Tier", "Zone"]);
  });

  it("flags a new picker key that repeats a stored one and refuses to save", async () => {
    const { user, dialog } = renderDialog();
    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    await user.type(within(dialog).getByLabelText(DIM_NAME), "Usage");
    await user.type(within(dialog).getByLabelText(DIM_KEY), "usageType");

    expect(within(dialog).getByText(DUPLICATE)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("does not report empty new keys as duplicates", async () => {
    const { user, dialog } = renderDialog(EMPTY_REL);
    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    await user.click(within(dialog).getAllByRole("button", { name: /Add value/ })[0]);
    await user.click(within(dialog).getAllByRole("button", { name: /Add value/ })[0]);
    expect(within(dialog).getAllByLabelText(DIM_KEY)).toHaveLength(2);
    expect(within(dialog).getAllByLabelText("Key")).toHaveLength(2);
    expect(within(dialog).queryByText(DUPLICATE)).not.toBeInTheDocument();
  });

  it("validates a new picker: whitespace is no name, and a named picker needs its key", async () => {
    const { user, dialog } = renderDialog(EMPTY_REL);
    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    const name = within(dialog).getByLabelText(DIM_NAME);
    const key = within(dialog).getByLabelText(DIM_KEY);

    // Pristine: the name is flagged, the key is not yet.
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(key).toHaveAttribute("aria-invalid", "false");

    await user.type(name, "   ");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(key).toHaveAttribute("aria-invalid", "false");
    await user.type(key, "crit");
    expect(saveButton()).toBeDisabled();

    await user.clear(name);
    await user.type(name, "Crit");
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();
    await user.clear(key);
    expect(key).toHaveAttribute("aria-invalid", "true");
  });

  it("validates a new value: whitespace is no label, and a labelled value needs its key", async () => {
    const { user, dialog } = renderDialog(EMPTY_REL);
    await user.click(within(dialog).getByRole("button", { name: /Add type/ }));
    await user.type(within(dialog).getByLabelText(DIM_NAME), "Crit");
    await user.type(within(dialog).getByLabelText(DIM_KEY), "crit");
    await user.click(within(dialog).getByRole("button", { name: /Add value/ }));
    const key = within(dialog).getByLabelText("Key");
    const label = within(dialog).getByLabelText("Label");

    expect(key).toHaveAttribute("aria-invalid", "false");
    expect(label).toHaveAttribute("aria-invalid", "true");

    await user.type(label, "   ");
    expect(key).toHaveAttribute("aria-invalid", "false");
    expect(label).toHaveAttribute("aria-invalid", "true");
    await user.type(key, "high");
    expect(saveButton()).toBeDisabled();

    await user.clear(label);
    await user.type(label, "High");
    expect(label).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();
    await user.clear(key);
    expect(key).toHaveAttribute("aria-invalid", "true");
  });

  it("flags a stored row that has neither a key nor a label", () => {
    const { dialog } = renderDialog(
      makeRelationType({
        key: "relBroken",
        source_type_key: "Application",
        target_type_key: "Application",
        attributes_schema: [
          makeField({
            key: "",
            label: undefined as unknown as string,
            type: "single_select",
            options: [makeOption({ key: "", label: undefined as unknown as string })],
          }),
        ],
      }),
    );
    expect(within(dialog).getByLabelText(DIM_NAME)).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("Label")).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
  });
});

describe("RelationTypeValuesDialog lifecycle and saving", () => {
  it("renders empty and never saves while no relation type is given", async () => {
    const user = userEvent.setup();
    render(<RelationTypeValuesDialog open relationType={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("This relation has no type values yet. Add one below."),
    ).toBeInTheDocument();
    await user.click(saveButton());
    expect(mockApi.callsOf("patch")).toHaveLength(0);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reloads the pickers when the relation type changes", async () => {
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    const { rerender } = render(<RelationTypeValuesDialog open relationType={REL} {...props} />);
    expect(screen.getByText("Usage type")).toBeInTheDocument();

    rerender(<RelationTypeValuesDialog open relationType={CUSTOM_REL} {...props} />);
    await waitFor(() => expect(screen.queryByText("Usage type")).not.toBeInTheDocument());
    expect(values(screen.getAllByLabelText(DIM_NAME))).toEqual(["Tier", "Region", "Zone"]);
  });

  it("clears a previous save error when the dialog is reopened", async () => {
    mockApi.fail("patch", PATH, 400, "Key already exists on this relation");
    const props = { onClose: vi.fn(), onSaved: vi.fn() };
    const user = userEvent.setup();
    const { rerender } = render(<RelationTypeValuesDialog open relationType={REL} {...props} />);
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Key already exists on this relation");

    rerender(<RelationTypeValuesDialog open={false} relationType={REL} {...props} />);
    rerender(<RelationTypeValuesDialog open relationType={REL} {...props} />);
    await waitFor(() => expect(screen.getByText("Usage type")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Save while the request is in flight", async () => {
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
    mockApi.fail("patch", PATH, 400, "Key already exists on this relation");
    const { user, dialog, onSaved } = renderDialog();
    await user.click(saveButton());
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();

    mockApi.on("patch", PATH, {});
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to the error message when the server detail is not a string", async () => {
    mockApi.fail("patch", PATH, 422, [{ msg: "bad" }]);
    const { user, dialog } = renderDialog();
    await user.click(saveButton());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(`PATCH ${PATH} failed`);
  });

  it("shows a generic message when the failure is not an Error at all", async () => {
    mockApi.on("patch", PATH, () => Promise.reject("nope"));
    const { user, dialog } = renderDialog();
    await user.click(saveButton());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Failed to save relation values",
    );
  });
});
