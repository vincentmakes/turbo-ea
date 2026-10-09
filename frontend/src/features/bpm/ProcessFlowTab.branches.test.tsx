/**
 * ProcessFlowTab beyond `ProcessFlowTab.test.tsx`: editing every link cell of
 * the published elements table (Organization, Application, Data Object,
 * IT Component, TCode — and the dash an artefact row shows instead), the
 * draft lifecycle actions and their failures, draft previews and the draft
 * pre-link table, the full-screen viewer per status, printing, and the
 * archived tab's re-draft path.
 *
 * The bpmn-js canvas stays stubbed (`BpmnViewer`), and so does the off-screen
 * `NavigatedViewer` the tab imports to render thumbnails and print — the
 * Playwright suite owns real rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("./BpmnViewer", () => ({
  default: ({ bpmnXml }: { bpmnXml: string }) => (
    <div data-testid="bpmn-viewer">{bpmnXml ? `BPMN:${bpmnXml}` : ""}</div>
  ),
}));
vi.mock("./BpmnTemplateChooser", () => ({
  default: ({
    open,
    onClose,
    onSelect,
  }: {
    open: boolean;
    onClose: () => void;
    onSelect: (xml: string) => void;
  }) =>
    open ? (
      <div data-testid="template-chooser">
        <button onClick={() => onSelect("<xml>test</xml>")}>Pick Template</button>
        <button onClick={onClose}>Close chooser</button>
      </div>
    ) : null,
}));

// The off-screen renderer behind thumbnails and print.
const viewerState = vi.hoisted(() => ({ fail: false, svg: "<svg>generated</svg>", imports: 0 }));
vi.mock("bpmn-js/lib/NavigatedViewer", () => ({
  default: class FakeNavigatedViewer {
    async importXML() {
      viewerState.imports += 1;
      if (viewerState.fail) throw new Error("cannot import");
    }
    async saveSVG() {
      return { svg: viewerState.svg };
    }
    destroy() {}
  },
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

import ProcessFlowTab from "./ProcessFlowTab";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType } from "@/test/fixtures/metamodel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE = "/bpm/processes/proc-1";

const PERMS = { can_view_drafts: true, can_edit_draft: true, can_approve: true, can_withdraw: true };

const PUBLISHED = {
  id: "v1",
  revision: 3,
  status: "published",
  bpmn_xml: "<xml>bpmn</xml>",
  svg_thumbnail: "<svg>thumb</svg>",
  approved_by_name: "Admin User",
  approved_at: "2025-06-01T10:00:00Z",
  created_by_name: "Author",
  created_at: "2025-05-20T10:00:00Z",
};

const ELEMENTS = [
  {
    id: "el1",
    bpmn_element_id: "task_1",
    name: "Create Order",
    element_type: "userTask",
    lane_name: "Sales",
    is_automated: true,
    sequence_order: 2,
    custom_fields: { tcode: "VA01" },
    application_id: "app-1",
    application_name: "SAP",
    data_object_id: "do-1",
    data_object_name: "Sales Order",
    it_component_id: "itc-1",
    it_component_name: "Oracle DB",
    organizations: [],
  },
  {
    id: "el2",
    bpmn_element_id: "task_2",
    name: "Check stock",
    element_type: "serviceTask",
    lane_name: null,
    is_automated: false,
    sequence_order: 1,
    custom_fields: {},
  },
  {
    id: "el3",
    bpmn_element_id: "do_1",
    name: "Order record",
    element_type: "dataObjectReference",
    lane_name: null,
    is_automated: false,
    sequence_order: 3,
    custom_fields: {},
    data_object_id: "do-1",
    data_object_name: "Sales Order",
  },
  // Unnamed: never listed.
  {
    id: "el4",
    bpmn_element_id: "gw_1",
    name: "",
    element_type: "exclusiveGateway",
    is_automated: false,
    sequence_order: 0,
    custom_fields: {},
  },
];

const DRAFTS = [
  {
    id: "d1",
    revision: 4,
    status: "draft",
    bpmn_xml: "",
    svg_thumbnail: "<svg data-testid='draft-thumb'></svg>",
    created_by_name: "Dev User",
    created_at: "2025-06-15T10:00:00Z",
    from_withdrawn_revision: 3,
  },
  {
    id: "d2",
    revision: 5,
    status: "pending",
    bpmn_xml: "",
    svg_thumbnail: "",
    created_by_name: null,
    created_at: "2025-06-16T10:00:00Z",
    submitted_by_name: "Dev User",
    submitted_at: "2025-06-16T11:00:00Z",
  },
];

const ARCHIVED = [
  {
    id: "a1",
    revision: 2,
    status: "archived",
    bpmn_xml: "<xml>old</xml>",
    approved_by_name: "Admin",
    approved_at: "2025-04-01T10:00:00Z",
    archived_at: "2025-06-01T10:00:00Z",
  },
  {
    id: "a0",
    revision: 1,
    status: "withdrawn",
    approved_by_name: null,
    withdrawn_by_name: null,
    withdrawal_reason: "Wrong owner recorded",
  },
];

interface Script {
  perms?: unknown;
  published?: unknown;
  elements?: unknown[];
  drafts?: unknown[];
  archived?: unknown[];
}

function script(s: Script = {}) {
  mockApi.on("get", `${BASE}/flow/permissions`, s.perms ?? PERMS);
  mockApi.on("get", `${BASE}/flow/published`, "published" in s ? s.published : PUBLISHED);
  mockApi.on("get", `${BASE}/elements`, s.elements ?? ELEMENTS);
  mockApi.on("get", `${BASE}/message-flows`, []);
  mockApi.on("get", `${BASE}/flow/drafts`, s.drafts ?? DRAFTS);
  mockApi.on("get", `${BASE}/flow/archived`, s.archived ?? ARCHIVED);
  mockApi.on("get", /^\/cards\?/, {
    items: [
      { id: "card-9", name: "Picked Card", type: "Application" },
      { id: "org-9", name: "Finance Org", type: "Organization" },
    ],
    total: 2,
  });
  mockApi.on("put", /\/elements\//, { status: "updated" });
  mockApi.on("put", /\/draft-elements\//, { status: "updated" });
  mockApi.on("post", /.*/, {});
  mockApi.on("delete", /.*/, {});
}

