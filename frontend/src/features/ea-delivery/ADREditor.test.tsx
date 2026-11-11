import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ArchitectureDecision } from "@/types";

// The discussion and history side panel has its own tests: here the page
// renders alone, and the props it hands the panel are recorded.
// It provides the section markers' data the test sets (`sidePanel.sections`).
const sidePanel = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
  /** How many times the panel was mounted (it reads the discussion on mount). */
  mounts: 0,
  sections: null as null | {
    counts: Record<string, { open: number; total: number }>;
    canComment: boolean;
    openSection: (section: string) => void;
  },
}));
vi.mock("./collab/DocumentSidePanel", async () => {
  const { SectionDiscussionContext } = await import("./collab/sectionDiscussionContext");
  const { useState } = await import("react");
  return {
    default: (props: { children: React.ReactNode }) => {
      sidePanel.props.push(props);
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useState(() => (sidePanel.mounts += 1));
      return (
        <SectionDiscussionContext.Provider value={sidePanel.sections}>{props.children}</SectionDiscussionContext.Provider>
      );
    },
  };
});
// The History view has its own tests: here it records what the page hands
// it, and hands back the document a restore returns.
const historyView = vi.hoisted(() => ({ props: [] as Record<string, unknown>[], restored: null as unknown }));
vi.mock("./collab/DocumentHistoryDialog", () => ({
  default: (props: { onRestored?: (d: unknown) => void }) => {
    historyView.props.push(props);
    return (
      <div role="dialog" aria-label="history-view">
        <button type="button" onClick={() => props.onRestored?.(historyView.restored)}>
          restore-it
        </button>
      </div>
    );
  },
}));
vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
  isAbortError: () => false,
}));
// Permissions gate extension panels; the default is the member the export
// tests were written against.
const authState = vi.hoisted(() => ({
  user: { id: "u1", permissions: {} as Record<string, boolean> },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: authState.user, refreshUser: async () => {} }),
}));
vi.mock("./adrPrint", () => ({ printAdr: vi.fn() }));
// TipTap has no place in jsdom; a textarea carries the same value/onChange
// contract, and each editor's mention context is recorded.
const richText = vi.hoisted(() => ({ contexts: [] as unknown[] }));
vi.mock("./RichTextEditor", () => ({
  default: ({
    value,
    onChange,
    mentionContext,
  }: {
    value: string;
    onChange: (v: string) => void;
    mentionContext?: unknown;
  }) => {
    richText.contexts.push(mentionContext);
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} />;
  },
}));
// The picker has its own tests; the stub hands back a fixed pick (or none).
vi.mock("./SignatureRequestDialog", () => ({
  default: ({
    open,
    onRequest,
    onClose,
    decisionMakers,
    openThreadCount,
  }: {
    open: boolean;
    onRequest: (ids: string[]) => void;
    onClose: () => void;
    decisionMakers?: { display_name: string }[];
    openThreadCount?: number;
  }) =>
    open ? (
      <div
        data-testid="sign-dialog"
        data-makers={(decisionMakers ?? []).map((p) => p.display_name).join(",")}
        data-open-threads={String(openThreadCount)}
      >
        <button type="button" onClick={() => onRequest(["u2", "u3"])}>
          request-two
        </button>
        <button type="button" onClick={() => onRequest([])}>
          request-none
        </button>
        <button type="button" onClick={onClose}>
          close-sign-dialog
        </button>
      </div>
    ) : null,
}));
const exportAdrsToDocx = vi.fn();
vi.mock("./adrExport", () => ({ exportAdrsToDocx: (...a: unknown[]) => exportAdrsToDocx(...a) }));

import { api, ApiError } from "@/api/client";
import { printAdr } from "./adrPrint";
import ADREditor from "./ADREditor";
import { setViewportWidth } from "@/test/matchMedia";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";

const base: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-0001",
  title: "Adopt event bus",
  status: "draft",
  context: "<p>ctx</p>",
  decision: "<p>do it</p>",
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  attributes: {},
  created_by: "u1",
  creator_name: "Ada Lovelace",
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

function mockLoad(adr: ArchitectureDecision) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/adr/")) return adr as never;
    if (path === "/settings/date-format") return { date_format: "YYYY-MM-DD" } as never;
    if (path.startsWith("/cards")) return { items: [] } as never;
    return {} as never;
  });
}

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/ea-delivery/adr/adr-1"]}>
      <Routes>
        <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(printAdr).mockReset();
  exportAdrsToDocx.mockReset();
  authState.user = { id: "u1", permissions: {} };
});


/** Sign through the sign dialog: open it from the toolbar, then confirm. */
async function signThroughDialog(u: { click: (el: Element) => Promise<void> }) {
  await u.click(screen.getByRole("button", { name: /^draw Sign$/ }));
  await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign" }));
}

describe("ADREditor — what the '@' list knows", () => {
  it("hands its text editors the linked cards, and its comments the decision's people too", async () => {
    sidePanel.props = [];
    richText.contexts = [];
    mockLoad({
      ...base,
      linked_cards: [{ id: "c1", name: "SAP", type: "Application" }],
      signatories: [{ user_id: "s1", display_name: "S", status: "pending", signed_at: null }],
      decision_makers: [{ user_id: "m1", display_name: "M" }, { user_id: null, display_name: "Ext" }],
      participants: [{ user_id: "p1", display_name: "P" }, { user_id: "s1", display_name: "S" }],
    });
    renderEditor();
    await screen.findByDisplayValue("Adopt event bus");
    await waitFor(() =>
      expect(sidePanel.props.at(-1)?.mentionContext).toEqual({
        linkedCardIds: ["c1"],
        priorityUserIds: ["s1", "m1", "p1"],
      }),
    );
    const last = richText.contexts.slice(-4);
    expect(last).toEqual(Array(4).fill({ linkedCardIds: ["c1"] }));
  });

  it("hands empty lists for a decision with no links or people", async () => {
    sidePanel.props = [];
    richText.contexts = [];
    mockLoad(base);
    renderEditor();
    await screen.findByDisplayValue("Adopt event bus");
    expect(sidePanel.props.at(-1)?.mentionContext).toEqual({ linkedCardIds: [], priorityUserIds: [] });
    expect(richText.contexts.at(-1)).toEqual({ linkedCardIds: [] });
  });
});

