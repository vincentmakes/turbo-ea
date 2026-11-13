import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RiskMatrix, { RiskMatrixSelection } from "./RiskMatrix";
import { riskLevelBackground, riskLevelSwatch } from "./riskMatrixColors";

/**
 * The CSS emotion wrote for one element, media queries included: jsdom drops
 * `grid-template-columns` from computed styles, so it is read from the sheet.
 */
function emotionCss(el: Element): string {
  const classes = [...el.classList].filter((c) => c.startsWith("css-"));
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("");
  return css
    .split("}")
    .filter((rule) => classes.some((c) => rule.includes(`.${c}{`)))
    .join("}");
}

/** The grid of cells: the matrix root's first child. */
const gridOf = (container: HTMLElement) => container.firstElementChild!.firstElementChild!;

/** The column captions across the top, in order (the axis caption excluded). */
const columnCaptions = (container: HTMLElement) =>
  [...gridOf(container).children]
    .filter((el) => el.classList.contains("MuiTypography-caption"))
    .map((el) => el.textContent);

const sample: number[][] = [
  // prob = very_high: critical, high, medium, low
  [3, 1, 0, 0],
  [0, 2, 1, 0],
  [0, 0, 0, 1],
  [0, 0, 0, 0],
];

describe("RiskMatrix", () => {
  it("renders each cell with its count (or em dash for zero)", () => {
    render(<RiskMatrix matrix={sample} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // At least one zero cell renders as an em dash placeholder.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("invokes onSelect with the clicked (probability, impact) tuple", async () => {
    const onSelect = vi.fn<[RiskMatrixSelection | null], void>();
    const user = userEvent.setup();
    render(<RiskMatrix matrix={sample} onSelect={onSelect} />);
    const cells = screen.getAllByRole("button");
    // The first button in the flow is the very_high × critical cell (count=3).
    await user.click(cells[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      probability: "very_high",
      impact: "critical",
    });
  });

  it("re-clicking the active cell clears the selection", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <RiskMatrix
        matrix={sample}
        onSelect={onSelect}
        highlight={{ probability: "very_high", impact: "critical" }}
      />,
    );
    await user.click(screen.getAllByRole("button")[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("is read-only when onSelect is not provided (no buttons rendered)", () => {
    render(<RiskMatrix matrix={sample} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("RiskMatrix — default GRC axes, in detail", () => {
  const cell = (container: HTMLElement, row: string, col: string) =>
    container.querySelector(`[data-row="${row}"][data-col="${col}"]`) as HTMLElement;

  it("lays out 4 probability rows by 4 impact columns, labelled and tinted by level", () => {
    const { container } = render(<RiskMatrix matrix={sample} />);
    for (const label of ["Very high", "Critical", "Low"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const cells = [...container.querySelectorAll("[data-row]")].map(
      (el) => `${el.getAttribute("data-row")}/${el.getAttribute("data-col")}`,
    );
    expect(cells).toHaveLength(16);
    expect(cells.slice(0, 4)).toEqual([
      "very_high/critical",
      "very_high/high",
      "very_high/medium",
      "very_high/low",
    ]);
    expect(cells[15]).toBe("low/low");
    expect(cell(container, "very_high", "critical")).toHaveStyle({
      backgroundColor: riskLevelBackground("critical"),
    });
    expect(cell(container, "low", "low")).toHaveStyle({
      backgroundColor: riskLevelBackground("low"),
    });
    expect(cell(container, "very_high", "critical")).toHaveTextContent("3");
    expect(cell(container, "high", "medium")).toHaveTextContent("1");
    expect(cell(container, "low", "critical")).toHaveTextContent("—");
    expect(screen.getByText(/Impact → \/ Probability ↓/)).toBeInTheDocument();
  });

  it("reads a missing row as zeros", () => {
    const { container } = render(<RiskMatrix matrix={[[1]]} />);
    expect(cell(container, "very_high", "critical")).toHaveTextContent("1");
    expect(cell(container, "very_high", "high")).toHaveTextContent("—");
    expect(cell(container, "low", "low")).toHaveTextContent("—");
    for (const row of ["high", "medium", "low"]) {
      expect(
        ["critical", "high", "medium", "low"].map((col) => cell(container, row, col).textContent),
      ).toEqual(["—", "—", "—", "—"]);
    }
  });

  it("captions the columns with the impact levels, most severe first", () => {
    const { container } = render(<RiskMatrix matrix={sample} />);
    expect(columnCaptions(container)).toEqual(["Critical", "High", "Medium", "Low"]);
  });

  it("sizes one grid column per impact after the label column, narrower on phones", () => {
    const { container } = render(<RiskMatrix matrix={sample} />);
    const css = emotionCss(gridOf(container));
    expect(css).toContain("@media (min-width:0px){.");
    expect(css).toMatch(/min-width:0px\)\{[^{]*\{grid-template-columns:84px repeat\(4, 1fr\);/);
    expect(css).toMatch(/min-width:600px\)\{[^{]*\{grid-template-columns:130px repeat\(4, 1fr\);/);
  });

  it("outlines the highlighted cell only", () => {
    const { container } = render(
      <RiskMatrix
        matrix={sample}
        onSelect={() => {}}
        highlight={{ probability: "high", impact: "medium" }}
      />,
    );
    expect(cell(container, "high", "medium")).toHaveStyle({ outline: "2px solid" });
    expect(cell(container, "high", "high")).not.toHaveStyle({ outline: "2px solid" });
    // Neither the rest of its row nor the rest of its column.
    const outlined = [...container.querySelectorAll("[data-row]")]
      .filter((el) => getComputedStyle(el).outline === "2px solid")
      .map((el) => `${el.getAttribute("data-row")}/${el.getAttribute("data-col")}`);
    expect(outlined).toEqual(["high/medium"]);
  });

  it("outlines nothing without a highlight", () => {
    const { container } = render(<RiskMatrix matrix={sample} onSelect={() => {}} />);
    const outlined = [...container.querySelectorAll("[data-row]")].filter(
      (el) => getComputedStyle(el).outline === "2px solid",
    );
    expect(outlined).toHaveLength(0);
  });

  it("selects a cell by keyboard too", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<RiskMatrix matrix={sample} onSelect={onSelect} />);
    cell(container, "medium", "low").focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith({ probability: "medium", impact: "low" });
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
    await user.keyboard("x");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("closes with the four-level legend", () => {
    const { container } = render(<RiskMatrix matrix={sample} />);
    const items = [...container.querySelectorAll("[data-legend-item]")];
    expect(items.map((el) => el.textContent)).toEqual(["Critical", "High", "Medium", "Low"]);
    expect(items[0].querySelector("[data-legend-swatch]")).toHaveStyle({
      backgroundColor: riskLevelSwatch("critical"),
    });
  });
});

describe("RiskMatrix — custom axes", () => {
  const rows = [
    { key: "r1", label: "Row one" },
    { key: "r2", label: "Row two" },
  ];
  const cols = [
    { key: "a", label: "Col A" },
    { key: "b", label: "Col B" },
    { key: "c", label: "Col C" },
  ];
  const tints: Record<string, string> = {
    "r1/a": "rgba(10, 20, 30, 0.5)",
    "r1/b": "rgba(40, 50, 60, 0.5)",
    "r1/c": "rgba(70, 80, 90, 0.5)",
    "r2/a": "rgba(1, 2, 3, 0.5)",
    "r2/b": "rgba(4, 5, 6, 0.5)",
    "r2/c": "rgba(7, 8, 9, 0.5)",
  };
  const legendItems = [
    { label: "Hot", color: "rgba(200, 0, 0, 0.7)" },
    { label: "Cold", color: "rgba(0, 0, 200, 0.7)" },
  ];
  const renderCustom = () =>
    render(
      <RiskMatrix
        matrix={[
          [0, 4, 0],
          [2, 0, 7],
        ]}
        rows={rows}
        cols={cols}
        cellColor={(r, c) => tints[`${r}/${c}`]}
        legendItems={legendItems}
        probabilityAxisLabel="P"
        impactAxisLabel="I"
      />,
    );

  it("draws its rows, columns, counts and per-cell colours", () => {
    const { container } = renderCustom();
    expect(screen.getByText("Row one")).toBeInTheDocument();
    expect(screen.getByText("Col C")).toBeInTheDocument();
    expect(screen.getByText(/I → \/ P ↓/)).toBeInTheDocument();
    const cells = [...container.querySelectorAll("[data-row]")] as HTMLElement[];
    expect(cells.map((el) => `${el.dataset.row}/${el.dataset.col}=${el.textContent}`)).toEqual([
      "r1/a=—",
      "r1/b=4",
      "r1/c=—",
      "r2/a=2",
      "r2/b=—",
      "r2/c=7",
    ]);
    for (const el of cells) {
      expect(el).toHaveStyle({ backgroundColor: tints[`${el.dataset.row}/${el.dataset.col}`] });
    }
    expect(cells[1].querySelector("p")).toHaveStyle({ fontWeight: 700 });
    expect(cells[0].querySelector("p")).toHaveStyle({ fontWeight: 500 });
  });

  it("sizes one grid column per custom column", () => {
    const { container } = renderCustom();
    expect(columnCaptions(container)).toEqual(["Col A", "Col B", "Col C"]);
    const css = emotionCss(gridOf(container));
    expect(css).toMatch(/min-width:0px\)\{[^{]*\{grid-template-columns:84px repeat\(3, 1fr\);/);
    expect(css).toMatch(/min-width:600px\)\{[^{]*\{grid-template-columns:130px repeat\(3, 1fr\);/);
  });

  it("closes with its own legend items", () => {
    const { container } = renderCustom();
    const items = [...container.querySelectorAll("[data-legend-item]")];
    expect(items.map((el) => el.textContent)).toEqual(["Hot", "Cold"]);
    expect(items[1].querySelector("[data-legend-swatch]")).toHaveStyle({
      backgroundColor: "rgba(0, 0, 200, 0.7)",
    });
  });

  it("is read-only", () => {
    renderCustom();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