function renderTab(props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ProcessFlowTab processId="proc-1" processName="Order Process" {...props} />
    </MemoryRouter>,
  );
  return user;
}

async function renderPublished() {
  const user = renderTab();
  await screen.findByText("Create Order");
  return user;
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

/** The cells of a row, by column header text. */
function cellOf(row: HTMLElement, column: string): HTMLElement {
  const table = row.closest("table") as HTMLElement;
  const headers = Array.from(table.querySelectorAll("thead th")).map((h) => {
    const clone = h.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".material-symbols-outlined").forEach((n) => n.remove());
    return clone.textContent?.trim();
  });
  const idx = headers.indexOf(column);
  if (idx < 0) throw new Error(`no column ${column}`);
  return row.querySelectorAll("td")[idx] as HTMLElement;
}

async function goToTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("tab", { name }));
}

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel([
    makeCardType({ key: "Application", label: "Application" }),
    makeCardType({ key: "DataObject", label: "Data Object" }),
    makeCardType({ key: "ITComponent", label: "IT Component" }),
    makeCardType({ key: "BusinessProcess", label: "Business Process" }),
    makeCardType({ key: "Organization", label: "Organization" }),
  ]);
  mockNavigate.mockReset();
  viewerState.fail = false;
  viewerState.svg = "<svg>generated</svg>";
  viewerState.imports = 0;
  script();
});

// ---------------------------------------------------------------------------
// Published elements table
// ---------------------------------------------------------------------------

