import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FieldFilterState, FilterKind, RenderedFilterRow } from "@/lib/fieldFilters";
import FieldFilterControl, { parseBound } from "./FieldFilterControl";

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
const row = (removable: boolean, field: Field = RISK, kind: FilterKind = "facet"): RenderedFilterRow<Field> => ({
  field,
  kind,
  shownByDefault: !removable,
  removable,
});
const CODE: Field = { key: "code", label: "Code", type: "text" };
const PRICE: Field = { key: "price", label: "Price", type: "number" };
const DUE: Field = { key: "due", label: "Due", type: "date" };

const value = (patch: Partial<FieldFilterState> = {}): FieldFilterState => ({
  attrFilters: {},
  attrConditions: {},
  filterFields: [],
  ...patch,
});

describe("FieldFilterControl", () => {
  it("renders a facet field as the shared select, with no remove button on a default row", () => {
    render(<FieldFilterControl row={row(false)} value={value()} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Risk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the Risk filter" })).not.toBeInTheDocument();
  });

  it("reports a pick under the field's key, keeping the other fields' values", () => {
    const onChange = vi.fn();
    render(<FieldFilterControl row={row(false)} value={value({ attrFilters: { crit: ["a"] } })} onChange={onChange} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Risk" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("High"));
    expect(onChange).toHaveBeenLastCalledWith({ attrFilters: { crit: ["a"], risk: ["high"] } });
  });

  it("shows the current picks", () => {
    render(
      <FieldFilterControl
        row={row(true)}
        value={value({ attrFilters: { risk: ["low"] }, filterFields: ["risk"] })}
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
        value={value({
          attrFilters: { risk: ["high"], crit: ["a"] },
          attrConditions: { code: { contains: "x" } },
          filterFields: ["tier", "risk"],
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove the Risk filter" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      attrFilters: { crit: ["a"] },
      attrConditions: { code: { contains: "x" } },
      filterFields: ["tier"],
    });
  });

  describe("text", () => {
    it("is a contains box that reports every keystroke as a condition", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(true, CODE, "text")}
          value={value({ attrConditions: { n: { min: 1 } } })}
          onChange={onChange}
        />,
      );
      const box = screen.getByRole("textbox", { name: "Code" });
      expect(box).toHaveAttribute("placeholder", "Contains…");
      expect(screen.queryByRole("button", { name: "Clear the Code filter" })).not.toBeInTheDocument();
      fireEvent.change(box, { target: { value: "ORG " } });
      // What was typed is kept as it is (a trailing space while typing).
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { n: { min: 1 }, code: { contains: "ORG " } } });
    });

    it("shows the value and clears it with its button", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(false, CODE, "text")}
          value={value({ attrConditions: { code: { contains: "ORG" } } })}
          onChange={onChange}
        />,
      );
      expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("ORG");
      fireEvent.click(screen.getByRole("button", { name: "Clear the Code filter" }));
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: {} });
    });

    it("drops the condition when the box is emptied or blank", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(false, CODE, "text")}
          value={value({ attrConditions: { code: { contains: "ORG" } } })}
          onChange={onChange}
        />,
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "   " } });
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: {} });
    });

    it("removes an added text row with its condition", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(true, CODE, "text")}
          value={value({ attrConditions: { code: { contains: "ORG" } }, filterFields: ["code"] })}
          onChange={onChange}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Remove the Code filter" }));
      expect(onChange).toHaveBeenCalledWith({ attrFilters: {}, attrConditions: {}, filterFields: [] });
    });
  });

  describe("number", () => {
    it("is a min and a max box grouped under the field", () => {
      render(<FieldFilterControl row={row(true, PRICE, "number")} value={value()} onChange={vi.fn()} />);
      const group = screen.getByRole("group", { name: "Price" });
      expect(within(group).getByRole("spinbutton", { name: "Price from" })).toHaveValue(null);
      expect(within(group).getByRole("spinbutton", { name: "Price to" })).toBeInTheDocument();
    });

    it("reports each bound as a number, keeping the other", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(false, PRICE, "number")}
          value={value({ attrConditions: { price: { max: 20 } } })}
          onChange={onChange}
        />,
      );
      expect(screen.getByRole("spinbutton", { name: "Price to" })).toHaveValue(20);
      fireEvent.change(screen.getByRole("spinbutton", { name: "Price from" }), { target: { value: "10" } });
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { price: { min: 10, max: 20 } } });
    });

    it("drops the condition once both bounds are cleared", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(false, PRICE, "number")}
          value={value({ attrConditions: { price: { min: 0 } } })}
          onChange={onChange}
        />,
      );
      const from = screen.getByRole("spinbutton", { name: "Price from" });
      expect(from).toHaveValue(0);
      fireEvent.change(from, { target: { value: "" } });
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: {} });
    });

    it("follows a value cleared from outside", () => {
      const { rerender } = render(
        <FieldFilterControl
          row={row(false, PRICE, "number")}
          value={value({ attrConditions: { price: { min: 5 } } })}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("spinbutton", { name: "Price from" })).toHaveValue(5);
      rerender(<FieldFilterControl row={row(false, PRICE, "number")} value={value()} onChange={vi.fn()} />);
      expect(screen.getByRole("spinbutton", { name: "Price from" })).toHaveValue(null);
    });

    it("reads a typed bound", () => {
      expect(parseBound(" 12.5 ")).toBe(12.5);
      expect(parseBound("-3")).toBe(-3);
      expect(parseBound("0")).toBe(0);
      expect(parseBound("")).toBeUndefined();
      expect(parseBound("  ")).toBeUndefined();
      expect(parseBound("abc")).toBeUndefined();
      expect(parseBound("1e999")).toBeUndefined();
    });
  });

  describe("date", () => {
    it("is a from and a to date box, committed when left", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(true, DUE, "date")}
          value={value({ attrConditions: { due: { to: "2026-12-31" } } })}
          onChange={onChange}
        />,
      );
      const group = screen.getByRole("group", { name: "Due" });
      const from = within(group).getByLabelText("Due from") as HTMLInputElement;
      expect(within(group).getByLabelText("Due to")).toHaveValue("2026-12-31");
      fireEvent.focus(from);
      fireEvent.change(from, { target: { value: "2026-01-01" } });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.blur(from);
      expect(onChange).toHaveBeenLastCalledWith({
        attrConditions: { due: { from: "2026-01-01", to: "2026-12-31" } },
      });
    });

    it("drops the condition when the last bound is cleared", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(false, DUE, "date")}
          value={value({ attrConditions: { due: { to: "2026-12-31" } } })}
          onChange={onChange}
        />,
      );
      const to = screen.getByLabelText("Due to");
      fireEvent.focus(to);
      fireEvent.change(to, { target: { value: "" } });
      fireEvent.blur(to);
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: {} });
    });
  });

  describe("a stored condition of another kind (the field's type changed)", () => {
    it("shows a text row over a number condition empty", () => {
      render(
        <FieldFilterControl
          row={row(true, CODE, "text")}
          value={value({ attrConditions: { code: { min: 1 } } })}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("textbox", { name: "Code" })).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Clear the Code filter" })).not.toBeInTheDocument();
    });

    it("writes a number row's bound over a text condition as a number condition only", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(true, PRICE, "number")}
          value={value({ attrConditions: { price: { contains: "5" } } })}
          onChange={onChange}
        />,
      );
      const from = screen.getByRole("spinbutton", { name: "Price from" });
      expect(from).toHaveValue(null);
      fireEvent.change(from, { target: { value: "3" } });
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { price: { min: 3 } } });
    });

    it("writes a date row's bound over a number condition as a date condition only", () => {
      const onChange = vi.fn();
      render(
        <FieldFilterControl
          row={row(true, DUE, "date")}
          value={value({ attrConditions: { due: { min: 1 } } })}
          onChange={onChange}
        />,
      );
      const from = screen.getByLabelText("Due from");
      expect(from).toHaveValue("");
      fireEvent.focus(from);
      fireEvent.change(from, { target: { value: "2026-01-01" } });
      fireEvent.blur(from);
      expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { due: { from: "2026-01-01" } } });
    });
  });
});

