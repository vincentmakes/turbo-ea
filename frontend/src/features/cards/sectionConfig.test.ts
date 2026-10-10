import { describe, it, expect } from "vitest";

import {
  allFieldsHidden,
  buildSectionOrder,
  calculatedFieldKeys,
  customSectionsOf,
  hiddenFieldKeys,
  isSectionCollapsedByDefault,
  makeSectionConfigReader,
  sectionDefaultExpanded,
} from "./sectionConfig";
import type { SectionConfig, SectionDef } from "@/types";

const customSections: SectionDef[] = [
  { section: "Commercials", fields: [] },
  { section: "Operations", fields: [] },
];

const read = (sc: Parameters<typeof makeSectionConfigReader>[0]) =>
  makeSectionConfigReader(sc, customSections);

describe("makeSectionConfigReader", () => {
  describe("expanded", () => {
    it("uses the fallback when the section is unconfigured", () => {
      const sec = read({});
      // Relations is the one built-in that defaults to collapsed.
      expect(sec.expanded("relations", false)).toBe(false);
      expect(sec.expanded("description", true)).toBe(true);
    });

    it("honours an explicit true even when the fallback is collapsed", () => {
      // The reported bug: Relations configured "not collapsed" stayed collapsed
      // because the old check (`!== false ? fallback : false`) folded an
      // explicit `true` back into the collapsed fallback.
      const sec = read({ relations: { defaultExpanded: true } });
      expect(sec.expanded("relations", false)).toBe(true);
    });

    it("honours an explicit false even when the fallback is expanded", () => {
      const sec = read({ description: { defaultExpanded: false } });
      expect(sec.expanded("description", true)).toBe(false);
    });

    it("does not treat an unrelated stored key as a setting", () => {
      const sec = read({ relations: { hidden: false } });
      expect(sec.expanded("relations", false)).toBe(false);
      expect(sec.expanded("description", true)).toBe(true);
    });
  });

  describe("raw", () => {
    it("distinguishes unconfigured from an explicit false", () => {
      const sec = read({ eol: { defaultExpanded: false } });
      // EolLinkSection needs this: `undefined` means "use my own default"
      // (expand only when a product is linked), not "collapse".
      expect(sec.raw("eol")).toBe(false);
      expect(sec.raw("lifecycle")).toBeUndefined();
    });

    it("returns an explicit true", () => {
      expect(read({ eol: { defaultExpanded: true } }).raw("eol")).toBe(true);
    });
  });

  describe("custom sections", () => {
    it("reads the custom:N key", () => {
      const sec = read({ "custom:1": { defaultExpanded: false } });
      expect(sec.expanded("custom:1", true)).toBe(false);
      expect(sec.expanded("custom:0", true)).toBe(true);
    });

    it("falls back to the legacy label key", () => {
      // Installs predating the custom:N scheme keyed custom sections by label.
      // The Card Layout editor still reads those, so the renderer must too.
      const sec = read({ Commercials: { defaultExpanded: false, hidden: true } });
      expect(sec.expanded("custom:0", true)).toBe(false);
      expect(sec.hidden("custom:0")).toBe(true);
    });

    it("prefers the custom:N key over a stale label key", () => {
      const sec = read({
        "custom:0": { defaultExpanded: true },
        Commercials: { defaultExpanded: false },
      });
      expect(sec.expanded("custom:0", true)).toBe(true);
    });

    it("ignores a label key for an out-of-range index", () => {
      const sec = read({ Commercials: { defaultExpanded: false } });
      expect(sec.expanded("custom:9", true)).toBe(true);
    });
  });

  describe("hidden", () => {
    it("reports hidden sections and defaults to visible", () => {
      const sec = read({ lifecycle: { hidden: true }, tags: { hidden: false } });
      expect(sec.hidden("lifecycle")).toBe(true);
      expect(sec.hidden("tags")).toBe(false);
      expect(sec.hidden("relations")).toBe(false);
    });
  });

  describe("sectionDefaultExpanded", () => {
    it("collapses Relations and expands everything else", () => {
      expect(sectionDefaultExpanded("relations")).toBe(false);
      for (const key of ["description", "eol", "lifecycle", "hierarchy", "successors", "tags", "custom:0"]) {
        expect(sectionDefaultExpanded(key)).toBe(true);
      }
    });
  });

  describe("isSectionCollapsedByDefault", () => {
    it("reports Relations as collapsed when unconfigured", () => {
      // The bug: the Card Layout switch hardcoded "unconfigured = expanded", so
      // it read OFF on a Relations section the card rendered collapsed.
      expect(isSectionCollapsedByDefault(undefined, "relations")).toBe(true);
      expect(isSectionCollapsedByDefault({}, "relations")).toBe(true);
      expect(isSectionCollapsedByDefault(undefined, "description")).toBe(false);
    });

    it("lets an explicit setting override the section default", () => {
      expect(isSectionCollapsedByDefault({ defaultExpanded: true }, "relations")).toBe(false);
      expect(isSectionCollapsedByDefault({ defaultExpanded: false }, "description")).toBe(true);
    });
  });

  describe("editor / renderer agreement", () => {
    const keys = ["description", "eol", "lifecycle", "hierarchy", "successors", "tags", "relations", "custom:0"];
    const stored: (boolean | undefined)[] = [undefined, true, false];

    it("shows the switch as exactly the inverse of what the card will render", () => {
      // The Card Layout switch and CardDetailContent must never disagree —
      // that divergence is what made the Relations toggle look wrong.
      for (const key of keys) {
        for (const value of stored) {
          const cfg: SectionConfig | undefined =
            value === undefined ? undefined : { defaultExpanded: value };
          const reader = makeSectionConfigReader(
            cfg ? { [key]: cfg } : {},
            customSections,
          );
          expect(isSectionCollapsedByDefault(cfg, key)).toBe(
            !reader.expanded(key, sectionDefaultExpanded(key)),
          );
        }
      }
    });

    it("flips on one click and round-trips on two", () => {
      // `onToggleCollapsed` writes `isSectionCollapsedByDefault(cfg, key)`.
      const toggle = (cfg: SectionConfig | undefined, key: string): SectionConfig => ({
        ...cfg,
        defaultExpanded: isSectionCollapsedByDefault(cfg, key),
      });

      for (const key of keys) {
        const before = isSectionCollapsedByDefault(undefined, key);
        const once = toggle(undefined, key);
        expect(isSectionCollapsedByDefault(once, key)).toBe(!before);
        const twice = toggle(once, key);
        expect(isSectionCollapsedByDefault(twice, key)).toBe(before);
      }
    });
  });

  it("tolerates a missing section_config", () => {
    const sec = makeSectionConfigReader(undefined, []);
    expect(sec.expanded("relations", false)).toBe(false);
    expect(sec.expanded("description", true)).toBe(true);
    expect(sec.raw("eol")).toBeUndefined();
    expect(sec.hidden("lifecycle")).toBe(false);
  });
});

