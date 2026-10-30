/**
 * The `useDateFormat` test double follows the interface language like the
 * real hook: the locale it formats with is the one current when it is called.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import i18n from "@/i18n";
import { formatDateWith, useDateFormat } from "@/hooks/useDateFormat";
import { hookState } from "./hooks";

afterEach(async () => {
  hookState.reset();
  await i18n.changeLanguage("en");
});

describe("useDateFormatModule", () => {
  it("names the month in the current interface language", async () => {
    hookState.dateFormat = "DD MMM YYYY";
    const day = new Date(2026, 2, 5, 12);
    expect(useDateFormat().formatDate(day)).toBe("05 Mar 2026");

    await i18n.changeLanguage("de");
    const de = formatDateWith("DD MMM YYYY", day, "de");
    // German really differs, so a stale English name cannot pass for it.
    expect(de).not.toBe("05 Mar 2026");
    expect(useDateFormat().formatDate(day)).toBe(de);
    expect(useDateFormat().formatDateTime(day)).toBe(`${de} 12:00`);
  });

  it("keeps the workspace format and the real pure helpers", () => {
    hookState.dateFormat = "YYYY-MM-DD";
    const hook = useDateFormat();
    expect(hook.dateFormat).toBe("YYYY-MM-DD");
    expect(hook.loading).toBe(false);
    expect(hook.formatDate("2026-03-05")).toBe("2026-03-05");
    expect(formatDateWith("MM/DD/YYYY", "2026-03-05")).toBe("03/05/2026");
  });
});
