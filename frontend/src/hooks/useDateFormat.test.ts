import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ date_format: "DD MMM YYYY" }) },
}));

import i18n from "@/i18n";
import {
  formatDateTimeWith,
  formatDateWith,
  invalidateDateFormat,
  useDateFormat,
} from "./useDateFormat";

// Fixed reference date: 2026-04-29 14:05 (local time)
const ref = new Date(2026, 3, 29, 14, 5);

describe("formatDateWith", () => {
  it("formats MM/DD/YYYY (US)", () => {
    expect(formatDateWith("MM/DD/YYYY", ref)).toBe("04/29/2026");
  });

  it("formats DD/MM/YYYY (EU)", () => {
    expect(formatDateWith("DD/MM/YYYY", ref)).toBe("29/04/2026");
  });

  it("formats YYYY-MM-DD (ISO)", () => {
    expect(formatDateWith("YYYY-MM-DD", ref)).toBe("2026-04-29");
  });

  it("formats DD MMM YYYY", () => {
    const out = formatDateWith("DD MMM YYYY", ref);
    expect(out).toMatch(/^29 \w+ 2026$/);
  });

  it("formats MMM DD, YYYY", () => {
    const out = formatDateWith("MMM DD, YYYY", ref);
    expect(out).toMatch(/^\w+ 29, 2026$/);
  });

  it("returns empty string for null / undefined / empty / invalid", () => {
    expect(formatDateWith("MM/DD/YYYY", null)).toBe("");
    expect(formatDateWith("MM/DD/YYYY", undefined)).toBe("");
    expect(formatDateWith("MM/DD/YYYY", "")).toBe("");
    expect(formatDateWith("MM/DD/YYYY", "not-a-date")).toBe("");
  });

});

/** Left-to-right / right-to-left marks that `Intl` may wrap a name in. */
const BIDI_MARKS = /[\u200e\u200f]/;

// The month name follows the interface language, never the browser's: before
// the fix an Arabic interface showed "20 Jan 2025", which a right-to-left page
// lays out as "Jan 2025 20". Day and year stay ASCII digits in every language.
describe("month names follow the interface language", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("names the month in Arabic, with ASCII digits and no bidi marks", () => {
    const jan = new Date(2025, 0, 20);
    expect(formatDateWith("DD MMM YYYY", jan, "ar")).toBe("20 يناير 2025");
    expect(formatDateWith("MMM DD, YYYY", jan, "ar")).toBe("يناير 20, 2025");
    const out = formatDateWith("DD MMM YYYY", jan, "ar");
    expect(out).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
    expect(out).not.toMatch(BIDI_MARKS);
  });

  it("names the month in German", () => {
    expect(formatDateWith("DD MMM YYYY", new Date(2025, 11, 3), "de")).toBe("03 Dez 2025");
    expect(formatDateWith("MMM DD, YYYY", new Date(2025, 9, 3), "de")).toBe("Okt 03, 2025");
  });

  it("defaults to the current interface language", async () => {
    const dec = new Date(2025, 11, 3);
    expect(formatDateWith("DD MMM YYYY", dec)).toBe("03 Dec 2025");
    await i18n.changeLanguage("ar");
    expect(formatDateWith("DD MMM YYYY", dec)).toBe("03 ديسمبر 2025");
    expect(formatDateTimeWith("DD MMM YYYY", new Date(2025, 11, 3, 9, 7))).toBe(
      "03 ديسمبر 2025 09:07",
    );
  });

  it("passes the locale through formatDateTimeWith", () => {
    expect(formatDateTimeWith("DD MMM YYYY", new Date(2025, 11, 3, 9, 7), "de")).toBe(
      "03 Dez 2025 09:07",
    );
  });

  it("names a Gregorian month even where the locale's calendar is another", () => {
    // `fa` defaults to the Persian calendar, which would put "Bahman" beside a
    // Gregorian day and year.
    expect(formatDateWith("DD MMM YYYY", new Date(2025, 0, 20), "fa")).toBe("20 ژانویه 2025");
  });

  it("strips the bidi marks Intl wraps a month name in", () => {
    const format = vi.fn(() => "\u200fيناير\u200e");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      return { format } as unknown as Intl.DateTimeFormat;
    });
    expect(formatDateWith("DD MMM YYYY", new Date(2025, 0, 20), "ar")).toBe("20 يناير 2025");
  });

  it("falls back to English for an unusable locale tag instead of throwing", () => {
    expect(formatDateWith("DD MMM YYYY", new Date(2025, 11, 3), "not a locale!")).toBe(
      "03 Dec 2025",
    );
  });
});

