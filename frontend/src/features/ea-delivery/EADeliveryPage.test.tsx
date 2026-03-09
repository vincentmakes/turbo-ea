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
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      {
        key: "Initiative",
        label: "Initiative",
        icon: "rocket_launch",
        color: "#33cc58",
        subtypes: [
          { key: "Program", label: "Program" },
          { key: "Project", label: "Project" },
        ],
      },
    ],
    relationTypes: [],
    loading: false,
  }),
}));

import { api } from "@/api/client";
import EADeliveryPage from "./EADeliveryPage";

const mockInitiatives = {
  items: [
    {
      id: "init-1",
      name: "Cloud Migration",
      type: "Initiative",
      subtype: "Program",
      status: "ACTIVE",
      description: "Migrate to cloud",
      attributes: { initiativeStatus: "onTrack", businessValue: "high" },
    },
    {
      id: "init-2",
      name: "API Gateway",
      type: "Initiative",
      subtype: "Project",
      status: "ACTIVE",
      description: "",
      attributes: {},
    },
  ],
};

const mockDiagrams = [
  {
    id: "diag-1",
    name: "Cloud Architecture",
    type: "free_draw",
    card_ids: ["init-1"],
  },
];

const mockSoaws = [
  {
    id: "soaw-1",
    name: "Cloud Migration SoAW",
    initiative_id: "init-1",
    status: "draft",
    revision_number: 1,
  },
  {
    id: "soaw-2",
    name: "Unlinked Document",
    initiative_id: null,
    status: "approved",
    revision_number: 2,
  },
];

const mockAdrs = [
  {
    id: "adr-1",
    reference_number: "ADR-001",
    title: "Cloud-First Strategy",
    status: "signed",
    signatories: [],
    linked_cards: [{ id: "init-1", name: "Digital Transformation", type: "Initiative" }],
    revision_number: 1,
    created_at: "2025-09-01T10:00:00Z",
  },
  {
    id: "adr-2",
    reference_number: "ADR-002",
    title: "API Gateway Standard",
    status: "draft",
    signatories: [],
    linked_cards: [],
    revision_number: 1,
    created_at: "2025-10-01T10:00:00Z",
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <EADeliveryPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith("/cards?type=Initiative")) return Promise.resolve(mockInitiatives);
    if (url === "/diagrams") return Promise.resolve(mockDiagrams);
    if (url === "/soaw") return Promise.resolve(mockSoaws);
    if (url.startsWith("/adr")) return Promise.resolve(mockAdrs);
    if (url.startsWith("/relations")) return Promise.resolve([]);
    if (url.startsWith("/settings/principles-display"))
      return Promise.resolve({ enabled: false });
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("EADeliveryPage", () => {
  it("shows page title", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("EA Delivery")).toBeInTheDocument();
    });
  });

  it("shows initiative count", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("2 initiatives")).toBeInTheDocument();
    });
  });

  it("renders initiative groups", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
      expect(screen.getByText("API Gateway")).toBeInTheDocument();
    });
  });

  it("shows typed artefact chips on initiative cards", async () => {
    renderPage();
    await waitFor(() => {
      // Cloud Migration has 1 diagram + 1 soaw + 1 adr, shown as typed chips
      expect(screen.getByText("1 SoAW")).toBeInTheDocument();
    });
  });

  it("shows subtype chip on initiative", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Program")).toBeInTheDocument();
    });
  });

  it("shows initiative status chip", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("On Track")).toBeInTheDocument();
    });
  });

  it("shows unlinked artefacts group", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Not linked to an Initiative")).toBeInTheDocument();
    });
  });

  it("shows search field", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search initiatives...")).toBeInTheDocument();
    });
  });

  it("filters initiatives by search", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search initiatives...");
    await userEvent.type(searchInput, "Cloud");

    expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    expect(screen.getByText("1 initiative")).toBeInTheDocument();
  });

  it("opens create SoAW dialog via initiative + button", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    });

    // Click the "+" (create artefact) button on the first initiative card
    const addButtons = screen.getAllByLabelText("Create artefact for this initiative");
    await userEvent.click(addButtons[0]);

    // Pick "New Statement of Architecture Work" from the menu
    await userEvent.click(screen.getByText("New Statement of Architecture Work"));

    expect(
      screen.getByRole("heading", { name: /New Statement of Architecture Work/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Document name")).toBeInTheDocument();
  });

  it("creates a new SoAW via initiative + button", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "new-soaw" });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Cloud Migration")).toBeInTheDocument();
    });

    const addButtons = screen.getAllByLabelText("Create artefact for this initiative");
    await userEvent.click(addButtons[0]);
    await userEvent.click(screen.getByText("New Statement of Architecture Work"));
    await userEvent.type(screen.getByLabelText("Document name"), "Test SoAW");

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/soaw",
        expect.objectContaining({ name: "Test SoAW", initiative_id: "init-1" }),
      );
      expect(mockNavigate).toHaveBeenCalledWith("/ea-delivery/soaw/new-soaw");
    });
  });

  it("shows loading spinner initially", () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows empty state when no data", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith("/cards?type=Initiative")) return Promise.resolve({ items: [] });
      if (url === "/diagrams") return Promise.resolve([]);
      if (url === "/soaw") return Promise.resolve([]);
      if (url.startsWith("/adr")) return Promise.resolve([]);
      if (url.startsWith("/settings/principles-display"))
        return Promise.resolve({ enabled: false });
      return Promise.reject(new Error("no mock"));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No initiatives found/)).toBeInTheDocument();
    });
  });
});
