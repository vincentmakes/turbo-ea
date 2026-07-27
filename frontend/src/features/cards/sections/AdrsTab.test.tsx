import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

const navigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => navigate };
});
vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [{ key: "Application", color: "#0f7eb5" }],
    relationTypes: [],
    invalidateCache: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (v: string) => v.slice(0, 10) }),
}));
vi.mock("@/features/ea-delivery/CreateAdrDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-adr-dialog" /> : null,
}));

import { api } from "@/api/client";
import AdrsTab from "./AdrsTab";

const CARD_ID = "card-123";

const mockAdrs = [
  {
    id: "adr-1",
    reference_number: "ADR-001",
    title: "Adopt Cloud-First Strategy",
    status: "signed",
    signatories: [],
    linked_cards: [{ id: CARD_ID, name: "NexaCore ERP", type: "Application" }],
    revision_number: 1,
    created_at: "2025-09-01T10:00:00Z",
    updated_at: "2025-09-04T10:00:00Z",
  },
];

function renderTab(canManageAdrLinks = true) {
  return render(
    <MemoryRouter>
      <AdrsTab
        cardId={CARD_ID}
        cardName="NexaCore ERP"
        cardType="Application"
        canManageAdrLinks={canManageAdrLinks}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === `/adr/by-card/${CARD_ID}`) return Promise.resolve(mockAdrs);
    if (url === "/adr") return Promise.resolve(mockAdrs);
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("AdrsTab", () => {
  it("loads the card-scoped ADR list", async () => {
    renderTab();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(`/adr/by-card/${CARD_ID}`);
    });
  });

  it("renders reference, title, status and linked cards", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("ADR-001")).toBeInTheDocument();
    });
    expect(screen.getByText("Adopt Cloud-First Strategy")).toBeInTheDocument();
    expect(screen.getByText("Signed")).toBeInTheDocument();
    expect(screen.getByText("NexaCore ERP")).toBeInTheDocument();
  });

  it("navigates to the ADR editor on row click", async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());
    await user.click(screen.getByText("Adopt Cloud-First Strategy"));
    expect(navigate).toHaveBeenCalledWith("/ea-delivery/adr/adr-1");
  });

  it("shows the empty state when no ADR is linked", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/No architecture decisions/)).toBeInTheDocument();
    });
  });

  it("hides link/create/unlink actions without manage permission", async () => {
    renderTab(false);
    await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Link ADR/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create ADR/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlink/ })).not.toBeInTheDocument();
  });

  it("unlinks an ADR from the card", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.delete).mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Unlink/ }));
    expect(api.delete).toHaveBeenCalledWith(`/adr/adr-1/cards/${CARD_ID}`);
  });

  it("links an existing ADR through the picker dialog", async () => {
    const user = userEvent.setup();
    // Card starts with no linked ADRs so the picker has something to offer.
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === `/adr/by-card/${CARD_ID}` ? Promise.resolve([]) : Promise.resolve(mockAdrs),
    );
    vi.mocked(api.post).mockResolvedValue({});
    renderTab();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Link ADR/ })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Link ADR/ }));
    await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());
    const dialogLinkButtons = screen.getAllByRole("button", { name: /Link ADR/ });
    await user.click(dialogLinkButtons[dialogLinkButtons.length - 1]);
    expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: CARD_ID });
  });

  it("opens the create dialog", async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Create ADR/ })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Create ADR/ }));
    expect(screen.getByTestId("create-adr-dialog")).toBeInTheDocument();
  });
});
