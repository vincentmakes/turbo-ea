import { describe, it, expect } from "vitest";
import {
  ARCHIMATE_ELEMENT_DEFS,
  ARCHIMATE_RELATION_DEFS,
  ARCHIMATE_LAYER_META,
  type ArchimateElementDef,
  type ArchimateRelationDef,
} from "./archimate-metamodel.js";

describe("ArchiMate Metamodel — Element Definitions", () => {
  it("defines exactly 61 element types", () => {
    expect(ARCHIMATE_ELEMENT_DEFS).toHaveLength(61);
  });

  it("all element keys are prefixed with 'arch_'", () => {
    const nonPrefixed = ARCHIMATE_ELEMENT_DEFS.filter((e) => !e.key.startsWith("arch_"));
    expect(nonPrefixed).toHaveLength(0);
  });

  it("all elements have a layer assignment", () => {
    const validLayers = [
      "Business", "Application", "Technology",
      "Motivation", "Strategy", "Implementation",
      "Physical", "Composite",
    ];
    const invalid = ARCHIMATE_ELEMENT_DEFS.filter((e) => !validLayers.includes(e.layer));
    expect(invalid).toHaveLength(0);
  });

  it("all elements have a defaultColor", () => {
    const missing = ARCHIMATE_ELEMENT_DEFS.filter((e) => !e.defaultColor?.startsWith("#"));
    expect(missing).toHaveLength(0);
  });

  it("all elements have a grammarType matching an ArchiMate element name", () => {
    const missing = ARCHIMATE_ELEMENT_DEFS.filter((e) => !e.grammarType);
    expect(missing).toHaveLength(0);
  });

  it("all elements have translations for all 8 locales", () => {
    const locales = ["de", "fr", "es", "it", "pt", "zh", "ru"];
    const missing = ARCHIMATE_ELEMENT_DEFS.filter(
      (e) => !locales.every((l) => e.translations?.label?.[l]),
    );
    expect(missing).toHaveLength(0);
  });

  it("Business Layer has 13 element types", () => {
    const business = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Business");
    expect(business).toHaveLength(13);
  });

  it("Application Layer has 9 element types", () => {
    const app = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Application");
    expect(app).toHaveLength(9);
  });

  it("Technology Layer has 13 element types", () => {
    const tech = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Technology");
    expect(tech).toHaveLength(13);
  });

  it("Motivation layer has 10 element types", () => {
    const mot = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Motivation");
    expect(mot).toHaveLength(10);
  });

  it("Strategy layer has 4 element types", () => {
    const str = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Strategy");
    expect(str).toHaveLength(4);
  });

  it("Implementation layer has 5 element types", () => {
    const impl = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Implementation");
    expect(impl).toHaveLength(5);
  });

  it("Physical layer has 4 element types", () => {
    const phys = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Physical");
    expect(phys).toHaveLength(4);
  });

  it("Composite layer has 3 element types", () => {
    const comp = ARCHIMATE_ELEMENT_DEFS.filter((e) => e.layer === "Composite");
    expect(comp).toHaveLength(3);
  });

  it("no two elements share the same key", () => {
    const keys = ARCHIMATE_ELEMENT_DEFS.map((e) => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(ARCHIMATE_ELEMENT_DEFS.length);
  });

  it("categories are prefixed with 'ArchiMate:'", () => {
    const invalid = ARCHIMATE_ELEMENT_DEFS.filter((e) => !e.category.startsWith("ArchiMate:"));
    expect(invalid).toHaveLength(0);
  });
});

describe("ArchiMate Metamodel — Relation Definitions", () => {
  it("defines exactly 11 relation types", () => {
    expect(ARCHIMATE_RELATION_DEFS).toHaveLength(11);
  });

  it("all relation keys are prefixed with 'arch_rel_'", () => {
    const invalid = ARCHIMATE_RELATION_DEFS.filter((r) => !r.key.startsWith("arch_rel_"));
    expect(invalid).toHaveLength(0);
  });

  it("all relations have a label and reverse_label", () => {
    const missing = ARCHIMATE_RELATION_DEFS.filter((r) => !r.label || !r.reverseLabel);
    expect(missing).toHaveLength(0);
  });

  it("all relations have translations for all 8 locales", () => {
    const locales = ["de", "fr", "es", "it", "pt", "zh", "ru"];
    const missing = ARCHIMATE_RELATION_DEFS.filter(
      (r) => !locales.every((l) => r.translations?.label?.[l]),
    );
    expect(missing).toHaveLength(0);
  });

  it("no two relations share the same key", () => {
    const keys = ARCHIMATE_RELATION_DEFS.map((r) => r.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(ARCHIMATE_RELATION_DEFS.length);
  });

  it("includes Composition, Assignment, and Serving relations", () => {
    const keys = ARCHIMATE_RELATION_DEFS.map((r) => r.key);
    expect(keys).toContain("arch_rel_Composition");
    expect(keys).toContain("arch_rel_Assignment");
    expect(keys).toContain("arch_rel_Serving");
  });
});

describe("ArchiMate Metamodel — Layer Metadata", () => {
  it("defines metadata for all 8 layers", () => {
    const layers = Object.keys(ARCHIMATE_LAYER_META);
    expect(layers).toHaveLength(8);
  });

  it("each layer has a color", () => {
    const missing = Object.values(ARCHIMATE_LAYER_META).filter(
      (m) => !m.color?.startsWith("#"),
    );
    expect(missing).toHaveLength(0);
  });

  it("each layer has a label", () => {
    const missing = Object.values(ARCHIMATE_LAYER_META).filter((m) => !m.label);
    expect(missing).toHaveLength(0);
  });
});
