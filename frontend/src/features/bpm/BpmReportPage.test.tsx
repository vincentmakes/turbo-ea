import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/features/reports/ProcessMapReport", () => ({
  default: () => <div data-testid="process-map-report">ProcessMapReport</div>,
}));
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: ({ cardId, open }: { cardId: string | null; open: boolean; onClose: () => void }) =>
    open ? <div data-testid="card-side-panel" data-card-id={cardId}>SidePanel</div> : null,
}));

import { api } from "@/api/client";
import BpmReportsContent from "./BpmReportPage";

const mockCapMatrix = {
  rows: [{ id: "p1", name: "Order Management" }],
  columns: [{ id: "c1", name: "Finance" }],
  cells: [{ process_id: "p1", capability_id: "c1" }],
};

const mockAppMatrix = {
  rows: [{ id: "p1", name: "Billing Process" }],
  columns: [{ id: "a1", name: "SAP" }],
  cells: [{ process_id: "p1", application_id: "a1", source: "relation" }],
};

const mockDeps = {
  nodes: [
    { id: "n1", name: "Order" },
    { id: "n2", name: "Shipping" },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

const mockElementMap = [
  {
    application_id: "a1",
    application_name: "CRM App",
    elements: [
      { element_id: "el1", element_name: "Create Order", element_type: "task", process_id: "p1", process_name: "Order Process", lane_name: "Sales" },
    ],
  },
];

const mockOrgMatrix = {
  rows: [
    { id: "p1", name: "Order to Cash" },
    { id: "p2", name: "Procure to Pay" },
  ],
  columns: [
    { id: "o1", name: "Sales" },
    { id: "o2", name: "Finance" },
  ],
  cells: [
    {
      process_id: "p1",
      organization_id: "o1",
      steps: [
        { element_id: "e1", element_name: "Create Quote", element_type: "task", lane_name: "Sales" },
        { element_id: "e2", element_name: "Confirm Order", element_type: "task", lane_name: null },
      ],
    },
    {
      process_id: "p2",
      organization_id: "o2",
      steps: [
        { element_id: "e3", element_name: "Send Invoice", element_type: "task", lane_name: null },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <BpmReportsContent />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockRejectedValue(new Error("no mock"));
});

describe("BpmReportsContent", () => {
  it("shows six sub-tabs", () => {
    renderPage();
    expect(screen.getByText("Process Map")).toBeInTheDocument();
    expect(screen.getByText("Capability × Process")).toBeInTheDocument();
    expect(screen.getByText("Process × Application")).toBeInTheDocument();
    expect(screen.getByText("Process × Organization")).toBeInTheDocument();
    expect(screen.getByText("Process Dependencies")).toBeInTheDocument();
    expect(screen.getByText("Element-Application Map")).toBeInTheDocument();
  });

  it("shows ProcessMapReport by default", () => {
    renderPage();
    expect(screen.getByTestId("process-map-report")).toBeInTheDocument();
  });

  describe("Capability × Process tab", () => {
    it("shows matrix data", async () => {
      vi.mocked(api.get).mockResolvedValue(mockCapMatrix);
      renderPage();
      await userEvent.click(screen.getByText("Capability × Process"));

      await waitFor(() => {
        expect(screen.getByText("Capability × Process Matrix")).toBeInTheDocument();
        expect(screen.getByText("Order Management")).toBeInTheDocument();
        expect(screen.getByText("Finance")).toBeInTheDocument();
      });
    });

    it("shows empty state when no data", async () => {
      vi.mocked(api.get).mockResolvedValue({ rows: [], columns: [], cells: [] });
      renderPage();
      await userEvent.click(screen.getByText("Capability × Process"));

      await waitFor(() => {
        expect(screen.getByText(/No data.*Link processes to capabilities/)).toBeInTheDocument();
      });
    });
  });

  describe("Process × Application tab", () => {
    it("shows matrix data", async () => {
      vi.mocked(api.get).mockResolvedValue(mockAppMatrix);
      renderPage();
      await userEvent.click(screen.getByText("Process × Application"));

      await waitFor(() => {
        expect(screen.getByText("Process × Application Matrix")).toBeInTheDocument();
        expect(screen.getByText("Billing Process")).toBeInTheDocument();
        expect(screen.getByText("SAP")).toBeInTheDocument();
      });
    });

    it("shows empty state when no data", async () => {
      vi.mocked(api.get).mockResolvedValue({ rows: [], columns: [], cells: [] });
      renderPage();
      await userEvent.click(screen.getByText("Process × Application"));

      await waitFor(() => {
        expect(screen.getByText(/No data.*Link processes to applications/)).toBeInTheDocument();
      });
    });
  });

  describe("Process × Organization tab", () => {
    it("shows the execution matrix with step counts", async () => {
      vi.mocked(api.get).mockResolvedValue(mockOrgMatrix);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Process × Organization" }));

      await waitFor(() => {
        expect(screen.getByText("Process × Organization Matrix (Execution)")).toBeInTheDocument();
        expect(screen.getByText("Order to Cash")).toBeInTheDocument();
        expect(screen.getByText("2 steps")).toBeInTheDocument();
        expect(screen.getByText("1 step")).toBeInTheDocument();
      });
      expect(screen.getByText("Sales")).toBeInTheDocument(); // column header
      expect(screen.getByLabelText("Organizations")).toBeInTheDocument();
      expect(screen.getByLabelText("Processes")).toBeInTheDocument();
    });

    it("shows empty state when no data", async () => {
      vi.mocked(api.get).mockResolvedValue({ rows: [], columns: [], cells: [] });
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Process × Organization" }));

      await waitFor(() => {
        expect(screen.getByText(/No data.*Link Organizations/)).toBeInTheDocument();
      });
    });

    it("expands a row to show the executed steps", async () => {
      vi.mocked(api.get).mockResolvedValue(mockOrgMatrix);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Process × Organization" }));
      await waitFor(() => {
        expect(screen.getByTestId("expand-p1")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId("expand-p1"));

      await waitFor(() => {
        expect(screen.getByText("Create Quote (Sales)")).toBeInTheDocument();
        expect(screen.getByText("Confirm Order")).toBeInTheDocument();
      });
    });

    it("filters via the organization multi-select dropdown", async () => {
      vi.mocked(api.get).mockResolvedValue(mockOrgMatrix);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Process × Organization" }));
      await waitFor(() => {
        expect(screen.getByText("Order to Cash")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByLabelText("Organizations"));
      await userEvent.click(await screen.findByRole("option", { name: "Finance" }));

      await waitFor(() => {
        expect(screen.queryByText("Order to Cash")).not.toBeInTheDocument();
        expect(screen.getByText("Procure to Pay")).toBeInTheDocument();
      });
    });

    it("filters via the process multi-select dropdown", async () => {
      vi.mocked(api.get).mockResolvedValue(mockOrgMatrix);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Process × Organization" }));
      await waitFor(() => {
        expect(screen.getByText("Procure to Pay")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByLabelText("Processes"));
      await userEvent.click(await screen.findByRole("option", { name: "Order to Cash" }));
      await userEvent.keyboard("{Escape}"); // close the still-open listbox

      await waitFor(() => {
        expect(screen.queryByText("Procure to Pay")).not.toBeInTheDocument();
        // Appears as the Autocomplete tag chip AND the table row.
        expect(screen.getAllByText("Order to Cash").length).toBeGreaterThanOrEqual(2);
      });
    });

    it("text filter matches step names and narrows counts, rows, and columns", async () => {
      vi.mocked(api.get).mockResolvedValue(mockOrgMatrix);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: "Process × Organization" }));
      await waitFor(() => {
        expect(screen.getByText("2 steps")).toBeInTheDocument();
      });
      await userEvent.type(screen.getByPlaceholderText("Filter steps..."), "Create Quote");

      await waitFor(() => {
        // Only the matching step remains: count drops from 2 to 1...
        expect(screen.getAllByText("1 step")).toHaveLength(1);
        expect(screen.queryByText("2 steps")).not.toBeInTheDocument();
        // ...the non-matching process row disappears...
        expect(screen.queryByText("Procure to Pay")).not.toBeInTheDocument();
        // ...and the org column without matches (Finance) is dropped.
        expect(screen.queryByText("Finance")).not.toBeInTheDocument();
      });
    });
  });

  describe("Process Dependencies tab", () => {
    it("shows dependency table", async () => {
      vi.mocked(api.get).mockResolvedValue(mockDeps);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Process Dependencies/ }));

      await waitFor(() => {
        expect(screen.getByText("2 processes, 1 dependencies")).toBeInTheDocument();
        expect(screen.getByText("Order")).toBeInTheDocument();
        expect(screen.getByText("Shipping")).toBeInTheDocument();
      });
    });

    it("shows empty state when no data", async () => {
      vi.mocked(api.get).mockResolvedValue({ nodes: [], edges: [] });
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Process Dependencies/ }));

      await waitFor(() => {
        expect(screen.getByText(/No process dependencies defined/)).toBeInTheDocument();
      });
    });
  });

  describe("Element-Application Map tab", () => {
    it("shows element groups", async () => {
      vi.mocked(api.get).mockResolvedValue(mockElementMap);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Element-Application Map/ }));

      await waitFor(() => {
        expect(screen.getByText("CRM App (1 element)")).toBeInTheDocument();
        expect(screen.getByText("Create Order")).toBeInTheDocument();
        expect(screen.getByText("Sales")).toBeInTheDocument();
      });
    });

    it("shows empty state when no data", async () => {
      vi.mocked(api.get).mockResolvedValue([]);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Element-Application Map/ }));

      await waitFor(() => {
        expect(screen.getByText(/No BPMN elements linked/)).toBeInTheDocument();
      });
    });
  });

  it("shows loading indicator while fetching", async () => {
    let resolve: (v: any) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((r) => { resolve = r; }));

    renderPage();
    await userEvent.click(screen.getByText("Capability × Process"));

    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    resolve!(mockCapMatrix);
    await waitFor(() => {
      expect(screen.getByText("Order Management")).toBeInTheDocument();
    });
  });

  describe("Card detail side panel", () => {
    it("opens side panel when clicking a row in Capability × Process", async () => {
      vi.mocked(api.get).mockResolvedValue(mockCapMatrix);
      renderPage();
      await userEvent.click(screen.getByText("Capability × Process"));

      await waitFor(() => {
        expect(screen.getByText("Order Management")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Order Management"));
      expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "p1");
    });

    it("opens side panel when clicking a row in Process × Application", async () => {
      vi.mocked(api.get).mockResolvedValue(mockAppMatrix);
      renderPage();
      await userEvent.click(screen.getByText("Process × Application"));

      await waitFor(() => {
        expect(screen.getByText("Billing Process")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Billing Process"));
      expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "p1");
    });

    it("opens side panel when clicking source in Process Dependencies", async () => {
      vi.mocked(api.get).mockResolvedValue(mockDeps);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Process Dependencies/ }));

      await waitFor(() => {
        expect(screen.getByText("Order")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Order"));
      expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "n1");
    });

    it("opens side panel when clicking target in Process Dependencies", async () => {
      vi.mocked(api.get).mockResolvedValue(mockDeps);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Process Dependencies/ }));

      await waitFor(() => {
        expect(screen.getByText("Shipping")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Shipping"));
      expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "n2");
    });

    it("opens side panel when clicking app name in Element-Application Map", async () => {
      vi.mocked(api.get).mockResolvedValue(mockElementMap);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Element-Application Map/ }));

      await waitFor(() => {
        expect(screen.getByText("CRM App (1 element)")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("CRM App (1 element)"));
      expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "a1");
    });

    it("opens side panel when clicking process name in Element-Application Map", async () => {
      vi.mocked(api.get).mockResolvedValue(mockElementMap);
      renderPage();
      await userEvent.click(screen.getByRole("tab", { name: /Element-Application Map/ }));

      await waitFor(() => {
        expect(screen.getByText("Order Process")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Order Process"));
      expect(screen.getByTestId("card-side-panel")).toHaveAttribute("data-card-id", "p1");
    });
  });
});
