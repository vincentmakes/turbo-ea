/**
 * `useCustomLocales` — the enabled custom languages for the pickers. Each test
 * re-imports fresh modules because the hook memoises at module level.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";

const HEBREW = { code: "he", name: "עברית", rtl: true, hash: "h1" };
const THAI = { code: "th", name: "ไทย", rtl: false, hash: "t1" };

async function fresh() {
  vi.resetModules();
  const hook = await import("./useCustomLocales");
  const registry = await import("@/i18n/customLocales");
  const i18nIndex = await import("@/i18n");
  return { hook, registry, i18nIndex };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
});

describe("sanitizeCustomLocales", () => {
  it("keeps well-formed entries and never a built-in code", async () => {
    const { hook } = await fresh();
    expect(
      hook.sanitizeCustomLocales([
        HEBREW,
        null,
        "he",
        { name: "no code" },
        { code: "" },
        { code: 5 },
        { code: "de", name: "Deutsch", rtl: false, hash: "x" },
        { code: "hi", name: "", rtl: "true", hash: 9 },
        { code: "th", name: 7 },
      ]),
    ).toEqual([
      HEBREW,
      { code: "hi", name: "hi", rtl: false, hash: "" },
      { code: "th", name: "th", rtl: false, hash: "" },
    ]);
  });

  it("answers an empty list for anything that is not a list", async () => {
    const { hook } = await fresh();
    expect(hook.sanitizeCustomLocales(undefined)).toEqual([]);
    expect(hook.sanitizeCustomLocales({ code: "he" })).toEqual([]);
  });
});

describe("useCustomLocales", () => {
  it("reads the bootstrap list when nothing primed it, and registers each language", async () => {
    const { hook, registry, i18nIndex } = await fresh();
    vi.mocked(api.get).mockResolvedValueOnce({ custom_locales: [HEBREW, THAI] });
    const { result } = renderHook(() => hook.useCustomLocales());
    expect(result.current.customLocales).toEqual([]);
    await waitFor(() => expect(result.current.customLocales).toEqual([HEBREW, THAI]));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("/settings/bootstrap");
    expect(registry.localeLabel("he")).toBe("עברית");
    expect(i18nIndex.isRtlLocale("he")).toBe(true);
    expect(i18nIndex.isRtlLocale("th")).toBe(false);
  });

  it("shares one read between consumers that mount together", async () => {
    const { hook } = await fresh();
    const reply = deferred<unknown>();
    vi.mocked(api.get).mockReturnValueOnce(reply.promise as Promise<never>);
    const a = renderHook(() => hook.useCustomLocales());
    const b = renderHook(() => hook.useCustomLocales());
    reply.resolve({ custom_locales: [THAI] });
    await waitFor(() => expect(a.result.current.customLocales).toEqual([THAI]));
    expect(b.result.current.customLocales).toEqual([THAI]);
    expect(api.get).toHaveBeenCalledTimes(1);

    // A later consumer takes the cached list without a request.
    const c = renderHook(() => hook.useCustomLocales());
    expect(c.result.current.customLocales).toEqual([THAI]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("settles on an empty list when the read fails, and does not read again", async () => {
    const { hook } = await fresh();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => hook.useCustomLocales());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current.customLocales).toEqual([]);
    renderHook(() => hook.useCustomLocales());
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("reads an empty list from a reply without the field", async () => {
    const { hook } = await fresh();
    vi.mocked(api.get).mockResolvedValueOnce(undefined);
    renderHook(() => hook.useCustomLocales());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await act(async () => {});
    vi.mocked(api.get).mockResolvedValueOnce({ custom_locales: [HEBREW] });
    // Cached as empty: a new consumer does not read again.
    const { result } = renderHook(() => hook.useCustomLocales());
    expect(result.current.customLocales).toEqual([]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("takes a primed list without a request and pushes later primes to mounted consumers", async () => {
    const { hook, registry } = await fresh();
    hook.invalidateCustomLocales([HEBREW]);
    const { result } = renderHook(() => hook.useCustomLocales());
    expect(result.current.customLocales).toEqual([HEBREW]);
    expect(api.get).not.toHaveBeenCalled();

    act(() => hook.invalidateCustomLocales([THAI]));
    expect(result.current.customLocales).toEqual([THAI]);
    expect(registry.localeLabel("th")).toBe("ไทย");
  });

  it("does not throw when the client answers nothing at all", async () => {
    const { hook } = await fresh();
    vi.mocked(api.get).mockImplementationOnce((() => {
      throw new Error("sync");
    }) as never);
    const { result } = renderHook(() => hook.useCustomLocales());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current.customLocales).toEqual([]);
  });

  it("stops notifying a consumer once it unmounts", async () => {
    const { hook } = await fresh();
    hook.invalidateCustomLocales([HEBREW]);
    const mounted = renderHook(() => hook.useCustomLocales());
    const gone = renderHook(() => hook.useCustomLocales());
    gone.unmount();
    act(() => hook.invalidateCustomLocales([THAI]));
    expect(mounted.result.current.customLocales).toEqual([THAI]);
    expect(gone.result.current.customLocales).toEqual([HEBREW]);
  });
});
