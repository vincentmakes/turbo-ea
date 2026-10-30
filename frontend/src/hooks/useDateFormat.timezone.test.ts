/**
 * The date formatters under a pinned process timezone (#1016). These live
 * apart from `useDateFormat.test.ts` because `vi.stubEnv("TZ")` cannot work
 * in Stryker's worker threads, so the mutation run leaves out every file that
 * pins a zone (`vitest.stryker.config.ts`); kept here, they cost the rest of
 * the hook's tests nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ date_format: "DD MMM YYYY" }) },
}));

import { formatDateTimeWith, formatDateWith } from "./useDateFormat";

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
