/**
 * The relation "type values" editor, regression tests: a custom row's red
 * flag and the Save check read the same rule — the canonical `label`, the
 * fallback every locale without a translation shows — and the name field shows
 * text exactly when that rule is met, so a row never looks valid while Save
 * refuses it, or the reverse.
 *
 * Same harness as `RelationTypeValuesDialog.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/components/ColorPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (c: string) => void }) => (
    <input aria-label="color" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { mockApi } from "@/test/apiMock";
import { makeField, makeOption, makeRelationType } from "@/test/fixtures/metamodel";
import type { FieldDef } from "@/types";
import RelationTypeValuesDialog from "./RelationTypeValuesDialog";

const DIM_NAME = "Type name (English)";

function relWith(field: FieldDef) {
  return makeRelationType({
    key: "relAppToITC",
    label: "runs on",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    attributes_schema: [field],
  });
}
const PATH = "/metamodel/relation-types/relAppToITC";

function renderDialog(field: FieldDef) {
  const user = userEvent.setup();
  render(
    <RelationTypeValuesDialog open relationType={relWith(field)} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
  return { user, dialog: screen.getByRole("dialog") };
}

const saveButton = () => screen.getByRole("button", { name: "Save" });

beforeEach(() => {
  mockApi.reset();
  mockApi.on("patch", PATH, {});
});

describe("RelationTypeValuesDialog — a stored row's label", () => {
  // The name field shows this locale's text, or the label when there is none;
  // the red flag and Save read the label. A stored row lacking a label takes
  // this locale's text as one, so what the field shows is what is checked.
  it("takes a stored row's text here as its label when it has none, and saves it", async () => {
    const { user, dialog } = renderDialog(
      makeField({
        key: "tier",
        label: "",
        translations: { en: "Tier" },
        type: "single_select",
        // A blank label counts as none.
        options: [makeOption({ key: "gold", label: "  ", translations: { en: "Gold" } })],
      }),
    );
    const name = within(dialog).getByLabelText(DIM_NAME);
    const value = within(dialog).getByLabelText("Label");
    expect(name).toHaveValue("Tier");
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(value).toHaveValue("Gold");
    expect(value).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
    const [saved] = (mockApi.callsOf("patch", PATH)[0].body as { attributes_schema: FieldDef[] })
      .attributes_schema;
    expect(saved).toMatchObject({ label: "Tier", translations: { en: "Tier" } });
    expect(saved.options?.[0]).toMatchObject({ label: "Gold", translations: { en: "Gold" } });
  });

  it("shows a labelled row's label when its translation here is empty, and saves it", async () => {
    const { user, dialog } = renderDialog(
      makeField({
        key: "tier",
        label: "Tier",
        translations: { en: "" },
        type: "single_select",
        options: [makeOption({ key: "gold", label: "Gold", translations: { en: "  " } })],
      }),
    );
    const name = within(dialog).getByLabelText(DIM_NAME);
    const value = within(dialog).getByLabelText("Label");
    expect(name).toHaveValue("Tier");
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(value).toHaveValue("Gold");
    expect(value).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
    const [saved] = (mockApi.callsOf("patch", PATH)[0].body as { attributes_schema: FieldDef[] })
      .attributes_schema;
    // The empty translation is dropped, so the label is what every locale shows.
    expect(saved.label).toBe("Tier");
    expect(saved.translations).toBeUndefined();
    expect(saved.options?.[0].label).toBe("Gold");
    expect(saved.options?.[0].translations).toBeUndefined();
  });

  it("shows empty and flags a row whose only text is in another language, until it is named", async () => {
    const { user, dialog } = renderDialog(
      makeField({
        key: "tier",
        label: "",
        translations: { de: "Stufe" },
        type: "single_select",
        // Blank text here is no text.
        options: [makeOption({ key: "gold", label: "", translations: { en: "  ", de: "Gold" } })],
      }),
    );
    const name = within(dialog).getByLabelText(DIM_NAME);
    const value = within(dialog).getByLabelText("Label");
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(value).toHaveValue("");
    expect(value).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();

    await user.type(name, "Tier");
    await user.type(value, "Gold");
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(value).toHaveAttribute("aria-invalid", "false");
    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
    const [saved] = (mockApi.callsOf("patch", PATH)[0].body as { attributes_schema: FieldDef[] })
      .attributes_schema;
    expect(saved).toMatchObject({ label: "Tier", translations: { de: "Stufe", en: "Tier" } });
  });

  it("takes a stored row's text here as its label when it carries no label at all", async () => {
    // As the API can hand it back: the `label` key absent, not blank.
    const { user, dialog } = renderDialog(
      makeField({
        key: "tier",
        label: undefined,
        translations: { en: "Tier" },
        type: "single_select",
        options: [makeOption({ key: "gold", label: undefined, translations: { en: "Gold" } })],
      }),
    );
    const name = within(dialog).getByLabelText(DIM_NAME);
    const value = within(dialog).getByLabelText("Label");
    expect(name).toHaveValue("Tier");
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(value).toHaveValue("Gold");
    expect(value).toHaveAttribute("aria-invalid", "false");
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
    const [saved] = (mockApi.callsOf("patch", PATH)[0].body as { attributes_schema: FieldDef[] })
      .attributes_schema;
    expect(saved).toMatchObject({ label: "Tier", translations: { en: "Tier" } });
    expect(saved.options?.[0]).toMatchObject({ label: "Gold", translations: { en: "Gold" } });
  });

  it("shows empty and flags a row with no label at all and no text here", async () => {
    const { dialog } = renderDialog(
      makeField({
        key: "tier",
        label: undefined,
        translations: { de: "Stufe" },
        type: "single_select",
        options: [makeOption({ key: "gold", label: undefined })],
      }),
    );
    const name = within(dialog).getByLabelText(DIM_NAME);
    const value = within(dialog).getByLabelText("Label");
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(value).toHaveValue("");
    expect(value).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
  });

  it("leaves a built-in row's stored label alone", async () => {
    const { user } = renderDialog(
      makeField({
        key: "usage",
        label: "",
        translations: { en: "Usage" },
        type: "single_select",
        built_in: true,
        options: [
          makeOption({ key: "owner", label: "", translations: { en: "Owner" }, built_in: true }),
        ],
      }),
    );
    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(1));
    const [saved] = (mockApi.callsOf("patch", PATH)[0].body as { attributes_schema: FieldDef[] })
      .attributes_schema;
    expect(saved.label).toBe("");
    expect(saved.options?.[0].label).toBe("");
  });
});

describe("RelationTypeValuesDialog — Save acts once", () => {
  it("sends one PATCH however fast Save is clicked, and is disabled while it runs", async () => {
    let release!: () => void;
    mockApi.on("patch", PATH, () => new Promise<object>((res) => (release = () => res({}))));
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <RelationTypeValuesDialog
        open
        relationType={relWith(
          makeField({ key: "tier", label: "Tier", type: "single_select", options: [] }),
        )}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // The second click lands before the first one re-renders the button.
    const save = saveButton();
    await act(async () => {
      save.click();
      save.click();
    });
    expect(mockApi.callsOf("patch", PATH)).toHaveLength(1);
    expect(saveButton()).toBeDisabled();

    await act(async () => release());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("patch", PATH)).toHaveLength(1);
  });
});

describe("RelationTypeValuesDialog — Save after a failed save", () => {
  it("sends again once the refused save has finished", async () => {
    mockApi.fail("patch", PATH, 409, "Conflict on save");
    const { user } = renderDialog(
      makeField({ key: "tier", label: "Tier", type: "single_select", options: [] }),
    );
    await user.click(saveButton());
    expect(await screen.findByText("Conflict on save")).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toBeEnabled());

    await user.click(saveButton());
    await waitFor(() => expect(mockApi.callsOf("patch", PATH)).toHaveLength(2));
  });
});
