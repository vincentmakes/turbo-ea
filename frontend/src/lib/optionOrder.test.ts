import { describe, expect, it } from "vitest";
import { orderByOptions } from "./optionOrder";

const OPTIONS = [{ key: "low" }, { key: "mid" }, { key: "high" }];

describe("orderByOptions", () => {
  it("sorts stored values by their option's index", () => {
    expect(orderByOptions(["high", "low", "mid"], OPTIONS)).toEqual(["low", "mid", "high"]);
  });

  it("puts unknown values after the known ones, keeping their relative order", () => {
    expect(orderByOptions(["zeta", "high", "alpha", "low"], OPTIONS)).toEqual([
      "low",
      "high",
      "zeta",
      "alpha",
    ]);
  });

  it("keeps duplicates in their original relative order", () => {
    expect(orderByOptions(["mid", "low", "mid"], OPTIONS)).toEqual(["low", "mid", "mid"]);
  });

  it("follows the options as reordered, not as first declared", () => {
    const reordered = [{ key: "high" }, { key: "low" }, { key: "mid" }];
    expect(orderByOptions(["low", "mid", "high"], reordered)).toEqual(["high", "low", "mid"]);
  });

  it("uses the first index when an option key is declared twice", () => {
    const dup = [{ key: "b" }, { key: "a" }, { key: "b" }];
    expect(orderByOptions(["a", "b"], dup)).toEqual(["b", "a"]);
  });

  it("returns a copy and never mutates the input", () => {
    const values = ["high", "low"];
    const out = orderByOptions(values, OPTIONS);
    expect(values).toEqual(["high", "low"]);
    expect(out).not.toBe(values);
    const single = ["low"];
    expect(orderByOptions(single, OPTIONS)).not.toBe(single);
    const none = ["high", "low"];
    expect(orderByOptions(none, undefined)).not.toBe(none);
  });

  it("leaves the order alone when there are no options", () => {
    expect(orderByOptions(["b", "a"], undefined)).toEqual(["b", "a"]);
    expect(orderByOptions(["b", "a"], [])).toEqual(["b", "a"]);
  });

  it("matches non-string values by their string form", () => {
    expect(orderByOptions([3, 1], [{ key: "1" }, { key: "3" }])).toEqual([1, 3]);
  });
});
