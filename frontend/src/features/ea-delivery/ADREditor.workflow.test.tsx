/**
 * ADREditor — review findings F1–F3: pending edits are saved before a
 * workflow step locks the decision, every action reply refreshes the whole
 * page (links, standing, banners), and only the latest load may fill it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import type { ArchitectureDecision, DecisionLinks } from "@/types";

// The discussion and history side panel has its own tests: here the page
// renders alone, and the props it hands the panel are recorded.
const sidePanel = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./collab/DocumentSidePanel", () => ({
  default: (props: { children: unknown }) => {
    sidePanel.props.push(props);
    return props.children;
  },
}));
vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status = 0;
  },
  isAbortError: () => false,
}));
const authState = vi.hoisted(() => ({
  user: { id: "u1", permissions: {} as Record<string, boolean> },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: authState.user, refreshUser: async () => {} }),
}));
vi.mock("@/features/ea-delivery/adrPrint", () => ({ printAdr: vi.fn() }));
vi.mock("@/features/ea-delivery/adrExport", () => ({ exportAdrsToDocx: vi.fn() }));
vi.mock("@/features/ea-delivery/RichTextEditor", () => ({
  default: ({
    content,
    onChange,
    placeholder,
    readOnly,
  }: {
    content: string;
    onChange: (v: string) => void;
    placeholder?: string;
    readOnly?: boolean;
  }) => (
    <textarea
      placeholder={placeholder}
      value={content}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock("@/features/ea-delivery/SignatureRequestDialog", () => ({
  default: ({ open, onRequest }: { open: boolean; onRequest: (ids: string[]) => void }) =>
    open ? (
      <div data-testid="sign-dialog">
        <button type="button" onClick={() => onRequest(["u2"])}>
          request-one
        </button>
      </div>
    ) : null,
}));

import { api, ApiError } from "@/api/client";
import { invalidateDateFormat } from "@/hooks/useDateFormat";
import ADREditor from "./ADREditor";

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
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const PENDING_ME = {
  user_id: "u1",
  display_name: "Me",
  email: "me@x",
  status: "pending" as const,
  signed_at: null,
};

const IN_REVIEW: ArchitectureDecision = { ...base, status: "in_review", signatories: [PENDING_ME] };

const LINKS: DecisionLinks = {
  outgoing: [
    {
      id: "l1",
      kind: "relates",
      note: null,
      decision: {
        id: "d7",
        reference_number: "ADR-0007",
        revision_number: 1,
        title: "Use Kafka",
        status: "signed",
        standing: "in_force",
      },
    },
  ],
  incoming: [],
};

type Reply = (path: string, body?: unknown) => unknown;

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** `/auth/me` as u1, records by id from `records` (a value or a promise). */
function serve(
  records: Record<string, unknown>,
  opts: { post?: Reply; patch?: Reply } = {},
) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { id: "u1" } as never;
    if (path.endsWith("/files")) return [] as never;
    const m = /^\/adr\/([^/?]+)$/.exec(path);
    if (m) {
      await new Promise((r) => setTimeout(r, 0));
      return (await records[m[1]]) as never;
    }
    return {} as never;
  });
  const answer = (fn?: Reply) => async (path: string, body?: unknown) => {
    const out = fn ? await fn(path, body) : {};
    if (out instanceof Error) throw out;
    return out as never;
  };
  vi.mocked(api.post).mockImplementation(answer(opts.post));
  vi.mocked(api.patch).mockImplementation(answer(opts.patch));
  vi.mocked(api.delete).mockImplementation(answer());
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go-{to}
    </button>
  );
}

function renderAt(path = "/ea-delivery/adr/adr-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
      </Routes>
      <GoTo to="/ea-delivery/adr/adr-2" />
    </MemoryRouter>,
  );
}

async function renderLoaded(adr: ArchitectureDecision, opts: { post?: Reply; patch?: Reply } = {}) {
  serve({ [adr.id]: adr }, opts);
  renderAt(`/ea-delivery/adr/${adr.id}`);
  await screen.findByDisplayValue(adr.title);
}

