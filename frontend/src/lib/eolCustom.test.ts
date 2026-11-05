import { describe, expect, it } from "vitest";
import {
  APPROACHING_DAYS,
  cycleStatus,
  customEolKey,
  customEolRef,
  eolProductLabel,
  isCustomEolProduct,
  isValidEolLink,
  milestoneLabelKey,
  milestoneMode,
  milestoneValue,
} from "./eolCustom";

describe("custom EOL link vocabulary", () => {
  it("tells a custom link from an endoflife.date slug", () => {
    expect(isCustomEolProduct("custom:acme")).toBe(true);
    expect(isCustomEolProduct("python")).toBe(false);
    expect(isCustomEolProduct("customer-portal")).toBe(false);
    expect(isCustomEolProduct("")).toBe(false);
    expect(isCustomEolProduct(null)).toBe(false);
    expect(isCustomEolProduct(undefined)).toBe(false);
  });

  it("round-trips a key through its link", () => {
    expect(customEolRef("acme-erp")).toBe("custom:acme-erp");
    expect(customEolKey("custom:acme-erp")).toBe("acme-erp");
    expect(customEolKey("python")).toBe("python");
  });

  it("names a product by its title, else its key", () => {
    expect(eolProductLabel("custom:acme-erp", "Acme ERP")).toBe("Acme ERP");
    expect(eolProductLabel("custom:acme-erp")).toBe("acme-erp");
    expect(eolProductLabel("custom:acme-erp", null)).toBe("acme-erp");
    expect(eolProductLabel("python")).toBe("python");
  });
});

describe("links", () => {
  it("accepts only http(s) links", () => {
    expect(isValidEolLink("https://acme.example/erp")).toBe(true);
    expect(isValidEolLink(" HTTP://acme.example ")).toBe(true);
    expect(isValidEolLink("javascript:alert(1)")).toBe(false);
    expect(isValidEolLink("https://a b")).toBe(false);
    expect(isValidEolLink("acme.example")).toBe(false);
  });
});

describe("milestones", () => {
  it("reads EOL booleans the endoflife.date way: true is over", () => {
    expect(milestoneMode(true, "eol")).toBe("ended");
    expect(milestoneMode(false, "eol")).toBe("ongoing");
  });

  it("reads support booleans the API way: true is still supported", () => {
    expect(milestoneMode(true, "support")).toBe("ongoing");
    expect(milestoneMode(false, "support")).toBe("ended");
  });

  it("reads dates and blanks the same for both", () => {
    for (const kind of ["eol", "support"] as const) {
      expect(milestoneMode("2025-01-01", kind)).toBe("date");
      expect(milestoneMode("", kind)).toBe("unset");
      expect(milestoneMode(null, kind)).toBe("unset");
      expect(milestoneMode(undefined, kind)).toBe("unset");
    }
  });

  it("writes back what it reads", () => {
    for (const kind of ["eol", "support"] as const) {
      for (const value of [true, false, "2025-01-01", null] as const) {
        const mode = milestoneMode(value, kind);
        const date = typeof value === "string" ? value : "";
        expect(milestoneValue(mode, kind, date)).toBe(value);
      }
    }
  });

  it("writes a date mode without a date as null", () => {
    expect(milestoneValue("date", "eol")).toBeNull();
    expect(milestoneValue("unset", "support", "2025-01-01")).toBeNull();
  });
});

describe("milestoneLabelKey", () => {
  it("names a milestone without a date and leaves a date to the caller", () => {
    expect(milestoneLabelKey(null, "eol")).toBe("eol.custom.milestone.eol.unset");
    expect(milestoneLabelKey("", "support")).toBe("eol.custom.milestone.support.unset");
    expect(milestoneLabelKey(true, "eol")).toBe("eol.custom.milestone.eol.ended");
    expect(milestoneLabelKey(false, "eol")).toBe("eol.custom.milestone.eol.ongoing");
    expect(milestoneLabelKey(false, "support")).toBe("eol.custom.milestone.support.ended");
    expect(milestoneLabelKey(true, "support")).toBe("eol.custom.milestone.support.ongoing");
    expect(milestoneLabelKey("2030-01-01", "eol")).toBeNull();
  });
});

describe("cycleStatus mirrors eol_status on the backend", () => {
  const today = "2026-06-15";
  it.each([
    [true, null, "eol"],
    ["2026-06-15", null, "eol"],
    ["2026-06-14", null, "eol"],
    ["2026-06-16", null, "approaching"],
    ["2026-12-14", null, "approaching"],
    ["2027-06-15", null, "supported"],
    ["2027-06-15", "2026-06-15", "approaching"],
    ["2027-06-15", "2026-06-16", "supported"],
    [false, null, "supported"],
    [false, "2026-01-01", "approaching"],
    // `support: false` is endoflife.date's "active support is over".
    [false, false, "approaching"],
    ["2027-06-15", false, "approaching"],
    [null, false, "approaching"],
    [true, false, "eol"],
    ["2026-06-14", false, "eol"],
    ["2026-06-16", false, "approaching"],
    [false, true, "supported"],
    [null, null, "unknown"],
    [null, true, "unknown"],
    ["", null, "unknown"],
    [null, "2020-01-01", "approaching"],
  ] as const)("eol=%j support=%j → %s", (eol, support, status) => {
    expect(cycleStatus(eol, support, today)).toBe(status);
  });

  it("approaches exactly APPROACHING_DAYS ahead", () => {
    expect(APPROACHING_DAYS).toBe(182);
    expect(cycleStatus("2026-12-14", null, today)).toBe("approaching");
    expect(cycleStatus("2026-12-15", null, today)).toBe("supported");
  });
});
