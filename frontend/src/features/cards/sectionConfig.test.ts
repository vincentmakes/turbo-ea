import { describe, it, expect } from "vitest";

import {
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
