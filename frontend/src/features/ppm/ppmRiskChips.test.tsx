import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTheme } from "@mui/material/styles";
import { RAG_COLORS } from "@/theme/tokens";
import { RiskScoreChip, RiskStatusChip } from "./ppmRiskChips";

const { palette } = createTheme();
const chipOf = (container: HTMLElement) => container.querySelector(".MuiChip-root") as HTMLElement;

describe("RiskScoreChip", () => {
  it.each([
    [20, 5, 4, RAG_COLORS.red],
    [15, 3, 5, RAG_COLORS.red],
    [14, 2, 7, RAG_COLORS.amber],
    [6, 2, 3, RAG_COLORS.amber],
    [5, 1, 5, RAG_COLORS.green],
    [1, 1, 1, RAG_COLORS.green],
  ])("fills score %i in its band colour, white bold ink, its factors beside it", (score, p, i, color) => {
    const { container } = render(
      <RiskScoreChip risk={{ risk_score: score, probability: p, impact: i }} />,
    );
    const chip = chipOf(container);
    expect(chip).toHaveTextContent(String(score));
    expect(chip).toHaveStyle({ backgroundColor: color, color: palette.common.white, fontWeight: 700 });
    expect(chip).toHaveClass("MuiChip-sizeSmall", "MuiChip-filled");
    expect(container.querySelector(".MuiTypography-caption")).toHaveTextContent(
      new RegExp(`^${p} × ${i}$`),
    );
    // Chip then caption, nothing else: the grid's sort and copy read this text.
    expect(container.textContent).toBe(`${score}${p} × ${i}`);
  });

  it("keeps the chip and its caption on one line, inline in the cell", () => {
    const { container } = render(
      <RiskScoreChip risk={{ risk_score: 9, probability: 3, impact: 3 }} />,
    );
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.tagName).toBe("SPAN");
    expect(wrap).toHaveStyle({ whiteSpace: "nowrap" });
    expect(chipOf(container)).toHaveStyle({ minWidth: "32px" });
  });
});

describe("RiskStatusChip", () => {
  it.each([
    ["open", "Open", "MuiChip-colorError"],
    ["mitigating", "Mitigating", "MuiChip-colorWarning"],
    ["mitigated", "Mitigated", "MuiChip-colorSuccess"],
    ["accepted", "Accepted", "MuiChip-colorInfo"],
    ["closed", "Closed", "MuiChip-colorDefault"],
  ])("draws %s as an outlined, translated chip in its theme colour", (status, label, cls) => {
    const { container } = render(<RiskStatusChip status={status} />);
    const chip = chipOf(container);
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveClass("MuiChip-outlined", "MuiChip-sizeSmall", cls);
  });

  it("shows a status it does not know as stored, in the default grey", () => {
    const { container } = render(<RiskStatusChip status="parked" />);
    expect(screen.getByText("parked")).toBeInTheDocument();
    expect(chipOf(container)).toHaveClass("MuiChip-colorDefault", "MuiChip-outlined");
  });

  it("does not take an inherited property for a status", () => {
    const { container } = render(<RiskStatusChip status="toString" />);
    expect(chipOf(container)).toHaveClass("MuiChip-colorDefault");
  });
});
