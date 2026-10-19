import { afterAll, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import i18n from "@/i18n";
import { categoryLabel, useCategoryLabel } from "./useResolveLabel";

const DEFAULT = {
  key: "Application & Data",
  label: "Application & Data",
  translations: { fr: "Application et données", de: "Anwendung & Daten" },
};
// A custom category renamed after creation: its key is the first label typed.
const RENAMED = { key: "Sec", label: "Security Architecture", translations: {} };

describe("categoryLabel", () => {
  it("returns the locale's translation", () => {
    expect(categoryLabel(DEFAULT, "fr")).toBe("Application et données");
  });

  it("falls back to the label, never the key", () => {
    expect(categoryLabel(DEFAULT, "zh")).toBe("Application & Data");
    expect(categoryLabel(RENAMED, "fr")).toBe("Security Architecture");
  });

  it("uses the label without a locale", () => {
    expect(categoryLabel(DEFAULT)).toBe("Application & Data");
  });

  it("is empty for a missing entity", () => {
    expect(categoryLabel(null, "fr")).toBe("");
    expect(categoryLabel(undefined)).toBe("");
  });
});

describe("useCategoryLabel", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("binds the current language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const { result } = renderHook(() => useCategoryLabel());
    expect(result.current(DEFAULT)).toBe("Anwendung & Daten");
    expect(result.current(RENAMED)).toBe("Security Architecture");
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });
});
