import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// Risk register pulls a lot of state — stub it.
vi.mock("@/features/grc/risk/RiskRegisterPage", () => ({
  default: () => <div data-testid="risk-register" />,
}));

vi.mock("@/features/turbolens/TurboLensSecurity", () => ({
  default: () => <div data-testid="turbolens-security" />,
}));

// ComplianceTab wraps TurboLensSecurity with an AI-provider gate. Stub the
// wrapper so this smoke test doesn't depend on useAiStatus's network call;
// the gate is exercised by ComplianceTab.test.tsx.
vi.mock("./compliance/ComplianceTab", () => ({
  default: () => <div data-testid="turbolens-security" />,
}));

import { api } from "@/api/client";
import GrcPage from "./GrcPage";

beforeEach(() => {
  vi.clearAllMocks();
  // /metamodel/principles, /adr → empty arrays.
  vi.mocked(api.get).mockResolvedValue([]);
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

  it("defaults to the Governance tab and lands on the Principles sub-tab", async () => {
    renderAt("/grc");
    // With no principles seeded, the panel renders its empty-state copy.
    expect(
      await screen.findByText(/No active principles yet/i),
    ).toBeInTheDocument();
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
