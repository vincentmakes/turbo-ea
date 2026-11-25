/**
 * The custom-language runtime: the registry, labels, direction, loading a
 * bundle into i18next, switching to it and refreshing it in place.
 *
 * The loader keeps module state (what is loaded, what is in flight), so every
 * test uses its own language code. Real Hebrew, Hindi (with ZWJ / ZWNJ) and
 * Thai strings go through i18next unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { useTranslation } from "react-i18next";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { api } from "@/api/client";
import { mockApi } from "@/test/apiMock";
import i18n, { dirForLocale, isRtlLocale } from "./index";
import {
  PRELOAD_TIMEOUT_MS,
  ensureLocaleLoaded,
  forgetCustomLocale,
  getCustomLocale,
  isBuiltInLocale,
  localeLabel,
  preloadDetectedLocale,
  refreshCustomLocale,
  registerCustomLocale,
  registerCustomLocales,
  setAppLanguage,
} from "./customLocales";

const HEBREW_SAVE = "שמור";
const HINDI_SAVE = "सहेजें";
/** A conjunct with a ZWJ and one with a ZWNJ: both must survive untouched. */
const HINDI_JOINERS = "क्‍ष और क्‌ष";
const THAI_SAVE = "บันทึก";

function bundle(code: string, over: Record<string, unknown> = {}) {
  return {
    code,
    name: `name-${code}`,
    rtl: false,
    hash: `hash-${code}`,
    resources: { common: { "actions.save": `save-${code}` } },
    ...over,
  };
}

function bundleCalls(code: string) {
  return mockApi.callsOf("get", `/custom-locales/${code}/bundle`);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockApi.reset();
  expect(api).toBe(mockApi.api);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("isBuiltInLocale", () => {
  it("is true only for a code that ships with the app", () => {
    expect(isBuiltInLocale("de")).toBe(true);
    expect(isBuiltInLocale("ar")).toBe(true);
    expect(isBuiltInLocale("nl")).toBe(false);
    expect(isBuiltInLocale("de-CH")).toBe(false);
    expect(isBuiltInLocale("")).toBe(false);
    expect(isBuiltInLocale(null)).toBe(false);
    expect(isBuiltInLocale(undefined)).toBe(false);
  });
});

describe("registry", () => {
  it("registers, replaces and forgets entries", () => {
    registerCustomLocales([
      { code: "reg-a", name: "A", rtl: false, hash: "1" },
      { code: "reg-b", name: "B", rtl: true, hash: "2" },
    ]);
    expect(getCustomLocale("reg-a")).toEqual({ code: "reg-a", name: "A", rtl: false, hash: "1" });
    expect(getCustomLocale("reg-b")?.rtl).toBe(true);

    registerCustomLocale({ code: "reg-a", name: "A2", rtl: true, hash: "3" });
    expect(getCustomLocale("reg-a")).toEqual({ code: "reg-a", name: "A2", rtl: true, hash: "3" });

    forgetCustomLocale("reg-a");
    expect(getCustomLocale("reg-a")).toBeUndefined();
    expect(getCustomLocale("reg-b")).toBeDefined();
  });

  it("keeps its own copy of an entry", () => {
    const entry = { code: "reg-c", name: "C", rtl: false, hash: "" };
    registerCustomLocale(entry);
    entry.name = "changed";
    expect(getCustomLocale("reg-c")?.name).toBe("C");
  });

  it("answers nothing for an empty code", () => {
    expect(getCustomLocale(null)).toBeUndefined();
    expect(getCustomLocale("")).toBeUndefined();
  });
});

describe("localeLabel", () => {
  it("names a built-in by its label and a custom language by its native name", () => {
    registerCustomLocale({ code: "he", name: "עברית", rtl: true, hash: "" });
    expect(localeLabel("de")).toBe("Deutsch");
    expect(localeLabel("he")).toBe("עברית");
  });

  it("falls back to the given text, then to the code", () => {
    expect(localeLabel("xx-unknown", "English")).toBe("English");
    expect(localeLabel("xx-unknown")).toBe("xx-unknown");
    expect(localeLabel(null)).toBe("");
    expect(localeLabel(undefined, "English")).toBe("English");
  });
});

describe("isRtlLocale / dirForLocale with custom languages", () => {
  it("follows a custom language's own flag, before the built-in list", () => {
    registerCustomLocale({ code: "he", name: "עברית", rtl: true, hash: "" });
    registerCustomLocale({ code: "hi", name: "हिन्दी", rtl: false, hash: "" });
    // A custom variant of Arabic that the admin set left to right.
    registerCustomLocale({ code: "ar-Latn", name: "Arabizi", rtl: false, hash: "" });

    expect(isRtlLocale("he")).toBe(true);
    expect(dirForLocale("he")).toBe("rtl");
    expect(isRtlLocale("hi")).toBe(false);
    expect(dirForLocale("hi")).toBe("ltr");
    expect(isRtlLocale("ar-Latn")).toBe(false);
  });

  it("keeps the built-in answer for languages that are not registered", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("ar-SA")).toBe(true);
    expect(isRtlLocale("fa-unregistered")).toBe(false);
    expect(isRtlLocale(null)).toBe(false);
    expect(isRtlLocale("")).toBe(false);
  });
});

