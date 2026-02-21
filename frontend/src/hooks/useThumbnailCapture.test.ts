import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("html-to-image", () => ({
  toPng: vi.fn(),
}));

import { toPng } from "html-to-image";
import { useThumbnailCapture } from "./useThumbnailCapture";

describe("useThumbnailCapture", () => {
  it("returns chartRef, thumbnail, and captureAndSave", () => {
    const openDialog = vi.fn();
    const { result } = renderHook(() => useThumbnailCapture(openDialog));

    expect(result.current.chartRef).toBeDefined();
    expect(result.current.thumbnail).toBeUndefined();
    expect(typeof result.current.captureAndSave).toBe("function");
  });

  it("calls openDialog even when no ref element", async () => {
    const openDialog = vi.fn();
    const { result } = renderHook(() => useThumbnailCapture(openDialog));

    await act(async () => {
      await result.current.captureAndSave();
    });

    // openDialog should be called regardless
    expect(openDialog).toHaveBeenCalledOnce();
    // No element to capture, so thumbnail remains undefined
    expect(result.current.thumbnail).toBeUndefined();
  });

  it("captures thumbnail when ref has element", async () => {
    const openDialog = vi.fn();
    vi.mocked(toPng).mockResolvedValueOnce("data:image/png;base64,abc123");

    const { result } = renderHook(() => useThumbnailCapture(openDialog));

    // Simulate a DOM element on the ref
    const fakeDiv = document.createElement("div");
    Object.defineProperty(result.current.chartRef, "current", {
      value: fakeDiv,
      writable: true,
    });

    await act(async () => {
      await result.current.captureAndSave();
    });

    expect(toPng).toHaveBeenCalledWith(fakeDiv, expect.objectContaining({
      cacheBust: true,
      pixelRatio: 1,
    }));
    expect(result.current.thumbnail).toBe("data:image/png;base64,abc123");
    expect(openDialog).toHaveBeenCalledOnce();
  });

  it("sets thumbnail to undefined when capture fails", async () => {
    const openDialog = vi.fn();
    vi.mocked(toPng).mockRejectedValueOnce(new Error("Canvas error"));

    const { result } = renderHook(() => useThumbnailCapture(openDialog));

    const fakeDiv = document.createElement("div");
    Object.defineProperty(result.current.chartRef, "current", {
      value: fakeDiv,
      writable: true,
    });

    await act(async () => {
      await result.current.captureAndSave();
    });

    expect(result.current.thumbnail).toBeUndefined();
    expect(openDialog).toHaveBeenCalledOnce();
  });
});
