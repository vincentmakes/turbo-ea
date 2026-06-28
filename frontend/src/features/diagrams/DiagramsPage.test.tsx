import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/* ── mocks ─────────────────────────────────────────────────────── */

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      { key: "Initiative", label: "Initiative", icon: "rocket_launch", color: "#33cc58" },
      { key: "Application", label: "Application", icon: "apps", color: "#0f7eb5" },
    ],
    relationTypes: [],
    loading: false,
  }),
}));
vi.mock("@/hooks/useDateFormat", () => ({
  useDateFormat: () => ({ formatDate: (iso: string) => iso }),
}));
// Group dialogs are exercised separately; stub them. The assign stub exposes
// a button so we can drive its onSaved callback and assert the gallery updates.
vi.mock("./ManageGroupsDialog", () => ({ default: () => null }));
vi.mock("./AssignGroupsDialog", () => ({
  default: ({ open, onSaved }: { open: boolean; onSaved: (ids: string[]) => void }) =>
    open ? (
      <button onClick={() => onSaved(["s1"])}>stub-assign-save</button>
    ) : null,
}));

import { api } from "@/api/client";
import DiagramsPage from "./DiagramsPage";

const diagrams = [
  {
    id: "d1",
    name: "Architecture Overview",
    description: "High-level system diagram",
    card_ids: ["i1"],
    group_ids: [],
    card_count: 5,
    created_by_name: "Ada Admin",
    is_favorite: false,
    updated_at: "2025-06-10T10:00:00Z",
  },
  {
    id: "d2",
    name: "Data Flow Map",
    description: "",
    card_ids: [],
    group_ids: [],
    card_count: 0,
    created_by_name: "Mel Member",
    is_favorite: false,
    updated_at: "2025-06-08T10:00:00Z",
  },
];

const cards = {
  items: [
    { id: "i1", name: "Digital Transformation", type: "Initiative" },
    { id: "a1", name: "NexaCore ERP", type: "Application" },
  ],
};

function setupApi(diagramRows = diagrams) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith("/diagram-groups")) return Promise.resolve([] as never);
    if (url.startsWith("/diagrams")) return Promise.resolve(diagramRows as never);
    if (url.startsWith("/cards")) return Promise.resolve(cards as never);
    return Promise.reject(new Error(`no mock for ${url}`));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DiagramsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setupApi();
  vi.mocked(api.post).mockResolvedValue({} as never);
  vi.mocked(api.delete).mockResolvedValue(undefined as never);
});

