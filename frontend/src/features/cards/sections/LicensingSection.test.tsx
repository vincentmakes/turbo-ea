import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  apiErrorMessage: (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f),
  isAbortError: () => false,
}));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { api, ApiError } from "@/api/client";
import i18n from "@/i18n";
import { invalidateLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { installResizeObserver } from "@/test/dom";
import { echartState } from "@/test/echartMock";
import type {
  CardLicensesResponse,
  LicenseMetricItem,
  LicenseMetricResult,
  LicenseTypeItem,
  LicenseTypeResult,
  YearLicenses,
} from "@/types";
import LicensingSection from "./LicensingSection";

const FY = 2026;
const BAR = "Licensed and actual counts per license type";
const HISTORY = "Licensed and actual counts per fiscal year";

const typeItem = (
  metric: string,
  key: string,
  label: string,
  sort: number,
  archived = false,
): LicenseTypeItem => ({
  id: `${metric}-${key}`,
  metric_key: metric,
  key,
  label,
  sort_order: sort,
  archived,
  translations: {},
});
const metricItem = (
  key: string,
  label: string,
  sort: number,
  types: LicenseTypeItem[],
  archived = false,
): LicenseMetricItem => ({ id: key, key, label, sort_order: sort, archived, translations: {}, types });
const CATALOGUE: LicenseMetricItem[] = [
  metricItem("users", "Users", 1, [
    typeItem("users", "prod", "Prod", 1),
    typeItem("users", "dev", "Dev", 2),
    typeItem("users", "qa", "QA", 3),
    typeItem("users", "old", "Old", 4, true),
  ]),
  metricItem("installations", "Installations", 2, [typeItem("installations", "prod", "Prod", 1)]),
  metricItem("cores", "Cores", 3, [typeItem("cores", "x", "Xeon", 1)], true),
];

const tr = (
  key: string,
  licensed: number,
  actual: number | null,
  over: Partial<LicenseTypeResult> = {},
): LicenseTypeResult => ({
  key,
  licensed,
  actual,
  pct: actual == null || licensed === 0 ? null : Math.round((actual / licensed) * 1000) / 10,
  no_licence: false,
  status: actual == null ? "no_data" : actual > licensed ? "over" : "compliant",
  ...over,
});
const metric = (
  m: string,
  types: LicenseTypeResult[],
  status: LicenseMetricResult["status"],
): LicenseMetricResult => ({
  metric: m,
  types,
  has_actual: types.some((x) => x.actual != null),
  status,
  worst_pct: null,
  worst_no_licence: false,
  licensed_total: types.reduce((s, x) => s + x.licensed, 0),
  actual_total: types.some((x) => x.actual != null)
    ? types.reduce((s, x) => s + (x.actual ?? 0), 0)
    : null,
});
const year = (fy: number, over: Partial<YearLicenses> = {}): YearLicenses => ({
  fiscal_year: fy,
  is_current: fy === FY,
  is_forecast: fy === FY + 1,
  confirmed: true,
  fallback_from: null,
  metrics: [],
  status: fy === FY + 1 ? null : "compliant",
  ...over,
});
const YEARS: YearLicenses[] = [
  year(2022),
  year(2023, { metrics: [metric("users", [tr("qa", 0, null)], "no_actual_data")] }),
  year(2024, { metrics: [metric("users", [tr("old", 7, 3)], "compliant")] }),
  year(2025, { metrics: [metric("users", [tr("prod", 90, 70)], "compliant")] }),
  year(2026, {
    status: "over",
    metrics: [
      metric("users", [tr("prod", 100, 50), tr("dev", 10, 12), tr("qa", 5, null)], "over"),
      metric("installations", [tr("prod", 20, 10)], "compliant"),
    ],
  }),
  year(2027, {
    confirmed: false,
    fallback_from: FY,
    metrics: [metric("users", [tr("prod", 100, null)], "no_actual_data")],
  }),
];
const response = (over: Partial<CardLicensesResponse> = {}): CardLicensesResponse => ({
  can_edit: true,
  years: YEARS,
  ...over,
});

/** Answer the card's licenses and the catalogue; the catalogue hook is a process-wide cache, so refetch it. */
async function mockGet(r: CardLicensesResponse | Error, catalogue = CATALOGUE) {
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === "/metamodel/license-metrics") return Promise.resolve(catalogue);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }) as never);
  await invalidateLicenseCatalogue();
}

