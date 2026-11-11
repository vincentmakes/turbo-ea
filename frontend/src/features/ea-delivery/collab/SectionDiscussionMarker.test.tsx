import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import SectionDiscussionMarker from "./SectionDiscussionMarker";
import { SectionDiscussionContext, type SectionDiscussion } from "./sectionDiscussionContext";

// MUI's default theme `text.secondary`, the muted colour of the two quiet states.
const MUTED = "rgba(0, 0, 0, 0.6)";

function renderMarker(section: string, ctx: SectionDiscussion | null) {
  return renderWithProviders(
    <SectionDiscussionContext.Provider value={ctx}>
      <SectionDiscussionMarker section={section} />
    </SectionDiscussionContext.Provider>,
  );
}

const glyph = (button: HTMLElement) => button.querySelector(".material-symbols-outlined");
const glyphStyle = (button: HTMLElement) => (glyph(button) as HTMLElement).style;
const badge = (button: HTMLElement) => button.querySelector(".MuiBadge-badge");

describe("SectionDiscussionMarker", () => {
  it("is the forum icon under a warning badge with the open-thread count, says it in words, and opens its section", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: { context: { open: 2, total: 3 } }, openSection, canComment: false });
    const button = screen.getByRole("button", { name: "2 open threads on this section" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveClass("MuiIconButton-root", "MuiIconButton-sizeSmall", "no-print");
    expect(button).toHaveAttribute("data-testid", "section-marker-context");
    expect(button.querySelector(".MuiChip-root")).toBeNull();
    expect(glyph(button)).toHaveTextContent(/^forum$/);
    expect(glyph(button)).toHaveStyle({ fontSize: "20px" });
    expect(badge(button)).toHaveTextContent(/^2$/);
    expect(badge(button)).toHaveClass("MuiBadge-colorWarning", "MuiBadge-overlapCircular");
    expect(badge(button)).not.toHaveClass("MuiBadge-invisible");
    expect(button).not.toHaveStyle({ color: MUTED });
    await user.click(button);
    expect(openSection).toHaveBeenCalledTimes(1);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("says one open thread in the singular", async () => {
    const { user } = renderMarker("decision", { counts: { decision: { open: 1, total: 1 } }, openSection: vi.fn(), canComment: false });
    const button = screen.getByRole("button", { name: "1 open thread on this section" });
    expect(badge(button)).toHaveTextContent(/^1$/);
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("1 open thread on this section");
  });

  it("is the muted forum icon without a badge once every thread is resolved", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: { context: { open: 0, total: 2 } }, openSection, canComment: false });
    const button = screen.getByRole("button", { name: "Resolved discussion on this section" });
    expect(button).toHaveClass("MuiIconButton-root", "no-print");
    expect(glyph(button)).toHaveTextContent(/^forum$/);
    expect(glyph(button)).toHaveStyle({ fontSize: "20px" });
    expect(badge(button)).toBeNull();
    expect(button).toHaveTextContent(/^forum$/);
    expect(button).toHaveStyle({ color: MUTED });
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Resolved discussion on this section");
    await user.click(button);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("offers a muted add-comment icon on a section with no thread to a reader who may comment", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", {
      counts: { decision: { open: 1, total: 1 } },
      canComment: true,
      openSection,
    });
    const button = screen.getByRole("button", { name: "Comment on this section" });
    expect(button).toHaveAttribute("data-testid", "section-marker-context");
    expect(button).toHaveClass("MuiIconButton-root", "no-print");
    expect(glyph(button)).toHaveTextContent(/^add_comment$/);
    expect(glyph(button)).toHaveStyle({ fontSize: "20px" });
    // Weighted and mirrored: the tail of the bubble sits at the bottom right.
    expect(glyphStyle(button).transform).toBe("scaleX(-1)");
    expect(glyphStyle(button).fontVariationSettings).toBe("'wght' 600");
    expect(badge(button)).toBeNull();
    expect(button).toHaveTextContent(/^add_comment$/);
    expect(button).toHaveStyle({ color: MUTED });
    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Comment on this section");
    await user.click(button);
    expect(openSection).toHaveBeenCalledWith("context");
  });

  it("treats an empty entry as no thread", () => {
    renderMarker("context", { counts: { context: { open: 0, total: 0 } }, canComment: true, openSection: vi.fn() });
    const button = screen.getByRole("button", { name: "Comment on this section" });
    expect(glyph(button)).toHaveTextContent(/^add_comment$/);
  });

  it("keeps the forum icon on a section with threads, whatever the comment right", () => {
    renderMarker("context", { counts: { context: { open: 1, total: 1 } }, canComment: true, openSection: vi.fn() });
    const button = screen.getByRole("button", { name: "1 open thread on this section" });
    expect(glyph(button)).toHaveTextContent(/^forum$/);
    // The forum icon is the app's own, as drawn: neither weighted nor mirrored.
    expect(glyphStyle(button).transform).toBe("");
    expect(glyphStyle(button).fontVariationSettings).toBe("");
    expect(badge(button)).toHaveTextContent(/^1$/);
  });

  it("activates from the keyboard, with Enter and with Space", async () => {
    const openSection = vi.fn();
    const { user } = renderMarker("context", { counts: {}, canComment: true, openSection });
    screen.getByRole("button", { name: "Comment on this section" }).focus();
    await user.keyboard("{Enter}");
    expect(openSection).toHaveBeenCalledTimes(1);
    expect(openSection).toHaveBeenCalledWith("context");
    await user.keyboard(" ");
    expect(openSection).toHaveBeenCalledTimes(2);
    expect(openSection).toHaveBeenLastCalledWith("context");
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
