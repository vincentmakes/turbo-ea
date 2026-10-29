import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { fieldLabel, typeLabel } from "@/hooks/useResolveLabel";
import {
  APPLICATION_TYPE,
  BUSINESS_CAPABILITY_TYPE,
  CARD_TYPES,
  CRITICALITY_OPTIONS,
  IT_COMPONENT_TYPE,
  REL_APP_TO_ITC,
  makeCardType,
  makeField,
  makeOption,
  makeSection,
} from "@/test/fixtures/metamodel";
import {
  APPROVAL_STATUS_COLORS,
  BOOLEAN_COLORS,
  CHART_CATEGORICAL,
  DATA_QUALITY_COLORS,
  EOL_COVERAGE_COLORS,
  STATUS_COLORS,
} from "@/theme/tokens";
import { OTHER_KEY } from "./buildOption";
import { LIFECYCLE_COLORS, dimensionResolver, sideTypes, type ResolverDeps } from "./dimensions";

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

describe("dimensionResolver — per side and new dimensions", () => {
  // Two types define the same field key with different options: a sankey's
  // target side must never read the source side's.
  const SOURCE = makeCardType({
    key: "Src",
    color: "#111111",
    fields_schema: [
      makeSection({
        fields: [
          makeField({
            key: "status",
            type: "single_select",
            options: [makeOption({ key: "a", label: "Source A", color: "#aaaaaa" })],
          }),
        ],
      }),
    ],
  });
  const TARGET = makeCardType({
    key: "Tgt",
    color: "#222222",
    fields_schema: [
      makeSection({
        fields: [
          makeField({
            key: "status",
            type: "single_select",
            options: [makeOption({ key: "b", label: "Other" }), makeOption({ key: "a", label: "Target A" })],
          }),
        ],
      }),
    ],
  });
  const sideDeps: ResolverDeps = { ...deps, types: [SOURCE, TARGET] };

  it("looks a field up in the side's own type", () => {
    const source = dimensionResolver("field:status", {}, sideDeps, "Src");
    const target = dimensionResolver("field:status", {}, sideDeps, "Tgt");
    expect(source.label("a")).toBe("Source A");
    expect(target.label("a")).toBe("Target A");
    expect(source.color("a", 0)).toBe("#aaaaaa");
    // The target's option has no colour: its slot by option order.
    expect(target.color("a", 0)).toBe(CHART_CATEGORICAL.light[1]);
    // The explicit side wins over the query's card type.
    expect(dimensionResolver("field:status", { card_type: "Src" }, sideDeps, "Tgt").label("a")).toBe("Target A");
  });

  it("names card-keyed rows from the response's labels, coloured by the side's type", () => {
    const withLabels: ResolverDeps = { ...deps, cardLabels: { c1: "Postgres", c2: "Oracle" } };
    const cards = dimensionResolver("card", { relation_type: REL_APP_TO_ITC.key }, withLabels, "ITComponent");
    expect(cards.colorByCategory).toBe(true);
    expect(cards.label("c1")).toBe("Postgres");
    expect(cards.color("c2", 4)).toBe(IT_COMPONENT_TYPE.color);
    expect(cards.label("unlisted")).toBe("unlisted");
    expect(cards.label(OTHER_KEY)).toBe(tc("dashboard.query.other"));
    const related = dimensionResolver("related:relAppToITC", { card_type: "Application" }, withLabels);
    expect(related.colorByCategory).toBe(false);
    expect(related.label("c2")).toBe("Oracle");
    expect(related.label("none")).toBe(tc("dashboard.query.noRelated"));
    expect(related.color("none", 0)).toBe(STATUS_COLORS.neutral);
    expect(related.color("c1", 3)).toBe(CHART_CATEGORICAL.light[0]);
  });

  it("names each card of an ordinary query from the labels, in the query's card type colour", () => {
    const withLabels: ResolverDeps = { ...deps, cardLabels: { a1: "CRM", a2: "ERP" } };
    // No relation side: the query's card type scopes it.
    const cards = dimensionResolver("card", { card_type: "Application", group_by: "card" }, withLabels);
    expect(cards.colorByCategory).toBe(true);
    expect(cards.label("a1")).toBe("CRM");
    expect(cards.label("a2")).toBe("ERP");
    expect(cards.label("gone")).toBe("gone");
    expect(cards.color("a1", 0)).toBe(APPLICATION_TYPE.color);
    expect(cards.color("a2", 7)).toBe(APPLICATION_TYPE.color);
    expect(cards.label(OTHER_KEY)).toBe(tc("dashboard.query.other"));
    expect(cards.color(OTHER_KEY, 1)).toBe(STATUS_COLORS.neutral);
    expect(cards.color("none", 1)).toBe(STATUS_COLORS.neutral);
    // A type without a colour of its own (or none at all) paints every card in the first hue.
    const plain: ResolverDeps = { ...withLabels, types: [makeCardType({ key: "Plain", color: "" })] };
    expect(dimensionResolver("card", { card_type: "Plain" }, plain).color("a1", 5)).toBe(CHART_CATEGORICAL.light[0]);
    expect(dimensionResolver("card", {}, withLabels).color("a1", 5)).toBe(CHART_CATEGORICAL.light[0]);
    // Without labels a card reads as its key.
    expect(dimensionResolver("card", { card_type: "Application" }, deps).label("a1")).toBe("a1");
  });

  it("labels EOL coverage from the data-quality report's words, in the coverage colours", () => {
    const r = dimensionResolver("eol_coverage", { card_type: "Application" }, deps);
    expect(r.label("linked")).toBe(i18n.t("reports:dataQuality.eolLinked"));
    expect(r.label("manual")).toBe(i18n.t("reports:dataQuality.eolManual"));
    expect(r.label("missing")).toBe(i18n.t("reports:dataQuality.eolMissing"));
    expect(r.color("linked", 0)).toBe(EOL_COVERAGE_COLORS.linked);
    expect(r.color("missing", 0)).toBe(EOL_COVERAGE_COLORS.missing);
    expect(r.label("odd")).toBe("odd");
    expect(r.color("odd", 0)).toBe(STATUS_COLORS.neutral);
  });

  it("answers with / without stakeholders", () => {
    const r = dimensionResolver("stakeholders", {}, deps);
    expect(r.label("true")).toBe(tc("dashboard.query.stakeholders.with"));
    expect(r.label("false")).toBe(tc("dashboard.query.stakeholders.without"));
    expect(r.label("x")).toBe(tc("labels.notSet"));
    expect(r.color("true", 0)).toBe(STATUS_COLORS.success);
    expect(r.color("false", 0)).toBe(STATUS_COLORS.warning);
    expect(r.color("x", 0)).toBe(STATUS_COLORS.neutral);
  });

  it("names lifecycle months in the locale, in the phase's colour", () => {
    const r = dimensionResolver("phase_month:endOfLife", {}, deps);
    expect(r.colorByCategory).toBe(false);
    expect(r.label("2026-11")).toBe("Nov 2026");
    expect(r.color("2026-11", 3)).toBe(LIFECYCLE_COLORS.endOfLife);
    expect(dimensionResolver("phase_month:odd", {}, deps).color("2026-11", 0)).toBe(CHART_CATEGORICAL.light[0]);
  });

  it("gives a relation type's two ends", () => {
    expect(sideTypes(REL_APP_TO_ITC)).toEqual({ source: "Application", target: "ITComponent" });
    expect(sideTypes(null)).toEqual({ source: null, target: null });
  });

  it("keeps the search over every type when no type is known", () => {
    expect(dimensionResolver("field:businessCriticality", {}, deps).label("missionCritical")).toBe("Mission Critical");
    expect(APPLICATION_TYPE.key).toBe("Application");
  });
});
