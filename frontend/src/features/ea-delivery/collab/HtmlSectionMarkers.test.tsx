import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { renderWithProviders } from "@/test/render";
import HtmlSectionMarkers from "./HtmlSectionMarkers";
import { SectionDiscussionContext, type SectionDiscussion } from "./sectionDiscussionContext";

const HTML_A = '<h2 data-section="1.1">Scope</h2><p>x</p><h3 data-section="custom_7">Appendix</h3><h3>Plain</h3>';
const HTML_B = '<h2 data-section="2.1">Objectives</h2>';

function Page({ ctx, initialHtml = HTML_A }: { ctx: SectionDiscussion | null; initialHtml?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState(initialHtml);
  return (
    <SectionDiscussionContext.Provider value={ctx}>
      <button type="button" onClick={() => setHtml(HTML_B)}>
        swap
      </button>
      <div ref={ref} data-testid="doc" dangerouslySetInnerHTML={{ __html: html }} />
      <HtmlSectionMarkers containerRef={ref} html={html} />
    </SectionDiscussionContext.Provider>
  );
}

const ctxWith = (counts: SectionDiscussion["counts"], openSection = vi.fn()): SectionDiscussion => ({
  counts,
  openSection,
});

describe("HtmlSectionMarkers", () => {
  it("places a marker inside each anchored heading whose section has threads, and nowhere else", async () => {
    const openSection = vi.fn();
    const { user } = renderWithProviders(
      <Page ctx={ctxWith({ "1.1": { open: 2, total: 2 }, custom_7: { open: 0, total: 1 }, "9.9": { open: 1, total: 1 } }, openSection)} />,
    );
    const open = await screen.findByRole("button", { name: "2 open threads on this section" });
    expect(open.closest("h2")).toHaveAttribute("data-section", "1.1");
    expect(open.parentElement).toHaveClass("no-print");
    const done = screen.getByRole("button", { name: "Resolved discussion on this section" });
    expect(done.closest("h3")).toHaveAttribute("data-section", "custom_7");
    expect(screen.getAllByTestId(/^section-marker-/)).toHaveLength(2);
    expect(screen.getByText("Plain").querySelector("span")).toBeNull();
    await user.click(done);
    expect(openSection).toHaveBeenCalledWith("custom_7");
  });

  it("adds nothing outside a saved document or without threads", () => {
    const { unmount } = renderWithProviders(<Page ctx={null} />);
    expect(screen.getByTestId("doc").querySelectorAll("span")).toHaveLength(0);
    unmount();
    renderWithProviders(<Page ctx={ctxWith({})} />);
    expect(screen.getByTestId("doc").querySelectorAll("span")).toHaveLength(0);
  });

  it("places the markers again when the HTML changes", async () => {
    const { user } = renderWithProviders(
      <Page ctx={ctxWith({ "1.1": { open: 1, total: 1 }, "2.1": { open: 3, total: 3 } })} />,
    );
    expect(await screen.findByTestId("section-marker-1.1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "swap" }));
    const marker = await screen.findByTestId("section-marker-2.1");
    expect(marker.closest("h2")).toHaveTextContent("Objectives");
    expect(screen.queryByTestId("section-marker-1.1")).toBeNull();
    expect(screen.getByTestId("doc").querySelectorAll("span.no-print")).toHaveLength(1);
  });

  it("removes a host when its section's threads are gone", async () => {
    function Toggle() {
      const [ctx, setCtx] = useState<SectionDiscussion | null>(ctxWith({ "1.1": { open: 1, total: 1 } }));
      return (
        <>
          <button type="button" onClick={() => setCtx(ctxWith({}))}>
            clear
          </button>
          <Page ctx={ctx} />
        </>
      );
    }
    const { user } = renderWithProviders(<Toggle />);
    expect(await screen.findByTestId("section-marker-1.1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.queryByTestId("section-marker-1.1")).toBeNull();
    expect(screen.getByTestId("doc").querySelectorAll("span")).toHaveLength(0);
  });
});
