/**
 * The Layered Dependency View's rules, apart from React Flow. Every
 * expectation is a literal: comparing against the module's own constants
 * would move with a mutated constant and prove nothing.
 */
import { describe, expect, it } from "vitest";

import {
  CLICK_SLOP,
  DOT_BOX,
  DOT_INSET,
  FALLBACK_TYPE_COLOR,
  MAX_EDGE_LABEL_CHARS,
  PHASE_DOT,
  TYPE_ICON_RIGHT_BESIDE_DOT,
  cardBorder,
  cardClickAction,
  cardTint,
  changeAccent,
  changeBadge,
  connectorWidth,
  countByType,
  edgeColors,
  edgeIsActive,
  edgeLabelWidth,
  edgeStrokeWidth,
  exportFileName,
  handleBaseId,
  handleOffset,
  handleStyle,
  hidesCardsOnView,
  labelHitsObstacle,
  movedBeyondClick,
  nameLineClamp,
  nextBackground,
  paintOrder,
  phaseDotColor,
  placeEdgeLabel,
  safeTypeColor,
  touchesHovered,
  truncateEdgeLabel,
  typeIconPlacement,
} from "./ldvViewModel";

describe("card colour", () => {
  it("keeps a #rrggbb type colour and greys anything else", () => {
    expect(safeTypeColor("#0f7eb5")).toBe("#0f7eb5");
    expect(safeTypeColor("#ABCDEF")).toBe("#ABCDEF");
    expect(safeTypeColor("#abc")).toBe("#9e9e9e");
    expect(safeTypeColor("red")).toBe("#9e9e9e");
    expect(safeTypeColor("#0f7eb5ff")).toBe("#9e9e9e");
    expect(safeTypeColor("x#0f7eb5")).toBe("#9e9e9e");
    expect(safeTypeColor("#0f7eg5")).toBe("#9e9e9e");
    expect(FALLBACK_TYPE_COLOR).toBe("#9e9e9e");
  });

  it("washes 12 % in light mode, 22 % in dark, 6 % on a proposed card", () => {
    expect(cardTint("#0f7eb5", false, false)).toBe("rgba(15,126,181,0.12)");
    expect(cardTint("#0f7eb5", true, false)).toBe("rgba(15,126,181,0.22)");
    expect(cardTint("#0f7eb5", true, true)).toBe("rgba(15,126,181,0.06)");
    expect(cardTint("#0f7eb5", false, true)).toBe("rgba(15,126,181,0.06)");
  });
});

describe("lifecycle dot", () => {
  it("colours each phase like the lifecycle badge", () => {
    expect(PHASE_DOT).toEqual({
      plan: "#9e9e9e",
      phaseIn: "#1976d2",
      active: "#2e7d32",
      phaseOut: "#ed6c02",
      endOfLife: "#d32f2f",
    });
    expect(phaseDotColor("active")).toBe("#2e7d32");
    expect(phaseDotColor("phaseOut")).toBe("#ed6c02");
  });

  it("greys an unknown phase and draws no dot without one", () => {
    expect(phaseDotColor("retiring")).toBe("#9e9e9e");
    expect(phaseDotColor(null)).toBeNull();
    expect(phaseDotColor("")).toBeNull();
  });
});

describe("time-travel change", () => {
  it("accents arriving and planned cards purple, retired ones red, others not at all", () => {
    expect(changeAccent("arriving")).toBe("#7c4dff");
    expect(changeAccent("planned")).toBe("#7c4dff");
    expect(changeAccent("retired")).toBe("#f44336");
    expect(changeAccent(undefined)).toBeNull();
  });

  it("borders a changing card in its colour, dashed only when it is not there", () => {
    expect(cardBorder("#7c4dff", true, false, "#123456")).toBe("2px solid #7c4dff");
    expect(cardBorder("#f44336", false, false, "#123456")).toBe("2px dashed #f44336");
    expect(cardBorder("#7c4dff", false, true, "#123456")).toBe("2px dashed #7c4dff");
  });

  it("dashes a proposed card in its accent and draws any other card thin and solid", () => {
    expect(cardBorder(null, true, true, "#123456")).toBe("2px dashed #123456");
    expect(cardBorder(null, true, false, "#123456")).toBe("1.5px solid #123456");
    expect(cardBorder(null, false, false, "#123456")).toBe("1.5px solid #123456");
  });

  it("badges a planned card on top and a retired one at the bottom", () => {
    expect(changeBadge("planned", false, false)).toEqual({
      onTop: true,
      labelKey: "dependency.plannedBadge",
    });
    expect(changeBadge("retired", false, false)).toEqual({
      onTop: false,
      labelKey: "dependency.retiredBadge",
    });
  });

  it("moves a planned badge to the bottom when a NEW badge holds the top", () => {
    expect(changeBadge("planned", false, true)).toEqual({
      onTop: false,
      labelKey: "dependency.plannedBadge",
    });
    expect(changeBadge("retired", false, true)).toEqual({
      onTop: false,
      labelKey: "dependency.retiredBadge",
    });
  });

  it("badges nothing that is in the viewed landscape, or not changing", () => {
    expect(changeBadge("arriving", true, false)).toBeNull();
    expect(changeBadge("planned", true, false)).toBeNull();
    expect(changeBadge(undefined, true, false)).toBeNull();
    expect(changeBadge(undefined, false, false)).toBeNull();
  });
});

