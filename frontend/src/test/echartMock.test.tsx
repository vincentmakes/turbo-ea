import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import EChart, { ECHART_CLASS, EXPORT_DPR } from "@/components/charts/EChart";
import { echartState } from "./echartMock";

beforeEach(() => echartState.reset());

describe("echartMock", () => {
  it("stands in for the wrapper module, constants included", () => {
    expect(EXPORT_DPR).toBe(2);
    expect(ECHART_CLASS).toBe("echart-container");
    render(<EChart option={{ a: 1 }} ariaLabel="Cost" style={{ height: 300 }} devicePixelRatio={2} />);
    const el = screen.getByTestId("echart");
    expect(el).toHaveAttribute("role", "img");
    expect(el).toHaveAttribute("aria-label", "Cost");
    expect(el).toHaveAttribute("data-echart", "0");
    expect(el).toHaveClass("echart-container");
    expect(el.style.height).toBe("300px");
    expect(echartState.last()).toMatchObject({ option: { a: 1 }, devicePixelRatio: 2 });
  });

  it("finds a chart by its aria-label and keeps its slot across re-renders", () => {
    const { rerender } = render(
      <>
        <EChart option={{ n: 1 }} ariaLabel="First" />
        <EChart option={{ n: 2 }} ariaLabel="Second" />
      </>,
    );
    expect(echartState.props).toHaveLength(2);
    expect(echartState.byName("First").option).toEqual({ n: 1 });
    expect(echartState.byName("Second").option).toEqual({ n: 2 });
    rerender(
      <>
        <EChart option={{ n: 3 }} ariaLabel="First" />
        <EChart option={{ n: 2 }} ariaLabel="Second" />
      </>,
    );
    expect(echartState.props).toHaveLength(2);
    expect(echartState.byName("First").option).toEqual({ n: 3 });
    expect(screen.getAllByTestId("echart").map((e) => e.getAttribute("data-echart"))).toEqual(["0", "1"]);
  });

  it("records a chart on commit, never while it renders", () => {
    const seen: number[] = [];
    function Probe() {
      // Renders after the chart in the same pass.
      seen.push(echartState.props.length);
      return null;
    }
    render(
      <>
        <EChart option={{ n: 1 }} ariaLabel="Committed" />
        <Probe />
      </>,
    );
    expect(seen).toEqual([0]);
    // Found right after render(): layout effects run inside it.
    expect(echartState.byName("Committed").option).toEqual({ n: 1 });
  });

  it("claims one slot per chart under StrictMode's double render and effects", () => {
    render(
      <StrictMode>
        <EChart option={{ n: 1 }} ariaLabel="Strict" />
        <EChart option={{ n: 2 }} ariaLabel="Strict too" />
      </StrictMode>,
    );
    expect(echartState.props).toHaveLength(2);
    expect(screen.getAllByTestId("echart").map((e) => e.getAttribute("data-echart"))).toEqual(["0", "1"]);
    expect(echartState.byName("Strict too").option).toEqual({ n: 2 });
  });

  it("finds a chart by the title its labelledBy points at", () => {
    render(
      <>
        <h3 id="t1">Cost by type</h3>
        <EChart option={{ n: 1 }} labelledBy="t1" />
        <EChart option={{ n: 2 }} ariaLabel="Other" />
      </>,
    );
    expect(echartState.byName("Cost by type").option).toEqual({ n: 1 });
    expect(screen.getByRole("img", { name: "Cost by type" })).toHaveAttribute("aria-labelledby", "t1");
  });

  it("prefers the newest chart of a name, so a remount is the one found", () => {
    const first = render(<EChart option={{ v: "old" }} ariaLabel="Same" />);
    first.unmount();
    render(<EChart option={{ v: "new" }} ariaLabel="Same" />);
    expect(echartState.props).toHaveLength(2);
    expect(echartState.byName("Same").option).toEqual({ v: "new" });
  });

  it("delivers a click to the named chart's handler", () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <>
        <EChart option={{}} ariaLabel="A" onClick={onA} />
        <EChart option={{}} ariaLabel="B" onClick={onB} />
      </>,
    );
    echartState.click("B", { name: "x" });
    expect(onB).toHaveBeenCalledWith({ name: "x" });
    expect(onA).not.toHaveBeenCalled();
  });

  it("refuses a click on a chart without a handler", () => {
    render(<EChart option={{}} ariaLabel="Static" />);
    expect(() => echartState.click("Static", {})).toThrow('Mocked EChart "Static" has no onClick');
  });

  it("names the charts it knows when a name matches none", () => {
    render(
      <>
        <h3 id="t2">Titled</h3>
        <EChart option={{}} ariaLabel="Known" />
        <EChart option={{}} labelledBy="t2" />
        <EChart option={{}} labelledBy="missing" />
        <EChart option={{}} />
      </>,
    );
    expect(() => echartState.byName("Unknown")).toThrow(
      'No mocked EChart named "Unknown"; charts rendered: ["Known", "Titled", null, null]',
    );
  });

  it("starts over on reset", () => {
    render(<EChart option={{}} ariaLabel="Gone" />);
    expect(echartState.last().ariaLabel).toBe("Gone");
    echartState.reset();
    expect(echartState.props).toHaveLength(0);
    expect(() => echartState.last()).toThrow("No mocked EChart has rendered");
    expect(() => echartState.byName("Gone")).toThrow('charts rendered: []');
  });
});