describe("ProcessFlowTab published elements table", () => {
  it("lists named elements in process order with lane, automation and links", async () => {
    await renderPublished();
    const body = screen.getByText("Create Order").closest("tbody") as HTMLElement;
    const names = Array.from(body.querySelectorAll("tr")).map((r) => r.querySelectorAll("td")[1].textContent);
    // Sorted by sequence_order; the unnamed gateway is left out.
    expect(names).toEqual(["Check stock", "Create Order", "Order record"]);

    const order = rowOf("Create Order");
    expect(within(cellOf(order, "Automated")).getByText("Yes")).toBeInTheDocument();
    expect(within(cellOf(order, "TCode")).getByText("VA01")).toBeInTheDocument();
    expect(within(cellOf(order, "Application")).getByText("SAP")).toBeInTheDocument();
    expect(within(cellOf(order, "Data Object")).getByText("Sales Order")).toBeInTheDocument();
    expect(within(cellOf(order, "IT Component")).getByText("Oracle DB")).toBeInTheDocument();

    const stock = rowOf("Check stock");
    expect(cellOf(stock, "Lane")).toHaveTextContent("—");
    expect(within(cellOf(stock, "Automated")).getByText("No")).toBeInTheDocument();
    expect(within(cellOf(stock, "TCode")).getByText("Add")).toBeInTheDocument();
    expect(within(cellOf(stock, "Organization")).getByText("Link Organization")).toBeInTheDocument();
    expect(within(cellOf(stock, "Application")).getByText("Link Application")).toBeInTheDocument();
    expect(within(cellOf(stock, "IT Component")).getByText("Link IT Component")).toBeInTheDocument();
  });

  it("shows a dash on an artefact row for every link but its Data Object", async () => {
    await renderPublished();
    const artefact = rowOf("Order record");
    expect(artefact).toHaveAttribute("data-artefact", "true");
    for (const col of ["Automated", "TCode", "Organization", "Application", "IT Component", "Business Process"]) {
      expect(cellOf(artefact, col)).toHaveTextContent("—");
    }
    expect(within(cellOf(artefact, "Data Object")).getByText("Sales Order")).toBeInTheDocument();
  });

  it("links an application through the card picker and reloads the table", async () => {
    const user = await renderPublished();
    await user.click(within(cellOf(rowOf("Check stock"), "Application")).getByText("Link Application"));
    expect(screen.getByPlaceholderText("Search Application...")).toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: /Picked Card/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el2`)[0].body).toEqual({ application_id: "card-9" }),
    );
    expect(await screen.findByText("Element updated")).toBeInTheDocument();
    // The table re-reads the elements after the write.
    expect(mockApi.callsOf("get", `${BASE}/elements`).length).toBeGreaterThan(1);
  });

  it("reports a failed link update", async () => {
    mockApi.fail("put", /\/elements\//);
    const user = await renderPublished();
    const chip = within(cellOf(rowOf("Create Order"), "IT Component")).getByText("Oracle DB").closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);
    expect(await screen.findByText("Failed to update element")).toBeInTheDocument();
    expect(mockApi.callsOf("put")[0].body).toEqual({ it_component_id: "" });
  });

  it("clears a data object link from its chip", async () => {
    const user = await renderPublished();
    const chip = within(cellOf(rowOf("Create Order"), "Data Object")).getByText("Sales Order").closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el1`)[0].body).toEqual({ data_object_id: "" }),
    );
  });

  it("adds an organization through the picker, and closes the picker on blur", async () => {
    const user = await renderPublished();
    await user.click(within(cellOf(rowOf("Check stock"), "Organization")).getByText("Link Organization"));
    const input = screen.getByPlaceholderText("Search Organization...");
    await user.click(await screen.findByRole("option", { name: /Finance Org/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el2`)[0].body).toEqual({ organization_ids: ["org-9"] }),
    );
    expect(input).not.toBeInTheDocument();

    // Open again and leave without picking.
    await user.click(within(cellOf(rowOf("Check stock"), "Organization")).getByText("Link Organization"));
    await screen.findByPlaceholderText("Search Organization...");
    await user.click(screen.getByText("Process Steps & Elements"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Search Organization...")).toBeNull());
  });

  it("closes an application picker on blur without writing", async () => {
    const user = await renderPublished();
    await user.click(within(cellOf(rowOf("Check stock"), "IT Component")).getByText("Link IT Component"));
    await screen.findByPlaceholderText("Search IT Component...");
    await user.click(screen.getByText("Process Steps & Elements"));
    await waitFor(() => expect(screen.queryByPlaceholderText("Search IT Component...")).toBeNull());
    expect(mockApi.callsOf("put")).toHaveLength(0);
  });

  it("edits a TCode: Enter saves, Escape cancels, blur saves an empty value as cleared", async () => {
    const user = await renderPublished();
    await user.click(within(cellOf(rowOf("Create Order"), "TCode")).getByText("VA01"));
    const box = screen.getByPlaceholderText("e.g. SE16");
    expect(box).toHaveValue("VA01");
    await user.clear(box);
    await user.type(box, " SE16 {Enter}");
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el1`)[0].body).toEqual({ custom_fields: { tcode: "SE16" } }),
    );

    await user.click(within(cellOf(rowOf("Check stock"), "TCode")).getByText("Add"));
    await user.type(screen.getByPlaceholderText("e.g. SE16"), "MM01{Escape}");
    expect(screen.queryByPlaceholderText("e.g. SE16")).toBeNull();
    expect(mockApi.callsOf("put", `${BASE}/elements/el2`)).toHaveLength(0);

    await user.click(within(cellOf(rowOf("Check stock"), "TCode")).getByText("Add"));
    await user.click(screen.getByText("Process Steps & Elements"));
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el2`)[0].body).toEqual({ custom_fields: {} }),
    );
  });

  it("shows a failed elements load as an error in place of the table", async () => {
    mockApi.fail("get", `${BASE}/elements`);
    renderTab();
    expect(await screen.findByText(/Approved/)).toBeInTheDocument();
    expect(screen.getByText(`GET ${BASE}/elements failed`)).toBeInTheDocument();
    expect(screen.queryByText("Process Steps & Elements")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Published actions, full screen, print
// ---------------------------------------------------------------------------

describe("ProcessFlowTab published actions", () => {
  it("creates a new draft from the published version and lands on Drafts", async () => {
    const user = await renderPublished();
    await user.click(screen.getByRole("button", { name: /Create New Draft from This/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)[0].body).toEqual({ bpmn_xml: "", based_on_id: "v1" }),
    );
    expect(await screen.findByRole("button", { name: /Clone Published Version/ })).toBeInTheDocument();
  });

  it("logs a failed clone", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("post", `${BASE}/flow/drafts`);
    const user = await renderPublished();
    await user.click(screen.getByRole("button", { name: /Create New Draft from This/ }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Failed to clone version:", expect.anything()));
    error.mockRestore();
  });

  it("opens the full-size viewer with the approval banner, and closes it", async () => {
    const user = await renderPublished();
    await user.click(screen.getByRole("button", { name: /View Full Size/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Order Process — Revision 3")).toBeInTheDocument();
    expect(dialog.getByText("published")).toBeInTheDocument();
    expect(dialog.getByTestId("bpmn-viewer")).toHaveTextContent("BPMN:<xml>bpmn</xml>");
    expect(dialog.getByRole("button", { name: /Print \/ PDF/ })).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  describe("printing", () => {
    let openSpy: ReturnType<typeof vi.spyOn>;
    let written = "";
    const listeners: Record<string, () => void> = {};
    const printWindow = {
      print: vi.fn(),
      close: vi.fn(),
      document: {
        open: vi.fn(),
        write: (html: string) => {
          written += html;
        },
        close: vi.fn(),
        getElementById: (id: string) => ({
          addEventListener: (_: string, fn: () => void) => {
            listeners[id] = fn;
          },
        }),
      },
    };

    beforeEach(() => {
      written = "";
      printWindow.print.mockReset();
      printWindow.close.mockReset();
      openSpy = vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    });
    afterEach(() => openSpy.mockRestore());

    it("writes a printable page with the rendered diagram and wires its buttons", async () => {
      const user = await renderPublished();
      await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
      await waitFor(() => expect(written).toContain("<svg>generated</svg>"));
      expect(written).toContain("<h1>Order Process</h1>");
      expect(written).toContain("Revision 3 — Approved by Admin User");
      listeners["turbo-print-btn"]();
      expect(printWindow.print).toHaveBeenCalled();
      listeners["turbo-close-btn"]();
      expect(printWindow.close).toHaveBeenCalled();
    });

    it("falls back to the stored thumbnail when the diagram cannot be rendered", async () => {
      viewerState.fail = true;
      script({ published: { ...PUBLISHED, approved_by_name: null } });
      const user = await renderPublished();
      await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
      await waitFor(() => expect(written).toContain("<svg>thumb</svg>"));
      // No approver: the watermark is the bare revision.
      expect(written).toContain("<span>Revision 3</span>");
    });

    it("prints nothing without a diagram to show", async () => {
      viewerState.fail = true;
      script({ published: { ...PUBLISHED, svg_thumbnail: "" } });
      const user = await renderPublished();
      await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
      // `handlePrint` awaits the viewer's import before it reaches the guard;
      // waiting for that call (rather than a fixed sleep) means the guard has
      // run — its rejection and the `return` settle in the same microtask
      // turn, before waitFor's next poll — so the negative assertion is live.
      await waitFor(() => expect(viewerState.imports).toBe(1));
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("prints nothing for a version without XML", async () => {
      script({ published: { ...PUBLISHED, bpmn_xml: "" } });
      const user = await renderPublished();
      expect(screen.queryByTestId("bpmn-viewer")).toBeNull();
      await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
      expect(openSpy).not.toHaveBeenCalled();
    });

    it("stops quietly when the browser blocks the print window", async () => {
      openSpy.mockReturnValue(null);
      const user = await renderPublished();
      await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
      await waitFor(() => expect(openSpy).toHaveBeenCalled());
      expect(written).toBe("");
    });

    it("prints an archived version from its full-screen viewer", async () => {
      const user = renderTab({ initialSubTab: 2 });
      mockApi.on("get", `${BASE}/flow/versions/a1`, ARCHIVED[0]);
      await user.click(await screen.findByText("Revision 2"));
      const dialog = within(await screen.findByRole("dialog"));
      expect(dialog.getByText(/Originally approved by Admin/)).toBeInTheDocument();
      await user.click(dialog.getByRole("button", { name: /Print \/ PDF/ }));
      await waitFor(() => expect(written).toContain("Revision 2 — Approved by Admin"));
    });
  });
});

// ---------------------------------------------------------------------------
// No published version
// ---------------------------------------------------------------------------

describe("ProcessFlowTab without a published flow", () => {
  it("points at the waiting drafts", async () => {
    script({ published: null });
    const user = renderTab();
    expect(await screen.findByText(/2 drafts available\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /View Drafts/ }));
    expect(await screen.findByText("Revision 4")).toBeInTheDocument();
  });

  it("creates a first draft from a template with a generated thumbnail", async () => {
    script({ published: null, drafts: [] });
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: /New Draft from Template/ }));
    await user.click(screen.getByRole("button", { name: "Pick Template" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)[0].body).toEqual({
        bpmn_xml: "<xml>test</xml>",
        svg_thumbnail: "<svg>generated</svg>",
      }),
    );
    expect(screen.queryByTestId("template-chooser")).toBeNull();
    expect(await screen.findByText("No draft process flows.")).toBeInTheDocument();
  });

  it("creates the draft without a thumbnail when rendering fails, and logs a failed create", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    viewerState.fail = true;
    script({ published: null, drafts: [] });
    mockApi.fail("post", `${BASE}/flow/drafts`);
    const user = renderTab();
    await user.click(await screen.findByRole("button", { name: /New Draft from Template/ }));
    await user.click(screen.getByRole("button", { name: "Pick Template" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Failed to create draft:", expect.anything()));
    expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)[0].body).toEqual({
      bpmn_xml: "<xml>test</xml>",
      svg_thumbnail: undefined,
    });
    // The chooser stays open after a failure, and closes on demand.
    await user.click(screen.getByRole("button", { name: "Close chooser" }));
    expect(screen.queryByTestId("template-chooser")).toBeNull();
    error.mockRestore();
  });

  it("offers nothing to a viewer who can neither see nor edit drafts", async () => {
    script({
      published: null,
      perms: { can_view_drafts: false, can_edit_draft: false, can_approve: false, can_withdraw: false },
    });
    renderTab();
    expect(await screen.findByText("No published process flow yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Draft from Template/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Drafts" })).toBeNull();
  });

  it("shows a failed initial load as an error, not as nothing published", async () => {
    mockApi.fail("get", `${BASE}/flow/published`);
    renderTab();
    expect(await screen.findByText(`GET ${BASE}/flow/published failed`)).toBeInTheDocument();
    expect(screen.queryByText("No published process flow yet")).toBeNull();
  });

  it("shows the error, not the empty state, when the drafts cannot be loaded", async () => {
    script({ published: null });
    mockApi.fail("get", `${BASE}/flow/drafts`);
    const user = renderTab();
    expect(await screen.findByText(/Create a draft, then submit it/)).toBeInTheDocument();
    await goToTab(user, "Drafts");
    expect(await screen.findByText(`GET ${BASE}/flow/drafts failed`)).toBeInTheDocument();
    expect(screen.queryByText("No draft process flows.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drafts tab
// ---------------------------------------------------------------------------

describe("ProcessFlowTab drafts", () => {
  async function openDrafts() {
    const user = renderTab({ initialSubTab: 1 });
    await screen.findByText("Revision 4");
    return user;
  }

  it("shows the provenance of a draft opened by a withdrawal and who submitted a pending one", async () => {
    await openDrafts();
    const withdrawn = screen.getByText("Revision 4").closest(".MuiPaper-root") as HTMLElement;
    expect(within(withdrawn).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(withdrawn).getByText("Opened from withdrawn revision 3")).toBeInTheDocument();
    const pending = screen.getByText("Revision 5").closest(".MuiPaper-root") as HTMLElement;
    expect(within(pending).getByText(/Submitted by Dev User/)).toBeInTheDocument();
    expect(within(pending).getByText(/Created by —/)).toBeInTheDocument();
  });

  it("opens a draft in the BPMN editor", async () => {
    const user = await openDrafts();
    await user.click(screen.getByRole("button", { name: "Edit in BPMN editor" }));
    expect(mockNavigate).toHaveBeenCalledWith("/bpm/processes/proc-1/flow?versionId=d1&returnSubTab=1");
  });

  it("clones the published version from the Drafts toolbar", async () => {
    const user = await openDrafts();
    await user.click(screen.getByRole("button", { name: /Clone Published Version/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)[0].body).toEqual({ bpmn_xml: "", based_on_id: "v1" }),
    );
  });

  it.each([
    ["Submit for approval", "Submit for Approval?", "Submit", "post", `${BASE}/flow/versions/d1/submit`],
    ["Delete draft", "Delete Draft?", "Delete", "delete", `${BASE}/flow/versions/d1`],
    ["Approve and publish", "Approve and Publish?", "Approve & Publish", "post", `${BASE}/flow/versions/d2/approve`],
    ["Reject and return to draft", "Reject Draft?", "Reject", "post", `${BASE}/flow/versions/d2/reject`],
  ] as const)("%s asks first, then calls the endpoint and reloads", async (button, title, confirm, method, path) => {
    const user = await openDrafts();
    await user.click(screen.getByRole("button", { name: button }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(title)).toBeInTheDocument();
    const permissionLoads = mockApi.callsOf("get", `${BASE}/flow/permissions`).length;
    await user.click(dialog.getByRole("button", { name: confirm }));
    await waitFor(() => expect(mockApi.callsOf(method, path)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("get", `${BASE}/flow/permissions`).length).toBe(permissionLoads + 1);
  });

  it("keeps the dialog open with the error when an action fails, and cancels", async () => {
    mockApi.fail("post", `${BASE}/flow/versions/d1/submit`, 409, "conflict");
    const user = await openDrafts();
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Submit" }));
    expect(await dialog.findByText(/submit failed/i)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("names a non-Error failure generically", async () => {
    mockApi.on("post", `${BASE}/flow/versions/d1/submit`, () => {
      throw "nope";
    });
    const user = await openDrafts();
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Submit" }));
    expect(await dialog.findByText("Action failed")).toBeInTheDocument();
  });

  it("expands a draft into its thumbnail and pre-link table, then collapses it", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, { ...DRAFTS[0], bpmn_xml: "" });
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, [
      { ...ELEMENTS[0], id: undefined, bpmn_element_id: "Task 1/a" },
    ]);
    const user = await openDrafts();
    await user.click(screen.getByText("Revision 4"));
    expect(await screen.findByTestId("draft-thumb")).toBeInTheDocument();
    expect(await screen.findByText("Pre-link Elements")).toBeInTheDocument();

    // Editing a draft link writes to the draft, keyed by the encoded BPMN id.
    const chip = screen.getByText("Oracle DB").closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);
    await waitFor(() =>
      expect(
        mockApi.callsOf("put", `${BASE}/flow/versions/d1/draft-elements/Task%201%2Fa`)[0].body,
      ).toEqual({ it_component_id: "" }),
    );
    expect(await screen.findByText("Draft element link updated")).toBeInTheDocument();

    const detailLoads = mockApi.callsOf("get", `${BASE}/flow/versions/d1`).length;
    await user.click(screen.getByText("Revision 4"));
    await user.click(screen.getByText("Revision 4"));
    // Re-opening uses what was already loaded.
    expect(mockApi.callsOf("get", `${BASE}/flow/versions/d1`)).toHaveLength(detailLoads);
  });

  it("reports a failed draft link update", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, { ...DRAFTS[0], bpmn_xml: "<xml>draft</xml>" });
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, [ELEMENTS[0]]);
    mockApi.fail("put", /\/draft-elements\//);
    const user = await openDrafts();
    await user.click(screen.getByText("Revision 4"));
    // With XML in the detail, the live viewer replaces the thumbnail.
    expect(await screen.findByText("BPMN:<xml>draft</xml>")).toBeInTheDocument();
    const chip = (await screen.findByText("SAP")).closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);
    expect(await screen.findByText("Failed to update draft element link")).toBeInTheDocument();
  });

  it("says so when a draft has no named elements, and says when they cannot be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("get", `${BASE}/flow/versions/d2`);
    mockApi.fail("get", `${BASE}/flow/versions/d2/draft-elements`);
    mockApi.on("get", `${BASE}/flow/versions/d1`, DRAFTS[0]);
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, []);
    const user = await openDrafts();
    await user.click(screen.getByText("Revision 5"));
    // No detail and no thumbnail: the preview placeholder.
    expect(await screen.findByText("Loading preview...")).toBeInTheDocument();
    expect(
      await screen.findByText(`GET ${BASE}/flow/versions/d2/draft-elements failed`),
    ).toBeInTheDocument();
    expect(screen.queryByText("No named elements found in this draft.")).toBeNull();
    expect(error).toHaveBeenCalledWith("Failed to load draft detail:", expect.anything());

    // Collapse keeps a closed draft's content mounted: the failed one keeps its
    // error, the empty one says it has no named elements.
    await user.click(screen.getByText("Revision 4"));
    expect(await screen.findByText("No named elements found in this draft.")).toBeInTheDocument();
    expect(screen.getByText(`GET ${BASE}/flow/versions/d2/draft-elements failed`)).toBeInTheDocument();
    error.mockRestore();
  });

  it("opens a pending draft full screen with its submission banner and no print", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d2`, { ...DRAFTS[1], bpmn_xml: "<xml>pending</xml>" });
    const user = await openDrafts();
    const pending = screen.getByText("Revision 5").closest(".MuiPaper-root") as HTMLElement;
    await user.click(within(pending).getByRole("button", { name: "View full screen" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Pending Approval")).toBeInTheDocument();
    expect(dialog.getByText(/Submitted by Dev User on .* — Revision 5/)).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /Print/ })).toBeNull();
  });

  it("logs a failed version load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fail("get", `${BASE}/flow/versions/d1`);
    const user = await openDrafts();
    const draft = screen.getByText("Revision 4").closest(".MuiPaper-root") as HTMLElement;
    await user.click(within(draft).getByRole("button", { name: "View full screen" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Failed to load version:", expect.anything()));
    expect(screen.queryByRole("dialog")).toBeNull();
    error.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Archived tab + withdrawal
// ---------------------------------------------------------------------------

describe("ProcessFlowTab archived versions", () => {
  it("shows a withdrawn revision with its reason, and opens it full screen", async () => {
    mockApi.on("get", `${BASE}/flow/versions/a0`, ARCHIVED[1]);
    const user = renderTab({ initialSubTab: 2 });
    const entry = (await screen.findByText("Revision 1")).closest(".MuiPaper-root") as HTMLElement;
    expect(within(entry).getByText("Originally approved by — on —")).toBeInTheDocument();
    expect(within(entry).getByText("Withdrawn by — on —")).toBeInTheDocument();
    expect(within(entry).getByText("Reason: Wrong owner recorded")).toBeInTheDocument();

    await user.click(screen.getByText("Revision 1"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/— Wrong owner recorded/)).toBeInTheDocument();
    // No XML on this version: nothing to render or print.
    expect(dialog.queryByTestId("bpmn-viewer")).toBeNull();
    expect(dialog.queryByRole("button", { name: /Print/ })).toBeNull();
  });

  it("re-drafts from an archived version", async () => {
    const user = renderTab({ initialSubTab: 2 });
    const entry = (await screen.findByText("Revision 2")).closest(".MuiPaper-root") as HTMLElement;
    await user.click(within(entry).getByRole("button", { name: /Create New Draft from This/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)[0].body).toEqual({ bpmn_xml: "", based_on_id: "a1" }),
    );
  });

  it("shows the error, not the empty state, when the archive cannot be loaded", async () => {
    mockApi.fail("get", `${BASE}/flow/archived`);
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText(`GET ${BASE}/flow/archived failed`)).toBeInTheDocument();
    expect(screen.queryByText("No archived process flows.")).toBeNull();
  });

  it("offers no re-draft to a viewer who cannot edit", async () => {
    script({ perms: { ...PERMS, can_edit_draft: false } });
    renderTab({ initialSubTab: 2 });
    await screen.findByText("Revision 2");
    expect(screen.queryByRole("button", { name: /Create New Draft from This/ })).toBeNull();
  });
});

describe("ProcessFlowTab withdrawal failures", () => {
  async function openWithdraw() {
    const user = await renderPublished();
    await user.click(screen.getByRole("button", { name: /Withdraw/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText(/Reason/), "Published by mistake");
    return { user, dialog };
  }

  it("shows the server's error and keeps the dialog open", async () => {
    mockApi.fail("post", `${BASE}/flow/versions/v1/withdraw`, 409, "nope");
    const { user, dialog } = await openWithdraw();
    await user.click(dialog.getByRole("button", { name: "Withdraw" }));
    expect(await dialog.findByText(/withdraw failed/i)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("falls back to the generic message for a non-Error failure", async () => {
    mockApi.on("post", `${BASE}/flow/versions/v1/withdraw`, () => {
      throw "nope";
    });
    const { user, dialog } = await openWithdraw();
    await user.click(dialog.getByRole("button", { name: "Withdraw" }));
    expect(await dialog.findByText("Withdrawal failed")).toBeInTheDocument();
  });
});
