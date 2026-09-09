import { describe, it, expect } from "vitest";
import { findSuccessorRelationType, successorRelationKeys } from "./successorRelation";
import type { RelationType } from "@/types";

function rt(over: Partial<RelationType> & { key: string }): RelationType {
  return {
    key: over.key,
    label: over.label ?? "succeeds",
    source_type_key: over.source_type_key ?? "Application",
    target_type_key: over.target_type_key ?? "Application",
    is_hidden: over.is_hidden ?? false,
    sort_order: over.sort_order ?? 0,
    ...over,
  } as RelationType;
}

describe("findSuccessorRelationType", () => {
  it("finds a seeded built-in whose key is abbreviated", () => {
    // Application's built-in is `relAppSuccessor`, not `relApplicationSuccessor`,
    // so an exact-key rule would miss every seeded successor.
    const types = [rt({ key: "relAppSuccessor" })];
    expect(findSuccessorRelationType(types, "Application")?.key).toBe("relAppSuccessor");
  });

  it("prefers the auto-provisioned key when several exist", () => {
    const types = [
      rt({ key: "relLegacySuccessor", sort_order: 1 }),
      rt({ key: "relApplicationSuccessor", sort_order: 9 }),
    ];
    expect(findSuccessorRelationType(types, "Application")?.key).toBe(
      "relApplicationSuccessor",
    );
  });

  it("prefers the seeded built-in over a custom key that sorts earlier", () => {
    const types = [
      rt({ key: "relAppLegacySuccessor" }),
      rt({ key: "relAppSuccessor", built_in: true }),
    ];
    expect(findSuccessorRelationType(types, "Application")?.key).toBe("relAppSuccessor");
  });

  it("falls back to a stable (sort_order, key) choice, not array order", () => {
    const types = [
      rt({ key: "relZebraSuccessor", sort_order: 5 }),
      rt({ key: "relAlphaSuccessor", sort_order: 2 }),
    ];
    expect(findSuccessorRelationType(types, "Application")?.key).toBe("relAlphaSuccessor");
  });

  it("ignores hidden types and non-self pairs", () => {
    const types = [
      rt({ key: "relAppSuccessor", is_hidden: true }),
      rt({ key: "relOtherSuccessor", target_type_key: "ITComponent" }),
    ];
    expect(findSuccessorRelationType(types, "Application")).toBeUndefined();
  });

  it("returns undefined for a card type with no lineage relation", () => {
    expect(findSuccessorRelationType([rt({ key: "relAppToItc" })], "Application")).toBeUndefined();
  });
});

describe("successorRelationKeys", () => {
  it("hides exactly ONE key per card type, not every *Successor key", () => {
    // The bug this guards: a second self-pair type ending in "Successor" was
    // excluded from the Relations section AND the metamodel Relations tab, so it
    // had no UI anywhere — invisible, uneditable, undeletable.
    // `relAppSuccessor` is the seeded built-in — it must win over an admin's
    // custom `relAppLegacySuccessor`, which sorts before it alphabetically.
    const types = [
      rt({ key: "relAppSuccessor", built_in: true }),
      rt({ key: "relAppLegacySuccessor" }),
      rt({ key: "relAppDependsOn" }),
    ];
    const keys = successorRelationKeys(types);
    expect(keys.has("relAppSuccessor")).toBe(true);
    expect(keys.has("relAppLegacySuccessor")).toBe(false);
    expect(keys.has("relAppDependsOn")).toBe(false);
  });

  it("covers each self-referential card type independently", () => {
    const types = [
      rt({ key: "relAppSuccessor" }),
      rt({
        key: "relProcessSuccessor",
        source_type_key: "BusinessProcess",
        target_type_key: "BusinessProcess",
      }),
    ];
    expect(successorRelationKeys(types)).toEqual(
      new Set(["relAppSuccessor", "relProcessSuccessor"]),
    );
  });

  it("is empty when nothing is a lineage relation", () => {
    expect(successorRelationKeys([rt({ key: "relAppDependsOn" })]).size).toBe(0);
  });
});
