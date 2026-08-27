import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseIsoDate,
  startOfLocalDay,
  toIsoDate,
  toLocalDate,
  todayIsoDate,
} from "./dates";

/**
 * Run a suite with the process timezone pinned.
 *
 * `vi.stubEnv` assigns `process.env.TZ`, which fires V8's
 * `DateTimeConfigurationChangeNotification` and resets the `Date` and `Intl`
 * timezone caches, so both follow immediately. Without a pinned zone these
 * tests pass vacuously on a UTC CI runner — which is exactly why the suite
 * never caught #1016.
 */
function withTimeZone(tz: string) {
  beforeAll(() => vi.stubEnv("TZ", tz));
  afterAll(() => vi.unstubAllEnvs());
}

describe("west of UTC (America/Los_Angeles)", () => {
  withTimeZone("America/Los_Angeles"); // UTC-7 in August — the reporter's zone

  describe("parseIsoDate", () => {
    it("reads a bare date as local midnight on that calendar day", () => {
      const d = parseIsoDate("2026-08-27")!;
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(27);
      expect(d.getHours()).toBe(0);
    });

    it("rejects a full timestamp so its time is never truncated", () => {
      // The anchoring test. A prefix-matching pattern would silently turn
      // every `created_at` into midnight of its UTC day.
      expect(parseIsoDate("2026-08-27T10:00:00Z")).toBeNull();
      expect(parseIsoDate("2026-08-27T10:00:00")).toBeNull();
    });

    it("returns null for absent or non-ISO values", () => {
      expect(parseIsoDate(null)).toBeNull();
      expect(parseIsoDate(undefined)).toBeNull();
      expect(parseIsoDate("")).toBeNull();
      expect(parseIsoDate("27/08/2026")).toBeNull();
      expect(parseIsoDate("nonsense")).toBeNull();
    });

    it("rejects out-of-grammar month and day values, as new Date does", () => {
      expect(parseIsoDate("2026-13-01")).toBeNull();
      expect(parseIsoDate("2026-00-10")).toBeNull();
      expect(parseIsoDate("2026-08-32")).toBeNull();
      expect(parseIsoDate("2026-08-00")).toBeNull();
    });

    it("rolls an impossible in-grammar day forward, as new Date does", () => {
      // Pins the contract: this fixes the timezone and nothing else.
      const d = parseIsoDate("2026-02-31")!;
      expect(d.getMonth()).toBe(2); // March
      expect(d.getDate()).toBe(3);
    });
  });

  describe("toLocalDate", () => {
    it("reads a bare date as the stored calendar day", () => {
      expect(toLocalDate("2026-08-27")!.getDate()).toBe(27);
    });

    it("leaves a full ISO timestamp exactly as new Date parses it", () => {
      expect(toLocalDate("2026-08-27T10:00:00Z")!.getTime()).toBe(
        Date.parse("2026-08-27T10:00:00Z"),
      );
    });

    it("treats an offset-less timestamp as local, per the spec", () => {
      expect(toLocalDate("2026-08-27T10:00:00")!.getHours()).toBe(10);
    });

    it("passes through Date instances and epoch numbers", () => {
      const d = new Date(2026, 7, 27, 13, 45);
      expect(toLocalDate(d)!.getTime()).toBe(d.getTime());
      expect(toLocalDate(d.getTime())!.getTime()).toBe(d.getTime());
    });

    it("returns null for absent or unparseable values", () => {
      expect(toLocalDate(null)).toBeNull();
      expect(toLocalDate(undefined)).toBeNull();
      expect(toLocalDate("")).toBeNull();
      expect(toLocalDate("nope")).toBeNull();
      expect(toLocalDate(new Date("nope"))).toBeNull();
    });
  });

  describe("todayIsoDate", () => {
    it("returns the local calendar day after the UTC date has rolled over", () => {
      // 18:00 PDT is 01:00Z the next day. The old
      // `toISOString().slice(0, 10)` returned "2026-08-28" here.
      expect(todayIsoDate(new Date(2026, 7, 27, 18, 0))).toBe("2026-08-27");
    });

    it("returns a well-formed date with no argument", () => {
      expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("toIsoDate", () => {
    it("uses the local calendar day, not the UTC one", () => {
      expect(toIsoDate(new Date(2026, 7, 27, 23, 30))).toBe("2026-08-27");
    });

    it("zero-pads single-digit months and days", () => {
      expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });

  describe("startOfLocalDay", () => {
    it("snaps to local midnight without mutating the input", () => {
      const input = new Date(2026, 7, 27, 23, 30, 45, 999);
      const out = startOfLocalDay(input);
      expect(out.getDate()).toBe(27);
      expect(out.getHours()).toBe(0);
      expect(out.getMinutes()).toBe(0);
      expect(out.getSeconds()).toBe(0);
      expect(out.getMilliseconds()).toBe(0);
      expect(input.getHours()).toBe(23);
    });
  });
});

describe("east of UTC (Asia/Tokyo)", () => {
  withTimeZone("Asia/Tokyo"); // UTC+9 — guards against over-correcting

  it("still reads a bare date as the stored calendar day", () => {
    expect(parseIsoDate("2026-08-27")!.getDate()).toBe(27);
    expect(toLocalDate("2026-01-01")!.getFullYear()).toBe(2026);
  });

  it("returns the local calendar day before the UTC date has rolled over", () => {
    // 06:00 JST is 21:00Z the previous day, where the old formula gave
    // "2026-08-26".
    expect(todayIsoDate(new Date(2026, 7, 27, 6, 0))).toBe("2026-08-27");
  });
});
