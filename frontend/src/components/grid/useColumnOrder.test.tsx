/**
 * `useColumnOrder` without a grid: the publish that folds newly present
 * columns into the stored order, and when it runs. The real-grid round trips
 * are in `columnOrderPersistence.test.tsx`.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import type { ColDef } from "ag-grid-community";
import { colIdOf } from "./columnOrder";
import { useColumnOrder } from "./useColumnOrder";

const A_B: ColDef[] = [{ colId: "a" }, { colId: "b" }];
const A_B_C: ColDef[] = [...A_B, { colId: "c" }];

const handles: { setCols: (cols: ColDef[]) => void; setOrder: (order: string[]) => void } = {
  setCols: () => {},
  setOrder: () => {},
};

function Harness() {
  const gridRef = useRef(null);
  const [cols, setCols] = useState<ColDef[]>(A_B);
  const [order, setOrder] = useState<string[]>(["a", "b"]);
  handles.setCols = setCols;
  handles.setOrder = setOrder;
  const columnOrder = useColumnOrder(gridRef, { order, onOrderChange: setOrder });
  return (
    <>
      <div data-testid="cols" data-count={cols.length}>
        {columnOrder.applyOrder(cols).map(colIdOf).join(",")}
      </div>
      <div data-testid="order">{order.join(",")}</div>
    </>
  );
}

describe("useColumnOrder", () => {
  it("folds a column that appears into the stored order", async () => {
    render(<Harness />);
    handles.setCols(A_B_C);
    await waitFor(() => expect(screen.getByTestId("order")).toHaveTextContent(/^a,b,c$/));
    expect(screen.getByTestId("cols")).toHaveTextContent(/^a,b,c$/);
  });

  it("never lets that fold overwrite an order set right after the commit that caused it", async () => {
    // A view applied (or a column moved) between the commit that brought a new
    // column and that commit's passive effects: React flushes the pending
    // effect first, and a fold published from there was queued AFTER the
    // user's order, so it won. A MutationObserver callback runs exactly there,
    // a microtask after the commit's DOM change, so this holds at any speed.
    // (InventoryPage.workflows.test.tsx lost a view's column order this way.)
    render(<Harness />);
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = g.IS_REACT_ACT_ENVIRONMENT;
    const cols = screen.getByTestId("cols");
    let applied = false;
    const observer = new MutationObserver(() => {
      if (applied || cols.dataset.count !== "3") return;
      applied = true;
      handles.setOrder(["c", "a", "b"]);
    });
    observer.observe(cols, { attributes: true });
    try {
      // Outside act(), as the metamodel's answer arrives in the app, so the
      // commit's passive effects wait for a task of their own.
      g.IS_REACT_ACT_ENVIRONMENT = false;
      handles.setCols(A_B_C);
      await waitFor(() => expect(applied).toBe(true));
      await waitFor(() => expect(screen.getByTestId("order")).toHaveTextContent(/^c,a,b$/));
      expect(screen.getByTestId("cols")).toHaveTextContent(/^c,a,b$/);
    } finally {
      observer.disconnect();
      g.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });
});
