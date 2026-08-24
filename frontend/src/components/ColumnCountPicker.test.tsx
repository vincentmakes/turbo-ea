/**
 * The segmented column picker. The load-bearing behaviour here is the guard
 * against MUI's exclusive-deselect: clicking the already-active button hands
 * `onChange` a null, which would blank the grid template downstream.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColumnCountPicker from "./ColumnCountPicker";

describe("ColumnCountPicker", () => {
  it("offers exactly three counts and marks the active one", () => {
    render(<ColumnCountPicker value={2} onChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("reports the picked count", async () => {
    const onChange = vi.fn();
    render(<ColumnCountPicker value={3} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("does not fire when the active button is clicked again", async () => {
    const onChange = vi.fn();
    render(<ColumnCountPicker value={3} onChange={onChange} />);
    await userEvent.click(screen.getAllByRole("button")[2]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("labels every button for screen readers", () => {
    render(<ColumnCountPicker value={1} onChange={() => {}} />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
