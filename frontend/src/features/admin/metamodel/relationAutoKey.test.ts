import { describe, it, expect } from "vitest";
import { deriveRelationKey, coerceRelationVerb, type RelationKeyPeer } from "./helpers";

/**
 * Exercises the REAL implementation the create-relation dialog uses. An earlier
 * version of this file re-implemented the rule, which meant it would have kept
 * passing even if the component stopped calling it.
 */
function peer(over: Partial<RelationKeyPeer> & { key: string }): RelationKeyPeer {
  return {
    source_type_key: "Organization",
    target_type_key: "Application",
    sort_order: 0,
    ...over,
  };
}

describe("deriveRelationKey", () => {
  it("uses the plain pair form for the first relation between two types", () => {
    expect(deriveRelationKey("Organization", "Application", "uses", [])).toBe(
      "OrganizationToApplication",
    );
  });

  it("returns nothing until both endpoints are chosen", () => {
    expect(deriveRelationKey("", "Application", "uses", [])).toBe("");
    expect(deriveRelationKey("Organization", "", "uses", [])).toBe("");
  });

  it("inherits the EXISTING relation's key and appends the verb", () => {
    // The pair's keys should read as one family. Deriving a fresh
    // `OrganizationOwnsApplication` would sit oddly beside the seeded short form.
    expect(
      deriveRelationKey("Organization", "Application", "owns", [peer({ key: "relOrgToApp" })]),
    ).toBe("relOrgToAppOwns");
  });

  it("title-cases and strips a multi-word verb", () => {
    expect(
      deriveRelationKey("Application", "Interface", "is consumed by", [
        peer({
          key: "relAppToInterface",
          source_type_key: "Application",
          target_type_key: "Interface",
        }),
      ]),
    ).toBe("relAppToInterfaceIsConsumedBy");
  });

  it("falls back to a numeric suffix on the existing key when no verb is typed yet", () => {
    expect(
      deriveRelationKey("Organization", "Application", "", [peer({ key: "relOrgToApp" })]),
    ).toBe("relOrgToApp2");
  });

  it("falls back when the verb-derived key is itself taken", () => {
    expect(
      deriveRelationKey("Organization", "Application", "owns", [
        peer({ key: "relOrgToApp" }),
        peer({ key: "relOrgToAppOwns" }),
      ]),
    ).toBe("relOrgToApp2");
  });

  it("anchors a third relation on the same existing key as the second", () => {
    // Not on whichever row the API happened to return first.
    expect(
      deriveRelationKey("Organization", "Application", "hosts", [
        peer({ key: "relOrgToAppOwns", sort_order: 9 }),
        peer({ key: "relOrgToApp", sort_order: 1 }),
      ]),
    ).toBe("relOrgToAppHosts");
  });

  it("ignores hidden relation types when choosing the anchor", () => {
    expect(
      deriveRelationKey("Organization", "Application", "owns", [
        peer({ key: "relOrgToAppOld", sort_order: 0, is_hidden: true }),
        peer({ key: "relOrgToApp", sort_order: 1 }),
      ]),
    ).toBe("relOrgToAppOwns");
  });

  it("treats the reverse pair as its own relation, not a second one", () => {
    expect(
      deriveRelationKey("Application", "Organization", "", [peer({ key: "relOrgToApp" })]),
    ).toBe("ApplicationToOrganization");
  });

  it("avoids a key taken by an unrelated relation type", () => {
    expect(
      deriveRelationKey("Organization", "Application", "", [
        peer({
          key: "OrganizationToApplication",
          source_type_key: "Widget",
          target_type_key: "Gadget",
        }),
      ]),
    ).toBe("OrganizationToApplication2");
  });

  it("always yields a key the backend will accept", () => {
    const key = deriveRelationKey("Organization", "Application", "is used by!", [
      peer({ key: "relOrgToApp" }),
    ]);
    expect(key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
  });
});

describe("coerceRelationVerb", () => {
  it("title-cases and strips punctuation", () => {
    expect(coerceRelationVerb("is used by")).toBe("IsUsedBy");
  });

  it("strips diacritics so the key stays ASCII", () => {
    expect(coerceRelationVerb("héberge")).toBe("Heberge");
  });

  it("returns empty for a verb with nothing usable", () => {
    expect(coerceRelationVerb("  —  ")).toBe("");
  });
});
