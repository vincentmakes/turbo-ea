import { afterAll, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import i18n from "@/i18n";
import {
  categoryLabel,
  typeDescription,
  useCategoryLabel,
  useTypeDescription,
} from "./useResolveLabel";

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

const ROLE = {
  key: "contractOwner",
  label: "Contract Owner",
  description: "Signs the vendor contract.",
  translations: {
    label: { de: "Vertragsverantwortlicher" },
    description: { de: "Unterschreibt den Vertrag.", fr: "" },
  },
};

describe("typeDescription", () => {
  it("returns the locale's description translation", () => {
    expect(typeDescription(ROLE, "de")).toBe("Unterschreibt den Vertrag.");
  });

  it("falls back to the entity's own description", () => {
    expect(typeDescription(ROLE, "fr")).toBe("Signs the vendor contract.");
    expect(typeDescription(ROLE, "it")).toBe("Signs the vendor contract.");
    expect(typeDescription(ROLE)).toBe("Signs the vendor contract.");
  });

  it("is empty — never the label or key — when there is no description", () => {
    expect(typeDescription({ key: "observer", label: "Observer" }, "en")).toBe("");
    expect(typeDescription({ key: "observer", label: "Observer", description: null }, "de")).toBe("");
    expect(typeDescription(null, "de")).toBe("");
    expect(typeDescription(undefined)).toBe("");
  });

  it("serves a translation even when the English description is empty", () => {
    const onlyDe = { key: "r", label: "R", translations: { description: { de: "Nur Deutsch" } } };
    expect(typeDescription(onlyDe, "de")).toBe("Nur Deutsch");
    expect(typeDescription(onlyDe, "en")).toBe("");
  });
});

describe("useTypeDescription", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("binds the current language", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const { result } = renderHook(() => useTypeDescription());
    expect(result.current(ROLE)).toBe("Unterschreibt den Vertrag.");
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const { result: en } = renderHook(() => useTypeDescription());
    expect(en.current(ROLE)).toBe("Signs the vendor contract.");
  });

  it("re-binds a mounted hook when the language changes", async () => {
    const { result } = renderHook(() => useTypeDescription());
    expect(result.current(ROLE)).toBe("Signs the vendor contract.");
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(result.current(ROLE)).toBe("Unterschreibt den Vertrag.");
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });
});
