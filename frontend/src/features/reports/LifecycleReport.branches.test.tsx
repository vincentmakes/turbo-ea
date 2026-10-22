/**
 * Branch coverage for the Lifecycle report beyond its smoke tests and scope
 * filter (LifecycleReport.test.tsx): the date-range mode a type with two date
 * fields offers (bars, colour-by, legacy config keys), the phase timeline's
 * tooltips and end-of-life marker, the table's sorting in both modes, and the
 * shell actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

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
    reportType: "lifecycle",
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
import { makeCardType, makeField, makeOption, makeSection } from "@/test/fixtures/metamodel";
import LifecycleReport from "./LifecycleReport";

const APP = makeCardType({ key: "Application", label: "Application", fields_schema: [] });
const ITC = makeCardType({
  key: "ITComponent",
  label: "IT Component",
  fields_schema: [
    makeSection({
      section: "Details",
      fields: [
        makeField({ key: "contractEndDate", label: "Contract End", type: "date" }),
        makeField({ key: "contractStartDate", label: "Contract Start", type: "date" }),
        makeField({
          key: "status",
          label: "Status",
          type: "single_select",
          options: [
            makeOption({ key: "active", label: "Running", color: "#4caf50" }),
            makeOption({ key: "retiring", label: "Retiring", color: "#ff9800" }),
            makeOption({ key: "grey", label: "Colourless" }),
          ],
        }),
        makeField({ key: "tier", label: "Tier", type: "single_select", options: [makeOption({ key: "t1", label: "Tier 1", color: "#000" })] }),
        makeField({ key: "empty", label: "Empty", type: "single_select", options: [] }),
      ],
    }),
  ],
});
/** Two date fields whose keys say nothing about start or end, and nothing to colour by. */
const PROJECT = makeCardType({
  key: "Project",
  label: "Project",
  fields_schema: [
    makeSection({
      section: "Dates",
      fields: [
        makeField({ key: "kickoff", label: "Kickoff", type: "date" }),
        makeField({ key: "golive", label: "Go-live", type: "date" }),
      ],
    }),
  ],
});

const PHASE_ITEMS = [
  {
    id: "oracle",
    name: "Oracle DB",
    type: "Application",
    lifecycle: { plan: "2018-01-01", active: "2019-03-01", phaseOut: "2022-01-01", endOfLife: "2024-06-30" },
  },
  { id: "pg", name: "PostgreSQL", type: "ITComponent", lifecycle: { active: "2021-01-01" } },
  { id: "future", name: "Future Thing", type: "Application", lifecycle: { plan: "2031-01-01" } },
  { id: "bare", name: "Bare", type: "Application", lifecycle: {} },
];

const RANGE_ITEMS = [
  {
    id: "both",
    name: "Both Dates",
    type: "ITComponent",
    lifecycle: {},
    attributes: { contractStartDate: "2024-01-15", contractEndDate: "2025-12-15", status: "active" },
  },
  {
    id: "start",
    name: "Start Only",
    type: "ITComponent",
    lifecycle: {},
    attributes: { contractStartDate: "2023-05-15", status: "unknown" },
  },
  {
    id: "end",
    name: "End Only",
    type: "ITComponent",
    lifecycle: {},
    attributes: { contractEndDate: "2027-02-15", status: "grey" },
  },
  { id: "none", name: "No Dates", type: "ITComponent", lifecycle: {}, attributes: {} },
];

const roadmapCalls = () => mockApi.callsOf("get", "/reports/roadmap*").map((c) => c.path);

function renderLifecycle() {
  return render(
    <MemoryRouter>
      <LifecycleReport />
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

const bodyRows = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([APP, ITC, PROJECT]);
  saved.config = null;
  saved.saveDialogOpen = false;
  saved.setSaveDialogOpen = vi.fn();
  saved.resetAll = vi.fn();
  saved.persistConfig = vi.fn();
  saved.captureAndSave = vi.fn();
  mockApi.on("get", "/reports/roadmap", { items: PHASE_ITEMS });
  mockApi.on("get", "/reports/roadmap?type=ITComponent", { items: RANGE_ITEMS });
  mockApi.on("get", "/reports/roadmap?type=Project", { items: [] });
  mockApi.on("get", "/cards*", { items: [], total: 0 });
});

