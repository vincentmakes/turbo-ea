import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { fieldLabel, typeLabel } from "@/hooks/useResolveLabel";
import { APPLICATION_TYPE, BUSINESS_CAPABILITY_TYPE, CARD_TYPES, CRITICALITY_OPTIONS } from "@/test/fixtures/metamodel";
import {
  APPROVAL_STATUS_COLORS,
  BOOLEAN_COLORS,
  CHART_CATEGORICAL,
  DATA_QUALITY_COLORS,
  STATUS_COLORS,
} from "@/theme/tokens";
import { OTHER_KEY } from "./buildOption";
import { dimensionResolver, type ResolverDeps } from "./dimensions";

const deps: ResolverDeps = {
  types: CARD_TYPES,
  t: i18n.t.bind(i18n),
  locale: "en",
  typeLabel: (ct) => typeLabel(ct, "en"),
  inlineLabel: (e) => fieldLabel(e, "en"),
  categorical: CHART_CATEGORICAL.light,
};
const tc = (k: string) => i18n.t(`common:${k}`);

describe("dimensionResolver", () => {
  it("names card types by their label and colours them by the type", () => {
    const r = dimensionResolver("type", {}, deps);
    expect(r.colorByCategory).toBe(true);
    expect(r.label("Application")).toBe(APPLICATION_TYPE.label);
    expect(r.color("Application", 5)).toBe(APPLICATION_TYPE.color);
    expect(r.label("BusinessCapability")).toBe(BUSINESS_CAPABILITY_TYPE.label);
    // An unknown key has no entity to name it.
    expect(r.label("Gone")).toBe("Gone");
    expect(r.color("Gone", 1)).toBe(CHART_CATEGORICAL.light[1]);
  });

  it("names a sankey subtype node under the type dimension", () => {
    expect(dimensionResolver("type", {}, deps).label("microservice")).toBe("Microservice");
  });

  it("names subtypes and gives them categorical hues by definition order", () => {
    const r = dimensionResolver("subtype", { card_type: "Application" }, deps);
    expect(r.colorByCategory).toBe(false);
    expect(r.label("microservice")).toBe("Microservice");
    expect(r.color("businessApplication", 9)).toBe(CHART_CATEGORICAL.light[0]);
    expect(r.color("microservice", 0)).toBe(CHART_CATEGORICAL.light[1]);
    expect(r.label("none")).toBe(tc("labels.notSet"));
    expect(r.color("none", 0)).toBe(STATUS_COLORS.neutral);
    expect(r.label("ghost")).toBe("ghost");
    expect(r.color("ghost", 0)).toBe(STATUS_COLORS.neutral);
  });

  it("uses the status labels and tokens for approval status", () => {
    const r = dimensionResolver("approval_status", {}, deps);
    expect(r.label("APPROVED")).toBe(tc("status.approved"));
    expect(r.color("BROKEN", 0)).toBe(APPROVAL_STATUS_COLORS.BROKEN);
    expect(r.color("ODD", 0)).toBe(STATUS_COLORS.neutral);
    expect(r.label("ODD")).toBe("ODD");
  });

  it("uses the lifecycle labels and the homepage's phase colours", () => {
    const r = dimensionResolver("lifecycle_phase", {}, deps);
    expect(r.label("phaseIn")).toBe(tc("lifecycle.phaseIn"));
    expect(r.label("none")).toBe(tc("lifecycle.notSet"));
    expect(r.color("plan", 0)).toBe(STATUS_COLORS.neutral);
    expect(r.color("phaseIn", 0)).toBe(STATUS_COLORS.info);
    expect(r.color("active", 0)).toBe(STATUS_COLORS.success);
    expect(r.color("phaseOut", 0)).toBe(STATUS_COLORS.warning);
    expect(r.color("endOfLife", 0)).toBe(STATUS_COLORS.error);
    expect(r.color("none", 0)).toBe(STATUS_COLORS.neutral);
  });

  it("labels completion buckets as ranges in the data-quality colours", () => {
    const r = dimensionResolver("data_quality_bucket", {}, deps);
    expect(r.label("0-25")).toBe("0 - 25%");
    expect(r.label("75-100")).toBe("75 - 100%");
    expect(r.color("25-50", 0)).toBe(DATA_QUALITY_COLORS["25-50"]);
    expect(r.label("x")).toBe("x");
  });

  it("names months and days in the locale, in one hue", () => {
    const m = dimensionResolver("created_month", {}, deps);
    expect(m.colorByCategory).toBe(false);
    expect(m.label("2026-03")).toBe("Mar 2026");
    expect(m.label("bad")).toBe("bad");
    expect(m.color("2026-03", 4)).toBe(CHART_CATEGORICAL.light[0]);
    const d = dimensionResolver("date", {}, deps);
    expect(d.label("2026-10-28")).toBe("Oct 28");
    expect(d.label("x")).toBe("x");
  });

  it("names select options by label and keeps their own colours", () => {
    const r = dimensionResolver("field:businessCriticality", { card_type: "Application" }, deps);
    expect(r.colorByCategory).toBe(true);
    expect(r.label("missionCritical")).toBe("Mission Critical");
    expect(r.color("businessCritical", 0)).toBe(CRITICALITY_OPTIONS[1].color);
    expect(r.label("")).toBe(tc("labels.notSet"));
    expect(r.color("", 0)).toBe(STATUS_COLORS.neutral);
    expect(r.color("unknown", 0)).toBe(STATUS_COLORS.neutral);
    expect(r.label("unknown")).toBe("unknown");
  });

  it("gives uncoloured options categorical hues by option order", () => {
    const r = dimensionResolver("field:regions", { card_type: "Application" }, deps);
    expect(r.colorByCategory).toBe(false);
    expect(r.color("amer", 0)).toBe(CHART_CATEGORICAL.light[1]);
  });

  it("answers yes / no for a boolean field in the boolean colours", () => {
    const r = dimensionResolver("field:isCloud", {}, deps);
    expect(r.label("true")).toBe(tc("labels.yes"));
    expect(r.label("false")).toBe(tc("labels.no"));
    expect(r.label("")).toBe(tc("labels.notSet"));
    expect(r.color("true", 0)).toBe(BOOLEAN_COLORS.true);
    expect(r.color("false", 0)).toBe(BOOLEAN_COLORS.false);
    expect(r.color("", 0)).toBe(STATUS_COLORS.neutral);
  });

  it("falls back to the key and fixed-order hues, neutral past the palette", () => {
    const r = dimensionResolver("field:nope", { card_type: "Application" }, deps);
    expect(r.label("k")).toBe("k");
    expect(r.label("")).toBe(tc("labels.notSet"));
    expect(r.color("k", 2)).toBe(CHART_CATEGORICAL.light[2]);
    expect(r.color("k", 8)).toBe(STATUS_COLORS.neutral);
    expect(dimensionResolver(null, null, deps).label("x")).toBe("x");
  });

  it("names and greys the folded Other row on every dimension", () => {
    for (const dim of ["type", "subtype", "approval_status", "field:businessCriticality", null]) {
      const r = dimensionResolver(dim, { card_type: "Application" }, deps);
      expect(r.label(OTHER_KEY)).toBe(tc("dashboard.query.other"));
      expect(r.color(OTHER_KEY, 0)).toBe(STATUS_COLORS.neutral);
    }
  });
});
