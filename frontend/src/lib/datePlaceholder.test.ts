import { describe, it, expect } from "vitest";
import { datePlaceholder, dateInputLocale } from "./datePlaceholder";

const EN = { day: "dd", month: "mm", year: "yyyy" };

describe("datePlaceholder", () => {
  it.each([
    ["en-US", "mm/dd/yyyy"],
    ["en-GB", "dd/mm/yyyy"],
    ["de-CH", "dd.mm.yyyy"],
    ["zh-CN", "yyyy/mm/dd"],
    ["ko-KR", "yyyy. mm. dd."],
    ["nl-NL", "dd-mm-yyyy"],
  ])("takes order and separators from the locale (%s)", (locale, expected) => {
    expect(datePlaceholder(locale, EN)).toBe(expected);
  });

  it("uses the Gregorian calendar and drops era parts", () => {
    // ar-SA defaults to the Islamic calendar, which would add an era part.
    const out = datePlaceholder("ar-SA", EN);
    expect(out.replace(/[‎‏]/g, "")).toBe("dd/mm/yyyy");
  });

  it("substitutes the translated field labels", () => {
    expect(datePlaceholder("de-DE", { day: "tt", month: "mm", year: "jjjj" })).toBe(
      "tt.mm.jjjj",
    );
    expect(datePlaceholder("zh-CN", { day: "日", month: "月", year: "年" })).toBe("年/月/日");
  });

  it("falls back to ISO order for an unusable locale", () => {
    expect(datePlaceholder("not a locale!", EN)).toBe("yyyy-mm-dd");
  });
});

describe("dateInputLocale", () => {
  it("returns the browser's resolved locale", () => {
    expect(dateInputLocale()).toBe(new Intl.DateTimeFormat().resolvedOptions().locale);
  });
});
