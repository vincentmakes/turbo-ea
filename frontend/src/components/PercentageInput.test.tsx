import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isValidPercent, PercentageInput, toPercent } from "./PercentageInput";

describe("toPercent / isValidPercent", () => {
  it("parses stored values and rejects the out-of-range ones", () => {
    expect(toPercent(42)).toBe(42);
    expect(toPercent("42.5")).toBe(42.5);
    expect(toPercent("")).toBeNull();
    expect(toPercent(null)).toBeNull();
    expect(toPercent("abc")).toBeNull();
    expect(isValidPercent(0)).toBe(true);
    expect(isValidPercent(100)).toBe(true);
    expect(isValidPercent(100.5)).toBe(false);
    expect(isValidPercent(-1)).toBe(false);
  });
});

describe("PercentageInput", () => {
  it("propagates a typed value, decimals included", () => {
    const onChange = vi.fn();
    render(<PercentageInput label="Progress" value={10} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "42.5" } });
    expect(onChange).toHaveBeenLastCalledWith(42.5);
  });

  it("treats 0 as a value, not an absence", () => {
    const onChange = vi.fn();
    render(<PercentageInput label="Progress" value={10} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("clears with undefined", () => {
    const onChange = vi.fn();
    render(<PercentageInput label="Progress" value={10} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("does not propagate an out-of-range value and flags the box", () => {
    const onChange = vi.fn();
    render(<PercentageInput label="Progress" value={10} onChange={onChange} />);
    const box = screen.getByRole("spinbutton");
    fireEvent.change(box, { target: { value: "150" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(box).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the stored value on the slider", () => {
    render(<PercentageInput label="Progress" value={35} onChange={() => {}} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "35");
  });
});
