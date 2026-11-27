/**
 * The Lifecycle report's relation rows: a card's dated relations listed
 * beneath it, folded by default, each drawn as a slim bar on the report's own
 * time axis and led by the other card's name.
 *
 * "Now" is pinned (2026-07-01) like in LifecycleReport.mutation.test.tsx, and
 * positions are read from the computed `left` / `width` of the bars.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: (openDialog: () => void) => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => openDialog(),
  }),
}));
vi.mock("@/features/reports/SaveReportDialog", () => ({
  default: (props: { open: boolean; config: unknown }) =>
    props.open ? <pre data-testid="save-config">{JSON.stringify(props.config)}</pre> : null,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean }) =>
    props.open ? <div data-testid="side-panel">{props.cardId}</div> : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeField, makeRelationType, makeSection } from "@/test/fixtures/metamodel";
import { wrapWithProviders } from "@/test/render";
import { LIFECYCLE_PHASE_COLORS } from "@/theme/tokens";
import LifecycleReport from "./LifecycleReport";
import { extractSheetsFromDOM } from "./reportExport";

const NOW = Date.parse("2026-07-01T00:00:00.000Z");
const FIVE_YEARS = 5 * 365.25 * 86400000;

function axis(...dates: string[]) {
  const ts = dates.map((d) => Date.parse(d));
  const min = Math.min(NOW - FIVE_YEARS, ...ts);
  const max = Math.max(NOW + FIVE_YEARS, ...ts);
  const range = max - min;
  const pct = (d: string | number) => (((typeof d === "string" ? Date.parse(d) : d) - min) / range) * 100;
  return { min, max, range, pct };
}

const APP = makeCardType({ key: "Application", label: "Application" });
const ITC = makeCardType({
  key: "ITComponent",
  label: "IT Component",
  color: LIFECYCLE_PHASE_COLORS.phaseOut,
});
const CONTRACT = makeCardType({
  key: "Contract",
  label: "Contract",
  fields_schema: [
    makeSection({
      fields: [
        makeField({ key: "startDate", label: "Start", type: "date" }),
        makeField({ key: "endDate", label: "End", type: "date" }),
      ],
    }),
  ],
});
const RUNS_ON = makeRelationType({
  key: "relAppToITC",
  label: "runs on",
  reverse_label: "hosts",
  source_type_key: "Application",
  target_type_key: "ITComponent",
});
const FEEDS = makeRelationType({
  key: "relAppToApp",
  label: "feeds",
  reverse_label: "is fed by",
  source_type_key: "Application",
  target_type_key: "Application",
});

const ENDED = { active: "2018-03-15", endOfLife: "2024-03-15" };
const CURRENT = { active: "2025-03-15", endOfLife: "2040-06-15" };
const PLANNED = { plan: "2026-03-15", active: "2028-03-15" };

const HUB = {
  id: "hub",
  name: "Hub",
  type: "Application",
  lifecycle: { active: "2020-03-15" },
  relation_lifecycles: [
    {
      relation_type: "relAppToITC",
      direction: "outgoing",
      related_id: "alpha",
      related_name: "Alpha Server",
      related_type: "ITComponent",
      lifecycle: ENDED,
    },
    {
      relation_type: "relAppToApp",
      direction: "incoming",
      related_id: "peer",
      related_name: "Peer",
      related_type: "Application",
      lifecycle: CURRENT,
    },
    {
      relation_type: "relAppToITC",
      direction: "outgoing",
      related_id: "zeta",
      related_name: "Zeta Server",
      related_type: "ITComponent",
      lifecycle: PLANNED,
    },
  ],
};
/** No dates of its own: listed for its relation alone. */
const PEER = {
  id: "peer",
  name: "Peer",
  type: "Application",
  lifecycle: {},
  relation_lifecycles: [
    {
      relation_type: "relAppToApp",
      direction: "outgoing",
      related_id: "hub",
      related_name: "Hub",
      related_type: "Application",
      lifecycle: CURRENT,
    },
  ],
};
const SOLO = { id: "solo", name: "Solo", type: "Application", lifecycle: { active: "2022-01-15" } };

const STORAGE_KEY = "turboea-report:lifecycle";
const LONG = { timeout: 5000 };

function renderReport() {
  return render(wrapWithProviders(<LifecycleReport />, { route: "/reports/lifecycle" }));
}

