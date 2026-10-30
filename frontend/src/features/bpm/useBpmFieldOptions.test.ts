import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/*
 * The BPM dashboard's maturity and automation-level charts must show each
 * option's metamodel label (translated, admin-customisable) — never the raw
 * stored key the dashboard API groups by.
 */

let mockType: unknown;
let mockLoading = false;
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    loading: mockLoading,
    getType: (key: string) => (key === "BusinessProcess" ? mockType : undefined),
  }),
}));

import { bpmFieldOptionsFrom, useBpmFieldOptions } from "./useBpmFieldOptions";
import type { SectionDef } from "@/types";

const SCHEMA = [
  {
    section: "Classification",
    fields: [
      {
        key: "maturity",
        label: "Maturity",
        type: "single_select",
        options: [
          { key: "initial", label: "Initial", color: "#d32f2f" },
          { key: "defined", label: "Defined", translations: { de: "Definiert" } },
        ],
      },
    ],
  },
  {
    section: "Operations",
    fields: [
      {
        key: "automationLevel",
        label: "Automation Level",
        type: "single_select",
        options: [{ key: "fullyAutomated", label: "Fully automated", color: "#4caf50" }],
      },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
] as unknown as SectionDef[];

beforeEach(() => {
  mockType = undefined;
  mockLoading = false;
});

describe("bpmFieldOptionsFrom", () => {
  const optLabel = (o: { label: string }) => `«${o.label}»`;

  it("resolves an option's label through the label resolver, with its colour", () => {
    const { resolve } = bpmFieldOptionsFrom(SCHEMA, "maturity", optLabel, false);
    expect(resolve("initial")).toEqual({ key: "initial", label: "«Initial»", color: "#d32f2f" });
  });

  it("leaves the colour out when the option defines none", () => {
    const { resolve } = bpmFieldOptionsFrom(SCHEMA, "maturity", optLabel, false);
    expect(resolve("defined")).toEqual({ key: "defined", label: "«Defined»" });
    expect("color" in resolve("defined")).toBe(false);
  });

  it("finds the field in any section", () => {
    const { resolve } = bpmFieldOptionsFrom(SCHEMA, "automationLevel", optLabel, false);
    expect(resolve("fullyAutomated")).toEqual({
      key: "fullyAutomated",
      label: "«Fully automated»",
      color: "#4caf50",
    });
  });

  it("only reads the field it was asked for", () => {
    const { resolve } = bpmFieldOptionsFrom(SCHEMA, "automationLevel", optLabel, false);
    expect(resolve("initial")).toEqual({ key: "initial", label: "initial" });
  });

  it("degrades an unknown key to the raw key, uncoloured", () => {
    const { resolve } = bpmFieldOptionsFrom(SCHEMA, "maturity", optLabel, false);
    expect(resolve("gone")).toEqual({ key: "gone", label: "gone" });
  });

  it("degrades every key when the schema, the field or its options are missing", () => {
    expect(bpmFieldOptionsFrom(undefined, "maturity", optLabel, false).resolve("initial")).toEqual({
      key: "initial",
      label: "initial",
    });
    expect(bpmFieldOptionsFrom(SCHEMA, "missing", optLabel, false).resolve("initial").label).toBe("initial");
    expect(bpmFieldOptionsFrom(SCHEMA, "notes", optLabel, false).resolve("x").label).toBe("x");
    const noFields = [{ section: "Empty" }] as unknown as SectionDef[];
    expect(bpmFieldOptionsFrom(noFields, "maturity", optLabel, false).resolve("initial").label).toBe("initial");
  });

  it("passes the loading flag through", () => {
    expect(bpmFieldOptionsFrom(SCHEMA, "maturity", optLabel, true).loading).toBe(true);
    expect(bpmFieldOptionsFrom(SCHEMA, "maturity", optLabel, false).loading).toBe(false);
  });
});

describe("useBpmFieldOptions", () => {
  it("resolves the BusinessProcess field's options from the metamodel", () => {
    mockType = { key: "BusinessProcess", fields_schema: SCHEMA };
    const { result } = renderHook(() => useBpmFieldOptions("maturity"));
    expect(result.current.resolve("initial")).toEqual({ key: "initial", label: "Initial", color: "#d32f2f" });
    expect(result.current.loading).toBe(false);
  });

  it("degrades to raw keys while the metamodel is loading", () => {
    mockLoading = true;
    const { result } = renderHook(() => useBpmFieldOptions("maturity"));
    expect(result.current.resolve("initial")).toEqual({ key: "initial", label: "initial" });
    expect(result.current.loading).toBe(true);
  });

  it("keeps the same result across renders while nothing changes", () => {
    mockType = { key: "BusinessProcess", fields_schema: SCHEMA };
    const { result, rerender } = renderHook(({ field }) => useBpmFieldOptions(field), {
      initialProps: { field: "maturity" },
    });
    const first = result.current;
    rerender({ field: "maturity" });
    expect(result.current).toBe(first);
    rerender({ field: "automationLevel" });
    expect(result.current).not.toBe(first);
    expect(result.current.resolve("fullyAutomated").label).toBe("Fully automated");
  });
});
