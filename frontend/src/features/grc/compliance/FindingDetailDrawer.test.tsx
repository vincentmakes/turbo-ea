import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TurboLensComplianceFinding } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/useComplianceRegulations", () => ({
  useComplianceRegulations: () => ({
    byKey: { eu_ai_act: { key: "eu_ai_act", label: "EU AI Act (custom)" } },
    enabled: [],
    regulations: [],
    loaded: true,
    refresh: vi.fn(),
  }),
}));
vi.mock("./ComplianceLifecycleTimeline", () => ({ default: () => null }));
vi.mock("./findingPrint", () => ({ printFinding: vi.fn() }));

import { printFinding } from "./findingPrint";
import FindingDetailDrawer from "./FindingDetailDrawer";

const finding = {
  id: "f1",
  regulation: "eu_ai_act",
  regulation_article: "Art. 9",
  card_id: "c1",
  card_name: "NexaCore ERP",
  card_type: "Application",
  scope_type: "card",
  category: "risk_management",
  requirement: "Establish a risk management system.",
  status: "non_compliant",
  severity: "high",
  gap_description: "No process.",
  evidence: null,
  remediation: null,
  ai_detected: false,
  risk_id: null,
  risk_reference: null,
  decision: "new",
  reviewed_by: null,
  reviewer_name: null,
  reviewed_at: null,
  review_note: null,
  auto_resolved: false,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
} as unknown as TurboLensComplianceFinding;

beforeEach(() => vi.mocked(printFinding).mockReset());

describe("FindingDetailDrawer — Export PDF", () => {
  it("prints the open finding with the resolved regulation label", async () => {
    render(<FindingDetailDrawer finding={finding} onClose={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Export PDF" });
    await userEvent.click(btn);
    expect(printFinding).toHaveBeenCalledTimes(1);
    expect(printFinding).toHaveBeenCalledWith(finding, "EU AI Act (custom)");
    // The subtitle uses the same resolver, so the two never disagree.
    expect(screen.getByText(/EU AI Act \(custom\)/)).toBeInTheDocument();
  });
});