describe("buildSectionOrder", () => {
  const none = { hierarchy: false, successors: false };
  const both = { hierarchy: true, successors: true };

  it("uses the built-in order when none is stored", () => {
    expect(buildSectionOrder({}, 2, both)).toEqual([
      "description",
      "eol",
      "lifecycle",
      "custom:0",
      "custom:1",
      "hierarchy",
      "successors",
      "tags",
      "relations",
    ]);
  });

  it("leaves hierarchy and successors out of the built-in order for a type without them", () => {
    expect(buildSectionOrder(undefined, 0, none)).toEqual([
      "description",
      "eol",
      "lifecycle",
      "tags",
      "relations",
    ]);
  });

  it("treats an empty stored order as none", () => {
    expect(buildSectionOrder({ __order: [] }, 0, none)).toEqual([
      "description",
      "eol",
      "lifecycle",
      "tags",
      "relations",
    ]);
  });

  it("keeps a stored order and appends the custom sections it does not name", () => {
    const sc = { __order: ["relations", "custom:1", "tags", "description"] };
    expect(buildSectionOrder(sc, 3, none)).toEqual([
      "relations",
      "custom:1",
      "tags",
      "description",
      "custom:0",
      "custom:2",
    ]);
  });

  it("splices successors, then tags, in just before relations", () => {
    const sc = { __order: ["description", "relations", "lifecycle"] };
    expect(buildSectionOrder(sc, 0, both)).toEqual([
      "description",
      "successors",
      "tags",
      "relations",
      "lifecycle",
    ]);
  });

  it("appends them when the stored order has no relations", () => {
    const sc = { __order: ["description"] };
    expect(buildSectionOrder(sc, 0, both)).toEqual(["description", "successors", "tags"]);
  });

  it("never adds successors to a type that has none, and never moves a stored one", () => {
    expect(buildSectionOrder({ __order: ["relations"] }, 0, none)).toEqual(["tags", "relations"]);
    const stored = { __order: ["successors", "tags", "relations"] };
    expect(buildSectionOrder(stored, 0, both)).toEqual(["successors", "tags", "relations"]);
  });

  it("drops a stored hierarchy or successors the type no longer has", () => {
    const sc = { __order: ["hierarchy", "successors", "tags", "relations"] };
    expect(buildSectionOrder(sc, 0, none)).toEqual(["tags", "relations"]);
    expect(buildSectionOrder(sc, 0, { hierarchy: true, successors: false })).toEqual([
      "hierarchy",
      "tags",
      "relations",
    ]);
  });
});