describe("useDateFormat", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("re-formats dates when the interface language changes", async () => {
    invalidateDateFormat("DD MMM YYYY");
    const { result } = renderHook(() => useDateFormat());
    const before = result.current.formatDate;
    expect(result.current.formatDate("2025-01-20")).toBe("20 Jan 2025");
    expect(result.current.formatDateTime(new Date(2025, 0, 20, 9, 7))).toBe("20 Jan 2025 09:07");
    expect(result.current.example).toBe("29 Apr 2026");

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(result.current.formatDate).not.toBe(before);
    expect(result.current.formatDate("2025-12-03")).toBe("03 Dez 2025");
    expect(result.current.formatDateTime(new Date(2025, 11, 3, 9, 7))).toBe("03 Dez 2025 09:07");

    // `example` (the admin picker's preview) follows the language too.
    await act(async () => {
      await i18n.changeLanguage("ar");
    });
    expect(result.current.example).toBe("29 أبريل 2026");
  });
});

describe("formatDateTimeWith", () => {
  it("appends HH:mm", () => {
    expect(formatDateTimeWith("YYYY-MM-DD", ref)).toBe("2026-04-29 14:05");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const morning = new Date(2026, 0, 1, 9, 7);
    expect(formatDateTimeWith("DD/MM/YYYY", morning)).toBe("01/01/2026 09:07");
  });

  it("returns empty string for falsy input", () => {
    expect(formatDateTimeWith("MMM DD, YYYY", null)).toBe("");
    expect(formatDateTimeWith("MMM DD, YYYY", undefined)).toBe("");
  });
});

/**
 * Run a suite with the process timezone pinned. Without this the assertions
 * below pass vacuously on a UTC runner — which is why the suite never caught
 * #1016. See `src/lib/dates.test.ts` for the mechanism.
 */
function withTimeZone(tz: string) {
  beforeAll(() => vi.stubEnv("TZ", tz));
  afterAll(() => vi.unstubAllEnvs());
}

// A bare `YYYY-MM-DD` is a calendar day, not an instant. `new Date()` reads it
// as UTC midnight while the formatters read local, so before the fix every
// date-only value rendered one day early everywhere west of UTC (#1016).
// Only the numeric formats are asserted under a pinned zone — they use local
// getters alone, so the expected strings are exact; the month-name formats stay
// in the unpinned block above where they match loosely.
describe("date-only strings west of UTC (#1016)", () => {
  withTimeZone("America/Los_Angeles"); // UTC-7 in August — the reporter's zone

  it("renders the stored calendar day, not the day before", () => {
    expect(formatDateWith("YYYY-MM-DD", "2026-08-27")).toBe("2026-08-27");
    expect(formatDateWith("MM/DD/YYYY", "2026-08-27")).toBe("08/27/2026");
  });

  it("does not slip across a year boundary", () => {
    expect(formatDateWith("DD/MM/YYYY", "2026-01-01")).toBe("01/01/2026");
  });

  it("renders a date-only value at local midnight, not 17:00 the day before", () => {
    expect(formatDateTimeWith("YYYY-MM-DD", "2026-08-27")).toBe(
      "2026-08-27 00:00",
    );
  });

  it("still converts full ISO timestamps to the viewer's local time", () => {
    // The other half of the contract: a timestamp carries its own offset and
    // must keep being shifted into local time.
    expect(formatDateWith("YYYY-MM-DD", "2026-04-29T10:00:00Z")).toBe(
      "2026-04-29", // 03:00 PDT — same day
    );
    expect(formatDateWith("YYYY-MM-DD", "2026-04-29T02:00:00Z")).toBe(
      "2026-04-28", // 19:00 PDT on the 28th — genuinely the previous day
    );
    expect(formatDateTimeWith("YYYY-MM-DD", "2026-04-29T10:00:00Z")).toBe(
      "2026-04-29 03:00",
    );
  });
});

describe("date-only strings east of UTC", () => {
  withTimeZone("Asia/Tokyo"); // UTC+9 — guards against over-correcting

  it("renders the stored calendar day", () => {
    expect(formatDateWith("YYYY-MM-DD", "2026-08-27")).toBe("2026-08-27");
    expect(formatDateWith("MM/DD/YYYY", "2026-01-01")).toBe("01/01/2026");
  });
});
