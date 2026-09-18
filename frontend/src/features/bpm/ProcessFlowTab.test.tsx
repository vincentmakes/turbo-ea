import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

/* ── mocks ─────────────────────────────────────────────────────── */

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  isAbortError: () => false,
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
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});
// The element tables resolve the card-type display names for their link
// placeholders ("Link Business Process", never the key).
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    loading: false,
    types: [],
    relationTypes: [],
    getType: (key: string) =>
      ({
        BusinessProcess: { key, label: "Business Process", translations: {} },
        Application: { key, label: "Application", translations: {} },
        DataObject: { key, label: "Data Object", translations: {} },
        ITComponent: { key, label: "IT Component", translations: {} },
      })[key],
    getRelationsForType: () => [],
    invalidateCache: () => undefined,
  }),
}));

import { api } from "@/api/client";
import ProcessFlowTab from "./ProcessFlowTab";

const mockPerms = {
  can_view_drafts: true,
  can_edit_draft: true,
  can_approve: true,
  // Off by default here, matching a stock instance: controlled publishing is
  // opt-in and no seeded role holds the withdraw permission.
  can_withdraw: false,
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
  {
    id: "el2",
    name: "Order received",
    element_type: "startEvent",
    event_definition_type: "message",
    definition_name: "Customer Order",
    lane_name: "Sales",
    is_automated: false,
    custom_fields: {},
    bpmn_element_id: "start_1",
    sequence_order: 1,
  },
  {
    id: "el3",
    name: "Order record",
    element_type: "dataObjectReference",
    lane_name: null,
    is_automated: false,
    custom_fields: {},
    bpmn_element_id: "do_1",
    sequence_order: 2,
  },
];