describe("DiagramsPage", () => {
  it("shows page title and diagram count", async () => {
    renderPage();
    expect(screen.getByText("Diagrams")).toBeInTheDocument();
    // Header count chip (also appears as the Ungrouped group count once loaded).
    await waitFor(() => {
      expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders New Diagram button", () => {
    renderPage();
    expect(screen.getByText("New Diagram")).toBeInTheDocument();
  });

  it("shows diagram names grouped under Ungrouped", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
      expect(screen.getByText("Data Flow Map")).toBeInTheDocument();
    });
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
  });

  it("shows the author on the card", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Ada Admin/)).toBeInTheDocument();
    });
  });

  it("shows empty state when no diagrams", async () => {
    setupApi([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No diagrams yet. Create one to get started.")).toBeInTheDocument();
    });
  });

  it("opens create dialog and creates diagram", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "new-id" } as never);
    renderPage();

    await userEvent.click(screen.getByText("New Diagram"));
    expect(screen.getByText("New Diagram", { selector: "h2" })).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Name");
    await userEvent.type(nameInput, "New Test Diagram");

    const dialog = screen.getByRole("dialog");
    const createBtn = within(dialog).getByRole("button", { name: "Create" });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/diagrams",
        expect.objectContaining({ name: "New Test Diagram" }),
      );
      expect(mockNavigate).toHaveBeenCalledWith("/diagrams/new-id/edit");
    });
  });

  it("navigates to diagram on card click", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Architecture Overview"));
    expect(mockNavigate).toHaveBeenCalledWith("/diagrams/d1");
  });

  it("'Created by me' sidebar filter requests mine=true", async () => {
    renderPage();
    await screen.findByText("Architecture Overview");

    await userEvent.click(screen.getByText("Created by me"));

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("/diagrams") && u.includes("mine=true"))).toBe(true);
    });
  });

  it("typing in the search box issues a search request", async () => {
    renderPage();
    await screen.findByText("Architecture Overview");

    await userEvent.type(screen.getByPlaceholderText(/Search by name/i), "payment");

    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => u.includes("search=payment"))).toBe(true);
    });
  });

  it("collapses to a rail and expands again via the sidebar chevron", async () => {
    renderPage();
    await screen.findByText("Architecture Overview");
    // Sidebar is shown inline (expanded) on desktop.
    expect(screen.getByText("Created by me")).toBeInTheDocument();

    // Collapse via the header chevron — content disappears, rail remains.
    const collapseBtn = screen.getByText("chevron_left").closest("button") as HTMLElement;
    await userEvent.click(collapseBtn);
    expect(screen.queryByText("Created by me")).not.toBeInTheDocument();

    // Expand again via the rail chevron.
    const expandBtn = screen.getByText("chevron_right").closest("button") as HTMLElement;
    await userEvent.click(expandBtn);
    expect(screen.getByText("Created by me")).toBeInTheDocument();
  });

  it("clicking a card's star favorites the diagram", async () => {
    renderPage();
    await screen.findByText("Architecture Overview");

    // The card star button's text is exactly "star"; the sidebar "Favorites"
    // button also has a star glyph but reads "starFavorites".
    const cardStar = screen
      .getAllByText("star")
      .map((el) => el.closest("button"))
      .find((b) => b && b.textContent === "star");
    expect(cardStar).toBeTruthy();

    await userEvent.click(cardStar as HTMLElement);

    await waitFor(() => {
      const calls = vi.mocked(api.post).mock.calls.map((c) => c[0] as string);
      expect(calls.some((u) => /\/diagrams\/d\d\/favorite/.test(u))).toBe(true);
    });
  });

  it("shows the group immediately after assigning, without a refresh", async () => {
    // One group exists; the diagram starts ungrouped.
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/diagram-groups"))
        return Promise.resolve([
          { id: "s1", name: "Domain A", color: null, sort_order: 0, diagram_count: 0 },
        ] as never);
      if (url.startsWith("/diagrams")) return Promise.resolve(diagrams as never);
      if (url.startsWith("/cards")) return Promise.resolve(cards as never);
      return Promise.reject(new Error(`no mock for ${url}`));
    });
    vi.mocked(api.put).mockResolvedValue({} as never);

    renderPage();
    await screen.findByText("Architecture Overview");
    // "Domain A" appears once (the sidebar entry); no gallery group yet.
    expect(screen.getAllByText("Domain A").length).toBe(1);

    // Open the card menu → "Add to groups…" → assign stub.
    const moreButtons = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("span")?.textContent === "more_vert");
    await userEvent.click(moreButtons[0]);
    await userEvent.click(screen.getByText("Add to groups…"));
    await userEvent.click(screen.getByText("stub-assign-save"));

    // The group heading now appears in the gallery too (sidebar + group),
    // in place — no page reload.
    await waitFor(() => {
      expect(screen.getAllByText("Domain A").length).toBe(2);
    });
  });

  it("opens delete dialog and deletes from the context menu", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    });

    const moreButtons = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("span")?.textContent === "more_vert");
    await userEvent.click(moreButtons[0]);
    await userEvent.click(screen.getByText("Delete"));

    expect(screen.getByText("Delete Diagram")).toBeInTheDocument();

    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    await userEvent.click(deleteBtn);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/diagrams/d1");
    });
  });
});
