import { describe, it, expect } from "vitest";
import { relationCreatePayload } from "./relationSync";

const drawn = {
  relationType: "relAppToInterface",
  sourceCardId: "iface",
  targetCardId: "app",
  reversed: false,
};

describe("relationCreatePayload", () => {
  it("sends the drawn ends when the type was picked as drawn", () => {
    expect(relationCreatePayload(drawn)).toEqual({
      type: "relAppToInterface",
      source_id: "iface",
      target_id: "app",
    });
  });

  it("swaps the ends for a relation picked in its reverse direction", () => {
    expect(relationCreatePayload({ ...drawn, reversed: true })).toMatchObject({
      source_id: "app",
      target_id: "iface",
    });
  });

  it("carries the attributes chosen in the picker (#1140)", () => {
    expect(
      relationCreatePayload({ ...drawn, reversed: true }, { flowDirection: "forward" }),
    ).toEqual({
      type: "relAppToInterface",
      source_id: "app",
      target_id: "iface",
      attributes: { flowDirection: "forward" },
    });
  });

  it("omits an empty attributes object", () => {
    expect(relationCreatePayload(drawn, {})).not.toHaveProperty("attributes");
  });
});
