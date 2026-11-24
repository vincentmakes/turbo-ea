import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildFilterCatalog, type FieldFilterState } from "@/lib/fieldFilters";
import FieldFilters from "./FieldFilters";

interface Field {
  key: string;
  label: string;
  type: string;
  options?: { key: string; label: string }[];
}

const select = (key: string, label: string): Field => ({
  key,
  label,
  type: "single_select",
  options: [{ key: "a", label: "A" }],
});
const catalogOf = (hidden: boolean) =>
  buildFilterCatalog<Field, Field>(
    [
      { section: "Main", fields: [select("crit", "Criticality")] },
      { section: "Compliance", hideInFilters: hidden, fields: [select("risk", "Risk")] },
    ],
    { sectionLabel: (s) => s.section, descriptionLabel: "Description", resolveField: (f) => f },
  );

/** The row as a block wires it: one value, patched in place. */
function Harness({ hidden = true, initial }: { hidden?: boolean; initial?: Partial<FieldFilterState> }) {
  const [value, setValue] = useState<FieldFilterState>({ attrFilters: {}, filterFields: [], ...initial });
  return (
    <>
      <FieldFilters catalog={catalogOf(hidden)} value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))}>
        <span>leading control</span>
      </FieldFilters>
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent!) as FieldFilterState;
const facet = (name: string) => screen.queryByRole("combobox", { name });

describe("FieldFilters", () => {
  it("renders the leading controls first, then the default rows, then Add filter", () => {
    render(<Harness />);
    const lead = screen.getByText("leading control");
    const crit = facet("Criticality")!;
    const chip = screen.getByText("Add filter");
    expect(lead.compareDocumentPosition(crit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(crit.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(facet("Risk")).not.toBeInTheDocument();
  });

  it("adds a row through the chip, then hides the chip once nothing is left", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Add filter"));
    fireEvent.click(screen.getByRole("option", { name: "Risk" }));
    expect(facet("Risk")).toBeInTheDocument();
    expect(state().filterFields).toEqual(["risk"]);
    expect(screen.queryByText("Add filter")).not.toBeInTheDocument();
  });

  it("removes an added row, its value with it, and offers it again", () => {
    render(<Harness initial={{ filterFields: ["risk"], attrFilters: { risk: ["a"], crit: ["a"] } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove the Risk filter" }));
    expect(facet("Risk")).not.toBeInTheDocument();
    expect(state()).toEqual({ attrFilters: { crit: ["a"] }, filterFields: [] });
    expect(screen.getByText("Add filter")).toBeInTheDocument();
  });

  it("shows a hidden field that holds a value, removable", () => {
    render(<Harness initial={{ attrFilters: { risk: ["a"] } }} />);
    expect(facet("Risk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the Risk filter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the Criticality filter" })).not.toBeInTheDocument();
  });

  it("renders no Add filter chip when every field is shown", () => {
    render(<Harness hidden={false} />);
    expect(facet("Risk")).toBeInTheDocument();
    expect(screen.queryByText("Add filter")).not.toBeInTheDocument();
  });

  it("calls back once per add with the new list", () => {
    const onChange = vi.fn();
    render(
      <FieldFilters catalog={catalogOf(true)} value={{ attrFilters: {}, filterFields: ["gone"] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Add filter"));
    fireEvent.click(screen.getByRole("option", { name: "Risk" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ filterFields: ["gone", "risk"] });
  });
});
