import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { renderHook } from "@testing-library/react";
import i18n from "@/i18n";

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSubtypeLabel } from "./useCardSubtypeLabel";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    subtypes: [
      {
        key: "businessApplication",
        label: "Business Application",
        translations: { fr: "Application métier" },
      },
      // A custom subtype an admin added: empty translations, so `label` is
      // the only thing standing between the user and the internal slug.
      { key: "shadowIt", label: "Shadow IT", translations: {} },
    ],
  },
  // A type with no subtypes at all — the lookup must not throw on it.
  { key: "Objective", label: "Objective" },
];

function subtypeLabel() {
  return renderHook(() => useCardSubtypeLabel()).result.current;
}

describe("useCardSubtypeLabel", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useMetamodel).mockReturnValue({ types: TYPES } as any);
  });

  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("resolves a subtype key to its display label", () => {
    expect(subtypeLabel()("Application", "businessApplication")).toBe("Business Application");
  });

  it("resolves a custom subtype whose translations map is empty", () => {
    expect(subtypeLabel()("Application", "shadowIt")).toBe("Shadow IT");
  });

  it("prefers the current locale's translation", async () => {
    await i18n.changeLanguage("fr");
    expect(subtypeLabel()("Application", "businessApplication")).toBe("Application métier");
    // No French entry for the custom subtype — falls back to its label.
    expect(subtypeLabel()("Application", "shadowIt")).toBe("Shadow IT");
    await i18n.changeLanguage("en");
  });

  it("falls back to the raw key when the subtype is not in the metamodel", () => {
    // A stale key left behind by a metamodel edit stays visible rather than
    // blanking the row it describes.
    expect(subtypeLabel()("Application", "retiredSubtype")).toBe("retiredSubtype");
  });

  it("falls back to the raw key when the card type is unknown or has no subtypes", () => {
    expect(subtypeLabel()("Nonexistent", "businessApplication")).toBe("businessApplication");
    expect(subtypeLabel()("Objective", "anything")).toBe("anything");
  });

  it("returns an empty string when there is no subtype", () => {
    expect(subtypeLabel()("Application", null)).toBe("");
    expect(subtypeLabel()("Application", undefined)).toBe("");
    expect(subtypeLabel()("Application", "")).toBe("");
  });
});
