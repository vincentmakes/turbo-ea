import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationBell from "./NotificationBell";

const navigate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
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
    // An "update available" notification points at the GitHub release notes.
    // Handing that to react-router would resolve it as an in-app path and land
    // the user on a blank route.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const url = "https://github.com/vincentmakes/turbo-ea/releases/tag/v2.60.0";

    await openAndClick(url, "app_update_available");

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer"),
    );
    expect(navigate).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
