import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationBell from "./NotificationBell";

const navigate = vi.fn();

// Hoisted so `t` keeps one identity across renders, the way react-i18next's
// memoised `t` does. Returning a fresh arrow here makes every render look like
// a new translator to any effect that depends on `t`.
const t = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t }),
}));
vi.mock("react-router", () => ({
  useNavigate: () => navigate,
}));
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ items: [], unread_count: 3 }),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@/hooks/useEventStream", () => ({
  useEventStream: () => {},
}));

import { api } from "@/api/client";

function bellButton() {
  return screen.getByRole("button");
}

describe("NotificationBell icon color (#852)", () => {
  it("uses the navbar text color passed via the color prop", () => {
    render(<NotificationBell userId="u1" color="#1A1A2E" />);
    expect(bellButton()).toHaveStyle({ color: "rgb(26, 26, 46)" });
  });

  it("defaults to white when no color is passed (built-in navy navbar)", () => {
    render(<NotificationBell userId="u1" />);
    expect(bellButton()).toHaveStyle({ color: "rgb(255, 255, 255)" });
  });

  it("keeps the unread badge on the theme error color regardless of icon color", () => {
    const { container } = render(<NotificationBell userId="u1" color="#1A1A2E" />);
    expect(container.querySelector(".MuiBadge-colorError")).not.toBeNull();
  });
});

describe("NotificationBell link handling", () => {
  const notif = (id: string, link: string, type = "card_updated") => ({
    id,
    user_id: "u1",
    type,
    title: `notification ${id}`,
    message: "",
    link,
    is_read: true,
    created_at: new Date().toISOString(),
  });

  beforeEach(() => {
    navigate.mockClear();
    vi.mocked(api.get).mockReset();
  });

  /** Render the bell with one canned notification and open the popover. */
  async function openList(link: string, type?: string) {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/notifications?")) {
        return { items: [notif("n1", link, type)], total: 1, page: 1, page_size: 20 };
      }
      return { count: 1 };
    });
    const user = userEvent.setup();
    render(<NotificationBell userId="u1" />);
    await user.click(bellButton());
    return user;
  }

  async function openAndClick(link: string, type?: string) {
    const user = await openList(link, type);
    const item = await screen.findByText("notification n1");
    await user.click(item);
  }

  it("navigates in-app for a relative link", async () => {
    await openAndClick("/cards/abc-123");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/cards/abc-123"));
  });

  it("marks an external notification with an open-in-new glyph", async () => {
    await openList("https://github.com/vincentmakes/turbo-ea/releases/tag/v2.60.0");
    // The row leaves the app, so it must say so before it is clicked.
    expect(await screen.findByRole("img", { name: "opensExternally" })).toHaveTextContent(
      "open_in_new",
    );
  });

  it("does not mark an in-app notification with that glyph", async () => {
    await openList("/cards/abc-123");
    await screen.findByText("notification n1");
    expect(screen.queryByRole("img", { name: "opensExternally" })).toBeNull();
  });

  it("opens an absolute link in a new tab instead of routing to it", async () => {
    // Handing an absolute URL to react-router would resolve it as an in-app
    // path and land the user on a blank route.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const url = "https://example.com/some/page";

    await openAndClick(url);

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer"),
    );
    expect(navigate).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("opens the release-notes dialog for an update notice, staying in the app", async () => {
    // The notification carries the GitHub URL for the benefit of its email
    // copy, but in the app the notes render in a dialog — clicking must not
    // navigate away or pop a tab.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/notifications?")) {
        return {
          items: [
            notif(
              "n1",
              "https://github.com/vincentmakes/turbo-ea/releases/tag/v2.61.0",
              "app_update_available",
            ),
          ],
          total: 1,
          page: 1,
          page_size: 20,
        };
      }
      if (path === "/settings/update-status") {
        return {
          current_version: "2.60.0",
          latest_version: "2.61.0",
          release_url: "https://github.com/vincentmakes/turbo-ea/releases/tag/v2.61.0",
          release_notes: "### Added\n- **A new thing** that matters",
          checked_at: new Date().toISOString(),
          error: null,
          update_available: true,
          enabled: true,
        };
      }
      return { count: 1 };
    });

    const user = userEvent.setup();
    render(<NotificationBell userId="u1" />);
    await user.click(bellButton());
    await user.click(await screen.findByText("notification n1"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("A new thing")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("opens the what's-new dialog for a post-upgrade notice", async () => {
    // This one has no link at all — its notes come from the changelog bundled
    // in the image, read through /settings/whats-new.
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/notifications?")) {
        const row = { ...notif("n1", "", "app_updated"), link: undefined };
        return { items: [row], total: 1, page: 1, page_size: 20 };
      }
      if (path === "/settings/whats-new") {
        return {
          version: "2.60.0",
          from_version: "2.57.0",
          notes: "### Added\n- **Something shipped** in this release",
        };
      }
      return { count: 1 };
    });

    const user = userEvent.setup();
    render(<NotificationBell userId="u1" />);
    await user.click(bellButton());
    await user.click(await screen.findByText("notification n1"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(await screen.findByText("Something shipped")).toBeInTheDocument();
    // The installed variant has no external page to offer.
    expect(screen.queryByText("releaseNotes.viewOnGithub")).toBeNull();
    expect(screen.queryByRole("img", { name: "opensExternally" })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("marks a dialog-opening notice as such, not as leaving the app", async () => {
    // It opens a dialog, so open_in_new would be a lie — but the row still
    // needs to say that clicking it shows something.
    await openList(
      "https://github.com/vincentmakes/turbo-ea/releases/tag/v2.61.0",
      "app_update_available",
    );
    await screen.findByText("notification n1");

    expect(screen.queryByRole("img", { name: "opensExternally" })).toBeNull();
    expect(screen.getByRole("img", { name: "opensReleaseNotes" })).toHaveTextContent(
      "open_in_full",
    );
  });
});
