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
  it("renders exact invoiced and accessible budget and actual values", () => {
    render(<PpmInitiativeFinancials data={data} />);
    expect(screen.getByText(/30[.,]11/)).toBeInTheDocument();
    expect(screen.getByText(/92%/)).toBeInTheDocument();
    expect(screen.getByText(/1[.,]?000/)).toBeInTheDocument();
    expect(screen.getByText(/3[.,]?000/)).toBeInTheDocument();
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

  it("renders exact variance when the server serializes Decimal with an exponent", () => {
    const comparison = data.card_comparison!;
    render(
      <PpmInitiativeFinancials
        data={{
          ...data,
          card_comparison: {
            budget: { ...comparison.budget, total: "2E-7" },
            actual: { ...comparison.actual, total: "1E-7" },
          },
        }}
      />,
    );
    expect(screen.getByText(/Total:.*50%/)).toHaveTextContent(/0[.,]0000001/);
  });
  it("shows negative variance and no ratio for zero budget", () => {
    render(<PpmInitiativeFinancials data={data} />);
    expect(screen.getByText(/CapEx:.*-.*3[.,]?000/)).toBeInTheDocument();
    expect(screen.getByText(/Total:.*92%/)).toBeInTheDocument();
    expect(screen.getByText(/CapEx:/)).not.toHaveTextContent("%");
  });
});
