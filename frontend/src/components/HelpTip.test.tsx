import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import HelpTip from "./HelpTip";

describe("HelpTip", () => {
  it("renders nothing for empty or blank text", () => {
    const { container } = render(
      <div>
        <HelpTip text="" />
        <HelpTip text="   " />
        <HelpTip text={null} />
        <HelpTip text={undefined} />
      </div>,
    );
    expect(container.querySelector("div")).toBeEmptyDOMElement();
  });

  it("renders a focusable icon named by its text", () => {
    render(<HelpTip text="  Owns the budget. " />);
    const icon = screen.getByRole("img", { name: "Owns the budget." });
    expect(icon).toHaveAttribute("tabindex", "0");
    expect(icon).toHaveTextContent("help");
  });

  it("uses the given icon size", () => {
    render(<HelpTip text="x" size={18} />);
    const symbol = screen.getByTestId("help-tip").querySelector(".material-symbols-outlined");
    expect(symbol).toHaveStyle({ fontSize: "18px" });
  });

  it("shows the text, with links, in a tooltip on hover", async () => {
    render(<HelpTip text="See https://example.com/policy for details" />);
    fireEvent.mouseOver(screen.getByTestId("help-tip"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("See https://example.com/policy for details");
    const link = screen.getByRole("link", { name: "https://example.com/policy" });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the tooltip on keyboard focus", async () => {
    render(<HelpTip text="Keyboard help" />);
    await userEvent.tab();
    expect(screen.getByTestId("help-tip")).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Keyboard help");
  });

  it("does not let a click reach a clickable parent", () => {
    const onParent = vi.fn();
    render(
      <div onClick={onParent}>
        <HelpTip text="Stop" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("help-tip"));
    expect(onParent).not.toHaveBeenCalled();
  });
});
