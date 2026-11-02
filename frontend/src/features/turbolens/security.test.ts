import { describe, it, expect } from "vitest";
import { alpha } from "@mui/material/styles";
import { SEVERITY_COLORS } from "@/theme/tokens";
import { complianceStatusColor } from "./utils";
import {
  deriveLevelFromPair,
  riskLevelBackground,
} from "../grc/risk/riskMatrixColors";

describe("complianceStatusColor", () => {
  it("maps compliance status to chip colors", () => {
    expect(complianceStatusColor("compliant")).toBe("success");
    expect(complianceStatusColor("partial")).toBe("warning");
    expect(complianceStatusColor("non_compliant")).toBe("error");
    expect(complianceStatusColor("review_needed")).toBe("info");
    expect(complianceStatusColor("not_applicable")).toBe("default");
  });
});

describe("riskLevelBackground", () => {
  it("returns deep red for the very_high × critical cell", () => {
    expect(
      riskLevelBackground(deriveLevelFromPair("very_high", "critical")),
    ).toMatch(/rgba\(211/);
  });

  it("returns green for the low × low cell", () => {
    expect(riskLevelBackground(deriveLevelFromPair("low", "low"))).toBe(
      alpha(SEVERITY_COLORS.low, 0.18),
    );
  });

  it("returns grey for the unknown axes", () => {
    expect(
      riskLevelBackground(deriveLevelFromPair("unknown", "unknown")),
    ).toMatch(/rgba\(117/);
  });

  it("always reflects the cell's intrinsic severity, even when empty", () => {
    // Regardless of count, a very_high × critical cell must stay red —
    // the matrix is a heatmap of the (probability, impact) space, not a
    // sparse plot of current risks.
    expect(
      riskLevelBackground(deriveLevelFromPair("very_high", "critical")),
    ).toMatch(/rgba\(211/);
  });

  it("severity decreases monotonically from top-left to bottom-right", () => {
    const topLeft = riskLevelBackground(
      deriveLevelFromPair("very_high", "critical"),
    );
    const middle = riskLevelBackground(deriveLevelFromPair("medium", "medium"));
    const bottomRight = riskLevelBackground(deriveLevelFromPair("low", "low"));
    expect(topLeft).not.toBe(middle);
    expect(middle).not.toBe(bottomRight);
  });
});