describe("card chrome placement", () => {
  it("measures the type icon's spot beside the dot from the dot's own box", () => {
    expect(DOT_INSET).toBe(6);
    expect(DOT_BOX).toBe(12);
    expect(TYPE_ICON_RIGHT_BESIDE_DOT).toBe(21);
  });

  it("puts the type icon top-left without a logo, top-right with one", () => {
    expect(typeIconPlacement(false, true)).toEqual({ left: 6 });
    expect(typeIconPlacement(false, false)).toEqual({ left: 6 });
    expect(typeIconPlacement(true, true)).toEqual({ right: 21 });
    expect(typeIconPlacement(true, false)).toEqual({ right: 6 });
  });

  it("gives the name two lines, one when two extra fields are shown", () => {
    expect(nameLineClamp(0)).toBe(2);
    expect(nameLineClamp(1)).toBe(2);
    expect(nameLineClamp(2)).toBe(1);
    expect(nameLineClamp(3)).toBe(1);
  });
});

describe("handles", () => {
  it("maps a mirrored handle onto its base and leaves the rest alone", () => {
    expect(handleBaseId("ts-3")).toBe("t-3");
    expect(handleBaseId("bt-12")).toBe("b-12");
    expect(handleBaseId("t-3")).toBe("t-3");
    expect(handleBaseId("l-0")).toBe("l-0");
    expect(handleBaseId("xts-3")).toBe("xts-3");
  });

  it("shows a used handle's dot in the card's colour", () => {
    expect(handleStyle("t-2", new Set(["t-2"]), "#0f7eb5")).toEqual({
      background: "#0f7eb5",
      width: 5,
      height: 5,
      border: "none",
      opacity: 1,
    });
  });

  it("shows a mirrored handle when its base is used, and hides an unused one", () => {
    expect(handleStyle("ts-2", new Set(["t-2"]), "#0f7eb5").opacity).toBe(1);
    expect(handleStyle("bt-4", new Set(["b-4"]), "#0f7eb5").background).toBe("#0f7eb5");
    expect(handleStyle("t-5", new Set(["t-2"]), "#0f7eb5")).toEqual({
      background: "transparent",
      width: 5,
      height: 5,
      border: "none",
      opacity: 0,
    });
  });

  it("does not light a base handle because its mirror is used", () => {
    expect(handleStyle("t-2", new Set(["ts-2"]), "#0f7eb5").opacity).toBe(0);
  });

  it("merges the caller's position into the style", () => {
    expect(handleStyle("t-1", new Set(), "#000000", { left: "25%" })).toEqual({
      background: "transparent",
      width: 5,
      height: 5,
      border: "none",
      opacity: 0,
      left: "25%",
    });
  });

  it("places top and bottom handles along their edge, side handles nowhere", () => {
    expect(handleOffset({ side: "top", frac: 0.25 })).toEqual({ left: "25%" });
    expect(handleOffset({ side: "bottom", frac: 0.5 })).toEqual({ left: "50%" });
    expect(handleOffset({ side: "left", frac: 0.25 })).toBeUndefined();
    expect(handleOffset({ side: "right", frac: 0.75 })).toBeUndefined();
  });
});

describe("click versus drag", () => {
  it("treats up to five pixels on either axis as a click", () => {
    expect(CLICK_SLOP).toBe(5);
    const from = { x: 100, y: 100 };
    expect(movedBeyondClick(from, { x: 100, y: 100 })).toBe(false);
    expect(movedBeyondClick(from, { x: 105, y: 95 })).toBe(false);
    expect(movedBeyondClick(from, { x: 106, y: 100 })).toBe(true);
    expect(movedBeyondClick(from, { x: 94, y: 100 })).toBe(true);
    expect(movedBeyondClick(from, { x: 100, y: 106 })).toBe(true);
    expect(movedBeyondClick(from, { x: 100, y: 94 })).toBe(true);
  });
});

