import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import CardDetail from "./CardDetail";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useCalculatedFields", () => ({
  useCalculatedFields: vi.fn(),
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: vi.fn(),
}));

// Stub all card section components to keep tests focused on CardDetail logic
vi.mock("@/features/cards/sections", () => ({
  DataQualityPill: ({ value }: { value: number }) => (
    <div data-testid="data-quality">{value}%</div>
  ),
  DescriptionSection: () => <div data-testid="description-section" />,
  LifecycleSection: () => <div data-testid="lifecycle-section" />,
  AttributeSection: () => <div data-testid="attribute-section" />,
  HierarchySection: () => <div data-testid="hierarchy-section" />,
  SuccessorsSection: () => <div data-testid="successors-section" />,
  TagsSection: () => <div data-testid="tags-section" />,
  RelationsSection: () => <div data-testid="relations-section" />,
  LayeredDependencySection: () => <div data-testid="ldv-section" />,
  CommentsTab: () => <div data-testid="comments-tab" />,
  TodosTab: () => <div data-testid="todos-tab" />,
  StakeholdersTab: () => <div data-testid="stakeholders-tab" />,
  ResourcesTab: () => <div data-testid="resources-tab" />,
  HistoryTab: () => <div data-testid="history-tab" />,
  RisksTab: () => <div data-testid="risks-tab" />,
  ComplianceTab: () => <div data-testid="compliance-tab" />,
}));

vi.mock("@/features/cards/sections/SoAWTab", () => ({
  default: () => <div data-testid="soaw-tab" />,
}));

vi.mock("@/components/EolLinkSection", () => ({
  default: () => <div data-testid="eol-section" />,
}));

vi.mock("@/features/bpm/ProcessFlowTab", () => ({
  default: () => <div data-testid="process-flow-tab" />,
}));

vi.mock("@/features/bpm/ProcessAssessmentPanel", () => ({
  default: () => <div data-testid="assessment-panel" />,
}));

vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({
    user: {
      id: "user-1",
      email: "test@example.com",
      display_name: "Test User",
      permissions: { "*": true },
    },
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    can: () => true,
    permissions: { "*": true },
  }),
}));

