/**
 * Colours come from the metamodel, the seeded set is only the fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { LINK_TYPE_COLORS } from "./linkDots";
import { useLinkTypeColors } from "./useLinkTypeColors";

const mockTypes: { key: string; color?: string }[] = [];

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    loading: false,
    types: mockTypes,
    relationTypes: [],
    getType: (key: string) => mockTypes.find((t) => t.key === key),
  }),
}));

beforeEach(() => {
  mockTypes.length = 0;
});

describe("useLinkTypeColors", () => {
  it("returns the seeded set when the metamodel has not loaded", () => {
    const { result } = renderHook(() => useLinkTypeColors());
    expect(result.current).toEqual(LINK_TYPE_COLORS);
  });

  it("prefers the metamodel's colour for a type the admin recoloured", () => {
    mockTypes.push({ key: "Application", color: "#abcdef" }, { key: "BusinessProcess" });
    const { result } = renderHook(() => useLinkTypeColors());
    expect(result.current.application).toBe("#abcdef");
    // A type with no colour, and a type that is absent, keep the fallback.
    expect(result.current.process).toBe(LINK_TYPE_COLORS.process);
    expect(result.current.organization).toBe(LINK_TYPE_COLORS.organization);
  });

  it("keeps the same object across renders, so an effect keyed on it does not re-run", () => {
    mockTypes.push({ key: "Application", color: "#abcdef" });
    const { result, rerender } = renderHook(() => useLinkTypeColors());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
