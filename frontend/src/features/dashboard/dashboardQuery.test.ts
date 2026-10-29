import { describe, expect, it } from "vitest";
import {
  drillUrl,
  fieldOfDimension,
  flagList,
  isCardKeyed,
  metricKey,
  normalizeFlags,
  phaseOfDimension,
  relationOfDimension,
  toQueryString,
  withQuery,
} from "./dashboardQuery";

describe("toQueryString", () => {
  it("is byte-identical to the backend's metric_key", () => {
    // Pinned on both sides: the backend keys KPI snapshots on this string.
    expect(toQueryString({ group_by: "approval_status", card_type: "Application" })).toBe(
      "card_type=Application&group_by=approval_status",
    );
    expect(metricKey({ card_type: "Application", group_by: "approval_status" })).toBe(
      "card_type=Application&group_by=approval_status",
    );
  });

  it("sorts entries by key whatever order they were written in", () => {
    expect(toQueryString({ subtype: "a", approval_status: "DRAFT", card_type: "X" })).toBe(
      "approval_status=DRAFT&card_type=X&subtype=a",
    );
  });

  it("drops empty values and the default count metric", () => {
    expect(
      toQueryString({ card_type: "", group_by: null, subtype: undefined, metric: "count", lifecycle_phase: "active" }),
    ).toBe("lifecycle_phase=active");
    expect(toQueryString({ metric: "sum", metric_field: "costTotalAnnual" })).toBe(
      "metric=sum&metric_field=costTotalAnnual",
    );
  });

  it("encodes like URLSearchParams and handles a missing query", () => {
    expect(toQueryString({ group_by: "field:business criticality" })).toBe("group_by=field%3Abusiness+criticality");
    expect(toQueryString(null)).toBe("");
    expect(toQueryString(undefined)).toBe("");
    expect(toQueryString({})).toBe("");
  });
});

describe("flags", () => {
  it("are canonical in the query string, pinned byte for byte with the backend", () => {
    expect(toQueryString({ card_type: "Application", flags: "stale,orphaned" })).toBe(
      "card_type=Application&flags=orphaned%2Cstale",
    );
    expect(metricKey({ flags: " stale ,orphaned,stale", card_type: "Application" })).toBe(
      "card_type=Application&flags=orphaned%2Cstale",
    );
    expect(toQueryString({ card_type: "Application", flags: " , " })).toBe("card_type=Application");
  });

  it("pins the new query fields byte for byte with the backend's metric_key", () => {
    expect(
      metricKey({
        card_type: "Application",
        group_by: "related:relAppToITC",
        flags: "related:relAppToITC__out,eol_missing",
      }),
    ).toBe("card_type=Application&flags=eol_missing%2Crelated%3ArelAppToITC__out&group_by=related%3ArelAppToITC");
    expect(metricKey({ card_type: "Application", metric: "sum", metric_field: "@relations:relAppToITC" })).toBe(
      "card_type=Application&metric=sum&metric_field=%40relations%3ArelAppToITC",
    );
    expect(metricKey({ card_type: "Application", metric: "share", approval_status: "APPROVED" })).toBe(
      "approval_status=APPROVED&card_type=Application&metric=share",
    );
    expect(toQueryString({ flags: null })).toBe("");
  });

  it("normalise from a list or a string: split, trim, dedupe, sort", () => {
    expect(normalizeFlags(["stale", " orphaned ", "stale", ""])).toBe("orphaned,stale");
    expect(normalizeFlags("unrelated:r,related:r,eol_missing")).toBe("eol_missing,related:r,unrelated:r");
    expect(normalizeFlags(["b,a", "c"])).toBe("a,b,c");
    expect(normalizeFlags(null)).toBe("");
    expect(normalizeFlags(undefined)).toBe("");
    expect(flagList("stale,orphaned")).toEqual(["orphaned", "stale"]);
    expect(flagList("")).toEqual([]);
  });
});

