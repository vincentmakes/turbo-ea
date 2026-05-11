import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// Risk register pulls a lot of state — stub it.
vi.mock("@/features/ea-delivery/risks/RiskRegisterPage", () => ({
  default: () => <div data-testid="risk-register" />,
}));

vi.mock("@/features/turbolens/TurboLensSecurity", () => ({
  default: () => <div data-testid="turbolens-security" />,
}));

import { api } from "@/api/client";
import GrcPage from "./GrcPage";

beforeEach(() => {
  vi.clearAllMocks();
  // /metamodel/principles, /adr → empty arrays.
  // /grc/ai-inventory → empty page. /grc/ai-inventory/kpis → empty KPIs.
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/grc/ai-inventory/kpis")) {
      return {
        total: 0,
        with_risk_class: 0,
        unclassified: 0,
        high_or_unacceptable: 0,
        unowned: 0,
        by_risk_class: {},
        by_lifecycle: {},
        last_discovered_at: null,
      };
    }
    if (path.startsWith("/grc/ai-inventory")) {
      return { items: [], total: 0, page: 1, page_size: 50 };
    }
    return [];
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grc" element={<GrcPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GrcPage", () => {
  it("renders the GRC page title and three top-level tabs", async () => {
    renderAt("/grc");
    expect(await screen.findByRole("heading", { name: /GRC/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Governance/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Risk/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Compliance/i })).toBeInTheDocument();
  });

  it("defaults to the Governance tab and shows the AI Inventory dashboard", async () => {
    renderAt("/grc");
    // The dashboard's "Run discovery" button is the canonical signal.
    expect(
      await screen.findByRole("button", { name: /Run discovery/i }),
    ).toBeInTheDocument();
    // KPI tiles render their labels.
    expect(await screen.findByText(/Total AI systems/i)).toBeInTheDocument();
  });

  it("renders the embedded Risk Register when ?tab=risk", async () => {
    renderAt("/grc?tab=risk");
    await waitFor(() =>
      expect(screen.getByTestId("risk-register")).toBeInTheDocument(),
    );
  });

  it("renders the embedded Compliance scanner when ?tab=compliance", async () => {
    renderAt("/grc?tab=compliance");
    await waitFor(() =>
      expect(screen.getByTestId("turbolens-security")).toBeInTheDocument(),
    );
  });
});
