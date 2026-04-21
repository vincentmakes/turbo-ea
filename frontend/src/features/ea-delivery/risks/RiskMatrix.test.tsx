import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RiskMatrix, { RiskMatrixSelection } from "./RiskMatrix";

const sample: number[][] = [
  // prob = very_high: critical, high, medium, low
  [3, 1, 0, 0],
  [0, 2, 1, 0],
  [0, 0, 0, 1],
  [0, 0, 0, 0],
];

describe("RiskMatrix", () => {
  it("renders each cell with its count (or em dash for zero)", () => {
    render(<RiskMatrix matrix={sample} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // At least one zero cell renders as an em dash placeholder.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("invokes onSelect with the clicked (probability, impact) tuple", async () => {
    const onSelect = vi.fn<[RiskMatrixSelection | null], void>();
    const user = userEvent.setup();
    render(<RiskMatrix matrix={sample} onSelect={onSelect} />);
    const cells = screen.getAllByRole("button");
    // The first button in the flow is the very_high × critical cell (count=3).
    await user.click(cells[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      probability: "very_high",
      impact: "critical",
    });
  });

  it("re-clicking the active cell clears the selection", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <RiskMatrix
        matrix={sample}
        onSelect={onSelect}
        highlight={{ probability: "very_high", impact: "critical" }}
      />,
    );
    await user.click(screen.getAllByRole("button")[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("is read-only when onSelect is not provided (no buttons rendered)", () => {
    render(<RiskMatrix matrix={sample} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