vi.mock("@/hooks/usePpmEnabled", () => ({
  usePpmEnabled: () => ({ ppmEnabled: false }),
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCalculatedFields } from "@/hooks/useCalculatedFields";
import { useCurrency } from "@/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const APPLICATION_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  has_hierarchy: true,
  fields_schema: [
    { section: "Details", fields: [{ key: "costTotalAnnual", label: "Cost", type: "cost" }] },
  ],
  section_config: {},
};

const BUSINESS_PROCESS_TYPE = {
  key: "BusinessProcess",
  label: "Business Process",
  icon: "schema",
  color: "#8e24aa",
  has_hierarchy: true,
  fields_schema: [],
  section_config: {},
};

const mockCard = {
  id: "card-1",
  name: "My Application",
  type: "Application",
  subtype: "Business Application",
  description: "Test app description",
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 75,
  lifecycle: { active: "2024-01-01" },
  attributes: {},
  tags: [],
  stakeholders: [],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-06-01T00:00:00Z",
};

const mockPerms = {
  effective: {
    can_view: true,
    can_edit: true,
    can_archive: true,
    can_delete: true,
    can_approval_status: true,
    can_manage_stakeholders: true,
    can_manage_relations: true,
    can_manage_documents: true,
    can_manage_comments: true,
    can_create_comments: true,
    can_bpm_edit: true,
    can_bpm_manage_drafts: true,
    can_bpm_approve: true,
    can_manage_adr_links: true,
    can_manage_diagram_links: true,
    can_view_costs: true,
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(useMetamodel).mockReturnValue({
    types: [APPLICATION_TYPE, BUSINESS_PROCESS_TYPE],
    relationTypes: [],
    loading: false,
    getType: (key: string) =>
      [APPLICATION_TYPE, BUSINESS_PROCESS_TYPE].find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });

  vi.mocked(useCalculatedFields).mockReturnValue({
    calculatedFields: {},
    isCalculated: () => false,
    loading: false,
  });

  vi.mocked(useCurrency).mockReturnValue({
    fmt: (v: number) => `$${v}`,
    fmtShort: (v: number) => `$${v}`,
    symbol: "$",
    loading: false,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderCardDetail(cardId = "card-1") {
  return render(
    <MemoryRouter initialEntries={[`/cards/${cardId}`]}>
      <Routes>
        <Route path="/cards/:id" element={<CardDetail />} />
        <Route path="/inventory" element={<div data-testid="inventory-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CardDetail", () => {
  it("shows loading state before card data loads", () => {
    // Never resolve — keep in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderCardDetail();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows error alert when card fetch fails", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.reject(new Error("Card not found"));
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("Card not found")).toBeInTheDocument();
    });
  });

  it("renders card name and type label", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });
    expect(screen.getByText("Application")).toBeInTheDocument();
  });

  it("renders subtype label", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("Business Application")).toBeInTheDocument();
    });
  });

  it("renders data quality pill", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByTestId("data-quality")).toHaveTextContent("75%");
    });
  });

  it("renders standard tabs (Card, Comments, Todos, Stakeholders, History)", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^card$/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /comments/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /todos/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /stakeholders/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /history/i })).toBeInTheDocument();
  });

  it("renders extra tabs for BusinessProcess type", async () => {
    const bpmCard = { ...mockCard, type: "BusinessProcess" };
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(bpmCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /process flow/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: /assessments/i })).toBeInTheDocument();
  });

  it("does not render Process Flow tab for non-BPM types", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^card$/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("tab", { name: /process flow/i })).not.toBeInTheDocument();
  });

  it("renders approval status badge as interactive chip when user has permission", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });
    // The approval chip should render the status text and be clickable
    const draftChip = screen.getByText(/draft/i).closest(".MuiChip-root");
    expect(draftChip).toBeInTheDocument();
    expect(draftChip).toHaveClass("MuiChip-clickable");
  });

  it("renders approval status badge as non-interactive when user lacks permission", async () => {
    const restrictedPerms = {
      effective: { ...mockPerms.effective, can_approval_status: false },
    };
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(restrictedPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });
    // The approval chip should still show status but NOT be clickable
    const draftChip = screen.getByText(/draft/i).closest(".MuiChip-root");
    expect(draftChip).toBeInTheDocument();
    expect(draftChip).not.toHaveClass("MuiChip-clickable");
  });

  it("shows overflow menu with Archive and Delete for active card with permissions", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /archive/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows archived banner for archived card", async () => {
    const archivedCard = {
      ...mockCard,
      status: "ARCHIVED",
      archived_at: new Date().toISOString(),
    };
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(archivedCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText(/this card is archived/i)).toBeInTheDocument();
    });
  });

  it("shows restore confirmation dialog with parent-link warning when Restore is clicked", async () => {
    const user = userEvent.setup();
    const archivedCard = {
      ...mockCard,
      status: "ARCHIVED",
      archived_at: new Date().toISOString(),
    };
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      if (path.includes("/restore-impact")) return Promise.resolve({ passengers: [] });
      return Promise.resolve(archivedCard);
    });
    vi.mocked(api.post).mockResolvedValueOnce({
      primary: { ...archivedCard, status: "ACTIVE", archived_at: null },
      restored_passenger_ids: [],
    });

    renderCardDetail();

    // Banner renders with a Restore button. Its accessible name includes the
    // material-symbol icon's text, so match leniently.
    await waitFor(() => {
      expect(screen.getByText(/this card is archived/i)).toBeInTheDocument();
    });
    const restoreButtons = screen.getAllByRole("button", { name: /restore/i });
    await user.click(restoreButtons[0]);

    // Parent-link warning appears in the confirmation dialog.
    await waitFor(() => {
      expect(
        screen.getByText(/does not bring back any parent link/i),
      ).toBeInTheDocument();
    });

    // Click the dialog's confirm Restore (last matching button).
    const restoreButtonsAfterOpen = screen.getAllByRole("button", { name: /restore/i });
    await user.click(restoreButtonsAfterOpen[restoreButtonsAfterOpen.length - 1]);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(`/cards/${mockCard.id}/restore`, {});
    });
  });

  it("shows archive confirmation dialog when Archive is clicked via overflow menu", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      if (path.includes("/archive-impact"))
        return Promise.resolve({
          child_count: 0,
          descendant_count: 0,
          approved_descendant_count: 0,
          grandparent: null,
          children: [],
          related_cards: [],
        });
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /archive/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("menuitem", { name: /archive/i }));

    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to archive/i)).toBeInTheDocument();
    });
  });

  it("shows delete confirmation dialog when Delete is clicked via overflow menu", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      if (path.includes("/archive-impact"))
        return Promise.resolve({
          child_count: 0,
          descendant_count: 0,
          approved_descendant_count: 0,
          grandparent: null,
          children: [],
          related_cards: [],
        });
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /more actions/i }));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to permanently delete/i)).toBeInTheDocument();
    });
  });

  it("calls api.delete on delete confirmation via overflow menu", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      if (path.includes("/archive-impact"))
        return Promise.resolve({
          child_count: 0,
          descendant_count: 0,
          approved_descendant_count: 0,
          grandparent: null,
          children: [],
          related_cards: [],
        });
      return Promise.resolve(mockCard);
    });
    vi.mocked(api.delete).mockResolvedValueOnce({
      deleted_card_ids: ["card-1"],
      affected_children_ids: [],
      affected_related_card_ids: [],
    });

    renderCardDetail();

    // Open overflow menu
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /more actions/i }));

    // Click Delete menu item
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    // Confirm delete
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /delete permanently/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/cards/card-1", {});
    });
  });

  it("renders card sections on the Card tab", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByTestId("description-section")).toBeInTheDocument();
    });
    expect(screen.getByTestId("lifecycle-section")).toBeInTheDocument();
    expect(screen.getByTestId("relations-section")).toBeInTheDocument();
  });

  it("enters inline title edit mode when the edit pencil is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });

    // The header row contains the title plus an edit pencil. There are several "Edit" buttons
    // on the page (each section has one), so we scope to the one next to the title.
    const heading = screen.getByText("My Application");
    const editBtn = heading.parentElement!.querySelector(
      "button[aria-label='Edit']",
    ) as HTMLElement;
    expect(editBtn).toBeTruthy();

    await user.click(editBtn);

    // TextField with the current value should now be visible
    const input = screen.getByDisplayValue("My Application");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("saves the new title via api.patch and exits edit mode", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });
    vi.mocked(api.patch).mockResolvedValueOnce({ ...mockCard, name: "Renamed App" });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });

    const heading = screen.getByText("My Application");
    const editBtn = heading.parentElement!.querySelector(
      "button[aria-label='Edit']",
    ) as HTMLElement;
    await user.click(editBtn);

    const input = screen.getByDisplayValue("My Application");
    await user.clear(input);
    await user.type(input, "Renamed App");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/cards/card-1", { name: "Renamed App" });
    });
    await waitFor(() => {
      expect(screen.getByText("Renamed App")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("Renamed App")).not.toBeInTheDocument();
  });

  it("cancels inline title edit without calling api.patch", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });

    const heading = screen.getByText("My Application");
    const editBtn = heading.parentElement!.querySelector(
      "button[aria-label='Edit']",
    ) as HTMLElement;
    await user.click(editBtn);

    const input = screen.getByDisplayValue("My Application");
    await user.clear(input);
    await user.type(input, "Should not stick");

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(api.patch).not.toHaveBeenCalled();
    // Original title is still shown
    expect(screen.getByText("My Application")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Should not stick")).not.toBeInTheDocument();
  });

  it("does not show the inline title edit pencil when the user lacks edit permission", async () => {
    const restrictedPerms = {
      effective: { ...mockPerms.effective, can_edit: false },
    };
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(restrictedPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByText("My Application")).toBeInTheDocument();
    });

    const heading = screen.getByText("My Application");
    const editBtn = heading.parentElement!.querySelector("button[aria-label='Edit']");
    expect(editBtn).toBeNull();
  });

  it("switches to Comments tab", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/my-permissions")) return Promise.resolve(mockPerms);
      return Promise.resolve(mockCard);
    });

    renderCardDetail();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /comments/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /comments/i }));

    await waitFor(() => {
      expect(screen.getByTestId("comments-tab")).toBeInTheDocument();
    });
  });
});