describe("ADREditor — the discussion is read once", () => {
  it("mounts the side panel once for a saved decision, after it has loaded", async () => {
    sidePanel.mounts = 0;
    sidePanel.props = [];
    mockLoad(base);
    renderEditor();
    await screen.findByDisplayValue("Adopt event bus");
    expect(sidePanel.mounts).toBe(1);
    // Never mounted before the load: every render it got carried the decision.
    expect(sidePanel.props.every((p) => (p.owner as { id?: string } | null)?.id === base.id)).toBe(true);
  });
});

describe("ADREditor — export trio in the title bar", () => {
  it("a draft offers Preview, PDF and Word, and PDF prints the live editor state", async () => {
    mockLoad(base);
    renderEditor();
    const pdf = await screen.findByRole("button", { name: /PDF$/ });
    expect(screen.getByRole("button", { name: /Preview$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Word$/ })).toBeInTheDocument();

    // Edit the title, then print: the unsaved edit is what gets exported (SoAW behaviour).
    const title = await screen.findByDisplayValue("Adopt event bus");
    await userEvent.clear(title);
    await userEvent.type(title, "Adopt a message bus");
    await userEvent.click(pdf);

    expect(printAdr).toHaveBeenCalledTimes(1);
    const printed = vi.mocked(printAdr).mock.calls[0][0];
    expect(printed.title).toBe("Adopt a message bus");
    expect(printed.reference_number).toBe("ADR-0001");
    // Audit fields the editor has no state for come from the loaded record.
    expect(printed.creator_name).toBe("Ada Lovelace");
    expect(printed.created_at).toBe("2026-06-01T00:00:00Z");
  });

  it("a signed decision keeps PDF but hides Word, like the SoAW editor", async () => {
    mockLoad({
      ...base,
      status: "signed",
      signed_at: "2026-06-02T09:30:00Z",
      signatories: [{ user_id: "u2", display_name: "Grace", status: "signed", signed_at: "2026-06-02T09:30:00Z" }],
    });
    renderEditor();
    await screen.findByRole("button", { name: /PDF$/ });
    expect(screen.queryByRole("button", { name: /Word$/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Workflow, linking, deep links, extension points
// ---------------------------------------------------------------------------

const IN_REVIEW: ArchitectureDecision = {
  ...base,
  status: "in_review",
  signatories: [
    { user_id: "u1", display_name: "Me", email: "me@x", status: "pending", signed_at: null },
    { user_id: "u2", display_name: "Grace", email: "g@x", status: "signed", signed_at: "2026-06-02T09:30:00Z" },
  ],
};

const SIGNED: ArchitectureDecision = {
  ...base,
  status: "signed",
  revision_number: 2,
  signed_at: "2026-06-03T09:30:00Z",
  signatories: [
    { user_id: "u1", display_name: "Me", email: "me@x", status: "signed", signed_at: "2026-06-03T09:30:00Z" },
    // Signed without a timestamp reads as pending in the list.
    { user_id: "u2", display_name: "Grace", email: "g@x", status: "signed", signed_at: null },
  ],
  linked_cards: [{ id: "card-1", name: "SAP S/4HANA", type: "Application" }],
};

type PostReply = (path: string, body: unknown) => unknown;

/** Serve a loaded ADR (and `/auth/me` as u1); POSTs answer through `onPost`. */
function serve(adr: ArchitectureDecision, onPost: PostReply = () => ({})) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { id: "u1" } as never;
    if (path.startsWith("/adr/")) return adr as never;
    if (path === "/settings/date-format") return { date_format: "YYYY-MM-DD" } as never;
    if (path.startsWith("/cards")) return { items: [] } as never;
    return {} as never;
  });
  vi.mocked(api.post).mockImplementation(async (path: string, body?: unknown) => {
    const out = onPost(path, body);
    if (out instanceof Error) throw out;
    return out as never;
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={["/previous", path]} initialIndex={1}>
      <Routes>
        <Route path="/previous" element={<div data-testid="previous-page" />} />
        <Route path="/ea-delivery/adr/new" element={<ADREditor />} />
        <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
        <Route path="/ea-delivery/adr/:id/preview" element={<div data-testid="preview-page" />} />
        <Route path="/cards/:id" element={<div data-testid="card-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded(adr: ArchitectureDecision, onPost?: PostReply, path = "/ea-delivery/adr/adr-1") {
  serve(adr, onPost);
  renderAt(path);
  await screen.findByDisplayValue(adr.title);
}

describe("ADREditor — new decision", () => {
  it("requires a title, then creates the decision and opens it", async () => {
    serve(base, (path) => (path === "/adr" ? { ...base, id: "adr-new" } : {}));
    renderAt("/ea-delivery/adr/new");
    expect(await screen.findByText("New Architecture Decision")).toBeInTheDocument();
    // No record yet: no Preview, Request Signatures, Duplicate or Linked Cards.
    expect(screen.queryByRole("button", { name: /Preview$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Request Signatures/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Duplicate/ })).toBeNull();
    expect(screen.queryByText("Linked Cards")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Title"), "Use Kafka");
    const [contextBox] = screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA");
    await userEvent.type(contextBox, "Context text");
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/adr", {
        title: "Use Kafka",
        context: "Context text",
        decision: null,
        consequences: null,
        alternatives_considered: null,
        decided_on: null,
        effective_from: null,
        valid_until: null,
        decision_makers: [],
        participants: [],
        links: [],
      }),
    );
    // Lands on the created record, which loads it.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-new", expect.anything()));
  });

  it("reports a failed create", async () => {
    serve(base, () => new Error("boom"));
    renderAt("/ea-delivery/adr/new");
    await userEvent.type(await screen.findByLabelText("Title"), "Use Kafka");
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
  });
});

describe("ADREditor — draft actions", () => {
  it("saves an existing draft with PATCH and confirms", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/adr/adr-1", {
        title: "Adopt event bus",
        context: "<p>ctx</p>",
        decision: "<p>do it</p>",
        consequences: null,
        alternatives_considered: null,
        decided_on: null,
        effective_from: null,
        valid_until: null,
        decision_makers: [],
        participants: [],
        links: [],
      }),
    );
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
  });

  it("shows and dismisses a save error", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("nope"));
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    const alert = await screen.findByText("Failed to save");
    await userEvent.click(within(alert.closest("[role='alert']") as HTMLElement).getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Failed to save")).toBeNull();
  });

  it("shows the load error", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/adr/")) throw new Error("gone");
      return {} as never;
    });
    renderAt("/ea-delivery/adr/adr-1");
    expect(await screen.findByText("Failed to load")).toBeInTheDocument();
  });

  it("titles an existing decision with an empty title as Untitled", async () => {
    serve({ ...base, title: "" });
    renderAt("/ea-delivery/adr/adr-1");
    expect(await screen.findByText("Untitled")).toBeInTheDocument();
  });

  it("duplicates and opens the copy", async () => {
    await renderLoaded(base, (path) =>
      path === "/adr/adr-1/duplicate" ? { ...base, id: "adr-copy" } : {},
    );
    await userEvent.click(screen.getByRole("button", { name: /Duplicate/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-copy", expect.anything()));
  });

  it("reports a failed duplicate", async () => {
    await renderLoaded(base, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(await screen.findByText("Failed to duplicate")).toBeInTheDocument();
  });

  it("requests signatures and moves the decision into review", async () => {
    await renderLoaded(base, (path, body) =>
      path === "/adr/adr-1/request-signatures"
        ? {
            ...base,
            status: "in_review",
            signatories: (body as { user_ids: string[] }).user_ids.map((uid) => ({
              user_id: uid,
              display_name: uid,
              email: "",
              status: "pending",
              signed_at: null,
            })),
          }
        : {},
    );
    await userEvent.click(screen.getByRole("button", { name: /Request Signatures/ }));
    // An empty pick sends nothing.
    await userEvent.click(screen.getByRole("button", { name: "request-none" }));
    expect(api.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "request-two" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/adr/adr-1/request-signatures", { user_ids: ["u2", "u3"] }),
    );
    expect(await screen.findByText("Signature requests sent")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 signatures collected")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
  });

  it("reports a failed signature request and closes the dialog on demand", async () => {
    await renderLoaded(base, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /Request Signatures/ }));
    await userEvent.click(screen.getByRole("button", { name: "request-two" }));
    expect(await screen.findByText("Failed to request signatures")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "close-sign-dialog" }));
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
  });

  it("exports the live editor state to Word", async () => {
    exportAdrsToDocx.mockResolvedValue(undefined);
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: /Word$/ }));
    await waitFor(() => expect(exportAdrsToDocx).toHaveBeenCalledTimes(1));
    expect(exportAdrsToDocx.mock.calls[0][0][0]).toMatchObject({ id: "adr-1", title: "Adopt event bus" });
  });

  it("reports a failed Word export", async () => {
    exportAdrsToDocx.mockRejectedValue(new Error("docx"));
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: /Word$/ }));
    expect(await screen.findByText("Failed to export decisions")).toBeInTheDocument();
  });
});

