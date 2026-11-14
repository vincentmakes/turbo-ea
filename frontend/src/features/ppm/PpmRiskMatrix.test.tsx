import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PpmRisk } from "@/types";
import PpmRiskMatrix from "./PpmRiskMatrix";
import { riskBandSwatch, riskMatrixCellColor } from "./ppmReportModel";

const risk = (probability: number, impact: number): PpmRisk =>
  ({ id: `${probability}-${impact}`, probability, impact, risk_score: probability * impact }) as PpmRisk;

const cellAt = (container: HTMLElement, p: number, i: number) =>
  container.querySelector(`[data-row="${p}"][data-col="${i}"]`) as HTMLElement;

describe("PpmRiskMatrix", () => {
  it("is a 5×5, probability 5 down to 1, impact 5 down to 1, each cell tinted by its band", () => {
    const { container } = render(<PpmRiskMatrix risks={[]} />);
    const cells = [...container.querySelectorAll("[data-row]")] as HTMLElement[];
    expect(cells).toHaveLength(25);
    expect(cells.slice(0, 5).map((c) => `${c.dataset.row}${c.dataset.col}`)).toEqual([
      "55",
      "54",
      "53",
      "52",
      "51",
    ]);
    expect(`${cells[24].dataset.row}${cells[24].dataset.col}`).toBe("11");
    for (const c of cells) {
      expect(c).toHaveStyle({
        backgroundColor: riskMatrixCellColor(Number(c.dataset.row), Number(c.dataset.col)),
      });
      expect(c).toHaveTextContent("—");
    }
    expect(screen.getByText(/Impact → \/ Probability ↓/)).toBeInTheDocument();
  });

  it("counts each risk in its cell", () => {
    const { container } = render(
      <PpmRiskMatrix risks={[risk(4, 5), risk(4, 5), risk(1, 2), risk(9, 9)]} />,
    );
    expect(cellAt(container, 4, 5)).toHaveTextContent("2");
    expect(cellAt(container, 1, 2)).toHaveTextContent("1");
    expect(cellAt(container, 5, 5)).toHaveTextContent("—");
  });

  it("recounts when the risks change", () => {
    const { container, rerender } = render(<PpmRiskMatrix risks={[risk(4, 5)]} />);
    expect(cellAt(container, 4, 5)).toHaveTextContent("1");
    rerender(<PpmRiskMatrix risks={[risk(4, 5), risk(4, 5), risk(2, 2)]} />);
    expect(cellAt(container, 4, 5)).toHaveTextContent("2");
    expect(cellAt(container, 2, 2)).toHaveTextContent("1");
  });

  it("closes with the three score bands, highest first, and is read-only", () => {
    const { container } = render(<PpmRiskMatrix risks={[risk(3, 3)]} />);
    const items = [...container.querySelectorAll("[data-legend-item]")];
    expect(items.map((el) => el.textContent)).toEqual(["High", "Medium", "Low"]);
    expect(items[0].querySelector("[data-legend-swatch]")).toHaveStyle({
      backgroundColor: riskBandSwatch("high"),
    });
    expect(items[2].querySelector("[data-legend-swatch]")).toHaveStyle({
      backgroundColor: riskBandSwatch("low"),
    });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
