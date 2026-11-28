import { describe, expect, it } from "vitest";

import { lifecyclePayload, maintainedRefusal, manualPhaseBounds } from "./lifecycleMaintained";

const lifecycle = {
  plan: "2020-01-01",
  active: "2022-01-01",
  phaseOut: "2029-01-01",
  endOfLife: "2030-01-01",
};

describe("manualPhaseBounds", () => {
  const locked = new Set(["phaseIn", "endOfLife"]);

  it("bounds a manual phase by the nearest dated maintained phases on each side", () => {
    // Phase In is maintained but undated, so Active is bounded only above.
    expect(manualPhaseBounds("active", lifecycle, locked)).toEqual({ max: "2030-01-01" });
    expect(
      manualPhaseBounds("phaseOut", lifecycle, new Set(["active", "endOfLife"])),
    ).toEqual({ min: "2022-01-01", max: "2030-01-01" });
    expect(manualPhaseBounds("phaseOut", lifecycle, new Set(["plan", "active"]))).toEqual({
      min: "2022-01-01",
    });
  });

  it("gives a maintained phase, an unknown phase or no lock no bounds", () => {
    expect(manualPhaseBounds("endOfLife", lifecycle, locked)).toEqual({});
    expect(manualPhaseBounds("retired", lifecycle, locked)).toEqual({});
    expect(manualPhaseBounds("phaseOut", lifecycle, new Set())).toEqual({});
  });
});

describe("lifecyclePayload", () => {
  it("leaves every maintained phase out, so a stale loaded date is never echoed", () => {
    expect(
      lifecyclePayload(
        { plan: "2020-01-01", active: "1999-01-01", endOfLife: "2040-01-01" },
        new Set(["active", "endOfLife"]),
      ),
    ).toEqual({ plan: "2020-01-01" });
    expect(lifecyclePayload({ plan: "2020-01-01" }, new Set())).toEqual({
      plan: "2020-01-01",
    });
  });
});

describe("maintainedRefusal", () => {
  it("reads the extension and phases of a lifecycle_maintained detail only", () => {
    const err = Object.assign(new Error("x"), {
      detail: { error: "lifecycle_maintained", phases: ["active", 3], extension: "Acme Sync" },
    });
    expect(maintainedRefusal(err)).toEqual({ extension: "Acme Sync", phases: ["active"] });
    expect(maintainedRefusal(Object.assign(new Error("x"), { detail: { error: "other" } }))).toBeNull();
    expect(maintainedRefusal(Object.assign(new Error("x"), { detail: "text" }))).toBeNull();
    expect(maintainedRefusal(new Error("x"))).toBeNull();
    expect(maintainedRefusal(null)).toBeNull();
  });

  it("needs both the lifecycle_maintained code and a phase list", () => {
    const withDetail = (detail: unknown) => Object.assign(new Error("x"), { detail });
    expect(maintainedRefusal(withDetail({ error: "other", phases: ["active"] }))).toBeNull();
    expect(maintainedRefusal(withDetail({ error: "lifecycle_maintained", phases: "active" }))).toBeNull();
    expect(maintainedRefusal(withDetail({ error: "lifecycle_maintained" }))).toBeNull();
  });

  it("reads no refusal from a null or non-object detail", () => {
    expect(maintainedRefusal({ detail: null })).toBeNull();
    const fnDetail = Object.assign(() => undefined, {
      error: "lifecycle_maintained",
      phases: ["active"],
      extension: "Acme Sync",
    });
    expect(maintainedRefusal({ detail: fnDetail })).toBeNull();
  });

  it("names no extension when the detail carries none, or not as text", () => {
    expect(
      maintainedRefusal({ detail: { error: "lifecycle_maintained", phases: ["plan"] } }),
    ).toEqual({ extension: "", phases: ["plan"] });
    expect(
      maintainedRefusal({ detail: { error: "lifecycle_maintained", phases: [], extension: 42 } }),
    ).toEqual({ extension: "", phases: [] });
  });
});