describe("ADREditor — review actions", () => {
  it("signs as a pending signatory, collecting the last signature", async () => {
    await renderLoaded(IN_REVIEW, (path) =>
      path === "/adr/adr-1/sign"
        ? {
            ...IN_REVIEW,
            status: "signed",
            signed_at: "2026-06-04T00:00:00Z",
            signatories: IN_REVIEW.signatories.map((s) => ({ ...s, status: "signed", signed_at: "2026-06-04" })),
          }
        : {},
    );
    expect(screen.getByText("1 of 2 signatures collected")).toBeInTheDocument();
    await signThroughDialog(userEvent);
    expect(await screen.findByText("Decision fully signed")).toBeInTheDocument();
    expect(screen.getByText(/This decision was signed on/)).toBeInTheDocument();
  });

  it("records a signature that still leaves others pending", async () => {
    await renderLoaded(IN_REVIEW, () => ({ ...IN_REVIEW, signatories: IN_REVIEW.signatories }));
    await signThroughDialog(userEvent);
    expect(await screen.findByText("Signature recorded")).toBeInTheDocument();
  });

  it("reports a failed signature inside the sign dialog, which stays open and can try again", async () => {
    let refuse = true;
    await renderLoaded(IN_REVIEW, (path) =>
      path === "/adr/adr-1/sign" ? (refuse ? new Error("x") : { ...IN_REVIEW, status: "signed" }) : {},
    );
    await signThroughDialog(userEvent);
    const dialog = await screen.findByRole("dialog", { name: "Sign Decision" });
    expect(await within(dialog).findByTestId("review-dialog-error")).toHaveTextContent("Failed to sign");
    // Not (only) on the page behind the backdrop.
    expect(screen.getAllByText("Failed to sign")).toHaveLength(1);
    const confirm = within(dialog).getByRole("button", { name: "Sign" });
    await waitFor(() => expect(confirm).toBeEnabled());

    refuse = false;
    await userEvent.click(confirm);
    expect(await screen.findByText("Decision fully signed")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign Decision" })).toBeNull());
  });

  it("opens the sign dialog afresh, without the last refusal", async () => {
    await renderLoaded(IN_REVIEW, () => new Error("x"));
    await signThroughDialog(userEvent);
    const dialog = await screen.findByRole("dialog", { name: "Sign Decision" });
    await within(dialog).findByTestId("review-dialog-error");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    const again = await screen.findByRole("dialog", { name: "Sign Decision" });
    expect(within(again).queryByTestId("review-dialog-error")).toBeNull();
  });

  it("rejects with a comment, back to a draft that keeps its revision number", async () => {
    await renderLoaded(IN_REVIEW, (path, body) =>
      path === "/adr/adr-1/reject"
        ? { ...IN_REVIEW, status: "draft", signatories: [], comment: body }
        : {},
    );
    await userEvent.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const confirm = dialog.getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    await userEvent.type(dialog.getByLabelText("Reason for rejection"), "  Not costed  ");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/adr/adr-1/reject", { comment: "Not costed" }),
    );
    expect(await screen.findByText("Decision rejected and reset to draft")).toBeInTheDocument();
    expect(screen.getByText("ADR-0001")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("reports a failed rejection and cancels the dialog", async () => {
    await renderLoaded(IN_REVIEW, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Reason for rejection"), "No");
    await userEvent.click(dialog.getByRole("button", { name: "Reject" }));
    expect(await dialog.findByTestId("review-dialog-error", undefined, { timeout: 3000 })).toHaveTextContent(
      "Failed to reject decision",
    );
    // The reason typed is still there, and Reject can be pressed again.
    expect(dialog.getByLabelText("Reason for rejection")).toHaveValue("No");
    await waitFor(() => expect(dialog.getByRole("button", { name: "Reject" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("recalls signatures back to draft", async () => {
    await renderLoaded(IN_REVIEW, () => ({ ...IN_REVIEW, status: "draft", signatories: [] }));
    await userEvent.click(screen.getByRole("button", { name: /Recall Signatures$/ }));
    expect(await screen.findByText("Signatures recalled — decision reset to draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request Signatures/ })).toBeInTheDocument();
  });

  it("reports a failed recall", async () => {
    await renderLoaded(IN_REVIEW, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /Recall Signatures$/ }));
    expect(await screen.findByText("Failed to recall signatures")).toBeInTheDocument();
  });

  it("offers no Sign to a user who is not a pending signatory", async () => {
    await renderLoaded({ ...IN_REVIEW, signatories: [IN_REVIEW.signatories[1]] });
    expect(screen.queryByRole("button", { name: /^draw Sign$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Recall Signatures$/ })).toBeInTheDocument();
  });

  it("opens the sign dialog from ?action=sign for a pending signatory, and the reject dialog from ?action=reject", async () => {
    serve(IN_REVIEW);
    const { unmount } = renderAt("/ea-delivery/adr/adr-1?action=sign");
    expect(await screen.findByRole("dialog", { name: "Sign Decision" })).toBeInTheDocument();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
    unmount();

    renderAt("/ea-delivery/adr/adr-1?action=reject");
    expect(await screen.findByText("Reject Decision")).toBeInTheDocument();
  });

  it("opens the signature request dialog from ?action=sign for anyone not a pending signatory", async () => {
    serve({ ...IN_REVIEW, signatories: [IN_REVIEW.signatories[1]] });
    renderAt("/ea-delivery/adr/adr-1?action=sign");
    expect(await screen.findByTestId("sign-dialog")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Sign Decision" })).toBeNull();
  });
});

describe("ADREditor — signed decision", () => {
  it("is read-only, shows the banner and the signatory list, and revises", async () => {
    authState.user = { id: "u1", permissions: { "adr.manage": true } };
    await renderLoaded(SIGNED, (path) =>
      path === "/adr/adr-1/revise" ? { ...SIGNED, id: "adr-rev" } : {},
    );
    expect(screen.getByText("This decision was signed on 2026-06-03 and is read-only.")).toBeInTheDocument();
    expect(screen.getByText("ADR-0001 · Rev 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add Card/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
    expect(screen.getByText("2 of 2 signatures collected")).toBeInTheDocument();
    expect(screen.getByText(/^Signed: /)).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Revise/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Revise this decision/ }));
    expect(api.post).toHaveBeenCalledWith("/adr/adr-1/revise", {});
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-rev", expect.anything()));
  });

  it("reports a failed revision", async () => {
    authState.user = { id: "u1", permissions: { "adr.manage": true } };
    await renderLoaded(SIGNED, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /Revise/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Revise this decision/ }));
    expect(await screen.findByText("Failed to create revision")).toBeInTheDocument();
  });
});

describe("ADREditor — linked cards", () => {
  const LINKED = { ...base, linked_cards: [{ id: "card-1", name: "SAP S/4HANA", type: "Application" }] };

  it("links a card through the card picker, offering only cards not yet linked", async () => {
    await renderLoaded(LINKED, (path, body) =>
      path === "/adr/adr-1/cards"
        ? {
            ...LINKED,
            linked_cards: [...LINKED.linked_cards, { id: (body as { card_id: string }).card_id, name: "Kafka", type: "ITComponent" }],
          }
        : {},
    );
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/metamodel/")) return [] as never;
      if (path.startsWith("/cards?")) {
        return {
          items: [
            { id: "card-1", name: "SAP S/4HANA", type: "Application" },
            { id: "card-2", name: "Kafka", type: "ITComponent" },
          ],
          total: 2,
        } as never;
      }
      return {} as never;
    });
    await userEvent.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    // The linked card is listed under "Already linked" and not offered.
    expect(dialog.getByText("Already linked")).toBeInTheDocument();
    expect(dialog.getByText("SAP S/4HANA")).toBeInTheDocument();
    // Browse on open: the standard picker lists cards before anything is typed.
    expect(await screen.findByRole("option", { name: "Kafka" })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("/cards?page=1&page_size=50");
    expect(screen.queryByRole("option", { name: "SAP S/4HANA" })).toBeNull();

    await userEvent.type(dialog.getByPlaceholderText("Search cards..."), "ka");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/cards?page=1&page_size=50&search=ka"));
    await userEvent.click(await screen.findByRole("option", { name: "Kafka" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: "card-2" }));
    expect(api.post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Kafka")).toBeInTheDocument();
  });

  it("reports a failed link and cancels", async () => {
    await renderLoaded(LINKED, () => new Error("x"));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/metamodel/")) return [] as never;
      if (path.startsWith("/cards?")) {
        return { items: [{ id: "card-3", name: "Redis", type: "ITComponent" }], total: 1 } as never;
      }
      return {} as never;
    });
    await userEvent.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(await screen.findByRole("option", { name: "Redis" }));
    expect(await screen.findByText("Failed to link", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: "card-3" });
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  describe("link this card", () => {
    const KAFKA_ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
    const SAP_ID = "card-1";
    const mention = (id: string, label: string) =>
      `<span data-type="mention" data-kind="card" data-id="${id}">@${label}</span>`;
    const MENTIONING: ArchitectureDecision = {
      ...LINKED,
      context: `<p>uses ${mention(SAP_ID, "SAP S/4HANA")} and ${mention(KAFKA_ID, "Kafka")}</p>`,
      consequences:
        `<p>${mention(KAFKA_ID, "Kafka")} ` +
        '<span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34"></span></p>',
    };

    it("offers one button per mentioned card that is not linked, and links it", async () => {
      authState.user = { id: "u1", permissions: { "adr.manage": true } };
      await renderLoaded(MENTIONING, (path, body) =>
        path === "/adr/adr-1/cards"
          ? {
              ...MENTIONING,
              linked_cards: [
                ...LINKED.linked_cards,
                { id: (body as { card_id: string }).card_id, name: "Kafka", type: "ITComponent" },
              ],
            }
          : {},
      );
      const hint = within(screen.getByTestId("mentioned-unlinked"));
      expect(hint.getByText("Mentioned in the text but not linked:")).toBeInTheDocument();
      expect(hint.getAllByRole("button").map((b) => b.textContent)).toEqual(["add_linkKafka"]);
      const button = hint.getByRole("button", { name: "add_link Kafka" });
      expect(button).toHaveAccessibleDescription("Link this card");
      await userEvent.click(button);
      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: KAFKA_ID }),
      );
      expect(api.post).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByTestId("mentioned-unlinked")).toBeNull());
    });

    it("is hidden without the permission to link", async () => {
      authState.user = { id: "u1", permissions: {} };
      await renderLoaded(MENTIONING);
      expect(screen.queryByTestId("mentioned-unlinked")).toBeNull();
    });

    it("is hidden on a signed decision", async () => {
      authState.user = { id: "u1", permissions: { "adr.manage": true } };
      await renderLoaded({ ...MENTIONING, status: "signed" });
      expect(screen.queryByTestId("mentioned-unlinked")).toBeNull();
    });

    it("is hidden when every mentioned card is linked", async () => {
      authState.user = { id: "u1", permissions: { "adr.manage": true } };
      await renderLoaded({ ...MENTIONING, context: `<p>${mention(SAP_ID, "SAP S/4HANA")}</p>`, consequences: null });
      expect(screen.getByText("SAP S/4HANA")).toBeInTheDocument();
      expect(screen.queryByTestId("mentioned-unlinked")).toBeNull();
    });
  });

  it("unlinks a card, and reports a failed unlink", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({} as never);
    await renderLoaded({
      ...LINKED,
      linked_cards: [...LINKED.linked_cards, { id: "card-2", name: "Kafka", type: "ITComponent" }],
    });
    const [first] = screen.getAllByRole("button", { name: "Unlink" });
    await userEvent.click(first);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/adr/adr-1/cards/card-1"));
    await waitFor(() => expect(screen.queryByText("SAP S/4HANA")).toBeNull());

    vi.mocked(api.delete).mockRejectedValueOnce(new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(await screen.findByText("Failed to unlink")).toBeInTheDocument();
    expect(screen.getByText("Kafka")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is linked", async () => {
    await renderLoaded(base);
    expect(screen.getByText("No cards linked to this decision.")).toBeInTheDocument();
  });

  it("opens a linked card in the app", async () => {
    await renderLoaded(LINKED);
    await userEvent.click(screen.getByRole("link", { name: "SAP S/4HANA" }));
    expect(screen.getByTestId("card-page")).toBeInTheDocument();
  });
});

describe("ADREditor — navigation and layout", () => {
  it("opens the preview and goes back", async () => {
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: /Preview$/ }));
    expect(screen.getByTestId("preview-page")).toBeInTheDocument();
  });

  it("goes back to where the user came from", async () => {
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: "Back to EA Delivery" }));
    expect(screen.getByTestId("previous-page")).toBeInTheDocument();
  });

  it("collapses the export trio to icon buttons on a phone", async () => {
    setViewportWidth(375);
    exportAdrsToDocx.mockResolvedValue(undefined);
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(printAdr).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Export Word" }));
    await waitFor(() => expect(exportAdrsToDocx).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("preview-page")).toBeInTheDocument();
  });
});

