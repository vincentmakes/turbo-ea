import { describe, it, expect } from "vitest";
import {
  SOAW_TEMPLATE_SECTIONS,
  TOGAF_PHASES,
  buildDefaultSections,
} from "./soawTemplate";

describe("SOAW_TEMPLATE_SECTIONS", () => {
  it("contains 18 template sections", () => {
    expect(SOAW_TEMPLATE_SECTIONS).toHaveLength(18);
  });

  it("every section has required fields", () => {
    for (const section of SOAW_TEMPLATE_SECTIONS) {
      expect(section.id).toBeTruthy();
      expect(section.title).toBeTruthy();
      expect(["rich_text", "table", "togaf_phases"]).toContain(section.type);
      expect(["I", "II"]).toContain(section.part);
      expect([1, 2, 3]).toContain(section.level);
    }
  });

  it("has unique IDs", () => {
    const ids = SOAW_TEMPLATE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Part I sections come first", () => {
    const parts = SOAW_TEMPLATE_SECTIONS.map((s) => s.part);
    const firstPart2Idx = parts.indexOf("II");
    const lastPart1Idx = parts.lastIndexOf("I");
    expect(lastPart1Idx).toBeLessThan(firstPart2Idx);
  });

  it("table sections have columns defined", () => {
    const tableSections = SOAW_TEMPLATE_SECTIONS.filter(
      (s) => s.type === "table",
    );
    expect(tableSections.length).toBeGreaterThan(0);
    for (const section of tableSections) {
      expect(section.columns).toBeDefined();
      expect(section.columns!.length).toBeGreaterThan(0);
    }
  });

  it("has exactly one togaf_phases section", () => {
    const togafSections = SOAW_TEMPLATE_SECTIONS.filter(
      (s) => s.type === "togaf_phases",
    );
    expect(togafSections).toHaveLength(1);
    expect(togafSections[0].id).toBe("3.1");
  });
});

describe("TOGAF_PHASES", () => {
  it("contains 9 phases (A-H + RM)", () => {
    expect(TOGAF_PHASES).toHaveLength(9);
  });

  it("has unique keys", () => {
    const keys = TOGAF_PHASES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("starts with phase A and ends with RM", () => {
    expect(TOGAF_PHASES[0].key).toBe("A");
    expect(TOGAF_PHASES[TOGAF_PHASES.length - 1].key).toBe("RM");
  });

  it("every phase has a label", () => {
    for (const phase of TOGAF_PHASES) {
      expect(phase.label).toBeTruthy();
    }
  });
});

describe("buildDefaultSections", () => {
  it("creates an entry for every template section", () => {
    const sections = buildDefaultSections();
    for (const def of SOAW_TEMPLATE_SECTIONS) {
      expect(sections[def.id]).toBeDefined();
    }
  });

  it("all sections start empty and visible", () => {
    const sections = buildDefaultSections();
    for (const section of Object.values(sections)) {
      expect(section.content).toBe("");
      expect(section.hidden).toBe(false);
    }
  });

  it("table sections have table_data with columns and one empty row", () => {
    const sections = buildDefaultSections();
    const tableDefs = SOAW_TEMPLATE_SECTIONS.filter(
      (s) => s.type === "table",
    );
    for (const def of tableDefs) {
      const section = sections[def.id];
      expect(section.table_data).toBeDefined();
      expect(section.table_data!.columns).toEqual(def.columns);
      expect(section.table_data!.rows).toHaveLength(1);
      // First row should be array of empty strings matching column count
      expect(section.table_data!.rows[0]).toHaveLength(def.columns!.length);
      expect(section.table_data!.rows[0].every((v) => v === "")).toBe(true);
    }
  });

  it("togaf_phases section has togaf_data with all phase keys", () => {
    const sections = buildDefaultSections();
    const togafSection = sections["3.1"];
    expect(togafSection.togaf_data).toBeDefined();
    for (const phase of TOGAF_PHASES) {
      expect(togafSection.togaf_data![phase.key]).toBe("");
    }
  });

  it("rich_text sections have no table_data or togaf_data", () => {
    const sections = buildDefaultSections();
    const richTextDefs = SOAW_TEMPLATE_SECTIONS.filter(
      (s) => s.type === "rich_text",
    );
    for (const def of richTextDefs) {
      const section = sections[def.id];
      expect(section.table_data).toBeUndefined();
      expect(section.togaf_data).toBeUndefined();
    }
  });
});
