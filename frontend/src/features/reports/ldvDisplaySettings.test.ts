/**
 * The shared LDV display store. Its one subtlety is that stored settings are
 * merged onto the defaults, which is what lets a new option ship without
 * bumping the storage key and wiping everyone's existing preferences.
 *
 * The store caches at module level, so each test re-imports it rather than
 * sharing one cache — otherwise the first test to read would fix the value
 * every later one sees, and the suite would pass or fail on declaration order.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const KEY = "tea.ldv.display.v3";

async function freshStore() {
  vi.resetModules();
  return import("./ldvDisplaySettings");
}

beforeEach(() => {
  localStorage.clear();
});

describe("LDV display settings", () => {
  it("shows relationship labels by default", async () => {
    // Hiding the verbs is opt-in: a diagram whose edges say nothing is a
    // deliberate choice for a dense landscape, not the starting point.
    const { LDV_DEFAULT_SETTINGS, getLdvSettings } = await freshStore();
    expect(LDV_DEFAULT_SETTINGS.showRelationLabels).toBe(true);
    expect(getLdvSettings().showRelationLabels).toBe(true);
  });

  it("shows card logos by default", async () => {
    // A logo is the fastest way to recognise a product on a dense landscape,
    // so it is on out of the box; the switch exists for the reader who wants
    // an unadorned diagram, not to make logos opt-in.
    const { LDV_DEFAULT_SETTINGS, getLdvSettings } = await freshStore();
    expect(LDV_DEFAULT_SETTINGS.showCardLogos).toBe(true);
    expect(getLdvSettings().showCardLogos).toBe(true);
  });

  it("turns card logos on for a browser holding settings from before the option", async () => {
    // The upgrade path: `read()` spreads the defaults under the stored blob,
    // which is why this option needed no storage-key bump.
    localStorage.setItem(KEY, JSON.stringify({ showType: false }));
    const { getLdvSettings } = await freshStore();
    expect(getLdvSettings().showCardLogos).toBe(true);
  });

  it("fills in an option missing from previously stored settings", async () => {
    // What a browser holds after upgrading from a build that predates the
    // option. Without the merge onto the defaults it would read as undefined —
    // falsy — and silently turn the labels off for every existing user.
    localStorage.setItem(KEY, JSON.stringify({ showType: false }));
    const { getLdvSettings } = await freshStore();
    const s = getLdvSettings();
    expect(s.showType).toBe(false);
    expect(s.showRelationLabels).toBe(true);
  });

  it("defaults the connection line style to today's dashed look", async () => {
    // The option exists to let people change the lines, not to change them:
    // an install that never opens the picker must look exactly as before.
    const { LDV_DEFAULT_SETTINGS, getLdvSettings } = await freshStore();
    expect(LDV_DEFAULT_SETTINGS.edgeLineStyle).toBe("dashed");
    expect(getLdvSettings().edgeLineStyle).toBe("dashed");
  });

  it("back-fills the line style for a browser that predates it", async () => {
    localStorage.setItem(KEY, JSON.stringify({ showType: false }));
    const { getLdvSettings } = await freshStore();
    expect(getLdvSettings().edgeLineStyle).toBe("dashed");
  });

  it("round-trips the line style through storage", async () => {
    const { getLdvSettings, setLdvSettings } = await freshStore();
    setLdvSettings({ edgeLineStyle: "solid" });
    expect(getLdvSettings().edgeLineStyle).toBe("solid");
    expect(JSON.parse(localStorage.getItem(KEY)!).edgeLineStyle).toBe("solid");
    expect(getLdvSettings().showRelationLabels).toBe(true);
  });

  it("round-trips a change through storage", async () => {
    const { getLdvSettings, setLdvSettings } = await freshStore();
    setLdvSettings({ showRelationLabels: false });
    expect(getLdvSettings().showRelationLabels).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!).showRelationLabels).toBe(false);
    // Untouched options keep their values.
    expect(getLdvSettings().showRelationValues).toBe(true);
  });
});
