import { describe, it, expect } from "vitest";

import i18n from "@/i18n";
import { STATUS_COLORS } from "@/theme";
import {
  EOL_STATUSES,
  EOL_STATUS_COLORS,
  EOL_STATUS_LABEL_KEYS,
  DEFAULT_EOL_TYPES,
  eolTypeKeys,
  typeKeyTracksEol,
  typeTracksEol,
  type EolStatusKey,
} from "./eol";

describe("DEFAULT_EOL_TYPES", () => {
  it("is exactly the two types the backend's card_flags.DEFAULT_EOL_TYPES names", () => {
    expect([...DEFAULT_EOL_TYPES]).toEqual(["Application", "ITComponent"]);
  });
});

describe("typeTracksEol — the type's End of Life section toggle", () => {
  it.each([
    [{ key: "Application" }, true],
    [{ key: "ITComponent", section_config: {} }, true],
    [{ key: "Platform" }, false],
    [{ key: "MyCustomType", section_config: {} }, false],
    [{ key: "ITComponent", section_config: { eol: { hidden: true } } }, false],
    [{ key: "Platform", section_config: { eol: { hidden: false } } }, true],
    [{ key: "Custom", section_config: { eol: { hidden: false, defaultExpanded: true } } }, true],
    // No `hidden` says nothing about visibility.
    [{ key: "Application", section_config: { eol: { defaultExpanded: false } } }, true],
    [{ key: "Platform", section_config: { eol: { defaultExpanded: true } } }, false],
    // A legacy bare boolean is the old "expanded" flag.
    [{ key: "Platform", section_config: { eol: true } }, false],
    [{ key: "ITComponent", section_config: { eol: false } }, true],
    // Only a real boolean counts, and only on the eol section.
    [{ key: "Platform", section_config: { eol: { hidden: "false" } } }, false],
    [{ key: "Platform", section_config: { lifecycle: { hidden: false } } }, false],
  ])("%j → %s", (type, tracks) => {
    expect(typeTracksEol(type)).toBe(tracks);
  });

  it("is case-sensitive on the metamodel key and false without a type", () => {
    expect(typeTracksEol({ key: "application" })).toBe(false);
    expect(typeTracksEol(undefined)).toBe(false);
    expect(typeTracksEol(null)).toBe(false);
  });
});

describe("typeKeyTracksEol", () => {
  const types = [
    { key: "ITComponent", section_config: { eol: { hidden: true } } },
    { key: "Platform", section_config: { eol: { hidden: false } } },
  ];

  it("reads the metamodel row when there is one", () => {
    expect(typeKeyTracksEol("ITComponent", types)).toBe(false);
    expect(typeKeyTracksEol("Platform", types)).toBe(true);
  });

  it("falls back to the shipped default for a type it does not know yet", () => {
    expect(typeKeyTracksEol("Application", types)).toBe(true);
    expect(typeKeyTracksEol("Application")).toBe(true);
    expect(typeKeyTracksEol("Gizmo")).toBe(false);
  });

  it("answers false, never throws, for a missing key", () => {
    expect(typeKeyTracksEol(undefined)).toBe(false);
    expect(typeKeyTracksEol(null)).toBe(false);
    expect(typeKeyTracksEol("")).toBe(false);
  });
});

describe("eolTypeKeys", () => {
  it("lists the visible tracking types in metamodel order", () => {
    expect(
      eolTypeKeys([
        { key: "Platform", section_config: { eol: { hidden: false } } },
        { key: "Application" },
        { key: "ITComponent", section_config: { eol: { hidden: true } } },
        { key: "Retired", is_hidden: true, section_config: { eol: { hidden: false } } },
        { key: "Gizmo" },
      ]),
    ).toEqual(["Platform", "Application"]);
  });
});

describe("EOL_STATUSES", () => {
  it("lists the four classifications the backend returns", () => {
    expect([...EOL_STATUSES]).toEqual(["eol", "approaching", "supported", "unknown"]);
  });
});

describe("EOL_STATUS_COLORS", () => {
  it.each<[EolStatusKey, string]>([
    ["eol", STATUS_COLORS.error],
    ["approaching", STATUS_COLORS.warning],
    ["supported", STATUS_COLORS.success],
    ["unknown", STATUS_COLORS.neutral],
  ])("%s takes the %s token", (status, token) => {
    expect(EOL_STATUS_COLORS[status]).toBe(token);
  });

  it("colours the 'nothing recorded' state grey, not red", () => {
    // A missing link is an inventory gap, not an established risk, so it reads
    // the same as an unknown status rather than as end-of-life.
    expect(EOL_STATUS_COLORS.missing).toBe(STATUS_COLORS.neutral);
    expect(EOL_STATUS_COLORS.missing).not.toBe(EOL_STATUS_COLORS.eol);
  });

  it("tells the three classified states apart", () => {
    const classified = ["eol", "approaching", "supported"].map((s) => EOL_STATUS_COLORS[s]);
    expect(new Set(classified).size).toBe(3);
  });

  it("covers every status plus the missing state, and nothing else", () => {
    expect(Object.keys(EOL_STATUS_COLORS).sort()).toEqual([...EOL_STATUSES, "missing"].sort());
  });
});

describe("EOL_STATUS_LABEL_KEYS", () => {
  it("has a key for every status plus the missing state, and nothing else", () => {
    expect(Object.keys(EOL_STATUS_LABEL_KEYS).sort()).toEqual([...EOL_STATUSES, "missing"].sort());
  });

  it("keeps the colour and label tables in step", () => {
    expect(Object.keys(EOL_STATUS_LABEL_KEYS).sort()).toEqual(
      Object.keys(EOL_STATUS_COLORS).sort(),
    );
  });

  it.each(Object.entries(EOL_STATUS_LABEL_KEYS))(
    "%s resolves in the reports namespace to a real label",
    (_status, key) => {
      expect(i18n.exists(key, { ns: "reports" })).toBe(true);
      const label = i18n.t(key, { ns: "reports" });
      expect(label).not.toBe("");
      expect(label).not.toBe(key);
    },
  );

  it("gives each state its own wording", () => {
    const labels = Object.values(EOL_STATUS_LABEL_KEYS).map((key) =>
      i18n.t(key, { ns: "reports" }),
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});
