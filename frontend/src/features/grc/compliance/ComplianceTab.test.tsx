import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AiStatus, User } from "@/types";

vi.mock("@/features/turbolens/TurboLensSecurity", () => ({
  default: () => <div data-testid="turbolens-security" />,
}));

vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: vi.fn(),
}));

import { useAiStatus } from "@/hooks/useAiStatus";
import { AuthProvider } from "@/hooks/AuthContext";
import ComplianceTab from "./ComplianceTab";

function adminUser(): User {
  return {
    id: "u-admin",
    display_name: "Admin",
    email: "admin@example.com",
    role: "admin",
    is_active: true,
    permissions: { "*": true },
  };
}

function memberUser(): User {
  return {
    id: "u-member",
    display_name: "Member",
    email: "member@example.com",
    role: "member",
    is_active: true,
    permissions: { "inventory.view": true },
  };
}

function setAiStatus(configured: boolean) {
  const aiStatus: AiStatus = {
    enabled: configured,
    configured,
    provider_type: configured ? "ollama" : undefined,
    enabled_types: [],
    running_models: [],
    model: configured ? "mistral" : undefined,
    portfolio_insights_enabled: false,
  };
  vi.mocked(useAiStatus).mockReturnValue({
    aiStatus,
    aiStatusLoaded: true,
    invalidateAiStatus: vi.fn(),
  });
}

function renderWith(user: User) {
  return render(
    <MemoryRouter>
      <AuthProvider user={user} refreshUser={async () => {}}>
        <ComplianceTab />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ComplianceTab", () => {
  it("renders the scanner when AI is configured", async () => {
    setAiStatus(true);
    renderWith(adminUser());
    await waitFor(() =>
      expect(screen.getByTestId("turbolens-security")).toBeInTheDocument(),
    );
  });

  it("blocks the scanner with a configure CTA when AI is not configured (admin)", () => {
    setAiStatus(false);
    renderWith(adminUser());
    expect(screen.queryByTestId("turbolens-security")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /AI provider.*not configured/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /configure/i }),
    ).toHaveAttribute("href", "/admin/settings?tab=ai");
  });

  it("shows the 'contact administrator' hint to non-admins", () => {
    setAiStatus(false);
    renderWith(memberUser());
    expect(screen.queryByTestId("turbolens-security")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /configure/i })).not.toBeInTheDocument();
    expect(screen.getByText(/administrator/i)).toBeInTheDocument();
  });
});
