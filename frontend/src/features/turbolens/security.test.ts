import { describe, it, expect } from "vitest";
import {
  complianceStatusColor,
  cveSeverityColor,
  cveStatusColor,
  probabilityColor,
  riskMatrixColor,
} from "./utils";

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

describe("riskMatrixColor", () => {
  // Rows are probability indices (0 = very_high → 4 = unknown).
  // Columns are severity indices (0 = critical → 4 = unknown).
  it("returns deep red for the top-left (very_high x critical) cell", () => {
    expect(riskMatrixColor(0, 0)).toMatch(/rgba\(211/);
  });

  it("returns green for the bottom-left / low-severity corner", () => {
    expect(riskMatrixColor(3, 3)).toMatch(/rgba\(56/);
  });

  it("returns grey for the unknown/unknown corner", () => {
    expect(riskMatrixColor(4, 4)).toMatch(/rgba\(117/);
  });

  it("heat decreases as we move away from the top-left", () => {
    const topLeft = riskMatrixColor(0, 0);
    const middle = riskMatrixColor(2, 2);
    const bottomRight = riskMatrixColor(3, 3);
    expect(topLeft).not.toBe(middle);
    expect(middle).not.toBe(bottomRight);
  });
});
