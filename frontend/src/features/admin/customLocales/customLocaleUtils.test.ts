import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import {
  ENGLISH_NAME_PATTERN,
  KNOWN_ERROR_CODES,
  LOCALE_CODE_PATTERN,
  METAMODEL_NAMESPACE,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
  REJECT_REASONS,
  apiErrorCode,
  downloadJson,
  errorMessage,
  importBody,
  isKnownErrorCode,
  isKnownReason,
  namespaceLabel,
  parseLanguagePack,
  percent,
  readFileText,
  reasonLabel,
  usuallyRtl,
} from "./customLocaleUtils";
import type { LanguagePack } from "@/types";

const t = (key: string) => `T:${key}`;

function pack(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: "turbo-ea-language-pack",
    format_version: 1,
    locale: { code: "he", name: "עברית" },
    strings: {
      common: { "actions.save": "שמור", "actions.cancel": "ביטול" },
      metamodel: { "type.Application.label": "יישום" },
    },
    source_hashes: { common: { "actions.save": "abc" } },
    ...over,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("constants", () => {
  it("name the pack format, the error codes and the reasons the server sends", () => {
    expect(PACK_FORMAT).toBe("turbo-ea-language-pack");
    expect(PACK_FORMAT_VERSION).toBe(1);
    expect(METAMODEL_NAMESPACE).toBe("metamodel");
    expect([...KNOWN_ERROR_CODES]).toEqual([
      "invalid_code",
      "built_in_code",
      "locale_exists",
      "job_running",
      "ai_not_configured",
      "catalog_unavailable",
    ]);
    expect([...REJECT_REASONS]).toEqual([
      "unknown_key",
      "empty",
      "too_long",
      "placeholder_mismatch",
      "nesting_mismatch",
      "markup_not_in_source",
      "url_not_in_source",
      "control_chars",
      "not_a_string",
      "source_changed",
    ]);
  });
});

describe("LOCALE_CODE_PATTERN", () => {
  it.each(["he", "hi", "th", "fil", "pt-BR", "zh-Hant", "sr-Latn-RS"])("accepts %s", (code) => {
    expect(LOCALE_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each(["HE", "h", "abcd", "pt-br", "pt-BRA", "zh-hant", "zh-HANT", "pt-BR\n", " he", "he-"])(
    "refuses %j",
    (code) => {
      expect(LOCALE_CODE_PATTERN.test(code)).toBe(false);
    },
  );
});

describe("ENGLISH_NAME_PATTERN", () => {
  it.each(["Hebrew", "Chinese (Traditional)", "Serbo-Croatian", "Ab"])("accepts %s", (name) => {
    expect(ENGLISH_NAME_PATTERN.test(name)).toBe(true);
  });

  it.each(["A", "1Dutch", " Dutch", "Dutch!", "Dutch\nIgnore", `D${"a".repeat(60)}`])(
    "refuses %j",
    (name) => {
      expect(ENGLISH_NAME_PATTERN.test(name)).toBe(false);
    },
  );
});

describe("usuallyRtl", () => {
  it.each(["he", "ar", "fa", "ur", "yi", "ps", "sd", "ug", "dv", "fa-IR", " he "])(
    "is true for %j",
    (code) => {
      expect(usuallyRtl(code)).toBe(true);
    },
  );

  it.each(["hi", "th", "en", "", "heb", "x-he"])("is false for %j", (code) => {
    expect(usuallyRtl(code)).toBe(false);
  });
});

describe("parseLanguagePack", () => {
  it("reads a pack: namespaces sorted, strings counted, hashes kept", () => {
    const result = parseLanguagePack(pack());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.namespaces).toEqual(["common", "metamodel"]);
    expect(result.stringCount).toBe(3);
    expect(result.pack.locale.code).toBe("he");
    expect(result.pack.strings.metamodel).toEqual({ "type.Application.label": "יישום" });
    expect(result.pack.source_hashes).toEqual({ common: { "actions.save": "abc" } });
  });

  it("drops namespaces that are not objects or are empty, and hashes that are not an object", () => {
    const result = parseLanguagePack(
      pack({
        strings: { nav: [], admin: "x", grc: {}, common: { a: "b" } },
        source_hashes: ["nope"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.namespaces).toEqual(["common"]);
    expect(Object.keys(result.pack.strings)).toEqual(["common"]);
    expect(result.stringCount).toBe(1);
    expect(result.pack.source_hashes).toBeUndefined();
  });

  it.each([
    ["not JSON", "{nope", "invalid_json"],
    ["a list", "[]", "not_a_pack"],
    ["null", "null", "not_a_pack"],
    ["another format", pack({ format: "other" }), "not_a_pack"],
    ["no locale", pack({ locale: undefined }), "not_a_pack"],
    ["a locale list", pack({ locale: ["he"] }), "not_a_pack"],
    ["a locale without a code", pack({ locale: { code: 5 } }), "not_a_pack"],
    ["a newer version", pack({ format_version: 2 }), "unsupported_version"],
    ["a version as text", pack({ format_version: "1" }), "unsupported_version"],
    ["no strings", pack({ strings: undefined }), "no_strings"],
    ["strings as a list", pack({ strings: [] }), "no_strings"],
    ["only empty namespaces", pack({ strings: { common: {}, nav: null } }), "no_strings"],
  ])("refuses %s", (_label, text, error) => {
    expect(parseLanguagePack(text)).toEqual({ ok: false, error });
  });
});

describe("importBody", () => {
  const parsed = parseLanguagePack(pack());
  const p = (parsed.ok ? parsed.pack : null) as LanguagePack;

  it("sends one namespace with its hashes, as an import", () => {
    expect(importBody(p, "common")).toEqual({
      strings: { common: { "actions.save": "שמור", "actions.cancel": "ביטול" } },
      source_hashes: { common: { "actions.save": "abc" } },
      origin: "import",
    });
  });

  it("leaves the hashes out for a namespace that has none", () => {
    expect(importBody(p, "metamodel")).toEqual({
      strings: { metamodel: { "type.Application.label": "יישום" } },
      origin: "import",
    });
  });
});

describe("readFileText", () => {
  it("reads a file as text, keeping every character", async () => {
    const text = 'שמור · सहेजें · क्‍ष · บันทึก';
    await expect(readFileText(new Blob([text]))).resolves.toBe(text);
  });

  it("rejects when the file cannot be read", async () => {
    class FailingReader {
      error = new Error("unreadable");
      onerror: (() => void) | null = null;
      readAsText() {
        this.onerror?.();
      }
    }
    vi.stubGlobal("FileReader", FailingReader);
    await expect(readFileText(new Blob(["x"]))).rejects.toThrow("unreadable");
  });
});

describe("downloadJson", () => {
  it("offers pretty-printed JSON under the given name and releases the URL", async () => {
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return "blob:pack";
    });
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
      expect(document.body.contains(this)).toBe(true);
    });

    downloadJson("turbo-ea-he-share.json", { a: ["ב"] });

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("turbo-ea-he-share.json");
    expect(clicked[0].getAttribute("href")).toBe("blob:pack");
    expect(document.body.contains(clicked[0])).toBe(false);
    expect(revoke).toHaveBeenCalledWith("blob:pack");
    expect(blob!.type).toBe("application/json");
    await expect(readFileText(blob!)).resolves.toBe(JSON.stringify({ a: ["ב"] }, null, 2));
  });
});

describe("apiErrorCode / errorMessage", () => {
  it("reads the code from a string detail or a {code} detail", () => {
    expect(apiErrorCode(new ApiError("m", 409, "locale_exists"))).toBe("locale_exists");
    expect(apiErrorCode(new ApiError("m", 400, { code: "job_running" }))).toBe("job_running");
  });

  it("has no code for any other error shape", () => {
    expect(apiErrorCode(new ApiError("m", 400, { code: 5 }))).toBeNull();
    expect(apiErrorCode(new ApiError("m", 400, null))).toBeNull();
    expect(apiErrorCode(new ApiError("m", 400, ["x"]))).toBeNull();
    expect(apiErrorCode(new Error("locale_exists"))).toBeNull();
    expect(apiErrorCode("locale_exists")).toBeNull();
  });

  it("knows only the listed codes", () => {
    expect(isKnownErrorCode("ai_not_configured")).toBe(true);
    expect(isKnownErrorCode("something_else")).toBe(false);
    expect(isKnownErrorCode(null)).toBe(false);
  });

  it("uses the code's own message, else the fallback", () => {
    expect(errorMessage(new ApiError("m", 400, "invalid_code"), t, "fallback")).toBe(
      "T:customLocales.errors.invalid_code",
    );
    expect(errorMessage(new ApiError("m", 500, "boom"), t, "fallback")).toBe("fallback");
    expect(errorMessage(new Error("x"), t, "fallback")).toBe("fallback");
  });
});

describe("reasonLabel / namespaceLabel", () => {
  it("labels a known reason and shows an unknown one as sent", () => {
    expect(isKnownReason("source_changed")).toBe(true);
    expect(isKnownReason("new_reason")).toBe(false);
    expect(reasonLabel("source_changed", t)).toBe("T:customLocales.reasons.source_changed");
    expect(reasonLabel("placeholder_mismatch", t)).toBe(
      "T:customLocales.reasons.placeholder_mismatch",
    );
    expect(reasonLabel("new_reason", t)).toBe("new_reason");
  });

  it("names the database labels by what they are and other namespaces by name", () => {
    expect(namespaceLabel("metamodel", t)).toBe("T:customLocales.namespaces.metamodel");
    expect(namespaceLabel("common", t)).toBe("common");
  });
});

describe("percent", () => {
  it.each([
    [0, 0, 0],
    [3, 0, 0],
    [3, -1, 0],
    [1, 3, 33],
    [2, 3, 67],
    [4, 4, 100],
    [5, 4, 100],
  ])("%i of %i is %i%%", (part, total, expected) => {
    expect(percent(part, total)).toBe(expected);
  });
});
