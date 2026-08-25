/**
 * The Layered Dependency View's line-style picker.
 *
 * Mounted on its own, never through `LayeredDependencyView`: React Flow cannot
 * lay out under jsdom, so anything rendered inside that view is untestable —
 * the same reason `LdvShowOnCard` is its own component.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LdvLineStyleSelect from "./LdvLineStyleSelect";

describe("LdvLineStyleSelect", () => {
  it("offers every style and marks the current one", () => {
    render(<LdvLineStyleSelect value="dashed" onChange={vi.fn()} />);
    for (const label of ["Solid", "Dotted", "Dashed", "Long dash"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Dashed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reports the picked style", async () => {
    const onChange = vi.fn();
    render(<LdvLineStyleSelect value="dashed" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Solid" }));
    expect(onChange).toHaveBeenCalledWith("solid");
  });

  it("keeps the current style when the active button is clicked again", async () => {
    // MUI's exclusive ToggleButtonGroup reports null on deselect; a line
    // always has a style, so that must not blank the setting.
    const onChange = vi.fn();
    render(<LdvLineStyleSelect value="dashed" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Dashed" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws a preview of each line rather than only naming it", () => {
    const { container } = render(<LdvLineStyleSelect value="dotted" onChange={vi.fn()} />);
    const lines = container.querySelectorAll("svg line");
    expect(lines).toHaveLength(4);
    // The dotted sample carries the round cap that makes dots read as dots.
    const dotted = [...lines].find((l) => l.getAttribute("stroke-dasharray") === "1 4");
    expect(dotted?.getAttribute("stroke-linecap")).toBe("round");
  });
});
