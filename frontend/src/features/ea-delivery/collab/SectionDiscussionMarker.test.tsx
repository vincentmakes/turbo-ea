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
    const { user } = renderMarker("context", { counts: { context: { open: 2, total: 3 } }, openSection, canComment: false });
    const chip = screen.getByRole("button", { name: "2 open threads on this section" });
    expect(chip).toHaveTextContent("2");
    expect(chip).toHaveClass("MuiChip-colorWarning", "MuiChip-filled", "no-print");
    await user.click(chip);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("says one open thread in the singular", async () => {
    const { user } = renderMarker("decision", { counts: { decision: { open: 1, total: 1 } }, openSection: vi.fn(), canComment: false });
    const chip = screen.getByRole("button", { name: "1 open thread on this section" });
    await user.hover(chip);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("1 open thread on this section");
  });

  it("is muted and without a number once every thread is resolved", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: { context: { open: 0, total: 2 } }, openSection, canComment: false });
    const chip = screen.getByRole("button", { name: "Resolved discussion on this section" });
    expect(chip).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    expect(chip).not.toHaveClass("MuiChip-colorWarning");
    expect(chip).not.toHaveTextContent(/\d/);
    await user.click(chip);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("offers a muted add-comment chip on a section with no thread to a reader who may comment", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", {
      counts: { decision: { open: 1, total: 1 } },
      canComment: true,
      openSection,
    });
    const chip = screen.getByRole("button", { name: "Comment on this section" });
    expect(chip).toHaveAttribute("data-testid", "section-marker-context");
    expect(chip).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault", "no-print");
    expect(chip).not.toHaveClass("MuiChip-colorWarning");
    expect(chip).not.toHaveTextContent(/\d/);
    expect(chip.querySelector(".MuiChip-icon")).toHaveTextContent("add_comment");
    await user.hover(chip);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Comment on this section");
    await user.click(chip);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("treats an empty entry as no thread", () => {
    renderMarker("context", { counts: { context: { open: 0, total: 0 } }, canComment: true, openSection: vi.fn() });
    expect(screen.getByRole("button", { name: "Comment on this section" })).toBeInTheDocument();
  });

  it("keeps the forum icon on a section with threads, whatever the comment right", () => {
    renderMarker("context", { counts: { context: { open: 1, total: 1 } }, canComment: true, openSection: vi.fn() });
    const chip = screen.getByRole("button", { name: "1 open thread on this section" });
    expect(chip.querySelector(".MuiChip-icon")).toHaveTextContent("forum");
  });

  it("activates from the keyboard", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: {}, canComment: true, openSection });
    screen.getByRole("button", { name: "Comment on this section" }).focus();
    await user.keyboard("{Enter}");
    expect(openSection).toHaveBeenCalledTimes(1);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("shows nothing on a section with no thread to a reader who may not comment, or outside a saved document", () => {
    const { container, unmount } = renderMarker("context", {
      counts: { decision: { open: 1, total: 1 } },
      canComment: false,
      openSection: vi.fn(),
    });
    expect(container).toBeEmptyDOMElement();
    unmount();
    const second = renderMarker("context", {
      counts: { context: { open: 0, total: 0 } },
      canComment: false,
      openSection: vi.fn(),
    });
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();
    const third = renderMarker("context", null);
    expect(third.container).toBeEmptyDOMElement();
  });
});
