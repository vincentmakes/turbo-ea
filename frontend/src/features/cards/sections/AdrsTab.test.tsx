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

  describe("link picker dialog", () => {
    /** Card has no linked ADRs, so everything in /adr is offered by the picker. */
    function mockUnlinked(rows = mockAdrs) {
      vi.mocked(api.get).mockImplementation((url: string) =>
        url === `/adr/by-card/${CARD_ID}` ? Promise.resolve([]) : Promise.resolve(rows),
      );
    }

    async function openPicker(user: ReturnType<typeof userEvent.setup>) {
      renderTab();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Link ADR/ })).toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: /Link ADR/ }));
    }

    it("asks for confirmation before linking, then links on confirm", async () => {
      const user = userEvent.setup();
      mockUnlinked();
      vi.mocked(api.post).mockResolvedValue({});
      await openPicker(user);
      await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());

      await user.click(screen.getByText("Adopt Cloud-First Strategy"));
      // The row click must not write on its own.
      expect(api.post).not.toHaveBeenCalled();
      expect(screen.getByText(/Link this decision\?/)).toBeInTheDocument();
      // The prompt names both the decision and the card being linked.
      expect(screen.getByText(/ADR-001.*Adopt Cloud-First Strategy.*NexaCore ERP/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^Link ADR$/ }));
      expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: CARD_ID });
    });

    it("does not link when the confirmation is cancelled", async () => {
      const user = userEvent.setup();
      mockUnlinked();
      await openPicker(user);
      await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());

      await user.click(screen.getByText("Adopt Cloud-First Strategy"));
      await user.click(screen.getByRole("button", { name: /Cancel/ }));

      expect(api.post).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByText(/Link this decision\?/)).not.toBeInTheDocument(),
      );
      // The picker stays open so another decision can be chosen.
      expect(screen.getByPlaceholderText(/Search decisions/)).toBeInTheDocument();
    });

    it("orders rows by reference, not by the API's recency order", async () => {
      const user = userEvent.setup();
      // /adr returns updated_at desc — deliberately out of reference order.
      mockUnlinked([
        { ...mockAdrs[0], id: "adr-9", reference_number: "ADR-009", title: "Nine" },
        { ...mockAdrs[0], id: "adr-11", reference_number: "ADR-011", title: "Eleven" },
        { ...mockAdrs[0], id: "adr-3", reference_number: "ADR-003", title: "Three" },
      ]);
      await openPicker(user);
      await waitFor(() => expect(screen.getByText("ADR-003")).toBeInTheDocument());
      const refs = screen
        .getAllByText(/^ADR-\d{3}$/)
        .map((el) => el.textContent);
      expect(refs).toEqual(["ADR-003", "ADR-009", "ADR-011"]);
    });

    it("shows a status chip on each row", async () => {
      const user = userEvent.setup();
      mockUnlinked([
        { ...mockAdrs[0], id: "adr-d", reference_number: "ADR-020", status: "draft" },
      ]);
      await openPicker(user);
      await waitFor(() => expect(screen.getByText("ADR-020")).toBeInTheDocument());
      expect(screen.getByText("Draft")).toBeInTheDocument();
    });

    it("shows a spinner instead of an empty state while loading", async () => {
      const user = userEvent.setup();
      let release: (v: unknown) => void = () => {};
      const pending = new Promise((res) => {
        release = res;
      });
      vi.mocked(api.get).mockImplementation((url: string) =>
        url === `/adr/by-card/${CARD_ID}` ? Promise.resolve([]) : (pending as Promise<never>),
      );
      await openPicker(user);
      // The "nothing available" copy must not flash before the list arrives.
      expect(screen.queryByText(/No architecture decisions available/)).not.toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      release(mockAdrs);
      await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());
    });

    it("distinguishes 'no search match' from 'nothing left to link'", async () => {
      const user = userEvent.setup();
      mockUnlinked();
      await openPicker(user);
      await waitFor(() => expect(screen.getByText("ADR-001")).toBeInTheDocument());
      await user.type(screen.getByPlaceholderText(/Search decisions/), "zzzz");
      await waitFor(() =>
        expect(screen.getByText(/No decisions match your search/)).toBeInTheDocument(),
      );
      expect(screen.queryByText(/No architecture decisions available/)).not.toBeInTheDocument();
    });

    it("says nothing is available when every ADR is already linked", async () => {
      const user = userEvent.setup();
      // by-card returns the same rows /adr does → nothing left to offer.
      vi.mocked(api.get).mockResolvedValue(mockAdrs);
      await openPicker(user);
      await waitFor(() =>
        expect(screen.getByText(/No architecture decisions available/)).toBeInTheDocument(),
      );
    });
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
