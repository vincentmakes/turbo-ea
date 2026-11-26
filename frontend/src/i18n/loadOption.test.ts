/**
 * `load: "currentOnly"` in the i18next set-up: a language resolves as
 * [itself, English], never through its base language. A custom `pt-BR` or
 * `zh-Hant` must show English where it has no translation — as the admin's
 * counts say — not the built-in `pt` / `zh`.
 *
 * The set-up runs once, at module load, so the module is loaded fresh here:
 * a change to the option is then evaluated by this test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  const { default: i18n } = await import("./index");
  await i18n.changeLanguage("en");
});

describe("i18n language resolution", () => {
  it("resolves a regional or script variant as itself, then English", async () => {
    vi.resetModules();
    const { default: i18n } = await import("./index");
    expect(i18n.options.load).toBe("currentOnly");
    expect(i18n.services.languageUtils.toResolveHierarchy("pt-BR")).toEqual(["pt-BR", "en"]);
    expect(i18n.services.languageUtils.toResolveHierarchy("zh-Hant")).toEqual(["zh-Hant", "en"]);
  });

  it("shows English, not the built-in base language, for an untranslated key", async () => {
    vi.resetModules();
    const { default: i18n } = await import("./index");
    i18n.addResourceBundle("pt-BR", "common", { "actions.save": "Salvar" });
    try {
      expect(i18n.t("common:actions.save", { lng: "pt-BR" })).toBe("Salvar");
      expect(i18n.t("common:actions.cancel", { lng: "pt-BR" })).toBe("Cancel");
      // The built-in Portuguese has its own word, which must not leak in.
      expect(i18n.t("common:actions.cancel", { lng: "pt" })).not.toBe("Cancel");
    } finally {
      i18n.removeResourceBundle("pt-BR", "common");
    }
  });
});