describe("ensureLocaleLoaded", () => {
  it("does nothing for a built-in language or an empty code", async () => {
    await expect(ensureLocaleLoaded("fr")).resolves.toBe(true);
    await expect(ensureLocaleLoaded("")).resolves.toBe(false);
    expect(mockApi.calls).toHaveLength(0);
  });

  it("adds every namespace of the bundle and registers name, direction and hash", async () => {
    mockApi.on("get", "/custom-locales/he/bundle", {
      code: "he",
      name: "עברית",
      rtl: true,
      hash: "h-he",
      resources: { common: { "actions.save": HEBREW_SAVE }, nav: { "userMenu.language": "שפה" } },
    });
    await expect(ensureLocaleLoaded("he")).resolves.toBe(true);

    expect(bundleCalls("he")).toHaveLength(1);
    expect(i18n.t("actions.save", { lng: "he" })).toBe(HEBREW_SAVE);
    expect(i18n.t("nav:userMenu.language", { lng: "he" })).toBe("שפה");
    expect(getCustomLocale("he")).toEqual({ code: "he", name: "עברית", rtl: true, hash: "h-he" });
    expect(isRtlLocale("he")).toBe(true);
  });

  it("keeps Hindi joiners and Thai marks exactly as sent", async () => {
    mockApi.on("get", "/custom-locales/hi/bundle", {
      ...bundle("hi"),
      resources: { common: { "actions.save": HINDI_SAVE, "actions.edit": HINDI_JOINERS } },
    });
    mockApi.on("get", "/custom-locales/th/bundle", {
      ...bundle("th"),
      resources: { common: { "actions.save": THAI_SAVE } },
    });
    await ensureLocaleLoaded("hi");
    await ensureLocaleLoaded("th");
    expect(i18n.t("actions.save", { lng: "hi" })).toBe(HINDI_SAVE);
    expect(i18n.t("actions.edit", { lng: "hi" })).toBe(HINDI_JOINERS);
    expect(i18n.t("actions.save", { lng: "th" })).toBe(THAI_SAVE);
  });

  it("ignores a namespace English does not have and one that is not an object", async () => {
    mockApi.on("get", "/custom-locales/ns-x/bundle", {
      ...bundle("ns-x"),
      resources: { bogus: { a: "b" }, nav: ["not", "an", "object"], common: { "actions.save": "ok" } },
    });
    await expect(ensureLocaleLoaded("ns-x")).resolves.toBe(true);
    expect(i18n.hasResourceBundle("ns-x", "bogus")).toBe(false);
    expect(i18n.hasResourceBundle("ns-x", "nav")).toBe(false);
    expect(i18n.hasResourceBundle("ns-x", "common")).toBe(true);
  });

  it("shares one request between concurrent calls", async () => {
    const reply = deferred<unknown>();
    mockApi.on("get", "/custom-locales/dd/bundle", () => reply.promise);
    const first = ensureLocaleLoaded("dd");
    const second = ensureLocaleLoaded("dd");
    expect(second).toBe(first);
    reply.resolve(bundle("dd"));
    await expect(first).resolves.toBe(true);
    expect(bundleCalls("dd")).toHaveLength(1);
  });

  it("reuses a loaded bundle until the registry's hash moves", async () => {
    mockApi.on("get", "/custom-locales/hs/bundle", bundle("hs"));
    await ensureLocaleLoaded("hs");
    await expect(ensureLocaleLoaded("hs")).resolves.toBe(true);
    expect(bundleCalls("hs")).toHaveLength(1);

    // Bootstrap registered a language without a hash: still no reload.
    registerCustomLocale({ code: "hs", name: "x", rtl: false, hash: "" });
    await ensureLocaleLoaded("hs");
    expect(bundleCalls("hs")).toHaveLength(1);

    // Bootstrap says the strings changed: reload.
    registerCustomLocale({ code: "hs", name: "x", rtl: false, hash: "newer" });
    await ensureLocaleLoaded("hs");
    expect(bundleCalls("hs")).toHaveLength(2);
  });

  it("replaces the namespaces on a forced reload, so a cleared string falls back to English", async () => {
    mockApi.on("get", "/custom-locales/nl-BE/bundle", {
      ...bundle("nl-BE"),
      resources: { common: { "actions.save": "Opslaan", "actions.edit": "Bewerken" } },
    });
    await ensureLocaleLoaded("nl-BE");
    expect(i18n.t("actions.edit", { lng: "nl-BE" })).toBe("Bewerken");

    mockApi.on("get", "/custom-locales/nl-BE/bundle", {
      ...bundle("nl-BE"),
      resources: { common: { "actions.save": "Bewaren" } },
    });
    await expect(ensureLocaleLoaded("nl-BE", { force: true })).resolves.toBe(true);
    expect(bundleCalls("nl-BE")).toHaveLength(2);
    expect(i18n.t("actions.save", { lng: "nl-BE" })).toBe("Bewaren");
    expect(i18n.t("actions.edit", { lng: "nl-BE" })).toBe("Edit");
  });

  it("makes a forced reload wait for, then follow, a request already in flight", async () => {
    const reply = deferred<unknown>();
    mockApi.on("get", "/custom-locales/fl/bundle", () => reply.promise);
    const first = ensureLocaleLoaded("fl");
    const forced = ensureLocaleLoaded("fl", { force: true });
    expect(forced).not.toBe(first);
    mockApi.on("get", "/custom-locales/fl/bundle", bundle("fl", { hash: "second" }));
    reply.resolve(bundle("fl", { hash: "first" }));
    await expect(forced).resolves.toBe(true);
    expect(bundleCalls("fl")).toHaveLength(2);
    expect(getCustomLocale("fl")?.hash).toBe("second");
  });

  it("resolves false and keeps what was loaded when the bundle cannot be read", async () => {
    mockApi.on("get", "/custom-locales/kf/bundle", {
      ...bundle("kf"),
      resources: { common: { "actions.save": "kept" } },
    });
    await ensureLocaleLoaded("kf");
    mockApi.fail("get", "/custom-locales/kf/bundle", 404, "not_found");
    await expect(ensureLocaleLoaded("kf", { force: true })).resolves.toBe(false);
    expect(i18n.t("actions.save", { lng: "kf" })).toBe("kept");
  });

  it("resolves false for a reply that is not a bundle", async () => {
    mockApi.on("get", "/custom-locales/nb1/bundle", null);
    mockApi.on("get", "/custom-locales/nb2/bundle", { code: "nb2", resources: "nope" });
    await expect(ensureLocaleLoaded("nb1")).resolves.toBe(false);
    await expect(ensureLocaleLoaded("nb2")).resolves.toBe(false);
    expect(getCustomLocale("nb1")).toBeUndefined();
  });

  it("tries again after a failed load", async () => {
    mockApi.fail("get", "/custom-locales/rt/bundle", 500);
    await expect(ensureLocaleLoaded("rt")).resolves.toBe(false);
    mockApi.on("get", "/custom-locales/rt/bundle", bundle("rt"));
    await expect(ensureLocaleLoaded("rt")).resolves.toBe(true);
    expect(bundleCalls("rt")).toHaveLength(2);
  });

  it("falls back to the known name and reads only a true rtl and a string hash", async () => {
    registerCustomLocale({ code: "nm", name: "Known", rtl: true, hash: "" });
    mockApi.on("get", "/custom-locales/nm/bundle", {
      ...bundle("nm"),
      name: "",
      rtl: "yes",
      hash: 42,
    });
    await ensureLocaleLoaded("nm");
    expect(getCustomLocale("nm")).toEqual({ code: "nm", name: "Known", rtl: false, hash: "" });
  });

  it("names an unknown language by its code when the bundle has no name", async () => {
    mockApi.on("get", "/custom-locales/nn/bundle", { ...bundle("nn"), name: 7 });
    await ensureLocaleLoaded("nn");
    expect(getCustomLocale("nn")?.name).toBe("nn");
  });
});