describe("line state", () => {
  it("lights a line by hover, or by its card, outside highlight mode", () => {
    expect(edgeIsActive({})).toBe(false);
    expect(edgeIsActive({ isHovered: true })).toBe(true);
    expect(edgeIsActive({ connectedToHovered: true })).toBe(true);
    expect(edgeIsActive({ isHovered: false, connectedToHovered: false })).toBe(false);
  });

  it("lights a line only by its card in highlight mode", () => {
    expect(edgeIsActive({ highlightMode: true, isHovered: true })).toBe(false);
    expect(edgeIsActive({ highlightMode: true, connectedToHovered: true })).toBe(true);
  });

  it("colours an idle and a lit line per theme", () => {
    expect(edgeColors(false, false, false)).toEqual({
      stroke: "#777",
      label: "#666",
      labelBorder: "#ccc",
      labelBackground: "#ffffff",
    });
    expect(edgeColors(true, false, false)).toEqual({
      stroke: "#1976d2",
      label: "#1976d2",
      labelBorder: "#1976d2",
      labelBackground: "#ffffff",
    });
    expect(edgeColors(false, false, true)).toEqual({
      stroke: "#aaa",
      label: "#aaa",
      labelBorder: "#444",
      labelBackground: "#121212",
    });
    expect(edgeColors(true, false, true)).toEqual({
      stroke: "#4fc3f7",
      label: "#4fc3f7",
      labelBorder: "#4fc3f7",
      labelBackground: "#121212",
    });
  });

  it("keeps a severed line red, lit or not, while its label still lights", () => {
    expect(edgeColors(false, true, false).stroke).toBe("#f44336");
    expect(edgeColors(true, true, false)).toEqual({
      stroke: "#f44336",
      label: "#1976d2",
      labelBorder: "#1976d2",
      labelBackground: "#ffffff",
    });
    expect(edgeColors(true, true, true).stroke).toBe("#f44336");
  });
});

describe("line label", () => {
  it("cuts a verb past 24 characters with an ellipsis", () => {
    expect(MAX_EDGE_LABEL_CHARS).toBe(24);
    expect(truncateEdgeLabel("")).toBe("");
    expect(truncateEdgeLabel("a".repeat(24))).toBe("a".repeat(24));
    expect(truncateEdgeLabel("is supported by the platform")).toBe("is supported by the pla…");
    expect(truncateEdgeLabel("a".repeat(25))).toHaveLength(24);
  });

  it("sizes the label box from the verb, the arrow and the count", () => {
    expect(edgeLabelWidth("", false, "")).toBe(16);
    expect(edgeLabelWidth("uses", false, "")).toBe(42);
    expect(edgeLabelWidth("uses", true, "")).toBe(59);
    expect(edgeLabelWidth("uses", false, "12")).toBe(70);
    expect(edgeLabelWidth("uses", true, "3")).toBe(80);
  });
});

describe("stroke width", () => {
  it("grows a connector with the log of its count, capped", () => {
    expect(connectorWidth(1)).toBe(1.6);
    expect(connectorWidth(0)).toBe(1.6);
    expect(connectorWidth(2)).toBe(2.6);
    expect(connectorWidth(4)).toBe(3.6);
    expect(connectorWidth(7)).toBeCloseTo(1.6 + Math.log2(7), 10);
    expect(connectorWidth(8)).toBeCloseTo(4.4, 10);
    expect(connectorWidth(1000)).toBeCloseTo(4.4, 10);
  });

  it("draws an ordinary line 1.2 wide, 2 when lit", () => {
    expect(edgeStrokeWidth(undefined, false)).toBe(1.2);
    expect(edgeStrokeWidth(undefined, true)).toBe(2);
  });

  it("draws a connector at its width, 0.8 heavier when lit", () => {
    expect(edgeStrokeWidth(4, false)).toBe(3.6);
    expect(edgeStrokeWidth(4, true)).toBeCloseTo(4.4, 10);
    expect(edgeStrokeWidth(1, false)).toBe(1.6);
  });
});

