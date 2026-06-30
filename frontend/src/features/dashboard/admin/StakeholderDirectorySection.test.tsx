import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/useResolveLabel", () => ({
  useResolveLabel: () => (label: string) => label,
  useResolveMetaLabel: () => (label: string) => label,
  useTypeLabel: () => (e?: { label?: string; key?: string } | null) => e?.label ?? e?.key ?? "",
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ getType: () => undefined }),
}));

import { api } from "@/api/client";
import StakeholderDirectorySection from "./StakeholderDirectorySection";

const DIRECTORY = {
  card_types: [
    {
      type_key: "Application",
      type_label: "Application",
      type_icon: "apps",
      type_color: "#0f7eb5",
      holders_count: 2,
      roles: [
        {
          role_key: "responsible",
          role_label: "Application Owner",
          role_color: "#1976d2",
          role_translations: {},
          users: [
            {
              user_id: "u-alice",
              display_name: "Alice",
              email: "alice@example.com",
              card_count: 2,
              cards: [
                { id: "card-a1", name: "NexaCore ERP" },
                { id: "card-a2", name: "Logistics Hub" },
              ],
            },
            {
              user_id: "u-bob",
              display_name: "Bob",
              email: "bob@example.com",
              card_count: 1,
              cards: [{ id: "card-a3", name: "Reporting Suite" }],
            },
          ],
        },
      ],
    },
    {
      type_key: "BusinessProcess",
      type_label: "Business Process",
      type_icon: "route",
      type_color: "#028f00",
      holders_count: 1,
      roles: [
        {
          role_key: "responsible",
          role_label: "Process Owner",
          role_color: "#1976d2",
          role_translations: {},
          users: [
            {
              user_id: "u-bob",
              display_name: "Bob",
              email: "bob@example.com",
              card_count: 1,
              cards: [{ id: "card-p1", name: "Onboarding Flow" }],
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderSection() {
  return render(
    <MemoryRouter>
      <StakeholderDirectorySection />
    </MemoryRouter>,
  );
}

describe("StakeholderDirectorySection", () => {
  it("fetches and renders the card-type tree; first type auto-expands", async () => {
    vi.mocked(api.get).mockResolvedValue(DIRECTORY);
    renderSection();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/reports/stakeholder-directory");
    });

    // The first card type is auto-expanded → its role + users render.
    expect(await screen.findByText("Application Owner")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    // The second card type is collapsed by default — its role doesn't show.
    expect(screen.queryByText("Process Owner")).not.toBeInTheDocument();
    // User cards are also collapsed by default.
    expect(screen.queryByText("NexaCore ERP")).not.toBeInTheDocument();
  });

  it("expands a user chip on click to reveal their cards under that role", async () => {
    vi.mocked(api.get).mockResolvedValue(DIRECTORY);
    renderSection();
    await screen.findByText("Alice");

    // Click the user chip to expand. Cards render below as clickable rows.
    await userEvent.click(screen.getByText("Alice"));
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.getByText("Logistics Hub")).toBeInTheDocument();
    // Bob's card isn't part of Alice's expansion.
    expect(screen.queryByText("Reporting Suite")).not.toBeInTheDocument();
  });

  it("filters by name and auto-expands matching card types", async () => {
    vi.mocked(api.get).mockResolvedValue(DIRECTORY);
    renderSection();
    await screen.findByText("Alice");

    // BusinessProcess starts collapsed.
    expect(screen.queryByText("Process Owner")).not.toBeInTheDocument();

    // Type "bob" — only Bob's placements remain, in BOTH card types.
    const filter = screen.getByPlaceholderText(
      "Filter by stakeholder name or email…",
    );
    await userEvent.type(filter, "bob");

    // BusinessProcess now visible (auto-expanded by the filter), Application
    // still visible too.
    expect(await screen.findByText("Process Owner")).toBeInTheDocument();
    expect(screen.getByText("Application Owner")).toBeInTheDocument();

    // Alice is filtered out.
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("shows the no-matches empty state when nothing matches the filter", async () => {
    vi.mocked(api.get).mockResolvedValue(DIRECTORY);
    renderSection();
    await screen.findByText("Alice");

    const filter = screen.getByPlaceholderText(
      "Filter by stakeholder name or email…",
    );
    await userEvent.type(filter, "zzzz");

    expect(
      await screen.findByText("No stakeholders match «zzzz»."),
    ).toBeInTheDocument();
  });

  it("renders the empty state when the directory is empty", async () => {
    vi.mocked(api.get).mockResolvedValue({ card_types: [] });
    renderSection();

    expect(
      await screen.findByText("No stakeholders are assigned yet."),
    ).toBeInTheDocument();
  });
});
