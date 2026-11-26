import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

const ai = vi.hoisted(() => ({ configured: true, loaded: true }));
vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({
    aiStatus: {
      enabled: true,
      configured: ai.configured,
      enabled_types: [],
      running_models: [],
    },
    aiStatusLoaded: ai.loaded,
  }),
}));

import { api } from "@/api/client";
import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import type { CustomLocale, CustomLocaleDetail, CustomLocaleJob } from "@/types";
import TranslateDialog, { POLL_INTERVAL_MS } from "./TranslateDialog";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

const DETAIL_PATH = "/custom-locales/he";

const HEBREW: CustomLocale = {
  code: "he",
  name: "עברית",
  english_name: "Hebrew",
  rtl: true,
  enabled: true,
  stats: { total: 100, translated: 60, missing: 30, stale: 10 },
  job: null,
};

function job(over: Partial<CustomLocaleJob> = {}): CustomLocaleJob {
  return { status: "running", mode: "missing", total: 40, done: 0, failed: 0, ...over };
}

function detail(over: Partial<CustomLocaleDetail> = {}): CustomLocaleDetail {
  return { ...HEBREW, namespaces: [], ...over };
}

const onClose = vi.fn();
const onFinished = vi.fn();
const onStarted = vi.fn();

function renderDialog(locale: CustomLocale = HEBREW) {
  return renderWithProviders(
    <TranslateDialog locale={locale} onClose={onClose} onStarted={onStarted} onFinished={onFinished} />,
  );
}

function startButton() {
  return screen.getByRole("button", { name: t("customLocales.translate.start") });
}

