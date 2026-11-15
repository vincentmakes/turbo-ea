import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: { format: (v: number) => `EUR ${v}` }, symbol: "EUR" }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string) => `d:${v}` }),
}));
vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));

import { api, ApiError } from "@/api/client";
import i18n from "@/i18n";
import { echartState } from "@/test/echartMock";
import { installResizeObserver } from "@/test/dom";
import { CATEGORICAL_COLORS, RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import { alpha } from "@mui/material/styles";
import { toIsoDate } from "@/lib/dates";
import type { CardCostsResponse, YearCosts } from "@/types";
import CostsSection from "./CostsSection";

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
};
const FY = 2026;
const year = (fy: number, over: Partial<YearCosts> = {}): YearCosts => ({
  fiscal_year: fy,
  is_current: fy === FY,
  is_forecast: fy === FY + 1,
  confirmed: true,
  fallback_from: null,
  items: [],
  tco: 0,
  ...over,
});
const catalogue = (): CardCostsResponse["catalogue"] => [
  { id: "1", key: "lic", label: "Licences", sort_order: 1, archived: false, translations: {} },
  { id: "2", key: "sup", label: "Support", sort_order: 2, archived: false, translations: {} },
  { id: "3", key: "old", label: "Legacy", sort_order: 3, archived: true, translations: {} },
  { id: "4", key: "cloud", label: "Cloud", sort_order: 4, archived: false, translations: {} },
];
const response = (over: Partial<CardCostsResponse> = {}): CardCostsResponse => ({
  can_edit: true,
  catalogue: catalogue(),
  years: [2022, 2023, 2024, 2025, 2026, 2027].map((fy) =>
    fy === FY
      ? year(fy, {
          tco: 180,
          items: [
            { key: "lic", amount: 100, renewal_date: inDays(30), archived: false },
            { key: "sup", amount: 50, renewal_date: inDays(300), archived: false },
            { key: "old", amount: 30, renewal_date: null, archived: true },
          ],
        })
      : fy === FY + 1
        ? year(fy, {
            confirmed: false,
            fallback_from: FY,
            tco: 150,
            items: [{ key: "lic", amount: 100, renewal_date: null, archived: false }],
          })
        : year(fy),
  ),
  ...over,
});

function mockGet(r: CardCostsResponse | Error) {
  vi.mocked(api.get).mockImplementation(
    () => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)) as never,
  );
}
const renderSection = () => render(<CostsSection cardId="c1" />);
const chartOption = () => echartState.byName("Share of each cost item in the TCO").option;
/** Move the Time Travel slider to a fiscal year, one keyboard step at a time. */
async function goTo(fy: number) {
  const slider = screen.getByRole("slider");
  const now = () => Number(slider.getAttribute("aria-valuenow"));
  for (let i = 0; i < 6 && now() !== fy; i++) {
    fireEvent.keyDown(slider, { key: now() < fy ? "ArrowRight" : "ArrowLeft" });
  }
  await waitFor(() => expect(now()).toBe(fy));
}

let restoreRo: ReturnType<typeof installResizeObserver>;
beforeEach(() => {
  // the Time Travel slider measures its track with a ResizeObserver
  restoreRo = installResizeObserver();
  vi.clearAllMocks();
  echartState.reset();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.put).mockResolvedValue({} as never);
  vi.mocked(api.delete).mockResolvedValue({} as never);
});
afterEach(() => restoreRo());

