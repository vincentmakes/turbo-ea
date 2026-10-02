import { describe, it, expect } from "vitest";

import {
  cleanTranslationMap,
  cleanTranslations,
  coerceRelationVerb,
  deriveRelationKey,
  emptyField,
  truncate,
  type RelationKeyPeer,
} from "./helpers";

/**
 * `deriveRelationKey` / `coerceRelationVerb` have their main contract pinned in
 * `relationAutoKey.test.ts`; this file covers the remaining helpers and the
 * key-derivation edges that file leaves open.
 */

describe("emptyField", () => {
  it("is a text field that counts toward data quality by default", () => {
    expect(emptyField()).toEqual({ key: "", label: "", type: "text", required: false, weight: 1 });
  });

  it("returns a fresh object on every call, so editing one draft cannot leak into another", () => {
    const a = emptyField();
    const b = emptyField();
    expect(a).not.toBe(b);
    a.key = "changed";
    expect(b.key).toBe("");
  });
});

describe("truncate", () => {
  it("leaves text at or under the limit untouched", () => {
    expect(truncate("", 5)).toBe("");
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcde", 5)).toBe("abcde");
  });

  it("cuts to max - 1 characters plus an ellipsis, so the result is exactly max long", () => {
    expect(truncate("abcdef", 5)).toBe("abcd…");
    expect(truncate("abcdef", 5)).toHaveLength(5);
    expect(truncate("a very long label indeed", 10)).toBe("a very lo…");
  });

  it("degrades to a bare ellipsis at max 1", () => {
    expect(truncate("ab", 1)).toBe("…");
  });
});

describe("cleanTranslationMap", () => {
  it("returns undefined for a missing map", () => {
    expect(cleanTranslationMap(undefined)).toBeUndefined();
  });

  it("returns undefined when every entry is empty or whitespace", () => {
    expect(cleanTranslationMap({})).toBeUndefined();
    expect(cleanTranslationMap({ de: "", fr: "   ", es: "\t\n" })).toBeUndefined();
  });

  it("drops empty entries and trims the ones it keeps", () => {
    expect(cleanTranslationMap({ de: "  Anwendung ", fr: "", es: "Aplicación" })).toEqual({
      de: "Anwendung",
      es: "Aplicación",
    });
  });

  it("does not mutate its input", () => {
    const input = { de: " Anwendung ", fr: "" };
    cleanTranslationMap(input);
    expect(input).toEqual({ de: " Anwendung ", fr: "" });
  });
});

describe("cleanTranslations", () => {
  it("returns undefined for a missing object", () => {
    expect(cleanTranslations(undefined)).toBeUndefined();
  });

  it("returns undefined when every nested map cleans to nothing", () => {
    expect(cleanTranslations({})).toBeUndefined();
    expect(cleanTranslations({ label: { de: "" }, reverse_label: {} })).toBeUndefined();
  });

  it("keeps only the maps with at least one real entry, each cleaned", () => {
    expect(
      cleanTranslations({
        label: { de: " nutzt ", fr: "" },
        reverse_label: { de: "   " },
        description: { fr: "utilise" },
      }),
    ).toEqual({ label: { de: "nutzt" }, description: { fr: "utilise" } });
  });

  it("does not mutate its input", () => {
    const input = { label: { de: " nutzt " }, reverse_label: { de: "" } };
    cleanTranslations(input);
    expect(input).toEqual({ label: { de: " nutzt " }, reverse_label: { de: "" } });
  });
});

describe("coerceRelationVerb", () => {
  it("keeps digits and upper-cases the first letter of each word", () => {
    expect(coerceRelationVerb("uses v2")).toBe("UsesV2");
    expect(coerceRelationVerb("3rd party")).toBe("3rdParty");
  });

  it("strips every non-alphanumeric character, including inner punctuation", () => {
    expect(coerceRelationVerb("is-used by (legacy)")).toBe("IsUsedByLegacy");
    expect(coerceRelationVerb("owns/operates")).toBe("OwnsOperates");
  });

  it("reads an underscore as part of a word, so the letter after it stays lower-case", () => {
    // `\w` matches `_`, so "used_by" has no boundary before "by"; the
    // underscore is then stripped, leaving "Usedby" rather than "UsedBy".
    expect(coerceRelationVerb("is used_by")).toBe("IsUsedby");
  });

  it("folds accented words without inventing a word boundary at the accent", () => {
    expect(coerceRelationVerb("héberge")).toBe("Heberge");
    expect(coerceRelationVerb("dépend de")).toBe("DependDe");
    expect(coerceRelationVerb("übernimmt")).toBe("Ubernimmt");
  });

  it("returns an empty fragment for an empty verb", () => {
    expect(coerceRelationVerb("")).toBe("");
  });
});