describe("setAppLanguage", () => {
  it("switches to a built-in language without a request", async () => {
    const spy = vi.spyOn(i18n, "changeLanguage");
    await expect(setAppLanguage("de")).resolves.toBe("de");
    expect(spy).toHaveBeenCalledWith("de");
    expect(i18n.language).toBe("de");
    expect(mockApi.calls).toHaveLength(0);
  });

  it("treats no language as English", async () => {
    await i18n.changeLanguage("de");
    await expect(setAppLanguage(null)).resolves.toBe("en");
    expect(i18n.language).toBe("en");
    await i18n.changeLanguage("de");
    await expect(setAppLanguage("")).resolves.toBe("en");
    expect(i18n.language).toBe("en");
  });

  it("loads a custom language before switching to it", async () => {
    mockApi.on("get", "/custom-locales/th-TH/bundle", {
      ...bundle("th-TH"),
      resources: { common: { "actions.save": THAI_SAVE } },
    });
    await expect(setAppLanguage("th-TH")).resolves.toBe("th-TH");
    expect(i18n.language).toBe("th-TH");
    expect(i18n.t("actions.save")).toBe(THAI_SAVE);
  });

  it("falls back to English when the custom language cannot be loaded", async () => {
    await i18n.changeLanguage("de");
    mockApi.fail("get", "/custom-locales/gone/bundle", 404);
    await expect(setAppLanguage("gone")).resolves.toBe("en");
    expect(i18n.language).toBe("en");
  });
});

