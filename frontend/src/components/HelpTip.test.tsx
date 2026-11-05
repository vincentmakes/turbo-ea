import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    const icon = screen.getByRole("button", { name: "Owns the budget." });
    expect(icon).toHaveAttribute("tabindex", "0");
    expect(icon).toHaveAttribute("aria-expanded", "false");
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

  it("opens on a click and closes on a second click", async () => {
    render(<HelpTip text="Tap help" />);
    const icon = screen.getByTestId("help-tip");
    fireEvent.click(icon);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Tap help");
    expect(icon).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(icon);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    expect(icon).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles on an iOS tap, whose emulated mouseover does not hold it open", async () => {
    render(<HelpTip text="Tap help" />);
    const icon = screen.getByTestId("help-tip");
    const tap = () => {
      fireEvent.touchStart(icon);
      fireEvent.touchEnd(icon);
      fireEvent.mouseOver(icon);
      fireEvent.mouseDown(icon);
      fireEvent.mouseUp(icon);
      fireEvent.click(icon);
    };
    tap();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Tap help");
    // Past MUI's 100 ms hover enter delay, so an emulated hover would have opened by now.
    await new Promise((r) => setTimeout(r, 150));
    tap();
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("inside a label, a click shows the help and never reaches the field", async () => {
    const onInputClick = vi.fn();
    render(
      <div>
        <label htmlFor="x">
          Name
          <HelpTip text="Label help" />
        </label>
        <input id="x" onClick={onInputClick} />
      </div>,
    );
    const icon = screen.getByTestId("help-tip");
    // false = default prevented: the label is not activated, focus does not move.
    expect(fireEvent.mouseDown(icon)).toBe(false);
    expect(fireEvent.click(icon)).toBe(false);
    expect(screen.getByRole("textbox")).not.toHaveFocus();
    expect(onInputClick).not.toHaveBeenCalled();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Label help");
  });

  it("leaves focus on the field being edited", async () => {
    // Outside a label: inside one, user-event itself moves focus to the
    // label's control on mousedown, which would hide a regression here.
    render(
      <div>
        <input aria-label="Name" />
        <HelpTip text="Label help" />
      </div>,
    );
    const input = screen.getByRole("textbox");
    input.focus();
    await userEvent.click(screen.getByTestId("help-tip"));
    expect(input).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Label help");
  });

  it("closes a tap-opened tooltip on a click elsewhere, not on the tooltip itself", async () => {
    render(
      <div>
        <HelpTip text="Away help" />
        <button type="button">Other</button>
      </div>,
    );
    const icon = screen.getByTestId("help-tip");
    fireEvent.click(icon);
    const tooltip = await screen.findByRole("tooltip");
    // ClickAwayListener arms itself on the next tick after it starts listening.
    await new Promise((r) => setTimeout(r, 0));
    // The tooltip is portaled outside the icon's subtree, so this click does
    // reach the click-away handler; it must not count as a click elsewhere.
    fireEvent.click(within(tooltip).getByText("Away help"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(icon).toHaveAttribute("aria-expanded", "true");
    // `aria-expanded` is checked synchronously on purpose: nothing else (a
    // hover timer) may be what closes it. The popper itself leaves after its
    // exit transition.
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    expect(icon).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.click(icon);
    await screen.findByRole("tooltip");
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(document.body);
    expect(icon).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("closes a tap-opened tooltip on a tap elsewhere", async () => {
    render(
      <div>
        <HelpTip text="Touch away" />
        <button type="button">Other</button>
      </div>,
    );
    const icon = screen.getByTestId("help-tip");
    fireEvent.click(icon);
    await screen.findByRole("tooltip");
    await new Promise((r) => setTimeout(r, 0));
    // A touch end alone, no click after it: the touch listener must close it.
    fireEvent.touchEnd(screen.getByRole("button", { name: "Other" }));
    expect(icon).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("keeps a tap-opened tooltip open when the pointer leaves, until Escape", async () => {
    render(<HelpTip text="Stay help" />);
    const icon = screen.getByTestId("help-tip");
    fireEvent.click(icon);
    await screen.findByRole("tooltip");
    fireEvent.mouseLeave(icon);
    // Past MUI's leave timer, which calls onClose with the mouseleave.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(icon).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(icon).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("closes a tap-opened tooltip on Escape, on the icon or anywhere", async () => {
    render(<HelpTip text="Esc help" />);
    const icon = screen.getByTestId("help-tip");
    fireEvent.click(icon);
    await screen.findByRole("tooltip");
    fireEvent.keyDown(icon, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.click(icon);
    await screen.findByRole("tooltip");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("toggles on Enter and Space", async () => {
    render(<HelpTip text="Key help" />);
    const icon = screen.getByTestId("help-tip");
    expect(fireEvent.keyDown(icon, { key: "Enter" })).toBe(false);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Key help");
    expect(fireEvent.keyDown(icon, { key: " " })).toBe(false);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("does not let Enter or Space reach a parent's key handler", () => {
    const onParentKey = vi.fn();
    render(
      <div onKeyDown={(e) => onParentKey(e.key)}>
        <HelpTip text="Key stop" />
      </div>,
    );
    const icon = screen.getByTestId("help-tip");
    fireEvent.keyDown(icon, { key: "Enter" });
    fireEvent.keyDown(icon, { key: " " });
    expect(onParentKey).not.toHaveBeenCalled();
    // Any other key still bubbles, so the parent handler is really listening.
    fireEvent.keyDown(icon, { key: "a" });
    expect(onParentKey).toHaveBeenCalledWith("a");
  });

  it("reopens on Enter after Escape closed the focus tooltip", async () => {
    render(<HelpTip text="Key help" />);
    await userEvent.tab();
    await screen.findByRole("tooltip");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Key help");
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
    const icon = screen.getByRole("button", { name: "Enter the legal name." });
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
