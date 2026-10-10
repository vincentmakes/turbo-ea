/**
 * ProcessFlowTab — the assertions the other two suites leave out: what the tab
 * shows before and while each list loads, what it does when a process is
 * swapped under it, the exact wording of every banner, dialog and print page,
 * the guards on each link cell, and the off-screen viewer the tab borrows to
 * render thumbnails and print.
 *
 * Siblings are mocked by their `@/` alias path so this file also runs from an
 * out-of-tree copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/features/bpm/BpmnViewer", () => ({
  default: ({ bpmnXml, elements }: { bpmnXml: string; elements?: unknown[] }) => (
    <div data-testid="bpmn-viewer" data-elements={String(elements?.length ?? 0)}>
      {bpmnXml ? `BPMN:${bpmnXml}` : ""}
    </div>
  ),
}));
vi.mock("@/features/bpm/BpmnTemplateChooser", () => ({
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
vi.mock("@/features/bpm/MessageFlowsTable", () => ({
  default: ({ onNotify }: { onNotify: (msg: string) => void }) => (
    <button onClick={() => onNotify("Message flow updated")}>Notify from message flows</button>
  ),
}));

// The off-screen renderer behind thumbnails and print. Each instance records
// the container it was given and what happened to it.
interface ViewerRecord {
  container: HTMLElement | undefined;
  attachedOnImport: boolean;
  destroyed: boolean;
}
const viewerState = vi.hoisted(() => ({
  fail: false,
  svg: "<svg>generated</svg>",
  instances: [] as ViewerRecord[],
}));
vi.mock("bpmn-js/lib/NavigatedViewer", () => ({
  default: class FakeNavigatedViewer {
    rec: ViewerRecord;
    constructor(opts?: { container?: HTMLElement }) {
      this.rec = { container: opts?.container, attachedOnImport: false, destroyed: false };
      viewerState.instances.push(this.rec);
    }
    async importXML() {
      this.rec.attachedOnImport = Boolean(this.rec.container?.isConnected);
      if (viewerState.fail) throw new Error("cannot import");
    }
    async saveSVG() {
      return { svg: viewerState.svg };
    }
    destroy() {
      this.rec.destroyed = true;
    }
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
const BASE2 = "/bpm/processes/proc-2";

const PERMS = { can_view_drafts: true, can_edit_draft: true, can_approve: true, can_withdraw: true };
const NO_PERMS = { can_view_drafts: false, can_edit_draft: false, can_approve: false, can_withdraw: false };

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
    custom_fields: { tcode: "VA01", note: "keep" },
    application_id: "app-1",
    application_name: "SAP",
    organizations: [{ id: "org-9", name: "Finance Org" }],
  },
  {
    id: "el2",
    bpmn_element_id: "task_2",
    name: "Check stock",
    element_type: "serviceTask",
    lane_name: null,
    is_automated: false,
    sequence_order: 1,
    custom_fields: { note: "keep" },
  },
  {
    id: "el3",
    bpmn_element_id: "call_1",
    name: "Run Credit Check",
    element_type: "callActivity",
    lane_name: null,
    is_automated: false,
    sequence_order: 3,
    custom_fields: {},
    business_process_id: "bp-7",
    business_process_name: "Credit Check",
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
    // Submitted once and rejected back to draft: no longer "submitted".
    submitted_by_name: "Earlier Submitter",
  },
  {
    id: "d2",
    revision: 5,
    status: "pending",
    bpmn_xml: "",
    svg_thumbnail: "",
    created_by_name: "Dev User",
    created_at: "2025-06-16T10:00:00Z",
    submitted_by_name: null,
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
    id: "a2",
    revision: 1,
    status: "archived",
    approved_by_name: null,
  },
  {
    id: "w1",
    revision: 6,
    status: "withdrawn",
    bpmn_xml: "<xml>withdrawn</xml>",
    approved_by_name: "Admin",
    approved_at: "2025-06-01T10:00:00Z",
    withdrawn_by_name: "Quality Lead",
    withdrawn_at: "2025-07-01T10:00:00Z",
    withdrawal_reason: "Wrong owner recorded",
  },
];

/** A date rendered by `formatDateTime` under the YYYY-MM-DD workspace format. */
const DT = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`;

interface Script {
  base?: string;
  perms?: unknown;
  published?: unknown;
  elements?: unknown[];
  drafts?: unknown[];
  archived?: unknown[];
}

function script(s: Script = {}) {
  const base = s.base ?? BASE;
  mockApi.on("get", `${base}/flow/permissions`, s.perms ?? PERMS);
  mockApi.on("get", `${base}/flow/published`, "published" in s ? s.published : PUBLISHED);
  mockApi.on("get", `${base}/elements`, s.elements ?? ELEMENTS);
  mockApi.on("get", `${base}/flow/drafts`, s.drafts ?? DRAFTS);
  mockApi.on("get", `${base}/flow/archived`, s.archived ?? ARCHIVED);
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ui(props: Record<string, unknown> = {}) {
  return (
    <MemoryRouter>
      <ProcessFlowTab processId="proc-1" processName="Order Process" {...props} />
    </MemoryRouter>
  );
}

function renderTab(props: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  const utils = render(ui(props));
  return { user, ...utils };
}

async function renderPublished(props: Record<string, unknown> = {}) {
  const r = renderTab(props);
  await screen.findByText("Create Order");
  return r;
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

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

/** The outlined card a draft / archived version is listed on. */
function entryOf(revision: number): HTMLElement {
  return screen.getByText(`Revision ${revision}`).closest(".MuiPaper-root") as HTMLElement;
}

/** The Material Symbols ligatures rendered inside an element. */
function iconsIn(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll(".material-symbols-outlined")).map((n) => n.textContent ?? "");
}

/**
 * Forces React to flush every passive effect still pending: a new update
 * cannot start rendering until they have run.
 */
async function settleEffects(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Published" }));
  await act(async () => {});
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
  viewerState.instances = [];
  script();
  mockApi.on("get", /^\/cards\?/, {
    items: [
      { id: "card-9", name: "Picked Card", type: "Application" },
      { id: "org-9", name: "Finance Org", type: "Organization" },
      { id: "org-8", name: "HR Org", type: "Organization" },
      { id: "proc-1", name: "Order Process", type: "BusinessProcess" },
      { id: "bp-2", name: "Billing", type: "BusinessProcess" },
    ],
    total: 5,
  });
  mockApi.on("put", /\/elements\//, { status: "updated" });
  mockApi.on("put", /\/draft-elements\//, { status: "updated" });
  mockApi.on("post", /.*/, {});
  mockApi.on("delete", /.*/, {});
});

// ---------------------------------------------------------------------------
// Before anything has loaded
// ---------------------------------------------------------------------------

describe("ProcessFlowTab first paint", () => {
  it("shows the published loading message, the Published tab alone and no message bar", () => {
    const html = renderToStaticMarkup(ui());
    expect(html).toContain("Loading published flow...");
    expect(html).toContain("Published");
    expect(html).not.toContain("Drafts");
    expect(html).not.toContain("Archived");
    expect(html).not.toContain("MuiSnackbar");
  });

  it("renders nothing under the Archived tab before the permissions say it may", () => {
    const html = renderToStaticMarkup(ui({ initialSubTab: 2 }));
    expect(html).not.toContain("No archived process flows.");
    expect(html).not.toContain("Revision");
  });
});

// ---------------------------------------------------------------------------
// Loading: permissions, eager drafts, per-tab loads, switching process
// ---------------------------------------------------------------------------

describe("ProcessFlowTab loading", () => {
  it("treats an unreadable permission set as no draft access, and says the load failed", async () => {
    mockApi.fail("get", `${BASE}/flow/permissions`);
    renderTab();
    expect(await screen.findByText(`GET ${BASE}/flow/permissions failed`)).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE}/flow/permissions`)).toHaveLength(1);
    expect(screen.queryByText("Loading published flow...")).toBeNull();
    expect(screen.queryByText("No published process flow yet")).toBeNull();
    expect(screen.queryByText(/draft available/)).toBeNull();
    expect(screen.queryByRole("button", { name: /New Draft from Template/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Drafts" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Archived" })).toBeNull();
  });

  it("loads drafts eagerly once, and the archive not at all, on the Published tab", async () => {
    const { user } = await renderPublished();
    await settleEffects(user);
    expect(mockApi.callsOf("get", `${BASE}/flow/drafts`)).toHaveLength(1);
    expect(mockApi.callsOf("get", `${BASE}/flow/archived`)).toHaveLength(0);
    // Nothing from the Archived tab leaks onto the Published one.
    expect(screen.queryByText("No archived process flows.")).toBeNull();
    expect(screen.queryByText(/Archived on/)).toBeNull();
  });

  it("never asks for drafts without the permission to see them", async () => {
    script({ perms: NO_PERMS });
    const { user } = renderTab({ initialSubTab: 1 });
    await settleEffects(user);
    expect(await screen.findByText("Create Order")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE}/flow/drafts`)).toHaveLength(0);
  });

  it("never asks for, or shows, the archive without the permission to see it", async () => {
    script({ perms: NO_PERMS });
    renderTab({ initialSubTab: 2 });
    await waitFor(() => expect(mockApi.callsOf("get", `${BASE}/flow/published`)).toHaveLength(1));
    // Settle: the load ends with the Published content being computed.
    await act(async () => {});
    await act(async () => {});
    expect(mockApi.callsOf("get", `${BASE}/flow/archived`)).toHaveLength(0);
    expect(screen.queryByText("No archived process flows.")).toBeNull();
    expect(screen.queryByText("Loading archived flows...")).toBeNull();
  });

  it("refreshes the drafts when the Drafts tab is opened, with a loading message meanwhile", async () => {
    const { user } = await renderPublished();
    const refresh = deferred<unknown[]>();
    mockApi.on("get", `${BASE}/flow/drafts`, () => refresh.promise);
    await user.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(await screen.findByText("Loading drafts...")).toBeInTheDocument();
    expect(screen.queryByText("Revision 4")).toBeNull();
    await act(async () => {
      refresh.resolve([{ ...DRAFTS[0], id: "d6", revision: 6 }]);
    });
    expect(await screen.findByText("Revision 6")).toBeInTheDocument();
    expect(screen.queryByText("Revision 4")).toBeNull();
    expect(screen.queryByText("Loading drafts...")).toBeNull();
  });

  it("shows a loading message while the archive loads, and never a phantom entry before it", async () => {
    const seen: string[] = [];
    const archive = deferred<unknown[]>();
    mockApi.on("get", `${BASE}/flow/archived`, () => {
      // What the tab showed at the moment it asked for the archive.
      seen.push(document.body.textContent ?? "");
      return archive.promise;
    });
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText("Loading archived flows...")).toBeInTheDocument();
    // The message is up from the first render; the request follows once the
    // permissions have loaded, so wait for it rather than read it in this tick.
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).not.toMatch(/Revision/);
    await act(async () => {
      archive.resolve(ARCHIVED);
    });
    expect(await screen.findByText("Revision 2")).toBeInTheDocument();
    expect(screen.queryByText("Loading archived flows...")).toBeNull();
  });

  it("lists nothing, and says so, when the archive cannot be loaded", async () => {
    mockApi.fail("get", `${BASE}/flow/archived`);
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText(`GET ${BASE}/flow/archived failed`)).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE}/flow/archived`)).toHaveLength(1);
    expect(screen.queryByText("Loading archived flows...")).toBeNull();
    expect(screen.queryByText("No archived process flows.")).toBeNull();
    expect(screen.queryByText(/^Revision/)).toBeNull();
  });

  it("reloads for another process, and drops the previous one's flow when that fails", async () => {
    const { rerender } = await renderPublished();
    const perms2 = deferred<unknown>();
    mockApi.on("get", `${BASE2}/flow/permissions`, () => perms2.promise);
    mockApi.on("get", `${BASE2}/flow/published`, PUBLISHED);
    mockApi.on("get", `${BASE2}/elements`, []);
    rerender(ui({ processId: "proc-2" }));
    expect(await screen.findByText("Loading published flow...")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE2}/flow/published`)).toHaveLength(1);
    await act(async () => {
      perms2.reject(new Error("forbidden"));
    });
    expect(await screen.findByText("forbidden")).toBeInTheDocument();
    expect(screen.queryByText("Loading published flow...")).toBeNull();
    expect(screen.queryByText("No published process flow yet")).toBeNull();
    expect(screen.queryByText("Create Order")).toBeNull();
    expect(screen.queryByText(/Approved/)).toBeNull();
  });

  it("drops the previous process's drafts when the new one's cannot be loaded", async () => {
    script({ published: null });
    const { rerender } = renderTab();
    expect(await screen.findByText(/2 drafts available\./)).toBeInTheDocument();
    script({ base: BASE2, published: null, elements: [] });
    mockApi.fail("get", `${BASE2}/flow/drafts`);
    rerender(ui({ processId: "proc-2" }));
    expect(
      await screen.findByText("Create a draft, then submit it for approval to publish."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/drafts available/)).toBeNull();
  });

  it("drops the previous process's archive when the new one's cannot be loaded", async () => {
    const { rerender } = renderTab({ initialSubTab: 2 });
    expect(await screen.findByText("Revision 2")).toBeInTheDocument();
    script({ base: BASE2 });
    mockApi.fail("get", `${BASE2}/flow/archived`);
    rerender(ui({ processId: "proc-2", initialSubTab: 2 }));
    expect(await screen.findByText(`GET ${BASE2}/flow/archived failed`)).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE2}/flow/archived`)).toHaveLength(1);
    expect(screen.queryByText("Revision 2")).toBeNull();
    expect(screen.queryByText("No archived process flows.")).toBeNull();
    expect(screen.queryByText("Loading archived flows...")).toBeNull();
  });

  it("drops the previous process's draft list while the new one is still loading", async () => {
    const { rerender } = renderTab({ initialSubTab: 1 });
    expect(await screen.findByText("Revision 4")).toBeInTheDocument();
    // The new process's permissions never arrive; its draft list fails.
    mockApi.on("get", `${BASE2}/flow/permissions`, () => new Promise(() => {}));
    mockApi.on("get", `${BASE2}/flow/published`, PUBLISHED);
    mockApi.on("get", `${BASE2}/elements`, []);
    mockApi.fail("get", `${BASE2}/flow/drafts`);
    rerender(ui({ processId: "proc-2", initialSubTab: 1 }));
    expect(await screen.findByText(`GET ${BASE2}/flow/drafts failed`)).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE2}/flow/drafts`).length).toBeGreaterThan(0);
    expect(screen.queryByText("Revision 4")).toBeNull();
    expect(screen.queryByText("No draft process flows.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confirm dialog (submit / approve / reject / delete)
// ---------------------------------------------------------------------------

describe("ProcessFlowTab confirm dialog", () => {
  async function openDrafts() {
    const r = renderTab({ initialSubTab: 1 });
    await screen.findByText("Revision 4");
    return r;
  }

  it.each([
    [
      "Submit for approval",
      "This draft will be sent to the business process owner for approval. You will not be able to edit it while it is pending.",
      "Revision 4",
    ],
    ["Delete draft", "This will permanently delete the draft. This cannot be undone.", "Revision 4"],
    [
      "Approve and publish",
      "This will publish the process flow. The current published version (if any) will be archived. This action cannot be undone.",
      "Revision 5",
    ],
    [
      "Reject and return to draft",
      "This will return the draft to the author for revision. They will be notified.",
      "Revision 5",
    ],
  ])("%s explains itself, names the revision and shows no error yet", async (button, description, revision) => {
    const { user } = await openDrafts();
    await user.click(screen.getByRole("button", { name: button }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(description)).toBeInTheDocument();
    expect(dialog.getByText(revision)).toBeInTheDocument();
    expect(dialog.queryByRole("alert")).toBeNull();
  });

  it("closes on Escape without acting", async () => {
    const { user } = await openDrafts();
    await user.click(screen.getByRole("button", { name: "Delete draft" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("delete")).toHaveLength(0);
  });

  it("clears the previous error when the action is retried", async () => {
    mockApi.fail("post", `${BASE}/flow/versions/d1/submit`, 409, "conflict");
    const { user } = await openDrafts();
    await user.click(screen.getByRole("button", { name: "Submit for approval" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Submit" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(/submit failed/i);

    const retry = deferred<unknown>();
    mockApi.on("post", `${BASE}/flow/versions/d1/submit`, () => retry.promise);
    await user.click(dialog.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(dialog.queryByRole("alert")).toBeNull());
    await act(async () => {
      retry.resolve({});
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("after approving, refreshes the draft list (showing it is loading) and the archive", async () => {
    const { user } = await openDrafts();
    const archivedBefore = mockApi.callsOf("get", `${BASE}/flow/archived`).length;
    const refresh = deferred<unknown[]>();
    mockApi.on("get", `${BASE}/flow/drafts`, () => refresh.promise);
    await user.click(screen.getByRole("button", { name: "Approve and publish" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Approve & Publish" }));
    expect(await screen.findByText("Loading drafts...")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE}/flow/archived`).length).toBe(archivedBefore + 1);
    await act(async () => {
      refresh.resolve([DRAFTS[0]]);
    });
    expect(await screen.findByText("Revision 4")).toBeInTheDocument();
    expect(screen.queryByText("Revision 5")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Withdraw dialog
// ---------------------------------------------------------------------------

describe("ProcessFlowTab withdraw dialog", () => {
  async function openWithdraw(props: Record<string, unknown> = {}) {
    const r = await renderPublished(props);
    await r.user.click(screen.getByRole("button", { name: /Withdraw/ }));
    const dialog = within(await screen.findByRole("dialog"));
    return { ...r, dialog };
  }

  it("explains what withdrawing does, for which revision, and asks for a reason", async () => {
    const { dialog } = await openWithdraw();
    expect(dialog.getByText("Withdraw the published process flow?")).toBeInTheDocument();
    expect(
      dialog.getByText(/The revision is unpublished, not deleted\. It stays in the version history/),
    ).toBeInTheDocument();
    expect(dialog.getByText("Revision 3")).toBeInTheDocument();
    expect(
      dialog.getByText(/^Order Process will have no approved process flow until a new revision is approved\./),
    ).toBeInTheDocument();
    expect(
      dialog.getByText("Required, at least 10 characters. Recorded permanently in the version history."),
    ).toBeInTheDocument();
    // The warning is the only alert: no error before anything was tried.
    expect(dialog.getAllByRole("alert")).toHaveLength(1);
  });

  it("accepts a reason of exactly ten characters", async () => {
    const { user, dialog } = await openWithdraw();
    const confirm = dialog.getByRole("button", { name: /^Withdraw$/ });
    await user.type(dialog.getByLabelText(/Reason/), "123456789");
    expect(confirm).toBeDisabled();
    await user.type(dialog.getByLabelText(/Reason/), "0");
    expect(confirm).toBeEnabled();
  });

  it("closes on Escape without withdrawing", async () => {
    const { user } = await openWithdraw();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("shows progress while withdrawing, then closes, refreshes and lands on Drafts", async () => {
    const { user, dialog } = await openWithdraw();
    await user.type(dialog.getByLabelText(/Reason/), "Published by mistake");
    const request = deferred<unknown>();
    mockApi.on("post", `${BASE}/flow/versions/v1/withdraw`, () => request.promise);
    await user.click(dialog.getByRole("button", { name: /^Withdraw$/ }));
    expect(await dialog.findByRole("button", { name: "Loading..." })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(dialog.getAllByRole("alert")).toHaveLength(1);

    // After the withdrawal nothing is published, and the archive holds it.
    script({ published: null });
    const archivedBefore = mockApi.callsOf("get", `${BASE}/flow/archived`).length;
    await act(async () => {
      request.resolve({});
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("tab", { name: "Drafts" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Revision 4")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `${BASE}/flow/archived`).length).toBe(archivedBefore + 1);

    await user.click(screen.getByRole("tab", { name: "Published" }));
    expect(await screen.findByText("No published process flow yet")).toBeInTheDocument();
  });

  it("clears the previous error when the withdrawal is retried", async () => {
    mockApi.fail("post", `${BASE}/flow/versions/v1/withdraw`, 409, "nope");
    const { user, dialog } = await openWithdraw();
    await user.type(dialog.getByLabelText(/Reason/), "Published by mistake");
    await user.click(dialog.getByRole("button", { name: /^Withdraw$/ }));
    expect(await dialog.findByText(/withdraw failed/i)).toBeInTheDocument();
    const retry = deferred<unknown>();
    mockApi.on("post", `${BASE}/flow/versions/v1/withdraw`, () => retry.promise);
    await user.click(dialog.getByRole("button", { name: /^Withdraw$/ }));
    await waitFor(() => expect(dialog.queryByText(/withdraw failed/i)).toBeNull());
    await act(async () => {
      retry.resolve({});
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens with no error left over from a previous attempt", async () => {
    mockApi.fail("post", `${BASE}/flow/versions/v1/withdraw`, 409, "nope");
    const { user, dialog } = await openWithdraw();
    await user.type(dialog.getByLabelText(/Reason/), "Published by mistake");
    await user.click(dialog.getByRole("button", { name: /^Withdraw$/ }));
    expect(await dialog.findByText(/withdraw failed/i)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: /Withdraw/ }));
    const again = within(await screen.findByRole("dialog"));
    expect(again.getAllByRole("alert")).toHaveLength(1);
    expect(again.getByLabelText(/Reason/)).toHaveValue("");
  });
});

// ---------------------------------------------------------------------------
// Drafts tab
// ---------------------------------------------------------------------------

describe("ProcessFlowTab drafts list", () => {
  async function openDrafts(drafts: unknown[] = DRAFTS) {
    script({ drafts });
    const r = renderTab({ initialSubTab: 1 });
    await screen.findByText("Revision 4");
    return r;
  }

  it("marks a pending draft with an hourglass and a draft with a note, both collapsed", async () => {
    await openDrafts();
    const button4 = within(entryOf(4)).getAllByRole("button")[0];
    const button5 = within(entryOf(5)).getAllByRole("button")[0];
    expect(iconsIn(button4)).toEqual(["edit_note", "expand_more"]);
    expect(iconsIn(button5)).toEqual(["hourglass_top", "expand_more"]);
  });

  it("dates each draft, and only a submitted pending draft names its submitter", async () => {
    await openDrafts([
      ...DRAFTS,
      {
        id: "d3",
        revision: 7,
        status: "pending",
        bpmn_xml: "",
        svg_thumbnail: "",
        created_by_name: "Dev User",
        created_at: "2025-06-17T10:00:00Z",
        submitted_by_name: "Reviewer Rae",
      },
    ]);
    expect(within(entryOf(4)).getByText(new RegExp(`^Created by Dev User on ${DT}$`))).toBeInTheDocument();
    // A rejected draft keeps its submitter, but is no longer "submitted".
    expect(within(entryOf(4)).queryByText(/Submitted by/)).toBeNull();
    // A pending draft without a recorded submitter names nobody.
    expect(within(entryOf(5)).queryByText(/Submitted by/)).toBeNull();
    expect(within(entryOf(7)).getByText(/Submitted by Reviewer Rae/)).toBeInTheDocument();
  });

  it("marks only a draft opened by a withdrawal as such", async () => {
    await openDrafts([{ ...DRAFTS[0], from_withdrawn_revision: 3 }, DRAFTS[1]]);
    expect(within(entryOf(4)).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(entryOf(4)).getByText("Opened from withdrawn revision 3")).toBeInTheDocument();
    expect(within(entryOf(5)).queryByText("Withdrawn")).toBeNull();
    expect(within(entryOf(5)).queryByText(/Opened from withdrawn revision/)).toBeNull();
  });

  it("expands one draft at a time and collapses it on a second click", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, { ...DRAFTS[0], bpmn_xml: "<xml>draft</xml>" });
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, []);
    const { user } = await openDrafts();
    const collapse4 = () => entryOf(4).querySelector(".MuiCollapse-root") as HTMLElement;
    const collapse5 = () => entryOf(5).querySelector(".MuiCollapse-root") as HTMLElement;
    expect(collapse4()).not.toHaveClass("MuiCollapse-entered");

    await user.click(screen.getByText("Revision 4"));
    await waitFor(() => expect(collapse4()).toHaveClass("MuiCollapse-entered"));
    expect(collapse5()).not.toHaveClass("MuiCollapse-entered");
    expect(iconsIn(within(entryOf(4)).getAllByRole("button")[0])).toContain("expand_less");
    expect(iconsIn(within(entryOf(5)).getAllByRole("button")[0])).toContain("expand_more");
    // The preview carries no element links.
    const viewer = await within(entryOf(4)).findByTestId("bpmn-viewer");
    expect(viewer).toHaveTextContent("BPMN:<xml>draft</xml>");
    expect(viewer).toHaveAttribute("data-elements", "0");

    await user.click(screen.getByText("Revision 4"));
    await waitFor(() => expect(collapse4()).not.toHaveClass("MuiCollapse-entered"));
    expect(iconsIn(within(entryOf(4)).getAllByRole("button")[0])).toContain("expand_more");

    // Re-opening reuses the detail and the elements already loaded.
    const loads = mockApi.callsOf("get", `${BASE}/flow/versions/d1`).length;
    const elementLoads = mockApi.callsOf("get", `${BASE}/flow/versions/d1/draft-elements`).length;
    expect(elementLoads).toBe(1);
    await user.click(screen.getByText("Revision 4"));
    await waitFor(() => expect(collapse4()).toHaveClass("MuiCollapse-entered"));
    expect(mockApi.callsOf("get", `${BASE}/flow/versions/d1`)).toHaveLength(loads);
    expect(mockApi.callsOf("get", `${BASE}/flow/versions/d1/draft-elements`)).toHaveLength(elementLoads);
  });

  it("shows that a draft's elements are loading, per draft", async () => {
    const elems5 = deferred<unknown[]>();
    mockApi.on("get", `${BASE}/flow/versions/d2`, DRAFTS[1]);
    mockApi.on("get", `${BASE}/flow/versions/d2/draft-elements`, () => elems5.promise);
    mockApi.on("get", `${BASE}/flow/versions/d1`, DRAFTS[0]);
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, []);
    const { user } = await openDrafts();
    await user.click(screen.getByText("Revision 5"));
    expect(await within(entryOf(5)).findByText("Loading elements...")).toBeInTheDocument();

    // Another draft finishing its load leaves this one still loading.
    await user.click(screen.getByText("Revision 4"));
    expect(await within(entryOf(4)).findByText("No named elements found in this draft.")).toBeInTheDocument();
    expect(within(entryOf(5)).getByText("Loading elements...")).toBeInTheDocument();

    await act(async () => {
      elems5.resolve([]);
    });
    expect(await within(entryOf(5)).findByText("No named elements found in this draft.")).toBeInTheDocument();
  });

  it("pre-links a draft element through the picker and closes the picker afterwards", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d1`, DRAFTS[0]);
    mockApi.on("get", `${BASE}/flow/versions/d1/draft-elements`, [ELEMENTS[1]]);
    const { user } = await openDrafts();
    await user.click(screen.getByText("Revision 4"));
    expect(await screen.findByText("Pre-link Elements")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pre-link applications, data objects, IT components, and TCodes before publishing. These links will be applied when this version is approved.",
      ),
    ).toBeInTheDocument();
    await user.click(within(cellOf(rowOf("Check stock"), "Application")).getByText("Link Application"));
    await user.click(await screen.findByRole("option", { name: /Picked Card/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/flow/versions/d1/draft-elements/task_2`)[0].body).toEqual({
        application_id: "card-9",
      }),
    );
    expect(await screen.findByText("Draft element link updated")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Loading elements...")).toBeNull());
    expect(screen.getByText("Check stock")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search Application...")).toBeNull();
  });

  it("opens and closes the template chooser from the Drafts toolbar, and lists the new draft", async () => {
    const { user } = await openDrafts();
    expect(screen.queryByTestId("template-chooser")).toBeNull();
    await user.click(screen.getByRole("button", { name: /New Draft from Template/ }));
    expect(screen.getByTestId("template-chooser")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close chooser" }));
    expect(screen.queryByTestId("template-chooser")).toBeNull();

    script({ drafts: [...DRAFTS, { ...DRAFTS[0], id: "d8", revision: 8 }] });
    await user.click(screen.getByRole("button", { name: /New Draft from Template/ }));
    await user.click(screen.getByRole("button", { name: "Pick Template" }));
    expect(await screen.findByText("Revision 8")).toBeInTheDocument();
    expect(screen.queryByTestId("template-chooser")).toBeNull();
  });

  it("renders the new draft's thumbnail off screen and cleans up after itself", async () => {
    const { user } = await openDrafts();
    await user.click(screen.getByRole("button", { name: /New Draft from Template/ }));
    await user.click(screen.getByRole("button", { name: "Pick Template" }));
    await waitFor(() => expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)).toHaveLength(1));
    expect(mockApi.callsOf("post", `${BASE}/flow/drafts`)[0].body).toEqual({
      bpmn_xml: "<xml>test</xml>",
      svg_thumbnail: "<svg>generated</svg>",
    });
    expect(viewerState.instances).toHaveLength(1);
    const rec = viewerState.instances[0];
    expect(rec.container).toBeInstanceOf(HTMLElement);
    expect(rec.attachedOnImport).toBe(true);
    expect(rec.destroyed).toBe(true);
    expect(rec.container?.isConnected).toBe(false);
  });

  it("lists a clone of the published version as soon as it is created", async () => {
    const { user } = await openDrafts();
    script({ drafts: [...DRAFTS, { ...DRAFTS[0], id: "d9", revision: 9 }] });
    await user.click(screen.getByRole("button", { name: /Clone Published Version/ }));
    expect(await screen.findByText("Revision 9")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Published view and its elements table
// ---------------------------------------------------------------------------

describe("ProcessFlowTab published view", () => {
  it("states the approval, the revision and how to use the table", async () => {
    await renderPublished();
    const banner = screen.getByText("Approved").closest(".MuiAlert-message") as HTMLElement;
    expect(banner).toHaveTextContent(new RegExp(`^Approved by Admin User on ${DT} — Revision 3$`));
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Click on Application, Data Object, IT Component, or TCode cells to edit. Automation is auto-determined from the BPMN element type.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "Auto-determined from BPMN element type (serviceTask, scriptTask, businessRuleTask = Yes)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Informative only — documents which organizations are involved/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^The Business Process this step hands over to/)).toBeInTheDocument();
    // The published viewer carries the element links.
    expect(screen.getByTestId("bpmn-viewer")).toHaveAttribute("data-elements", "3");
  });

  it("dashes an approver that was not recorded", async () => {
    script({ published: { ...PUBLISHED, approved_by_name: null } });
    await renderPublished();
    const banner = screen.getByText("Approved").closest(".MuiAlert-message") as HTMLElement;
    expect(banner).toHaveTextContent(new RegExp(`^Approved by — on ${DT} — Revision 3$`));
  });

  it("numbers the steps from one", async () => {
    await renderPublished();
    const body = screen.getByText("Create Order").closest("tbody") as HTMLElement;
    const numbers = Array.from(body.querySelectorAll("tr")).map((r) => r.querySelectorAll("td")[0].textContent);
    expect(numbers).toEqual(["1", "2", "3"]);
  });

  it("offers no template chooser and no message bar until asked", async () => {
    script({ published: null, drafts: [] });
    const { user } = renderTab();
    expect(await screen.findByText("Create a draft, then submit it for approval to publish.")).toBeInTheDocument();
    expect(screen.queryByTestId("template-chooser")).toBeNull();
    expect(document.querySelector(".MuiSnackbar-root")).toBeNull();
    await user.click(screen.getByRole("button", { name: /New Draft from Template/ }));
    expect(screen.getByTestId("template-chooser")).toBeInTheDocument();
  });

  it("says how many drafts wait for approval when nothing is published", async () => {
    script({ published: null });
    renderTab();
    expect(
      await screen.findByText("2 drafts available. Submit a draft for approval to publish it here."),
    ).toBeInTheDocument();
  });

  it("opens the picker from an Application chip instead of navigating", async () => {
    const { user } = await renderPublished();
    await user.click(within(cellOf(rowOf("Create Order"), "Application")).getByText("SAP"));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(await screen.findByPlaceholderText("Search Application...")).toBeInTheDocument();
  });

  it("drills into a linked process from its chip without opening the picker", async () => {
    const { user } = await renderPublished();
    await user.click(within(cellOf(rowOf("Run Credit Check"), "Business Process")).getByText("Credit Check"));
    expect(mockNavigate).toHaveBeenCalledWith("/cards/bp-7?tab=1");
    expect(screen.queryByPlaceholderText("Search Business Process...")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("never offers the process itself as the process a step hands over to", async () => {
    const { user } = await renderPublished();
    await user.click(within(cellOf(rowOf("Check stock"), "Business Process")).getByText("Link Business Process"));
    expect(await screen.findByRole("option", { name: /Billing/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Order Process/ })).toBeNull();
  });

  it("adds an organization next to the ones already linked, which it does not offer again", async () => {
    const { user } = await renderPublished();
    await user.click(within(cellOf(rowOf("Create Order"), "Organization")).getByText("Finance Org"));
    expect(await screen.findByRole("option", { name: /HR Org/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Finance Org/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /HR Org/ }));
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el1`)[0].body).toEqual({
        organization_ids: ["org-9", "org-8"],
      }),
    );
  });

  it("saves a TCode on blur trimmed, keeping the step's other custom fields", async () => {
    const { user } = await renderPublished();
    await user.click(within(cellOf(rowOf("Check stock"), "TCode")).getByText("Add"));
    await user.type(screen.getByPlaceholderText("e.g. SE16"), "  MM01  ");
    await user.click(screen.getByText("Process Steps & Elements"));
    await waitFor(() =>
      expect(mockApi.callsOf("put", `${BASE}/elements/el2`)[0].body).toEqual({
        custom_fields: { note: "keep", tcode: "MM01" },
      }),
    );
  });

  it("shows the re-read elements after a link is saved", async () => {
    const { user } = await renderPublished();
    mockApi.on("get", `${BASE}/elements`, [
      { ...ELEMENTS[1], application_id: "card-9", application_name: "Picked Card" },
    ]);
    await user.click(within(cellOf(rowOf("Check stock"), "Application")).getByText("Link Application"));
    await user.click(await screen.findByRole("option", { name: /Picked Card/ }));
    expect(await screen.findByText("Element updated")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Create Order")).toBeNull());
    expect(within(cellOf(rowOf("Check stock"), "Application")).getByText("Picked Card")).toBeInTheDocument();
  });

  it("keeps the page up when the elements cannot be re-read after a save", async () => {
    const { user } = await renderPublished();
    mockApi.fail("get", `${BASE}/elements`);
    const chip = within(cellOf(rowOf("Create Order"), "Application")).getByText("SAP").closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);
    expect(
      await screen.findByText("Element updated, but the list could not be refreshed"),
    ).toBeInTheDocument();
    // The table the user was editing stays on screen.
    expect(screen.getByText("Create Order")).toBeInTheDocument();
    expect(screen.getByText(/^by Admin User on/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Full Size/ })).toBeInTheDocument();
  });

  it("dismisses a message on Escape", async () => {
    const { user } = await renderPublished();
    await user.click(screen.getByRole("button", { name: "Notify from message flows" }));
    expect(await screen.findByText("Message flow updated")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector(".MuiSnackbar-root")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Archived tab
// ---------------------------------------------------------------------------

describe("ProcessFlowTab archived list", () => {
  it("tells an archived revision from a withdrawn one, with its approval and archival", async () => {
    renderTab({ initialSubTab: 2 });
    expect(await screen.findByText("Revision 2")).toBeInTheDocument();

    const archived = entryOf(2);
    expect(iconsIn(archived)).toContain("inventory_2");
    expect(iconsIn(archived)).not.toContain("unpublished");
    expect(within(archived).getByText("Archived")).toBeInTheDocument();
    expect(within(archived).queryByText("Withdrawn")).toBeNull();
    expect(
      within(archived).getByText(new RegExp(`^Approved by Admin on ${DT} — Archived on ${DT}$`)),
    ).toBeInTheDocument();

    // Nothing recorded: every blank reads as a dash.
    expect(within(entryOf(1)).getByText("Approved by — on — — Archived on —")).toBeInTheDocument();

    const withdrawn = entryOf(6);
    expect(iconsIn(withdrawn)).toContain("unpublished");
    expect(iconsIn(withdrawn)).not.toContain("inventory_2");
    expect(within(withdrawn).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(withdrawn).queryByText("Archived")).toBeNull();
    expect(within(withdrawn).queryByText(/Archived on/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full-screen viewer
// ---------------------------------------------------------------------------

describe("ProcessFlowTab full-screen viewer", () => {
  async function openPublishedFullSize(props: Record<string, unknown> = {}) {
    const r = await renderPublished(props);
    await r.user.click(screen.getByRole("button", { name: /View Full Size/ }));
    const dialog = within(await screen.findByRole("dialog"));
    return { ...r, dialog };
  }

  async function openArchivedFullSize(revision: number, id: string, version: unknown) {
    mockApi.on("get", `${BASE}/flow/versions/${id}`, version);
    const r = renderTab({ initialSubTab: 2 });
    await r.user.click(await screen.findByText(`Revision ${revision}`));
    const dialog = within(await screen.findByRole("dialog"));
    return { ...r, dialog };
  }

  function bannerOf(dialog: ReturnType<typeof within>, strong: string): HTMLElement {
    return dialog.getByText(strong, { selector: "strong" }).closest(".MuiAlert-message") as HTMLElement;
  }

  it("names an untitled process generically and the approval with a dash when nobody is recorded", async () => {
    script({ published: { ...PUBLISHED, approved_by_name: null } });
    const { dialog } = await openPublishedFullSize({ processName: undefined });
    expect(dialog.getByText("Process Flow — Revision 3")).toBeInTheDocument();
    expect(bannerOf(dialog, "Approved")).toHaveTextContent(new RegExp(`^Approved by — on ${DT} — Revision 3$`));
    expect(dialog.getByTestId("bpmn-viewer")).toHaveAttribute("data-elements", "0");
    // Only the banner of its own status.
    expect(dialog.queryByText("Archived", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Withdrawn", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Pending Approval")).toBeNull();
  });

  it("names the approver of a published version", async () => {
    const { dialog } = await openPublishedFullSize();
    expect(bannerOf(dialog, "Approved")).toHaveTextContent(
      new RegExp(`^Approved by Admin User on ${DT} — Revision 3$`),
    );
  });

  it("closes on Escape", async () => {
    await openPublishedFullSize();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes from its close button and opens again", async () => {
    const { user, dialog } = await openPublishedFullSize();
    await user.click(dialog.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: /View Full Size/ }));
    expect(within(await screen.findByRole("dialog")).getByText("Order Process — Revision 3")).toBeInTheDocument();
  });

  it("shows an archived version's archival and original approval", async () => {
    const { dialog } = await openArchivedFullSize(2, "a1", ARCHIVED[0]);
    expect(bannerOf(dialog, "Archived")).toHaveTextContent(
      new RegExp(`^Archived on ${DT}\\. Originally approved by Admin on ${DT} — Revision 2$`),
    );
    expect(dialog.queryByText("Approved", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Withdrawn", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Pending Approval")).toBeNull();
  });

  it("dashes what an archived version did not record", async () => {
    const { dialog } = await openArchivedFullSize(1, "a2", ARCHIVED[1]);
    expect(bannerOf(dialog, "Archived")).toHaveTextContent(
      /^Archived on —\. Originally approved by — on — — Revision 1$/,
    );
  });

  it("shows who withdrew a version, and why", async () => {
    const { dialog } = await openArchivedFullSize(6, "w1", ARCHIVED[2]);
    expect(bannerOf(dialog, "Withdrawn")).toHaveTextContent(
      new RegExp(`^Withdrawn by Quality Lead on ${DT} — Revision 6 — Wrong owner recorded$`),
    );
    expect(dialog.queryByText("Approved", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Archived", { selector: "strong" })).toBeNull();
  });

  it("dashes an unrecorded withdrawer", async () => {
    const { dialog } = await openArchivedFullSize(6, "w1", {
      ...ARCHIVED[2],
      withdrawn_by_name: null,
      withdrawn_at: null,
      withdrawal_reason: null,
    });
    expect(bannerOf(dialog, "Withdrawn")).toHaveTextContent(/^Withdrawn by — on — — Revision 6$/);
  });

  it("shows a pending version's submission and no approval", async () => {
    mockApi.on("get", `${BASE}/flow/versions/d2`, { ...DRAFTS[1], submitted_by_name: null });
    const { user } = renderTab({ initialSubTab: 1 });
    await screen.findByText("Revision 5");
    await user.click(within(entryOf(5)).getByRole("button", { name: "View full screen" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(bannerOf(dialog, "Pending Approval")).toHaveTextContent(/^Pending Approval — Submitted by — on — — Revision 5$/);
    expect(dialog.queryByText("Approved", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Archived", { selector: "strong" })).toBeNull();
    expect(dialog.queryByText("Withdrawn", { selector: "strong" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

describe("ProcessFlowTab printing", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  let written = "";
  let listeners: Record<string, () => void> = {};
  const printWindow = {
    print: vi.fn(),
    close: vi.fn(),
    document: {
      open: vi.fn(),
      write: (html: string) => {
        written += html;
      },
      close: vi.fn(),
      // Only the two buttons the page writes exist.
      getElementById: (id: string) =>
        id === "turbo-print-btn" || id === "turbo-close-btn"
          ? {
              addEventListener: (event: string, fn: () => void) => {
                listeners[`${id}:${event}`] = fn;
              },
            }
          : null,
    },
  };

  beforeEach(() => {
    written = "";
    listeners = {};
    printWindow.print.mockReset();
    printWindow.close.mockReset();
    printWindow.document.open.mockReset();
    printWindow.document.close.mockReset();
    openSpy = vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
  });
  afterEach(() => openSpy.mockRestore());

  it("opens a blank window and writes a complete, labelled print page into it", async () => {
    const { user } = await renderPublished({ processName: undefined });
    await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
    await waitFor(() => expect(printWindow.document.close).toHaveBeenCalled());
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(printWindow.document.open).toHaveBeenCalled();
    expect(written).toContain("<title>Process Flow - Rev 3</title>");
    expect(written).toContain("<h1>Process Flow</h1>");
    expect(written).toMatch(/Print \/ Save as PDF\s*<\/button>/);
    expect(written).toMatch(/>\s*Close\s*<\/button>/);
    expect(written).toMatch(/<span>Printed on \d{4}-\d{2}-\d{2}<\/span>/);
    expect(written).toContain("<svg>generated</svg>");

    // The page's own buttons print and close it on click.
    expect(Object.keys(listeners).sort()).toEqual(["turbo-close-btn:click", "turbo-print-btn:click"]);
    listeners["turbo-print-btn:click"]();
    expect(printWindow.print).toHaveBeenCalled();
    listeners["turbo-close-btn:click"]();
    expect(printWindow.close).toHaveBeenCalled();
  });

  it("escapes the process name and the approver it writes into the print page", async () => {
    // The page is same-origin, so markup in either name would run as the app.
    script({ published: { ...PUBLISHED, approved_by_name: "<b>Eve</b>" } });
    const { user } = await renderPublished({ processName: "<img src=x onerror=alert(1)>" });
    await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
    await waitFor(() => expect(printWindow.document.close).toHaveBeenCalled());
    expect(written).not.toContain("<img");
    expect(written).not.toContain("<b>Eve");
    expect(written).toContain("<title>&lt;img src=x onerror=alert(1)&gt; - Rev 3</title>");
    expect(written).toContain("<h1>&lt;img src=x onerror=alert(1)&gt;</h1>");
    expect(written).toContain("&lt;b&gt;Eve&lt;/b&gt;");
  });

  it("sanitises the stored thumbnail it prints when the diagram cannot be rendered", async () => {
    viewerState.fail = true;
    script({
      published: {
        ...PUBLISHED,
        svg_thumbnail: '<svg><script>alert(1)</script><rect width="4" onload="alert(2)"/></svg>',
      },
    });
    const { user } = await renderPublished();
    await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
    await waitFor(() => expect(printWindow.document.close).toHaveBeenCalled());
    expect(written).toContain('<rect width="4"');
    expect(written).not.toContain("<script");
    expect(written).not.toContain("onload");
  });

  it("renders the diagram off screen and cleans up after itself", async () => {
    const { user } = await renderPublished();
    await user.click(screen.getByRole("button", { name: /Print \/ PDF/ }));
    await waitFor(() => expect(written).toContain("<svg>generated</svg>"));
    expect(viewerState.instances).toHaveLength(1);
    const rec = viewerState.instances[0];
    expect(rec.container).toBeInstanceOf(HTMLElement);
    expect(rec.attachedOnImport).toBe(true);
    expect(rec.destroyed).toBe(true);
    expect(rec.container?.isConnected).toBe(false);
  });
});
