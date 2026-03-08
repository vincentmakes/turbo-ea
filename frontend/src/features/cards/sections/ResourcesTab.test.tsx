import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));

import { api } from "@/api/client";
import ResourcesTab from "./ResourcesTab";

const CARD_ID = "card-123";

const mockAdrs = [
  {
    id: "adr-1",
    reference_number: "ADR-001",
    title: "Adopt Cloud-First Strategy",
    status: "signed",
    signatories: [],
    linked_cards: [],
    revision_number: 1,
    created_at: "2025-09-01T10:00:00Z",
  },
];

const mockFiles = [
  {
    id: "file-1",
    card_id: CARD_ID,
    name: "architecture.pdf",
    mime_type: "application/pdf",
    size: 204800,
    created_by: "user-1",
    creator_name: "Admin",
    created_at: "2025-10-01T08:00:00Z",
  },
];

const mockDocs = [
  {
    id: "doc-1",
    card_id: CARD_ID,
    name: "External Wiki",
    url: "https://wiki.example.com",
    type: "link",
    created_at: "2025-10-15T12:00:00Z",
  },
];

function renderTab(props?: { canManageDocuments?: boolean; canManageAdrLinks?: boolean }) {
  return render(
    <MemoryRouter>
      <ResourcesTab
        fsId={CARD_ID}
        canManageDocuments={props?.canManageDocuments ?? true}
        canManageAdrLinks={props?.canManageAdrLinks ?? true}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === `/adr/by-card/${CARD_ID}`) return Promise.resolve(mockAdrs);
    if (url === `/cards/${CARD_ID}/file-attachments`) return Promise.resolve(mockFiles);
    if (url === `/cards/${CARD_ID}/documents`) return Promise.resolve(mockDocs);
    if (url.startsWith("/adr")) return Promise.resolve([]);
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("ResourcesTab", () => {
  it("renders three accordion sections", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/Architecture Decisions/)).toBeInTheDocument();
      expect(screen.getByText(/File Attachments/)).toBeInTheDocument();
      expect(screen.getByText(/Document Links/)).toBeInTheDocument();
    });
  });

  it("displays linked ADRs", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("ADR-001")).toBeInTheDocument();
      expect(screen.getByText("Adopt Cloud-First Strategy")).toBeInTheDocument();
    });
  });

  it("displays file attachments with size", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("architecture.pdf")).toBeInTheDocument();
      expect(screen.getByText("200.0 KB")).toBeInTheDocument();
    });
  });

  it("displays document links", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("External Wiki")).toBeInTheDocument();
    });
  });

  it("shows ADR status chip", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("signed")).toBeInTheDocument();
    });
  });

  it("fetches data on mount", async () => {
    renderTab();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(`/adr/by-card/${CARD_ID}`);
      expect(api.get).toHaveBeenCalledWith(`/cards/${CARD_ID}/file-attachments`);
      expect(api.get).toHaveBeenCalledWith(`/cards/${CARD_ID}/documents`);
    });
  });

  it("shows empty state when no data", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/No architecture decisions/)).toBeInTheDocument();
    });
  });
});
