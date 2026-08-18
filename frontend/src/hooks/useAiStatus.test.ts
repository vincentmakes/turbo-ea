import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";

const SAMPLE_STATUS = {
  enabled: true,
  configured: true,
  provider_type: "anthropic",
  enabled_types: ["Application", "ITComponent"],
  running_models: [],
  model: "claude-sonnet-4-6",
  portfolio_insights_enabled: true,
};

describe("useAiStatus", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.resetModules();
  });

  it("fetches AI status on mount", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(SAMPLE_STATUS);

    const { useAiStatus } = await import("./useAiStatus");
    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => {
      expect(result.current.aiStatus.enabled).toBe(true);
      expect(result.current.aiStatus.model).toBe("claude-sonnet-4-6");
    });

    expect(api.get).toHaveBeenCalledWith("/ai/status");
  });

  it("shares a single fetch across concurrent consumers", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(SAMPLE_STATUS);

    const { useAiStatus } = await import("./useAiStatus");
    const a = renderHook(() => useAiStatus());
    const b = renderHook(() => useAiStatus());
    const c = renderHook(() => useAiStatus());

    await waitFor(() => {
      expect(a.result.current.aiStatus.enabled).toBe(true);
      expect(b.result.current.aiStatus.enabled).toBe(true);
      expect(c.result.current.aiStatus.enabled).toBe(true);
    });

    // The whole point of the hook: 3 consumers, 1 GET.
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("falls back to a disabled default on API error", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("network"));

    const { useAiStatus } = await import("./useAiStatus");
    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => {
      expect(result.current.aiStatusLoaded).toBe(true);
    });

    expect(result.current.aiStatus.enabled).toBe(false);
    expect(result.current.aiStatus.configured).toBe(false);
    expect(result.current.aiStatus.enabled_types).toEqual([]);
  });

  it("invalidateAiStatus(value) stamps the cache without refetching", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(SAMPLE_STATUS);

    const { useAiStatus, invalidateAiStatus } = await import("./useAiStatus");
    const { result } = renderHook(() => useAiStatus());

    await waitFor(() => {
      expect(result.current.aiStatus.enabled).toBe(true);
    });

    invalidateAiStatus({
      ...SAMPLE_STATUS,
      enabled: false,
    });

    await waitFor(() => {
      expect(result.current.aiStatus.enabled).toBe(false);
    });

    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe("aiSuggestEnabledFor", () => {
  const load = () => import("./useAiStatus");

  it("enables every card type when no type is explicitly selected (#962)", async () => {
    const { aiSuggestEnabledFor } = await load();
    const status = { ...SAMPLE_STATUS, enabled_types: [] };

    // Matches the backend (`if ai_cfg["enabled_types"] and …`) and the Admin
    // helper text: an empty list means "no per-type restriction".
    expect(aiSuggestEnabledFor(status, "Application")).toBe(true);
    expect(aiSuggestEnabledFor(status, "BusinessCapability")).toBe(true);
  });

  it("restricts to the selected types when the list is non-empty", async () => {
    const { aiSuggestEnabledFor } = await load();

    expect(aiSuggestEnabledFor(SAMPLE_STATUS, "Application")).toBe(true);
    expect(aiSuggestEnabledFor(SAMPLE_STATUS, "BusinessCapability")).toBe(false);
  });

  it("stays off when AI is disabled, unconfigured, or the type is unknown", async () => {
    const { aiSuggestEnabledFor } = await load();

    expect(aiSuggestEnabledFor({ ...SAMPLE_STATUS, enabled: false }, "Application")).toBe(false);
    expect(aiSuggestEnabledFor({ ...SAMPLE_STATUS, configured: false }, "Application")).toBe(false);
    expect(aiSuggestEnabledFor({ ...SAMPLE_STATUS, enabled_types: [] }, undefined)).toBe(false);
    expect(aiSuggestEnabledFor({ ...SAMPLE_STATUS, enabled_types: [] }, "")).toBe(false);
  });
});
