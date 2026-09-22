import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
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
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES } from "@/lib/attachmentFormats";
import ResourcesTab from "./ResourcesTab";

const CARD_ID = "card-123";

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

function renderTab(props?: {
  canManageDocuments?: boolean;
  canManageDiagramLinks?: boolean;
}) {
  return render(
    <MemoryRouter>
      <ResourcesTab
        fsId={CARD_ID}
        canManageDocuments={props?.canManageDocuments ?? true}
        canManageDiagramLinks={props?.canManageDiagramLinks ?? true}
      />
    </MemoryRouter>,
  );
}

const mockDiagrams = [
  {
    id: "diag-1",
    name: "System Overview",
    card_ids: [CARD_ID],
    card_count: 3,
    updated_at: "2025-11-01T10:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === `/cards/${CARD_ID}/file-attachments`) return Promise.resolve(mockFiles);
    if (url === `/cards/${CARD_ID}/documents`) return Promise.resolve(mockDocs);
    if (url === `/diagrams?card_id=${CARD_ID}`) return Promise.resolve(mockDiagrams);
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("ResourcesTab", () => {
  it("renders the three accordion sections", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/File Attachments/)).toBeInTheDocument();
      expect(screen.getByText(/Document Links/)).toBeInTheDocument();
      expect(screen.getByText(/Diagrams/)).toBeInTheDocument();
    });
  });

  it("no longer renders the Architecture Decisions section", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/File Attachments/)).toBeInTheDocument();
    });
    // ADRs moved to their own card tab — see AdrsTab.
    expect(screen.queryByText(/Architecture Decisions/)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(`/adr/by-card/${CARD_ID}`);
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

  it("displays linked diagrams", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("System Overview")).toBeInTheDocument();
    });
  });

  it("fetches data on mount including diagrams", async () => {
    renderTab();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(`/cards/${CARD_ID}/file-attachments`);
      expect(api.get).toHaveBeenCalledWith(`/cards/${CARD_ID}/documents`);
      expect(api.get).toHaveBeenCalledWith(`/diagrams?card_id=${CARD_ID}`);
    });
  });

  /* ── upload gates ─────────────────────────────────────────────
   * The backend is the authority (it checks the bytes); these only spare the
   * user a round-trip on a file it is certain to refuse.
   */

  function fileOfSize(name: string, size: number): File {
    const file = new File(["x"], name);
    Object.defineProperty(file, "size", { value: size });
    return file;
  }

  async function selectFile(file: File) {
    const { container } = renderTab();
    await waitFor(() => expect(screen.getByText(/File Attachments/)).toBeInTheDocument());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    return input;
  }

  it("offers every accepted extension in the file picker", async () => {
    const { container } = renderTab();
    await waitFor(() => expect(screen.getByText(/File Attachments/)).toBeInTheDocument());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe(ATTACHMENT_ACCEPT);
    // The formats this change added must really be offered.
    expect(input.getAttribute("accept")).toContain(".zip");
    expect(input.getAttribute("accept")).toContain(".msg");
    expect(input.getAttribute("accept")).toContain(".odt");
  });

  it("refuses a file over the size cap without calling the API", async () => {
    await selectFile(fileOfSize("huge.pdf", MAX_ATTACHMENT_BYTES + 1));
    await waitFor(() => expect(screen.getByText(/exceeds maximum size/i)).toBeInTheDocument());
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly the cap", async () => {
    await selectFile(fileOfSize("big.pdf", MAX_ATTACHMENT_BYTES));
    // No complaint — the upload dialog opens instead.
    await waitFor(() => expect(screen.queryByText(/exceeds maximum size/i)).toBeNull());
  });

  it("refuses an extension that is not accepted, before uploading", async () => {
    // `accept=` is advisory: a drag-drop or an "All files" pick bypasses it.
    await selectFile(fileOfSize("setup.exe", 1024));
    await waitFor(() => expect(screen.getByText(/not allowed/i)).toBeInTheDocument());
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("shows the reason the backend gave when an upload is rejected", async () => {
    // A generic "upload failed" hides the one thing the user can act on.
    vi.mocked(api.upload).mockRejectedValueOnce(
      new Error("File content does not match its '.pdf' extension."),
    );
    await selectFile(fileOfSize("invoice.pdf", 2048));
    const confirm = await screen.findByRole("button", { name: /upload/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByText(/does not match its '.pdf' extension/i)).toBeInTheDocument(),
    );
  });

  it("shows empty state when no data", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/No file attachments/)).toBeInTheDocument();
    });
  });
});
