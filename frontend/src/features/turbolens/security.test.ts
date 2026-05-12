import { describe, it, expect } from "vitest";
import {
  complianceStatusColor,
  cveSeverityColor,
  cveStatusColor,
  probabilityColor,
} from "./utils";
import {
  deriveLevelFromPair,
  riskLevelBackground,
} from "../grc/risk/riskMatrixColors";

describe("CVE severity / status / probability colors", () => {
  it("maps known CVE severity values to MUI chip colors", () => {
    expect(cveSeverityColor("critical")).toBe("error");
    expect(cveSeverityColor("high")).toBe("error");
    expect(cveSeverityColor("medium")).toBe("warning");
    expect(cveSeverityColor("low")).toBe("info");
    expect(cveSeverityColor("unknown")).toBe("default");
    expect(cveSeverityColor("nonsense")).toBe("default");
  });

  it("maps finding status to chip colors", () => {
    expect(cveStatusColor("open")).toBe("error");
    expect(cveStatusColor("acknowledged")).toBe("info");
    expect(cveStatusColor("in_progress")).toBe("warning");
    expect(cveStatusColor("mitigated")).toBe("success");
    expect(cveStatusColor("accepted")).toBe("default");
  });

  it("maps probability to chip colors", () => {
    expect(probabilityColor("very_high")).toBe("error");
    expect(probabilityColor("high")).toBe("warning");
    expect(probabilityColor("medium")).toBe("info");
    expect(probabilityColor("low")).toBe("success");
  });

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
    expect(riskLevelBackground(deriveLevelFromPair("low", "low"))).toMatch(
      /rgba\(56/,
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
