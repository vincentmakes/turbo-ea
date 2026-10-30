import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClickableCardName from "./ClickableCardName";

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/**
 * jsdom cannot follow a real link: a click the app leaves to the browser
 * (Ctrl / Cmd / Shift) would log "Not implemented: navigation". Stop the
 * default on `document`, after React's root listener has seen the click.
 */
function stopBrowserNavigation(e: Event) {
  e.preventDefault();
}

function renderLink(onClick?: () => void) {
  return render(
    <MemoryRouter initialEntries={["/cards/here"]}>
      <ClickableCardName name="Corporate" to="/cards/x" onClick={onClick} icon="corporate_fare" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("ClickableCardName", () => {
  it("underlines only the name on hover, with the icon outside the underlined span", () => {
    render(<ClickableCardName name="Corporate" onClick={vi.fn()} icon="corporate_fare" />);
    const name = screen.getByText("Corporate");
    const icon = screen.getByText("corporate_fare");
    // The hover rule lives on the name span; the icon is its sibling, not its child.
    expect(name.tagName).toBe("SPAN");
    expect(name.contains(icon)).toBe(false);
    expect(icon.contains(name)).toBe(false);
    expect(icon.nextElementSibling?.contains(name)).toBe(true);
  });

  it("opens the card from the name and from the icon alike", async () => {
    const onClick = vi.fn();
    render(<ClickableCardName name="Corporate" onClick={onClick} icon="corporate_fare" />);
    await userEvent.click(screen.getByText("Corporate"));
    await userEvent.click(screen.getByText("corporate_fare"));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("draws a colour dot when given one instead of an icon", () => {
    const { container } = render(
      <ClickableCardName name="SAP" onClick={vi.fn()} dotColor="#0f7eb5" />,
    );
    expect(screen.queryByText("corporate_fare")).not.toBeInTheDocument();
    const row = screen.getByText("SAP").closest("div[class*='MuiBox-root']")?.parentElement;
    const dot = container.querySelector("div > div > div");
    expect(row).toBeTruthy();
    expect(dot).toHaveStyle("background-color: rgb(15, 126, 181)");
  });

  describe("with `to` (#1335)", () => {
    beforeEach(() => document.addEventListener("click", stopBrowserNavigation));
    afterEach(() => document.removeEventListener("click", stopBrowserNavigation));

    it("renders the whole row, icon included, as a link to the card", () => {
      renderLink();
      const link = screen.getByText("Corporate").closest("a");
      expect(link).toHaveAttribute("href", "/cards/x");
      expect(link?.contains(screen.getByText("corporate_fare"))).toBe(true);
    });

    it("navigates in-app on a plain click and runs the side effect once", async () => {
      const onClick = vi.fn();
      renderLink(onClick);
      await userEvent.click(screen.getByText("Corporate"));
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/x");
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("navigates without a side effect", async () => {
      renderLink();
      await userEvent.click(screen.getByText("Corporate"));
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/x");
    });

    it.each([
      ["Ctrl", { ctrlKey: true }],
      ["Cmd", { metaKey: true }],
      ["Shift", { shiftKey: true }],
    ])("leaves a %s-click to the browser: no side effect, no in-app navigation", (_k, mods) => {
      const onClick = vi.fn();
      renderLink(onClick);
      fireEvent.click(screen.getByText("Corporate"), mods);
      expect(onClick).not.toHaveBeenCalled();
      expect(screen.getByTestId("location")).toHaveTextContent("/cards/here");
    });
  });

  it("without `to` is no link — the row's onClick is the whole action", () => {
    const onClick = vi.fn();
    render(<ClickableCardName name="Corporate" onClick={onClick} />);
    expect(screen.getByText("Corporate").closest("a")).toBeNull();
    fireEvent.click(screen.getByText("Corporate"), { ctrlKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