describe("deriveRelationKey edge cases", () => {
  function peer(over: Partial<RelationKeyPeer> & { key: string }): RelationKeyPeer {
    return { source_type_key: "Organization", target_type_key: "Application", ...over };
  }

  it("handles a self-referencing pair like any other", () => {
    expect(deriveRelationKey("Application", "Application", "", [])).toBe(
      "ApplicationToApplication",
    );
    expect(
      deriveRelationKey("Application", "Application", "succeeds", [
        peer({ key: "relAppToApp", source_type_key: "Application", target_type_key: "Application" }),
      ]),
    ).toBe("relAppToAppSucceeds");
  });

  it("keeps counting past a taken numeric suffix", () => {
    expect(
      deriveRelationKey("Organization", "Application", "", [
        peer({ key: "relOrgToApp" }),
        peer({ key: "relOrgToApp2" }),
        peer({ key: "relOrgToApp3" }),
      ]),
    ).toBe("relOrgToApp4");
  });

  it("falls through to the numeric suffix when the verb has nothing usable", () => {
    expect(
      deriveRelationKey("Organization", "Application", " — ", [peer({ key: "relOrgToApp" })]),
    ).toBe("relOrgToApp2");
  });

  it("treats a pair whose only relation is hidden as free, but still avoids its key", () => {
    // Hidden rows do not anchor the family, yet their key is still taken.
    expect(
      deriveRelationKey("Organization", "Application", "owns", [
        peer({ key: "OrganizationToApplication", is_hidden: true }),
      ]),
    ).toBe("OrganizationToApplicationOwns");
  });

  it("breaks a sort_order tie on the key, and reads a missing sort_order as 0", () => {
    expect(
      deriveRelationKey("Organization", "Application", "hosts", [
        peer({ key: "relOrgToAppB" }),
        peer({ key: "relOrgToAppA" }),
      ]),
    ).toBe("relOrgToAppAHosts");
    expect(
      deriveRelationKey("Organization", "Application", "hosts", [
        peer({ key: "relOrgToAppB", sort_order: 0 }),
        peer({ key: "relOrgToAppA" }),
      ]),
    ).toBe("relOrgToAppAHosts");
  });

  it("prefers a lower sort_order over an alphabetically earlier key", () => {
    expect(
      deriveRelationKey("Organization", "Application", "hosts", [
        peer({ key: "relOrgToAppA", sort_order: 5 }),
        peer({ key: "relOrgToAppZ", sort_order: 1 }),
      ]),
    ).toBe("relOrgToAppZHosts");
  });

  it("takes the verb-derived key when the plain form is taken on a free pair", () => {
    // The pair is free (the taken key belongs to another pair), so the anchor
    // is the plain form; it being taken sends the derivation to the verb.
    expect(
      deriveRelationKey("Organization", "Application", "owns", [
        peer({
          key: "OrganizationToApplication",
          source_type_key: "Widget",
          target_type_key: "Gadget",
        }),
      ]),
    ).toBe("OrganizationToApplicationOwns");
  });

  it("does not mutate the relation list it is given", () => {
    const list = [peer({ key: "relOrgToAppB", sort_order: 2 }), peer({ key: "relOrgToAppA" })];
    deriveRelationKey("Organization", "Application", "owns", list);
    expect(list.map((r) => r.key)).toEqual(["relOrgToAppB", "relOrgToAppA"]);
  });

  it("returns a backend-valid key whatever the inputs", () => {
    const cases = [
      deriveRelationKey("Organization", "Application", "", []),
      deriveRelationKey("Organization", "Application", "3rd party", [peer({ key: "relOrgToApp" })]),
      deriveRelationKey("Organization", "Application", "  — ", [peer({ key: "relOrgToApp" })]),
      deriveRelationKey("Organization", "Application", "héberge!", [peer({ key: "relOrgToApp" })]),
    ];
    for (const key of cases) expect(key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
  });
});
