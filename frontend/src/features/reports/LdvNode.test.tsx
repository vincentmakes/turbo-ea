import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LdvNode } from "./LayeredDependencyView";
import type { LdvNodeData } from "./layeredDependencyLayout";
import { STATUS_COLORS, TIMELINE_COLORS } from "@/theme";

/**
 * The card's chrome, rendered for real.
 *
 * `layeredDependencyLayout.test.ts` asserts on the objects `buildLdvFlow`
 * returns and `DependencyReport.test.tsx` mocks this view away entirely, so
 * until this file existed nothing rendered a card — which is how the connection
 * icons shipped once with invented path data and once positioned outside the
 * card.
 *
 * Only the node is mounted, never `LayeredDependencyView`: React Flow cannot
 * lay out under jsdom (no `SVGPathElement.getTotalLength`, no `CSS.escape`, no
 * `ResizeObserver`, every rect 0x0), and none of that lives in the node. The
 * one tie is its twenty `<Handle>`s, which read React Flow's store — stubbed
 * below so this is a plain MUI render.
 */
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Handle: () => null,
}));

function makeData(overrides: Partial<LdvNodeData> = {}): LdvNodeData {
  return {
    name: "NexaCore ERP",
    typeKey: "Application",
    typeLabel: "Application",
    typeColor: "#0f7eb5",
    typeIcon: "apps",
    category: "Application & Data",
    nodeId: "app-1",
    ...overrides,
  };
}

function renderNode(overrides: Partial<LdvNodeData> = {}) {
  // NodeProps carries React Flow plumbing the node never reads; only `data` is
  // destructured, so the rest is deliberately not fabricated.
  const props = { data: makeData(overrides) } as Parameters<typeof LdvNode>[0];
  return render(<LdvNode {...props} />);
}

const GAINED = '[title="Gains a connection here"]';
const LOST = '[title="Loses a connection here"]';
const marks = (sel: string) => Array.from(document.querySelectorAll(sel));

