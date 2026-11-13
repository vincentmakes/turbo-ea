import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { setViewportWidth } from "@/test/matchMedia";
import PpmProjectDetail from "./PpmProjectDetail";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/api/client", () => ({
  api: {
    get,
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  ApiError: class ApiError extends Error {
    status: number;
    detail: unknown;
    constructor(message: string, status: number, detail: unknown = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  },
}));

// The detail page is a container; its tabs each have their own tests and pull
// heavy graphs (AG Grid, card detail), so stub them out here.
vi.mock("./PpmOverviewTab", () => ({ default: () => <div data-testid="overview-tab" /> }));
vi.mock("./PpmReportsTab", () => ({ default: () => null }));
vi.mock("./PpmCostTab", () => ({ default: () => null }));
vi.mock("./PpmRiskTab", () => ({ default: () => null }));
vi.mock("./PpmTaskBoard", () => ({ default: () => null }));
vi.mock("./PpmGanttTab", () => ({ default: () => null }));
vi.mock("@/features/cards/CardDetailContent", () => ({ default: () => null }));
// The PDF dialog has its own tests; here it shows what the page handed it.
vi.mock("./PpmProjectPdfDialog", () => ({
  default: (p: {
    card: { name: string };
    reports: { id: string }[];
    costLines: { id: string }[];
    budgetLines: { id: string }[];
    risks: { id: string }[];
    rollup: { descendant_count: number } | null;
    onClose: () => void;
  }) => (
    <div data-testid="pdf-dialog">
      {[
        p.card.name,
        p.reports.map((r) => r.id).join(","),
        p.costLines.map((r) => r.id).join(","),
        p.budgetLines.map((r) => r.id).join(","),
        p.risks.map((r) => r.id).join(","),
        p.rollup?.descendant_count,
      ].join(" | ")}
      <button onClick={p.onClose}>close-pdf</button>
    </div>
  ),
}));
vi.mock("@/hooks/useCardSubtypeLabel", () => ({
  useCardSubtypeLabel: () => (_type: string, subtype: string) => subtype,
}));

const INITIATIVE = {
  id: "i1",
  type: "Initiative",
  name: "ERP Replacement",
  subtype: null,
  description: null,
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 0,
  attributes: {},
  lifecycle: {},
  parent_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/ppm/i1"]}>
      <Routes>
        <Route path="/ppm/:id" element={<PpmProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PpmProjectDetail", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("renders a permission error instead of a blank page when the card read 403s", async () => {
    const { ApiError } = await import("@/api/client");
    get.mockImplementation((path: string) => {
      if (path.startsWith("/cards/")) {
        return Promise.reject(new ApiError("Insufficient permissions", 403, null));
      }
      return Promise.resolve([]);
    });

    renderPage();

    expect(
      await screen.findByText("You don't have permission to perform this action"),
    ).toBeInTheDocument();
  });

  it("renders the initiative when every request resolves", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/cards/i1") return Promise.resolve(INITIATIVE);
      if (path === "/cards/i1/my-permissions") {
        return Promise.resolve({ effective: { can_view: true, can_edit: false } });
      }
      return Promise.resolve([]);
    });

    renderPage();

    expect(await screen.findByText("ERP Replacement")).toBeInTheDocument();
  });

  describe("PDF export", () => {
    function loadAll() {
      get.mockImplementation((path: string) => {
        const data: Record<string, unknown> = {
          "/cards/i1": INITIATIVE,
          "/cards/i1/my-permissions": { effective: { can_view: true } },
          "/ppm/initiatives/i1/reports": [{ id: "rep1" }, { id: "rep0" }],
          "/ppm/initiatives/i1/costs": [{ id: "cost1" }],
          "/ppm/initiatives/i1/budgets": [{ id: "bud1" }],
          "/ppm/initiatives/i1/risks": [{ id: "risk1" }],
          "/ppm/initiatives/i1/rollup": { descendant_count: 4, by_year: [] },
        };
        return Promise.resolve(path in data ? data[path] : []);
      });
    }

    it("opens the section picker with the data the page loaded, and closes it", async () => {
      loadAll();
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("ERP Replacement");
      expect(screen.queryByTestId("pdf-dialog")).not.toBeInTheDocument();

      const button = screen.getByRole("button", { name: /PDF/ });
      expect(button).toHaveTextContent("PDF");
      expect(button).toHaveStyle({ textTransform: "none", flexShrink: "0" });
      await user.hover(button);
      expect(await screen.findByRole("tooltip")).toHaveTextContent("Export PDF");

      await user.click(button);
      expect(screen.getByTestId("pdf-dialog")).toHaveTextContent(
        "ERP Replacement | rep1,rep0 | cost1 | bud1 | risk1 | 4",
      );
      await user.click(screen.getByRole("button", { name: "close-pdf" }));
      expect(screen.queryByTestId("pdf-dialog")).not.toBeInTheDocument();
    });

    it("is an icon button on a phone", async () => {
      setViewportWidth(375);
      loadAll();
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("ERP Replacement");
      const button = screen.getByRole("button", { name: "Export PDF" });
      expect(button).not.toHaveTextContent("PDF");
      expect(button).toHaveStyle({ flexShrink: "0" });
      await user.click(button);
      expect(screen.getByTestId("pdf-dialog")).toBeInTheDocument();
    });
  });
});
