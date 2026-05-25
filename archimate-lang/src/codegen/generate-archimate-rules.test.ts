import { describe, it, expect } from "vitest";
import {
  ARCHIMATE_RELATION_RULES,
  ARCHIMATE_ASPECT_COMPATIBILITY,
  type RelationRule,
} from "./archimate-relation-rules.js";
import { ARCHIMATE_ELEMENT_DEFS, ARCHIMATE_RELATION_DEFS } from "./archimate-metamodel.js";

describe("ArchiMate Relation Rules", () => {
  it("defines rules for all 11 relation types", () => {
    const ruleKeys = Object.keys(ARCHIMATE_RELATION_RULES);
    expect(ruleKeys).toHaveLength(11);
  });

  it("all rule keys match relation def keys", () => {
    const defKeys = new Set(ARCHIMATE_RELATION_DEFS.map((r) => r.key));
    const ruleKeys = Object.keys(ARCHIMATE_RELATION_RULES);
    for (const key of ruleKeys) {
      expect(defKeys.has(key)).toBe(true);
    }
  });

  it("Association relation allows all element pairs", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Association"];
    expect(rule.allowAll).toBe(true);
  });

  it("Specialization relation allows all element pairs", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Specialization"];
    expect(rule.allowAll).toBe(true);
  });

  it("Composition rule allows a BusinessProcess to compose BusinessFunction", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Composition"];
    expect(rule.allowAll).toBe(false);
    const isAllowed = isRelationAllowed(rule, "arch_BusinessProcess", "arch_BusinessFunction");
    expect(isAllowed).toBe(true);
  });

  it("Composition rule allows ApplicationComponent to compose ApplicationComponent", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Composition"];
    const isAllowed = isRelationAllowed(rule, "arch_ApplicationComponent", "arch_ApplicationComponent");
    expect(isAllowed).toBe(true);
  });

  it("Assignment rule allows BusinessRole to assign to BusinessProcess", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Assignment"];
    const isAllowed = isRelationAllowed(rule, "arch_BusinessRole", "arch_BusinessProcess");
    expect(isAllowed).toBe(true);
  });

  it("Serving rule allows ApplicationComponent to serve BusinessProcess", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Serving"];
    const isAllowed = isRelationAllowed(rule, "arch_ApplicationComponent", "arch_BusinessProcess");
    expect(isAllowed).toBe(true);
  });

  it("Realization rule allows ApplicationComponent to realize ApplicationService", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Realization"];
    const isAllowed = isRelationAllowed(rule, "arch_ApplicationComponent", "arch_ApplicationService");
    expect(isAllowed).toBe(true);
  });

  it("Access rule allows ApplicationComponent to access DataObject", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Access"];
    const isAllowed = isRelationAllowed(rule, "arch_ApplicationComponent", "arch_DataObject");
    expect(isAllowed).toBe(true);
  });

  it("Influence rule allows Stakeholder to influence Goal", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Influence"];
    const isAllowed = isRelationAllowed(rule, "arch_Stakeholder", "arch_Goal");
    expect(isAllowed).toBe(true);
  });

  it("Triggering rule allows BusinessEvent to trigger BusinessProcess", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Triggering"];
    const isAllowed = isRelationAllowed(rule, "arch_BusinessEvent", "arch_BusinessProcess");
    expect(isAllowed).toBe(true);
  });

  it("Flow rule allows BusinessProcess to flow to BusinessProcess", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Flow"];
    const isAllowed = isRelationAllowed(rule, "arch_BusinessProcess", "arch_BusinessProcess");
    expect(isAllowed).toBe(true);
  });

  it("every element key used in rules exists in ARCHIMATE_ELEMENT_DEFS", () => {
    const defKeys = new Set(ARCHIMATE_ELEMENT_DEFS.map((e) => e.key));
    for (const [, rule] of Object.entries(ARCHIMATE_RELATION_RULES)) {
      if (rule.allowAll) continue;
      for (const pair of rule.allowedPairs) {
        if (pair.sourceKey !== "*") expect(defKeys.has(pair.sourceKey), `Missing source: ${pair.sourceKey}`).toBe(true);
        if (pair.targetKey !== "*") expect(defKeys.has(pair.targetKey), `Missing target: ${pair.targetKey}`).toBe(true);
      }
    }
  });

  it("Aggregation rule allows Node to aggregate SystemSoftware", () => {
    const rule = ARCHIMATE_RELATION_RULES["arch_rel_Aggregation"];
    const isAllowed = isRelationAllowed(rule, "arch_Node", "arch_SystemSoftware");
    expect(isAllowed).toBe(true);
  });
});

describe("ArchiMate Aspect Compatibility", () => {
  it("defines compatibility entries for Active Structure aspect", () => {
    expect(ARCHIMATE_ASPECT_COMPATIBILITY["ActiveStructure"]).toBeDefined();
  });

  it("defines compatibility entries for Behavior aspect", () => {
    expect(ARCHIMATE_ASPECT_COMPATIBILITY["Behavior"]).toBeDefined();
  });

  it("defines compatibility entries for PassiveStructure aspect", () => {
    expect(ARCHIMATE_ASPECT_COMPATIBILITY["PassiveStructure"]).toBeDefined();
  });

  it("Assignment links Active Structure to Behavior", () => {
    const compat = ARCHIMATE_ASPECT_COMPATIBILITY["ActiveStructure"];
    expect(compat.canAssignTo).toContain("Behavior");
  });

  it("Serving links Behavior to Behavior", () => {
    const compat = ARCHIMATE_ASPECT_COMPATIBILITY["Behavior"];
    expect(compat.canServe).toContain("Behavior");
  });
});

// Helper: check if a relation rule allows a specific source→target pair
function isRelationAllowed(rule: RelationRule, sourceKey: string, targetKey: string): boolean {
  if (rule.allowAll) return true;
  return rule.allowedPairs.some(
    (p) =>
      (p.sourceKey === "*" || p.sourceKey === sourceKey) &&
      (p.targetKey === "*" || p.targetKey === targetKey),
  );
}