describe("label obstacles", () => {
  const size = { width: 40, height: 20, margin: 6 };
  // The label at (100, 100) spans x 74..126 and y 84..116 with its margin.
  const box = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });

  it("finds a box the label (with its margin) overlaps", () => {
    expect(labelHitsObstacle(100, 100, size, [box(90, 90, 110, 110)])).toBe(true);
    expect(labelHitsObstacle(100, 100, size, [box(125, 90, 200, 110)])).toBe(true);
    expect(labelHitsObstacle(100, 100, size, [box(0, 115, 200, 200)])).toBe(true);
  });

  it("clears a box that only touches the margin's edge", () => {
    expect(labelHitsObstacle(100, 100, size, [box(126, 0, 200, 200)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(0, 0, 74, 200)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(0, 116, 200, 200)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(0, 0, 200, 84)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [])).toBe(false);
  });

  it("counts the margin on every side", () => {
    const noMargin = { width: 40, height: 20, margin: 0 };
    expect(labelHitsObstacle(100, 100, noMargin, [box(122, 0, 200, 200)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(122, 0, 200, 200)])).toBe(true);
    expect(labelHitsObstacle(100, 100, noMargin, [box(0, 112, 200, 200)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(0, 112, 200, 200)])).toBe(true);
    expect(labelHitsObstacle(100, 100, noMargin, [box(0, 0, 78, 200)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(0, 0, 78, 200)])).toBe(true);
    expect(labelHitsObstacle(100, 100, noMargin, [box(0, 0, 200, 88)])).toBe(false);
    expect(labelHitsObstacle(100, 100, size, [box(0, 0, 200, 88)])).toBe(true);
  });
});

describe("placeEdgeLabel", () => {
  // A horizontal line from x 0 to x 1000 at y 50: t maps straight to x.
  const along = (t: number) => ({ x: t * 1000, y: 50 });
  const size = { width: 20, height: 10, margin: 0 };
  const box = (x1: number, x2: number) => ({ x1, y1: 0, x2, y2: 100 });

  it("keeps the preferred spot when it is clear", () => {
    expect(placeEdgeLabel(along, 0.5, size, [])).toEqual({ x: 500, y: 50 });
    expect(placeEdgeLabel(along, 0.3, size, [box(800, 900)])).toEqual({ x: 300, y: 50 });
  });

  it("moves to the clear sample nearest the preferred spot", () => {
    // A card over x 400..600 hides t 0.40..0.60 (the label is 20 wide).
    expect(placeEdgeLabel(along, 0.5, size, [box(400, 600)])).toEqual({ x: 350, y: 50 });
    expect(placeEdgeLabel(along, 0.55, size, [box(400, 600)])).toEqual({ x: 650, y: 50 });
  });

  it("never lands within 8 % of either end", () => {
    // Everything from x 150 on is covered: only the samples near the start are clear.
    const covered = [box(150, 1000)];
    expect(placeEdgeLabel(along, 0.5, size, covered)).toEqual({ x: 100, y: 50 });
    // Everything up to x 850: only t 0.9 is left (0.95 is too close to the end).
    expect(placeEdgeLabel(along, 0.5, size, [box(0, 850)])).toEqual({ x: 900, y: 50 });
  });

  it("falls back to the preferred spot when every sample is blocked", () => {
    expect(placeEdgeLabel(along, 0.5, size, [box(-100, 1100)])).toEqual({ x: 500, y: 50 });
  });

  it("samples every 0.05 from t 0.1 to 0.9, after the preferred spot", () => {
    const asked: number[] = [];
    placeEdgeLabel(
      (t) => {
        asked.push(Math.round(t * 100) / 100);
        return { x: t * 1000, y: 50 };
      },
      0.5,
      size,
      [box(-100, 1100)],
    );
    expect(asked).toEqual([
      0.5, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8,
      0.85, 0.9,
    ]);
  });

  it("prefers the earlier sample on a tie", () => {
    // Clear at t 0.4 and 0.6, equally far from 0.5.
    const at = (t: number) => ({ x: t * 1000, y: 50 });
    const blocked = [box(0, 385), box(415, 585), box(615, 1000)];
    expect(placeEdgeLabel(at, 0.5, size, blocked)).toEqual({ x: 400, y: 50 });
  });
});