describe("dimension helpers", () => {
  it("read related, phase-month and card-keyed dimensions", () => {
    expect(relationOfDimension("related:relAppToApp__in")).toBe("relAppToApp__in");
    expect(relationOfDimension("related:")).toBeNull();
    expect(relationOfDimension("type")).toBeNull();
    expect(phaseOfDimension("phase_month:endOfLife")).toBe("endOfLife");
    expect(phaseOfDimension("phase_month:")).toBeNull();
    expect(phaseOfDimension(null)).toBeNull();
    expect(isCardKeyed("card")).toBe(true);
    expect(isCardKeyed("related:r")).toBe(true);
    expect(isCardKeyed("type")).toBe(false);
    expect(isCardKeyed(undefined)).toBe(false);
  });
});

describe("withQuery", () => {
  it("appends the query string and extra params", () => {
    expect(withQuery("/dashboards/query", { group_by: "type" })).toBe("/dashboards/query?group_by=type");
    expect(withQuery("/dashboards/kpi-history", { card_type: "A" }, "days=90")).toBe(
      "/dashboards/kpi-history?card_type=A&days=90",
    );
  });

  it("returns the bare path when there is nothing to append", () => {
    expect(withQuery("/dashboards/kpi", {})).toBe("/dashboards/kpi");
    expect(withQuery("/dashboards/kpi-history", {}, "days=90")).toBe("/dashboards/kpi-history?days=90");
  });
});

describe("fieldOfDimension", () => {
  it("reads the field key of a field dimension only", () => {
    expect(fieldOfDimension("field:businessCriticality")).toBe("businessCriticality");
    expect(fieldOfDimension("field:")).toBeNull();
    expect(fieldOfDimension("type")).toBeNull();
    expect(fieldOfDimension(null)).toBeNull();
    expect(fieldOfDimension(undefined)).toBeNull();
  });
});

describe("drillUrl", () => {
  it("reproduces the homepage's four click-throughs", () => {
    expect(drillUrl("type", "Application", {})).toBe("/inventory?type=Application");
    expect(drillUrl("approval_status", "BROKEN", {})).toBe("/inventory?approval_status=BROKEN");
    expect(drillUrl("lifecycle_phase", "active", {})).toBe("/reports/lifecycle");
    expect(drillUrl("data_quality_bucket", "0-25", {})).toBe("/reports/data-quality");
  });

  it("drills a field value into the inventory's attribute filter of its type", () => {
    expect(drillUrl("field:businessCriticality", "missionCritical", { card_type: "Application" })).toBe(
      "/inventory?type=Application&attr_businessCriticality=missionCritical",
    );
    expect(drillUrl("field:businessCriticality", "missionCritical", {})).toBeNull();
  });

  it("drills a subtype only inside one type", () => {
    expect(drillUrl("subtype", "microservice", { card_type: "Application" })).toBe(
      "/inventory?type=Application&subtype=microservice",
    );
    expect(drillUrl("subtype", "microservice", null)).toBeNull();
  });

  it("drills a card-keyed mark into that card, never the none or folded rows", () => {
    expect(drillUrl("card", "c-1", {})).toBe("/cards/c-1");
    expect(drillUrl("related:relAppToITC", "c-2", { card_type: "Application" })).toBe("/cards/c-2");
    expect(drillUrl("related:relAppToITC", "none", {})).toBeNull();
    expect(drillUrl("card", "__other__", {})).toBeNull();
  });

  it("drills EOL coverage, stakeholders and lifecycle months into their reports", () => {
    expect(drillUrl("eol_coverage", "missing", { card_type: "Application" })).toBe("/reports/data-quality");
    expect(drillUrl("stakeholders", "false", { card_type: "Application" })).toBe("/inventory?type=Application");
    expect(drillUrl("stakeholders", "true", {})).toBe("/inventory");
    expect(drillUrl("phase_month:endOfLife", "2026-11", {})).toBe("/reports/lifecycle");
  });

  it("encodes keys", () => {
    expect(drillUrl("type", "A&B", {})).toBe("/inventory?type=A%26B");
  });

  it("has no destination for other dimensions or an empty key", () => {
    expect(drillUrl("created_month", "2026-01", {})).toBeNull();
    expect(drillUrl(null, "x", {})).toBeNull();
    expect(drillUrl("type", "", {})).toBeNull();
    expect(drillUrl("type", null, {})).toBeNull();
    expect(drillUrl("type", undefined, {})).toBeNull();
  });
});
