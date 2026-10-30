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
 * Each mounted chart claims a stable slot once (the order it first committed
 * in) and rewrites it with its latest props on every commit, so a page with
 * several charts can tell them apart and a re-render is seen. The writes run
 * in a layout effect, never during render, so a render React throws away
 * records nothing; layout effects run synchronously inside RTL's `render`, so
 * `byName` right after it finds the chart. Slots of an unmounted chart stay
 * until `reset()`; lookups prefer the newest match.
 */
import { useLayoutEffect, useRef, type CSSProperties } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any -- an option tree is plain JSON a test digs into */

/** The props a mocked chart was last rendered with. */
export interface CapturedEChart {
  option: any;
  onClick?: (p: unknown) => void;
  ariaLabel?: string;
  labelledBy?: string;
  style?: CSSProperties;
  devicePixelRatio?: number;
  /** Never called by the double: a test hands it a stand-in chart itself. */
  onInit?: (chart: any) => void;
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
  const ref = useRef<HTMLDivElement | null>(null);
  // The slot is claimed on the first commit, not at render: siblings that
  // render in one pass would otherwise all read the same length.
  const index = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (index.current === null) index.current = echartState.props.length;
    echartState.props[index.current] = props;
    ref.current?.setAttribute("data-echart", String(index.current));
  });
  return (
    <div
      ref={ref}
      role="img"
      data-testid="echart"
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