const patchCalls = () => vi.mocked(api.patch).mock.calls;
const postsTo = (path: string) => vi.mocked(api.post).mock.calls.filter(([p]) => p === path);
const requestButton = () => screen.getByRole("button", { name: /Request Signatures/ });

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  authState.user = { id: "u1", permissions: {} };
  invalidateDateFormat("YYYY-MM-DD");
});

// ---------------------------------------------------------------------------
// F1 — pending edits are saved before the decision is locked
// ---------------------------------------------------------------------------


/** Sign through the sign dialog: open it from the toolbar, then confirm. */
async function signThroughDialog(u: { click: (el: Element) => Promise<void> }) {
  await u.click(screen.getByRole("button", { name: /^draw Sign$/ }));
  await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign" }));
}

describe("ADREditor — requesting signatures saves pending edits first", () => {
  it("edits + request: PATCHes the edited content, then opens the dialog, then requests", async () => {
    await renderLoaded(base, {
      patch: (_p, body) => ({ ...base, ...(body as object), title: "Adopt a message bus" }),
      post: (path) =>
        path === "/adr/adr-1/request-signatures"
          ? { ...base, title: "Adopt a message bus", status: "in_review", signatories: [PENDING_ME] }
          : {},
    });
    const user = userEvent.setup();
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Adopt a message bus");

    await user.click(requestButton());
    await screen.findByTestId("sign-dialog");
    expect(patchCalls()).toEqual([
      [
        "/adr/adr-1",
        {
          title: "Adopt a message bus",
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
        },
      ],
    ]);
    expect(api.post).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "request-one" }));
    await waitFor(() => expect(postsTo("/adr/adr-1/request-signatures")).toHaveLength(1));
    expect(postsTo("/adr/adr-1/request-signatures")[0][1]).toEqual({ user_ids: ["u2"] });
    expect(vi.mocked(api.patch).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.post).mock.invocationCallOrder[0],
    );
    expect(await screen.findByText("Signature requests sent")).toBeInTheDocument();
    // No "Saved successfully" toast for the implicit save.
    expect(screen.queryByText("Saved successfully")).toBeNull();
    expect(screen.getByLabelText("Title")).toHaveValue("Adopt a message bus");
    expect(screen.getByLabelText("Title")).toBeDisabled();
  });

  it("a failed save shows its error and neither opens the dialog nor requests", async () => {
    await renderLoaded(base, { patch: () => new Error("down") });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(requestButton());
    expect(await screen.findByText("Failed to save")).toBeInTheDocument();
    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0][1]).toMatchObject({ title: "Adopt event bus!" });
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    // The edit stays on screen, still editable.
    expect(screen.getByLabelText("Title")).toHaveValue("Adopt event bus!");
    expect(screen.getByLabelText("Title")).toBeEnabled();
  });

  it("a save refused because the decision locked meanwhile reloads it and opens nothing", async () => {
    await renderLoaded(base, {
      patch: () => Object.assign(new ApiError("locked"), { status: 403 }),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(requestButton());
    expect(
      await screen.findByText(
        "This decision is locked: it has been sent for review or signed. Its current state has been reloaded.",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.filter(([p]) => p === "/adr/adr-1")).toHaveLength(2),
    );
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("an emptied title is refused before anything is sent", async () => {
    await renderLoaded(base);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Title"));
    await user.click(requestButton());
    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
  });

  it("no edits: the dialog opens with no redundant PATCH", async () => {
    await renderLoaded({ ...base, links: LINKS, decided_on: "2026-01-02" }, {
      post: () => ({ ...base, status: "in_review", signatories: [PENDING_ME] }),
    });
    const user = userEvent.setup();
    await user.click(requestButton());
    await screen.findByTestId("sign-dialog");
    await user.click(screen.getByRole("button", { name: "request-one" }));
    expect(await screen.findByText("Signature requests sent")).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("an edit undone again is no edit", async () => {
    await renderLoaded(base);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "x");
    await user.type(screen.getByLabelText("Title"), "{Backspace}");
    await user.click(requestButton());
    await screen.findByTestId("sign-dialog");
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("after a save, the saved content is the baseline: no second PATCH on request", async () => {
    await renderLoaded(base, {
      patch: (_p, body) => ({ ...base, title: (body as { title: string }).title }),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: /Save$/ }));
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
    await user.click(requestButton());
    await screen.findByTestId("sign-dialog");
    expect(patchCalls()).toHaveLength(1);
  });

  it("record as decided with no edits records without a PATCH", async () => {
    authState.user = { id: "u1", permissions: { "adr.record": true } };
    const maker = { user_id: "u1", display_name: "Ada" };
    await renderLoaded({ ...base, decision_makers: [maker] }, {
      post: (path) =>
        path === "/adr/adr-1/record"
          ? { ...base, decision_makers: [maker], status: "signed", recorded_at: "2026-11-10T09:00:00Z" }
          : {},
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Record as decided/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByTestId("record-decided-on"), { target: { value: "2026-01-15" } });
    await user.click(dialog.getByRole("button", { name: "Record" }));
    expect(await screen.findByText("Decision recorded")).toBeInTheDocument();
    expect(postsTo("/adr/adr-1/record")).toHaveLength(1);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("record as decided whose pre-save fails records nothing and says why in the dialog", async () => {
    authState.user = { id: "u1", permissions: { "adr.record": true } };
    await renderLoaded(
      { ...base, decision_makers: [{ user_id: "u1", display_name: "Ada" }] },
      { patch: () => new Error("down") },
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: /Record as decided/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByTestId("record-decided-on"), { target: { value: "2026-01-15" } });
    await user.click(dialog.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(await dialog.findByText("Failed to record the decision")).toBeInTheDocument();
    expect(postsTo("/adr/adr-1/record")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F2 — every reply that is the detail refreshes the page through one path
// ---------------------------------------------------------------------------

describe("ADREditor — action replies refresh the links, standing and banners", () => {
  it("save: the links block shows the targets the reply names", async () => {
    await renderLoaded(base, { patch: () => ({ ...base, links: LINKS }) });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "!");
    await user.click(screen.getByRole("button", { name: /Save$/ }));
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
    // The editable row now holds the reply's link, labelled from it.
    expect(screen.getByLabelText("Decision")).toHaveValue("ADR-0007 — Use Kafka");
    // And the title is what the server stored.
    expect(screen.getByLabelText("Title")).toHaveValue("Adopt event bus");
  });

  it("request signatures: the read-only links come from the reply", async () => {
    await renderLoaded(base, {
      post: () => ({ ...base, status: "in_review", signatories: [PENDING_ME], links: LINKS }),
    });
    const user = userEvent.setup();
    expect(screen.queryByTestId("link-outgoing-d7")).toBeNull();
    await user.click(requestButton());
    await user.click(await screen.findByRole("button", { name: "request-one" }));
    const row = await screen.findByTestId("link-outgoing-d7");
    expect(row).toHaveTextContent("Relates to ADR-0007— Use KafkaIn force");
    expect(
      screen.getByText("Sent for review: the content is locked. Recall the signatures to edit it."),
    ).toBeInTheDocument();
  });

  it("the final signature: the standing chip and banner come from the reply", async () => {
    await renderLoaded(IN_REVIEW, {
      post: () => ({
        ...IN_REVIEW,
        status: "signed",
        signed_at: "2026-11-10T12:00:00Z",
        signatories: [{ ...PENDING_ME, status: "signed", signed_at: "2026-11-10T12:00:00Z" }],
        standing: "scheduled",
        effective_from: "2026-12-01",
        links: LINKS,
      }),
    });
    const user = userEvent.setup();
    expect(screen.queryByText("Scheduled")).toBeNull();
    await signThroughDialog(user);
    expect(await screen.findByText("Decision fully signed")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("This decision takes effect on 2026-12-01.")).toBeInTheDocument();
    expect(screen.getByTestId("link-outgoing-d7")).toBeInTheDocument();
    expect(screen.getByLabelText("Effective from")).toHaveValue("2026-12-01");
  });

  it("recall: the reply's links and dates replace the page's", async () => {
    await renderLoaded({ ...IN_REVIEW, links: LINKS }, {
      post: () => ({ ...base, status: "draft", valid_until: "2027-01-31", links: { outgoing: [], incoming: [] } }),
    });
    const user = userEvent.setup();
    expect(screen.getByTestId("link-outgoing-d7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Recall Signatures/ }));
    expect(
      await screen.findByText("Signatures recalled — decision reset to draft"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("link-outgoing-d7")).toBeNull();
    expect(screen.queryByLabelText("Decision")).toBeNull();
    expect(screen.getByLabelText("Valid until")).toHaveValue("2027-01-31");
    expect(
      screen.queryByText("Sent for review: the content is locked. Recall the signatures to edit it."),
    ).toBeNull();
  });

  it("reject: the reply's content fills the draft again", async () => {
    await renderLoaded(IN_REVIEW, {
      post: () => ({ ...base, status: "draft", context: "<p>as stored</p>", links: LINKS }),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason for rejection"), "No");
    await user.click(dialog.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Decision rejected and reset to draft")).toBeInTheDocument();
    expect(screen.getByDisplayValue("<p>as stored</p>")).toBeInTheDocument();
    expect(screen.getByLabelText("Decision")).toHaveValue("ADR-0007 — Use Kafka");
  });

  it("a reply for another decision than the one on screen is not applied", async () => {
    const sign = deferred();
    const adr2 = { ...IN_REVIEW, id: "adr-2", title: "Second decision" };
    serve({ "adr-1": IN_REVIEW, "adr-2": adr2 }, { post: () => sign.promise });
    renderAt();
    await screen.findByDisplayValue(IN_REVIEW.title);
    const user = userEvent.setup();
    await signThroughDialog(user);
    // The sign dialog stays open while the request is in flight; the page
    // behind it is still navigated.
    await user.click(screen.getByRole("button", { name: "go-/ea-delivery/adr/adr-2", hidden: true }));
    await screen.findByDisplayValue("Second decision");
    sign.resolve({ ...IN_REVIEW, status: "signed", standing: "in_force", title: "Signed first" });
    expect(await screen.findByText("Decision fully signed")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Second decision");
    expect(screen.queryByText("In force")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F3 — only the latest load fills the page
// ---------------------------------------------------------------------------

describe("ADREditor — revision navigation race", () => {
  it("a late reply for the revision just left is ignored, and Save writes the open one", async () => {
    const first = deferred();
    const second = deferred();
    const adr2 = { ...base, id: "adr-2", title: "Revision two", revision_number: 2 };
    serve({ "adr-1": first.promise, "adr-2": second.promise }, { patch: () => ({}) });
    renderAt();
    const user = userEvent.setup();
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([p]) => p === "/adr/adr-1")).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "go-/ea-delivery/adr/adr-2" }));
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([p]) => p === "/adr/adr-2")).toBe(true),
    );

    second.resolve(adr2);
    await screen.findByDisplayValue("Revision two");
    first.resolve({ ...base, title: "Revision one (late)" });
    // Let the late reply settle; it must not land.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByLabelText("Title")).toHaveValue("Revision two");
    expect(screen.queryByDisplayValue("Revision one (late)")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(patchCalls()[0][0]).toBe("/adr/adr-2");
    expect(patchCalls()[0][1]).toMatchObject({ title: "Revision two" });
  });

  it("a late failure for the revision just left shows no error", async () => {
    const first = deferred();
    serve({ "adr-1": first.promise, "adr-2": { ...base, id: "adr-2", title: "Revision two" } });
    renderAt();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "go-/ea-delivery/adr/adr-2" }));
    await screen.findByDisplayValue("Revision two");
    first.reject(new Error("gone"));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Failed to load")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
