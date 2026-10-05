/**
 * Branch coverage for the EOL report beyond the "no EOL data" KPI tested in
 * EolReport.test.tsx: the timeline (alerts, bars, support and EOL markers,
 * manual rows, expandable affected apps), the toolbar filters, the table's
 * sorts and countdowns, the empty states and the shell actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const saved = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  saveDialogOpen: false,
  setSaveDialogOpen: (() => {}) as (open: boolean) => void,
  resetAll: (() => {}) as () => void,
  persistConfig: (() => {}) as (cfg: unknown) => void,
  captureAndSave: (() => {}) as () => void,
}));
vi.mock("@/hooks/useSavedReport", () => ({
  useSavedReport: () => ({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: saved.saveDialogOpen,
    setSaveDialogOpen: saved.setSaveDialogOpen,
    loadedConfig: null,
    consumeConfig: () => saved.config,
    resetSavedReport: () => {},
    persistConfig: saved.persistConfig,
    resetAll: saved.resetAll,
    reportType: "eol",
  }),
}));
vi.mock("@/hooks/useThumbnailCapture", () => ({
  useThumbnailCapture: () => ({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: () => saved.captureAndSave(),
  }),
}));
vi.mock("./SaveReportDialog", () => ({
  default: (props: { open: boolean; onClose: () => void }) =>
    props.open ? <button onClick={props.onClose}>close-save</button> : null,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean; onClose: () => void }) =>
    props.open ? (
      <div data-testid="side-panel">
        {props.cardId}
        <button onClick={props.onClose}>close-panel</button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";
import { toIsoDate } from "@/lib/dates";
import EolReport from "./EolReport";

const inDays = (n: number) => toIsoDate(new Date(Date.now() + n * 86400000));

const TYPES = [
  makeCardType({ key: "ITComponent", label: "IT Component", color: "#d29270" }),
  makeCardType({ key: "Application", label: "Application", color: "#0f7eb5" }),
];

const item = (over: Record<string, unknown> & { id: string; name: string }) => ({
  type: "ITComponent",
  eol_product: null,
  eol_cycle: null,
  status: "supported",
  source: "api",
  cycle_data: null,
  lifecycle: {},
  affected_apps: [],
  ...over,
});

const ITEMS = [
  item({
    id: "nginx",
    name: "Nginx LB",
    eol_product: "nginx",
    eol_cycle: "1.25",
    status: "eol",
    cycle_data: { cycle: "1.25", releaseDate: "2018-01-01", eol: "2020-01-01", support: "2019-06-01", latest: "1.25.4" },
    affected_apps: [
      { id: "app-a", name: "Shop" },
      { id: "app-b", name: "Portal" },
    ],
  }),
  item({
    id: "pg",
    name: "Postgres",
    eol_product: "postgresql",
    eol_cycle: "12",
    status: "approaching",
    cycle_data: { eol: inDays(60), support: true },
    affected_apps: [{ id: "app-c", name: "Billing" }],
  }),
  item({
    id: "redis",
    name: "Redis",
    eol_product: "redis",
    eol_cycle: "7",
    status: "supported",
    cycle_data: { eol: inDays(800), support: false },
  }),
  item({
    id: "crm",
    name: "Legacy CRM",
    type: "Application",
    status: "approaching",
    source: "manual",
    cycle_data: { eol: inDays(10) },
  }),
  item({ id: "mystery", name: "Mystery", eol_product: "foo", eol_cycle: "1", status: "unknown" }),
  item({ id: "box", name: "Unknown Box", status: "missing", source: "none" }),
];

const SUMMARY = {
  eol: 1,
  approaching: 2,
  supported: 1,
  missing: 1,
  impacted_apps: 2,
  approaching_impacted_apps: 1,
  manual: 1,
};

function renderReport() {
  return render(
    <MemoryRouter>
      <EolReport />
    </MemoryRouter>,
  );
}

async function pick(label: RegExp, option: RegExp) {
  // The request the caller waited on is recorded when it is sent, not when its
  // response renders, so the toolbar may still be behind a spinner here.
  fireEvent.mouseDown(await screen.findByRole("combobox", { name: label }, { timeout: 5000 }));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: option }));
}

const loaded = () => screen.findAllByText("Nginx LB");

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(TYPES);
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.captureAndSave = vi.fn();
  mockApi.on("get", "/reports/eol", { items: ITEMS, summary: SUMMARY });
});

describe("EolReport timeline", () => {
  it("waits for the report before drawing", () => {
    mockApi.on("get", "/reports/eol", () => new Promise(() => {}));
    renderReport();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("summarises what has reached and what approaches its end of life", async () => {
    renderReport();
    await loaded();
    const alerts = screen.getAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("1 item has reached End of Life, impacting 2 application(s)");
    expect(alerts[1]).toHaveTextContent(
      "2 items are approaching End of Life within 6 months, impacting 1 additional application(s)",
    );
  });

  it("uses the singular wording and leaves impact out when nothing is affected", async () => {
    mockApi.on("get", "/reports/eol", {
      items: ITEMS,
      summary: { ...SUMMARY, approaching: 1, impacted_apps: 0, approaching_impacted_apps: 0 },
    });
    renderReport();
    await loaded();
    const alerts = screen.getAllByRole("alert");
    expect(alerts[0]).toHaveTextContent("1 item has reached End of Life");
    expect(alerts[0]).not.toHaveTextContent("impacting");
    expect(alerts[1]).toHaveTextContent("1 item is approaching End of Life within 6 months");
    expect(alerts[1]).not.toHaveTextContent("impacting");
  });

  it("draws each product's bar, support span and EOL marker with dated tooltips", async () => {
    renderReport();
    await loaded();
    expect(screen.getByLabelText("Nginx LB (nginx 1.25)")).toBeInTheDocument();
    expect(screen.getByLabelText(/^nginx 1\.25 · EOL: Jan 1, 2020 \(\d+d ago\)$/)).toBeInTheDocument();
    expect(screen.getByLabelText("Active support until Jun 1, 2019")).toBeInTheDocument();
    expect(screen.getByLabelText("End of Life: Jan 1, 2020")).toBeInTheDocument();
    expect(screen.getByLabelText(/^postgresql 12 · EOL: .* \(2mo\)$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^redis 7 · EOL: .* \(2\.2y\)$/)).toBeInTheDocument();
    // A product with no cycle data still gets a bar, just with nothing dated.
    expect(screen.getByLabelText("foo 1 · EOL: —")).toBeInTheDocument();
    expect(screen.getByLabelText("Impacts 2 apps")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("marks a manually maintained date as such", async () => {
    renderReport();
    await loaded();
    expect(screen.getByLabelText("Legacy CRM (manually maintained)")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Manual · EOL: .* \(\d+d\)$/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/End-of-Life date was manually maintained/).length).toBeGreaterThan(0);
    expect(screen.getByText("lifecycle")).toBeInTheDocument();
  });

  it("expands a product to its affected apps and opens one", async () => {
    renderReport();
    await loaded();
    fireEvent.click(screen.getByLabelText("Nginx LB (nginx 1.25)"));
    fireEvent.click(await screen.findByText("Shop"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("app-a");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));

    fireEvent.click(screen.getByLabelText("Nginx LB (nginx 1.25)"));
    await waitFor(() => expect(screen.queryByText("Shop")).not.toBeInTheDocument());
  });

  it("opens a product from its bar", async () => {
    renderReport();
    await loaded();
    fireEvent.click(screen.getByLabelText(/^redis 7 · EOL/));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("redis");
  });

  it("explains an empty report", async () => {
    mockApi.on("get", "/reports/eol", { items: [], summary: { ...SUMMARY, eol: 0, approaching: 0 } });
    renderReport();
    expect(await screen.findByText(/No applications or IT components found/)).toBeInTheDocument();
  });
});

describe("EolReport filters", () => {
  it("narrows by status, type and source, and says when nothing is left", async () => {
    renderReport();
    await loaded();
    await pick(/^status$/i, /Approaching EOL/);
    await waitFor(() => expect(screen.queryByText("Nginx LB")).not.toBeInTheDocument());
    expect(screen.getAllByText("Postgres").length).toBeGreaterThan(0);

    await pick(/^type$/i, /^Application$/);
    await waitFor(() => expect(screen.queryByText("Postgres")).not.toBeInTheDocument());
    expect(screen.getAllByText("Legacy CRM").length).toBeGreaterThan(0);

    await pick(/^source$/i, /endoflife\.date/);
    expect(await screen.findByText("No items match the current filters.")).toBeInTheDocument();
    // Source options carry their icon glyph in the accessible name.
    await pick(/^source$/i, /Manual$/);
    expect((await screen.findAllByText("Legacy CRM")).length).toBeGreaterThan(0);

    const params = document.querySelector(".report-print-params") as HTMLElement;
    expect(within(params).getByText("Approaching EOL")).toBeInTheDocument();
    expect(within(params).getByText("Application")).toBeInTheDocument();
    expect(within(params).getByText("Manual")).toBeInTheDocument();
  });

  it("restores saved filters and names them in the print strip", async () => {
    saved.config = { filterType: "ITComponent", filterSource: "api", filterStatus: "bogus", view: "table" };
    renderReport();
    await screen.findByText("No items match the current filters.");
    const params = document.querySelector(".report-print-params") as HTMLElement;
    expect(within(params).getByText("IT Component")).toBeInTheDocument();
    expect(within(params).getByText("endoflife.date")).toBeInTheDocument();
    // An unknown status filter is named raw and matches nothing.
    expect(within(params).getByText("bogus")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("EolReport table", () => {
  const names = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);

  it("lists versions, dates and countdowns, with the right source badge", async () => {
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");
    // Default sort: status order, missing last.
    expect(names()).toEqual(["Nginx LB", "Postgres", "Legacy CRM", "Mystery", "Redis", "Unknown Box"]);

    const nginx = screen.getByRole("row", { name: /^Nginx LB/ });
    expect(within(nginx).getByText("Jan 1, 2020")).toBeInTheDocument();
    expect(within(nginx).getByText(/^\(\d+d ago\)$/)).toBeInTheDocument();
    expect(within(nginx).getByText("Jun 1, 2019")).toBeInTheDocument();
    expect(within(nginx).getByText("1.25.4")).toBeInTheDocument();
    expect(within(nginx).getByText("API")).toBeInTheDocument();
    expect(within(nginx).getByLabelText("Shop, Portal")).toHaveTextContent("2 apps");

    const pg = screen.getByRole("row", { name: /^Postgres/ });
    expect(within(pg).getByText("Yes (EOL)")).toBeInTheDocument();
    expect(within(pg).getByText("(2mo)")).toBeInTheDocument();
    expect(within(pg).getByText("1 app")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /^Redis/ })).getByText("No")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /^Legacy CRM/ })).getByText("Manual")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /^Unknown Box/ })).getAllByText("—").length)
      .toBeGreaterThanOrEqual(5);
  });

  it("sorts by every sortable column, both ways", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderReport();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()[0]).toBe("Legacy CRM");
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(names()[0]).toBe("Unknown Box");

    await user.click(screen.getByRole("button", { name: "Type" }));
    expect(names()[0]).toBe("Legacy CRM");

    await user.click(screen.getByRole("button", { name: "Product" }));
    expect(names().slice(-1)).toEqual(["Redis"]);

    await user.click(screen.getByRole("button", { name: "Source" }));
    // api < manual < none, stable on the served order within a source.
    expect(names()).toEqual(["Nginx LB", "Postgres", "Redis", "Mystery", "Legacy CRM", "Unknown Box"]);

    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(names()[0]).toBe("Nginx LB");
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(names()[0]).toBe("Unknown Box");

    await user.click(screen.getByRole("button", { name: "EOL Date" }));
    expect(names()[0]).toBe("Nginx LB");

    await user.click(screen.getByRole("button", { name: "Impact" }));
    expect(names()[5]).toBe("Nginx LB");

    await user.click(screen.getByRole("row", { name: /^Redis/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("redis");
  });

  it("restores a saved sort", async () => {
    saved.config = { view: "table", sortK: "impact", sortD: "desc" };
    renderReport();
    await screen.findByRole("table");
    expect(names()[0]).toBe("Nginx LB");
  });
});

describe("EolReport shell actions", () => {
  it("resets every control to its default", async () => {
    saved.config = { view: "table", filterStatus: "eol", sortK: "name", sortD: "desc" };
    renderReport();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith({
        view: "chart",
        filterStatus: "",
        filterType: "",
        filterSource: "",
        sortK: "status",
        sortD: "asc",
      }),
    );
  });

  it("saves through the thumbnail capture and closes the dialog", async () => {
    saved.saveDialogOpen = true;
    renderReport();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.captureAndSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });
});
