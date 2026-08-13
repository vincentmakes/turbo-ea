import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildContainsModel,
  buildExcludeModel,
  buildMatchModel,
  copyText,
  filterKindOf,
} from "./cellContextMenu";

describe("filterKindOf", () => {
  it("maps declared filters to their model kind", () => {
    expect(filterKindOf({ filter: "agDateColumnFilter" }, "meta_created_at")).toBe("date");
    expect(filterKindOf({ filter: "agNumberColumnFilter" }, "event_count")).toBe("number");
    expect(filterKindOf({ filter: "agTextColumnFilter" }, "core_name")).toBe("text");
    expect(filterKindOf({ filter: true }, "core_name")).toBe("text");
  });

  it("treats the Enterprise set filter as text (Community degrades it)", () => {
    expect(filterKindOf({ filter: "agSetColumnFilter" }, "origin")).toBe("text");
  });

  it("returns none for filterless columns", () => {
    expect(filterKindOf({ filter: false }, "actions")).toBe("none");
    expect(filterKindOf({}, "actions")).toBe("none");
  });

  it("returns none for AG Grid's auto-generated columns", () => {
    expect(filterKindOf({ filter: true }, "ag-Grid-ControlsColumn")).toBe("none");
  });
});

describe("buildMatchModel / buildExcludeModel", () => {
  it("builds text equals / notEqual", () => {
    expect(buildMatchModel("text", "SAP")).toEqual({
      filterType: "text",
      type: "equals",
      filter: "SAP",
    });
    expect(buildExcludeModel("text", "SAP")).toEqual({
      filterType: "text",
      type: "notEqual",
      filter: "SAP",
    });
  });

  it("stringifies non-string text values", () => {
    expect(buildMatchModel("text", 42)).toEqual({
      filterType: "text",
      type: "equals",
      filter: "42",
    });
  });

  it("builds numeric equals / notEqual and rejects NaN", () => {
    expect(buildMatchModel("number", 7)).toEqual({
      filterType: "number",
      type: "equals",
      filter: 7,
    });
    expect(buildExcludeModel("number", "12.5")).toEqual({
      filterType: "number",
      type: "notEqual",
      filter: 12.5,
    });
    expect(buildMatchModel("number", "not a number")).toBeNull();
  });

  it("builds local-day date models from ISO strings", () => {
    const model = buildMatchModel("date", "2026-04-27T10:30:00Z") as Record<string, unknown>;
    expect(model.filterType).toBe("date");
    expect(model.type).toBe("equals");
    // Local day of that instant, at midnight — matches compareDateFilter's
    // day-granularity comparison.
    const expectedDay = new Date("2026-04-27T10:30:00Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(model.dateFrom).toBe(
      `${expectedDay.getFullYear()}-${pad(expectedDay.getMonth() + 1)}-${pad(expectedDay.getDate())} 00:00:00`,
    );
    expect(model.dateTo).toBeNull();
    expect(buildMatchModel("date", "garbage")).toBeNull();
  });

  it("maps empty values to blank / notBlank", () => {
    expect(buildMatchModel("text", "")).toEqual({ filterType: "text", type: "blank" });
    expect(buildMatchModel("text", null)).toEqual({ filterType: "text", type: "blank" });
    expect(buildExcludeModel("date", undefined)).toEqual({
      filterType: "date",
      type: "notBlank",
    });
  });

  it("returns null for filterless columns", () => {
    expect(buildMatchModel("none", "x")).toBeNull();
    expect(buildExcludeModel("none", "x")).toBeNull();
  });
});

describe("buildContainsModel", () => {
  it("builds contains / notContains for one value of a multi-valued cell", () => {
    expect(buildContainsModel("Payments", false)).toEqual({
      filterType: "text",
      type: "contains",
      filter: "Payments",
    });
    expect(buildContainsModel("Payments", true)).toEqual({
      filterType: "text",
      type: "notContains",
      filter: "Payments",
    });
  });
});

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the clipboard API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const execCommand = vi.fn().mockReturnValue(true);
    (document as Document & { execCommand: typeof execCommand }).execCommand = execCommand;
    await expect(copyText("fallback")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
