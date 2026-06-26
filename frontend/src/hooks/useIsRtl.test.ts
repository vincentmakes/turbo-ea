import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const state = vi.hoisted(() => ({ lang: "en" }));

// Mock react-i18next: control the active language, and provide a stub
// initReactI18next plugin so importing the real "@/i18n" module (which calls
// i18n.use(initReactI18next)) still initialises cleanly.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ i18n: { language: state.lang } }),
}));

import { useIsRtl } from "./useIsRtl";

describe("useIsRtl", () => {
  it("is false for LTR locales", () => {
    state.lang = "en";
    expect(renderHook(() => useIsRtl()).result.current).toBe(false);
  });

  it("is true for Arabic", () => {
    state.lang = "ar";
    expect(renderHook(() => useIsRtl()).result.current).toBe(true);
  });

  it("handles a region suffix (ar-SA)", () => {
    state.lang = "ar-SA";
    expect(renderHook(() => useIsRtl()).result.current).toBe(true);
  });
});
