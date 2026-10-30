import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>(
    "@/api/client",
  );
  return {
    ...actual,
    api: { get: vi.fn() },
  };
});

vi.mock("@/hooks/useResolveLabel", () => ({
  useResolveLabel: () => (label: string) => label,
  useResolveMetaLabel: () => (label: string) => label,
}));

import { api } from "@/api/client";
import StakeholderHoverCard, { _resetStakeholderHoverCache } from "./StakeholderHoverCard";

const PORTFOLIO = {
  items: [
    { id: "card-1", name: "NexaCore ERP", type: "Application", status: "ACTIVE" },
    { id: "card-2", name: "Logistics Hub", type: "Application", status: "ACTIVE" },
  ],
  roles_by_card_id: {
    "card-1": [
      { key: "responsible", label: "Responsible", color: "#1976d2", translations: {} },
    ],
    "card-2": [
      { key: "observer", label: "Observer", color: "#9e9e9e", translations: {} },
    ],
  },
};

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderHover(userId = "u-alice") {
  return render(
    <MemoryRouter>
      <StakeholderHoverCard userId={userId} userName="Alice">
        <span>Alice trigger</span>
      </StakeholderHoverCard>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/**
 * jsdom cannot follow a real link: a click the app leaves to the browser
 * (Ctrl / Cmd / Shift) would log "Not implemented: navigation". Stop the
 * default on `document`, after React's root listener has seen the click.
 */
function stopBrowserNavigation(e: Event) {
  e.preventDefault();
}

async function openHover() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
  await user.hover(screen.getByText("Alice trigger"));
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  await screen.findByText("NexaCore ERP");
  return user;
}

beforeEach(() => {
  _resetStakeholderHoverCache();
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("StakeholderHoverCard", () => {
  it("opens the popover on hover and renders the role-grouped portfolio", async () => {
    vi.mocked(api.get).mockResolvedValue(PORTFOLIO);
    renderHover();

    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });

    const trigger = screen.getByText("Alice trigger");
    await user.hover(trigger);
    // Wait past the open-delay
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/cards/my-stakeholder?user_id=u-alice",
      );
    });
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByText("Logistics Hub")).toBeInTheDocument();
    // Hover-card header shows the user's name.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("lists each card as a link that closes the hover card on a plain click (#1335)", async () => {
    vi.mocked(api.get).mockResolvedValue(PORTFOLIO);
    renderHover();
    const user = await openHover();

    expect(screen.getByText("NexaCore ERP").closest("a")).toHaveAttribute("href", "/cards/card-1");
    expect(screen.getByText("Logistics Hub").closest("a")).toHaveAttribute("href", "/cards/card-2");

    await user.click(screen.getByText("NexaCore ERP"));
    expect(screen.getByTestId("location")).toHaveTextContent("/cards/card-1");
    await waitFor(() => expect(screen.queryByText("Logistics Hub")).not.toBeInTheDocument());
  });

  it("keeps the hover card up on a Ctrl-click, which opens a new tab", async () => {
    vi.mocked(api.get).mockResolvedValue(PORTFOLIO);
    renderHover();
    await openHover();

    document.addEventListener("click", stopBrowserNavigation);
    fireEvent.click(screen.getByText("NexaCore ERP"), { ctrlKey: true });
    document.removeEventListener("click", stopBrowserNavigation);
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(screen.getByText("Logistics Hub")).toBeInTheDocument();
  });

  it("only fetches once per user id even on repeated hovers", async () => {
    vi.mocked(api.get).mockResolvedValue(PORTFOLIO);

    // First hover.
    const { unmount } = renderHover();
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime.bind(vi),
    });
    await user.hover(screen.getByText("Alice trigger"));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    // Unmount → mount fresh wrapper (simulates the same user appearing twice
    // on the page) and hover again. Cache should kick in.
    unmount();
    renderHover();
    await user.hover(screen.getByText("Alice trigger"));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