describe("FieldFilterControl — what each bound writes and shows", () => {
  /** The control under a parent that applies every patch, as a report does. */
  function Applied({ field, kind, initial }: { field: Field; kind: FilterKind; initial?: Partial<FieldFilterState> }) {
    const [state, setState] = useState(value(initial));
    return (
      <FieldFilterControl row={row(false, field, kind)} value={state} onChange={(p) => setState((s) => ({ ...s, ...p }))} />
    );
  }

  it("writes the max bound beside the min", () => {
    const onChange = vi.fn();
    render(
      <FieldFilterControl
        row={row(false, PRICE, "number")}
        value={value({ attrConditions: { price: { min: 10 } } })}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Price to" }), { target: { value: "30" } });
    expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { price: { min: 10, max: 30 } } });
  });

  it("writes the max bound alone, and drops it when cleared", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FieldFilterControl row={row(false, PRICE, "number")} value={value()} onChange={onChange} />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Price to" }), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { price: { max: 7 } } });
    rerender(
      <FieldFilterControl
        row={row(false, PRICE, "number")}
        value={value({ attrConditions: { price: { min: 1, max: 7 } } })}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Price to" }), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ attrConditions: { price: { min: 1, max: undefined } } });
  });

  it("keeps what was typed in the box while the parent has not answered", () => {
    render(<FieldFilterControl row={row(false, PRICE, "number")} value={value()} onChange={vi.fn()} />);
    const from = screen.getByRole("spinbutton", { name: "Price from" });
    fireEvent.change(from, { target: { value: "10" } });
    expect(from).toHaveValue(10);
  });

  it("shows a new value set from outside, and an empty box once it is gone", () => {
    const { rerender } = render(
      <FieldFilterControl
        row={row(false, PRICE, "number")}
        value={value({ attrConditions: { price: { min: 5 } } })}
        onChange={vi.fn()}
      />,
    );
    const from = () => screen.getByRole("spinbutton", { name: "Price from" });
    expect(from()).toHaveValue(5);
    rerender(
      <FieldFilterControl
        row={row(false, PRICE, "number")}
        value={value({ attrConditions: { price: { min: 7 } } })}
        onChange={vi.fn()}
      />,
    );
    expect(from()).toHaveValue(7);
    rerender(<FieldFilterControl row={row(false, PRICE, "number")} value={value()} onChange={vi.fn()} />);
    expect(from()).toHaveValue(null);
  });

  it("keeps a typed bound as typed when it reads as the stored value", () => {
    render(<Applied field={PRICE} kind="number" />);
    const from = screen.getByRole("spinbutton", { name: "Price from" }) as HTMLInputElement;
    fireEvent.change(from, { target: { value: "1.50" } });
    // The parent now stores 1.5; the box keeps "1.50", not a reformatted "1.5".
    expect(from.value).toBe("1.50");
  });

  it("shows a stored from date, and an empty to date", () => {
    render(
      <FieldFilterControl
        row={row(false, DUE, "date")}
        value={value({ attrConditions: { due: { from: "2026-01-01" } } })}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Due from")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Due to")).toHaveValue("");
  });

  it("writes the to date beside the from date", () => {
    const onChange = vi.fn();
    render(
      <FieldFilterControl
        row={row(false, DUE, "date")}
        value={value({ attrConditions: { due: { from: "2026-01-01" } } })}
        onChange={onChange}
      />,
    );
    const to = screen.getByLabelText("Due to");
    fireEvent.focus(to);
    fireEvent.change(to, { target: { value: "2026-12-31" } });
    fireEvent.blur(to);
    expect(onChange).toHaveBeenLastCalledWith({
      attrConditions: { due: { from: "2026-01-01", to: "2026-12-31" } },
    });
  });

  it("writes nothing when an empty date box is entered and left", () => {
    const onChange = vi.fn();
    render(
      <FieldFilterControl
        row={row(false, DUE, "date")}
        value={value({ attrConditions: { due: { to: "2026-12-31" } } })}
        onChange={onChange}
      />,
    );
    const from = screen.getByLabelText("Due from");
    fireEvent.focus(from);
    fireEvent.blur(from);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("writes nothing when an empty to box is entered and left", () => {
    const onChange = vi.fn();
    render(
      <FieldFilterControl
        row={row(false, DUE, "date")}
        value={value({ attrConditions: { due: { from: "2026-01-01" } } })}
        onChange={onChange}
      />,
    );
    const to = screen.getByLabelText("Due to");
    fireEvent.focus(to);
    fireEvent.blur(to);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers only the empty choice for a facet field with no options", () => {
    const bare: Field = { key: "flag", label: "Flag", type: "single_select" };
    render(<FieldFilterControl row={row(false, bare, "facet")} value={value()} onChange={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Flag" }));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("(empty)");
  });
});
