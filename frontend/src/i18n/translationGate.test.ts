/**
 * The gate every custom-language string passes before i18next sees it. The
 * attack strings are the review's payloads against
 * `cards:detail.dialogs.archive.confirm`, which the archive dialog renders
 * through `dangerouslySetInnerHTML`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Gate = typeof import("./translationGate");
let gate: Gate;

// The patterns are module-level constants: load the module fresh for every
// test, so a mutation of one is evaluated here rather than credited to
// whichever test first imported the module.
beforeEach(async () => {
  vi.resetModules();
  gate = await import("./translationGate");
});

const isSafeTranslation = (...args: Parameters<Gate["isSafeTranslation"]>) =>
  gate.isSafeTranslation(...args);
const flattenStrings = (...args: Parameters<Gate["flattenStrings"]>) => gate.flattenStrings(...args);
const englishSource = (...args: Parameters<Gate["englishSource"]>) => gate.englishSource(...args);
const gateResources = (...args: Parameters<Gate["gateResources"]>) => gate.gateResources(...args);

const ARCHIVE = "Are you sure you want to archive <strong>{{name}}</strong>?";

describe("isSafeTranslation — refused", () => {
  it.each([
    [
      "an unclosed tag before a tag English has",
      "Are you sure you want to archive <img src=x onerror=alert(document.domain) <strong>{{name}}</strong>?",
    ],
    [
      "a nesting whose default value carries a tag",
      '$t(nope, {"defaultValue": "\\u003cimg src=x onerror=alert(1)\\u003e"}) Are you sure you want to archive <strong>{{name}}</strong>?',
    ],
    [
      "a nesting that turns escaping off",
      '$t(cards:detail.dialogs.archive.confirm_x, {"interpolation": {"escapeValue": false}, "defaultValue": "{{name}}", "p": "("}) Are you sure you want to archive <strong>{{name}}</strong>?',
    ],
    [
      "a nesting that recurses into another dialog",
      '$t(cards:detail.dialogs.delete.confirm, {"p":"("}) Are you sure you want to archive <strong>{{name}}</strong>?',
    ],
    ["an unclosed nesting", "$t(common:x <strong>{{name}}</strong>"],
    ["a closed tag English lacks", "Archive <b>{{name}}</b>?"],
    ["a closing tag English lacks", "Archive <strong>{{name}}</strong></div>?"],
    ["a self-closing tag English lacks", "Archive <strong>{{name}}</strong><br/>"],
    ["a comment", "Archive <!-- x --><strong>{{name}}</strong>?"],
    ["a processing instruction", "Archive <?xml?><strong>{{name}}</strong>?"],
    ["a tag hidden in a token's attributes", 'Archive <strong onmouseover="x">{{name}}</strong>?'],
    ["a stray closing brace pair", "Archive <strong>{{name}} }}</strong>?"],
    ["an opened, never closed interpolation", "Archive <strong>{{name}}</strong> {{"],
  ])("%s", (_label, value) => {
    expect(isSafeTranslation(ARCHIVE, value)).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    expect(isSafeTranslation("Save", 5)).toBe(false);
    expect(isSafeTranslation("Save", null)).toBe(false);
    expect(isSafeTranslation("Save", ["Save"])).toBe(false);
    expect(isSafeTranslation("Save", { a: "b" })).toBe(false);
  });

  it("refuses a nesting English does not have, and one dropped from English's", () => {
    expect(isSafeTranslation("Save", "$t(common:actions.save)")).toBe(false);
    expect(isSafeTranslation("See $t(common:items)", "Voir")).toBe(false);
  });
});

describe("isSafeTranslation — accepted", () => {
  it.each([
    ["Hebrew, keeping English's tags", "האם להעביר לארכיון את <strong>{{name}}</strong>?"],
    ["Hindi with joiners", "क्या आप <strong>{{name}}</strong> को संग्रहित करना चाहते हैं? क्‍ष क्‌ष"],
    ["Thai", "ต้องการเก็บ <strong>{{name}}</strong> ถาวรหรือไม่"],
    ["tags moved and repeated", "<strong>{{name}}</strong> — archive <strong>?</strong>"],
    ["no tags at all", "Archive {{name}}?"],
    ["a bare less-than", "Archive {{name}} (<40% used) <3 or < 5?"],
  ])("%s", (_label, value) => {
    expect(isSafeTranslation(ARCHIVE, value)).toBe(true);
  });

  it("accepts numbered component tags English has", () => {
    expect(isSafeTranslation("Read <1>the guide</1> first", "Lies zuerst <1>die Anleitung</1>")).toBe(true);
    expect(isSafeTranslation("Read <1>the guide</1> first", "Lies <2>das</2>")).toBe(false);
  });

  it("accepts the same nestings as English", () => {
    expect(isSafeTranslation("See $t(common:items)", "Voir $t(common:items)")).toBe(true);
    expect(isSafeTranslation("See $t(common:items)", "Voir $t(common:items) $t(x)")).toBe(false);
  });

  it("accepts a bare less-than right before a tag English has", () => {
    // Removing English's own tags must not glue a "<" onto a letter.
    expect(isSafeTranslation(ARCHIVE, "<<strong>{{name}}</strong>?")).toBe(true);
  });

  it("strips every one of English's tags, not just the first", () => {
    expect(isSafeTranslation("<b>a</b> and <i>b</i>", "<i>ב</i> ו<b>א</b>")).toBe(true);
    expect(isSafeTranslation("<strong>{{a}}</strong> <strong>{{b}}</strong>", "<strong>{{b}}</strong>, <strong>{{a}}</strong>")).toBe(true);
  });

  it("keeps a tag English has only when it is the whole token", () => {
    expect(isSafeTranslation("<strong>x</strong>", "<strongx>y</strong>")).toBe(false);
  });

  it("counts nestings and braces exactly, not just their presence", () => {
    expect(isSafeTranslation("$t(a) $t(b)", "$t(a)")).toBe(false);
    expect(isSafeTranslation("$t(a)", "$t(a) $t(a)")).toBe(false);
    expect(isSafeTranslation("{{a}} {{b}}", "{{a}} {{b}} }}")).toBe(false);
    expect(isSafeTranslation("{{a}}", "{{a}} {{b}}")).toBe(true);
  });

  it("accepts balanced braces and plain text", () => {
    expect(isSafeTranslation("{{count}} items", "{{count}} פריטים")).toBe(true);
    expect(isSafeTranslation("Save", "שמור")).toBe(true);
    expect(isSafeTranslation("Save", "")).toBe(true);
  });
});

describe("flattenStrings", () => {
  it("joins nested paths with dots, keeps flat dotted keys and skips non-strings", () => {
    const flat = flattenStrings({
      "actions.save": "Save",
      login: { title: "Sign in", form: { email: "Email" } },
      list: ["a"],
      count: 3,
    });
    expect([...flat.entries()]).toEqual([
      ["actions.save", "Save"],
      ["login.title", "Sign in"],
      ["login.form.email", "Email"],
    ]);
  });

  it("is empty for anything that is not an object", () => {
    expect(flattenStrings(null).size).toBe(0);
    expect(flattenStrings("x").size).toBe(0);
    expect(flattenStrings(["x"]).size).toBe(0);
  });
});

describe("englishSource", () => {
  const english = new Map([
    ["items_one", "{{count}} item"],
    ["items_other", "{{count}} items"],
    ["save", "Save"],
  ]);

  it("answers the key's own English, else its _other plural sibling", () => {
    expect(englishSource("save", english)).toBe("Save");
    expect(englishSource("items_one", english)).toBe("{{count}} item");
    expect(englishSource("items_few", english)).toBe("{{count}} items");
    expect(englishSource("items_zero", english)).toBe("{{count}} items");
    expect(englishSource("items_many", english)).toBe("{{count}} items");
    expect(englishSource("items_two", english)).toBe("{{count}} items");
  });

  it("answers nothing for a key English lacks", () => {
    expect(englishSource("nope", english)).toBeUndefined();
    expect(englishSource("save_few", english)).toBeUndefined();
    expect(englishSource("items_several", english)).toBeUndefined();
  });

  it("takes a plural category only as the key's last part", () => {
    // `items_oneself` is not a plural of `items`.
    expect(englishSource("items_oneself", english)).toBeUndefined();
    expect(englishSource("items_fewer", english)).toBeUndefined();
  });

  it("finds the _other sibling of a base with several parts", () => {
    const nested = new Map([["dashboard.trend.vsDays_other", "vs {{count}} days"]]);
    expect(englishSource("dashboard.trend.vsDays_few", nested)).toBe("vs {{count}} days");
    expect(englishSource("a_b_few", new Map([["a_b_other", "x"]]))).toBe("x");
  });
});

describe("gateResources", () => {
  it("keeps safe strings in their shape and drops unsafe, unknown and empty branches", () => {
    const english = flattenStrings({
      "detail.dialogs.archive.confirm": ARCHIVE,
      "items_other": "{{count}} items",
      login: { title: "Sign in", hint: "Use <strong>SSO</strong>" },
    });
    const gated = gateResources(
      {
        "detail.dialogs.archive.confirm": "Archive <img src=x onerror=alert(1)> <strong>{{name}}</strong>?",
        items_few: "{{count}} פריטים",
        "not.in.english": "x",
        login: { title: "התחברות", hint: "<script>x</script>" },
        empty: { only: "<b>x</b>" },
      },
      english,
    );
    expect(gated).toEqual({ items_few: "{{count}} פריטים", login: { title: "התחברות" } });
  });

  it("matches a flat dotted key against a nested English path", () => {
    const english = flattenStrings({ login: { title: "Sign in" } });
    expect(gateResources({ "login.title": "התחברות" }, english)).toEqual({ "login.title": "התחברות" });
  });

  it("drops a null value instead of descending into it", () => {
    const english = flattenStrings({ login: { title: "Sign in" }, save: "Save" });
    expect(gateResources({ login: null, save: "שמור" }, english)).toEqual({ save: "שמור" });
  });

  it("drops a list instead of descending into it", () => {
    const english = flattenStrings({ save: "Save" });
    expect(gateResources({ save: ["שמור"] }, english)).toEqual({});
  });

  it("drops a branch whose strings were all refused", () => {
    const english = flattenStrings({ login: { title: "Sign in" } });
    expect(gateResources({ login: { title: 7 } }, english)).toEqual({});
  });
});
