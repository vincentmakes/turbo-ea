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
});
