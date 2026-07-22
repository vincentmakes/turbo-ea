import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/*
 * Regression guard for issue #857.
 *
 * BPM surfaces (Process Navigator, Process Map report, BPM dashboard) must
 * present the BusinessProcess `processType` options with the labels,
 * translations, and colors configured in the metamodel — never a hardcoded
 * copy. This hook is the single resolution point they all share.
 */

let mockType: unknown;
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    loading: false,
    getType: (key: string) => (key === "BusinessProcess" ? mockType : undefined),
  }),
}));

import {
  useProcessTypeOptions,
  PROCESS_TYPE_NEUTRAL_COLOR,
} from "./useProcessTypeOptions";

function typeWithOptions(options: unknown[]) {
  return {
    key: "BusinessProcess",
    fields_schema: [
      {
        section: "Process Classification",
        fields: [
          { key: "processType", label: "Process Type", type: "single_select", options },
        ],
      },
    ],
  };
}

beforeEach(() => {
  mockType = undefined;
});

describe("useProcessTypeOptions", () => {
  it("returns the metamodel options in declared order with custom labels and colors", () => {
    mockType = typeWithOptions([
      { key: "core", label: "Core", color: "#1976d2" },
      { key: "support", label: "Support", color: "#607d8b" },
      { key: "management", label: "Strategic", color: "#00aa55" },
    ]);
    const { result } = renderHook(() => useProcessTypeOptions());
    expect(result.current.options).toEqual([
      { key: "core", label: "Core", color: "#1976d2" },
      { key: "support", label: "Support", color: "#607d8b" },
      { key: "management", label: "Strategic", color: "#00aa55" },
    ]);
    expect(result.current.resolve("management")).toEqual({
      key: "management",
      label: "Strategic",
      color: "#00aa55",
    });
  });

  it("resolves option labels through the inline translations map", () => {
    mockType = typeWithOptions([
      { key: "core", label: "Core", color: "#1976d2", translations: { en: "Primary" } },
    ]);
    const { result } = renderHook(() => useProcessTypeOptions());
    expect(result.current.resolve("core").label).toBe("Primary");
  });

  it("excludes hidden options from rows/legend but still resolves stored values", () => {
    mockType = typeWithOptions([
      { key: "core", label: "Core", color: "#1976d2" },
      { key: "legacy", label: "Legacy", color: "#333333", hidden: true },
    ]);
    const { result } = renderHook(() => useProcessTypeOptions());
    expect(result.current.options.map((o) => o.key)).toEqual(["core"]);
    expect(result.current.resolve("legacy")).toEqual({
      key: "legacy",
      label: "Legacy",
      color: "#333333",
    });
  });

  it('uses "core" as the default bucket when present, else the first option', () => {
    mockType = typeWithOptions([
      { key: "management", label: "Management", color: "#9c27b0" },
      { key: "core", label: "Core", color: "#1976d2" },
    ]);
    expect(renderHook(() => useProcessTypeOptions()).result.current.defaultKey).toBe("core");

    mockType = typeWithOptions([
      { key: "alpha", label: "Alpha", color: "#111111" },
      { key: "beta", label: "Beta", color: "#222222" },
    ]);
    expect(renderHook(() => useProcessTypeOptions()).result.current.defaultKey).toBe("alpha");
  });

  it("degrades unknown stored values to the raw key with a neutral color", () => {
    mockType = typeWithOptions([{ key: "core", label: "Core", color: "#1976d2" }]);
    const { result } = renderHook(() => useProcessTypeOptions());
    expect(result.current.resolve("deleted-option")).toEqual({
      key: "deleted-option",
      label: "deleted-option",
      color: PROCESS_TYPE_NEUTRAL_COLOR,
    });
  });

  it("falls back to the seeded defaults when the processType field is missing", () => {
    mockType = { key: "BusinessProcess", fields_schema: [] };
    const { result } = renderHook(() => useProcessTypeOptions());
    expect(result.current.options.map((o) => o.key)).toEqual(["core", "support", "management"]);
    expect(result.current.defaultKey).toBe("core");
  });

  it("substitutes a neutral color for options saved without one", () => {
    mockType = typeWithOptions([{ key: "core", label: "Core" }]);
    const { result } = renderHook(() => useProcessTypeOptions());
    expect(result.current.resolve("core").color).toBe(PROCESS_TYPE_NEUTRAL_COLOR);
  });
});
