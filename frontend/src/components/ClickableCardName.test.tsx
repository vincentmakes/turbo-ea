import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ClickableCardName from "./ClickableCardName";

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
});
