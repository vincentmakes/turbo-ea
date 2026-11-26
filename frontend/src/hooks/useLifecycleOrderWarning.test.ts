import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (d?: string | null) => (d ? `<${d}>` : "") }),
}));

import { useLifecycleOrderWarning } from "./useLifecycleOrderWarning";

describe("useLifecycleOrderWarning", () => {
  it("names the later phase dated earlier, through the date format", () => {
    const { result } = renderHook(() =>
      useLifecycleOrderWarning({ active: "2027-06-01", endOfLife: "2027-01-01" }),
    );
    expect(result.current("active")).toBe("After End of Life (<2027-01-01>)");
    expect(result.current("endOfLife")).toBeNull();
    expect(result.current("plan")).toBeNull();
  });

  it("says nothing for phases in order", () => {
    const { result } = renderHook(() =>
      useLifecycleOrderWarning({ plan: "2026-01-01", active: "2027-01-01" }),
    );
    expect(result.current("plan")).toBeNull();
    expect(result.current("active")).toBeNull();
  });
});
