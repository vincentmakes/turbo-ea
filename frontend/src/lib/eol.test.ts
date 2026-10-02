import { describe, it, expect } from "vitest";

import i18n from "@/i18n";
import { STATUS_COLORS } from "@/theme";
import {
  EOL_STATUSES,
  EOL_STATUS_COLORS,
  EOL_STATUS_LABEL_KEYS,
  EOL_TYPES,
  isEolType,
  type EolStatusKey,
} from "./eol";

describe("EOL_TYPES", () => {
  it("is exactly the two types the backend's card_flags.EOL_TYPES names", () => {
    expect([...EOL_TYPES]).toEqual(["Application", "ITComponent"]);
  });
});

describe("isEolType", () => {
  it.each(EOL_TYPES)("accepts %s", (key) => {
    expect(isEolType(key)).toBe(true);
  });

  it.each(["Provider", "BusinessCapability", "DataObject", "Interface", "TechCategory"])(
    "rejects %s",
    (key) => {
      expect(isEolType(key)).toBe(false);
    },
  );

  it("is case-sensitive on the metamodel key", () => {
    expect(isEolType("application")).toBe(false);
    expect(isEolType("ITCOMPONENT")).toBe(false);
  });

  it("answers false, never throws, for a missing key", () => {
    expect(isEolType(undefined)).toBe(false);
    expect(isEolType(null)).toBe(false);
    expect(isEolType("")).toBe(false);
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
