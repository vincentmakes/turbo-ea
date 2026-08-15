import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import ReleaseNotesDialog from "./ReleaseNotesDialog";

/**
 * Deliberately hostile: a NEW `t` identity on every render.
 *
 * Real react-i18next memoises `t`, so the app never sees this. But a test that
 * mocks `useTranslation` inline gets a fresh function each render, and if the
 * loader effect depends on `t` that alone re-fires it — flipping `loading` back
 * on, unmounting the rendered notes, and refetching, without end. That is what
 * made NotificationBell's release-notes test fail intermittently: `findByText`
 * resolved a node during one content phase and the assertion ran after the next
 * flip, when the node was already detached.
 *
 * Keeping the unstable `t` here is the point of these tests — the component
 * must load once regardless of how a caller's mock behaves.
 *
 * These assert on the fetch count rather than waiting for DOM text: a
 * refetching component spins hard enough to starve the event loop, so a
 * DOM-waiting test hangs instead of failing.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

import { api } from "@/api/client";

const callsTo = (path: string) => vi.mocked(api.get).mock.calls.filter(([p]) => p === path);

/**
 * Let mount effects and their promise chains settle.
 *
 * `act` flushes until React goes quiet. That is exactly the property under
 * test: a component that re-fires its loader on every render never goes quiet,
 * so if the refetch loop ever returns these tests fail on a 5s timeout rather
 * than on the call count. A timeout here means the loop is back.
 */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("ReleaseNotesDialog", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/settings/update-status") {
        return {
          current_version: "2.60.0",
          latest_version: "2.61.0",
          release_url: "https://example.com/releases/v2.61.0",
          release_notes: "### Added\n- **A new thing** that matters",
          checked_at: new Date().toISOString(),
          error: null,
          update_available: true,
          enabled: true,
        };
      }
      if (path === "/settings/whats-new") {
        return { version: "2.61.0", from_version: "2.60.0", notes: "### Added\n- **Shipped**" };
      }
      return {};
    });
  });

  it("loads its notes once, even when the t identity changes every render", async () => {
    render(<ReleaseNotesDialog open variant="available" onClose={() => {}} />);
    await settle();

    expect(callsTo("/settings/update-status")).toHaveLength(1);
  });

  it("reads the installed variant from the bundled changelog, once", async () => {
    render(<ReleaseNotesDialog open variant="installed" onClose={() => {}} />);
    await settle();

    expect(callsTo("/settings/whats-new")).toHaveLength(1);
    expect(callsTo("/settings/update-status")).toHaveLength(0);
  });

  it("does not load anything while closed", async () => {
    render(<ReleaseNotesDialog open={false} variant="available" onClose={() => {}} />);
    await settle();

    expect(callsTo("/settings/update-status")).toHaveLength(0);
  });
});