describe("LdvNode connection-change icons", () => {
  it("shows an icon only for the direction the node data claims", () => {
    renderNode({ gainedLink: true });
    expect(marks(GAINED)).toHaveLength(1);
    expect(marks(LOST)).toHaveLength(0);
  });

  it("shows the losing icon on a node that loses a connection", () => {
    renderNode({ lostLink: true });
    expect(marks(LOST)).toHaveLength(1);
    expect(marks(GAINED)).toHaveLength(0);
  });

  it("shows both when a card gains and loses at the same marker", () => {
    renderNode({ gainedLink: true, lostLink: true });
    expect(marks(GAINED)).toHaveLength(1);
    expect(marks(LOST)).toHaveLength(1);
  });

  it("shows neither on a card whose connections are unchanged", () => {
    renderNode();
    expect(marks(GAINED)).toHaveLength(0);
    expect(marks(LOST)).toHaveLength(0);
  });

  it("draws real geometry, never a font ligature", () => {
    // The export trap this component exists to avoid: image export runs with
    // `skipFonts: true`, so a MaterialSymbol here would render in the browser
    // and export as the literal text "link_off". MaterialSymbol puts the icon
    // name in the DOM as text, which is what the second assertion catches.
    renderNode({ gainedLink: true, lostLink: true });
    for (const sel of [GAINED, LOST]) {
      const d = marks(sel)[0].querySelector("svg > path")?.getAttribute("d");
      expect(d).toBeTruthy();
    }
    for (const ligature of ["add_link", "link_off"]) {
      expect(screen.queryByText(ligature)).toBeNull();
    }
  });

  it("wears the timeline's own arriving / retiring colours", () => {
    renderNode({ gainedLink: true, lostLink: true });
    const fillOf = (sel: string) =>
      marks(sel)[0].querySelector("svg")?.getAttribute("fill");
    expect(fillOf(GAINED)).toBe(TIMELINE_COLORS.goLive);
    expect(fillOf(LOST)).toBe(STATUS_COLORS.error);
  });

  it("sits inside the card, not below it", () => {
    // The bug this pins: the icons first shipped at `bottom: -7`, hanging off
    // the card. Only the sign is asserted — nudging 5px to 6px is a design
    // call, crossing zero is a regression.
    renderNode({ gainedLink: true });
    const corner = marks(GAINED)[0].parentElement as HTMLElement;
    const style = getComputedStyle(corner);
    expect(style.position).toBe("absolute");
    for (const edge of [style.bottom, style.right]) {
      expect(edge).toMatch(/^\d/);
      expect(parseFloat(edge)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("LdvNode badges and focus ring", () => {
  it("badges a proposed card as new", () => {
    renderNode({ proposed: true });
    expect(screen.getByText("NEW")).toBeInTheDocument();
  });

  it("leaves an ordinary card unbadged", () => {
    renderNode();
    expect(screen.queryByText("NEW")).toBeNull();
  });

  it("rings the centred card and leaves an ordinary one unringed", () => {
    // jsdom keeps the `outline` shorthand verbatim and never expands it into
    // longhands, so read the shorthand — `outlineStyle` is always "" here.
    const outlineOf = (c: HTMLElement) =>
      getComputedStyle(c.firstElementChild as Element).outline;

    const { container: plain } = renderNode();
    expect(outlineOf(plain)).toBe("");

    const { container: centre } = renderNode({ isCenter: true });
    expect(outlineOf(centre)).toContain("solid");
    // The ring wears the card type's colour, not a palette entry of its own.
    expect(outlineOf(centre)).toContain("#0f7eb5");
  });
});

describe("LdvNode card logo", () => {
  const logo = () => document.querySelector("img");
  const typeIcon = () => document.querySelector(".ldv-type-icon");

  it("renders no image at all when the card has no logo", () => {
    renderNode();
    expect(logo()).toBeNull();
    // The type icon keeps the corner it has always had.
    expect(typeIcon()).not.toBeNull();
  });

  it("renders the logo and keeps the type icon as a badge when one is supplied", () => {
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=2026-08-28T10%3A00%3A00Z" });
    expect(logo()?.getAttribute("src")).toBe(
      "/api/v1/cards/app-1/logo?v=2026-08-28T10%3A00%3A00Z",
    );
    // Both identities stay readable: the mark AND what kind of card it is.
    expect(typeIcon()).not.toBeNull();
  });

  it("keeps the logo out of the export drop list and the type icon in it", () => {
    // The image export filter drops `.ldv-type-icon` because a Material
    // Symbols ligature rasterises as its raw name. A real same-origin <img>
    // is the one thing html-to-image CAN inline, so tagging it would throw
    // away the logo for no reason.
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=1" });
    expect(logo()?.classList.contains("ldv-type-icon")).toBe(false);
    expect(typeIcon()).not.toBeNull();
  });

  it("starts the text below the logo's band, at the card's full width", () => {
    // The logo is out of the flow, so it costs no height; the text hangs from
    // its band instead. Narrowing the text to sit BESIDE the mark was measured
    // and is worse than doing nothing — ~124px breaks a name after its second
    // word — so the name keeps the whole width and drops below the logo.
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=1" });
    const img = logo() as HTMLElement;
    const imgStyle = getComputedStyle(img);
    expect(imgStyle.position).toBe("absolute");

    const block = (document.querySelector("p") as HTMLElement).parentElement as HTMLElement;
    const blockStyle = getComputedStyle(block);
    const logoBottom = parseFloat(imgStyle.top) + parseFloat(imgStyle.height);
    expect(parseFloat(blockStyle.marginTop)).toBeGreaterThanOrEqual(logoBottom);
    // Full width: no side gutters eating into a long name.
    expect(parseFloat(blockStyle.paddingLeft) || 0).toBe(0);
    expect(parseFloat(blockStyle.paddingRight) || 0).toBe(0);
  });

  it("leaves a card with no logo exactly as it was before logos existed", () => {
    renderNode();
    const block = (document.querySelector("p") as HTMLElement).parentElement as HTMLElement;
    expect(parseFloat(getComputedStyle(block).marginTop) || 0).toBe(0);
  });

  it("shows a long name whole, wrapped, rather than cutting it short", () => {
    // The name used to be sliced at 26 characters in JS, before CSS ever saw
    // it — so no amount of room ever made a long name readable. The renderer
    // owns the cut now: the text is complete in the DOM and wraps.
    const long = "Salesforce Customer Community Portal";
    renderNode({ name: long, logoUrl: "/api/v1/cards/app-1/logo?v=1" });
    const nameEl = document.querySelector("p") as HTMLElement;
    expect(nameEl.textContent).toBe(long);
    expect(getComputedStyle(nameEl).whiteSpace).not.toBe("nowrap");
    expect(getComputedStyle(nameEl).webkitLineClamp).toBe("2");
  });

  it("gives the name one line when two extra fields need the other", () => {
    // Nothing clips a card — the badges deliberately overhang it — so the name
    // has to yield the line rather than let the card spill past its border.
    renderNode({
      logoUrl: "/api/v1/cards/app-1/logo?v=1",
      extraLines: [
        { label: "Subtype", value: "Business Application" },
        { label: "Owner", value: "A. Someone" },
      ],
    });
    const nameEl = document.querySelector("p") as HTMLElement;
    expect(getComputedStyle(nameEl).webkitLineClamp).toBe("1");
  });

  it("falls back to the plain type icon when the image fails to load", () => {
    // A wiped volume or a 404 must land on exactly the card this app drew
    // before logos existed — never a broken-image glyph.
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=1" });
    fireEvent.error(logo() as HTMLElement);
    expect(logo()).toBeNull();
    expect(typeIcon()).not.toBeNull();
  });
});

describe("LdvNode type icon placement", () => {
  // `sx` compiles to an emotion class, so the inline `style` attribute is
  // empty — read the resolved value, as the outline test above does.
  const iconPos = () => {
    const el = document.querySelector(".ldv-type-icon") as HTMLElement;
    const cs = getComputedStyle(el);
    return { top: cs.top, bottom: cs.bottom, left: cs.left, right: cs.right };
  };
  const isSet = (v: string) => v !== "" && v !== "auto";

  it("keeps the type icon at the top when there is no logo", () => {
    renderNode();
    const p = iconPos();
    expect(isSet(p.top)).toBe(true);
    expect(isSet(p.bottom)).toBe(false);
  });

  it("moves the type icon along the top edge when a logo takes the left corner", () => {
    // The logo owns the whole left side; the type icon joins the lifecycle dot
    // on the right, so the card's chrome reads as one row along the top.
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=1" });
    const p = iconPos();
    expect(isSet(p.top)).toBe(true);
    expect(isSet(p.right)).toBe(true);
    expect(isSet(p.bottom)).toBe(false);
    expect(isSet(p.left)).toBe(false);
  });

  it("sits clear of the lifecycle dot rather than under it", () => {
    // The dot is 9px plus a 1.5px border at right:6, so anything less than
    // ~18px of inset would overlap it.
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=1", lifecyclePhase: "active" });
    expect(parseFloat(iconPos().right)).toBeGreaterThanOrEqual(18);
  });

  it("takes the dot's own inset when there is no dot to clear", () => {
    // Reserving room for a dot that is not drawn would leave the icon
    // floating in from the edge for no reason.
    renderNode({ logoUrl: "/api/v1/cards/app-1/logo?v=1", lifecyclePhase: null });
    expect(parseFloat(iconPos().right)).toBeLessThan(18);
  });
});
