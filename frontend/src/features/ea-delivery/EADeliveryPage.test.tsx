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
    initiative_ids: ["init-1"],
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
    if (url.startsWith("/relations")) return Promise.resolve([]);
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

  it("shows New Statement of Architecture Work button", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("New Statement of Architecture Work")).toBeInTheDocument();
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

  it("shows artefact counts on initiative cards", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("2 artefacts")).toBeInTheDocument(); // Cloud Migration has 1 diagram + 1 soaw
      expect(screen.getByText("0 artefacts")).toBeInTheDocument(); // API Gateway has none
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
      expect(screen.getByText("1 artefact")).toBeInTheDocument();
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

  it("opens create SoAW dialog", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("EA Delivery")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("New Statement of Architecture Work"));

    expect(screen.getByRole("heading", { name: /New Statement of Architecture Work/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Document name")).toBeInTheDocument();
  });

  it("creates a new SoAW", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "new-soaw" });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("EA Delivery")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("New Statement of Architecture Work"));
    await userEvent.type(screen.getByLabelText("Document name"), "Test SoAW");

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/soaw", expect.objectContaining({ name: "Test SoAW" }));
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
      return Promise.reject(new Error("no mock"));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No initiatives found/)).toBeInTheDocument();
    });
  });
});
