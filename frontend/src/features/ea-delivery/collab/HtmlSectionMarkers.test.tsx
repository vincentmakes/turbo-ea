import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { memo, useRef, useState, type RefObject } from "react";
import { renderWithProviders } from "@/test/render";
import HtmlSectionMarkers from "./HtmlSectionMarkers";
import { SectionDiscussionContext, type SectionDiscussion } from "./sectionDiscussionContext";

const HTML_A = '<h2 data-section="1.1">Scope</h2><p>x</p><h3 data-section="custom_7">Appendix</h3><h3>Plain</h3>';
const HTML_B = '<h2 data-section="2.1">Objectives</h2>';

function Page({ ctx, initialHtml = HTML_A }: { ctx: SectionDiscussion | null; initialHtml?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState(initialHtml);
  const [renders, setRenders] = useState(0);
  return (
    <SectionDiscussionContext.Provider value={ctx}>
      <button type="button" onClick={() => setHtml(HTML_B)}>
        swap
      </button>
      <button type="button" onClick={() => setRenders((n) => n + 1)}>
        rerender {renders}
      </button>
      <div ref={ref} data-testid="doc" dangerouslySetInnerHTML={{ __html: html }} />
      <HtmlSectionMarkers containerRef={ref} html={html} />
    </SectionDiscussionContext.Provider>
  );
}

const ctxWith = (
  counts: SectionDiscussion["counts"],
  openSection = vi.fn(),
  canComment = false,
): SectionDiscussion => ({
  counts,
  canComment,
  openSection,
});

const hostSections = () =>
  Array.from(screen.getByTestId("doc").querySelectorAll("span.no-print")).map((el) =>
    el.parentElement?.getAttribute("data-section"),
  );

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

  it("places the markers again when a re-render with the same HTML rebuilt the DOM", async () => {
    const { user } = renderWithProviders(
      <Page ctx={ctxWith({ "1.1": { open: 1, total: 1 }, custom_7: { open: 0, total: 2 } })} />,
    );
    expect(await screen.findByTestId("section-marker-1.1")).toBeInTheDocument();
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByRole("button", { name: /^rerender/ }));
      const marker = await screen.findByTestId("section-marker-1.1");
      expect(marker.closest("h2")).toHaveAttribute("data-section", "1.1");
      expect(screen.getByTestId("section-marker-custom_7").closest("h3")).toHaveAttribute("data-section", "custom_7");
      expect(screen.getAllByTestId(/^section-marker-/)).toHaveLength(2);
      expect(screen.getByTestId("doc").querySelectorAll("span.no-print")).toHaveLength(2);
    }
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

  it("places a marker on every anchored heading for a reader who may comment", async () => {
    const openSection = vi.fn();
    const { user } = renderWithProviders(<Page ctx={ctxWith({ "1.1": { open: 2, total: 2 } }, openSection, true)} />);
    expect(await screen.findByRole("button", { name: "2 open threads on this section" })).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Comment on this section" });
    expect(add.closest("h3")).toHaveAttribute("data-section", "custom_7");
    expect(hostSections()).toEqual(["1.1", "custom_7"]);
    expect(screen.getByText("Plain").querySelector("span")).toBeNull();
    await user.click(add);
    expect(openSection).toHaveBeenCalledWith("custom_7");
  });

  it("places every host again after the DOM was rebuilt with the same HTML", async () => {
    const { user } = renderWithProviders(<Page ctx={ctxWith({}, vi.fn(), true)} />);
    expect(await screen.findByTestId("section-marker-custom_7")).toBeInTheDocument();
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByRole("button", { name: /^rerender/ }));
      expect(await screen.findByTestId("section-marker-1.1")).toBeInTheDocument();
      expect(hostSections()).toEqual(["1.1", "custom_7"]);
      expect(screen.getAllByTestId(/^section-marker-/)).toHaveLength(2);
    }
  });

  it("keeps the hosts in place when only the counts change", async () => {
    // The document is memoised, so only the markers re-render: React does
    // not rebuild its DOM, and any host that moves was moved by the markers.
    const Doc = memo(function Doc({ docRef }: { docRef: RefObject<HTMLDivElement | null> }) {
      return <div ref={docRef} data-testid="doc" dangerouslySetInnerHTML={{ __html: HTML_A }} />;
    });
    function Counts({ canComment }: { canComment: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null);
      const [ctx, setCtx] = useState<SectionDiscussion>(ctxWith({ "1.1": { open: 1, total: 1 } }, vi.fn(), canComment));
      return (
        <SectionDiscussionContext.Provider value={ctx}>
          <button type="button" onClick={() => setCtx(ctxWith({ "1.1": { open: 3, total: 4 } }, vi.fn(), canComment))}>
            recount
          </button>
          <Doc docRef={ref} />
          <HtmlSectionMarkers containerRef={ref} html={HTML_A} />
        </SectionDiscussionContext.Provider>
      );
    }
    for (const canComment of [false, true]) {
      const { user, unmount } = renderWithProviders(<Counts canComment={canComment} />);
      const before = (await screen.findByTestId("section-marker-1.1")).parentElement;
      await user.click(screen.getByRole("button", { name: "recount" }));
      expect(await screen.findByRole("button", { name: "3 open threads on this section" })).toBeInTheDocument();
      expect(screen.getByTestId("section-marker-1.1").parentElement).toBe(before);
      expect(before?.isConnected).toBe(true);
      expect(hostSections()).toEqual(canComment ? ["1.1", "custom_7"] : ["1.1"]);
      unmount();
    }
  });

  it("places the hosts again when the comment right changes", async () => {
    function Right() {
      const [canComment, setCanComment] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setCanComment((v) => !v)}>
            flip
          </button>
          <Page ctx={ctxWith({ "1.1": { open: 1, total: 1 } }, vi.fn(), canComment)} />
        </>
      );
    }
    const { user } = renderWithProviders(<Right />);
    expect(await screen.findByTestId("section-marker-1.1")).toBeInTheDocument();
    expect(hostSections()).toEqual(["1.1"]);
    await user.click(screen.getByRole("button", { name: "flip" }));
    expect(await screen.findByTestId("section-marker-custom_7")).toBeInTheDocument();
    expect(hostSections()).toEqual(["1.1", "custom_7"]);
    await user.click(screen.getByRole("button", { name: "flip" }));
    expect(screen.queryByTestId("section-marker-custom_7")).toBeNull();
    expect(hostSections()).toEqual(["1.1"]);
  });
});
