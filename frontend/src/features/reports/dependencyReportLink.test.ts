import { describe, it, expect } from "vitest";
import { buildDependencyReportUrl } from "./dependencyReportLink";

describe("buildDependencyReportUrl", () => {
  it("centres the report on the card, in the layered view by default", () => {
    expect(buildDependencyReportUrl({ centerId: "abc-123" })).toBe(
      "/reports/dependencies?center=abc-123&mode=c4",
    );
  });

  it("carries an explicit chart mode", () => {
    expect(buildDependencyReportUrl({ centerId: "abc-123", mode: "tree" })).toBe(
      "/reports/dependencies?center=abc-123&mode=tree",
    );
  });

  it("encodes the id rather than pasting it into the query", () => {
    // Card ids are UUIDs today, but a builder that concatenates is one schema
    // change away from a broken link.
    const url = buildDependencyReportUrl({ centerId: "a b&c=d" });
    expect(url).toContain("center=a+b%26c%3Dd");
    expect(new URLSearchParams(url.split("?")[1]).get("center")).toBe("a b&c=d");
  });
});
