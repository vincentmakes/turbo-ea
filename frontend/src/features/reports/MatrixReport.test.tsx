import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import MatrixReport from "./MatrixReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useSavedReport", () => ({ useSavedReport: vi.fn() }));
vi.mock("@/hooks/useThumbnailCapture", () => ({ useThumbnailCapture: vi.fn() }));
vi.mock("./SaveReportDialog", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSavedReport } from "@/hooks/useSavedReport";
import { useThumbnailCapture } from "@/hooks/useThumbnailCapture";
import { createRef } from "react";

// ---------------------------------------------------------------------------
// Test data
//
// The attribute keys are arbitrary on purpose: the report reads them out of the
// relation type's `attributes_schema`, so these fixtures exercise the same code
// path an admin-defined dimension would.
// ---------------------------------------------------------------------------

const cardTypes = (hierarchical = false) => [
  { key: "Application", label: "Application", icon: "apps", color: "#0f7eb5", has_hierarchy: hierarchical },
  { key: "BusinessCapability", label: "Business Capability", icon: "account_tree", color: "#003399", has_hierarchy: false },
];

const ATTRIBUTED_RELATION = {
  key: "relAppToBc",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  cardinality: "n:m",
  built_in: true,
  is_hidden: false,
  attributes_schema: [
    { key: "alpha", label: "Create", type: "boolean" },
    { key: "beta", label: "Read", type: "boolean" },
  ],
};

const BARE_RELATION = {
  ...ATTRIBUTED_RELATION,
  key: "relAppToBcBare",
  attributes_schema: [],
};

const PAYLOAD = {
  rows: [
    { id: "app-1", name: "App One", parent_id: null },
    { id: "app-2", name: "App Two", parent_id: null },
  ],
  columns: [
    { id: "bc-1", name: "Cap One", parent_id: null },
    { id: "bc-2", name: "Cap Two", parent_id: null },
  ],
  relation_types: ["relAppToBc"],
  attr_sets: [{}, { alpha: true, beta: true }],
  intersections: [{ row_id: "app-1", col_id: "bc-1", e: [[0, "f", 1]] }],
  truncated: false,
};

let metamodelRelationTypes: unknown[] = [ATTRIBUTED_RELATION];
let metamodelCardTypes: unknown[] = cardTypes();

beforeEach(() => {
  vi.clearAllMocks();
  metamodelRelationTypes = [ATTRIBUTED_RELATION];
  metamodelCardTypes = cardTypes();

  vi.mocked(useMetamodel).mockImplementation(
    () =>
      ({
        types: metamodelCardTypes,
        relationTypes: metamodelRelationTypes,
        loading: false,
        getType: () => undefined,
        getRelationsForType: () => [],
        invalidateCache: vi.fn(),
      }) as unknown as ReturnType<typeof useMetamodel>,
  );

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
    reportType: "matrix",
  } as unknown as ReturnType<typeof useSavedReport>);

  vi.mocked(useThumbnailCapture).mockReturnValue({
    chartRef: createRef(),
    thumbnail: undefined,
    captureAndSave: vi.fn(),
  } as unknown as ReturnType<typeof useThumbnailCapture>);

  vi.mocked(api.get).mockResolvedValue(PAYLOAD);

  // The sticky multi-row header measures itself on resize; jsdom has no
  // ResizeObserver, and the measurement is irrelevant to what these assert.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function renderMatrix() {
  return render(
    <MemoryRouter>
      <MatrixReport />
    </MemoryRouter>,
  );
}

/** The MetricCard tile carrying a given label. */
function metricCard(label: string): HTMLElement {
  return screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
}

/** Widths declared on the <colgroup>, in document order. */
function colWidths(): string[] {
  return Array.from(document.querySelectorAll("colgroup col")).map(
    (c) => (c as HTMLElement).style.width,
  );
}

