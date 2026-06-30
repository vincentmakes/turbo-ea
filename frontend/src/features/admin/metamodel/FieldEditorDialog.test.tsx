import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FieldEditorDialog from "./FieldEditorDialog";
import type { FieldDef } from "@/types";

// The dialog only calls the API for option-usage checks on removal, which this
// test never triggers. Stub it so nothing reaches the network.
vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ card_count: 0 }) },
}));

describe("FieldEditorDialog — new select option color", () => {
  it("seeds a default color on a newly-added option even when the picker is never touched", async () => {
    // Regression test for issue #718: adding a 6th option to an existing
    // single-select field and saving without clicking the color swatch used to
    // persist the option with no `color`, so its color dot never rendered. The
    // ColorPicker shows a #1976d2 fallback for display only, so the stored value
    // must now match that default WYSIWYG.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Option/ }));

    // The newly-added option row is the last "Key"/"Label" pair. (The field's
    // own label input reads as "Label (English)", so it is not matched here.)
    const keyInputs = screen.getAllByLabelText("Key");
    const labelInputs = screen.getAllByLabelText("Label");
    await user.type(keyInputs[keyInputs.length - 1], "newopt");
    await user.type(labelInputs[labelInputs.length - 1], "New Opt");

    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as FieldDef;
    const lastOption = saved.options![saved.options!.length - 1];
    expect(lastOption.key).toBe("newopt");
    expect(lastOption.color).toBe("#1976d2");
  });

  it("normalizes an existing colorless option to the default on save (issue #718)", async () => {
    // The reporter's option was saved (in an earlier version) with no `color`.
    // Re-opening the field and clicking Save — without touching any picker —
    // must now persist the displayed default so its dot finally renders.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [
        { key: "first", label: "First", color: "#ff0000" },
        { key: "sixth", label: "Sixth" }, // no color — the bug scenario
      ],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as FieldDef;
    expect(saved.options![0].color).toBe("#ff0000"); // explicit color preserved
    expect(saved.options![1].color).toBe("#1976d2"); // colorless option filled
  });

  it("blocks saving an option that has a label but no key (issue #718 follow-up)", async () => {
    // An option with an empty key would render in the card-detail dropdown but
    // select to value "" — never displayed, never saved. Save must stay disabled
    // until every new option carries a valid key.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Option/ }));

    // Fill only the label of the new option, leaving its key blank.
    const labelInputs = screen.getAllByLabelText("Label");
    await user.type(labelInputs[labelInputs.length - 1], "Keyless");

    // Save is disabled (and cannot be clicked) while the new option has no key.
    const saveButton = screen.getByRole("button", { name: /^Save$/ });
    expect(saveButton).toBeDisabled();

    // Providing a valid key unblocks Save.
    const keyInputs = screen.getAllByLabelText("Key");
    await user.type(keyInputs[keyInputs.length - 1], "keyless");
    expect(saveButton).toBeEnabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flags a new option's key red only once its label is typed", async () => {
    const user = userEvent.setup();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Option/ }));

    const newKey = () => screen.getAllByLabelText("Key").at(-1)!;
    const newLabel = () => screen.getAllByLabelText("Label").at(-1)!;

    // Fresh row: key is empty but the label has not been started — no red.
    expect(newKey()).toHaveAttribute("aria-invalid", "false");

    // Start typing the label → the still-empty key turns red.
    await user.type(newLabel(), "In Progress");
    expect(newKey()).toHaveAttribute("aria-invalid", "true");

    // Filling the key clears the red.
    await user.type(newKey(), "inProgress");
    expect(newKey()).toHaveAttribute("aria-invalid", "false");
  });

  it("does not lock a new option whose key matches an existing key — flags it as duplicate instead", async () => {
    // Regression: the key lock was keyed on value-match, so typing a new
    // option's key equal to an existing one auto-locked the new row (blocking
    // the user and hiding the collision). It must stay editable and be flagged.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    // The pre-existing option's key is locked (cannot be renamed).
    const firstKey = () => screen.getAllByLabelText("Key")[0];
    expect(firstKey()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Add Option/ }));
    const newKey = () => screen.getAllByLabelText("Key").at(-1)!;
    const newLabel = () => screen.getAllByLabelText("Label").at(-1)!;
    await user.type(newLabel(), "Duplicate");
    await user.type(newKey(), "first"); // collides with the existing option

    // The new row stays editable (NOT locked) and is flagged as a duplicate.
    expect(newKey()).toBeEnabled();
    expect(newKey()).toHaveAttribute("aria-invalid", "true");

    // Save is blocked while the duplicate exists.
    const saveButton = screen.getByRole("button", { name: /^Save$/ });
    expect(saveButton).toBeDisabled();

    // Changing the key to a unique value clears the duplicate and unblocks Save.
    await user.clear(newKey());
    await user.type(newKey(), "second");
    expect(newKey()).toHaveAttribute("aria-invalid", "false");
    expect(saveButton).toBeEnabled();
  });
});
