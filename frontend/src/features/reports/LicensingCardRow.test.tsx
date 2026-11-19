/**
 * One card of the Licensing report's list: collapsed it is a header button (type icon / logo,
 * name, alias, status); expanded it shows the card's pair bars for the selected year.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import type { LicenseMetricItem, LicenseReportRow } from "@/types";
import LicensingCardRow from "./LicensingCardRow";

vi.mock("@/components/charts/EChart", () => import("@/test/echartMock").then((m) => m.echartModule()));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: () => ({ key: "Application", icon: "apps", color: "#0f7eb5", label: "Application" }),
  }),
}));
const catalogue = vi.hoisted(() => ({
  state: { metrics: [] as unknown[], loading: false, failed: false, reload: () => {} },
}));
vi.mock("@/hooks/useLicenseCatalogue", () => ({ useLicenseCatalogue: () => catalogue.state }));

import { echartState } from "@/test/echartMock";

const type = (key: string, label: string, sort: number) => ({
  id: key,
  metric_key: "users",
  key,
  label,
  sort_order: sort,
  archived: false,
  translations: {},
});
const CATALOGUE: LicenseMetricItem[] = [
  {
    id: "users",
    key: "users",
    label: "Users",
    sort_order: 1,
    archived: false,
    translations: {},
    types: [type("admin", "Admin", 1), type("dev", "Dev", 2)],
  },
];
const ROW: LicenseReportRow = {
  id: "A",
  name: "Alpha",
  type: "Application",
  alias: "ALP",
  attributes: {},
  status: "over",
  worst_pct: 120,
  worst_no_licence: false,
  confirmed: true,
  by_metric: [
    {
      metric: "users",
      status: "over",
      worst_pct: 120,
      licensed_total: 20,
      actual_total: 15,
      types: [
        { key: "admin", licensed: 10, actual: 12, pct: 120, no_licence: false, status: "over" },
        { key: "dev", licensed: 10, actual: 3, pct: 30, no_licence: false, status: "compliant" },
      ],
    },
  ],
};

const baseProps = (): React.ComponentProps<typeof LicensingCardRow> => ({
  row: ROW,
  expanded: false,
  onToggle: vi.fn(),
  selectedPairKey: null,
  onPick: vi.fn(),
  onOpen: vi.fn(),
  onDrill: vi.fn(),
});

function setup(over: Partial<React.ComponentProps<typeof LicensingCardRow>> = {}) {
  const props: React.ComponentProps<typeof LicensingCardRow> = {
    row: ROW,
    expanded: false,
    onToggle: vi.fn(),
    selectedPairKey: null,
    onPick: vi.fn(),
    onOpen: vi.fn(),
    onDrill: vi.fn(),
    ...over,
  };
  render(<LicensingCardRow {...props} />);
  return props;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  echartState.reset();
  catalogue.state = { metrics: CATALOGUE, loading: false, failed: false, reload: () => {} };
});

describe("LicensingCardRow", () => {
  it("collapsed: name, alias and status, and no chart", () => {
    setup();
    const header = screen.getByRole("button", { name: /^Alpha/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("ALP");
    expect(header).toHaveTextContent("Over-licensed");
    expect(echartState.props).toHaveLength(0);
  });

  it("the header toggles on click and on the keyboard", async () => {
    const p = setup();
    const header = screen.getByRole("button", { name: /^Alpha/ });
    await userEvent.click(header);
    header.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(p.onToggle).toHaveBeenCalledTimes(3);
    expect(p.onToggle).toHaveBeenCalledWith("A");
  });

  it("expanded: one chart per metric with the pair buttons, a pick reports the pair key", async () => {
    const p = setup({ expanded: true });
    expect(screen.getByRole("button", { name: /^Alpha/ })).toHaveAttribute("aria-expanded", "true");
    expect(echartState.byName("Licensed and actual counts per license type: Users")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Dev: / }));
    expect(p.onPick).toHaveBeenCalledWith("A", "users:dev");
  });

  it("the picked pair is marked", () => {
    setup({ expanded: true, selectedPairKey: "users:dev" });
    expect(screen.getByRole("button", { name: /^Dev: / })).toHaveAttribute("aria-pressed", "true");
  });

  it("the collapsed chevron points the reading direction", async () => {
    const { unmount } = render(<LicensingCardRow {...baseProps()} />);
    expect(screen.getByRole("button", { name: /^Alpha/ })).toHaveTextContent("chevron_right");
    unmount();
    await i18n.changeLanguage("ar");
    render(<LicensingCardRow {...baseProps()} />);
    expect(screen.getByRole("button", { name: /^Alpha/ })).toHaveTextContent("chevron_left");
  });

  it("the open button opens the card and does not toggle", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Open Alpha" }));
    expect(p.onOpen).toHaveBeenCalledWith("A");
    expect(p.onToggle).not.toHaveBeenCalled();
  });

  it("shows no status for a row without one (a Platform's card)", () => {
    setup({ row: { ...ROW, status: null } });
    expect(screen.queryByText("Over-licensed")).toBeNull();
  });

  it("draws the card's logo when it has one", () => {
    setup({ row: { ...ROW, logo_updated_at: "2026-01-01T00:00:00Z" } });
    expect(document.querySelector("img")?.getAttribute("src")).toContain("/api/v1/cards/A/logo");
  });

  it("a card with no pair points to the card and the import when expanded", () => {
    setup({ row: { ...ROW, by_metric: [], status: "no_actual_data" }, expanded: true });
    expect(screen.getByText("Add licensing from the card, or import rows.")).toBeInTheDocument();
  });

  it("a right click on the header drills to the card", async () => {
    const p = setup();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: /^Alpha/ }) });
    expect(p.onDrill).toHaveBeenCalledWith("A");
  });

  it("a year carried forward (not confirmed) is drawn faded", () => {
    setup({ row: { ...ROW, confirmed: false }, expanded: true });
    const licensed = echartState.byName("Licensed and actual counts per license type: Users").option.series[0];
    expect(licensed.data[0].itemStyle.opacity).toBe(0.2);
  });

  it("a confirmed year is drawn at full strength", () => {
    setup({ expanded: true });
    const licensed = echartState.byName("Licensed and actual counts per license type: Users").option.series[0];
    expect(licensed.data[0].itemStyle.opacity).toBe(0.35);
  });

  it("a failed catalogue shows the error, never a raw key", () => {
    catalogue.state = { metrics: [], loading: false, failed: true, reload: () => {} };
    setup({ expanded: true });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/users:admin/)).toBeNull();
    expect(echartState.props).toHaveLength(0);
  });

  it("a loading catalogue draws no chart yet", () => {
    catalogue.state = { metrics: [], loading: true, failed: false, reload: () => {} };
    setup({ expanded: true });
    expect(echartState.props).toHaveLength(0);
  });
});