describe("CostsSection", () => {
  it("shows the current year, its TCO and one tile per line", async () => {
    mockGet(response());
    renderSection();
    expect(await screen.findByText("FY26 - Current")).toBeInTheDocument();
    expect(screen.getByText("EUR 180")).toBeInTheDocument();
    expect(screen.getByTestId("cost-tile-lic")).toHaveTextContent("Licences");
    expect(screen.getByTestId("cost-tile-sup")).toHaveTextContent("EUR 50");
    expect(screen.getAllByTestId(/cost-tile-/)).toHaveLength(3);
    expect(api.get).toHaveBeenCalledWith("/cards/c1/costs", expect.anything());
  });

  it("marks an archived line and still counts it in the TCO", async () => {
    mockGet(response());
    renderSection();
    const tile = await screen.findByTestId("cost-tile-old");
    expect(tile).toHaveTextContent("Legacy (archived)");
    expect(tile).toHaveTextContent("still counted in the TCO");
    expect(screen.getByText("EUR 180")).toBeInTheDocument();
    expect(echartState.last().option.series.map((s: { name: string }) => s.name)).toContain(
      "Legacy",
    );
  });

  it("flags a renewal that is near", async () => {
    mockGet(response());
    renderSection();
    const near = await screen.findByTestId("cost-tile-lic");
    const far = screen.getByTestId("cost-tile-sup");
    const nearOf = (el: HTMLElement) =>
      within(el).getByText(/renewal/).getAttribute("data-near");
    expect(nearOf(near)).toBe("true");
    expect(nearOf(far)).toBe("false");
  });

  it("drives the selected year from the Time Travel row, over the six years", async () => {
    mockGet(response());
    renderSection();
    const slider = await screen.findByRole("slider", { name: "Fiscal year" });
    expect(slider).toHaveAttribute("aria-valuemin", "2022");
    expect(slider).toHaveAttribute("aria-valuemax", "2027");
    expect(slider).toHaveAttribute("aria-valuetext", "FY26 - Current");
    await goTo(2027);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "FY27 - Forecast");
    await goTo(2022);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "FY22");
  });

  it("shows one bar row per fiscal year, forecast on top", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    const option = chartOption();
    expect(option.yAxis.data).toEqual(["FY27", "FY26", "FY25", "FY24", "FY23", "FY22"]);
    const lic = option.series.find((s: { name: string }) => s.name === "Licences");
    expect(lic.data.map((d: { value: number }) => d.value)).toEqual([100, 100, 0, 0, 0, 0]);
    expect(echartState.last().style).toEqual({ height: 6 * 22 });
  });

  it("keeps a year with no items as a row with its label and a total of 0", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    const option = chartOption();
    expect(option.yAxis.data).toContain("FY23");
    const total = option.series[option.series.length - 1];
    expect(total.data[4].label.formatter()).toBe("EUR 0"); // FY23
  });

  it("highlights the chosen year's bar and dims the others", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    const opacities = () =>
      chartOption().series[0].data.map((d: { itemStyle: { opacity: number } }) => d.itemStyle.opacity);
    // the default year is the current one, FY26 (row 1)
    expect(opacities()[1]).toBe(1);
    expect(opacities().filter((o: number) => o === 1)).toHaveLength(1);
    await goTo(2025);
    expect(opacities()[2]).toBe(1);
    expect(opacities()[1]).toBeLessThan(1);
    const total = chartOption().series.at(-1);
    expect(total.markArea.data).toEqual([[{ yAxis: 2 }, { yAxis: 2 }]]);
  });

  it("shows the TCO and the tiles of the selected year only", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    expect(screen.getAllByTestId(/cost-tile-/)).toHaveLength(3);
    await goTo(2027);
    expect(screen.getAllByTestId(/cost-tile-/)).toHaveLength(1);
    expect(screen.getByTestId("cost-tile-lic")).toHaveTextContent("EUR 100");
    expect(screen.getByText("TCO (from FY26)")).toBeInTheDocument();
    await goTo(2024);
    expect(screen.queryAllByTestId(/cost-tile-/)).toHaveLength(0);
    expect(screen.getByText("No cost items for this year.")).toBeInTheDocument();
    expect(screen.getByTestId("echart")).toBeInTheDocument(); // the chart stays drawn
  });

  it("does not clip the chart wrapper", async () => {
    mockGet(response());
    renderSection();
    const chart = await screen.findByTestId("echart");
    expect(getComputedStyle(chart.parentElement!).overflow).not.toBe("hidden");
  });

  it("has no previous / next year buttons of its own any more", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    // only the Time Travel slider's two arrows remain
    expect(screen.queryAllByRole("button", { name: /previous|next/i })).toHaveLength(2);
    expect(i18n.exists("costs.previousYear", { ns: "cards" })).toBe(false);
    expect(i18n.exists("costs.nextYear", { ns: "cards" })).toBe(false);
  });

  it("prints each year's server TCO at the end of its bar, not the sum of its segments", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    const total = chartOption().series.at(-1);
    expect(total.data[0].label.formatter()).toBe("EUR 150"); // FY27: tco 150, items sum 100
    expect(total.data[1].label.formatter()).toBe("EUR 180"); // FY26
  });

  it("draws an unconfirmed selected year at 0.55 and the other years at 0.45", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    await goTo(2027);
    const opacities = chartOption().series[0].data.map(
      (d: { itemStyle: { opacity: number } }) => d.itemStyle.opacity,
    );
    expect(opacities).toEqual([0.55, 0.45, 0.45, 0.45, 0.45, 0.45]);
  });

  it("stacks the items in catalogue order whatever the year holds", async () => {
    mockGet(
      response({
        catalogue: catalogue().slice(0, 2), // lic, sup
        years: [2022, 2023, 2024, 2025, 2026, 2027].map((fy) =>
          fy === FY + 1
            ? year(fy, { items: [{ key: "sup", amount: 7, renewal_date: null, archived: false }] })
            : fy === FY
              ? year(fy, { items: [{ key: "lic", amount: 5, renewal_date: null, archived: false }] })
              : year(fy),
        ),
      }),
    );
    renderSection();
    await screen.findByRole("slider");
    expect(chartOption().series.map((s: { name: string }) => s.name)).toEqual([
      "Licences",
      "Support",
      "",
    ]);
  });

  it("colours the segments, tints the selected row and skips items no year uses", async () => {
    mockGet(response());
    renderSection();
    await screen.findByRole("slider");
    const { series } = chartOption();
    const by = (name: string) => series.find((s: { name: string }) => s.name === name);
    expect(by("Licences").itemStyle.color).toBe(CATEGORICAL_COLORS[0]);
    expect(by("Support").itemStyle.color).toBe(CATEGORICAL_COLORS[1]);
    expect(by("Legacy").itemStyle.color).toBe(STATUS_COLORS.neutral); // archived: grey
    expect(by("Cloud")).toBeUndefined(); // in the catalogue, in no year
    expect(series.at(-1).markArea.itemStyle.color).toBe(alpha(RAG_COLORS.green, 0.12));
  });

  it("shows the fallback banner of an unconfirmed year and confirms it", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole("slider");
    await goTo(2027);
    expect(
      screen.getByText("No amounts entered for FY27 yet. Showing the items of FY26, not confirmed."),
    ).toBeInTheDocument();
    expect(screen.getByText("TCO (from FY26)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm FY27" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/cards/c1/costs/2027/confirm"));
  });

  it("offers in Add only active catalogue items not set for the year", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "+ Add item" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Cloud"]);
  });

  it("opens the edit dialog from a tile", async () => {
    mockGet(response());
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByTestId("cost-tile-sup"));
    expect(await screen.findByText(/Edit cost item/)).toBeInTheDocument();
  });

  it("reloads and reports after a save from the dialog", async () => {
    mockGet(response());
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<CostsSection cardId="c1" onChanged={onChanged} />);
    await user.click(await screen.findByTestId("cost-tile-sup"));
    await user.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(1));
  });

  it("is read-only without edit rights: no Add, no Confirm, tiles do not open", async () => {
    mockGet(response({ can_edit: false }));
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole("slider");
    await goTo(2027);
    expect(screen.queryByRole("button", { name: "+ Add item" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
    await user.click(screen.getByTestId("cost-tile-lic"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers edit controls whenever the server says can_edit", async () => {
    mockGet(response({ can_edit: true }));
    renderSection();
    await screen.findByRole("slider");
    await goTo(2027);
    expect(screen.getByRole("button", { name: "+ Add item" })).toBeTruthy();
  });

  it.each([403, 404])("renders nothing when the server answers %i", async (status) => {
    mockGet(new ApiError("refused", status, null));
    const { container } = renderSection();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows an inline error, not nothing, when loading fails otherwise", async () => {
    mockGet(new ApiError("boom", 500, null));
    renderSection();
    expect(await screen.findByText("Could not load the costs of this card.")).toBeInTheDocument();
  });

  it("mirrors the bars in a right-to-left language", async () => {
    mockGet(response());
    await i18n.changeLanguage("ar");
    try {
      renderSection();
      await screen.findByRole("slider");
      expect(echartState.last().option.yAxis.position).toBe("right");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
