/**
 * The Layered Dependency View's aggregate-level picker.
 *
 * Mounted on its own, never through `LayeredDependencyView`: React Flow cannot
 * lay out under jsdom, so anything rendered inside that view is untestable —
 * the same reason `LdvLineStyleSelect` is its own component.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LdvAggregateSelect from "./LdvAggregateSelect";

describe("LdvAggregateSelect", () => {
  it("offers every level and marks the current one", () => {
    render(<LdvAggregateSelect value="type" onChange={vi.fn()} />);
    for (const label of ["Off", "By layer", "By card type", "By subtype"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "By card type" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reports the level that was picked", async () => {
    const onChange = vi.fn();
    render(<LdvAggregateSelect value="none" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "By subtype" }));
    expect(onChange).toHaveBeenCalledWith("subtype");
  });

  it("keeps the current level when the active button is clicked again", async () => {
    // The group is exclusive, so MUI hands back null — but the view is always
    // at some level, and "off" is a level of its own, not the absence of one.
    const onChange = vi.fn();
    render(<LdvAggregateSelect value="layer" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "By layer" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains what aggregating does", () => {
    render(<LdvAggregateSelect value="none" onChange={vi.fn()} />);
    expect(screen.getByText(/a single connector between any two boxes/i)).toBeInTheDocument();
  });
});
