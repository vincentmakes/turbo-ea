import { describe, it, expect } from "vitest";
import { capabilityIdsAtDate, capabilityLinkInEffect } from "./capabilityLinks";

const ms = (iso: string) => new Date(iso).getTime();

describe("capabilityLinkInEffect", () => {
  const cap = {
    app_link_lifecycles: {
      later: [{ active: "2027-01-01" }],
      over: [{ endOfLife: "2027-01-01" }],
      twice: [{ endOfLife: "2026-01-01" }, { active: "2028-01-01" }],
    },
  };

  it("links an application with no dated entry at every date", () => {
    expect(capabilityLinkInEffect(cap, "undated", ms("1990-01-01"))).toBe(true);
    expect(capabilityLinkInEffect({}, "any", ms("2027-01-01"))).toBe(true);
  });

  it("links from the relation's start day, not before", () => {
    expect(capabilityLinkInEffect(cap, "later", ms("2026-12-31"))).toBe(false);
    expect(capabilityLinkInEffect(cap, "later", ms("2027-01-01"))).toBe(true);
  });

  it("unlinks on the relation's end day", () => {
    expect(capabilityLinkInEffect(cap, "over", ms("2026-12-31"))).toBe(true);
    expect(capabilityLinkInEffect(cap, "over", ms("2027-01-01"))).toBe(false);
  });

  it("links while any of several relations is in effect", () => {
    expect(capabilityLinkInEffect(cap, "twice", ms("2025-06-01"))).toBe(true);
    expect(capabilityLinkInEffect(cap, "twice", ms("2027-01-01"))).toBe(false);
    expect(capabilityLinkInEffect(cap, "twice", ms("2028-01-01"))).toBe(true);
  });
});

describe("capabilityIdsAtDate", () => {
  const capById = new Map([
    ["c1", { app_link_lifecycles: { app: [{ active: "2027-01-01" }] } }],
    ["c2", {}],
  ]);

  it("keeps the capabilities linked at the date, and any it holds no row for", () => {
    expect(capabilityIdsAtDate(["c1", "c2", "c3"], "app", capById, ms("2026-01-01"))).toEqual([
      "c2",
      "c3",
    ]);
    expect(capabilityIdsAtDate(["c1", "c2", "c3"], "app", capById, ms("2027-01-01"))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });
});
