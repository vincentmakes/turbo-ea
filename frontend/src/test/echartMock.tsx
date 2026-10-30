/**
 * The shared test double for `@/components/charts/EChart`.
 *
 * jsdom has no canvas, so a test never draws a real chart: it mocks the
 * wrapper with this module and asserts on the option the page built, then
 * drives a click the way ECharts would deliver one.
 *
 * ```ts
 * vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
 * import { echartState } from "@/test/echartMock";
 *
 * beforeEach(() => echartState.reset());
 *
 * const chart = echartState.byName("Cost by type"); // its aria-label, or its labelledBy title
 * expect(chart.option.series[0].data).toHaveLength(3);
 * act(() => echartState.click("Cost by type", { name: "Application", data: { key: "Application" } }));
 * ```
 *
 * Each mounted chart claims a stable slot once (the order it first rendered
 * in) and rewrites it with its latest props on every render, so a page with
 * several charts can tell them apart and a re-render is seen. Slots of an
 * unmounted chart stay until `reset()`; lookups prefer the newest match.
 */
import { useState, type CSSProperties } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */

/** The props a mocked chart was last rendered with. */
export interface CapturedEChart {
  option: any;
  onClick?: (p: unknown) => void;
  ariaLabel?: string;
  labelledBy?: string;
  style?: CSSProperties;
  devicePixelRatio?: number;
}

function nameOf(entry: CapturedEChart): string | undefined {
  if (entry.ariaLabel !== undefined) return entry.ariaLabel;
  if (entry.labelledBy === undefined) return undefined;
  return document.getElementById(entry.labelledBy)?.textContent ?? undefined;
}

export const echartState = {
  /** Every chart mounted since the last `reset()`, in first-render order. */
  props: [] as CapturedEChart[],

  reset(): void {
    echartState.props.length = 0;
  },

  /** The chart named `name` by its `ariaLabel`, or by the text of the element its `labelledBy` points at. */
  byName(name: string): CapturedEChart {
    for (let i = echartState.props.length - 1; i >= 0; i--) {
      const entry = echartState.props[i];
      if (entry.ariaLabel === name) return entry;
      if (entry.labelledBy !== undefined && document.getElementById(entry.labelledBy)?.textContent === name) {
        return entry;
      }
    }
    const known = echartState.props.map((e) => JSON.stringify(nameOf(e) ?? null)).join(", ");
    throw new Error(`No mocked EChart named ${JSON.stringify(name)}; charts rendered: [${known}]`);
  },

  /** Deliver a click to the chart named `name`, as ECharts would. */
  click(name: string, params: unknown): void {
    const entry = echartState.byName(name);
    if (!entry.onClick) throw new Error(`Mocked EChart ${JSON.stringify(name)} has no onClick`);
    entry.onClick(params);
  },

  /** The most recently mounted chart. */
  last(): CapturedEChart {
    const entry = echartState.props[echartState.props.length - 1];
    if (!entry) throw new Error("No mocked EChart has rendered");
    return entry;
  },
};

// eslint-disable-next-line react-refresh/only-export-components -- a test double, never hot-reloaded
function MockEChart(props: CapturedEChart) {
  const [index] = useState(() => echartState.props.length);
  echartState.props[index] = props;
  return (
    <div
      role="img"
      data-testid="echart"
      data-echart={index}
      aria-label={props.ariaLabel}
      aria-labelledby={props.labelledBy}
      className="echart-container"
      style={props.style}
    />
  );
}

/** The module a `vi.mock("@/components/charts/EChart", …)` factory returns. */
export function echartModule(): { default: typeof MockEChart; EXPORT_DPR: 2; ECHART_CLASS: "echart-container" } {
  return { default: MockEChart, EXPORT_DPR: 2, ECHART_CLASS: "echart-container" };
}
