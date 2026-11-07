import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import TreeLevelStepper from "./TreeLevelStepper";

function setup(current: number, max: number) {
  const onChange = vi.fn();
  render(<TreeLevelStepper current={current} max={max} onChange={onChange} />);
  const group = screen.getByRole("group", { name: "Expand by level" });
  return { onChange, group };
}

describe("TreeLevelStepper", () => {
  it("renders exactly two buttons and no visible text", () => {
    const { group } = setup(2, 3);
    expect(within(group).getAllByRole("button")).toHaveLength(2);
    // The glyphs are Material Symbols ligatures; nothing else is written.
    const text = group.textContent ?? "";
    expect(text.replace(/remove|add/g, "").trim()).toBe("");
    expect(text).not.toMatch(/\d/);
  });

  it("names the current and max level in the aria-labels", () => {
    setup(2, 3);
    expect(screen.getByRole("button", { name: "Collapse one level (2 of 3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand one level (2 of 3)" })).toBeInTheDocument();
  });

  it("disables − at level 1 and + at max", () => {
    setup(1, 3);
    expect(screen.getByRole("button", { name: /Collapse one level/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Expand one level/ })).toBeEnabled();
  });

  it("disables + at max", () => {
    setup(3, 3);
    expect(screen.getByRole("button", { name: /Expand one level/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Collapse one level/ })).toBeEnabled();
  });

  it("clicks move one level down or up", () => {
    const { onChange } = setup(2, 4);
    fireEvent.click(screen.getByRole("button", { name: /Collapse one level/ }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: /Expand one level/ }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("a disabled half does not call onChange", () => {
    const { onChange } = setup(1, 1);
    fireEvent.click(screen.getByRole("button", { name: /Collapse one level/ }));
    fireEvent.click(screen.getByRole("button", { name: /Expand one level/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
