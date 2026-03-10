import { describe, it, expect } from "vitest";
import i18n, { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import { resolveLabel, resolveMetaLabel } from "@/hooks/useResolveLabel";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACES = [
  "common",
  "auth",
  "nav",
  "inventory",
  "cards",
  "reports",
  "admin",
  "bpm",
  "diagrams",
  "delivery",
  "notifications",
  "validation",
] as const;

const LOCALES = ["en", "de", "fr", "es", "it", "pt", "zh", "ru"] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Retrieve the resource bundle for a given locale + namespace from the i18n store. */
function getResource(locale: string, ns: string): Record<string, string> {
  return (i18n.store.data[locale]?.[ns] as Record<string, string>) ?? {};
}

/** Extract all keys from a flat JSON resource object. */
function getKeys(resource: Record<string, string>): string[] {
  return Object.keys(resource).sort();
}

/** Extract all {{placeholder}} names from a translation value. */
function extractPlaceholders(value: string): string[] {
  const matches = value.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/[{}]/g, "")).sort();
}

/**
 * Given a set of keys, find plural pairs: keys ending in _one should have
 * a corresponding _other key (and vice versa).
 *
 * i18next also supports a "base key + _other" pattern where the base key
 * (without _one suffix) serves as the singular form. For example:
 *   "metamodel.fields": "{{count}} field"       ← singular (base key)
 *   "metamodel.fields_other": "{{count}} fields" ← plural
 * Both patterns are valid, so we check for either _one or the base key.
 */
function findPluralKeys(keys: string[]): { oneKeys: string[]; otherKeys: string[] } {
  const oneKeys = keys.filter((k) => k.endsWith("_one"));
  const otherKeys = keys.filter((k) => k.endsWith("_other"));
  return { oneKeys, otherKeys };
}

// ---------------------------------------------------------------------------
// 1. All locale JSON files are valid and loaded
// ---------------------------------------------------------------------------

