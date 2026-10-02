import { describe, it, expect } from "vitest";

import i18n from "@/i18n";
import { CATEGORICAL_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { TodoOrigin } from "@/types";

import { ORIGIN_META, ORIGIN_ORDER, originOf } from "./originMeta";

const ALL_ORIGINS: TodoOrigin[] = ["ppm", "risk", "adr", "soaw", "bpm", "extension", "manual"];

describe("ORIGIN_ORDER", () => {
  it("lists every todo origin exactly once", () => {
    expect([...ORIGIN_ORDER].sort()).toEqual([...ALL_ORIGINS].sort());
    expect(new Set(ORIGIN_ORDER).size).toBe(ORIGIN_ORDER.length);
  });

  it("puts the module-driven origins first and manual todos last", () => {
    expect(ORIGIN_ORDER[0]).toBe("ppm");
    expect(ORIGIN_ORDER[ORIGIN_ORDER.length - 1]).toBe("manual");
  });

  it("matches the keys ORIGIN_META describes", () => {
    expect([...ORIGIN_ORDER].sort()).toEqual(Object.keys(ORIGIN_META).sort());
  });
});

describe("ORIGIN_META", () => {
  it.each(ALL_ORIGINS)("%s carries an icon, a colour token and a label key", (origin) => {
    const meta = ORIGIN_META[origin];
    expect(meta.icon).toMatch(/^[a-z_]+$/);
    expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(meta.labelKey).toBe(`todos.origin.${origin}`);
  });

  it.each(ALL_ORIGINS)("%s has a translated label in the common namespace", (origin) => {
    const { labelKey } = ORIGIN_META[origin];
    expect(i18n.exists(labelKey, { ns: "common" })).toBe(true);
    const label = i18n.t(labelKey, { ns: "common" });
    expect(label).not.toBe("");
    expect(label).not.toBe(labelKey);
  });

  it("reuses the module icons so a badge matches the nav item it links to", () => {
    expect(ORIGIN_META.ppm.icon).toBe("view_timeline");
    expect(ORIGIN_META.risk.icon).toBe("policy");
    expect(ORIGIN_META.bpm.icon).toBe("route");
    expect(ORIGIN_META.adr.icon).toBe("gavel");
    expect(ORIGIN_META.soaw.icon).toBe("draw");
    expect(ORIGIN_META.extension.icon).toBe("extension");
    expect(ORIGIN_META.manual.icon).toBe("edit_note");
  });

  it("takes its colours from existing tokens, never ad-hoc hex", () => {
    expect(ORIGIN_META.risk.color).toBe(STATUS_COLORS.error);
    expect(ORIGIN_META.manual.color).toBe(STATUS_COLORS.neutral);
    const palette: readonly string[] = CATEGORICAL_COLORS;
    for (const origin of ["ppm", "adr", "soaw", "bpm", "extension"] as const) {
      expect(palette).toContain(ORIGIN_META[origin].color);
    }
  });

  it("gives every origin a distinct icon, colour and label, so badges are tellable apart", () => {
    const metas = ALL_ORIGINS.map((o) => ORIGIN_META[o]);
    expect(new Set(metas.map((m) => m.icon)).size).toBe(metas.length);
    expect(new Set(metas.map((m) => m.color)).size).toBe(metas.length);
    const labels = metas.map((m) => i18n.t(m.labelKey, { ns: "common" }));
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("originOf", () => {
  it.each(ALL_ORIGINS)("returns %s when the server sent it", (origin) => {
    expect(originOf({ origin })).toBe(origin);
  });

  it("treats a payload without an origin as a manual todo", () => {
    expect(originOf({})).toBe("manual");
    expect(originOf({ origin: undefined })).toBe("manual");
  });

  it("always answers with an origin ORIGIN_META can render", () => {
    for (const todo of [{}, { origin: "risk" as const }]) {
      expect(ORIGIN_META[originOf(todo)]).toBeDefined();
    }
  });
});
