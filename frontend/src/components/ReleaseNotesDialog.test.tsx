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
      if (path.startsWith("/settings/release-notes")) {
        return {
          version: "2.55.0",
          from_version: "2.54.0",
          notes: "### Added\n- **An old thing** from back then",
          source: "changelog",
          release_url: null,
          is_installed: true,
          current_version: "2.61.0",
        };
      }
      return { app_title: "Turbo EA" };
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

  it("asks for the version it was given, not for whatever is newest", async () => {
    // The regression: a notification about 2.55.0 must not resolve to the
    // current release. The endpoint is version-scoped, and the legacy
    // "what is newest" endpoints must not be consulted at all.
    render(
      <ReleaseNotesDialog
        open
        variant="installed"
        version="2.55.0"
        fromVersion="2.54.0"
        onClose={() => {}}
      />,
    );
    await settle();

    const calls = vi
      .mocked(api.get)
      .mock.calls.map(([p]) => p as string)
      .filter((p) => p.startsWith("/settings/release-notes"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("version=2.55.0");
    expect(calls[0]).toContain("from_version=2.54.0");
    expect(callsTo("/settings/whats-new")).toHaveLength(0);
    expect(callsTo("/settings/update-status")).toHaveLength(0);
  });

  it("refetches when asked about a different version", async () => {
    const { rerender } = render(
      <ReleaseNotesDialog open variant="installed" version="2.55.0" onClose={() => {}} />,
    );
    await settle();
    rerender(<ReleaseNotesDialog open variant="installed" version="2.60.0" onClose={() => {}} />);
    await settle();

    const calls = vi
      .mocked(api.get)
      .mock.calls.map(([p]) => p as string)
      .filter((p) => p.startsWith("/settings/release-notes"));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("version=2.60.0");
  });

  it("does not load anything while closed", async () => {
    render(<ReleaseNotesDialog open={false} variant="available" onClose={() => {}} />);
    await settle();

    expect(callsTo("/settings/update-status")).toHaveLength(0);
  });

  it("does not title the spinner with the release it read last time", async () => {
    // `t` is the identity here, so a headline built from a loaded payload reads
    // "releaseNotes.title" and one with nothing loaded reads
    // "releaseNotes.titleFallback" -- enough to tell a stale title from a fresh one.
    const { rerender, queryByText } = render(
      <ReleaseNotesDialog open variant="available" onClose={() => {}} />,
    );
    await settle();
    expect(queryByText("releaseNotes.title")).not.toBeNull();

    rerender(<ReleaseNotesDialog open={false} variant="available" onClose={() => {}} />);
    await settle();

    // Reopen against a fetch that never settles: the dialog is showing its
    // spinner, and must not be captioned with the version from the last open.
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    rerender(<ReleaseNotesDialog open variant="available" onClose={() => {}} />);
    await settle();

    expect(queryByText("releaseNotes.title")).toBeNull();
    expect(queryByText("releaseNotes.titleFallback")).not.toBeNull();
  });
});
