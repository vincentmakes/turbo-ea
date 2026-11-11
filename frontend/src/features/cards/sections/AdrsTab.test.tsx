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
  isAbortError: () => false,
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
import { createTheme } from "@mui/material/styles";
import { STATUS_COLORS } from "@/theme/tokens";
import AdrsTab from "./AdrsTab";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";

const CARD_ID = "card-123";
const BY_CARD = `/adr/by-card/${CARD_ID}?include_earlier=false`;

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
  invalidateDecisionOptions();
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === BY_CARD) return Promise.resolve(mockAdrs);
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("AdrsTab", () => {
  it("loads the card-scoped ADR list without earlier revisions", async () => {
    renderTab();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(BY_CARD);
    });
  });

  it("names a later revision 'ADR-012 · Rev 2' and shows its standing", async () => {
    vi.mocked(api.get).mockResolvedValue([
      { ...mockAdrs[0], reference_number: "ADR-012", revision_number: 2, standing: "revoked" },
    ]);
    renderTab();
    expect(await screen.findByText("ADR-012 · Rev 2")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.queryByText("Signed")).not.toBeInTheDocument();
  });

  it("shows Recorded for a decision recorded as decided", async () => {
    vi.mocked(api.get).mockResolvedValue([
      { ...mockAdrs[0], recorded_at: "2026-01-01T00:00:00Z" },
    ]);
    renderTab();
    expect(await screen.findByText("Recorded")).toBeInTheDocument();
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

  it("colours each linked-card chip by its type, grey for an unknown type, in white text", async () => {
    const other = { id: "c-2", name: "Mystery Box", type: "Unknown" };
    const adr = { ...mockAdrs[0], linked_cards: [...mockAdrs[0].linked_cards, other] };
    vi.mocked(api.get).mockResolvedValue([adr]);
    renderTab();
    const white = createTheme().palette.common.white;
    const chip = async (name: string) => (await screen.findByText(name)).closest(".MuiChip-root");
    expect(await chip("NexaCore ERP")).toHaveStyle({ backgroundColor: "#0f7eb5", color: white });
    expect(await chip("Mystery Box")).toHaveStyle({ backgroundColor: STATUS_COLORS.neutral, color: white });
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
    const PICKER = "/adr?include_earlier=false";

    /** Card has no linked ADRs, so everything the picker loads is offered. */
    function mockUnlinked(rows: unknown[] = mockAdrs, linked: unknown[] = []) {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === BY_CARD) return Promise.resolve(linked);
        if (url === PICKER) return Promise.resolve(rows);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
    }

    async function openPicker(user: ReturnType<typeof userEvent.setup>) {
      renderTab();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Link ADR/ })).toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: /Link ADR/ }));
      // The picker takes the focus and opens on it (browse on open).
      await waitFor(() =>
        expect(screen.getByPlaceholderText(/Search decisions/)).toHaveFocus(),
      );
    }

    it("loads the register through the shared picker, earlier revisions excluded", async () => {
      const user = userEvent.setup();
      mockUnlinked();
      await openPicker(user);
      await waitFor(() => expect(screen.getByRole("option")).toBeInTheDocument());
      expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toContain(PICKER);
      expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).not.toContain("/adr");
    });

    it("asks for confirmation before linking, then links on confirm", async () => {
      const user = userEvent.setup();
      mockUnlinked();
      vi.mocked(api.post).mockResolvedValue({});
      await openPicker(user);
      await user.click(await screen.findByRole("option", { name: /Adopt Cloud-First Strategy/ }));
      // The pick must not write on its own.
      expect(api.post).not.toHaveBeenCalled();
      expect(screen.getByText(/Link this decision\?/)).toBeInTheDocument();
      // The prompt names both the decision and the card being linked.
      expect(screen.getByText(/ADR-001.*Adopt Cloud-First Strategy.*NexaCore ERP/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^Link ADR$/ }));
      expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: CARD_ID });
    });

    it("names a later revision by its reference and revision in the confirmation", async () => {
      const user = userEvent.setup();
      mockUnlinked([{ ...mockAdrs[0], id: "adr-2", reference_number: "ADR-012", revision_number: 2 }]);
      await openPicker(user);
      await user.click(await screen.findByRole("option", { name: /Adopt Cloud-First Strategy/ }));
      expect(screen.getByText(/ADR-012 · Rev 2.*Adopt Cloud-First Strategy/)).toBeInTheDocument();
    });

    it("does not link when the confirmation is cancelled", async () => {
      const user = userEvent.setup();
      mockUnlinked();
      await openPicker(user);
      await user.click(await screen.findByRole("option", { name: /Adopt Cloud-First Strategy/ }));
      await user.click(screen.getByRole("button", { name: /Cancel/ }));

      expect(api.post).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByText(/Link this decision\?/)).not.toBeInTheDocument(),
      );
      // The picker stays open so another decision can be chosen.
      expect(screen.getByPlaceholderText(/Search decisions/)).toBeInTheDocument();
    });

    it("does not offer a decision the card already holds", async () => {
      const user = userEvent.setup();
      mockUnlinked(
        [
          mockAdrs[0],
          { ...mockAdrs[0], id: "adr-2", reference_number: "ADR-002", title: "Second" },
        ],
        [mockAdrs[0]],
      );
      await openPicker(user);
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
      expect(screen.getByRole("option", { name: /Second/ })).toBeInTheDocument();
    });

    it("says nothing is available when every decision is already linked", async () => {
      const user = userEvent.setup();
      mockUnlinked(mockAdrs, mockAdrs);
      await openPicker(user);
      expect(
        await screen.findByText(/No architecture decisions available/),
      ).toBeInTheDocument();
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

describe("AdrsTab — mentioned in", () => {
  it("lists the decisions and SoAWs that mention the card under the linked decisions", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === BY_CARD) return Promise.resolve(mockAdrs);
      if (url === `/mentions/cards/${CARD_ID}`) {
        return Promise.resolve({
          decisions: [
            {
              id: "adr-9",
              reference_number: "ADR-009",
              revision_number: 1,
              title: "Move billing to SaaS",
              status: "draft",
              standing: null,
              via: "comment",
            },
          ],
          soaws: [{ id: "s1", name: "Billing SoAW", revision_number: 1, status: "draft" }],
        });
      }
      return Promise.reject(new Error(`no mock for ${url}`));
    });
    renderTab();
    const block = await screen.findByTestId("mentioned-in");
    expect(block).toHaveTextContent("Mentioned in");
    expect(screen.getByRole("link", { name: "ADR-009 Move billing to SaaS" })).toHaveAttribute(
      "href",
      "/ea-delivery/adr/adr-9/preview",
    );
    expect(screen.getByRole("link", { name: "Billing SoAW" })).toHaveAttribute("href", "/ea-delivery/soaw/s1/preview");
    expect(screen.getByText("in the discussion")).toBeInTheDocument();
    // Below the decisions table.
    expect(screen.getByRole("table").compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no Mentioned in block when nothing mentions the card", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === BY_CARD) return Promise.resolve(mockAdrs);
      if (url === `/mentions/cards/${CARD_ID}`) return Promise.resolve({ decisions: [], soaws: [] });
      return Promise.reject(new Error(`no mock for ${url}`));
    });
    renderTab();
    await screen.findByText("ADR-001");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/mentions/cards/${CARD_ID}`, expect.anything()));
    expect(screen.queryByTestId("mentioned-in")).toBeNull();
  });
});
