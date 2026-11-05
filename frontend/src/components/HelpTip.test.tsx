import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import HelpTip, { HELP_TIP_IN_LABEL_SIZE, HelpTipNotchSpacer, labelWithHelp } from "./HelpTip";

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

describe("labelWithHelp", () => {
  it("returns the plain text for both labels without help", () => {
    expect(labelWithHelp("Name", "")).toEqual({ label: "Name", notch: "Name" });
    expect(labelWithHelp("Name", "   ")).toEqual({ label: "Name", notch: "Name" });
  });

  it("puts the icon in the label and a spacer, never the icon, in the notch", () => {
    const { label, notch } = labelWithHelp("Name", "Enter the legal name.");
    const visible = render(<label>{label}</label>);
    const icon = screen.getByRole("img", { name: "Enter the legal name." });
    expect(visible.container.querySelector("label")).toHaveTextContent(/^Name/);
    expect(icon.querySelector(".material-symbols-outlined")).toHaveStyle({
      fontSize: `${HELP_TIP_IN_LABEL_SIZE}px`,
    });
    expect(HELP_TIP_IN_LABEL_SIZE).toBe(18);
    visible.unmount();

    const { container } = render(<legend>{notch}</legend>);
    const legend = container.querySelector("legend") as HTMLElement;
    expect(legend).toHaveTextContent("Name");
    expect(within(legend).queryByTestId("help-tip")).toBeNull();
    expect(legend.querySelector("[tabindex]")).toBeNull();
    expect(legend.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("HelpTipNotchSpacer", () => {
  it("is a hidden inline block of the icon's scaled width", () => {
    const { container } = render(<HelpTipNotchSpacer />);
    const spacer = container.firstElementChild as HTMLElement;
    expect(spacer.tagName).toBe("SPAN");
    expect(spacer).toHaveAttribute("aria-hidden", "true");
    expect(spacer).toHaveStyle({ display: "inline-block", width: "1.4em" });
    expect(spacer).toBeEmptyDOMElement();
  });
});
