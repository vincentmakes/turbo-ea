import { describe, expect, it } from "vitest";
import { ARTEFACT_KINDS, deliveryAccess } from "./deliveryAccess";

describe("deliveryAccess", () => {
  it("gives the wildcard role every kind, in display order", () => {
    expect(deliveryAccess({ "*": true })).toEqual({
      viewable: ["soaw", "diagram", "adr"],
      creatable: ["soaw", "diagram", "adr"],
    });
    expect(ARTEFACT_KINDS).toEqual(["soaw", "diagram", "adr"]);
  });

  it("gives a role with no permissions, or no role at all, nothing", () => {
    expect(deliveryAccess({})).toEqual({ viewable: [], creatable: [] });
    expect(deliveryAccess(undefined)).toEqual({ viewable: [], creatable: [] });
  });

  it.each([
    ["soaw.view", "soaw"],
    ["diagrams.view", "diagram"],
    ["adr.view", "adr"],
  ] as const)("lets %s view the %s kind alone, and create nothing", (permission, kind) => {
    expect(deliveryAccess({ [permission]: true })).toEqual({ viewable: [kind], creatable: [] });
  });

  it.each([
    ["soaw.view", "soaw.manage", "soaw"],
    ["diagrams.view", "diagrams.manage", "diagram"],
    ["adr.view", "adr.manage", "adr"],
  ] as const)("lets %s + %s create the %s kind", (view, manage, kind) => {
    expect(deliveryAccess({ [view]: true, [manage]: true })).toEqual({
      viewable: [kind],
      creatable: [kind],
    });
  });

  it("reads the issue #1400 role as a decision reader who can create nothing", () => {
    expect(deliveryAccess({ "adr.view": true, "adr.comment": true })).toEqual({
      viewable: ["adr"],
      creatable: [],
    });
  });

  it("does not offer to create a kind the role could not open afterwards", () => {
    expect(deliveryAccess({ "soaw.manage": true, "adr.view": true })).toEqual({
      viewable: ["adr"],
      creatable: [],
    });
  });

  it("ignores a permission stored as false", () => {
    expect(deliveryAccess({ "soaw.view": false, "adr.view": true, "adr.manage": false })).toEqual({
      viewable: ["adr"],
      creatable: [],
    });
  });
});
