import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { financialAmountFormatter, usePpmFinancials, usePpmSchedule } from "./usePpmFinancials";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  isAbortError: (error: Error) => error.name === "AbortError",
}));

const get = vi.mocked(api.get);

beforeEach(() => get.mockReset());

describe.each([
  ["financials", usePpmFinancials],
  ["schedule", usePpmSchedule],
] as const)("protected %s query", (suffix, read) => {
  it("removes the previous initiative immediately and ignores a late response after denial", async () => {
    let resolveLate: (value: { initiative_id: string }) => void = () => {};
    const late = new Promise<{ initiative_id: string }>((resolve) => {
      resolveLate = resolve;
    });
    const denied = new Error("Forbidden");
    get
      .mockResolvedValueOnce({ initiative_id: "old" })
      .mockImplementationOnce(() => late)
      .mockRejectedValueOnce(denied);
    const { result, rerender } = renderHook(({ id }) => read(id), {
      initialProps: { id: "old" },
    });
    await waitFor(() => expect(result.current.data?.initiative_id).toBe("old"));
    act(() => result.current.refetch());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    rerender({ id: "denied" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBe(denied));
    await act(async () => resolveLate({ initiative_id: "old" }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBe(denied);
    expect(get).toHaveBeenLastCalledWith("/ppm/initiatives/denied/" + suffix, {
      signal: expect.any(AbortSignal),
    });
  });

  it("drops a successful payload from a different initiative", async () => {
    get.mockResolvedValueOnce({ initiative_id: "other" });
    const { result } = renderHook(() => read("active"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
});

describe("financial amounts", () => {
  it("formats authoritative decimal text without conversion to a floating point amount", () => {
    const format = financialAmountFormatter("USD", "en-US");
    expect(format("30.11")).toBe("$30.11");
    expect(format("70.02")).toBe("$70.02");
    expect(format("-0.230")).toBe("-$0.230");
    expect(format("9007199254740993.001")).toBe("$9,007,199,254,740,993.001");
    expect(format(null)).toBe("—");
    expect(financialAmountFormatter("EUR", "it-IT")("12030.04")).toBe("12.030,04\u00a0€");
  });
});