/** Move the Time Travel slider to a fiscal year, one keyboard step at a time. */
async function goTo(fy: number) {
  const slider = await screen.findByRole("slider");
  const now = () => Number(slider.getAttribute("aria-valuenow"));
  for (let i = 0; i < 6 && now() !== fy; i++) {
    fireEvent.keyDown(slider, { key: now() < fy ? "ArrowRight" : "ArrowLeft" });
  }
  await waitFor(() => expect(now()).toBe(fy));
}

const chart = (metricLabel: string) => echartState.byName(`${BAR}: ${metricLabel}`);
const clickBar = (metricLabel: string, dataIndex: number) =>
  act(() => echartState.click(`${BAR}: ${metricLabel}`, { dataIndex }));
const values = (series: { data: { value: number | null }[] }) => series.data.map((d) => d.value);

let restoreRo: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  // the Time Travel slider measures its track with a ResizeObserver
  restoreRo = installResizeObserver();
  vi.clearAllMocks();
  echartState.reset();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.put).mockResolvedValue({} as never);
});
afterEach(() => restoreRo());

describe("LicensingSection", () => {
  it("renders nothing on 403 and on 404", async () => {
    for (const status of [403, 404]) {
      await mockGet(new ApiError("nope", status, null));
      const { container, unmount } = render(<LicensingSection cardId="c1" />);
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(container).toBeEmptyDOMElement();
      unmount();
      vi.clearAllMocks();
    }
  });

  it("groups the pairs of the selected year by metric, one bar chart each", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    expect(await screen.findByText("FY26 - Current")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/cards/c1/licenses", expect.anything());
    expect(echartState.props.map((c) => c.ariaLabel)).toEqual([
      `${BAR}: Users`,
      `${BAR}: Installations`,
    ]);
    expect(chart("Users").option.yAxis[0].data).toEqual(["Prod", "Dev", "QA"]);
    expect(chart("Installations").option.yAxis[0].data).toEqual(["Prod"]);
    // Actual is the solid bar in front; QA has no actual, so no zero bar
    expect(values(chart("Users").option.series[1])).toEqual([50, 12, null]);
    // the card's status for the year sits above the bars
    expect(screen.getByText("Over-licensed")).toBeInTheDocument();
  });

  it("shows only the pairs the selected year has", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await goTo(2025);
    await waitFor(() => expect(screen.queryByTestId("license-block-installations")).toBeNull());
    expect(chart("Users").option.yAxis[0].data).toEqual(["Prod"]);
    await goTo(2026);
    expect(await screen.findByTestId("license-block-installations")).toBeInTheDocument();
  });

  it("says so when the year has no pair", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await goTo(2022);
    expect(await screen.findByText(/No licensing recorded for this year/)).toBeInTheDocument();
    expect(screen.queryByTestId("license-block-users")).toBeNull();
  });

  it("shows an archived pair that has data, and a cell without values as no data", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await goTo(2024);
    await waitFor(() => expect(chart("Users").option.yAxis[0].data).toEqual(["Old (archived)"]));
    await goTo(2023);
    await waitFor(() => expect(chart("Users").option.yAxis[0].data).toEqual(["QA"]));
    expect(chart("Users").option.series[0].data[0].label.formatter()).toBe("No data");
  });

  it("the Forecast year draws licensed only and the carried-forward banner offers Confirm", async () => {
    await mockGet(response());
    const user = userEvent.setup();
    render(<LicensingSection cardId="c1" />);
    await goTo(2027);
    expect(
      screen.getByText(
        "No license counts entered for FY27 yet. Showing the licensed counts of FY26, not confirmed.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(values(chart("Users").option.series[1])).toEqual([null]));
    expect(screen.queryByText("Over-licensed")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm FY27" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/cards/c1/licenses/2027/confirm"));
  });

  it("offers no Confirm, Add or Edit without edit rights", async () => {
    await mockGet(response({ can_edit: false }));
    render(<LicensingSection cardId="c1" />);
    await goTo(2027);
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add license" })).toBeNull();
    clickBar("Users", 0);
    expect(await screen.findByTestId("license-pair-history")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("the stepper arrows are gone", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await screen.findByRole("slider");
    // only the Time Travel slider's two arrows remain
    expect(screen.queryAllByRole("button", { name: /previous|next/i })).toHaveLength(2);
    expect(i18n.exists("licensing.previousYear", { ns: "cards" })).toBe(false);
    expect(i18n.exists("licensing.nextYear", { ns: "cards" })).toBe(false);
  });

  it("a bar click opens the pair's history below the bars, a second click closes it", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await screen.findByTestId("license-block-installations");
    expect(screen.queryByTestId("license-pair-history")).toBeNull();
    clickBar("Users", 1);
    const history = await screen.findByTestId("license-pair-history");
    expect(within(history).getByText("Users: Dev")).toBeInTheDocument();
    const last = screen.getByTestId("license-block-installations");
    expect(last.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the six years, Forecast included; a year without the pair has no cell
    const hist = echartState.byName(`${HISTORY}: Users: Dev`);
    expect(hist.option.xAxis.data).toEqual(["FY22", "FY23", "FY24", "FY25", "FY26", "FY27"]);
    expect(hist.option.series[0].data).toEqual([0, 0, 0, 0, 10, 0]);
    expect(hist.option.series[1].data).toEqual([null, null, null, null, 12, null]);
    // the other pairs dim
    expect(chart("Users").option.series[1].data[0].itemStyle.opacity).toBeLessThan(1);
    clickBar("Users", 1);
    await waitFor(() => expect(screen.queryByTestId("license-pair-history")).toBeNull());
  });

  it("a click on another pair switches the history", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await screen.findByTestId("license-block-installations");
    clickBar("Users", 1);
    await screen.findByText("Users: Dev");
    clickBar("Installations", 0);
    expect(await screen.findByText("Installations: Prod")).toBeInTheDocument();
    expect(screen.queryByText("Users: Dev")).toBeNull();
  });

  it("closes the history when the pair is not in the year picked next", async () => {
    await mockGet(response());
    render(<LicensingSection cardId="c1" />);
    await screen.findByTestId("license-block-installations");
    clickBar("Installations", 0);
    await screen.findByTestId("license-pair-history");
    await goTo(2025);
    await waitFor(() => expect(screen.queryByTestId("license-pair-history")).toBeNull());
  });

  it("Edit on the history opens the cell of the selected year and reloads after a save", async () => {
    await mockGet(response());
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<LicensingSection cardId="c1" onChanged={onChanged} />);
    await screen.findByTestId("license-block-installations");
    clickBar("Users", 1);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByText(/Edit license/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2026/items/users/dev", {
        licensed: 10,
        actual: 12,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("Add offers the active metrics, then the active types of that metric, and writes the selected year", async () => {
    await mockGet(response());
    const user = userEvent.setup();
    render(<LicensingSection cardId="c1" />);
    await goTo(2025);
    await user.click(await screen.findByRole("button", { name: "+ Add license" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("Metric"));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Users",
      "Installations",
    ]);
    await user.click(screen.getByRole("option", { name: "Users" }));
    await user.click(within(dialog).getByLabelText("License type"));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Prod",
      "Dev",
      "QA",
    ]);
    await user.click(screen.getByRole("option", { name: "Dev" }));
    await user.type(within(dialog).getByLabelText("Licensed"), "30");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith("/cards/c1/licenses/2025/items/users/dev", {
        licensed: 30,
        actual: null,
      }),
    );
  });

  it("offers no Add when no active metric has an active type", async () => {
    await mockGet(response(), [CATALOGUE[2]]);
    render(<LicensingSection cardId="c1" />);
    await screen.findByText("FY26 - Current");
    expect(screen.queryByRole("button", { name: "+ Add license" })).toBeNull();
  });
});
