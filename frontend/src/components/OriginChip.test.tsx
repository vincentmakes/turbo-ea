import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import OriginChip from "./OriginChip";

describe("OriginChip", () => {
  it.each([["web"], [null], [undefined], ["robot"]])("renders nothing for %s", (origin) => {
    const { container } = render(<OriginChip origin={origin} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ["mcp", "MCP", "smart_toy"],
    ["api", "API", "api"],
    ["ext", "Extension", "extension"],
    ["system", "System", "settings"],
  ])("renders %s as an outlined chip with its label and icon", (origin, label, icon) => {
    const { container } = render(<OriginChip origin={origin} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(icon)).toBeInTheDocument();
    const chip = container.querySelector(".MuiChip-root");
    expect(chip).toHaveClass("MuiChip-outlined");
    expect(chip).toHaveClass("MuiChip-sizeSmall");
    expect(chip).toHaveAttribute("data-origin", origin);
  });

  it("names the person and the date in a tooltip", async () => {
    render(<OriginChip origin="mcp" name="Ada Admin" at="2026-10-28T10:00:00Z" />);
    await userEvent.hover(screen.getByText("MCP"));
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Created via MCP by Ada Admin on 2026-10-28");
  });

  it("shows no tooltip without a name", async () => {
    render(<OriginChip origin="mcp" at="2026-10-28T10:00:00Z" />);
    await userEvent.hover(screen.getByText("MCP"));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
