import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  // The component tells a backend refusal (shown with its reason) from any
  // other failure by `instanceof ApiError`, so the mock must be a real class.
  ApiError: class ApiError extends Error {
    status: number;
    detail: unknown;
    constructor(message: string, status: number, detail: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  },
}));

import { api, ApiError } from "@/api/client";
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

  /* ── document links (#1166) ───────────────────────────────────── */

  async function openAddLinkDialog() {
    renderTab();
    await waitFor(() => expect(screen.getByText("External Wiki")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    const dialog = await screen.findByRole("dialog");
    return within(dialog);
  }

  function typeInto(dialog: ReturnType<typeof within>, label: RegExp, value: string) {
    fireEvent.change(dialog.getByLabelText(label), { target: { value } });
  }

  it("trims the name and URL and posts the link", async () => {
    vi.mocked(api.post).mockResolvedValue({ id: "doc-2" });
    const dialog = await openAddLinkDialog();
    typeInto(dialog, /^name/i, "  Wiki  ");
    typeInto(dialog, /^url/i, "  https://x.example  ");
    fireEvent.click(dialog.getByRole("button", { name: /^add$/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/cards/${CARD_ID}/documents`, {
        name: "Wiki",
        url: "https://x.example",
        type: "documentation",
      }),
    );
    // The list is re-read and the dialog closes.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const docReads = vi
      .mocked(api.get)
      .mock.calls.filter(([url]) => url === `/cards/${CARD_ID}/documents`);
    expect(docReads).toHaveLength(2);
  });

  it("blocks a URL without a scheme and says why, before any request", async () => {
    // This is the 422 of #1166: the backend refuses anything but http(s) and
    // mailto, and the dialog used to find that out only after the click.
    const dialog = await openAddLinkDialog();
    typeInto(dialog, /^name/i, "Intranet wiki");
    typeInto(dialog, /^url/i, "wiki.example.com");
    expect(dialog.getByText(/must use http:\/\/, https:\/\/, or mailto:/i)).toBeInTheDocument();
    const add = dialog.getByRole("button", { name: /^add$/i });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the backend's own reason inside the dialog when the post is refused", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(
      new ApiError("URL must use http://, https://, or mailto: scheme", 422, []),
    );
    const dialog = await openAddLinkDialog();
    typeInto(dialog, /^name/i, "Guide");
    typeInto(dialog, /^url/i, "https://x.example");
    fireEvent.click(dialog.getByRole("button", { name: /^add$/i }));
    await waitFor(() =>
      expect(
        dialog.getByText("URL must use http://, https://, or mailto: scheme"),
      ).toBeInTheDocument(),
    );
    // Still open, so the user can fix it in place.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(/^Failed to link$/)).not.toBeInTheDocument();
  });

  it("forgets what was typed when the dialog is cancelled", async () => {
    const dialog = await openAddLinkDialog();
    typeInto(dialog, /^name/i, "Half typed");
    fireEvent.click(dialog.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add link/i }));
    const reopened = within(await screen.findByRole("dialog"));
    expect((reopened.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("");
  });

  it("edits an existing link through the same dialog and PATCHes it", async () => {
    vi.mocked(api.patch).mockResolvedValue({ id: "doc-1" });
    renderTab();
    await waitFor(() => expect(screen.getByText("External Wiki")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Edit Document Link")).toBeInTheDocument();
    expect((dialog.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("External Wiki");
    expect((dialog.getByLabelText(/^url/i) as HTMLInputElement).value).toBe(
      "https://wiki.example.com",
    );
    typeInto(dialog, /^name/i, "Internal Wiki");
    fireEvent.click(dialog.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/documents/doc-1", {
        name: "Internal Wiki",
        url: "https://wiki.example.com",
        type: "link",
      }),
    );
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("hides the edit and delete actions from a reader without the permission", async () => {
    renderTab({ canManageDocuments: false });
    await waitFor(() => expect(screen.getByText("External Wiki")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("deletes a link after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.delete).mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => expect(screen.getByText("External Wiki")).toBeInTheDocument());
    // The file row above has a Delete of its own; take the link row's.
    const row = screen.getByText("External Wiki").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/documents/doc-1"));
  });

  /* ── diagram unlink (#1166) ───────────────────────────────────── */

  it("unlinks a diagram without navigating to it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.delete).mockResolvedValue(undefined);
    renderTab();
    await waitFor(() => expect(screen.getByText("System Overview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^unlink$/i }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(`/diagrams/diag-1/cards/${CARD_ID}`),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does nothing when the diagram unlink is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTab();
    await waitFor(() => expect(screen.getByText("System Overview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^unlink$/i }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("still opens the diagram when its row is clicked", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("System Overview")).toBeInTheDocument());
    fireEvent.click(screen.getByText("System Overview"));
    expect(navigateMock).toHaveBeenCalledWith("/diagrams/diag-1");
  });
});
