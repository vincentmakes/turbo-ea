import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { RenderedFilterRow } from "@/lib/fieldFilters";
import FieldFilterControl from "./FieldFilterControl";

interface Field {
  key: string;
  label: string;
  type: string;
  options?: { key: string; label: string; color?: string }[];
}

const RISK: Field = {
  key: "risk",
  label: "Risk",
  type: "single_select",
  options: [
    { key: "high", label: "High", color: "#c62828" },
    { key: "low", label: "Low" },
  ],
};
const row = (removable: boolean): RenderedFilterRow<Field> => ({
  field: RISK,
  kind: "facet",
  shownByDefault: !removable,
  removable,
});

describe("FieldFilterControl", () => {
  it("renders a facet field as the shared select, with no remove button on a default row", () => {
    render(
      <FieldFilterControl row={row(false)} value={{ attrFilters: {}, filterFields: [] }} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: "Risk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the Risk filter" })).not.toBeInTheDocument();
  });

  it("reports a pick under the field's key, keeping the other fields' values", () => {
    const onChange = vi.fn();
    render(
      <FieldFilterControl
        row={row(false)}
        value={{ attrFilters: { crit: ["a"] }, filterFields: [] }}
        onChange={onChange}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Risk" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("High"));
    expect(onChange).toHaveBeenLastCalledWith({ attrFilters: { crit: ["a"], risk: ["high"] } });
  });

  it("shows the current picks", () => {
    render(
      <FieldFilterControl
        row={row(true)}
        value={{ attrFilters: { risk: ["low"] }, filterFields: ["risk"] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("removes an added row and clears its value in one change", () => {
    const onChange = vi.fn();
    render(
      <FieldFilterControl
        row={row(true)}
        value={{ attrFilters: { risk: ["high"], crit: ["a"] }, filterFields: ["tier", "risk"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove the Risk filter" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ attrFilters: { crit: ["a"] }, filterFields: ["tier"] });
  });
});
