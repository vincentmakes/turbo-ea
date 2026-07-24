import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("@/features/grc/compliance/ComplianceScanner", () => ({
  default: () => <div data-testid="compliance-scanner" />,
}));

import ComplianceTab from "./ComplianceTab";

describe("ComplianceTab", () => {
  it("renders the scanner unconditionally — the AI gate now lives inside the scanner, scoped to the scan-trigger card only so the overview and register grid stay reachable without AI", async () => {
    render(
      <MemoryRouter>
        <ComplianceTab />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("compliance-scanner")).toBeInTheDocument(),
    );
  });
});
