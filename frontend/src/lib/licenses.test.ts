import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { STATUS_COLORS } from "@/theme/tokens";
import type { LicenseMetricItem, LicenseTypeItem } from "@/types";
import { isLicenseType, formatPct, statusColor, STATUS_ORDER, pairKey, pairLabel, addableCatalogue } from "./licenses";

const t = ((key: string) => key) as unknown as TFunction;

describe("licenses helpers", () => {
  it("maps each status to its semantic token", () => {
    expect(statusColor("over")).toBe(STATUS_COLORS.error);
    expect(statusColor("approaching")).toBe(STATUS_COLORS.warning);
    expect(statusColor("compliant")).toBe(STATUS_COLORS.success);
    expect(statusColor("no_actual_data")).toBe(STATUS_COLORS.neutral);
    expect(statusColor("no_data")).toBe(STATUS_COLORS.neutral);
    expect(STATUS_ORDER).toEqual(["over", "approaching", "no_actual_data", "compliant"]);
  });

  it("formats pct, no license and missing", () => {
    expect(formatPct(120, false, t)).toBe("120 %");
    expect(formatPct(83.3, false, t)).toBe("83.3 %");
    expect(formatPct(null, true, t)).toBe("cards:licensing.noLicense");
    expect(formatPct(null, false, t)).toBe("—");
  });

  it("knows the license-bearing card types", () => {
    expect(isLicenseType("Application")).toBe(true);
    expect(isLicenseType("ITComponent")).toBe(true);
    expect(isLicenseType("Platform")).toBe(false);
  });
});

const typeItem = (over: Partial<LicenseTypeItem> = {}): LicenseTypeItem => ({
  id: "t1",
  metric_key: "users",
  key: "admin",
  label: "Admin",
  sort_order: 0,
  archived: false,
  translations: {},
  ...over,
});
const metricItem = (over: Partial<LicenseMetricItem> = {}): LicenseMetricItem => ({
  id: "m1",
  key: "users",
  label: "Users",
  sort_order: 0,
  archived: false,
  translations: {},
  types: [],
  ...over,
});

describe("license pairs", () => {
  it("keys a pair as metric:type", () => {
    expect(pairKey("users", "admin")).toBe("users:admin");
  });

  it("labels a pair Metric: Type", () => {
    expect(pairLabel(metricItem(), typeItem(), "en")).toBe("Users: Admin");
  });

  it("uses each entity's own translation, falling back to its label and never to the key", () => {
    const m = metricItem({ translations: { de: "Benutzer" } });
    const ty = typeItem({ label: "Admin", translations: { de: "Administrator" } });
    expect(pairLabel(m, ty, "de")).toBe("Benutzer: Administrator");
    expect(pairLabel(m, ty, "fr")).toBe("Users: Admin");
  });
});

describe("addableCatalogue", () => {
  const ty = (key: string, archived = false) => typeItem({ key, archived });
  const catalogue = [
    metricItem({ key: "users", types: [ty("prod"), ty("dev"), ty("old", true)] }),
    metricItem({ key: "installations", types: [ty("prod")] }),
    metricItem({ key: "cores", archived: true, types: [ty("x")] }),
    metricItem({ key: "empty", types: [ty("gone", true)] }),
  ];

  it("keeps the active metrics with their active types, the pairs of the year left out", () => {
    const out = addableCatalogue(catalogue, new Set(["users:prod"]));
    expect(out.map((m) => [m.key, m.types.map((x) => x.key)])).toEqual([
      ["users", ["dev"]],
      ["installations", ["prod"]],
    ]);
  });

  it("drops a metric whose every type is archived or already in the year", () => {
    const out = addableCatalogue(catalogue, new Set(["users:prod", "users:dev", "installations:prod"]));
    expect(out).toEqual([]);
  });
});