beforeEach(() => {
  mockApi.reset();
  onClose.mockReset();
  onFinished.mockReset();
  onStarted.mockReset();
  ai.configured = true;
  ai.loaded = true;
  expect(api).toBe(mockApi.api);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TranslateDialog", () => {
  it("counts new and changed strings by default, everything in the other mode", async () => {
    mockApi.on("get", DETAIL_PATH, detail());
    const { user } = renderDialog();
    expect(screen.getByText(t("customLocales.translate.title", { name: "עברית" }))).toBeInTheDocument();
    expect(await screen.findByText(t("customLocales.translate.count", { count: 40 }))).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: t("customLocales.translate.includeManual") }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: t("customLocales.translate.modeAll") }));
    expect(screen.getByText(t("customLocales.translate.count", { count: 100 }))).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: t("customLocales.translate.includeManual") }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("translate-job")).not.toBeInTheDocument();
  });

  it("counts from the fresh detail rather than the list row", async () => {
    mockApi.on(
      "get",
      DETAIL_PATH,
      detail({ stats: { total: 100, translated: 95, missing: 3, stale: 2 } }),
    );
    renderDialog();
    expect(await screen.findByText(t("customLocales.translate.count", { count: 5 }))).toBeInTheDocument();
  });

  it("starts a job for new and changed strings and follows it", async () => {
    let reads = 0;
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    mockApi.on("get", DETAIL_PATH, async () => {
      reads += 1;
      if (reads === 1) return detail();
      await held;
      return detail({ job: job({ done: 4 }) });
    });
    mockApi.on("post", "/custom-locales/he/translate", { job: job() });
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.translate.count", { count: 40 }));
    await user.click(startButton());

    expect(mockApi.callsOf("post", "/custom-locales/he/translate")[0].body).toEqual({
      mode: "missing",
      include_manual: false,
    });
    expect(onStarted).toHaveBeenCalledTimes(1);
    // The started job shows at once, before the next read lands.
    expect(await screen.findByText(t("customLocales.jobStatus.running"))).toBeInTheDocument();
    expect(
      screen.getByText(t("customLocales.translate.progressText", { percent: 0, done: 0, total: 40, failed: 0 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("customLocales.translate.cancelJob") })).toBeEnabled();
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLInputElement).disabled)).toBe(true);
    // The start reads the language again at once.
    release();
    expect(
      await screen.findByText(
        t("customLocales.translate.progressText", { percent: 10, done: 4, total: 40, failed: 0 }),
      ),
    ).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it("sends everything, including hand-made strings when asked", async () => {
    mockApi.on("get", DETAIL_PATH, detail());
    mockApi.on("post", "/custom-locales/he/translate", { job: job({ mode: "all", total: 100 }) });
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.translate.count", { count: 40 }));
    await user.click(screen.getByRole("radio", { name: t("customLocales.translate.modeAll") }));
    await user.click(screen.getByRole("checkbox", { name: t("customLocales.translate.includeManual") }));
    await user.click(startButton());
    expect(mockApi.callsOf("post", "/custom-locales/he/translate")[0].body).toEqual({
      mode: "all",
      include_manual: true,
    });
  });

  it("never sends include_manual for new and changed strings", async () => {
    mockApi.on("get", DETAIL_PATH, detail());
    mockApi.on("post", "/custom-locales/he/translate", { job: job() });
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.translate.count", { count: 40 }));
    await user.click(screen.getByRole("radio", { name: t("customLocales.translate.modeAll") }));
    await user.click(screen.getByRole("checkbox", { name: t("customLocales.translate.includeManual") }));
    await user.click(screen.getByRole("radio", { name: t("customLocales.translate.modeMissing") }));
    await user.click(startButton());
    expect(mockApi.callsOf("post", "/custom-locales/he/translate")[0].body).toEqual({
      mode: "missing",
      include_manual: false,
    });
  });

  it("polls every few seconds while the job runs and reports when it finished", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reads = 0;
    mockApi.on("get", DETAIL_PATH, () => {
      reads += 1;
      return reads < 2
        ? detail({ job: job({ done: 10 }) })
        : detail({ job: job({ status: "completed", done: 38, failed: 2 }) });
    });
    renderDialog({ ...HEBREW, job: job() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toBe(1);
    expect(
      screen.getByText(t("customLocales.translate.progressText", { percent: 25, done: 10, total: 40, failed: 0 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    });
    expect(reads).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toBe(2);
    expect(screen.getByText(t("customLocales.jobStatus.completed"))).toBeInTheDocument();
    expect(
      screen.getByText(t("customLocales.translate.progressText", { percent: 95, done: 38, total: 40, failed: 2 })),
    ).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(startButton()).toBeInTheDocument();

    // Finished: no more reads.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(reads).toBe(2);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("never starts a read while the previous one is still out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reads = 0;
    let release!: () => void;
    mockApi.on("get", DETAIL_PATH, async () => {
      reads += 1;
      if (reads === 2) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      return detail({ job: job({ done: reads }) });
    });
    renderDialog({ ...HEBREW, job: job() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(reads).toBe(2);
    // The second read is slow: no third read is armed meanwhile.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(reads).toBe(2);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText(t("customLocales.translate.progressText", { percent: 5, done: 2, total: 40, failed: 0 })),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(reads).toBe(3);
  });

  it("explains that nothing can be sent while the server has no English catalogue", async () => {
    mockApi.on("get", DETAIL_PATH, detail({ stats: null }));
    renderDialog({ ...HEBREW, stats: null });
    expect(screen.getByText(t("customLocales.errors.catalog_unavailable"))).toBeInTheDocument();
    expect(screen.getByText(t("customLocales.translate.count", { count: 0 }))).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", DETAIL_PATH)).toHaveLength(1));
    expect(startButton()).toBeDisabled();
  });

  it("follows the fresh detail when it loses its stats", async () => {
    mockApi.on("get", DETAIL_PATH, detail({ stats: null }));
    renderDialog();
    expect(await screen.findByText(t("customLocales.errors.catalog_unavailable"))).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("stops polling when the dialog closes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reads = 0;
    mockApi.on("get", DETAIL_PATH, () => {
      reads += 1;
      return detail({ job: job() });
    });
    const { unmount } = renderDialog({ ...HEBREW, job: job() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toBe(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(reads).toBe(1);
  });

  it("waits a whole interval between reads even when a read is slow to land", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let reads = 0;
    mockApi.on("get", DETAIL_PATH, () => {
      reads += 1;
      return detail({ job: job() });
    });
    renderDialog({ ...HEBREW, job: job() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 2; i <= 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(reads).toBe(i);
    }
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not report a finish for a job it never saw running", async () => {
    mockApi.on("get", DETAIL_PATH, detail({ job: job({ status: "failed", error: "Provider timed out" }) }));
    renderDialog();
    expect(await screen.findByText(t("customLocales.jobStatus.failed"))).toBeInTheDocument();
    expect(screen.getByTestId("translate-job-error")).toHaveTextContent(/^Provider timed out$/);
    expect(screen.getByTestId("translate-job-error").closest(".MuiAlert-root")).toHaveTextContent(
      `${t("customLocales.translate.providerAnswered")} Provider timed out`,
    );
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("shows an indeterminate bar while a running job has not counted its strings", async () => {
    mockApi.on("get", DETAIL_PATH, detail({ job: job({ total: 0 }) }));
    renderDialog({ ...HEBREW, job: job({ total: 0 }) });
    await waitFor(() => expect(mockApi.callsOf("get", DETAIL_PATH)).toHaveLength(1));
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    // No number while nothing is counted: never "0%" or "NaN%".
    expect(screen.queryByTestId("translate-progress-text")).toBeNull();
    expect(screen.getByTestId("translate-job")).not.toHaveTextContent(/%/);
  });

  it("shows the share done, with grouped counts, for a job half-way through", async () => {
    const mid = job({ total: 7488, done: 3150, failed: 12 });
    mockApi.on("get", DETAIL_PATH, detail({ job: mid }));
    renderDialog({ ...HEBREW, job: mid });
    const text = await screen.findByTestId("translate-progress-text");
    expect(text).toHaveTextContent(/^42% — 3,150 of 7,488 strings, 12 failed$/);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("shows 100% for a finished job", async () => {
    const done = job({ status: "completed", total: 7488, done: 7488, failed: 0 });
    mockApi.on("get", DETAIL_PATH, detail({ job: done }));
    renderDialog({ ...HEBREW, job: done });
    expect(await screen.findByTestId("translate-progress-text")).toHaveTextContent(
      /^100% — 7,488 of 7,488 strings, 0 failed$/,
    );
  });

  it("groups counts the way the interface language does", async () => {
    const mid = job({ total: 7488, done: 3150, failed: 1200 });
    mockApi.on("get", DETAIL_PATH, detail({ job: mid }));
    await act(() => i18n.changeLanguage("de"));
    try {
      renderDialog({ ...HEBREW, job: mid });
      const text = await screen.findByTestId("translate-progress-text");
      expect(text).toHaveTextContent("3.150");
      expect(text).toHaveTextContent("7.488");
      expect(text).toHaveTextContent("1.200");
    } finally {
      await act(() => i18n.changeLanguage("en"));
    }
  });

  it("cancels a running job", async () => {
    mockApi.on("get", DETAIL_PATH, detail({ job: job() }));
    mockApi.on("post", "/custom-locales/he/translate/cancel", {
      job: job({ status: "cancelled", done: 12 }),
    });
    const { user } = renderDialog({ ...HEBREW, job: job() });
    await user.click(screen.getByRole("button", { name: t("customLocales.translate.cancelJob") }));
    expect(await screen.findByText(t("customLocales.jobStatus.cancelled"))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/custom-locales/he/translate/cancel")).toHaveLength(1);
    expect(startButton()).toBeInTheDocument();
  });

  it("explains a failed cancel", async () => {
    mockApi.on("get", DETAIL_PATH, detail({ job: job() }));
    mockApi.fail("post", "/custom-locales/he/translate/cancel", 500);
    const { user } = renderDialog({ ...HEBREW, job: job() });
    await user.click(screen.getByRole("button", { name: t("customLocales.translate.cancelJob") }));
    expect(await screen.findByText(t("customLocales.translate.cancelFailed"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("customLocales.translate.cancelJob") })).toBeEnabled();
  });

  it("is unavailable, with the reason, while no AI provider is configured", async () => {
    ai.configured = false;
    mockApi.on("get", DETAIL_PATH, detail());
    renderDialog();
    expect(screen.getByText(t("customLocales.translate.notConfigured"))).toBeInTheDocument();
    await screen.findByText(t("customLocales.translate.count", { count: 40 }));
    expect(startButton()).toBeDisabled();
  });

  it("says nothing about the provider before its status is known", () => {
    ai.configured = false;
    ai.loaded = false;
    mockApi.on("get", DETAIL_PATH, detail());
    renderDialog();
    expect(screen.queryByText(t("customLocales.translate.notConfigured"))).not.toBeInTheDocument();
  });

  it("has nothing to start when every string is translated", async () => {
    mockApi.on(
      "get",
      DETAIL_PATH,
      detail({ stats: { total: 100, translated: 100, missing: 0, stale: 0 } }),
    );
    renderDialog();
    await screen.findByText(t("customLocales.translate.count", { count: 0 }));
    expect(startButton()).toBeDisabled();
  });

  it.each([
    [409, "job_running", "customLocales.errors.job_running"],
    [400, "ai_not_configured", "customLocales.errors.ai_not_configured"],
    [500, "boom", "customLocales.translate.startFailed"],
  ])("explains a refused start (%i %s)", async (status, detailCode, key) => {
    mockApi.on("get", DETAIL_PATH, detail());
    mockApi.fail("post", "/custom-locales/he/translate", status, detailCode);
    const { user } = renderDialog();
    await screen.findByText(t("customLocales.translate.count", { count: 40 }));
    await user.click(startButton());
    expect(await screen.findByText(t(key))).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("translate-job")).not.toBeInTheDocument();
  });

  it("closes on Close", () => {
    mockApi.on("get", DETAIL_PATH, detail());
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: tc("actions.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
