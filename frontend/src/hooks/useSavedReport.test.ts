import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";
import { useSavedReport } from "./useSavedReport";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(MemoryRouter, null, children);

const wrapperWithSavedId = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    MemoryRouter,
    { initialEntries: ["/?saved_report_id=sr-123"] },
    children,
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useSavedReport", () => {
  it("returns initial state with no saved config", () => {
    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper,
    });

    expect(result.current.savedReport).toBeNull();
    expect(result.current.savedReportName).toBeNull();
    expect(result.current.saveDialogOpen).toBe(false);
    expect(result.current.reportType).toBe("portfolio");
  });

  it("consumeConfig returns null when no config exists", () => {
    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper,
    });

    const config = result.current.consumeConfig();
    expect(config).toBeNull();
  });

  it("consumeConfig returns localStorage config when available", () => {
    localStorage.setItem(
      "turboea-report:portfolio",
      JSON.stringify({ x_axis: "cost" }),
    );

    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper,
    });

    const config = result.current.consumeConfig();
    expect(config).toEqual({ x_axis: "cost" });
  });

  it("consumeConfig returns config only once", () => {
    localStorage.setItem(
      "turboea-report:portfolio",
      JSON.stringify({ x_axis: "cost" }),
    );

    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper,
    });

    const first = result.current.consumeConfig();
    expect(first).toEqual({ x_axis: "cost" });

    const second = result.current.consumeConfig();
    expect(second).toBeNull();
  });

  it("persistConfig saves to localStorage after consumeConfig", () => {
    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper,
    });

    // Before consumeConfig, persistConfig should be a no-op
    act(() => {
      result.current.persistConfig({ x_axis: "risk" });
    });
    expect(localStorage.getItem("turboea-report:portfolio")).toBeNull();

    // After consumeConfig, it should work
    result.current.consumeConfig();
    act(() => {
      result.current.persistConfig({ x_axis: "risk" });
    });
    expect(
      JSON.parse(localStorage.getItem("turboea-report:portfolio")!),
    ).toEqual({ x_axis: "risk" });
  });

  it("resetAll clears localStorage", () => {
    localStorage.setItem(
      "turboea-report:portfolio",
      JSON.stringify({ x_axis: "cost" }),
    );

    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper,
    });

    act(() => {
      result.current.resetAll();
    });

    expect(localStorage.getItem("turboea-report:portfolio")).toBeNull();
  });

  it("fetches saved report from API when URL has saved_report_id", async () => {
    const mockReport = {
      id: "sr-123",
      name: "My Report",
      config: { x_axis: "cost", y_axis: "risk" },
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockReport);

    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper: wrapperWithSavedId,
    });

    await waitFor(() => {
      expect(result.current.savedReport).not.toBeNull();
    });

    expect(api.get).toHaveBeenCalledWith("/saved-reports/sr-123");
    expect(result.current.savedReportName).toBe("My Report");
  });

  it("URL saved report takes precedence over localStorage", async () => {
    localStorage.setItem(
      "turboea-report:portfolio",
      JSON.stringify({ x_axis: "local" }),
    );

    const mockReport = {
      id: "sr-123",
      name: "My Report",
      config: { x_axis: "api_value" },
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockReport);

    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper: wrapperWithSavedId,
    });

    await waitFor(() => {
      expect(result.current.loadedConfig).not.toBeNull();
    });

    const config = result.current.consumeConfig();
    expect(config).toEqual({ x_axis: "api_value" });
  });

  it("handles API fetch failure gracefully", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("Not found"));

    const { result } = renderHook(() => useSavedReport("portfolio"), {
      wrapper: wrapperWithSavedId,
    });

    // Wait for the effect to settle
    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(result.current.savedReport).toBeNull();
  });
});
