import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { CalculationRunReport } from "@/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDateTime: (v: string | null) => v ?? "" }),
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Application",
        label: "Application",
        translations: {},
        fields_schema: [],
        is_hidden: false,
      },
    ],
    relationTypes: [],
  }),
}));

import { api } from "@/api/client";
import CalculationsAdmin from "./CalculationsAdmin";
import { formatRunReport } from "./calculationRunReport";

const CALC = {
  id: "calc-1",
  name: "Total cost",
  target_type_key: "Application",
  target_field_key: "doubledCost",
  formula: "data.costTotalAnnual * 2",
  is_active: true,
  execution_order: 0,
  warnings: [],
};

const FAILING_REPORT: CalculationRunReport = {
  cards_processed: 22,
  calculations_succeeded: 1,
  calculations_failed: 21,
  calculations: [
    {
      calculation_id: "calc-1",
      name: "Total cost",
      target_field: "doubledCost",
      succeeded: 1,
      failed: 21,
      failures: [
        {
          error: "Field(s) 'costTotalAnnual' are empty on this card",
          count: 21,
          cards: [
            { id: "card-a", name: "Payroll Portal" },
            { id: "card-b", name: "Billing Engine" },
          ],
          cards_truncated: true,
        },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CalculationsAdmin />
    </MemoryRouter>,
  );
}

describe("formatRunReport", () => {
  it("renders counts, the grouped error and its cards as plain text", () => {
    const text = formatRunReport(FAILING_REPORT, "Application");
    expect(text).toContain("22 cards processed, 1 succeeded, 21 failed");
    expect(text).toContain("Total cost (doubledCost) — 1 ok, 21 failed");
    expect(text).toContain("21x Field(s) 'costTotalAnnual' are empty on this card");
    expect(text).toContain("Payroll Portal, Billing Engine, …");
  });

  it("omits the ellipsis when the card list is complete", () => {
    const complete: CalculationRunReport = {
      ...FAILING_REPORT,
      calculations: [
        {
          ...FAILING_REPORT.calculations[0],
          failures: [
            { ...FAILING_REPORT.calculations[0].failures[0], cards_truncated: false, count: 2 },
          ],
        },
      ],
    };
    expect(formatRunReport(complete, "Application")).not.toContain("…");
  });
});

describe("CalculationsAdmin recalculation results", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.get).mockResolvedValue([CALC]);
  });

  it("shows the failing cards and the reason behind «View details»", async () => {
    vi.mocked(api.post).mockResolvedValue(FAILING_REPORT);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Total cost")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /recalculate/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/calculations/recalculate/Application", {}),
    );

    // The summary alone is what #886 complained about — the detail has to be
    // one click away, not a round of manual testing per card.
    await user.click(await screen.findByRole("button", { name: /view details/i }));

    expect(
      await screen.findByText(/Field\(s\) 'costTotalAnnual' are empty on this card/),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Payroll Portal" });
    expect(link).toHaveAttribute("href", "/cards/card-a");
    expect(screen.getByRole("link", { name: "Billing Engine" })).toBeInTheDocument();
    // 21 hit the error, 2 are listed — the gap must be stated, not swallowed.
    expect(screen.getByText(/19 more/)).toBeInTheDocument();
  });

  it("offers no details button when nothing ran", async () => {
    vi.mocked(api.post).mockResolvedValue({
      cards_processed: 0,
      calculations_succeeded: 0,
      calculations_failed: 0,
      calculations: [],
    } satisfies CalculationRunReport);
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Total cost")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /recalculate/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /view details/i })).not.toBeInTheDocument();
  });
});