describe("Locale files are valid and loaded", () => {
  for (const locale of LOCALES) {
    for (const ns of NAMESPACES) {
      it(`${locale}/${ns}.json is loaded and has at least one key`, () => {
        const resource = getResource(locale, ns);
        expect(resource).toBeDefined();
        const keys = getKeys(resource);
        expect(keys.length).toBeGreaterThan(0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. All non-English locales have the same keys as English
// ---------------------------------------------------------------------------

describe("Non-English locales have all English keys", () => {
  for (const ns of NAMESPACES) {
    const enResource = getResource("en", ns);
    const enKeys = getKeys(enResource);

    for (const locale of LOCALES) {
      if (locale === "en") continue;

      it(`${locale}/${ns} has all ${enKeys.length} English keys`, () => {
        const localeResource = getResource(locale, ns);
        const localeKeys = new Set(getKeys(localeResource));
        const missing = enKeys.filter((k) => !localeKeys.has(k));

        if (missing.length > 0) {
          expect.fail(
            `${locale}/${ns} is missing ${missing.length} key(s):\n  ${missing.join("\n  ")}`,
          );
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. No empty string values in any locale
// ---------------------------------------------------------------------------

describe("No empty string values", () => {
  for (const locale of LOCALES) {
    for (const ns of NAMESPACES) {
      it(`${locale}/${ns} has no empty string values`, () => {
        const resource = getResource(locale, ns);
        const emptyKeys = Object.entries(resource)
          .filter(([, value]) => value === "")
          .map(([key]) => key);

        if (emptyKeys.length > 0) {
          expect.fail(
            `${locale}/${ns} has ${emptyKeys.length} empty value(s):\n  ${emptyKeys.join("\n  ")}`,
          );
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Interpolation placeholders are preserved
// ---------------------------------------------------------------------------

describe("Interpolation placeholders are preserved", () => {
  for (const ns of NAMESPACES) {
    const enResource = getResource("en", ns);

    // Collect English keys that have placeholders
    const keysWithPlaceholders = Object.entries(enResource).filter(
      ([, value]) => /\{\{\w+\}\}/.test(value),
    );

    if (keysWithPlaceholders.length === 0) continue;

    for (const locale of LOCALES) {
      if (locale === "en") continue;

      it(`${locale}/${ns} preserves placeholders for ${keysWithPlaceholders.length} key(s)`, () => {
        const localeResource = getResource(locale, ns);
        const mismatches: string[] = [];

        for (const [key, enValue] of keysWithPlaceholders) {
          const localeValue = localeResource[key];
          if (!localeValue) continue; // missing key is caught by test #2

          const enPlaceholders = extractPlaceholders(enValue);
          const localePlaceholders = extractPlaceholders(localeValue);

          if (JSON.stringify(enPlaceholders) !== JSON.stringify(localePlaceholders)) {
            mismatches.push(
              `  "${key}": en has {{${enPlaceholders.join(", ")}}}, ` +
                `${locale} has {{${localePlaceholders.join(", ")}}}`,
            );
          }
        }

        if (mismatches.length > 0) {
          expect.fail(
            `${locale}/${ns} has ${mismatches.length} placeholder mismatch(es):\n${mismatches.join("\n")}`,
          );
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Plural suffixes are consistent (_one <-> _other)
// ---------------------------------------------------------------------------

describe("Plural suffixes are consistent", () => {
  for (const locale of LOCALES) {
    for (const ns of NAMESPACES) {
      it(`${locale}/${ns} has matching _one/_other pairs`, () => {
        const resource = getResource(locale, ns);
        const keys = getKeys(resource);
        const keySet = new Set(keys);
        const { oneKeys, otherKeys } = findPluralKeys(keys);
        const errors: string[] = [];

        // Every _one key must have a corresponding _other key
        for (const oneKey of oneKeys) {
          const base = oneKey.replace(/_one$/, "");
          const expectedOther = `${base}_other`;
          if (!keySet.has(expectedOther)) {
            errors.push(`"${oneKey}" exists but "${expectedOther}" is missing`);
          }
        }

        // Every _other key must have either a _one key or a base key (both are
        // valid i18next singular forms).
        for (const otherKey of otherKeys) {
          const base = otherKey.replace(/_other$/, "");
          const hasOneKey = keySet.has(`${base}_one`);
          const hasBaseKey = keySet.has(base);
          if (!hasOneKey && !hasBaseKey) {
            errors.push(
              `"${otherKey}" exists but neither "${base}_one" nor "${base}" is present`,
            );
          }
        }

        if (errors.length > 0) {
          expect.fail(
            `${locale}/${ns} has ${errors.length} unpaired plural key(s):\n  ${errors.join("\n  ")}`,
          );
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 6. resolveLabel and resolveMetaLabel pure functions
// ---------------------------------------------------------------------------

describe("resolveLabel", () => {
  it("returns the default label when translations is undefined", () => {
    expect(resolveLabel("App", undefined, "fr")).toBe("App");
  });

  it("returns the translated label when the locale exists in translations", () => {
    expect(resolveLabel("App", { fr: "Application" }, "fr")).toBe("Application");
  });

  it("returns the default label when the requested locale is not in translations", () => {
    expect(resolveLabel("App", { de: "Anwendung" }, "en")).toBe("App");
  });

  it("returns the default label when locale is undefined", () => {
    expect(resolveLabel("App", { fr: "Application" }, undefined)).toBe("App");
  });

  it("returns the en translation when locale is 'en' and en translation exists", () => {
    expect(resolveLabel("App", { en: "Application" }, "en")).toBe("Application");
  });

  it("returns the fallback when locale is 'en' and no en translation exists", () => {
    expect(resolveLabel("App", { fr: "Application" }, "en")).toBe("App");
  });

  it("returns the default label when translations is an empty object", () => {
    expect(resolveLabel("App", {}, "fr")).toBe("App");
  });
});

describe("resolveMetaLabel", () => {
  it("returns the translated label for the given property and locale", () => {
    expect(resolveMetaLabel("App", { label: { fr: "Application" } }, "label", "fr")).toBe(
      "Application",
    );
  });

  it("returns the default label when translations is undefined", () => {
    expect(resolveMetaLabel("App", undefined, "label", "fr")).toBe("App");
  });

  it("returns the default label when the locale is not in the property translations", () => {
    expect(resolveMetaLabel("App", { label: { de: "Anwendung" } }, "label", "en")).toBe("App");
  });

  it("returns the default label when property is undefined", () => {
    expect(resolveMetaLabel("App", { label: { fr: "Application" } }, undefined, "fr")).toBe("App");
  });

  it("returns the default label when locale is undefined", () => {
    expect(resolveMetaLabel("App", { label: { fr: "Application" } }, "label", undefined)).toBe(
      "App",
    );
  });

  it("returns the default label when the property key does not exist", () => {
    expect(resolveMetaLabel("App", { label: { fr: "Application" } }, "reverse_label", "fr")).toBe(
      "App",
    );
  });
});

// ---------------------------------------------------------------------------
// 7. SUPPORTED_LOCALES matches loaded locale data
// ---------------------------------------------------------------------------

describe("SUPPORTED_LOCALES matches locale data", () => {
  it("every supported locale has resource data loaded in i18n", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const data = i18n.store.data[locale];
      expect(data, `i18n store is missing data for locale "${locale}"`).toBeDefined();
    }
  });

  it("every supported locale has all 12 namespaces", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const data = i18n.store.data[locale];
      for (const ns of NAMESPACES) {
        expect(
          data?.[ns],
          `i18n store is missing namespace "${ns}" for locale "${locale}"`,
        ).toBeDefined();
      }
    }
  });

  it("SUPPORTED_LOCALES contains exactly the expected 8 locales", () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual([...LOCALES].sort());
  });
});

// ---------------------------------------------------------------------------
// 8. LOCALE_LABELS has entries for all supported locales
// ---------------------------------------------------------------------------

describe("LOCALE_LABELS coverage", () => {
  it("every supported locale has a human-readable label", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const label = LOCALE_LABELS[locale];
      expect(label, `LOCALE_LABELS is missing entry for "${locale}"`).toBeDefined();
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("LOCALE_LABELS has no extra entries beyond SUPPORTED_LOCALES", () => {
    const labelKeys = Object.keys(LOCALE_LABELS).sort();
    expect(labelKeys).toEqual([...SUPPORTED_LOCALES].sort());
  });
});