const mockMessageFlows = [
  {
    id: "mf1",
    process_id: "proc-1",
    bpmn_element_id: "MessageFlow_1",
    name: "Order",
    source_ref: "Task_Send",
    target_ref: "Participant_Supplier",
    source_name: "Send order",
    target_name: "Supplier",
    sequence_order: 0,
    interface_id: null,
    interface_name: null,
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
    if (url.includes("/message-flows")) return Promise.resolve(mockMessageFlows);
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
      // Two mock steps sit in the Sales lane.
      expect(screen.getAllByText("Sales").length).toBeGreaterThan(0);
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

  describe("Organization links (m:n)", () => {
    function mockWithOrgs(elements = mockElements) {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
        if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
        if (url.includes("/elements")) return Promise.resolve(elements);
        if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
        if (url.includes("/flow/archived")) return Promise.resolve(mockArchived);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
    }

    const elementWithOrgs = {
      ...mockElements[0],
      organizations: [
        { id: "org-1", name: "Sales Department" },
        { id: "org-2", name: "Finance Dept" },
      ],
    };

    it("shows an Organization column in the elements table", async () => {
      mockWithOrgs();
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Organization")).toBeInTheDocument();
      });
    });

    it("orders the link columns Organization, Application, Data Object, IT Component, Business Process", async () => {
      // Organization sits ahead of the card links a step supports, and the
      // process a step hands over to reads last — the order the user asked for.
      mockWithOrgs();
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Organization")).toBeInTheDocument();
      });
      // The info glyph is text in the DOM (a Material Symbols ligature), so
      // strip it before reading the header label.
      const headers = screen.getAllByRole("columnheader").map((h) => {
        const clone = h.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".material-symbols-outlined").forEach((n) => n.remove());
        return clone.textContent?.trim();
      });
      const from = headers.indexOf("Organization");
      expect(from).toBeGreaterThan(0);
      expect(headers.slice(from)).toEqual([
        "Organization",
        "Application",
        "Data Object",
        "IT Component",
        "Business Process",
      ]);
      expect(headers[headers.length - 1]).toBe("Business Process");
    });

    it("shows the highlighted informative-only note above the table", async () => {
      mockWithOrgs();
      renderTab();
      await waitFor(() => {
        expect(
          screen.getByText(/informative only and independent of card relationships/)
        ).toBeInTheDocument();
      });
    });

    it("shows one chip per linked organization on a step", async () => {
      mockWithOrgs([elementWithOrgs]);
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Sales Department")).toBeInTheDocument();
        expect(screen.getByText("Finance Dept")).toBeInTheDocument();
      });
    });

    it("removing a chip sends the remaining organization_ids", async () => {
      mockWithOrgs([elementWithOrgs]);
      vi.mocked(api.put).mockResolvedValue({ id: "el1", status: "updated" });
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Sales Department")).toBeInTheDocument();
      });
      const chip = screen.getByText("Sales Department").closest(".MuiChip-root")!;
      const deleteIcon = chip.querySelector(".MuiChip-deleteIcon");
      expect(deleteIcon).not.toBeNull();
      await userEvent.click(deleteIcon as Element);
      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith(
          "/bpm/processes/proc-1/elements/el1",
          { organization_ids: ["org-2"] },
        );
      });
    });
  });

  describe("Business Process column (a step → the process it hands over to)", () => {
    const CALLEE = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";
    const callActivity = {
      id: "el4",
      name: "Run Credit Check",
      element_type: "callActivity",
      lane_name: "Finance",
      is_automated: false,
      custom_fields: {},
      bpmn_element_id: "call_1",
      called_element: CALLEE,
      business_process_id: CALLEE,
      business_process_name: "Credit Check",
    };

    function mockWith(elements: unknown[]) {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
        if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
        if (url.includes("/message-flows")) return Promise.resolve([]);
        if (url.includes("/elements")) return Promise.resolve(elements);
        if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
        if (url.includes("/flow/archived")) return Promise.resolve(mockArchived);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
    }

    it("offers the link on every step — a task included — and a dash on an artefact", async () => {
      // el1 is a task, el3 a data object reference.
      mockWith([mockElements[0], mockElements[2], callActivity]);
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Business Process")).toBeInTheDocument();
        expect(screen.getByText("Credit Check")).toBeInTheDocument();
      });
      // The placeholder carries the type's display name, not its key. The
      // task row offers it; the data object row is not a step at all.
      expect(screen.getAllByText("Link Business Process")).toHaveLength(1);
      const artefactRow = document.querySelector('tr[data-artefact="true"]')!;
      expect(within(artefactRow as HTMLElement).queryByText("Link Business Process")).toBeNull();
    });

    it("links a plain task the same way as a call activity", async () => {
      mockWith([mockElements[0]]);
      vi.mocked(api.put).mockResolvedValue({ id: "el1", status: "updated" });
      renderTab();
      await waitFor(() => expect(screen.getByText("Link Business Process")).toBeInTheDocument());
      // The cell opens the same CardPicker every other link column opens.
      await userEvent.click(screen.getByText("Link Business Process"));
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("drills down into the linked process's flow when the chip is clicked", async () => {
      mockWith([callActivity]);
      renderTab();
      await waitFor(() => expect(screen.getByText("Credit Check")).toBeInTheDocument());
      await userEvent.click(screen.getByText("Credit Check"));
      expect(mockNavigate).toHaveBeenCalledWith(`/cards/${CALLEE}?tab=1`);
    });

    it("removing the chip clears the link", async () => {
      mockWith([callActivity]);
      vi.mocked(api.put).mockResolvedValue({ id: "el4", status: "updated" });
      renderTab();
      await waitFor(() => expect(screen.getByText("Credit Check")).toBeInTheDocument());
      const chip = screen.getByText("Credit Check").closest(".MuiChip-root")!;
      await userEvent.click(chip.querySelector(".MuiChip-deleteIcon") as Element);
      await waitFor(() => {
        expect(api.put).toHaveBeenCalledWith("/bpm/processes/proc-1/elements/el4", {
          business_process_id: "",
        });
      });
    });

    it("shows a foreign reference from an imported diagram as a hint beside the link affordance", async () => {
      mockWith([
        {
          ...callActivity,
          called_element: "Process_CreditCheck",
          business_process_id: null,
          business_process_name: null,
        },
      ]);
      renderTab();
      await waitFor(() => {
        expect(screen.getByText("Link Business Process")).toBeInTheDocument();
        expect(screen.getByText("references Process_CreditCheck")).toBeInTheDocument();
      });
    });
  });

  it("hides Drafts and Archived tabs when no draft access", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("/flow/permissions"))
        return Promise.resolve({
          can_view_drafts: false,
          can_edit_draft: false,
          can_approve: false,
          can_withdraw: false,
        });
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

  // ── Withdrawal (discussion #916) ────────────────────────────────────
  describe("withdrawing a published flow", () => {
    function mockWithdrawPerms() {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions"))
          return Promise.resolve({ ...mockPerms, can_withdraw: true });
        if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
        if (url.includes("/elements")) return Promise.resolve(mockElements);
        if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
        if (url.includes("/flow/archived")) return Promise.resolve(mockArchived);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
    }

    it("hides the Withdraw button when can_withdraw is false", async () => {
      renderTab();
      await waitForLoad();
      expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
    });

    it("shows the Withdraw button when can_withdraw is true", async () => {
      mockWithdrawPerms();
      renderTab();
      await waitForLoad();
      expect(await screen.findByRole("button", { name: /Withdraw/ })).toBeInTheDocument();
    });

    it("keeps the confirm button disabled until a long enough reason is given", async () => {
      mockWithdrawPerms();
      renderTab();
      await waitForLoad();
      await userEvent.click(await screen.findByRole("button", { name: /Withdraw/ }));

      const dialog = await screen.findByRole("dialog");
      const confirm = within(dialog).getByRole("button", { name: /^Withdraw$/ });
      expect(confirm).toBeDisabled();

      // Whitespace is not a reason, and neither is anything under 10 chars.
      await userEvent.type(within(dialog).getByLabelText(/Reason/), "   too short   ");
      expect(confirm).toBeDisabled();

      await userEvent.clear(within(dialog).getByLabelText(/Reason/));
      await userEvent.type(
        within(dialog).getByLabelText(/Reason/),
        "Approved by mistake, wrong revision",
      );
      expect(confirm).toBeEnabled();
    });

    it("posts the trimmed reason to the withdraw endpoint", async () => {
      mockWithdrawPerms();
      vi.mocked(api.post).mockResolvedValue({});
      renderTab();
      await waitForLoad();
      await userEvent.click(await screen.findByRole("button", { name: /Withdraw/ }));

      const dialog = await screen.findByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText(/Reason/),
        "  Approved by mistake, wrong revision  ",
      );
      await userEvent.click(within(dialog).getByRole("button", { name: /^Withdraw$/ }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith(
          "/bpm/processes/proc-1/flow/versions/v1/withdraw",
          { reason: "Approved by mistake, wrong revision" },
        );
      });
    });

    it("renders a withdrawn version in the Archived tab with its reason", async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions")) return Promise.resolve(mockPerms);
        // No published flow left once the only published revision was withdrawn.
        if (url.includes("/flow/published")) return Promise.resolve(null);
        if (url.includes("/elements")) return Promise.resolve(mockElements);
        if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
        if (url.includes("/flow/archived"))
          return Promise.resolve([
            {
              id: "w1",
              revision: 3,
              status: "withdrawn",
              approved_by_name: "Admin",
              approved_at: "2025-06-01T10:00:00Z",
              withdrawn_by_name: "Quality Lead",
              withdrawn_at: "2025-07-01T10:00:00Z",
              withdrawal_reason: "Approved by mistake, wrong revision",
            },
          ]);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
      renderTab();
      await waitForLoad();
      await userEvent.click(screen.getByText("Archived"));

      expect(await screen.findByText("Withdrawn")).toBeInTheDocument();
      expect(screen.getByText(/Quality Lead/)).toBeInTheDocument();
      expect(
        screen.getByText(/Approved by mistake, wrong revision/),
      ).toBeInTheDocument();
    });
  });

  describe("element types, artefacts and message flows", () => {
    it("renders the element type as a translated label with its event definition", async () => {
      renderTab();
      await waitForLoad();
      expect(screen.getByText("Task")).toBeInTheDocument();
      expect(screen.getByText("Start event")).toBeInTheDocument();
      expect(screen.getByText(/Message: Customer Order/)).toBeInTheDocument();
      // The raw parser strings never reach the screen.
      expect(screen.queryByText("startEvent")).not.toBeInTheDocument();
    });

    it("renders a data object row with only the Data Object cell editable", async () => {
      renderTab();
      await waitForLoad();
      const row = screen.getByText("Order record").closest("tr")!;
      expect(row).toHaveAttribute("data-artefact", "true");
      // Automated / TCode / Application / IT Component / Organization are dashed out…
      expect(within(row).getAllByText("\u2014").length).toBeGreaterThanOrEqual(5);
      // …and the row still offers the Data Object link.
      expect(within(row).getByText("Link Data Object")).toBeInTheDocument();
      // A step row keeps its Application link.
      const step = screen.getByText("Create Order").closest("tr")!;
      expect(within(step).getByText("SAP")).toBeInTheDocument();
    });

    it("lists the message flows and PATCHes the Interface link", async () => {
      vi.mocked(api.patch).mockResolvedValue({ ...mockMessageFlows[0], interface_id: "if1", interface_name: "Order API" });
      renderTab();
      await waitForLoad();
      const table = await screen.findByTestId("message-flows-table");
      expect(within(table).getByText("Message flows")).toBeInTheDocument();
      expect(within(table).getByText("Order")).toBeInTheDocument();
      expect(within(table).getByText("Send order")).toBeInTheDocument();
      expect(within(table).getByText("Supplier")).toBeInTheDocument();
      // Editable: the link affordance is offered when the viewer may edit.
      expect(within(table).getByText("Link Interface")).toBeInTheDocument();
    });

    it("offers no Interface link when the viewer cannot edit", async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes("/flow/permissions"))
          return Promise.resolve({ ...mockPerms, can_edit_draft: false });
        if (url.includes("/flow/published")) return Promise.resolve(mockPublished);
        if (url.includes("/message-flows")) return Promise.resolve(mockMessageFlows);
        if (url.includes("/elements")) return Promise.resolve(mockElements);
        if (url.includes("/flow/drafts")) return Promise.resolve(mockDrafts);
        if (url.includes("/flow/archived")) return Promise.resolve(mockArchived);
        return Promise.reject(new Error(`no mock for ${url}`));
      });
      renderTab();
      await waitForLoad();
      const table = await screen.findByTestId("message-flows-table");
      expect(within(table).queryByText("Link Interface")).not.toBeInTheDocument();
    });
  });
});
