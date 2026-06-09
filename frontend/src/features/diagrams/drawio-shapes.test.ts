import { describe, it, expect } from "vitest";
import { buildCardCellData } from "./drawio-shapes";
import { ICON_PATHS } from "./iconPaths";

const base = { cardId: "abcdef12-3456", cardType: "Application", name: "NexaCore", color: "#0f7eb5", x: 0, y: 0 };

describe("buildCardCellData — card-type icon", () => {
  it("bakes a corner icon into the shape style for a known icon", () => {
    const { style } = buildCardCellData({ ...base, icon: "apps" });
    expect(style).toContain("shape=label");
    expect(style).toContain("imageAlign=left");
    expect(style).toContain("imageVerticalAlign=top");
    // Reserve a left gutter so the label never overlaps the corner glyph.
    expect(style).toContain("spacingLeft=24");
    const imageToken = style.split(";").find((p) => p.startsWith("image="));
    expect(imageToken).toBeDefined();
    expect(imageToken).toMatch(/^image=data:image\/svg\+xml,/);
  });

  it("encodes the SVG so the image token has no raw ';' (mxGraph-safe)", () => {
    const { style } = buildCardCellData({ ...base, icon: "database" });
    const imageToken = style.split(";").find((p) => p.startsWith("image="))!;
    // encodeURIComponent escapes ';' and '=', so the token is a single,
    // intact style entry — splitting on ';' must not fragment it.
    expect(imageToken).not.toContain("<");
    expect(decodeURIComponent(imageToken.slice("image=".length))).toContain("<svg");
  });

  it("falls back to a plain rounded rect when the icon is unknown", () => {
    const { style } = buildCardCellData({ ...base, icon: "not_a_real_icon_xyz" });
    expect(style).not.toContain("shape=label");
    expect(style).not.toContain("image=");
    expect(style).toContain("rounded=1");
  });

  it("falls back to a plain rounded rect when no icon is given", () => {
    const { style } = buildCardCellData(base);
    expect(style).not.toContain("shape=label");
  });

  it("survives the view-recolour split/concat round-trip intact", () => {
    const { style } = buildCardCellData({ ...base, icon: "apps" });
    // Mirror applyViewToGraph / resetViewColors: drop fill/stroke, re-add.
    const next = style
      .split(";")
      .filter(Boolean)
      .filter((p) => !p.startsWith("fillColor=") && !p.startsWith("strokeColor="))
      .concat(["fillColor=#ff0000", "strokeColor=#aa0000"])
      .join(";");
    expect(next).toContain("shape=label");
    expect(next.split(";").find((p) => p.startsWith("image="))).toMatch(/data:image\/svg\+xml/);
  });
});

describe("ICON_PATHS coverage", () => {
  it("covers the built-in card-type default icons", () => {
    const defaults = [
      "flag", "layers", "rocket_launch", "corporate_fare", "account_tree",
      "swap_horiz", "route", "apps", "sync_alt", "database", "memory",
      "category", "storefront",
    ];
    for (const name of defaults) {
      expect(ICON_PATHS[name]?.d, `missing path for ${name}`).toBeTruthy();
      expect(ICON_PATHS[name]?.vb).toBeTruthy();
    }
  });
});
