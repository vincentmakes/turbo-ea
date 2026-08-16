import { describe, it, expect, vi, afterEach } from "vitest";
import type { GridApi, IRowNode } from "ag-grid-community";
import {
  autoScrollStep,
  cloneFillValue,
  fillDirection,
  fillRowIndices,
  findCellElement,
  isCellEditableAt,
  rowIndexAtPoint,
  runWithConcurrency,
} from "./dragFill";

// ---------------------------------------------------------------------------
// fillRowIndices / fillDirection
// ---------------------------------------------------------------------------

describe("fillRowIndices", () => {
  it("excludes the anchor and runs downward", () => {
    expect(fillRowIndices(2, 5, 10)).toEqual([3, 4, 5]);
  });

  it("excludes the anchor and returns display order when dragging upward", () => {
    expect(fillRowIndices(5, 2, 10)).toEqual([2, 3, 4]);
  });

  it("is empty when the drag returns to the anchor row", () => {
    expect(fillRowIndices(3, 3, 10)).toEqual([]);
  });

  it("clamps to the row model instead of emitting unresolvable indices", () => {
    expect(fillRowIndices(7, 99, 10)).toEqual([8, 9]);
    expect(fillRowIndices(2, -99, 10)).toEqual([0, 1]);
  });

  it("is empty for an empty grid", () => {
    expect(fillRowIndices(0, 4, 0)).toEqual([]);
  });
});

describe("fillDirection", () => {
  it("reports the drag direction", () => {
    expect(fillDirection(2, 9)).toBe("down");
    expect(fillDirection(9, 2)).toBe("up");
    expect(fillDirection(4, 4)).toBe("down");
  });
});

// ---------------------------------------------------------------------------
// findCellElement
// ---------------------------------------------------------------------------

