import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/features/reports/ProcessMapReport", () => ({
  default: () => <div data-testid="process-map-report">ProcessMapReport</div>,
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
  it("shows five sub-tabs", () => {
    renderPage();
    expect(screen.getByText("Process Map")).toBeInTheDocument();
    expect(screen.getByText("Capability × Process")).toBeInTheDocument();
    expect(screen.getByText("Process × Application")).toBeInTheDocument();
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
        expect(screen.getByText("CRM App (1 elements)")).toBeInTheDocument();
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
});
