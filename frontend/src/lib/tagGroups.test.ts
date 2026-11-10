import { describe, expect, it } from "vitest";
import { tagGroupApplies } from "./tagGroups";

describe("tagGroupApplies", () => {
  it("applies to every type without a restriction", () => {
    expect(tagGroupApplies({ restrict_to_types: null }, "Application")).toBe(true);
    expect(tagGroupApplies({ restrict_to_types: undefined }, "Application")).toBe(true);
  });

  it("applies to every type with an empty restriction", () => {
    expect(tagGroupApplies({ restrict_to_types: [] }, "Application")).toBe(true);
  });

  it("applies to a type the restriction names", () => {
    expect(tagGroupApplies({ restrict_to_types: ["ITComponent", "Application"] }, "Application")).toBe(
      true,
    );
  });

  it("does not apply to a type the restriction leaves out", () => {
    expect(tagGroupApplies({ restrict_to_types: ["ITComponent"] }, "Application")).toBe(false);
  });
});
