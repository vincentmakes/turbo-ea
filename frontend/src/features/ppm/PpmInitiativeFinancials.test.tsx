import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PpmInitiativeFinancials from "./PpmInitiativeFinancials";
import type { PpmFinancials } from "@/types";

vi.mock("@/components/charts/EChart", () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const data = {
  initiative_id: "initiative",
  card_comparison: {
    budget: { total: "12000", capex: "0", opex: "12000", derived: false },
    actual: { total: "11000", capex: "3000", opex: "8000", derived: false },
  },
  invoice_access: true,
  actual_invoiced: "30.11",
} as PpmFinancials;

describe("PpmInitiativeFinancials", () => {
  it("shows the comparison without repeating summary totals", () => {
    render(<PpmInitiativeFinancials data={data} />);
    expect(screen.getByRole("img", { name: "Financials" })).toBeInTheDocument();
    expect(screen.getByText(/30[.,]11/)).toBeInTheDocument();
    expect(screen.queryByText(/^Total:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^CapEx:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^OpEx:/)).not.toBeInTheDocument();
  });

  it("only renders an authorized comparison and omits invoice when unavailable", () => {
    const { rerender } = render(
      <PpmInitiativeFinancials data={{ ...data, card_comparison: null }} />,
    );
    expect(screen.queryByText(/30[.,]11/)).not.toBeInTheDocument();
    rerender(
      <PpmInitiativeFinancials data={{ ...data, invoice_access: false, actual_invoiced: null }} />,
    );
    expect(screen.queryByText(/30[.,]11/)).not.toBeInTheDocument();
  });

});
