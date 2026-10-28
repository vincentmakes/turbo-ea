import { describe, it, expect } from "vitest";
import { ORIGIN_META, isMarkedOrigin } from "./originMeta";
import { CATEGORICAL_COLORS, STATUS_COLORS } from "@/theme/tokens";

describe("originMeta", () => {
  it("gives each marked origin an icon and a theme-token colour", () => {
    expect(ORIGIN_META).toEqual({
      mcp: { icon: "smart_toy", color: CATEGORICAL_COLORS[1] },
      api: { icon: "api", color: STATUS_COLORS.info },
      ext: { icon: "extension", color: CATEGORICAL_COLORS[3] },
      system: { icon: "settings", color: STATUS_COLORS.neutral },
    });
  });

  it("marks only the non-web origins", () => {
    expect(isMarkedOrigin("mcp")).toBe(true);
    expect(isMarkedOrigin("api")).toBe(true);
    expect(isMarkedOrigin("ext")).toBe(true);
    expect(isMarkedOrigin("system")).toBe(true);
    expect(isMarkedOrigin("web")).toBe(false);
    expect(isMarkedOrigin(null)).toBe(false);
    expect(isMarkedOrigin(undefined)).toBe(false);
    expect(isMarkedOrigin("")).toBe(false);
    // An inherited property name is not an origin.
    expect(isMarkedOrigin("toString")).toBe(false);
  });
});
