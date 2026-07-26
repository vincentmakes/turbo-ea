import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PpmRiskTab from "./PpmRiskTab";
import type { PpmRisk } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const navigate = vi.fn();
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: "u1" } }),
}));

let grcEnabled = true;
vi.mock("@/hooks/useGrcEnabled", () => ({
  useGrcEnabled: () => ({ grcEnabled, grcLoaded: true, invalidateGrc: vi.fn() }),
}));

let permissions: Record<string, boolean> = {};
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: (key: string) => !!permissions[key] }),
}));

// The landscape block reuses the card-detail RisksTab; stub it so this test
// only asserts the gating + the heading override wiring.
vi.mock("@/features/cards/sections/RisksTab", () => ({
  default: ({ heading }: { heading?: string }) => (
    <div data-testid="landscape-block">{heading}</div>
  ),
}));

function ppmRisk(overrides: Partial<PpmRisk> = {}): PpmRisk {
  return {
    id: "r1",
    initiative_id: "init-1",
    title: "Vendor may slip",
    description: null,
    probability: 3,
    impact: 3,
    risk_score: 9,
    mitigation: null,
    owner_id: null,
    owner_name: null,
    status: "open",
    promoted_risk_id: null,
    promoted_risk_reference: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderTab(risks: PpmRisk[]) {
  return render(
    <PpmRiskTab initiativeId="init-1" risks={risks} onRefresh={vi.fn()} />,
  );
}

describe("PpmRiskTab GRC bridge", () => {
  beforeEach(() => {
    grcEnabled = true;
    permissions = { "risks.view": true, "risks.manage": true };
    navigate.mockReset();
  });

  it("shows the landscape block with its own heading when GRC is on", () => {
    renderTab([]);
    expect(screen.getByTestId("landscape-block")).toBeInTheDocument();
  });

  it("hides the landscape block when GRC is disabled", () => {
    grcEnabled = false;
    renderTab([]);
    expect(screen.queryByTestId("landscape-block")).not.toBeInTheDocument();
  });

  it("hides the landscape block without risks.view", () => {
    permissions = { "risks.view": false, "risks.manage": false };
    renderTab([]);
    expect(screen.queryByTestId("landscape-block")).not.toBeInTheDocument();
  });

  it("shows a promote action on an unpromoted risk for risks.manage holders", () => {
    renderTab([ppmRisk()]);
    // MaterialSymbol renders the icon name as text content.
    expect(screen.getByText("move_up")).toBeInTheDocument();
    // No back-link chip yet.
    expect(screen.queryByText(/R-\d{6}/)).not.toBeInTheDocument();
  });

  it("hides promote without risks.manage", () => {
    permissions = { "risks.view": true, "risks.manage": false };
    renderTab([ppmRisk()]);
    expect(screen.queryByText("move_up")).not.toBeInTheDocument();
  });

  it("shows the open-risk chip and navigates on click once promoted", async () => {
    renderTab([
      ppmRisk({ promoted_risk_id: "grc-9", promoted_risk_reference: "R-000042" }),
    ]);
    const chip = screen.getByText("R-000042");
    await userEvent.click(chip);
    expect(navigate).toHaveBeenCalledWith("/grc/risks/grc-9");
  });
});
