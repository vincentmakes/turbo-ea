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

import { api } from "@/api/client";
import DiagramsPage from "./DiagramsPage";

const diagrams = [
  {
    id: "d1",
    name: "Architecture Overview",
    description: "High-level system diagram",
    type: "free_draw",
    initiative_ids: ["i1"],
    card_count: 5,
    updated_at: "2025-06-10T10:00:00Z",
  },
  {
    id: "d2",
    name: "Data Flow Map",
    description: "",
    type: "data_flow",
    initiative_ids: [],
    card_count: 0,
    updated_at: "2025-06-08T10:00:00Z",
  },
];

const initiatives = {
  items: [{ id: "i1", name: "Digital Transformation" }],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <DiagramsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === "/diagrams") return Promise.resolve(diagrams);
    if (url.startsWith("/cards?type=Initiative")) return Promise.resolve(initiatives);
    return Promise.reject(new Error("no mock"));
  });
});

describe("DiagramsPage", () => {
  it("shows page title and diagram count", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Diagrams")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("renders New Diagram button", () => {
    renderPage();
    expect(screen.getByText("New Diagram")).toBeInTheDocument();
  });

  it("shows diagram names in card view", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
      expect(screen.getByText("Data Flow Map")).toBeInTheDocument();
    });
  });

  it("shows description for diagrams that have one", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("High-level system diagram")).toBeInTheDocument();
    });
  });

  it("shows type chips", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Free Draw")).toBeInTheDocument();
      expect(screen.getByText("Data Flow")).toBeInTheDocument();
    });
  });

  it("shows card count chips", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("5 cards")).toBeInTheDocument();
    });
  });

  it("shows initiative count chip", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("1 initiative")).toBeInTheDocument();
    });
  });

  it("shows empty state when no diagrams", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/diagrams") return Promise.resolve([]);
      if (url.startsWith("/cards?type=Initiative")) return Promise.resolve({ items: [] });
      return Promise.reject(new Error("no mock"));
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No diagrams yet. Create one to get started.")).toBeInTheDocument();
    });
  });

  it("opens create dialog and creates diagram", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "new-id" });
    renderPage();

    await userEvent.click(screen.getByText("New Diagram"));
    expect(screen.getByText("New Diagram", { selector: "h2" })).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Name");
    await userEvent.type(nameInput, "New Test Diagram");

    const dialog = screen.getByRole("dialog");
    const createBtn = within(dialog).getByRole("button", { name: "Create" });
    await userEvent.click(createBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/diagrams", expect.objectContaining({
        name: "New Test Diagram",
        type: "free_draw",
      }));
      expect(mockNavigate).toHaveBeenCalledWith("/diagrams/new-id");
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

  it("has view toggle buttons", () => {
    renderPage();
    const toggleGroup = screen.getAllByRole("button").filter(
      (b) => b.getAttribute("value") === "card" || b.getAttribute("value") === "list"
    );
    expect(toggleGroup.length).toBe(2);
  });

  it("opens delete dialog from context menu", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    });

    // Click the more_vert button (first one)
    const moreButtons = screen.getAllByRole("button").filter(
      (b) => b.querySelector("span")?.textContent === "more_vert"
    );
    await userEvent.click(moreButtons[0]);

    // Click Delete in the menu
    await userEvent.click(screen.getByText("Delete"));

    // Delete confirmation dialog should appear
    expect(screen.getByText("Delete Diagram")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    expect(screen.getByText("Architecture Overview", { selector: "strong" })).toBeInTheDocument();
  });

  it("handles diagram deletion", async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    });

    const moreButtons = screen.getAllByRole("button").filter(
      (b) => b.querySelector("span")?.textContent === "more_vert"
    );
    await userEvent.click(moreButtons[0]);
    await userEvent.click(screen.getByText("Delete"));

    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    await userEvent.click(deleteBtn);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith("/diagrams/d1");
    });
  });
});
