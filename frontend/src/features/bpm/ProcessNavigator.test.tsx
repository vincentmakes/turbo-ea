import { describe, it, expect, vi } from "vitest";

// ProcessNavigator pulls in the API client at module load; mock it so the
// import is side-effect free in the test environment.
vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));

import { ATTR_COLORS } from "./ProcessNavigator";

/*
 * Regression guard for issue #762.
 *
 * The BusinessProcess `automationLevel` field is seeded with these option keys
 * (backend/app/services/seed.py → AUTOMATION_LEVEL_OPTIONS). The BPM Process
 * Navigator colours nodes, builds side-summary chips, and renders the overlay
 * legend from ATTR_COLORS, so its keys MUST match the seeded option keys.
 * They previously read `partially` / `fully`, which never matched the stored
 * values `partiallyAutomated` / `fullyAutomated`, so those processes showed as
 * grey "Not Set" and were missing their Automation chip.
 */
const SEEDED_AUTOMATION_KEYS = ["manual", "partiallyAutomated", "fullyAutomated"];

describe("ProcessNavigator ATTR_COLORS (issue #762)", () => {
  it("keys the automationLevel overlay by the seeded option keys", () => {
    expect(Object.keys(ATTR_COLORS.automationLevel).sort()).toEqual(
      [...SEEDED_AUTOMATION_KEYS].sort(),
    );
  });

  it("resolves a non-Manual automation value to a real colour (not the grey default)", () => {
    for (const key of SEEDED_AUTOMATION_KEYS) {
      const info = ATTR_COLORS.automationLevel[key];
      expect(info).toBeDefined();
      expect(info.color).not.toBe("#bdbdbd");
      expect(info.label.length).toBeGreaterThan(0);
    }
  });
});
