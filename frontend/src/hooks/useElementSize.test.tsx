import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { installResizeObserver, stubRectsBySelector } from "@/test/dom";
import { useElementSize } from "./useElementSize";

/** Prints the measured size, or "unmeasured". */
function Probe() {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} className="probe" data-testid="probe">
      {size ? `${size.width}x${size.height}` : "unmeasured"}
    </div>
  );
}

let restores: (() => void)[] = [];
afterEach(() => {
  restores.forEach((r) => r());
  restores = [];
});

describe("useElementSize", () => {
  it("stays unmeasured where ResizeObserver does not exist", () => {
    expect(typeof ResizeObserver).toBe("undefined");
    restores.push(stubRectsBySelector({ ".probe": [{ width: 300, height: 100 }] }));
    render(<Probe />);
    // Not even the box read on mount: without an observer it could never update.
    expect(screen.getByTestId("probe")).toHaveTextContent("unmeasured");
  });

  it("watches the element the ref is attached to", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    render(<Probe />);
    expect(ro.observed).toEqual([screen.getByTestId("probe")]);
  });

  it("reports the contentRect size once the observer fires, and every change after", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    render(<Probe />);
    // jsdom's box is 0 × 0, which says nothing yet.
    expect(screen.getByTestId("probe")).toHaveTextContent("unmeasured");
    act(() => ro.resize({ width: 1180, height: 450 }));
    expect(screen.getByTestId("probe")).toHaveTextContent("1180x450");
    act(() => ro.resize({ width: 640, height: 0 }));
    expect(screen.getByTestId("probe")).toHaveTextContent("640x0");
  });

  it("starts from the element's box on mount when it has one", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    restores.push(stubRectsBySelector({ ".probe": [{ width: 300, height: 100 }] }));
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("300x100");
  });

  it("takes a box with only a height as measured", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    restores.push(stubRectsBySelector({ ".probe": [{ width: 0, height: 40 }] }));
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("0x40");
  });

  it("keeps the same size object when a resize reports the same size", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    const seen: unknown[] = [];
    function Recorder() {
      const [ref, size] = useElementSize<HTMLDivElement>();
      seen.push(size);
      return <div ref={ref} />;
    }
    render(<Recorder />);
    act(() => ro.resize({ width: 10, height: 20 }));
    const first = seen[seen.length - 1];
    expect(first).toEqual({ width: 10, height: 20 });
    act(() => ro.resize({ width: 10, height: 20 }));
    // The same object, so a memo keyed on it is not rebuilt.
    expect(seen[seen.length - 1]).toBe(first);
    act(() => ro.resize({ width: 11, height: 20 }));
    expect(seen[seen.length - 1]).toEqual({ width: 11, height: 20 });
    act(() => ro.resize({ width: 11, height: 21 }));
    expect(seen[seen.length - 1]).toEqual({ width: 11, height: 21 });
  });

  it("reads the last entry of a batch", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    render(<Probe />);
    const el = screen.getByTestId("probe");
    // An empty batch changes nothing.
    act(() => ro.resize({ width: 5, height: 5 }, document.body));
    expect(el).toHaveTextContent("unmeasured");
    act(() => ro.resize({ width: 7, height: 8 }, el));
    expect(el).toHaveTextContent("7x8");
  });

  it("disconnects its observer on unmount", () => {
    const ro = installResizeObserver();
    restores.push(ro);
    const { unmount } = render(<Probe />);
    const el = screen.getByTestId("probe");
    expect(ro.disconnected).toEqual([]);
    unmount();
    expect(ro.disconnected).toEqual([el]);
    // A late resize reaches no one.
    expect(() => ro.resize({ width: 1, height: 1 })).not.toThrow();
  });
});