describe("refreshCustomLocale", () => {
  function Probe() {
    const { t } = useTranslation("common");
    return createElement("span", { "data-testid": "probe" }, t("actions.save"));
  }

  it("does nothing for a built-in language", async () => {
    await expect(refreshCustomLocale("de")).resolves.toBe(false);
    expect(mockApi.calls).toHaveLength(0);
  });

  it("only marks an inactive language stale, so the next use reloads it", async () => {
    mockApi.on("get", "/custom-locales/ia/bundle", bundle("ia"));
    await ensureLocaleLoaded("ia");
    await expect(refreshCustomLocale("ia")).resolves.toBe(false);
    expect(bundleCalls("ia")).toHaveLength(1);
    await ensureLocaleLoaded("ia");
    expect(bundleCalls("ia")).toHaveLength(2);
  });

  it("reloads the active language and re-renders what is on screen", async () => {
    mockApi.on("get", "/custom-locales/he-IL/bundle", {
      ...bundle("he-IL"),
      rtl: true,
      resources: { common: { "actions.save": "שמירה" } },
    });
    await setAppLanguage("he-IL");
    render(createElement(Probe));
    expect(screen.getByTestId("probe")).toHaveTextContent("שמירה");

    mockApi.on("get", "/custom-locales/he-IL/bundle", {
      ...bundle("he-IL"),
      rtl: true,
      resources: { common: { "actions.save": HEBREW_SAVE } },
    });
    let result = false;
    await act(async () => {
      result = await refreshCustomLocale("he-IL");
    });
    expect(result).toBe(true);
    expect(bundleCalls("he-IL")).toHaveLength(2);
    expect(screen.getByTestId("probe")).toHaveTextContent(HEBREW_SAVE);
  });

  it("answers false when the active language cannot be reloaded", async () => {
    mockApi.on("get", "/custom-locales/af-x/bundle", bundle("af-x"));
    await setAppLanguage("af-x");
    mockApi.fail("get", "/custom-locales/af-x/bundle", 500);
    const spy = vi.spyOn(i18n, "changeLanguage");
    await expect(refreshCustomLocale("af-x")).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("preloadDetectedLocale", () => {
  it("waits for nothing when the language is built in", async () => {
    await i18n.changeLanguage("de");
    const spy = vi.spyOn(i18n, "changeLanguage");
    await preloadDetectedLocale();
    expect(mockApi.calls).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("loads a stored custom language and applies it", async () => {
    await i18n.changeLanguage("hi-IN");
    mockApi.on("get", "/custom-locales/hi-IN/bundle", {
      ...bundle("hi-IN"),
      resources: { common: { "actions.save": HINDI_SAVE } },
    });
    const spy = vi.spyOn(i18n, "changeLanguage");
    await preloadDetectedLocale();
    expect(spy).toHaveBeenCalledWith("hi-IN");
    expect(i18n.language).toBe("hi-IN");
    expect(i18n.t("actions.save")).toBe(HINDI_SAVE);
  });

  it("falls back to English when the stored language cannot be loaded", async () => {
    await i18n.changeLanguage("xq");
    mockApi.fail("get", "/custom-locales/xq/bundle", 404);
    await preloadDetectedLocale();
    expect(i18n.language).toBe("en");
  });

  it("stops waiting after the timeout and applies the language when it lands", async () => {
    await i18n.changeLanguage("slow");
    const reply = deferred<unknown>();
    mockApi.on("get", "/custom-locales/slow/bundle", () => reply.promise);
    const spy = vi.spyOn(i18n, "changeLanguage");
    await preloadDetectedLocale(5);
    expect(spy).not.toHaveBeenCalled();

    reply.resolve({ ...bundle("slow"), resources: { common: { "actions.save": THAI_SAVE } } });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith("slow"));
    expect(i18n.t("actions.save")).toBe(THAI_SAVE);
  });

  it("does not switch back when the user changed language before a slow load landed", async () => {
    await i18n.changeLanguage("slow2");
    const reply = deferred<unknown>();
    mockApi.on("get", "/custom-locales/slow2/bundle", () => reply.promise);
    await preloadDetectedLocale(5);
    await i18n.changeLanguage("de");
    const spy = vi.spyOn(i18n, "changeLanguage");
    reply.resolve(bundle("slow2"));
    await vi.waitFor(() => expect(bundleCalls("slow2")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).not.toHaveBeenCalled();
    expect(i18n.language).toBe("de");
  });

  it("waits three seconds by default", () => {
    expect(PRELOAD_TIMEOUT_MS).toBe(3000);
  });
});