describe("canvas", () => {
  it("counts the cards of each type", () => {
    const counts = countByType([
      { type: "Application" },
      { type: "Interface" },
      { type: "Application" },
    ]);
    expect([...counts]).toEqual([
      ["Application", 2],
      ["Interface", 1],
    ]);
    expect(countByType([]).size).toBe(0);
  });

  it("knows the type filter emptied the view only when a hidden type has cards", () => {
    const counts = new Map([["Application", 3]]);
    expect(hidesCardsOnView(["Interface", "Application"], counts)).toBe(true);
    expect(hidesCardsOnView(["Interface"], counts)).toBe(false);
    expect(hidesCardsOnView([], counts)).toBe(false);
  });

  it("cycles the background dots → lines → none → dots", () => {
    expect(nextBackground("dots")).toBe("lines");
    expect(nextBackground("lines")).toBe("none");
    expect(nextBackground("none")).toBe("dots");
  });

  it("names an export after the centre card, made file-safe", () => {
    expect(exportFileName("SAP S/4HANA (prod)", "png")).toBe("SAP_S_4HANA_prod_.png");
    expect(exportFileName("crm-v2.1", "svg")).toBe("crm-v2.1.svg");
    expect(exportFileName("a  b", "png")).toBe("a_b.png");
    expect(exportFileName(undefined, "svg")).toBe("dependency.svg");
    expect(exportFileName("", "png")).toBe("dependency.png");
  });
});

describe("cardClickAction", () => {
  const all = { expand: true, reveal: true, recentre: true };
  const none = { expand: false, reveal: false, recentre: false };

  it("toggles the highlight in highlight mode, whatever else is wired", () => {
    expect(cardClickAction("highlight", true, all)).toEqual({ kind: "toggleHighlight" });
    expect(cardClickAction("highlight", false, none)).toEqual({ kind: "toggleHighlight" });
  });

  it("expands, or reveals parents or children, in those modes", () => {
    expect(cardClickAction("expand", false, all)).toEqual({ kind: "expand" });
    expect(cardClickAction("parents", false, all)).toEqual({
      kind: "reveal",
      direction: "parents",
    });
    expect(cardClickAction("children", true, all)).toEqual({
      kind: "reveal",
      direction: "children",
    });
  });

  it("re-centres on a shift-click and opens on a plain one", () => {
    expect(cardClickAction("normal", true, all)).toEqual({ kind: "recentre" });
    expect(cardClickAction("normal", false, all)).toEqual({ kind: "open" });
  });

  it("falls through to the plain click when the mode's handler is missing", () => {
    expect(cardClickAction("expand", false, { ...all, expand: false })).toEqual({ kind: "open" });
    expect(cardClickAction("expand", true, { ...all, expand: false })).toEqual({
      kind: "recentre",
    });
    expect(cardClickAction("parents", false, { ...all, reveal: false })).toEqual({
      kind: "open",
    });
    expect(cardClickAction("children", false, { ...all, reveal: false })).toEqual({
      kind: "open",
    });
    expect(cardClickAction("normal", true, { ...all, recentre: false })).toEqual({
      kind: "open",
    });
  });
});

describe("hover", () => {
  it("touches a line at either end", () => {
    expect(touchesHovered({ source: "a", target: "b" }, "a")).toBe(true);
    expect(touchesHovered({ source: "a", target: "b" }, "b")).toBe(true);
    expect(touchesHovered({ source: "a", target: "b" }, "c")).toBe(false);
    expect(touchesHovered({ source: "a", target: "b" }, null)).toBe(false);
  });

  it("touches a connector through any relation it merged", () => {
    const connector = {
      source: "box-1",
      target: "box-2",
      data: {
        members: [
          { source: "a", target: "x" },
          { source: "b", target: "y" },
        ],
      },
    };
    expect(touchesHovered(connector, "a")).toBe(true);
    expect(touchesHovered(connector, "y")).toBe(true);
    expect(touchesHovered(connector, "z")).toBe(false);
    expect(touchesHovered({ source: "a", target: "b", data: {} }, "z")).toBe(false);
  });

  const edge = (id: string, connectedToHovered = false) => ({ id, data: { connectedToHovered } });

  it("paints the hovered line last", () => {
    const edges = [edge("e1"), edge("e2"), edge("e3")];
    expect(paintOrder(edges, "e1", null).map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
    expect(paintOrder(edges, "e2", "x").map((e) => e.id)).toEqual(["e1", "e3", "e2"]);
  });

  it("keeps the order when the hovered line is not drawn", () => {
    const edges = [edge("e1"), edge("e2")];
    expect(paintOrder(edges, "gone", null)).toBe(edges);
  });

  it("paints a hovered card's lines after the others, each group in order", () => {
    const edges = [edge("e1", true), edge("e2"), edge("e3", true), edge("e4")];
    expect(paintOrder(edges, null, "card").map((e) => e.id)).toEqual(["e2", "e4", "e1", "e3"]);
  });

  it("keeps the order when nothing is hovered", () => {
    const edges = [edge("e1", true), edge("e2")];
    expect(paintOrder(edges, null, null)).toBe(edges);
  });
});
