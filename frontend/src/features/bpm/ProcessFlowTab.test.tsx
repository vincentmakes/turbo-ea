import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("./BpmnViewer", () => ({
  default: ({ bpmnXml }: any) => <div data-testid="bpmn-viewer">{bpmnXml ? "BPMN loaded" : ""}</div>,
}));
vi.mock("./BpmnTemplateChooser", () => ({
  default: ({ open, onClose, onSelect }: any) =>
    open ? (
      <div data-testid="template-chooser">
        <button onClick={() => onSelect("<xml>test</xml>")}>Pick Template</button>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));
vi.mock("dompurify", () => ({
  default: { sanitize: (html: string) => html },
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

import { api } from "@/api/client";
import ProcessFlowTab from "./ProcessFlowTab";

const mockPerms = {
  can_view_drafts: true,
  can_edit_draft: true,
  can_approve: true,
};

const mockPublished = {
  id: "v1",
  revision: 3,
  status: "published",
  bpmn_xml: "<xml>bpmn</xml>",
  svg_thumbnail: "<svg></svg>",
  approved_by_name: "Admin User",
  approved_at: "2025-06-01T10:00:00Z",
  created_by_name: "Author",
  created_at: "2025-05-20T10:00:00Z",
};

const mockElements = [
  {
    id: "el1",
    name: "Create Order",
    element_type: "task",
    lane_name: "Sales",
    is_automated: false,
    application_name: "SAP",
    data_object_name: null,
    it_component_name: null,
    custom_fields: {},
    bpmn_element_id: "task_1",
  },
];

const mockDrafts = [
  {
    id: "d1",
    revision: 4,
    status: "draft",
    bpmn_xml: "",
    svg_thumbnail: "<svg>preview</svg>",
    created_by_name: "Dev User",
    created_at: "2025-06-15T10:00:00Z",
  },
  {
    id: "d2",
    revision: 5,
    status: "pending",
    bpmn_xml: "",
    svg_thumbnail: "",
    created_by_name: "Dev User",
    created_at: "2025-06-16T10:00:00Z",
    submitted_by_name: "Dev User",
  },
];

const mockArchived = [
  {
    id: "a1",
    revision: 2,
    status: "archived",
    approved_by_name: "Admin",
    approved_at: "2025-04-01T10:00:00Z",
    archived_at: "2025-06-01T10:00:00Z",
  },
];

function renderTab(props = {}) {
  return render(
    <MemoryRouter>
      <ProcessFlowTab processId="proc-1" processName="Order Process" {...props} />
    </MemoryRouter>,
  );
}

/** Helper: wait for the initial load to finish (Drafts tab appears) */
async function waitForLoad() {
  await waitFor(() => {
    expect(screen.getByText("Drafts")).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
    if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
    if (url.includes("/elements")) return Promise.resolve(mockElements);
    if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
    if (url.includes("/flow/archived")) return Promise.resolve(mockArchived);
    return Promise.reject(new Error(`no mock for ${url}`));
  });
});

describe("ProcessFlowTab", () => {
  it("shows Published tab by default", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("Published")).toBeInTheDocument();
    });
  });

  it("shows all three tabs when user has draft access", async () => {
    renderTab();
    await waitForLoad();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Drafts")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("shows approval watermark for published version", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
  });

  it("renders BPMN viewer for published version", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByTestId("bpmn-viewer")).toBeInTheDocument();
      expect(screen.getByText("BPMN loaded")).toBeInTheDocument();
    });
  });

  it("shows process elements table", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("Process Steps & Elements")).toBeInTheDocument();
      expect(screen.getByText("Create Order")).toBeInTheDocument();
      expect(screen.getByText("Sales")).toBeInTheDocument();
    });
  });

  it("shows action buttons for published version", async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("Create New Draft from This")).toBeInTheDocument();
      expect(screen.getByText("View Full Size")).toBeInTheDocument();
      expect(screen.getByText("Print / PDF")).toBeInTheDocument();
    });
  });

  it("shows empty state when no published version", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
      if (url.includes("/flow/published")) return Promise.resolve(null);
      if (url.includes("/elements")) return Promise.resolve([]);
      if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
      return Promise.reject(new Error(`no mock for ${url}`));
    });
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("No published process flow yet")).toBeInTheDocument();
      expect(screen.getByText(/2 drafts available/)).toBeInTheDocument();
    });
  });

  it("shows empty state with no drafts available", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
      if (url.includes("/flow/published")) return Promise.resolve(null);
      if (url.includes("/elements")) return Promise.resolve([]);
      if (url.includes("/flow/drafts")) return Promise.resolve([]);
      return Promise.reject(new Error(`no mock for ${url}`));
    });
    renderTab();
    await waitFor(() => {
      expect(screen.getByText("No published process flow yet")).toBeInTheDocument();
      expect(screen.getByText("New Draft from Template")).toBeInTheDocument();
    });
  });

  describe("Drafts tab", () => {
    it("shows draft list", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("Revision 4")).toBeInTheDocument();
        expect(screen.getByText("Revision 5")).toBeInTheDocument();
      });
    });

    it("shows draft status chips", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("draft")).toBeInTheDocument();
        expect(screen.getByText("pending")).toBeInTheDocument();
      });
    });

    it("shows edit/submit/delete buttons for draft", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("Edit")).toBeInTheDocument();
        expect(screen.getByText("Submit")).toBeInTheDocument();
        expect(screen.getByText("Delete")).toBeInTheDocument();
      });
    });

    it("shows approve/reject for pending draft", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("Approve")).toBeInTheDocument();
        expect(screen.getByText("Reject")).toBeInTheDocument();
      });
    });

    it("shows confirmation dialog for submit action", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("Submit")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByText("Submit"));

      expect(screen.getByText("Submit for Approval?")).toBeInTheDocument();
    });

    it("shows empty state when no drafts", async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
        if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
        if (url.includes("/elements")) return Promise.resolve(mockElements);
        if (url.includes("/flow/drafts")) return Promise.resolve([]);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Drafts")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("No draft process flows.")).toBeInTheDocument();
      });
    });

    it("has New Draft from Template button", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Drafts"));

      await waitFor(() => {
        expect(screen.getByText("New Draft from Template")).toBeInTheDocument();
      });
    });
  });

  describe("Archived tab", () => {
    it("shows archived versions", async () => {
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Archived"));

      await waitFor(() => {
        expect(screen.getByText("Revision 2")).toBeInTheDocument();
      });
    });

    it("shows empty state when no archived", async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
        if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
        if (url.includes("/elements")) return Promise.resolve(mockElements);
        if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
        if (url.includes("/flow/archived")) return Promise.resolve([]);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Archived"));

      await waitFor(() => {
        expect(screen.getByText("No archived process flows.")).toBeInTheDocument();
      });
    });
  });

  it("hides Drafts and Archived tabs when no draft access", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("/flow/permissions"))
        return Promise.resolve({ can_view_drafts: false, can_edit_draft: false, can_approve: false });
      if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
      if (url.includes("/elements")) return Promise.resolve(mockElements);
      return Promise.reject(new Error(`no mock for ${url}`));
    });
    renderTab();
    // Wait for published content to load (confirms load is done)
    await waitFor(() => {
      expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    });
    expect(screen.queryByText("Drafts")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });
});
