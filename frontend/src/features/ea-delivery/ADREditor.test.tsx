import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ArchitectureDecision } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
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
// TipTap has no place in jsdom; a textarea carries the same value/onChange contract.
vi.mock("./RichTextEditor", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
// The picker has its own tests; the stub hands back a fixed pick (or none).
vi.mock("./SignatureRequestDialog", () => ({
  default: ({
    open,
    onRequest,
    onClose,
  }: {
    open: boolean;
    onRequest: (ids: string[]) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="sign-dialog">
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

import { api } from "@/api/client";
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
      }),
    );
    // Lands on the created record, which loads it.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-new"));
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
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-copy"));
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
    expect(screen.getByText("in review")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    expect(await screen.findByText("Decision fully signed")).toBeInTheDocument();
    expect(screen.getByText(/This decision was signed on/)).toBeInTheDocument();
  });

  it("records a signature that still leaves others pending", async () => {
    await renderLoaded(IN_REVIEW, () => ({ ...IN_REVIEW, signatories: IN_REVIEW.signatories }));
    await userEvent.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    expect(await screen.findByText("Signature recorded")).toBeInTheDocument();
  });

  it("reports a failed signature", async () => {
    await renderLoaded(IN_REVIEW, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    expect(await screen.findByText("Failed to sign")).toBeInTheDocument();
  });

  it("rejects with a comment, resetting to a new draft revision", async () => {
    await renderLoaded(IN_REVIEW, (path, body) =>
      path === "/adr/adr-1/reject"
        ? { ...IN_REVIEW, status: "draft", revision_number: 2, signatories: [], comment: body }
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
    expect(screen.getByText("Revision 2")).toBeInTheDocument();
  });

  it("reports a failed rejection and cancels the dialog", async () => {
    await renderLoaded(IN_REVIEW, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByLabelText("Reason for rejection"), "No");
    await userEvent.click(dialog.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Failed to reject decision", undefined, { timeout: 3000 })).toBeInTheDocument();
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

  it("opens the sign or the reject dialog from a deep link", async () => {
    serve(IN_REVIEW);
    const { unmount } = renderAt("/ea-delivery/adr/adr-1?action=sign");
    expect(await screen.findByTestId("sign-dialog")).toBeInTheDocument();
    unmount();

    renderAt("/ea-delivery/adr/adr-1?action=reject");
    expect(await screen.findByText("Reject Decision")).toBeInTheDocument();
  });
});

describe("ADREditor — signed decision", () => {
  it("is read-only, shows the banner and the signatory list, and revises", async () => {
    await renderLoaded(SIGNED, (path) =>
      path === "/adr/adr-1/revise" ? { ...SIGNED, id: "adr-rev" } : {},
    );
    expect(screen.getByText(/This decision was signed on .* \(Revision 2\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add Card/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
    expect(screen.getByText("2 of 2 signatures collected")).toBeInTheDocument();
    expect(screen.getByText(/^Signed: /)).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /New Revision/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/adr/adr-rev"));
  });

  it("reports a failed revision", async () => {
    await renderLoaded(SIGNED, () => new Error("x"));
    await userEvent.click(screen.getByRole("button", { name: /New Revision/ }));
    expect(await screen.findByText("Failed to create revision")).toBeInTheDocument();
  });
});

describe("ADREditor — linked cards", () => {
  const LINKED = { ...base, linked_cards: [{ id: "card-1", name: "SAP S/4HANA", type: "Application" }] };

  it("searches, links a card and refuses one already linked", async () => {
    await renderLoaded(LINKED, (path, body) =>
      path === "/adr/adr-1/cards"
        ? {
            ...LINKED,
            linked_cards: [...LINKED.linked_cards, { id: (body as { card_id: string }).card_id, name: "Kafka", type: "ITComponent" }],
          }
        : {},
    );
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?search=")) {
        return {
          items: [
            { id: "card-1", name: "SAP S/4HANA", type: "Application" },
            { id: "card-2", name: "Kafka", type: "ITComponent" },
          ],
        } as never;
      }
      return {} as never;
    });
    await userEvent.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByPlaceholderText("Search cards..."), "ka");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/cards?search=ka&page_size=20"));
    expect(await dialog.findByText("Kafka")).toBeInTheDocument();
    expect(dialog.getByText("Already linked")).toBeInTheDocument();
    expect(dialog.getByText("SAP S/4HANA").closest("[role='button']")).toHaveAttribute("aria-disabled", "true");

    // Clearing the box clears the results.
    await userEvent.clear(dialog.getByPlaceholderText("Search cards..."));
    expect(dialog.queryByText("Kafka")).toBeNull();

    await userEvent.type(dialog.getByPlaceholderText("Search cards..."), "k");
    await userEvent.click(await dialog.findByText("Kafka"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: "card-2" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Kafka")).toBeInTheDocument();
  });

  it("keeps the dialog usable when the search fails, reports a failed link, and cancels", async () => {
    await renderLoaded(LINKED, () => new Error("x"));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/cards?search=x&page_size=20") throw new Error("search down");
      return { items: [{ id: "card-3", name: "Redis", type: "ITComponent" }] } as never;
    });
    await userEvent.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.type(dialog.getByPlaceholderText("Search cards..."), "x");
    expect(dialog.queryByText("Redis")).toBeNull();
    await userEvent.type(dialog.getByPlaceholderText("Search cards..."), "y");
    await userEvent.click(await dialog.findByText("Redis"));
    expect(await screen.findByText("Failed to link", undefined, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
