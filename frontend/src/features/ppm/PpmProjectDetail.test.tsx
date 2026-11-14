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

  describe("Report link", () => {
    function loadAll() {
      get.mockImplementation((path: string) => {
        if (path === "/cards/i1") return Promise.resolve(INITIATIVE);
        if (path === "/cards/i1/my-permissions") {
          return Promise.resolve({ effective: { can_view: true } });
        }
        if (path === "/ppm/initiatives/i1/rollup") return Promise.resolve(null);
        return Promise.resolve([]);
      });
    }

    function renderWithReport() {
      return render(
        <MemoryRouter initialEntries={["/ppm/i1"]}>
          <Routes>
            <Route path="/ppm/:id" element={<PpmProjectDetail />} />
            <Route path="/ppm/:id/report" element={<div data-testid="report-page" />} />
          </Routes>
        </MemoryRouter>,
      );
    }

    it("is a text link to the initiative's report, with a tooltip", async () => {
      loadAll();
      const user = userEvent.setup();
      renderWithReport();
      await screen.findByText("ERP Replacement");

      const link = screen.getByRole("link", { name: /Report/ });
      expect(link).toHaveAttribute("href", "/ppm/i1/report");
      expect(link).toHaveTextContent("Report");
      expect(link).toHaveTextContent("analytics");
      expect(link).toHaveStyle({ textTransform: "none", flexShrink: "0" });
      expect(screen.queryByRole("button", { name: /PDF/ })).not.toBeInTheDocument();
      await user.hover(link);
      expect(await screen.findByRole("tooltip")).toHaveTextContent("Initiative Report");

      await user.click(link);
      expect(screen.getByTestId("report-page")).toBeInTheDocument();
    });

    it("is an icon link on a phone", async () => {
      setViewportWidth(375);
      loadAll();
      const user = userEvent.setup();
      renderWithReport();
      await screen.findByText("ERP Replacement");
      const link = screen.getByRole("link", { name: "Initiative Report" });
      expect(link).toHaveAttribute("href", "/ppm/i1/report");
      expect(link).not.toHaveTextContent("Report");
      expect(link).toHaveTextContent("analytics");
      expect(link).toHaveStyle({ flexShrink: "0" });
      await user.hover(link);
      expect(await screen.findByRole("tooltip")).toHaveTextContent("Initiative Report");
    });
  });
});
