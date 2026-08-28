import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AgGridReact } from "ag-grid-react";

/**
 * The shim that stopped AG Grid re-probing `document` forever under jsdom.
 *
 * AG Grid measures the scrollbar by appending a hidden 100×100 div and caches
 * the answer — but only when the measurement is non-degenerate. jsdom lays
 * nothing out, so the measurement was always discarded, the cache never filled,
 * and `_getScrollbarWidth()` re-probed `document` on every call. AG Grid defers
 * some of that work onto a timer, so on a loaded runner one probe lands after
 * Vitest has torn the environment down: "ReferenceError: document is not
 * defined" fails the whole run while every test reports as passing, which is
 * what makes it expensive to diagnose. It took main red after #1030.
 */
describe("AG Grid's scrollbar probe under jsdom", () => {
  /** Count the probes a real grid makes: AG Grid's own element, by signature. */
  function countProbes(): () => number {
    let probes = 0;
    const append = HTMLElement.prototype.appendChild;
    vi.spyOn(HTMLElement.prototype, "appendChild").mockImplementation(function (
      this: HTMLElement,
      node: Node,
    ) {
      const style = (node as HTMLElement).style;
      if (style?.overflow === "scroll" && style.opacity === "0") probes += 1;
      return append.call(this, node) as Node;
    });
    return () => probes;
  }

  const Grid = ({ seed }: { seed: number }) => (
    <div style={{ height: 400, width: 600 }}>
      <AgGridReact
        rowData={[{ a: seed }, { a: 2 }]}
        columnDefs={[{ field: "a" }, { field: "b" }]}
      />
    </div>
  );

  it("measures once for the life of the module, however hard the grid works", async () => {
    // Measured: 27 probes without the shim, 1 with it. Every one of those 27
    // reads `document`, and only one has to outlive the environment.
    const probes = countProbes();
    const { container, rerender } = render(<Grid seed={0} />);
    await waitFor(() => expect(container.querySelector(".ag-root")).not.toBeNull());
    for (let i = 1; i <= 5; i++) {
      rerender(<Grid seed={i} />);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(probes()).toBeLessThanOrEqual(1);
  });

  it("leaves every other element with jsdom's own answer", () => {
    // Scoped to the probe's signature precisely so no test's view of layout
    // changes: jsdom lays nothing out, and it must stay that way.
    const plain = document.createElement("div");
    plain.style.width = "100px";
    document.body.appendChild(plain);
    expect(plain.clientWidth).toBe(0);
    expect(plain.offsetWidth).toBe(0);
    plain.remove();
  });
});
