import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import SectionDiscussionMarker from "./SectionDiscussionMarker";
import { SectionDiscussionContext, type SectionDiscussion } from "./sectionDiscussionContext";

function renderMarker(section: string, ctx: SectionDiscussion | null) {
  return renderWithProviders(
    <SectionDiscussionContext.Provider value={ctx}>
      <SectionDiscussionMarker section={section} />
    </SectionDiscussionContext.Provider>,
  );
}

describe("SectionDiscussionMarker", () => {
  it("shows the open-thread count in the warning colour, says it in words, and opens its section", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: { context: { open: 2, total: 3 } }, openSection });
    const chip = screen.getByRole("button", { name: "2 open threads on this section" });
    expect(chip).toHaveTextContent("2");
    expect(chip).toHaveClass("MuiChip-colorWarning", "MuiChip-filled", "no-print");
    await user.click(chip);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("says one open thread in the singular", async () => {
    const { user } = renderMarker("decision", { counts: { decision: { open: 1, total: 1 } }, openSection: vi.fn() });
    const chip = screen.getByRole("button", { name: "1 open thread on this section" });
    await user.hover(chip);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("1 open thread on this section");
  });

  it("is muted and without a number once every thread is resolved", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: { context: { open: 0, total: 2 } }, openSection });
    const chip = screen.getByRole("button", { name: "Resolved discussion on this section" });
    expect(chip).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    expect(chip).not.toHaveClass("MuiChip-colorWarning");
    expect(chip).not.toHaveTextContent(/\d/);
    await user.click(chip);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("shows nothing for a section with no thread, an empty entry, or outside a saved document", () => {
    const { container, unmount } = renderMarker("context", {
      counts: { decision: { open: 1, total: 1 } },
      openSection: vi.fn(),
    });
    expect(container).toBeEmptyDOMElement();
    unmount();
    const second = renderMarker("context", { counts: { context: { open: 0, total: 0 } }, openSection: vi.fn() });
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();
    const third = renderMarker("context", null);
    expect(third.container).toBeEmptyDOMElement();
  });
});