describe("LifecycleReport phase timeline", () => {
  it("draws one segment per phase with its date, and an end-of-life marker", async () => {
    renderLifecycle();
    await screen.findByText("Oracle DB");
    expect(screen.getByLabelText("Plan: 2018-01-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Active: 2019-03-01")).toBeInTheDocument();
    expect(screen.getByLabelText("Phase Out: 2022-01-01")).toBeInTheDocument();
    expect(screen.getByLabelText("End of Life: 2024-06-30")).toBeInTheDocument();
    // A card with only a future plan date is still in Plan.
    expect(screen.getByLabelText("Plan: 2031-01-01")).toBeInTheDocument();
    expect(screen.getByText("1 item at End of Life")).toBeInTheDocument();
  });

  it("counts the cards in each current phase", async () => {
    renderLifecycle();
    await screen.findByText("Oracle DB");
    const chips = Array.from(document.querySelectorAll(".report-legend .MuiChip-label")).map(
      (c) => c.textContent,
    );
    // plan (future + bare), phaseIn, active (pg), phaseOut, endOfLife (oracle)
    expect(chips).toEqual(["2", "0", "1", "0", "1"]);
  });

  it("opens a card from its name and from its bar", async () => {
    renderLifecycle();
    fireEvent.click(await screen.findByText("PostgreSQL"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("pg");
    fireEvent.click(screen.getByRole("button", { name: "close-panel" }));
    expect(screen.queryByTestId("side-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Active: 2021-01-01"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("pg");
  });

  it("asks for one type when a card type is picked", async () => {
    renderLifecycle();
    await screen.findByText("Oracle DB");
    await pick(/card type/i, /^Project$/);
    await waitFor(() => expect(roadmapCalls()).toContain("/reports/roadmap?type=Project"));
    expect(await screen.findByText("No lifecycle data found.")).toBeInTheDocument();
  });
});

describe("LifecycleReport table (phases)", () => {
  it("sorts by name, type, current phase and end of life, both ways", async () => {
    const user = userEvent.setup();
    saved.config = { view: "table" };
    renderLifecycle();
    await screen.findByRole("table");
    expect(bodyRows()).toEqual(["Bare", "Future Thing", "Oracle DB", "PostgreSQL"]);

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(bodyRows()).toEqual(["PostgreSQL", "Oracle DB", "Future Thing", "Bare"]);

    await user.click(screen.getByRole("button", { name: "Type" }));
    expect(bodyRows()[3]).toBe("PostgreSQL");

    await user.click(screen.getByRole("button", { name: "Current Phase" }));
    // In lifecycle order: plan < active < endOfLife; a tie goes by name.
    expect(bodyRows()).toEqual(["Bare", "Future Thing", "PostgreSQL", "Oracle DB"]);
    await user.click(screen.getByRole("button", { name: "Current Phase" }));
    expect(bodyRows()).toEqual(["Oracle DB", "PostgreSQL", "Bare", "Future Thing"]);

    // Phase chips and dashes for unset dates.
    const oracle = screen.getByRole("row", { name: /Oracle DB/ });
    expect(within(oracle).getByText("End of Life")).toBeInTheDocument();
    expect(within(oracle).getByText("2024-06-30")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /^Bare/ })).getAllByText("—")).toHaveLength(5);

    await user.click(oracle);
    expect(screen.getByTestId("side-panel")).toHaveTextContent("oracle");
  });
});

describe("LifecycleReport table (saved end-of-life sort)", () => {
  it("restores a sort on end of life, cards without one last", async () => {
    saved.config = { view: "table", sortK: "eol", sortD: "asc" };
    renderLifecycle();
    await screen.findByRole("table");
    expect(bodyRows()[0]).toBe("Oracle DB");
  });
});

/** Date-range mode is switched on through its toggle (see the restore note below). */
async function enableDateRange() {
  fireEvent.click(await screen.findByRole("checkbox", { name: /date range view/i }));
  await screen.findByRole("combobox", { name: /color by/i });
}

describe("LifecycleReport date-range mode", () => {
  it("is offered only for a type with two date fields, and colours by its first select", async () => {
    const user = userEvent.setup();
    renderLifecycle();
    await screen.findByText("Oracle DB");
    expect(screen.queryByRole("checkbox", { name: /date range view/i })).not.toBeInTheDocument();

    await pick(/card type/i, /IT Component/);
    await screen.findByText("Both Dates");
    const toggle = screen.getByRole("checkbox", { name: /date range view/i });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByRole("combobox", { name: /color by/i })).toHaveTextContent("Status");

    // The date range bars replace the phase legend; an option without a colour
    // is keyed too, in its palette colour.
    const legend = document.querySelector(".report-legend") as HTMLElement;
    expect(within(legend).getByText("Running")).toBeInTheDocument();
    expect(within(legend).getByText("Retiring")).toBeInTheDocument();
    expect(within(legend).getByText("Colourless")).toBeInTheDocument();
    expect(within(legend).getByText("Not set")).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole("combobox", { name: /color by/i })).not.toBeInTheDocument();
  });

  it("draws a bar from the start to the end field, open-ended where one is missing", async () => {
    saved.config = { cardTypeKey: "ITComponent" };
    renderLifecycle();
    await screen.findByText("Both Dates");
    await enableDateRange();
    expect(screen.getByLabelText("2024-01-15 → 2025-12-15 · Running")).toBeInTheDocument();
    // An option key the field does not know shows raw.
    expect(screen.getByLabelText("2023-05-15 → — · unknown")).toBeInTheDocument();
    expect(screen.getByLabelText("— → 2027-02-15 · Colourless")).toBeInTheDocument();
    // No end-of-life alert in this mode.
    expect(screen.queryByText(/at End of Life/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("2024-01-15 → 2025-12-15 · Running"));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("both");
  });

  it("recolours the bars by another select field", async () => {
    saved.config = { cardTypeKey: "ITComponent" };
    renderLifecycle();
    await screen.findByText("Both Dates");
    await enableDateRange();
    await pick(/color by/i, /^Tier$/);
    expect(screen.getByLabelText("2024-01-15 → 2025-12-15 · Not set")).toBeInTheDocument();
    expect(within(document.querySelector(".report-legend") as HTMLElement).getByText("Tier 1"))
      .toBeInTheDocument();
  });

  it("restores the legacy initiative colour-by key", async () => {
    saved.config = { cardTypeKey: "ITComponent", useInitiativeDates: false, initiativeColorBy: "tier" };
    renderLifecycle();
    await screen.findByText("Both Dates");
    await enableDateRange();
    expect(screen.getByRole("combobox", { name: /color by/i })).toHaveTextContent("Tier");
  });

  it("turns itself off on a type without two date fields", async () => {
    mockApi.on("get", "/reports/roadmap?type=Application", { items: PHASE_ITEMS });
    saved.config = { cardTypeKey: "ITComponent" };
    renderLifecycle();
    await screen.findByText("Both Dates");
    await enableDateRange();
    await pick(/card type/i, /^Application$/);
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ cardTypeKey: "Application", useCustomDates: false }),
      ),
    );
    expect(await screen.findByLabelText("End of Life: 2024-06-30")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /date range view/i })).not.toBeInTheDocument();
  });

  it("falls back to the first two date fields and leaves bars uncoloured with nothing to colour by", async () => {
    mockApi.on("get", "/reports/roadmap?type=Project", {
      items: [
        {
          id: "p1",
          name: "Rollout",
          type: "Project",
          lifecycle: {},
          attributes: { kickoff: "2024-02-15", golive: "2024-09-15" },
        },
      ],
    });
    saved.config = { cardTypeKey: "Project", view: "table" };
    renderLifecycle();
    // The untyped roadmap can render first; wait for the Project rows.
    await screen.findByText("Rollout");
    fireEvent.click(screen.getByRole("checkbox", { name: /date range view/i }));
    // Nothing to colour by, so no picker.
    expect(screen.queryByRole("combobox", { name: /color by/i })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Kickoff" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Go-live" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Rollout/ });
    expect(within(row).getByText("2024-02-15")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: /chart view/i }));
    expect(await screen.findByLabelText("2024-02-15 → 2024-09-15 · Not set")).toBeInTheDocument();
  });

  it("sorts the date-range table by its own columns and shows colour chips", async () => {
    const user = userEvent.setup();
    saved.config = { cardTypeKey: "ITComponent", view: "table" };
    renderLifecycle();
    await screen.findByText("Both Dates");
    await enableDateRange();
    expect(screen.getByRole("columnheader", { name: "Contract Start" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Contract End" })).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Both Dates/ })).getByText("Running")).toBeInTheDocument();
    // An unknown value has no colour, so it renders as a dash.
    expect(within(screen.getByRole("row", { name: /Start Only/ })).getAllByText("—").length).toBe(2);

    await user.click(screen.getByRole("button", { name: "Contract Start" }));
    expect(bodyRows()).toEqual(["Start Only", "Both Dates", "End Only", "No Dates"]);
    await user.click(screen.getByRole("button", { name: "Contract End" }));
    // Undated cards last, by name.
    expect(bodyRows()).toEqual(["Both Dates", "End Only", "No Dates", "Start Only"]);
    // By the label the column shows (Colourless < Running < unknown), unset last.
    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(bodyRows()).toEqual(["End Only", "Both Dates", "Start Only", "No Dates"]);
    await user.click(screen.getByRole("button", { name: "Status" }));
    // Unset stays last in a descending sort too.
    expect(bodyRows()).toEqual(["Start Only", "Both Dates", "End Only", "No Dates"]);

    await user.click(screen.getByRole("row", { name: /End Only/ }));
    expect(screen.getByTestId("side-panel")).toHaveTextContent("end");
  });
});

describe("LifecycleReport shell actions", () => {
  it("resets every parameter to its default", async () => {
    saved.config = { cardTypeKey: "ITComponent", view: "table", sortK: "status", sortD: "desc" };
    renderLifecycle();
    await screen.findByText("Both Dates");
    await enableDateRange();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    expect(saved.resetAll).toHaveBeenCalled();
    await waitFor(() =>
      expect(saved.persistConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cardTypeKey: "",
          view: "chart",
          sortK: "name",
          sortD: "asc",
          useCustomDates: false,
          scopeIds: [],
        }),
      ),
    );
    expect(await screen.findByText("Oracle DB")).toBeInTheDocument();
  });

  it("saves through the thumbnail capture and closes the dialog", async () => {
    saved.saveDialogOpen = true;
    renderLifecycle();
    await screen.findByText("Oracle DB");
    fireEvent.click(screen.getByRole("button", { name: /save report/i }));
    expect(saved.captureAndSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "close-save" }));
    expect(saved.setSaveDialogOpen).toHaveBeenCalledWith(false);
  });

  it("waits for the metamodel before drawing", () => {
    hookState.metamodel.loading = true;
    renderLifecycle();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

describe("LifecycleReport date-range mode with a yes/no field (#1256)", () => {
  const LEASE = makeCardType({
    key: "Lease",
    label: "Lease",
    fields_schema: [
      makeSection({
        section: "Terms",
        fields: [
          makeField({ key: "leaseStart", label: "Lease Start", type: "date" }),
          makeField({ key: "leaseEnd", label: "Lease End", type: "date" }),
          makeField({ key: "renewable", label: "Renewable", type: "boolean" }),
        ],
      }),
    ],
  });
  const dates = { leaseStart: "2024-01-15", leaseEnd: "2025-01-15" };
  const LEASES = [
    { id: "l1", name: "Lease One", type: "Lease", lifecycle: {}, attributes: { ...dates, renewable: true } },
    { id: "l2", name: "Lease Two", type: "Lease", lifecycle: {}, attributes: { ...dates, renewable: false } },
    { id: "l3", name: "Lease Three", type: "Lease", lifecycle: {}, attributes: { ...dates } },
    { id: "l4", name: "Lease Four", type: "Lease", lifecycle: {}, attributes: { ...dates, renewable: "no" } },
  ];

  beforeEach(() => {
    withMetamodel([APP, ITC, PROJECT, LEASE]);
    mockApi.on("get", "/reports/roadmap?type=Lease", { items: LEASES });
  });

  it("colours the bars Yes / No with a key", async () => {
    saved.config = { cardTypeKey: "Lease" };
    renderLifecycle();
    await screen.findByText("Lease One");
    await enableDateRange();
    // The only facet field is the default colour.
    expect(screen.getByRole("combobox", { name: /color by/i })).toHaveTextContent("Renewable");
    const bar = (label: string) => screen.getByLabelText(`2024-01-15 → 2025-01-15 · ${label}`);
    expect(screen.getAllByLabelText("2024-01-15 → 2025-01-15 · Yes")).toHaveLength(1);
    expect(screen.getAllByLabelText("2024-01-15 → 2025-01-15 · No")).toHaveLength(2);
    expect(getComputedStyle(screen.getAllByLabelText("2024-01-15 → 2025-01-15 · No")[0]).backgroundColor)
      .toBe("rgb(33, 150, 243)");
    expect(getComputedStyle(bar("Yes")).backgroundColor).toBe("rgb(76, 175, 80)");
    expect(getComputedStyle(bar("Not set")).backgroundColor).toBe("rgb(189, 189, 189)");
    const legend = document.querySelector(".report-legend") as HTMLElement;
    expect(within(legend).getByText("Yes")).toBeInTheDocument();
    expect(within(legend).getByText("No")).toBeInTheDocument();
    expect(within(legend).getByText("Not set")).toBeInTheDocument();
  });

  it("names and sorts the yes/no column by its label, unset last", async () => {
    const user = userEvent.setup();
    saved.config = { cardTypeKey: "Lease", view: "table" };
    renderLifecycle();
    await screen.findByText("Lease One");
    await enableDateRange();
    const status = (name: string) =>
      within(screen.getByRole("row", { name: new RegExp(`^${name}`) })).getAllByRole("cell")[4]
        .textContent;
    expect(status("Lease One")).toBe("Yes");
    expect(status("Lease Two")).toBe("No");
    expect(status("Lease Three")).toBe("—");
    expect(status("Lease Four")).toBe("No");

    await user.click(screen.getByRole("button", { name: "Renewable" }));
    expect(bodyRows()).toEqual(["Lease Four", "Lease Two", "Lease One", "Lease Three"]);
    await user.click(screen.getByRole("button", { name: "Renewable" }));
    expect(bodyRows()).toEqual(["Lease One", "Lease Four", "Lease Two", "Lease Three"]);
  });
});

describe("LifecycleReport date-range mode with a multi-select field (#1256)", () => {
  const PERMIT = makeCardType({
    key: "Permit",
    label: "Permit",
    fields_schema: [
      makeSection({
        section: "Terms",
        fields: [
          makeField({ key: "permitStart", label: "Permit Start", type: "date" }),
          makeField({ key: "permitEnd", label: "Permit End", type: "date" }),
          makeField({
            key: "regions",
            label: "Regions",
            type: "multiple_select",
            options: [
              makeOption({ key: "eu", label: "Europe", color: "#123456" }),
              makeOption({ key: "us", label: "Americas" }),
            ],
          }),
        ],
      }),
    ],
  });
  const dates = { permitStart: "2024-01-15", permitEnd: "2025-01-15" };
  const permit = (id: string, regions?: string[]) => ({
    id,
    name: `Permit ${id}`,
    type: "Permit",
    lifecycle: {},
    attributes: { ...dates, ...(regions ? { regions } : {}) },
  });

  beforeEach(() => {
    withMetamodel([APP, ITC, PROJECT, PERMIT]);
  });

  it("colours a card with several values as Multiple, keyed only when one exists", async () => {
    mockApi.on("get", "/reports/roadmap?type=Permit", {
      items: [permit("A", ["eu"]), permit("B", ["eu", "us"]), permit("C")],
    });
    saved.config = { cardTypeKey: "Permit" };
    const first = renderLifecycle();
    await screen.findByText("Permit A");
    await enableDateRange();
    const multi = screen.getByLabelText("2024-01-15 → 2025-01-15 · Multiple");
    expect(getComputedStyle(multi).backgroundColor).toBe("rgb(96, 125, 139)");
    expect(getComputedStyle(screen.getByLabelText("2024-01-15 → 2025-01-15 · Europe")).backgroundColor)
      .toBe("rgb(18, 52, 86)");
    let legend = document.querySelector(".report-legend") as HTMLElement;
    expect(within(legend).getByText("Europe")).toBeInTheDocument();
    expect(within(legend).getByText("Americas")).toBeInTheDocument();
    expect(within(legend).getByText("Multiple")).toBeInTheDocument();
    first.unmount();

    mockApi.on("get", "/reports/roadmap?type=Permit", { items: [permit("A", ["eu"]), permit("C")] });
    renderLifecycle();
    await screen.findByText("Permit A");
    await enableDateRange();
    legend = document.querySelector(".report-legend") as HTMLElement;
    expect(within(legend).getByText("Americas")).toBeInTheDocument();
    expect(within(legend).queryByText("Multiple")).not.toBeInTheDocument();
  });
});