function storeConfig(cfg: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function chart() {
  const paper = document.querySelector(".report-chart-area .MuiPaper-outlined") as HTMLElement;
  const flex = paper.firstElementChild as HTMLElement;
  const [names, timeline] = Array.from(flex.children) as HTMLElement[];
  const content = timeline.firstElementChild as HTMLElement;
  const [header, ...nameRows] = Array.from(names.children) as HTMLElement[];
  const [axisEl, ...rest] = Array.from(content.children) as HTMLElement[];
  return {
    namesColumn: names,
    header,
    names: nameRows,
    content,
    axis: axisEl,
    rows: rest.slice(0, -1),
    today: rest[rest.length - 1],
  };
}

const leftOf = (el: Element) => parseFloat(getComputedStyle(el).left);
const widthOf = (el: Element) => parseFloat(getComputedStyle(el).width);
const nameTexts = () => chart().names.map((r) => r.textContent);
/** The chevron for a card (the chart's, or the table's in table view). */
const chevron = (name: string) =>
  screen.queryByRole("button", {
    name: new RegExp(`^(Show|Hide) the dated relations of ${name} \\(\\d+ relations?\\)$`),
  });

async function openSaveDialog(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /save report/i }));
  return JSON.parse((await screen.findByTestId("save-config")).textContent!);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  localStorage.clear();
  mockApi.reset();
  hookState.reset();
  withMetamodel([APP, ITC, CONTRACT], [RUNS_ON, FEEDS]);
  mockApi.on("get", "/reports/roadmap", { items: [SOLO, PEER, HUB] });
  mockApi.on("get", "/reports/roadmap?type=Application", { items: [SOLO, PEER, HUB] });
  mockApi.on("get", "/reports/roadmap?type=Contract", {
    items: [
      {
        id: "k1",
        name: "Kilo",
        type: "Contract",
        lifecycle: { active: "2021-01-15" },
        attributes: { startDate: "2024-01-15", endDate: "2027-01-15" },
        relation_lifecycles: [{ ...HUB.relation_lifecycles[0], related_name: "Kilo Server" }],
      },
    ],
  });
  mockApi.on("get", "/cards*", { items: [], total: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LifecycleReport relation rows", () => {
  it("folds every card by default and offers the chevron only where rows exist", async () => {
    renderReport();
    await screen.findByText("Solo", undefined, LONG);
    expect(nameTexts().map((t) => t?.replace(/chevron_right|expand_more/, ""))).toEqual([
      "Hub3",
      "Peer1",
      "Solo",
    ]);
    // The count is a bare number; the sentence is its tooltip and in the chevron's name.
    expect(chevron("Hub")).toHaveAccessibleName("Show the dated relations of Hub (3 relations)");
    expect(chevron("Peer")).toHaveAccessibleName("Show the dated relations of Peer (1 relation)");
    expect(chevron("Hub")).toHaveAttribute("aria-expanded", "false");
    expect(chevron("Peer")).toHaveAttribute("aria-expanded", "false");
    expect(chevron("Solo")).toBeNull();
    // The name column widens for the relation rows.
    expect(getComputedStyle(chart().namesColumn).width).toBe("280px");
    expect(screen.queryByText("Alpha Server")).not.toBeInTheDocument();
  });

  it("points a folded chevron along the reading direction", async () => {
    hookState.isRtl = true;
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    expect(chevron("Hub")).toHaveTextContent("chevron_left");
    fireEvent.click(chevron("Hub")!);
    expect(chevron("Hub")).toHaveTextContent("expand_more");
  });

  it("points a folded chevron right in a left-to-right language", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    expect(chevron("Hub")).toHaveTextContent("chevron_right");
  });

  it("opens one card's relations beneath it, aligned in both columns", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    fireEvent.click(chevron("Hub")!);
    expect(chevron("Hub")).toHaveAttribute("aria-expanded", "true");
    const { names, rows } = chart();
    expect(names).toHaveLength(6);
    expect(rows).toHaveLength(6);
    // The other card's name leads, the verb is read from Hub's side.
    expect(names[1].textContent).toBe("Alpha Serverruns on");
    expect(names[2].textContent).toBe("Peeris fed by");
    expect(names[3].textContent).toBe("Zeta Serverruns on");
    expect(names[4].textContent).toContain("Peer");
    for (const i of [1, 2, 3]) {
      expect(names[i]).toHaveAttribute("data-relation-row");
      expect(rows[i]).toHaveAttribute("data-relation-row");
      expect(names[i]).toHaveAttribute("data-export-row");
    }
    expect(names[0]).not.toHaveAttribute("data-relation-row");
    // Each relation bar sits on its own row, named by the sentence it reads.
    expect(
      within(rows[2]).getByLabelText("Hub is fed by Peer · Active: 2025-03-15"),
    ).toBeInTheDocument();
    expect(within(rows[3]).getByLabelText("Hub runs on Zeta Server · Plan: 2026-03-15")).toBeInTheDocument();
  });

  it("draws a relation's bar on the report's axis, widened to reach its dates", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    // 2040-06-15 lies beyond the ±5-year window: the axis reaches it while folded.
    const g = axis("2018-03-15", "2040-06-15");
    expect(widthOf(chart().content)).toBeCloseTo((g.range / (2 * FIVE_YEARS)) * 100, 6);
    expect(leftOf(chart().today)).toBeCloseTo(g.pct(NOW), 6);
    fireEvent.click(chevron("Hub")!);
    const active = screen.getByLabelText("Hub is fed by Peer · Active: 2025-03-15");
    expect(leftOf(active)).toBeCloseTo(g.pct("2025-03-15"), 6);
    expect(widthOf(active)).toBeCloseTo(g.pct("2040-06-15") - g.pct("2025-03-15"), 6);
    const pin = screen.getByLabelText("Hub is fed by Peer · End of Life: 2040-06-15");
    expect(leftOf(pin)).toBeCloseTo(g.pct("2040-06-15"), 6);
    // Expanding never rescales.
    expect(widthOf(chart().content)).toBeCloseTo((g.range / (2 * FIVE_YEARS)) * 100, 6);
    // The parent's own bar is unchanged and unprefixed.
    expect(screen.getByLabelText("Active: 2020-03-15")).toBeInTheDocument();
  });

  it("mutes an ended relation, and not one in effect or planned", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    fireEvent.click(chevron("Hub")!);
    const { names, rows } = chart();
    expect(getComputedStyle(rows[1]).opacity).toBe("0.5");
    expect(getComputedStyle(names[1]).opacity).toBe("0.6");
    expect(getComputedStyle(rows[2]).opacity).toBe("1");
    expect(getComputedStyle(names[3]).opacity).toBe("1");
  });

  it("lists an undated card with no bar of its own, its relation beneath it", async () => {
    renderReport();
    await screen.findByText("Peer", undefined, LONG);
    fireEvent.click(chevron("Peer")!);
    const { names, rows } = chart();
    expect(rows[1].querySelectorAll("[aria-label]")).toHaveLength(0);
    expect(names[2].textContent).toBe("Hubfeeds");
    expect(within(rows[2]).getByLabelText("Peer feeds Hub · Active: 2025-03-15")).toBeInTheDocument();
  });

  it("opens the related card from a relation row, and nothing from the chevron", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    fireEvent.click(chevron("Hub")!);
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
    fireEvent.click(chart().names[3]);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("zeta");
    fireEvent.click(chart().rows[1]);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("alpha");
    fireEvent.click(chart().names[0]);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("hub");
  });

  it("expands every card from the header, except the ones toggled back", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    const all = within(chart().header).getByRole("button", { name: "Show every card's dated relations" });
    fireEvent.click(all);
    expect(chart().names).toHaveLength(7);
    expect(chevron("Hub")).toHaveAttribute("aria-expanded", "true");
    expect(chevron("Peer")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chevron("Peer")!);
    expect(chart().names).toHaveLength(6);
    expect(await openSaveDialog()).toMatchObject({ relExpandAll: true, relToggledIds: ["peer"] });
    // Collapsing all forgets the exceptions.
    fireEvent.click(
      within(chart().header).getByRole("button", { name: "Hide every card's dated relations" }),
    );
    expect(chart().names).toHaveLength(3);
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.relExpandAll).toBe(false);
      expect(stored.relToggledIds).toEqual([]);
    });
  });

  it("persists a toggled card and restores the saved state, ignoring garbage", async () => {
    storeConfig({ relExpandAll: true, relToggledIds: ["peer", 7, null] });
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    expect(chevron("Hub")).toHaveAttribute("aria-expanded", "true");
    expect(chevron("Peer")).toHaveAttribute("aria-expanded", "false");
    expect(await openSaveDialog()).toMatchObject({ relExpandAll: true, relToggledIds: ["peer"] });
  });

  it("ignores a saved expand-all that is not a boolean", async () => {
    storeConfig({ relExpandAll: "yes", relToggledIds: "hub" });
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    expect(chevron("Hub")).toHaveAttribute("aria-expanded", "false");
    expect(await openSaveDialog()).toMatchObject({ relExpandAll: false, relToggledIds: [] });
  });

  it("folds everything again on reset", async () => {
    storeConfig({ relExpandAll: true, relToggledIds: ["peer"] });
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(chevron("Hub")).toHaveAttribute("aria-expanded", "false"));
    expect(chevron("Peer")).toHaveAttribute("aria-expanded", "false");
    expect(await openSaveDialog()).toMatchObject({ relExpandAll: false, relToggledIds: [] });
  });

  it("works with a chosen type, and a new type forgets the toggled cards", async () => {
    storeConfig({ cardTypeKey: "Application", relToggledIds: ["hub"] });
    renderReport();
    await screen.findByText("Alpha Server", undefined, LONG);
    expect(chevron("Hub")).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /card type/i }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Contract" }));
    await screen.findByText("Kilo", undefined, LONG);
    expect(chevron("Kilo")).toHaveAttribute("aria-expanded", "false");
    expect(await openSaveDialog()).toMatchObject({ cardTypeKey: "Contract", relToggledIds: [] });
  });

  it("hides relation rows in the date-range view", async () => {
    storeConfig({ cardTypeKey: "Contract", relExpandAll: true });
    renderReport();
    await screen.findByText("Kilo Server", undefined, LONG);
    fireEvent.click(screen.getByRole("checkbox", { name: /date range view/i }));
    await waitFor(() => expect(screen.queryByText("Kilo Server")).not.toBeInTheDocument());
    expect(chevron("Kilo")).toBeNull();
    expect(within(chart().header).queryByRole("button")).toBeNull();
    expect(getComputedStyle(chart().namesColumn).width).toBe("200px");
  });

  it("keeps the narrow column and no header button when nothing has dated relations", async () => {
    mockApi.on("get", "/reports/roadmap", { items: [SOLO] });
    renderReport();
    await screen.findByText("Solo", undefined, LONG);
    expect(getComputedStyle(chart().namesColumn).width).toBe("200px");
    expect(chart().header.children).toHaveLength(0);
    // No spacer either: the row is exactly the plain card row.
    expect(chart().names[0].children).toHaveLength(1);
  });

  it("lists expanded relations in the table with their state and dates", async () => {
    storeConfig({ view: "table", relToggledIds: ["hub"] });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    const rows = screen.getAllByRole("row").slice(1);
    const cells = (i: number) => within(rows[i]).getAllByRole("cell").map((c) => c.textContent);
    expect(rows).toHaveLength(6);
    expect(cells(1)).toEqual([
      "Alpha Server · runs on",
      "IT Component",
      "Ended",
      "—",
      "—",
      "2018-03-15",
      "—",
      "2024-03-15",
    ]);
    expect(cells(2).slice(0, 3)).toEqual(["Peer · is fed by", "Application", "In effect"]);
    expect(cells(3).slice(0, 5)).toEqual(["Zeta Server · runs on", "IT Component", "Planned", "2026-03-15", "—"]);
    expect(rows[1]).toHaveAttribute("data-relation-row");
    fireEvent.click(rows[3]);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("zeta");
    // The Name header carries the expand-all control here too.
    fireEvent.click(screen.getByRole("button", { name: "Show every card's dated relations" }));
    expect(screen.getAllByRole("row")).toHaveLength(1 + 3 + 3 + 1);
  });

  it("hovers the relation count for the full sentence", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    const count = chart().names[0].querySelector("[data-relation-count]")!;
    expect(count).toHaveTextContent(/^3$/);
    fireEvent.mouseOver(count);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("3 relations");
  });

  it("folds and unfolds one card in the table, without opening it", async () => {
    storeConfig({ view: "table" });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    expect(chevron("Solo")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    fireEvent.click(chevron("Peer")!);
    expect(chevron("Peer")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();
    // The same state the chart reads, and saves.
    expect(await openSaveDialog()).toMatchObject({ relToggledIds: ["peer"] });
    fireEvent.click(chevron("Peer")!);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    // A card without relations keeps its name in line behind a spacer.
    const soloCell = within(screen.getAllByRole("row")[3]).getAllByRole("cell")[0];
    expect(soloCell.firstElementChild!.childNodes).toHaveLength(2);
    expect(soloCell.firstElementChild!.querySelector("button")).toBeNull();
  });

  it("exports the table with a clean Name header and readable relation rows", async () => {
    storeConfig({ view: "table", relToggledIds: ["peer"] });
    renderReport();
    const table = await screen.findByRole("table", undefined, LONG);
    const [sheet] = extractSheetsFromDOM(table.parentElement as HTMLElement);
    expect(sheet.columns[0].label).toBe("Name");
    expect(sheet.rows.map((r) => r.c0)).toEqual(["Hub", "Peer", "Hub · feeds", "Solo"]);
    expect(sheet.rows[2]).toEqual({
      c0: "Hub · feeds",
      c1: "Application",
      c2: "In effect",
      c3: "\u2014",
      c4: "\u2014",
      c5: "2025-03-15",
      c6: "\u2014",
      c7: "2040-06-15",
    });
  });

  it("scrolls the timeline to the last five years from the right in a right-to-left language", async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 2000 });
    try {
      const g = axis("2018-03-15", "2040-06-15");
      const expected = 2000 * ((NOW - FIVE_YEARS - g.min) / g.range);
      hookState.isRtl = true;
      const { unmount } = renderReport();
      await screen.findByText("Hub", undefined, LONG);
      const timeline = chart().content.parentElement!;
      expect(timeline.scrollLeft).toBeCloseTo(-expected, 3);
      unmount();
      hookState.isRtl = false;
      renderReport();
      await screen.findByText("Hub", undefined, LONG);
      expect(chart().content.parentElement!.scrollLeft).toBeCloseTo(expected, 3);
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, "scrollWidth", desc);
      else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });

  it("draws a relation row's dot in the other card type's colour", async () => {
    renderReport();
    await screen.findByText("Hub", undefined, LONG);
    fireEvent.click(chevron("Hub")!);
    const dot = chart().names[1].firstElementChild!;
    const n = parseInt(LIFECYCLE_PHASE_COLORS.phaseOut.slice(1), 16);
    expect(getComputedStyle(dot).backgroundColor).toBe(
      `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`,
    );
  });

  it("does not widen the axis with relation dates in the date-range view", async () => {
    mockApi.on("get", "/reports/roadmap?type=Contract", {
      items: [
        {
          id: "k1",
          name: "Kilo",
          type: "Contract",
          lifecycle: {},
          attributes: { startDate: "2024-01-15", endDate: "2027-01-15" },
          relation_lifecycles: [
            { ...HUB.relation_lifecycles[0], related_name: "Far Server", lifecycle: { active: "2045-06-15" } },
          ],
        },
      ],
    });
    storeConfig({ cardTypeKey: "Contract" });
    renderReport();
    await screen.findByText("Kilo", undefined, LONG);
    // Phase view: the relation's 2045 date stretches the axis.
    const wide = axis("2045-06-15");
    expect(widthOf(chart().content)).toBeCloseTo((wide.range / (2 * FIVE_YEARS)) * 100, 6);
    fireEvent.click(screen.getByRole("checkbox", { name: /date range view/i }));
    // Date-range view: relation rows are off, so their dates do not count.
    await waitFor(() => expect(widthOf(chart().content)).toBeCloseTo(100, 6));
  });

  it("mutes an ended relation's table row and leaves the others as they are", async () => {
    storeConfig({ view: "table", relToggledIds: ["hub"] });
    renderReport();
    await screen.findByRole("table", undefined, LONG);
    const rows = screen.getAllByRole("row").slice(1);
    // Hub, then Alpha (ended), Peer (in effect), Zeta (planned).
    expect(getComputedStyle(rows[1]).opacity).toBe("0.6");
    expect(getComputedStyle(rows[2]).opacity).toBe("1");
    expect(getComputedStyle(rows[3]).opacity).toBe("1");
  });
});
