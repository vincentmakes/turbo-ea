import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FullscreenPanel from "./FullscreenPanel";

describe("FullscreenPanel", () => {
  it("renders the fullscreen control tooltip within the fullscreen surface", async () => {
    render(<FullscreenPanel label="Fullscreen"><div>chart</div></FullscreenPanel>);
    const host = screen.getByTestId("fullscreen-panel");
    Object.defineProperty(document, "fullscreenElement", { value: host, configurable: true });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    fireEvent.mouseOver(screen.getByRole("button", { name: /exit fullscreen/i }));
    expect(host).toContainElement(await screen.findByRole("tooltip"));
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  });
  it("keeps the overlay container stable when entering and exiting fullscreen", async () => {
    const onContainerChange = vi.fn();
    const view = render(<FullscreenPanel label="Fullscreen" onContainerChange={onContainerChange}><div>chart</div></FullscreenPanel>);
    const panel = screen.getByTestId("fullscreen-panel");
    expect(onContainerChange).toHaveBeenLastCalledWith(panel);
    Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    await act(async () => document.dispatchEvent(new Event("fullscreenchange")));
    expect(onContainerChange).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(onContainerChange).toHaveBeenLastCalledWith(null);
  });
  it("calls requestFullscreen on click when not fullscreen", async () => {
    const user = userEvent.setup();
    const requestFullscreen = vi.fn();
    render(
      <FullscreenPanel label="Fullscreen">
        <div>chart</div>
      </FullscreenPanel>,
    );
    const btn = screen.getByRole("button", { name: "Fullscreen" });
    const panel = screen.getByTestId("fullscreen-panel") as HTMLElement & {
      requestFullscreen: () => void;
    };
    panel.requestFullscreen = requestFullscreen;
    await user.click(btn);
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it("calls exitFullscreen when document.fullscreenElement is the panel", async () => {
    const user = userEvent.setup();
    const exitFullscreen = vi.fn();
    document.exitFullscreen = exitFullscreen;
    render(
      <FullscreenPanel label="Fullscreen">
        <div>chart</div>
      </FullscreenPanel>,
    );
    const panel = screen.getByTestId("fullscreen-panel");
    Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
    const exitBtn = await screen.findByRole("button", { name: /exit fullscreen/i });
    await user.click(exitBtn);
    expect(exitFullscreen).toHaveBeenCalled();
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  });

  it("passes isFullscreen to a function child and fills the screen", async () => {
    const seen: boolean[] = [];
    render(
      <FullscreenPanel label="Fullscreen">
        {(isFullscreen) => {
          seen.push(isFullscreen);
          return <div>chart</div>;
        }}
      </FullscreenPanel>,
    );
    const panel = screen.getByTestId("fullscreen-panel");
    expect(seen[seen.length - 1]).toBe(false);
    expect(getComputedStyle(panel).height).not.toBe("100vh");

    Object.defineProperty(document, "fullscreenElement", { value: panel, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(seen[seen.length - 1]).toBe(true);
    expect(getComputedStyle(panel).height).toBe("100vh");
    expect(getComputedStyle(panel).display).toBe("flex");

    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(seen[seen.length - 1]).toBe(false);
  });
});
