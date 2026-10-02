import { describe, it, expect } from "vitest";

import i18n from "@/i18n";
import { formatBytes, splitBytes, type ByteUnitKey } from "./formatBytes";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

/**
 * The numeric part is locale-formatted, so expectations are built with the
 * same `Intl` the module uses — stated on the already-rounded number, so the
 * test still pins the rounding and the separators follow the runtime locale.
 */
function nf(value: number, fractionDigits: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

const unitLabel = (unit: ByteUnitKey) => i18n.t(`resources.units.${unit}`, { ns: "admin" });

describe("splitBytes", () => {
  it("renders zero as a whole number of bytes", () => {
    expect(splitBytes(0)).toEqual({ value: nf(0, 0), unit: "b" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["negative", -1],
    ["negative large", -5 * MB],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("treats a %s input as zero bytes", (_label, input) => {
    expect(splitBytes(input)).toEqual({ value: nf(0, 0), unit: "b" });
  });

  it("stays in bytes up to 1023 and never shows a fraction there", () => {
    expect(splitBytes(1)).toEqual({ value: nf(1, 0), unit: "b" });
    expect(splitBytes(512)).toEqual({ value: nf(512, 0), unit: "b" });
    expect(splitBytes(1023)).toEqual({ value: nf(1023, 0), unit: "b" });
    // A fractional byte count is a caller error; it is still rounded whole.
    expect(splitBytes(2.6)).toEqual({ value: nf(3, 0), unit: "b" });
  });

  it("switches unit at exactly 1024 and drops the fraction on a round value", () => {
    expect(splitBytes(KB)).toEqual({ value: nf(1, 0), unit: "kb" });
    expect(splitBytes(2 * KB)).toEqual({ value: nf(2, 0), unit: "kb" });
    expect(splitBytes(MB)).toEqual({ value: nf(1, 0), unit: "mb" });
    expect(splitBytes(GB)).toEqual({ value: nf(1, 0), unit: "gb" });
    expect(splitBytes(TB)).toEqual({ value: nf(1, 0), unit: "tb" });
  });

  it("keeps one decimal for a scaled value under 100", () => {
    expect(splitBytes(1536)).toEqual({ value: nf(1.5, 1), unit: "kb" });
    expect(splitBytes(2.345 * MB)).toEqual({ value: nf(2.3, 1), unit: "mb" });
    expect(splitBytes(99.94 * GB)).toEqual({ value: nf(99.9, 1), unit: "gb" });
  });

  it("rounds the single decimal half-up", () => {
    // 1.25 KB → 1.3, 1.24 KB → 1.2
    expect(splitBytes(1280)).toEqual({ value: nf(1.3, 1), unit: "kb" });
    expect(splitBytes(1270)).toEqual({ value: nf(1.2, 1), unit: "kb" });
  });

  it("drops the decimal once the scaled value reaches 100", () => {
    expect(splitBytes(100 * KB)).toEqual({ value: nf(100, 0), unit: "kb" });
    expect(splitBytes(150 * KB + 700)).toEqual({ value: nf(151, 0), unit: "kb" });
    expect(splitBytes(999.4 * MB)).toEqual({ value: nf(999, 0), unit: "mb" });
  });

  it("stops at terabytes, letting the value grow past 1024 (current behaviour)", () => {
    expect(splitBytes(1024 * TB)).toEqual({ value: nf(1024, 0), unit: "tb" });
    expect(splitBytes(2.5 * 1024 * TB)).toEqual({ value: nf(2560, 0), unit: "tb" });
  });

  it("can round up to 1024 inside a unit rather than promoting it (current behaviour)", () => {
    // 1023.95 KB is under the 1024 threshold, so the unit stays KB; the
    // zero-decimal rounding then prints it as 1024 KB rather than 1 MB.
    expect(splitBytes(1024 * KB - 50)).toEqual({ value: nf(1024, 0), unit: "kb" });
  });

  it("formats the number through the runtime locale", () => {
    // A thousand-range byte count picks up whatever grouping the locale uses.
    const { value } = splitBytes(1023);
    expect(value).toBe((1023).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  });
});

describe("formatBytes", () => {
  it("joins the locale number and the caller's unit label with one space", () => {
    expect(formatBytes(1536, unitLabel)).toBe(`${nf(1.5, 1)} ${unitLabel("kb")}`);
    expect(formatBytes(3 * GB, unitLabel)).toBe(`${nf(3, 0)} ${unitLabel("gb")}`);
    expect(formatBytes(0, unitLabel)).toBe(`${nf(0, 0)} ${unitLabel("b")}`);
  });

  it("asks the resolver for exactly the unit it chose", () => {
    const seen: ByteUnitKey[] = [];
    formatBytes(5 * MB, (u) => {
      seen.push(u);
      return u;
    });
    expect(seen).toEqual(["mb"]);
  });

  it("has a translated label for every unit it can hand out", () => {
    for (const unit of ["b", "kb", "mb", "gb", "tb"] as const) {
      expect(i18n.exists(`resources.units.${unit}`, { ns: "admin" })).toBe(true);
      expect(unitLabel(unit)).not.toBe("");
    }
  });

  it("renders a missing size as zero bytes, not an empty string", () => {
    expect(formatBytes(null, unitLabel)).toBe(`${nf(0, 0)} ${unitLabel("b")}`);
    expect(formatBytes(undefined, unitLabel)).toBe(`${nf(0, 0)} ${unitLabel("b")}`);
  });
});