describe("customSectionsOf", () => {
  it("drops the description extras section", () => {
    const schema: SectionDef[] = [
      { section: "__description", fields: [] },
      { section: "Commercials", fields: [] },
    ];
    expect(customSectionsOf(schema).map((s) => s.section)).toEqual(["Commercials"]);
    expect(customSectionsOf(undefined)).toEqual([]);
  });
});

describe("hiddenFieldKeys", () => {
  const subtypes = [
    { key: "saas", hidden_fields: ["hosting", "region"] },
    { key: "onprem" },
  ];

  it("hides the active subtype's fields", () => {
    expect([...hiddenFieldKeys(subtypes, "saas", {}, [])]).toEqual(["hosting", "region"]);
    expect([...hiddenFieldKeys(subtypes, "onprem", {}, [])]).toEqual([]);
    expect([...hiddenFieldKeys(subtypes, null, {}, [])]).toEqual([]);
    expect([...hiddenFieldKeys(undefined, "saas", {}, [])]).toEqual([]);
  });

  it("adds what registered extensions report and ignores the rest", () => {
    const reported = { acme: ["cost"], gone: ["owner"] };
    expect([...hiddenFieldKeys(subtypes, "saas", reported, ["acme"])]).toEqual([
      "hosting",
      "region",
      "cost",
    ]);
  });
});

describe("allFieldsHidden", () => {
  const section = (keys: string[]): SectionDef =>
    ({ section: "S", fields: keys.map((key) => ({ key })) }) as unknown as SectionDef;

  it("is true only when every field of a non-empty section is hidden", () => {
    expect(allFieldsHidden(section(["a", "b"]), new Set(["a", "b", "c"]))).toBe(true);
    expect(allFieldsHidden(section(["a", "b"]), new Set(["a"]))).toBe(false);
    expect(allFieldsHidden(section([]), new Set(["a"]))).toBe(false);
  });
});

describe("calculatedFieldKeys", () => {
  const schema = [
    { section: "A", fields: [{ key: "total" }, { key: "name" }] },
    { section: "B", fields: [{ key: "score" }] },
  ] as unknown as SectionDef[];

  it("lists calculated fields, then auto fields not already among them", () => {
    const calc = (k: string) => k === "total" || k === "score";
    expect(calculatedFieldKeys(schema, calc, ["costActual", "total"])).toEqual([
      "total",
      "score",
      "costActual",
    ]);
  });

  it("is empty with no schema and no auto fields", () => {
    expect(calculatedFieldKeys(undefined, () => true, [])).toEqual([]);
  });
});
