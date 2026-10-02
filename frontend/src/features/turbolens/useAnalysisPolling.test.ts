import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { useAnalysisPolling } from "./useAnalysisPolling";

/** Mirrors `POLL_INTERVAL_MS` in the hook. */
const POLL_MS = 3_000;
const RUNS = /^\/turbolens\/analysis-runs\//;

function runPath(id: string): string {
  return `/turbolens/analysis-runs/${id}`;
}

function analysisRun(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, status, analysis_type: "vendors", ...extra };
}

/** Answer the run endpoint with one status per request, repeating the last one. */
function statusSequence(id: string, statuses: string[]) {
  let i = 0;
  mockApi.on("get", runPath(id), () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return analysisRun(id, status);
  });
}

function requestedPaths(): string[] {
  return mockApi.callsOf("get").map((c) => c.path);
}

async function tick(ms = POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockApi.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAnalysisPolling", () => {
  it("is idle until startPolling is called", () => {
    const { result } = renderHook(() => useAnalysisPolling());

    expect(result.current.polling).toBe(false);
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("checks the run immediately, then every 3 s while it is running", async () => {
    mockApi.on("get", RUNS, analysisRun("r1", "running"));
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });

    // The first check does not wait for the interval.
    expect(result.current.polling).toBe(true);
    expect(requestedPaths()).toEqual([runPath("r1")]);

    await tick(POLL_MS - 1);
    expect(mockApi.callsOf("get")).toHaveLength(1);

    await tick(1);
    expect(mockApi.callsOf("get")).toHaveLength(2);

    await tick(POLL_MS * 2);
    expect(mockApi.callsOf("get")).toHaveLength(4);
    expect(requestedPaths().every((p) => p === runPath("r1"))).toBe(true);

    // Still running: nothing has been reported and the loop is alive.
    expect(result.current.polling).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops and calls onComplete once the run is completed", async () => {
    statusSequence("r1", ["running", "running", "completed"]);
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });
    await tick();
    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.polling).toBe(true);

    await tick();
    expect(mockApi.callsOf("get")).toHaveLength(3);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.polling).toBe(false);

    // The interval is gone: no further request however long we wait.
    await tick(POLL_MS * 5);
    expect(mockApi.callsOf("get")).toHaveLength(3);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("treats any status other than running as finished", async () => {
    // The hook only distinguishes `failed` and `running`; everything else
    // (`completed`, but also an unknown value) ends the loop as a success.
    mockApi.on("get", RUNS, analysisRun("r1", "cancelled"));
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.polling).toBe(false);
  });

  it("reports a failed run through onError with the server's message, then onComplete", async () => {
    mockApi.on("get", RUNS, analysisRun("r1", "failed", { error_message: "LLM timed out" }));
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("LLM timed out");
    // A failed run still fires onComplete so the caller reloads whatever
    // partial results the backend persisted.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError.mock.invocationCallOrder[0]).toBeLessThan(onComplete.mock.invocationCallOrder[0]);
    expect(result.current.polling).toBe(false);

    await tick(POLL_MS * 3);
    expect(mockApi.callsOf("get")).toHaveLength(1);
  });

  it("falls back to a generic message when a failed run carries none", async () => {
    mockApi.on("get", RUNS, analysisRun("r1", "failed", { error_message: null }));
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(undefined, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(i18n.t("admin:turbolens_analysis_failed"));
    expect(result.current.polling).toBe(false);
  });

  it("stops and reports a lost connection when the request fails", async () => {
    mockApi.fail("get", RUNS, 503, "upstream down");
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(i18n.t("admin:turbolens_polling_lost_connection"));
    // Unlike a failed run, a transport error does not fire onComplete.
    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.polling).toBe(false);

    await tick(POLL_MS * 3);
    expect(mockApi.callsOf("get")).toHaveLength(1);
  });

  it("works without callbacks", async () => {
    statusSequence("r1", ["running", "failed"]);
    const { result } = renderHook(() => useAnalysisPolling());

    await act(async () => {
      result.current.startPolling("r1");
    });
    await tick();

    expect(result.current.polling).toBe(false);
    expect(mockApi.callsOf("get")).toHaveLength(2);
  });

  it("stopPolling clears the interval without firing any callback", async () => {
    mockApi.on("get", RUNS, analysisRun("r1", "running"));
    const onComplete = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete, onError));

    await act(async () => {
      result.current.startPolling("r1");
    });
    await tick();
    expect(mockApi.callsOf("get")).toHaveLength(2);

    act(() => {
      result.current.stopPolling();
    });
    expect(result.current.polling).toBe(false);

    await tick(POLL_MS * 4);
    expect(mockApi.callsOf("get")).toHaveLength(2);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("stopPolling is a no-op when nothing is being polled", () => {
    const { result } = renderHook(() => useAnalysisPolling());

    act(() => {
      result.current.stopPolling();
    });

    expect(result.current.polling).toBe(false);
    expect(mockApi.callsOf("get")).toHaveLength(0);
  });

  it("makes no request after unmount", async () => {
    mockApi.on("get", RUNS, analysisRun("r1", "running"));
    const { result, unmount } = renderHook(() => useAnalysisPolling());

    await act(async () => {
      result.current.startPolling("r1");
    });
    await tick();
    expect(mockApi.callsOf("get")).toHaveLength(2);

    unmount();

    await tick(POLL_MS * 4);
    expect(mockApi.callsOf("get")).toHaveLength(2);
  });

  it("reattaches to a run id obtained elsewhere, such as the active-runs resume", async () => {
    // ComplianceScanner reads `/compliance/active-runs` after a refresh and
    // hands the still-running id to startPolling; the hook does not care where
    // the id came from.
    statusSequence("resumed-run", ["running", "completed"]);
    const onComplete = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete));

    await act(async () => {
      result.current.startPolling("resumed-run");
    });
    expect(requestedPaths()).toEqual([runPath("resumed-run")]);
    expect(result.current.polling).toBe(true);

    await tick();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(result.current.polling).toBe(false);
  });

  it("restarting with a new id replaces the previous loop instead of adding to it", async () => {
    mockApi.on("get", RUNS, (path) => analysisRun(path.split("/").pop() ?? "", "running"));
    const { result } = renderHook(() => useAnalysisPolling());

    await act(async () => {
      result.current.startPolling("a");
    });
    await tick();
    expect(requestedPaths()).toEqual([runPath("a"), runPath("a")]);

    await act(async () => {
      result.current.startPolling("b");
    });
    expect(requestedPaths().at(-1)).toBe(runPath("b"));
    expect(result.current.polling).toBe(true);

    const before = mockApi.callsOf("get").length;
    await tick(POLL_MS * 2);
    // One request per tick, all for the new id: the old interval is gone.
    const since = requestedPaths().slice(before);
    expect(since).toEqual([runPath("b"), runPath("b")]);
  });

  it("calls the latest callbacks, not the ones passed on the first render", async () => {
    statusSequence("r1", ["running", "completed"]);
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useAnalysisPolling(cb), {
      initialProps: { cb: first },
    });

    await act(async () => {
      result.current.startPolling("r1");
    });
    rerender({ cb: second });
    await tick();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("returns stable startPolling / stopPolling references across renders", () => {
    const { result, rerender } = renderHook(() => useAnalysisPolling());
    const { startPolling, stopPolling } = result.current;

    rerender();

    expect(result.current.startPolling).toBe(startPolling);
    expect(result.current.stopPolling).toBe(stopPolling);
  });

  it("ignores a late reply for a run that has since been superseded", async () => {
    // `check` captures its run id; a reply for run A landing after
    // startPolling("b") must neither stop B's loop nor report A as finished.
    let resolveA: (value: unknown) => void = () => {};
    mockApi.on("get", runPath("a"), () => new Promise((resolve) => (resolveA = resolve)));
    mockApi.on("get", runPath("b"), analysisRun("b", "running"));
    const onComplete = vi.fn();
    const { result } = renderHook(() => useAnalysisPolling(onComplete));

    await act(async () => {
      result.current.startPolling("a");
    });
    await act(async () => {
      result.current.startPolling("b");
    });
    expect(result.current.polling).toBe(true);
    expect(requestedPaths()).toEqual([runPath("a"), runPath("b")]);

    await act(async () => {
      resolveA(analysisRun("a", "completed"));
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.polling).toBe(true);
    await tick(POLL_MS * 2);
    expect(mockApi.callsOf("get", runPath("b"))).toHaveLength(3);
  });
});
