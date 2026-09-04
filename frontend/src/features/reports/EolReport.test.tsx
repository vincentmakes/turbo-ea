import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createRef } from "react";
import EolReport from "./EolReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  isAbortError: (e: unknown) => e instanceof Error && e.name === "AbortError",
}));

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({ useThumbnailCapture: vi.fn() }));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TYPES = [
  {
    key: "ITComponent",
    label: "IT Component",
    icon: "memory",
    color: "#d29270",
    is_hidden: false,
    fields_schema: [],
  },
];

/** One card per source: an upstream link, and one nobody has recorded. */
const MOCK_EOL = {
  items: [
    {
      id: "itc1",
      name: "Nginx LB",
      type: "ITComponent",
      eol_product: "nginx",
      eol_cycle: "1.25",
      status: "eol",
      source: "api",
      cycle_data: { cycle: "1.25", eol: "2020-01-01", support: "2019-06-01" },
      lifecycle: {},
      affected_apps: [],
    },
    {
      id: "itc2",
      name: "Unknown Box",
      type: "ITComponent",
      eol_product: null,
      eol_cycle: null,
      status: "missing",
      source: "none",
      cycle_data: null,
      lifecycle: {},
      affected_apps: [],
    },
  ],
  summary: {
    eol: 1,
    approaching: 0,
    supported: 0,
    missing: 1,
    impacted_apps: 0,
    approaching_impacted_apps: 0,
    manual: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/reports/eol")) return Promise.resolve(MOCK_EOL);
    return Promise.resolve({});
  });

  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: [],
    loading: false,
    error: null,
    reload: vi.fn(),
    getType: (key: string) => MOCK_TYPES.find((tp) => tp.key === key),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  vi.mocked(useSavedReport).mockReturnValue({
    savedReport: null,
    savedReportName: null,
    saveDialogOpen: false,
    setSaveDialogOpen: vi.fn(),
    loadedConfig: null,
    consumeConfig: vi.fn().mockReturnValue(null),
    resetSavedReport: vi.fn(),
    persistConfig: vi.fn(),
    resetAll: vi.fn(),
    reportType: "eol",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

function renderReport() {
  return render(
    <MemoryRouter>
      <EolReport />
    </MemoryRouter>,
  );
}

/** Switch to the table view, where every row is listed by name. */
async function openTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /table/i }));
}

/**
 * The KPI tile for a status. Its label also appears in the legend and in the
 * Status filter — as every other status label does — so the query is scoped
 * to the tile's own Paper.
 */
async function kpiTile(label: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(label);
  const tile = matches
    .map((el) => el.closest(".MuiPaper-root") as HTMLElement | null)
    .find((paper) => paper?.querySelector(".material-symbols-outlined"));
  if (!tile) throw new Error(`No KPI tile found for ${label}`);
  return tile;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EolReport — cards with no EOL data (#1065)", () => {
  it("lists a card nobody has recorded an end of life for", async () => {
    const user = userEvent.setup();
    renderReport();
    await openTable(user);

    expect(await screen.findByText("Unknown Box")).toBeInTheDocument();
  });

  it("counts them on their own KPI", async () => {
    renderReport();

    expect(within(await kpiTile("No EOL data")).getByText("1")).toBeInTheDocument();
  });

  it("filters the report to them when the KPI is pressed", async () => {
    const user = userEvent.setup();
    renderReport();
    await openTable(user);
    expect(await screen.findByText("Nginx LB")).toBeInTheDocument();

    await user.click(await kpiTile("No EOL data"));

    await waitFor(() => expect(screen.queryByText("Nginx LB")).not.toBeInTheDocument());
    expect(screen.getByText("Unknown Box")).toBeInTheDocument();
  });

  it("presses again to clear the filter, so the tile is a toggle", async () => {
    const user = userEvent.setup();
    renderReport();
    await openTable(user);

    await user.click(await kpiTile("No EOL data"));
    await waitFor(() => expect(screen.queryByText("Nginx LB")).not.toBeInTheDocument());

    await user.click(await kpiTile("No EOL data"));
    await waitFor(() => expect(screen.getByText("Nginx LB")).toBeInTheDocument());
  });
});
