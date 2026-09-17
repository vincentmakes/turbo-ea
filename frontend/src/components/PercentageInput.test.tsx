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

describe("PercentageInput — one source of truth", () => {
  it("follows a new stored value on both the slider and the box", () => {
    // The re-edit case: the section draft resyncs from the card, and the
    // control must show that, not what it last displayed.
    const { rerender } = render(<PercentageInput label="Progress" value={10} onChange={() => {}} />);
    rerender(<PercentageInput label="Progress" value={40} onChange={() => {}} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("spinbutton")).toHaveValue(40);
  });

  it("writes a slider change straight through, no commit event needed", () => {
    const onChange = vi.fn();
    render(<PercentageInput label="Progress" value={10} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("fills its row up to the cap with a thick track, even without fullWidth", () => {
    // Card detail passes nothing; the slider used to collapse to its minimum
    // there while the rail stayed MUI's 4px hairline.
    const { container } = render(<PercentageInput label="Progress" value={0} onChange={() => {}} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveStyle({ width: "100%", maxWidth: "560px" });
    expect(container.querySelector(".MuiSlider-root")).toHaveStyle({ height: "6px", minWidth: "240px" });
  });

  it("marks the track at 0, 25, 50, 75 and 100", () => {
    const { container } = render(<PercentageInput label="Progress" value={0} onChange={() => {}} />);
    expect(container.querySelectorAll(".MuiSlider-mark")).toHaveLength(5);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