async function selectCellMode(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByLabelText("Cell Display"));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("MatrixReport", () => {
  it("renders the axes and their cards", async () => {
    renderMatrix();

    expect(await screen.findByText("App One")).toBeInTheDocument();
    expect(screen.getByText("Cap One")).toBeInTheDocument();
    expect(screen.getByText("App Two")).toBeInTheDocument();
  });

  it("requests the default axes", async () => {
    renderMatrix();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("row_type=Application"),
        expect.anything(),
      );
    });
  });

  it("counts every relation, not every pair", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...PAYLOAD,
      intersections: [{ row_id: "app-1", col_id: "bc-1", e: [[0, "f", 0], [0, "r", 0]] }],
    });
    renderMatrix();

    // Two relations between one pair: the Relations metric says 2.
    await waitFor(() => {
      expect(metricCard("Relations")).toHaveTextContent("2");
    });
  });

  it("reports cards that take part in no relation as gaps", async () => {
    renderMatrix();

    // App Two and Object Two are linked to nothing.
    const labels = await screen.findAllByText(/with no relation/);
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.closest(".MuiPaper-root")).toHaveTextContent("1");
    }
  });

  describe("value cell modes", () => {
    it("shows the codes derived from the relation's own field labels", async () => {
      const user = userEvent.setup();
      renderMatrix();
      await screen.findByText("App One");

      await selectCellMode(user, "Values (codes)");

      // "Create" and "Read" — first letters, taken from the schema labels.
      const table = document.querySelector("table") as HTMLElement;
      await waitFor(() => {
        expect(within(table).getByText("C")).toBeInTheDocument();
        expect(within(table).getByText("R")).toBeInTheDocument();
      });
    });

    it("shows full labels and a legend in the labels mode", async () => {
      const user = userEvent.setup();
      renderMatrix();
      await screen.findByText("App One");

      await selectCellMode(user, "Values (labels)");

      await waitFor(() => {
        // Once in the cell, once in the legend.
        expect(screen.getAllByText("Create").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("widens only the data columns in the labels mode", async () => {
      // The sticky row headers are positioned at `colIdx * ROW_HEADER_COL_WIDTH`,
      // so the header columns must keep that width whatever the cells do —
      // mixing the two is what knocked them out of alignment in #846.
      const user = userEvent.setup();
      renderMatrix();
      await screen.findByText("App One");

      expect(colWidths()).toEqual(["140px", "32px", "32px", "44px"]);

      await selectCellMode(user, "Values (labels)");

      await waitFor(() => {
        expect(colWidths()).toEqual(["140px", "120px", "120px", "44px"]);
      });
    });

    it("offers no value modes when the relations carry no values", async () => {
      metamodelRelationTypes = [BARE_RELATION];
      const user = userEvent.setup();
      renderMatrix();
      await screen.findByText("App One");

      await user.click(screen.getByLabelText("Cell Display"));

      const option = (await screen.findByText("Values (codes)")).closest("li");
      expect(option).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("filter bar", () => {
    it("offers a filter for each dimension the relation type declares", async () => {
      renderMatrix();
      await screen.findByText("App One");

      expect(screen.getByText("Relation filter")).toBeInTheDocument();
      expect(screen.getByLabelText("Create")).toBeInTheDocument();
      expect(screen.getByLabelText("Read")).toBeInTheDocument();
    });

    it("stays out of the way when no relation type connects the axes", async () => {
      metamodelRelationTypes = [];
      renderMatrix();
      await screen.findByText("App One");

      expect(screen.queryByText("Relation filter")).not.toBeInTheDocument();
    });

    it("says so plainly when nothing connects the axes and there is nothing to draw", async () => {
      metamodelRelationTypes = [];
      vi.mocked(api.get).mockResolvedValue({ ...PAYLOAD, rows: [], columns: [], intersections: [] });
      renderMatrix();

      expect(await screen.findByText(/No relation type connects/)).toBeInTheDocument();
    });

    it("sends the chosen value to the server", async () => {
      const user = userEvent.setup();
      renderMatrix();
      await screen.findByText("App One");

      await user.click(screen.getByLabelText("Create"));
      await user.click(await screen.findByRole("option", { name: "Yes" }));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(
          expect.stringContaining("attr=relAppToBc.alpha%3Atrue"),
          expect.anything(),
        );
      });
    });

    it("sends the chosen direction to the server", async () => {
      const user = userEvent.setup();
      renderMatrix();
      await screen.findByText("App One");

      await user.click(screen.getByRole("button", { name: "Row is the target" }));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(
          expect.stringContaining("direction=reverse"),
          expect.anything(),
        );
      });
    });
  });

  it("swaps the axes when transposed", async () => {
    const user = userEvent.setup();
    renderMatrix();
    await screen.findByText("App One");

    await user.click(screen.getByRole("button", { name: "Swap rows and columns" }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("row_type=BusinessCapability&col_type=Application"),
        expect.anything(),
      );
    });
  });

  it("shows a relation attached to a parent card, on a row of its own", async () => {
    // The reported bug: the app column was there, the intersection was blank
    // and the total read 0, because the parent org was only a group header
    // spanning its children and had no row to put the dot in.
    metamodelCardTypes = cardTypes(true);
    vi.mocked(api.get).mockResolvedValue({
      ...PAYLOAD,
      rows: [
        { id: "app-parent", name: "Parent App", parent_id: null },
        { id: "app-child", name: "Child App", parent_id: "app-parent" },
      ],
      intersections: [{ row_id: "app-parent", col_id: "bc-1", e: [[0, "f", 0]] }],
    });
    renderMatrix();

    await screen.findByText("Parent App");
    // The parent keeps its group header and gains its own line beneath it.
    expect(screen.getByText("(itself)")).toBeInTheDocument();
    // One relation in the payload, one in the grid.
    await waitFor(() => {
      expect(metricCard("Relations")).toHaveTextContent("1");
    });
    const table = document.querySelector("table") as HTMLElement;
    expect(within(table).getAllByText("1").length).toBeGreaterThan(0);
  });

  it("keeps a related parent whose children are unrelated when hiding unrelated cards", async () => {
    const user = userEvent.setup();
    metamodelCardTypes = cardTypes(true);
    vi.mocked(api.get).mockResolvedValue({
      ...PAYLOAD,
      rows: [
        { id: "app-parent", name: "Parent App", parent_id: null },
        { id: "app-child", name: "Child App", parent_id: "app-parent" },
      ],
      intersections: [{ row_id: "app-parent", col_id: "bc-1", e: [[0, "f", 0]] }],
    });
    renderMatrix();
    await screen.findByText("Parent App");

    await user.click(screen.getByRole("checkbox", { name: /Hide unrelated cards/ }));

    // The toggle keeps related cards — the parent is related, so it stays.
    await waitFor(() => {
      expect(screen.getByText("Parent App")).toBeInTheDocument();
    });
    expect(screen.queryByText("Child App")).not.toBeInTheDocument();
  });

  it("loads a config saved before the filters existed", async () => {
    // Older saved reports carry none of the new keys; they must land on the
    // defaults rather than throwing on the way to building the request path.
    vi.mocked(useSavedReport).mockReturnValue({
      savedReport: null,
      savedReportName: "Old report",
      saveDialogOpen: false,
      setSaveDialogOpen: vi.fn(),
      loadedConfig: { rowType: "Application", colType: "BusinessCapability", cellMode: "count" },
      consumeConfig: vi
        .fn()
        .mockReturnValue({ rowType: "Application", colType: "BusinessCapability", cellMode: "count" }),
      resetSavedReport: vi.fn(),
      persistConfig: vi.fn(),
      resetAll: vi.fn(),
      reportType: "matrix",
    } as unknown as ReturnType<typeof useSavedReport>);

    renderMatrix();

    expect(await screen.findByText("App One")).toBeInTheDocument();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.not.stringContaining("attr="),
        expect.anything(),
      );
    });
  });
});
