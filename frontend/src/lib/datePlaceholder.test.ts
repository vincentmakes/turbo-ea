import { describe, it, expect } from "vitest";
import {
  datePlaceholder,
  dateInputLocale,
  datePartOrder,
  formatLocalDate,
  parseLocalDate,
} from "./datePlaceholder";

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

describe("formatLocalDate / parseLocalDate", () => {
  it.each([
    ["en-US", "07/24/2026"],
    ["en-GB", "24/07/2026"],
    ["de-CH", "24.07.2026"],
    ["zh-CN", "2026/07/24"],
    ["ko-KR", "2026. 07. 24."],
    ["nl-NL", "24-07-2026"],
  ])("round-trips in the locale's own order (%s)", (locale, shown) => {
    expect(formatLocalDate("2026-07-24", locale)).toBe(shown);
    expect(parseLocalDate(shown, locale)).toBe("2026-07-24");
  });

  it("keeps Latin digits on display, even for Arabic", () => {
    const shown = formatLocalDate("2026-07-24", "ar-EG");
    expect(shown.replace(/[\u200e\u200f]/g, "")).toMatch(/24\/07\/2026/);
    expect(parseLocalDate(shown, "ar-EG")).toBe("2026-07-24");
  });

  it("reads Arabic-Indic digits typed by the user", () => {
    expect(parseLocalDate("٢٤/٠٧/٢٠٢٦", "ar-EG")).toBe("2026-07-24");
  });

  it("accepts any separator and unpadded day or month", () => {
    expect(parseLocalDate("24/7/2026", "de-CH")).toBe("2026-07-24");
    expect(parseLocalDate(" 1 2 2026 ", "de-CH")).toBe("2026-02-01");
  });

  it("treats blank as a clear and rejects what is not a real date", () => {
    expect(parseLocalDate("   ", "de-CH")).toBe("");
    expect(parseLocalDate("31.02.2026", "de-CH")).toBeNull();
    expect(parseLocalDate("24.07.26", "de-CH")).toBeNull();
    expect(parseLocalDate("24.07", "de-CH")).toBeNull();
    expect(parseLocalDate("tomorrow", "de-CH")).toBeNull();
    expect(parseLocalDate("24a07b2026", "de-CH")).toBeNull();
  });

  it("orders the parts from Intl, never from code", () => {
    expect(datePartOrder("en-US")).toEqual(["month", "day", "year"]);
    expect(datePartOrder("de-DE")).toEqual(["day", "month", "year"]);
    expect(datePartOrder("zh-CN")).toEqual(["year", "month", "day"]);
  });
});