describe("ADREditor — extension points", () => {
  beforeEach(() => resetExtensionHost());
  afterEach(() => resetExtensionHost());

  function Panel(props: { adrId: string; status: string; signed: boolean; readOnly: boolean }) {
    return (
      <div data-testid="adr-panel">
        {props.adrId}|{props.status}|{String(props.signed)}|{String(props.readOnly)}
      </div>
    );
  }

  it("renders panels editable on a draft and the two slots", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        { id: "open", component: Panel },
        { id: "gated", permission: "ext.vs.view", component: () => <div data-testid="gated" /> },
      ],
      slots: [
        {
          slot: "adr.header",
          id: "hdr",
          component: (ctx: Record<string, unknown>) => <span data-testid="header-slot">{String(ctx.status)}</span>,
        },
        {
          slot: "adr.signature.footer",
          id: "ftr",
          component: (ctx: Record<string, unknown>) => <span data-testid="footer-slot">{String(ctx.readOnly)}</span>,
        },
      ],
    });
    await renderLoaded(base);
    expect(screen.getByTestId("adr-panel")).toHaveTextContent("adr-1|draft|false|false");
    expect(screen.queryByTestId("gated")).toBeNull();
    expect(screen.getByTestId("header-slot")).toHaveTextContent("draft");
    expect(screen.getByTestId("footer-slot")).toHaveTextContent("false");
  });

  it("renders a gated panel read-only on a signed decision for a permitted user", async () => {
    authState.user = { id: "u1", permissions: { "ext.vs.view": true } };
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [{ id: "gated", permission: "ext.vs.view", component: Panel }],
    });
    await renderLoaded(SIGNED);
    expect(screen.getByTestId("adr-panel")).toHaveTextContent("adr-1|signed|true|true");
  });
});

