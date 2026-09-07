import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/i18n/locales/en/nav.json";

import {
  MAX_SUBJECT_LENGTH,
  ROUTE_TITLES,
  UNTITLED_ROUTES,
  composeTitle,
  titleKeyForPath,
} from "./pageTitle";

const APP = "Turbo EA";

function appSource(): string {
  return fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf-8");
}

describe("titleKeyForPath", () => {
  it("resolves a concrete path", () => {
    expect(titleKeyForPath("/inventory")).toBe("inventory");
    expect(titleKeyForPath("/cards/abc-123")).toBe("pageTitles.card");
  });

  it("prefers the more specific pattern", () => {
    expect(titleKeyForPath("/diagrams/abc")).toBe("diagrams");
    expect(titleKeyForPath("/diagrams/abc/edit")).toBe("diagrams");
    expect(titleKeyForPath("/ea-delivery/soaw/abc")).toBe("pageTitles.soaw");
    expect(titleKeyForPath("/ea-delivery/adr/abc/preview")).toBe("pageTitles.decision");
    expect(titleKeyForPath("/turbolens/assessments/abc")).toBe("turbolens.assessments");
    expect(titleKeyForPath("/grc/risks/abc")).toBe("pageTitles.risk");
  });

  it("returns undefined for a route that is bare on purpose", () => {
    expect(titleKeyForPath("/")).toBeUndefined();
    expect(titleKeyForPath("/auth/reset-password")).toBeUndefined();
    expect(titleKeyForPath("/portal/acme")).toBeUndefined();
    expect(titleKeyForPath("/embed/diagram/acme")).toBeUndefined();
    expect(titleKeyForPath("/admin/eol")).toBeUndefined();
    expect(titleKeyForPath("/nonsense")).toBeUndefined();
  });
});

describe("composeTitle", () => {
  it("puts the subject in front of the app title", () => {
    expect(composeTitle("SAP S/4HANA", APP)).toBe("SAP S/4HANA | Turbo EA");
  });

  it("leaves the app title alone when there is no subject", () => {
    expect(composeTitle(null, APP)).toBe(APP);
    expect(composeTitle(undefined, APP)).toBe(APP);
    expect(composeTitle("", APP)).toBe(APP);
    expect(composeTitle("   ", APP)).toBe(APP);
    expect(composeTitle([], APP)).toBe(APP);
    expect(composeTitle(["", null as unknown as string], APP)).toBe(APP);
  });

  it("joins a multi-part subject with a middle dot", () => {
    expect(composeTitle(["GRC", "Risk"], APP)).toBe("GRC · Risk | Turbo EA");
    // A page that has a name but no active section, and vice versa.
    expect(composeTitle(["Apollo", ""], APP)).toBe("Apollo | Turbo EA");
    expect(composeTitle(["", "Store"], APP)).toBe("Store | Turbo EA");
  });

  it("does not say the same thing twice", () => {
    // `/todos` on its default tab: the route label and the tab share a name.
    expect(composeTitle(["Todos", "Todos"], APP)).toBe("Todos | Turbo EA");
  });

  it("honours a customised application title", () => {
    expect(composeTitle("Inventory", "Acme EA")).toBe("Inventory | Acme EA");
  });

  it("never repeats the app title", () => {
    // An admin who named the instance «TurboLens» browsing /turbolens.
    expect(composeTitle("TurboLens", "TurboLens")).toBe("TurboLens");
  });

  it("survives an empty app title", () => {
    expect(composeTitle("Inventory", "")).toBe("Inventory");
    expect(composeTitle("", "")).toBe("");
  });

  it("clamps a long subject so the app title stays visible", () => {
    const long = "A".repeat(200);
    const out = composeTitle(long, APP);
    expect(out.endsWith(" | Turbo EA")).toBe(true);
    expect(out).toContain("…");
    expect(Array.from(out.replace(" | Turbo EA", "")).length).toBe(MAX_SUBJECT_LENGTH);
  });

  it("does not cut a clamped subject through a surrogate pair", () => {
    const out = composeTitle("🚀".repeat(80), APP);
    const subject = out.replace(" | Turbo EA", "");
    // Emoji are surrogate pairs by nature; what must never appear is a LONE
    // surrogate, which is what slicing by UTF-16 unit would leave behind.
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(subject).not.toMatch(loneSurrogate);
    expect(subject.endsWith("…")).toBe(true);
    expect(Array.from(subject).length).toBe(MAX_SUBJECT_LENGTH);
  });

  it("keeps the same structure in an RTL locale", () => {
    // No bidi control characters: they would leak into copied bookmark titles.
    const out = composeTitle(["الحوكمة", "المخاطر"], "تيربو");
    expect(out).toBe("الحوكمة · المخاطر | تيربو");
    expect(out).not.toMatch(/[‎‏‪-‮⁦-⁩]/);
  });
});

describe("parity", () => {
  /**
   * Every route declared in `App.tsx` — the authenticated table AND the
   * public/unauthenticated blocks — has to be either titled or explicitly
   * listed as bare. A new route added without a decision fails here rather
   * than silently shipping a tab that just repeats the app title.
   */
  it("covers every route in App.tsx", () => {
    const declared = new Set(
      [...appSource().matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(declared.size).toBeGreaterThan(50);

    const known = new Set([...ROUTE_TITLES.map((r) => r.path), ...UNTITLED_ROUTES]);
    const unreviewed = [...declared].filter((p) => !known.has(p));
    expect(unreviewed).toEqual([]);
  });

  it("has no stale entries pointing at routes that no longer exist", () => {
    const declared = new Set(
      [...appSource().matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]),
    );
    const stale = [...ROUTE_TITLES.map((r) => r.path), ...UNTITLED_ROUTES].filter(
      (p) => !declared.has(p),
    );
    expect(stale).toEqual([]);
  });

  it("never titles and un-titles the same route", () => {
    const titled = new Set(ROUTE_TITLES.map((r) => r.path));
    expect(UNTITLED_ROUTES.filter((p) => titled.has(p))).toEqual([]);
  });

  /**
   * i18next renders an unknown key as the key itself, so a typo would ship a
   * tab reading «pageTitles.crad | Turbo EA» with nothing to catch it.
   */
  it("only names keys the nav namespace actually defines", () => {
    const keys = en as Record<string, string>;
    for (const { path: routePath, titleKey } of ROUTE_TITLES) {
      expect(
        typeof keys[titleKey] === "string" && keys[titleKey].length > 0,
        `${routePath} names unknown nav key "${titleKey}"`,
      ).toBe(true);
    }
  });
});
