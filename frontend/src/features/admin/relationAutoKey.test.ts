import { describe, it, expect } from "vitest";
import { coerceKey } from "@/components/KeyInput";

/**
 * The auto-key rule for a new relation type, mirrored from MetamodelAdmin so the
 * derivation is pinned without mounting the whole admin page.
 *
 * Several relation types may share an ordered card-type pair, so the plain
 * `<Source>To<Target>` form collides on the second one. The key is the Excel
 * column, the calculation variable and the survey field key, so it has to stay
 * meaningful — derive it from the verb, and only fall back to a numeric suffix
 * when there is no usable verb yet.
 */
function autoRelKey(src: string, tgt: string, label: string, existing: string[]): string {
  if (!src || !tgt) return "";
  const taken = new Set(existing);
  const base = `${src}To${tgt}`;
  if (!taken.has(base)) return base;

  const verb = coerceKey(label.replace(/\b\w/g, (ch) => ch.toUpperCase()));
  if (verb) {
    const verbKey = `${src}${verb}${tgt}`;
    if (!taken.has(verbKey)) return verbKey;
  }

  let n = 2;
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

describe("relation type auto-key", () => {
  it("uses the plain pair form for the first relation between two types", () => {
    expect(autoRelKey("Organization", "Application", "uses", [])).toBe(
      "OrganizationToApplication",
    );
  });

  it("derives from the verb once the pair is taken", () => {
    expect(
      autoRelKey("Organization", "Application", "owns", ["OrganizationToApplication"]),
    ).toBe("OrganizationOwnsApplication");
  });

  it("title-cases and strips a multi-word verb", () => {
    expect(
      autoRelKey("Application", "Interface", "is consumed by", ["ApplicationToInterface"]),
    ).toBe("ApplicationIsConsumedByInterface");
  });

  it("falls back to a numeric suffix when no verb has been typed yet", () => {
    // The key field fills in as soon as both types are picked, which is before
    // the admin reaches the verb field.
    expect(autoRelKey("Organization", "Application", "", ["OrganizationToApplication"])).toBe(
      "OrganizationToApplication2",
    );
  });

  it("falls back when the verb itself would collide", () => {
    expect(
      autoRelKey("Organization", "Application", "owns", [
        "OrganizationToApplication",
        "OrganizationOwnsApplication",
      ]),
    ).toBe("OrganizationToApplication2");
  });

  it("keeps counting past an existing numeric suffix", () => {
    expect(
      autoRelKey("Organization", "Application", "", [
        "OrganizationToApplication",
        "OrganizationToApplication2",
      ]),
    ).toBe("OrganizationToApplication3");
  });

  it("does not collide across the reverse pair, which is its own relation", () => {
    expect(autoRelKey("Application", "Organization", "", ["OrganizationToApplication"])).toBe(
      "ApplicationToOrganization",
    );
  });

  it("always yields a key the backend will accept", () => {
    const key = autoRelKey("Organization", "Application", "is used by!", [
      "OrganizationToApplication",
    ]);
    expect(key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
  });
});