// ---------------------------------------------------------------------------
// Decision register: lock, new fields, banners, record, consolidate
// ---------------------------------------------------------------------------

describe("ADREditor — decision register", () => {
  beforeEach(() => resetExtensionHost());
  afterEach(() => resetExtensionHost());

  const ADA = { user_id: "u1", display_name: "Ada" };
  const BOARD = { user_id: null, display_name: "Board" };
  const REVISION: ArchitectureDecision = {
    ...base,
    id: "adr-1",
    revision_number: 2,
    parent_id: "adr-0",
    decided_on: "2026-05-01",
    effective_from: "2026-06-01",
    valid_until: null,
    decision_makers: [ADA, BOARD],
    participants: [],
    change_summary: "Scope narrowed",
    links: {
      outgoing: [
        {
          id: "l1",
          kind: "amends",
          note: "§3",
          decision: {
            id: "adr-9",
            reference_number: "ADR-0009",
            revision_number: 1,
            title: "Nine",
            status: "signed",
            standing: "in_force",
          },
        },
      ],
      incoming: [],
    },
  };

  it("saves the dates, people, links and change summary with the content", async () => {
    vi.mocked(api.patch).mockResolvedValue({} as never);
    await renderLoaded(REVISION);
    expect(screen.getByDisplayValue("Scope narrowed")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Valid until"), { target: { value: "2027-01-31" } });
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/adr/adr-1", {
        title: "Adopt event bus",
        context: "<p>ctx</p>",
        decision: "<p>do it</p>",
        consequences: null,
        alternatives_considered: null,
        decided_on: "2026-05-01",
        effective_from: "2026-06-01",
        valid_until: "2027-01-31",
        decision_makers: [{ user_id: "u1" }, { name: "Board" }],
        participants: [],
        links: [{ decision_id: "adr-9", kind: "amends", note: "§3" }],
        change_summary: "Scope narrowed",
      }),
    );
  });

  it("offers no change summary on a first revision", async () => {
    await renderLoaded(base);
    expect(screen.queryByLabelText("Change summary")).toBeNull();
  });

  it("in review locks the content but keeps the card links, and says how to edit", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        {
          id: "p",
          component: (p: { readOnly: boolean; standing?: unknown; isCurrent?: unknown }) => (
            <div data-testid="panel">{`${p.readOnly}|${String(p.standing)}|${String(p.isCurrent)}`}</div>
          ),
        },
      ],
      slots: [
        {
          slot: "adr.header",
          id: "h",
          component: (ctx: Record<string, unknown>) => <span data-testid="hdr">{String(ctx.readOnly)}</span>,
        },
        {
          slot: "adr.signature.footer",
          id: "f",
          component: (ctx: Record<string, unknown>) => <span data-testid="ftr">{String(ctx.readOnly)}</span>,
        },
      ],
    });
    await renderLoaded({
      ...IN_REVIEW,
      ...REVISION,
      status: "in_review",
      signatories: IN_REVIEW.signatories,
      linked_cards: [{ id: "card-1", name: "SAP S/4HANA", type: "Application" }],
    });
    expect(
      screen.getByText("Sent for review: the content is locked. Recall the signatures to edit it."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save$/ })).toBeNull();
    expect(screen.getByLabelText("Decided on")).toBeDisabled();
    expect(screen.getByLabelText("Effective from")).toBeDisabled();
    expect(screen.getByLabelText("Valid until")).toBeDisabled();
    expect(screen.getByLabelText("Change summary")).toBeDisabled();
    // People and links read back as text, no inputs.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a link/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Amends ADR-0009" })).toBeInTheDocument();
    expect(screen.getByText(/Files are locked with the decision/)).toBeInTheDocument();
    // Card links are filing: still editable in review.
    expect(screen.getByRole("button", { name: /Add Card/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeInTheDocument();
    // Extensions are told to be read-only, except the post-decision footer.
    expect(screen.getByTestId("panel")).toHaveTextContent("true|null|undefined");
    expect(screen.getByTestId("hdr")).toHaveTextContent("true");
    expect(screen.getByTestId("ftr")).toHaveTextContent("false");
  });

  it("a locked decision without links says so", async () => {
    await renderLoaded({ ...SIGNED, links: { outgoing: [], incoming: [] } });
    expect(screen.getByText("No links to other decisions.")).toBeInTheDocument();
  });

  it("passes standing and isCurrent to a panel on a signed decision", async () => {
    registerExtension("vs", {
      key: "vs",
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        {
          id: "p",
          component: (p: { readOnly: boolean; standing?: unknown; isCurrent?: unknown }) => (
            <div data-testid="panel">{`${p.readOnly}|${String(p.standing)}|${String(p.isCurrent)}`}</div>
          ),
        },
      ],
      slots: [
        {
          slot: "adr.header",
          id: "h",
          component: (ctx: Record<string, unknown>) => (
            <span data-testid="hdr">{`${String(ctx.standing)}|${String(ctx.isCurrent)}`}</span>
          ),
        },
      ],
    });
    await renderLoaded({ ...SIGNED, standing: "amended", is_current: true });
    expect(screen.getByTestId("panel")).toHaveTextContent("true|amended|true");
    expect(screen.getByTestId("hdr")).toHaveTextContent("amended|true");
    expect(screen.getByText("In force (amended)")).toBeInTheDocument();
  });

  it("reloads and explains when a save is refused because the decision locked meanwhile", async () => {
    vi.mocked(api.patch).mockImplementationOnce(async () => {
      throw Object.assign(new ApiError("locked"), { status: 403 });
    });
    await renderLoaded(base);
    const loads = () => vi.mocked(api.get).mock.calls.filter(([p]) => p === "/adr/adr-1").length;
    expect(loads()).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    expect(
      await screen.findByText(
        "This decision is locked: it has been sent for review or signed. Its current state has been reloaded.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(loads()).toBe(2));
  });

  it("shows a refused save's problems as readable text, without reloading", async () => {
    vi.mocked(api.patch).mockImplementationOnce(async () => {
      throw Object.assign(new ApiError("bad"), {
        status: 400,
        detail: { error: "same_chain", problems: ["same_chain"] },
      });
    });
    await renderLoaded(base);
    await userEvent.click(screen.getByRole("button", { name: /Save$/ }));
    expect(
      await screen.findByText("A decision cannot be linked to one of its own revisions."),
    ).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([p]) => p === "/adr/adr-1")).toHaveLength(1);
  });

  it("an earlier revision points to the current one and shows its chain", async () => {
    await renderLoaded({
      ...SIGNED,
      id: "adr-1",
      revision_number: 1,
      standing: "superseded",
      is_current: false,
      is_earlier_revision: true,
      superseded_by: { id: "adr-2", reference_number: "ADR-0001", revision_number: 2, title: "x" },
      revisions: [
        { id: "adr-1", reference_number: "ADR-0001", revision_number: 1, title: "x", status: "signed", standing: "superseded" },
        { id: "adr-2", reference_number: "ADR-0001", revision_number: 2, title: "x", status: "signed", standing: "in_force" },
      ],
    });
    expect(
      screen.getByText("This is an earlier revision. The current revision is ADR-0001 · Rev 2."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open current revision" })).toHaveAttribute(
      "href",
      "/ea-delivery/adr/adr-2",
    );
    expect(screen.getByRole("navigation", { name: "Revisions" })).toBeInTheDocument();
    // History sits beside the strip, not among the header actions.
    expect(
      within(screen.getByRole("navigation", { name: "Revisions" }).parentElement as HTMLElement).getByRole("button", {
        name: /History$/,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /History$/ })).toHaveLength(1);
    expect(screen.getByTestId("revision-adr-2")).toHaveTextContent("Rev 2· Current");
  });

  it("creates the consolidated revision of an amended decision and opens it", async () => {
    authState.user = { id: "u1", permissions: { "adr.manage": true } };
    await renderLoaded(
      {
        ...SIGNED,
        standing: "amended",
        amended_by: [
          { id: "m1", reference_number: "ADR-0005", revision_number: 1, title: "A" },
          { id: "m2", reference_number: "ADR-0006", revision_number: 2, title: "B" },
        ],
      },
      (path) => (path === "/adr/adr-1/revise" ? { ...base, id: "adr-cons" } : {}),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create consolidated revision" }));
    expect(api.post).toHaveBeenCalledWith("/adr/adr-1/revise", { consolidates: ["m1", "m2"] });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-cons", expect.anything()));
    expect(await screen.findByText("New revision created")).toBeInTheDocument();
  });

  it("does not offer the consolidated revision without adr.manage", async () => {
    await renderLoaded({
      ...SIGNED,
      standing: "amended",
      amended_by: [{ id: "m1", reference_number: "ADR-0005", revision_number: 1, title: "A" }],
    });
    expect(screen.getByText("This decision is in force and has been amended by:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create consolidated revision" })).toBeNull();
  });

  it("reports a refused consolidated revision", async () => {
    authState.user = { id: "u1", permissions: { "adr.manage": true } };
    await renderLoaded(
      {
        ...SIGNED,
        standing: "amended",
        amended_by: [{ id: "m1", reference_number: "ADR-0005", revision_number: 1, title: "A" }],
      },
      () => Object.assign(new Error("409"), { detail: { error: "not_revisable", reason: "not_latest" } }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create consolidated revision" }));
    expect(
      await screen.findByText("A later revision exists: revise the current revision instead."),
    ).toBeInTheDocument();
  });

  it("renders a recorded decision: Recorded chip and line, no signatures, no signed banner", async () => {
    await renderLoaded({
      ...base,
      status: "signed",
      signed_at: null,
      signatories: [],
      recorded_at: "2026-06-05T08:00:00Z",
      recorded_by: { user_id: "u9", display_name: "Ada" },
      decision_makers: [ADA],
    });
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(screen.getByText("Recorded by Ada on 2026-06-05, not signed in Turbo EA.")).toBeInTheDocument();
    expect(screen.queryByText(/This decision was signed on/)).toBeNull();
    expect(screen.queryByText(/signatures collected/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Signatures" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Request Signatures/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Record as decided/ })).toBeNull();
  });

  it("offers Record as decided on a draft to adr.record holders only", async () => {
    await renderLoaded(base);
    expect(screen.queryByRole("button", { name: /Record as decided/ })).toBeNull();
  });

  it("offers Record as decided to the wildcard", async () => {
    authState.user = { id: "u1", permissions: { "*": true } };
    await renderLoaded(base);
    expect(screen.getByRole("button", { name: "history_edu Record as decided" })).toBeInTheDocument();
  });

  it("does not offer Record as decided in review, even with adr.record", async () => {
    authState.user = { id: "u1", permissions: { "adr.record": true } };
    await renderLoaded(IN_REVIEW);
    expect(screen.queryByRole("button", { name: /Record as decided/ })).toBeNull();
  });

  it("records a draft as decided: saves first, records, and shows it recorded", async () => {
    authState.user = { id: "u1", permissions: { "adr.record": true } };
    vi.mocked(api.patch).mockResolvedValue({} as never);
    const recorded: ArchitectureDecision = {
      ...base,
      decision_makers: [ADA],
      status: "signed",
      decided_on: "2026-01-15",
      effective_from: "2026-01-15",
      recorded_at: "2026-11-10T09:00:00Z",
      recorded_by: { user_id: "u1", display_name: "Ada" },
    };
    await renderLoaded({ ...base, decision_makers: [ADA] }, (path) =>
      path === "/adr/adr-1/record" ? recorded : {},
    );
    // An unsaved edit: it has to reach the server before the record does.
    await userEvent.type(screen.getByLabelText("Title"), " now");
    await userEvent.click(screen.getByRole("button", { name: /Record as decided/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByTestId("record-decided-on"), { target: { value: "2026-01-15" } });
    await userEvent.click(dialog.getByRole("button", { name: "Record" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/adr/adr-1/record", { decided_on: "2026-01-15" }),
    );
    // The pending edits went first, so the backend sees the decision makers on screen.
    expect(api.patch).toHaveBeenCalledWith(
      "/adr/adr-1",
      expect.objectContaining({ title: "Adopt event bus now", decision_makers: [{ user_id: "u1" }] }),
    );
    expect(vi.mocked(api.patch).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.post).mock.invocationCallOrder[0],
    );
    expect(await screen.findByText("Decision recorded")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
  });

  it("says why a signature request was refused", async () => {
    await renderLoaded(base, () =>
      Object.assign(new Error("409"), {
        detail: { error: "link_target_not_locked", problems: ["link_target_not_locked"], target_ids: ["x"] },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Request Signatures/ }));
    await userEvent.click(screen.getByRole("button", { name: "request-two" }));
    expect(await screen.findByText("Every linked decision must be signed first.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to request signatures")).toBeNull();
  });

  it("hands the decision makers to the signature dialog", async () => {
    await renderLoaded({ ...base, decision_makers: [ADA] });
    await userEvent.click(screen.getByRole("button", { name: /Request Signatures/ }));
    expect(screen.getByTestId("sign-dialog")).toHaveAttribute("data-makers", "Ada");
  });
});

describe("ADREditor — discussion and review notes", () => {
  it("marks the sections that have threads beside their headings, and opens the discussion on one", async () => {
    const openSection = vi.fn();
    sidePanel.sections = {
      counts: { alternatives_considered: { open: 2, total: 3 }, consequences: { open: 0, total: 1 } },
      canComment: false,
      openSection,
    };
    try {
      await renderLoaded(base);
      const markers = screen.getAllByTestId(/^section-marker-/).map((m) => m.dataset.testid);
      expect(markers).toEqual(["section-marker-alternatives_considered", "section-marker-consequences"]);
      const open = screen.getByRole("button", { name: "2 open threads on this section" });
      expect(within(open.parentElement!).getByRole("heading", { name: "Alternatives Considered" })).toBeInTheDocument();
      const done = screen.getByRole("button", { name: "Resolved discussion on this section" });
      expect(within(done.parentElement!).getByRole("heading", { name: "Consequences" })).toBeInTheDocument();
      await userEvent.click(open);
      expect(openSection).toHaveBeenCalledWith("alternatives_considered");
    } finally {
      sidePanel.sections = null;
    }
  });

  it("marks every section for a reader who may comment, and opens the discussion on a quiet one", async () => {
    const openSection = vi.fn();
    sidePanel.sections = { counts: { context: { open: 1, total: 1 } }, canComment: true, openSection };
    try {
      await renderLoaded(base);
      const markers = screen.getAllByTestId(/^section-marker-/).map((m) => m.dataset.testid);
      expect(markers).toContain("section-marker-context");
      expect(markers).toContain("section-marker-consequences");
      const add = screen.getByTestId("section-marker-consequences");
      expect(add).toHaveAccessibleName("Comment on this section");
      await userEvent.click(add);
      expect(openSection).toHaveBeenCalledWith("consequences");
    } finally {
      sidePanel.sections = null;
    }
  });

  it("mounts the side panel on a saved decision with its owner, status and sections", async () => {
    sidePanel.props.length = 0;
    await renderLoaded({ ...base, open_thread_count: 3, updated_at: "2026-11-01T00:00:00Z" });
    const props = sidePanel.props[sidePanel.props.length - 1];
    expect(props.owner).toEqual({ kind: "adr", id: "adr-1" });
    // History is not the side panel's: it opens from the header.
    expect(props).not.toHaveProperty("status");
    expect(props).not.toHaveProperty("onRestored");
    expect(props).not.toHaveProperty("isDirty");
    expect(props.openThreadCount).toBe(3);
    expect(props.refreshKey).toBe("2026-11-01T00:00:00Z");
    expect((props.sections as { key: string }[]).map((s) => s.key)).toEqual([
      "general",
      "context",
      "decision",
      "alternatives_considered",
      "consequences",
    ]);
  });

  it("shows History in the header of a saved decision and opens it with what a restore needs", async () => {
    historyView.props.length = 0;
    await renderLoaded({ ...base, updated_at: "2026-11-01T00:00:00Z" });
    await userEvent.click(screen.getByRole("button", { name: /History$/ }));
    expect(screen.getByRole("dialog", { name: "history-view" })).toBeInTheDocument();
    const props = historyView.props[historyView.props.length - 1];
    expect(props).toMatchObject({
      owner: { kind: "adr", id: "adr-1" },
      status: "draft",
      refreshKey: "2026-11-01T00:00:00Z",
    });
    expect(props.label).toMatch(/ · /);
    expect((props.isDirty as () => boolean)()).toBe(false);
  });

  it("gives a new decision no side panel owner", async () => {
    sidePanel.props.length = 0;
    serve(base);
    renderAt("/ea-delivery/adr/new");
    expect(await screen.findByText("New Architecture Decision")).toBeInTheDocument();
    expect(sidePanel.props[sidePanel.props.length - 1].owner).toBeNull();
    expect(screen.queryByRole("button", { name: /History$/ })).toBeNull();
  });

  it("applies a restored version through the same path as a save", async () => {
    await renderLoaded(base);
    historyView.restored = { ...base, title: "Restored title" };
    await userEvent.click(screen.getByRole("button", { name: /History$/ }));
    await userEvent.click(screen.getByRole("button", { name: "restore-it" }));
    expect(await screen.findByDisplayValue("Restored title")).toBeInTheDocument();
    expect(await screen.findByText("Version restored")).toBeInTheDocument();
  });

  it("signs with a note sent as the comment, and warns about open threads", async () => {
    await renderLoaded({ ...IN_REVIEW, open_thread_count: 2 }, () => ({ ...IN_REVIEW, open_thread_count: 2 }));
    await userEvent.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Sign Decision")).toBeInTheDocument();
    expect(dialog.getByTestId("open-threads-warning")).toHaveTextContent("2 open discussion threads on this document.");
    await userEvent.type(dialog.getByLabelText("Note (optional)"), "  Agreed  ");
    await userEvent.click(dialog.getByRole("button", { name: "Sign" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/adr/adr-1/sign", { comment: "Agreed" }));
  });

  it("shows no warning without open threads, and the side panel's live count once it reports", async () => {
    sidePanel.props.length = 0;
    await renderLoaded({ ...IN_REVIEW, open_thread_count: 0 });
    await userEvent.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    expect(within(await screen.findByRole("dialog")).queryByTestId("open-threads-warning")).toBeNull();
    const report = sidePanel.props[sidePanel.props.length - 1].onOpenCountChange as (n: number) => void;
    await waitFor(() => report(1));
    expect(await screen.findByText("1 open discussion thread on this document.")).toBeInTheDocument();
  });

  it("warns in the reject dialog and refuses a reason over 4000 characters", async () => {
    await renderLoaded({ ...IN_REVIEW, open_thread_count: 1 });
    await userEvent.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByTestId("open-threads-warning")).toHaveTextContent("1 open discussion thread on this document.");
    const field = dialog.getByLabelText("Reason for rejection");
    fireEvent.change(field, { target: { value: "x".repeat(4001) } });
    expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(dialog.getByText("4001 / 4000")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "x".repeat(4000) } });
    expect(dialog.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("hands the open-thread count to the signature request dialog", async () => {
    await renderLoaded({ ...base, open_thread_count: 4 });
    await userEvent.click(screen.getByRole("button", { name: /Request Signatures/ }));
    expect(await screen.findByTestId("sign-dialog")).toHaveAttribute("data-open-threads", "4");
  });
});
