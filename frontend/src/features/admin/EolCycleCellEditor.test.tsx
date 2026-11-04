import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GridApi } from "ag-grid-community";
import EolCycleCellEditor from "./EolCycleCellEditor";

function setup(mode: "date" | "eol" | "support", value: unknown = null) {
  const api = { stopEditing: vi.fn() } as unknown as GridApi;
  const onValueChange = vi.fn();
  const stopEditing = vi.fn();
  render(
    <EolCycleCellEditor
      mode={mode}
      value={value as never}
      api={api}
      onValueChange={onValueChange}
      stopEditing={stopEditing}
    />,
  );
  return { api, onValueChange, stopEditing };
}

describe("EolCycleCellEditor", () => {
  it("edits a milestone and commits on Apply", async () => {
    const { onValueChange, stopEditing } = setup("support", "2026-01-01");
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Active support ended" }));
    expect(onValueChange).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(stopEditing).toHaveBeenCalled();
  });

  it("edits a plain date", () => {
    const { onValueChange } = setup("date", "2024-01-01");
    const input = screen.getByLabelText("Date");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2024-02-02" } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenLastCalledWith("2024-02-02");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("discards on Cancel and on Escape", async () => {
    const { api, stopEditing } = setup("eol", true);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.stopEditing).toHaveBeenCalledWith(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Apply" }), { key: "Escape" });
    expect(api.stopEditing).toHaveBeenCalledTimes(2);
    expect(stopEditing).not.toHaveBeenCalled();
  });

  it("gives a date to a milestone that had none (regression: Date led nowhere)", async () => {
    const { onValueChange } = setup("eol", true);
    expect(screen.queryByLabelText("Date")).toBeNull();
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Date" }));
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    const input = screen.getByLabelText("Date");
    fireEvent.change(input, { target: { value: "2027-03-01" } });
    expect(onValueChange).toHaveBeenLastCalledWith("2027-03-01");
    expect(screen.getByRole("combobox")).toHaveTextContent("Date");
  });
});

