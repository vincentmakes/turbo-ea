import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MultiSelectCellEditor, { toOptionKeys } from "./MultiSelectCellEditor";

const OPTIONS = [
  { key: "emea", label: "EMEA" },
  { key: "apac", label: "APAC", color: "#0f7eb5" },
];

function renderEditor(overrides: Record<string, unknown> = {}) {
  const onValueChange = vi.fn();
  const stopEditing = vi.fn();
  const gridStopEditing = vi.fn();
  render(
    <MultiSelectCellEditor
      value={[]}
      options={OPTIONS}
      onValueChange={onValueChange}
      stopEditing={stopEditing}
      api={{ stopEditing: gridStopEditing } as never}
      {...overrides}
    />,
  );
  return { onValueChange, stopEditing, gridStopEditing };
}

describe("toOptionKeys", () => {
  it("passes an array through as strings", () => {
    expect(toOptionKeys(["emea", "apac"])).toEqual(["emea", "apac"]);
  });

  it("treats the column's unset default as no selection", () => {
    expect(toOptionKeys("")).toEqual([]);
    expect(toOptionKeys(undefined)).toEqual([]);
    expect(toOptionKeys(null)).toEqual([]);
  });

  it("keeps a legacy free-text value visible so it can be repaired", () => {
    // Cells corrupted before #940 hold a bare string. Dropping it silently
    // would hide the bad data the user opened the editor to fix.
    expect(toOptionKeys("typed by hand")).toEqual(["typed by hand"]);
  });
});

describe("MultiSelectCellEditor", () => {
  it("renders the current selection as option labels, not keys", () => {
    renderEditor({ value: ["apac"] });
    // The selection renders as a deletable chip (role=button); the same text
    // also appears in the auto-opened option list, so scope to the chip.
    expect(screen.getByRole("button", { name: "APAC" })).toBeInTheDocument();
  });

  it("opens on the option list rather than an empty text box", async () => {
    // The reported bug: this cell used to edit as free text. The whole point
    // of the editor is that the choices are visible without typing.
    renderEditor();
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /EMEA/ })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /APAC/ })).toBeInTheDocument();
  });

  it("reports option keys, not labels", async () => {
    // The cell renderer and the server both key off option keys — emitting
    // labels here is what would write an unresolvable value.
    const { onValueChange } = renderEditor();
    await userEvent.click(await screen.findByRole("option", { name: /EMEA/ }));
    expect(onValueChange).toHaveBeenCalledWith(["emea"]);
  });

  it("accumulates a multi-selection", async () => {
    const { onValueChange } = renderEditor();
    await userEvent.click(await screen.findByRole("option", { name: /EMEA/ }));
    await userEvent.click(await screen.findByRole("option", { name: /APAC/ }));
    expect(onValueChange).toHaveBeenLastCalledWith(["emea", "apac"]);
  });

  it("commits on Save and discards on Cancel", async () => {
    const { stopEditing, gridStopEditing } = renderEditor({ value: ["emea"] });
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(stopEditing).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(gridStopEditing).toHaveBeenCalledWith(true);
  });
});