describe("findCellElement", () => {
  /**
   * AG Grid renders one row element per region, all sharing a `row-index`.
   * Column freeze is mandatory app-wide, so the pinned region is always
   * present — this is the case a naive selector gets wrong.
   */
  function buildGrid(): HTMLElement {
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="ag-pinned-left-cols-container">
        <div class="ag-row" row-index="0"><div class="ag-cell" col-id="core_name"></div></div>
        <div class="ag-row" row-index="1"><div class="ag-cell" col-id="core_name"></div></div>
      </div>
      <div class="ag-center-cols-container">
        <div class="ag-row" row-index="0"><div class="ag-cell" col-id="attr_cost"></div></div>
        <div class="ag-row" row-index="1"><div class="ag-cell" col-id="attr_cost"></div></div>
      </div>
    `;
    return container;
  }

  it("finds a centre-region cell even though the pinned row shares its row-index", () => {
    const cell = findCellElement(buildGrid(), 1, "attr_cost");
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("col-id")).toBe("attr_cost");
    expect(cell?.parentElement?.parentElement?.className).toContain("ag-center-cols-container");
  });

  it("finds a pinned-region cell", () => {
    const cell = findCellElement(buildGrid(), 0, "core_name");
    expect(cell?.parentElement?.parentElement?.className).toContain("ag-pinned-left");
  });

  it("returns null for a virtualised row", () => {
    expect(findCellElement(buildGrid(), 42, "attr_cost")).toBeNull();
  });

  it("returns null for a column scrolled out of view", () => {
    expect(findCellElement(buildGrid(), 0, "attr_missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rowIndexAtPoint
// ---------------------------------------------------------------------------

describe("rowIndexAtPoint", () => {
  // jsdom does not implement elementFromPoint at all, so it cannot be spied —
  // it has to be installed. That absence is exactly why the helper
  // optional-chains the call.
  const original = Object.getOwnPropertyDescriptor(Document.prototype, "elementFromPoint");

  function stubHit(result: Element | null) {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      writable: true,
      value: vi.fn(() => result),
    });
  }

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).elementFromPoint;
    if (original) Object.defineProperty(Document.prototype, "elementFromPoint", original);
  });

  it("reads the row-index off the nearest row ancestor", () => {
    const row = document.createElement("div");
    row.setAttribute("row-index", "7");
    const cell = document.createElement("div");
    row.appendChild(cell);
    stubHit(cell);
    expect(rowIndexAtPoint(10, 20)).toBe(7);
  });

  it("is null when the point is not over a row", () => {
    stubHit(document.createElement("div"));
    expect(rowIndexAtPoint(10, 20)).toBeNull();
  });

  it("is null when the point hits nothing at all", () => {
    stubHit(null);
    expect(rowIndexAtPoint(10, 20)).toBeNull();
  });

  it("is null in an environment without elementFromPoint (jsdom)", () => {
    expect(document.elementFromPoint).toBeUndefined();
    expect(rowIndexAtPoint(10, 20)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// autoScrollStep
// ---------------------------------------------------------------------------

describe("autoScrollStep", () => {
  const TOP = 100;
  const BOTTOM = 500;

  it("does not scroll in the middle of the viewport", () => {
    expect(autoScrollStep(300, TOP, BOTTOM, 48, 24)).toBe(0);
  });

  it("scrolls up near the top edge and down near the bottom edge", () => {
    expect(autoScrollStep(TOP + 5, TOP, BOTTOM, 48, 24)).toBeLessThan(0);
    expect(autoScrollStep(BOTTOM - 5, TOP, BOTTOM, 48, 24)).toBeGreaterThan(0);
  });

  it("ramps with how deep into the edge band the pointer sits", () => {
    const shallow = autoScrollStep(BOTTOM - 40, TOP, BOTTOM, 48, 24);
    const deep = autoScrollStep(BOTTOM - 2, TOP, BOTTOM, 48, 24);
    expect(deep).toBeGreaterThan(shallow);
  });

  it("clamps at maxStep even far past the edge", () => {
    expect(autoScrollStep(BOTTOM + 900, TOP, BOTTOM, 48, 24)).toBe(24);
    expect(autoScrollStep(TOP - 900, TOP, BOTTOM, 48, 24)).toBe(-24);
  });

  it("is inert for a zero edge band", () => {
    expect(autoScrollStep(TOP, TOP, BOTTOM, 0, 24)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cloneFillValue
// ---------------------------------------------------------------------------

describe("cloneFillValue", () => {
  it("passes primitives and null through", () => {
    expect(cloneFillValue("a")).toBe("a");
    expect(cloneFillValue(3)).toBe(3);
    expect(cloneFillValue(false)).toBe(false);
    expect(cloneFillValue(null)).toBeNull();
    expect(cloneFillValue(undefined)).toBeUndefined();
  });

  it("gives a TagRef[] a fresh array AND fresh elements", () => {
    const tags = [{ id: "t1", name: "Core" }];
    const copy = cloneFillValue(tags);
    expect(copy).toEqual(tags);
    expect(copy).not.toBe(tags);
    expect(copy[0]).not.toBe(tags[0]);
  });

  it("gives a multi-select string[] a fresh array", () => {
    const values = ["a", "b"];
    const copy = cloneFillValue(values);
    expect(copy).toEqual(values);
    expect(copy).not.toBe(values);
  });

  it("copies nested objects", () => {
    const value = { outer: { inner: [1, 2] } };
    const copy = cloneFillValue(value);
    expect(copy).toEqual(value);
    expect(copy.outer).not.toBe(value.outer);
    expect(copy.outer.inner).not.toBe(value.outer.inner);
  });

  it("preserves a Date", () => {
    const date = new Date("2026-01-02T03:04:05Z");
    const copy = cloneFillValue(date);
    expect(copy.getTime()).toBe(date.getTime());
    expect(copy).not.toBe(date);
  });
});

// ---------------------------------------------------------------------------
// isCellEditableAt
// ---------------------------------------------------------------------------

describe("isCellEditableAt", () => {
  const node = { data: {} } as IRowNode;

  function apiWith(column: unknown): GridApi {
    return { getColumn: () => column } as unknown as GridApi;
  }

  it("defers to the grid's own answer when the column exposes one", () => {
    const yes = apiWith({ isCellEditable: () => true });
    const no = apiWith({ isCellEditable: () => false });
    expect(isCellEditableAt(yes, "attr_x", node)).toBe(true);
    expect(isCellEditableAt(no, "attr_x", node)).toBe(false);
  });

  it("falls back to a boolean editable on the colDef", () => {
    expect(isCellEditableAt(apiWith({ getColDef: () => ({ editable: true }) }), "c", node)).toBe(
      true,
    );
    expect(isCellEditableAt(apiWith({ getColDef: () => ({ editable: false }) }), "c", node)).toBe(
      false,
    );
  });

  it("treats a callable editable as editable and lets the grid reject the write", () => {
    const api = apiWith({ getColDef: () => ({ editable: () => false }) });
    expect(isCellEditableAt(api, "c", node)).toBe(true);
  });

  it("is false for an unknown column, and survives a stub api with no getColumn", () => {
    expect(isCellEditableAt(apiWith(undefined), "nope", node)).toBe(false);
    expect(isCellEditableAt({} as GridApi, "nope", node)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runWithConcurrency
// ---------------------------------------------------------------------------

describe("runWithConcurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await runWithConcurrency(items, 6, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return item;
    });

    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it("keeps input order regardless of completion order", async () => {
    const results = await runWithConcurrency([3, 1, 2], 3, async (item) => {
      // Later items settle first.
      for (let i = 0; i < item; i++) await Promise.resolve();
      return item;
    });
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([3, 1, 2]);
  });

  it("records a throwing worker as rejected without rejecting overall", async () => {
    const results = await runWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    });
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(results[1].status === "rejected" && (results[1].reason as Error).message).toBe("boom");
    expect(results[2].status).toBe("fulfilled");
  });

  it("reports monotonic progress ending at (n, n)", async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4], 2, async (i) => i, (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("handles an empty list", async () => {
    const onProgress = vi.fn();
    const results = await runWithConcurrency([], 4, async (i) => i, onProgress);
    expect(results).toHaveLength(0);
    expect(onProgress).toHaveBeenCalledWith(0, 0);
  });
});
