/**
 * The one canvas renderer for a step's links — dots, never names.
 */
import { describe, it, expect } from "vitest";

import { LINK_KIND_ORDER, CALLED_PROCESS_COLOR } from "./calledProcess";
import {
  LINK_DOTS_OVERLAY_TYPE,
  LINK_TYPE_COLORS,
  escapeHtml,
  hasBottomMarker,
  linkDotPlacement,
  linkDotsFor,
  linkDotsHtml,
} from "./linkDots";

describe("LINK_TYPE_COLORS", () => {
  it("covers every kind, and the process colour is the shared constant", () => {
    for (const kind of LINK_KIND_ORDER) expect(LINK_TYPE_COLORS[kind]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(LINK_TYPE_COLORS.process).toBe(CALLED_PROCESS_COLOR);
  });
});

describe("linkDotsFor", () => {
  it("orders the dots by LINK_KIND_ORDER whatever order the titles came in", () => {
    const dots = linkDotsFor(
      { organization: "Sales, Finance", process: "Credit Check", application: "SAP" },
      LINK_TYPE_COLORS,
    );
    expect(dots.map((d) => d.kind)).toEqual(["process", "application", "organization"]);
    expect(dots[0].color).toBe(CALLED_PROCESS_COLOR);
    expect(dots[2].title).toBe("Sales, Finance");
  });

  it("skips a kind with no title — no link, no dot", () => {
    const dots = linkDotsFor({ application: "", data_object: null, it_component: undefined }, LINK_TYPE_COLORS);
    expect(dots).toEqual([]);
  });

  it("takes the colours it is given, so a recoloured type shows", () => {
    const dots = linkDotsFor({ application: "SAP" }, { ...LINK_TYPE_COLORS, application: "#123456" });
    expect(dots[0].color).toBe("#123456");
  });
});

describe("linkDotsHtml", () => {
  it("is null with nothing to draw, so the host adds no overlay", () => {
    expect(linkDotsHtml([], 100)).toBeNull();
  });

  it("draws one dot per kind, coloured, with the name as hover text", () => {
    const html = linkDotsHtml(
      [
        { kind: "process", color: "#028f00", title: "Credit Check" },
        { kind: "application", color: "#0f7eb5", title: "SAP" },
      ],
      120,
    )!;
    expect(html).toContain('class="turboea-link-dots"');
    expect(html).toContain("width:120px");
    expect(html).toContain("justify-content:center");
    expect(html.match(/turboea-link-dot /g)).toHaveLength(2);
    expect(html).toContain("turboea-link-dot-process");
    expect(html).toContain("background:#028f00");
    expect(html).toContain('title="Credit Check"');
    expect(html).toContain('title="SAP"');
    // Names are hover text only — never rendered as visible content.
    expect(html).not.toMatch(/>Credit Check</);
  });

  it("escapes the hover text — a name is user text, not markup", () => {
    const html = linkDotsHtml([{ kind: "application", color: "#000", title: '<b>"x"</b>' }], 100)!;
    expect(html).not.toContain("<b>");
    expect(html).toContain('title="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"');
  });
});

describe("linkDotPlacement", () => {
  it("hangs under the external label when the shape has one", () => {
    const p = linkDotPlacement({ id: "ev", width: 36, label: { id: "ev_label", width: 90 } });
    expect(p).toEqual({ elementId: "ev_label", position: { bottom: -2, left: 0 }, width: 90 });
  });

  it("sits at the bottom of a shape that draws its name inside", () => {
    const p = linkDotPlacement({ id: "task", width: 100, label: null });
    expect(p.elementId).toBe("task");
    expect(p.width).toBe(100);
    // `bottom` is the overlay's top edge measured from the shape's bottom, so
    // it must exceed the dot height to keep the row inside the border.
    expect(p.position.bottom).toBeGreaterThan(8);
  });

  it("ignores a label bpmn-js created but never sized", () => {
    const p = linkDotPlacement({ id: "gw", width: 50, label: { id: "gw_label", width: 0 } });
    expect(p.elementId).toBe("gw");
  });

  const bo = (type: string, extra: Record<string, unknown> = {}) => ({
    $instanceOf: (t: string) => t === type,
    ...extra,
  });

  it("hangs the row under a shape whose bottom centre carries a marker", () => {
    const plain = linkDotPlacement({ id: "t", width: 100, businessObject: bo("bpmn:UserTask") });
    const call = linkDotPlacement({ id: "c", width: 100, businessObject: bo("bpmn:CallActivity") });
    const loop = linkDotPlacement({
      id: "l",
      width: 100,
      businessObject: bo("bpmn:UserTask", { loopCharacteristics: {} }),
    });
    const collapsed = linkDotPlacement({
      id: "s",
      width: 100,
      collapsed: true,
      businessObject: bo("bpmn:SubProcess"),
    });
    const expanded = linkDotPlacement({
      id: "s2",
      width: 300,
      collapsed: false,
      businessObject: bo("bpmn:SubProcess"),
    });
    // The marker owns the bottom of the box and a two-line name the middle,
    // so the row goes outside: a negative `bottom` puts its top edge below
    // the shape's bottom edge.
    for (const p of [call, loop, collapsed]) expect(p.position.bottom).toBeLessThan(0);
    expect(plain.position.bottom).toBe(14);
    expect(expanded.position.bottom).toBe(14);
    expect(hasBottomMarker({ id: "x" })).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("neutralises the five characters that matter in an attribute or text", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("LINK_DOTS_OVERLAY_TYPE", () => {
  it("is namespaced so a host removes only its own overlays", () => {
    expect(LINK_DOTS_OVERLAY_TYPE).toMatch(/^turboea-/);
  });
});
