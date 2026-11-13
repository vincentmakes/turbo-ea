/**
 * The Budget & Costs spend charts of the initiative PDF, drawn as vector
 * images: the same two cumulative charts the tab shows (`PpmCostCharts.tsx`),
 * built from the same pure pieces — `buildCumulativeSeries`, `budgetTotals`,
 * `monthAxisLabels`, `categoryReferences`, `buildCumulativeOption` — and
 * rendered headlessly by ECharts' SVG renderer into `data:image/svg+xml` URIs
 * the print builder (`ppmProjectPrint.ts`) places as `<img>`s.
 *
 * This is the only module that pulls ECharts into the PDF flow, so the dialog
 * loads it with a dynamic `import()` and only when Budget & Costs is ticked:
 * ECharts and its SVG renderer stay out of the PPM page chunk.
 */
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { TFunction } from "i18next";
import { buildEChartsChrome, type EChartsChrome } from "@/components/charts/echartsTheme";
import { fiscalYearLabel } from "@/lib/fiscalYear";
import { PPM_COST_COLORS, PRINT_COLORS } from "@/theme/tokens";
import type { PpmBudgetLine, PpmCostLine } from "@/types";
import {
  availableFiscalYears,
  budgetTotals,
  buildCumulativeSeries,
  currentFiscalYear,
  fiscalYearMonths,
  projectMonthRange,
  type BudgetTotals,
  type YearMonth,
} from "./costChartData";
import {
  buildCumulativeOption,
  categoryReferences,
  monthAxisLabels,
  type CumulativeLine,
} from "./cumulativeChartOption";
import type { ChartImage, ProjectPrintCharts } from "./ppmProjectPrint";

echarts.use([LineChart, GridComponent, LegendComponent, MarkLineComponent, AriaComponent, SVGRenderer]);

/** The print stylesheet's font (`lib/printDocument.ts`): Inter is not loaded in the pop-up. */
export const PRINT_CHART_FONT = "'Segoe UI', Arial, sans-serif";

/** About an A4 portrait page's content width at 96 dpi, so the image prints at 1:1. */
export const PRINT_CHART_WIDTH = 620;
/** Room for the plot, the month axis and the legend band under it. */
export const PRINT_CHART_HEIGHT = 236;

const SVG_DATA_URI_PREFIX = "data:image/svg+xml;charset=utf-8,";

export interface SpendChartInput {
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  /** Month (1-12) the fiscal year starts in. */
  fiscalYearStart: number;
  /** Injected, so every chart agrees on where "now" is and tests need no clock. */
  today: Date;
  /** A full currency figure. */
  format: (v: number) => string;
  /** A compact currency figure, for the value axis (`useCurrency().fmtShort`). */
  formatShort: (v: number) => string;
  isRtl: boolean;
  /** The interface language, for the month names. */
  locale: string;
  /** A `t`; the keys this module reads carry their `ppm:` prefix, so any binding resolves them. */
  t: TFunction;
}

/** One chart before it is drawn: its slot in `ProjectPrintCharts`, its heading and its option. */
export interface SpendChartSpec {
  key: keyof ProjectPrintCharts;
  title: string;
  option: EChartsCoreOption;
}

/** The light chart chrome on paper: print inks, the print font. */
export function printChartChrome(): EChartsChrome {
  return {
    ...buildEChartsChrome({
      mode: "light",
      text: { primary: PRINT_COLORS.ink, secondary: PRINT_COLORS.inkSecondary },
      divider: PRINT_COLORS.rule,
      background: { paper: PRINT_COLORS.paper },
      action: { hover: PRINT_COLORS.panel },
    }),
    fontFamily: PRINT_CHART_FONT,
  };
}

/**
 * The fiscal year the PDF charts: the current one when this initiative has
 * budget or cost data in it (`available`, as `availableFiscalYears` lists it —
 * the same list the tab's `resolveFiscalYear` checks a year against);
 * otherwise the latest year with data before it, and failing that the first
 * one after it. A PDF has no year picker, so a current year with nothing in it
 * would print a flat line where the initiative's real spend sits a year away.
 */
export function printFiscalYear(available: number[], currentFy: number): number {
  if (available.length === 0 || available.includes(currentFy)) return currentFy;
  const before = available.filter((y) => y < currentFy);
  return before.length > 0 ? before[before.length - 1] : available[0];
}

/**
 * The two charts' options, each only when its series has a month with a
 * value (the tab's "no chart data" rule); none at all when no cost line is
 * dated. Exported so tests can read what is drawn without decoding pixels.
 */
export function buildSpendChartSpecs(input: SpendChartInput): SpendChartSpec[] {
  const { costLines, budgetLines, fiscalYearStart, today, t } = input;
  const projectMonths = projectMonthRange(costLines);
  if (projectMonths.length === 0) return [];

  const colors = PPM_COST_COLORS.light;
  const lines: CumulativeLine[] = [
    { key: "capex", name: t("ppm:cumulativeCapex"), color: colors.capex },
    { key: "opex", name: t("ppm:cumulativeOpex"), color: colors.opex },
  ];
  const budgetNames = { capex: t("ppm:capexBudgetLine"), opex: t("ppm:opexBudgetLine") };
  const chrome = printChartChrome();

  const chart = (
    key: SpendChartSpec["key"],
    title: string,
    months: YearMonth[],
    budget: BudgetTotals,
  ): SpendChartSpec | null => {
    const points = buildCumulativeSeries({ costLines, months, today });
    if (!points.some((p) => p.total !== null)) return null;
    const option = buildCumulativeOption(
      points,
      monthAxisLabels(points, input.locale),
      lines,
      categoryReferences(budget, budgetNames, colors),
      { chrome, isRtl: input.isRtl, format: input.format, formatShort: input.formatShort },
    );
    // Nothing to hover on paper (and no tooltip component registered).
    delete option.tooltip;
    // Paper, not the screen's transparent surface.
    return { key, title, option: { ...option, backgroundColor: chrome.surface, animation: false } };
  };

  const fy = printFiscalYear(
    availableFiscalYears(costLines, budgetLines, fiscalYearStart),
    currentFiscalYear(today, fiscalYearStart),
  );
  return [
    chart(
      "fiscalYear",
      `${t("ppm:cumulativeByCategory")} · ${fiscalYearLabel(fy, fiscalYearStart, t)}`,
      fiscalYearMonths(fy, fiscalYearStart),
      budgetTotals(budgetLines, fy),
    ),
    chart("project", t("ppm:projectCumulative"), projectMonths, budgetTotals(budgetLines, "all")),
  ].filter((c): c is SpendChartSpec => c !== null);
}

/** An option drawn to an SVG document with no element mounted. */
export function renderChartSvg(option: EChartsCoreOption): string {
  const chart = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: PRINT_CHART_WIDTH,
    height: PRINT_CHART_HEIGHT,
  });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

/** An SVG document as a URI an `<img src>` takes. */
export function svgDataUri(svg: string): string {
  return `${SVG_DATA_URI_PREFIX}${encodeURIComponent(svg)}`;
}

/** The spend charts the PDF prints; `{}` when there is nothing to chart. */
export function renderSpendCharts(input: SpendChartInput): ProjectPrintCharts {
  const charts: ProjectPrintCharts = {};
  for (const spec of buildSpendChartSpecs(input)) {
    const image: ChartImage = { title: spec.title, src: svgDataUri(renderChartSvg(spec.option)) };
    charts[spec.key] = image;
  }
  return charts;
}
