import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));

import { api } from "@/api/client";
import i18n from "@/i18n";
import {
  invalidateLifecyclePhaseHelp,
  lifecyclePhaseHelpListenerCount,
  phaseHelpText,
  resetLifecyclePhaseHelp,
  useLifecyclePhaseHelp,
} from "./useLifecyclePhaseHelp";

const PATH = "/settings/lifecycle-phase-help";
const HELP = {
  phaseOut: { en: "Being replaced.", de: "Wird abgelöst." },
  active: { de: "Nur Deutsch" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetLifecyclePhaseHelp();
  vi.mocked(api.get).mockReset();
});

afterEach(async () => {
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

describe("phaseHelpText", () => {
  it("prefers the locale, then English, then nothing", () => {
    expect(phaseHelpText(HELP, "phaseOut", "de")).toBe("Wird abgelöst.");
    expect(phaseHelpText(HELP, "phaseOut", "fr")).toBe("Being replaced.");
    expect(phaseHelpText(HELP, "active", "fr")).toBe("");
    expect(phaseHelpText(HELP, "active", "de")).toBe("Nur Deutsch");
    expect(phaseHelpText(HELP, "plan", "en")).toBe("");
  });
});

describe("useLifecyclePhaseHelp", () => {
  it("uses a primed cache without fetching", () => {
    invalidateLifecyclePhaseHelp(HELP);
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    expect(result.current.help).toEqual(HELP);
    expect(result.current.phaseHelp("phaseOut")).toBe("Being replaced.");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches once, sharing the in-flight request between hooks", async () => {
    const gate = deferred<{ phases: typeof HELP }>();
    vi.mocked(api.get).mockReturnValue(gate.promise);

    const a = renderHook(() => useLifecyclePhaseHelp());
    const b = renderHook(() => useLifecyclePhaseHelp());
    expect(a.result.current.phaseHelp("phaseOut")).toBe("");
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(api.get).toHaveBeenCalledWith(PATH);

    await act(async () => {
      gate.resolve({ phases: HELP });
    });
    await waitFor(() => expect(a.result.current.phaseHelp("phaseOut")).toBe("Being replaced."));
    expect(b.result.current.phaseHelp("phaseOut")).toBe("Being replaced.");

    renderHook(() => useLifecyclePhaseHelp());
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("follows the UI language", async () => {
    invalidateLifecyclePhaseHelp(HELP);
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    expect(result.current.phaseHelp("phaseOut")).toBe("Wird abgelöst.");
  });

  it("pushes an admin's save to mounted hooks", () => {
    invalidateLifecyclePhaseHelp({});
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    expect(result.current.phaseHelp("plan")).toBe("");
    act(() => invalidateLifecyclePhaseHelp({ plan: { en: "An idea." } }));
    expect(result.current.phaseHelp("plan")).toBe("An idea.");
  });

  it("ignores a malformed payload and drops malformed entries", () => {
    invalidateLifecyclePhaseHelp({ plan: { en: "Kept" } });
    invalidateLifecyclePhaseHelp(null);
    invalidateLifecyclePhaseHelp(["plan"]);
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    expect(result.current.help).toEqual({ plan: { en: "Kept" } });

    act(() =>
      invalidateLifecyclePhaseHelp({
        plan: "not a map",
        active: { en: 3, de: "", fr: "Actif" },
        phaseIn: {},
      }),
    );
    expect(result.current.help).toEqual({ active: { fr: "Actif" } });
  });

  it("survives a client that throws synchronously", async () => {
    vi.mocked(api.get).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(result.current.help).toEqual({});
  });

  it("keeps no help when the fetch fails, and fetches again later", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(result.current.help).toEqual({});

    vi.mocked(api.get).mockResolvedValueOnce({ phases: HELP });
    // Wait for the failed request to settle before the next mount.
    await act(async () => {});
    const again = renderHook(() => useLifecyclePhaseHelp());
    await waitFor(() => expect(again.result.current.phaseHelp("phaseOut")).toBe("Being replaced."));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("picks up a value primed between the first render and its effect", () => {
    // The earlier effect runs before the hook's own: the cache is filled after
    // the hook read it for its initial state but before it subscribed.
    const { result } = renderHook(() => {
      useEffect(() => {
        invalidateLifecyclePhaseHelp(HELP);
      }, []);
      return useLifecyclePhaseHelp();
    });
    expect(result.current.help).toEqual(HELP);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    invalidateLifecyclePhaseHelp({});
    const before = lifecyclePhaseHelpListenerCount();
    const { unmount } = renderHook(() => useLifecyclePhaseHelp());
    expect(lifecyclePhaseHelpListenerCount()).toBe(before + 1);
    unmount();
    expect(lifecyclePhaseHelpListenerCount()).toBe(before);
  });

  it("survives a client that resolves with nothing", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useLifecyclePhaseHelp());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current.help).toEqual({});
  });
});
