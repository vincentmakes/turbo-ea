/**
 * ADREditor — the branches the main suite runs but does not pin: first paint,
 * what each workflow reply does to the page, the busy states, deep links and
 * the extension gates. Every mock uses the `@/` alias so it also matches when
 * the editor is imported from a copy outside the tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import type { ArchitectureDecision, SoAWSignatory } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
const authState = vi.hoisted(() => ({
  user: { id: "u1", permissions: {} } as { id: string; permissions: Record<string, boolean> } | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: authState.user, refreshUser: async () => {} }),
}));
vi.mock("@/features/ea-delivery/adrPrint", () => ({ printAdr: vi.fn() }));
// TipTap has no place in jsdom; a textarea carries the same props.
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
// The picker has its own tests; the stub shows what the editor hands it.
vi.mock("@/features/ea-delivery/SignatureRequestDialog", () => ({
  default: ({
    open,
    onRequest,
    onClose,
    title,
    description,
    requesting,
  }: {
    open: boolean;
    onRequest: (ids: string[]) => void;
    onClose: () => void;
    title: string;
    description: string;
    requesting: boolean;
  }) =>
    open ? (
      <div data-testid="sign-dialog" data-requesting={String(requesting)}>
        <span data-testid="sign-dialog-title">{title}</span>
        <span data-testid="sign-dialog-description">{description}</span>
        <button type="button" onClick={() => onRequest(["u2"])}>
          request-one
        </button>
        <button type="button" onClick={onClose}>
          close-sign-dialog
        </button>
      </div>
    ) : null,
}));
vi.mock("@/features/ea-delivery/adrExport", () => ({ exportAdrsToDocx: vi.fn() }));

import { api } from "@/api/client";
import { printAdr } from "@/features/ea-delivery/adrPrint";
import { invalidateDateFormat } from "@/hooks/useDateFormat";
import { resetPageTitle, usePageTitleSlots } from "@/hooks/usePageTitle";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import { STATUS_COLORS } from "@/theme/tokens";
import ADREditor from "./ADREditor";

// ---------------------------------------------------------------------------
// Fixtures and harness
// ---------------------------------------------------------------------------

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

const ME_PENDING: SoAWSignatory = {
  user_id: "u1",
  display_name: "Me",
  email: "me@x",
  status: "pending",
  signed_at: null,
};
const ME_SIGNED: SoAWSignatory = { ...ME_PENDING, status: "signed", signed_at: "2026-06-03T12:00:00Z" };
const GRACE_PENDING: SoAWSignatory = {
  user_id: "u2",
  display_name: "Grace",
  email: "g@x",
  status: "pending",
  signed_at: null,
};
const GRACE_SIGNED: SoAWSignatory = { ...GRACE_PENDING, status: "signed", signed_at: "2026-06-02T12:00:00Z" };

const IN_REVIEW: ArchitectureDecision = {
  ...base,
  status: "in_review",
  signatories: [ME_PENDING, GRACE_SIGNED],
};

type Reply = (path: string, body?: unknown) => unknown;

interface ServeOptions {
  post?: Reply;
  patch?: Reply;
  /** Overrides the loaded record — may return a promise to hold the load. */
  adr?: () => unknown;
  /** Answers `/cards?search=…`. */
  cards?: (path: string) => unknown;
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

/**
 * Serve `/auth/me` as u1 strictly before the record: the record waits a macrotask,
 * by which time every microtask of the `/auth/me` chain (the editor's `then`
 * included) has run, so the signatory checks are settled once the record shows.
 */
function serve(adr: ArchitectureDecision, opts: ServeOptions = {}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { id: "u1" } as never;
    if (path.startsWith("/adr/")) {
      await new Promise((r) => setTimeout(r, 0));
      return (await (opts.adr ? opts.adr() : adr)) as never;
    }
    if (path.startsWith("/cards?search=")) {
      return (opts.cards ? opts.cards(path) : { items: [] }) as never;
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

const keysSeen: string[] = [];

function LocationProbe() {
  const loc = useLocation();
  useEffect(() => {
    keysSeen.push(loc.key);
  }, [loc.key]);
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function SubjectProbe() {
  const { subject } = usePageTitleSlots();
  return <div data-testid="page-subject">{subject?.text ?? ""}</div>;
}

/** Stands in for a deep link followed while the editor is already open. */
function DeepLink({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      follow-deep-link
    </button>
  );
}

function renderAt(path: string, deepLink?: string) {
  return render(
    <MemoryRouter initialEntries={["/previous", path]} initialIndex={1}>
      <Routes>
        <Route path="/previous" element={<div data-testid="previous-page" />} />
        <Route path="/ea-delivery/adr/new" element={<ADREditor />} />
        <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
        <Route path="/cards/:id" element={<div data-testid="card-page" />} />
      </Routes>
      <LocationProbe />
      <SubjectProbe />
      {deepLink && <DeepLink to={deepLink} />}
    </MemoryRouter>,
  );
}

async function renderLoaded(
  adr: ArchitectureDecision,
  opts: ServeOptions = {},
  path = "/ea-delivery/adr/adr-1",
  deepLink?: string,
) {
  serve(adr, opts);
  const out = renderAt(path, deepLink);
  await screen.findByDisplayValue(adr.title);
  return out;
}

const location = () => screen.getByTestId("location").textContent;
const chipLabels = () =>
  Array.from(document.querySelectorAll(".MuiChip-label"), (el) => el.textContent);
const editorBox = (hint: string) => screen.getByPlaceholderText(hint) as HTMLTextAreaElement;
const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

const HINT = {
  context: "Why is this decision needed? What is the context and problem statement?",
  decision: "What is the decision that was made?",
  alternatives: "What alternatives were evaluated before making this decision?",
  consequences: "What are the consequences of this decision?",
};

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(printAdr).mockReset();
  authState.user = { id: "u1", permissions: {} };
  keysSeen.length = 0;
  resetPageTitle();
  invalidateDateFormat("YYYY-MM-DD");
});

// ---------------------------------------------------------------------------
// A new decision
// ---------------------------------------------------------------------------

describe("ADREditor — a new decision", () => {
  it("starts empty: only the draft chip, no alerts or dialogs, and exports exactly that", async () => {
    serve(base);
    const user = userEvent.setup();
    renderAt("/ea-delivery/adr/new");
    expect(await screen.findByText("New Architecture Decision")).toBeInTheDocument();

    expect(chipLabels()).toEqual(["draft"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Signatures" })).toBeNull();
    expect(screen.getByTestId("page-subject")).toHaveTextContent(/^$/);

    await user.click(screen.getByRole("button", { name: /PDF$/ }));
    expect(printAdr).toHaveBeenCalledTimes(1);
    expect(vi.mocked(printAdr).mock.calls[0][0]).toEqual({
      related_decisions: [],
      created_by: null,
      parent_id: null,
      created_at: null,
      updated_at: null,
      id: "",
      reference_number: "",
      title: "",
      status: "draft",
      context: "",
      decision: "",
      consequences: "",
      alternatives_considered: "",
      signatories: [],
      signed_at: null,
      revision_number: 1,
      attributes: {},
      linked_cards: [],
    });

    // The browser tab follows the draft title as it is typed.
    await user.type(screen.getByLabelText("Title"), "Use Kafka");
    expect(screen.getByTestId("page-subject")).toHaveTextContent("Use Kafka");
  });

  it("ignores a deep-link action and leaves it in the URL", async () => {
    serve(base);
    renderAt("/ea-delivery/adr/new?action=sign");
    expect(await screen.findByText("New Architecture Decision")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
    expect(location()).toBe("/ea-delivery/adr/new?action=sign");
  });

  it("refuses a title made only of spaces", async () => {
    serve(base, { post: () => ({ ...base, id: "adr-new" }) });
    const user = userEvent.setup();
    renderAt("/ea-delivery/adr/new");
    await user.type(await screen.findByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: /Save$/ }));
    expect(await screen.findByText("Title is required")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("creates with every empty section as null, replaces /new in history and confirms", async () => {
    serve(base, { post: (path) => (path === "/adr" ? { ...base, id: "adr-new" } : {}) });
    const user = userEvent.setup();
    renderAt("/ea-delivery/adr/new");
    await user.type(await screen.findByLabelText("Title"), "Use Kafka");
    await user.click(screen.getByRole("button", { name: /Save$/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/adr", {
        title: "Use Kafka",
        context: null,
        decision: null,
        consequences: null,
        alternatives_considered: null,
      }),
    );
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-new"));
    await screen.findByDisplayValue("Adopt event bus");

    // /new was replaced, so Back leaves the editor instead of reopening the blank form.
    await user.click(screen.getByRole("button", { name: "Back to EA Delivery" }));
    expect(await screen.findByTestId("previous-page")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Loading an existing decision
// ---------------------------------------------------------------------------

describe("ADREditor — loading a decision", () => {
  it("shows only a spinner until the record arrives", async () => {
    const hold = deferred();
    serve(base, { adr: () => hold.promise });
    renderAt("/ea-delivery/adr/adr-1");

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    // Centred in a box of its own, which the confirmation toast sits beside.
    expect(screen.getByRole("progressbar").parentElement).toHaveStyle({
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "300px",
    });
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save$/ })).toBeNull();

    hold.resolve(base);
    expect(await screen.findByDisplayValue("Adopt event bus")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("fills every section from the record, exports it and saves it back", async () => {
    const full: ArchitectureDecision = {
      ...base,
      consequences: "<p>cons</p>",
      alternatives_considered: "<p>alt</p>",
      attributes: { "ext.vs.score": 3 },
    };
    await renderLoaded(full, { patch: () => ({}) });
    const user = userEvent.setup();

    // Section headings, their hints and the editors' placeholders.
    for (const heading of ["Context", "Decision", "Alternatives Considered", "Consequences", "Linked Cards"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    for (const hint of Object.values(HINT)) {
      expect(screen.getByText(hint)).toBeInTheDocument();
    }
    expect(editorBox(HINT.context)).toHaveValue("<p>ctx</p>");
    expect(editorBox(HINT.decision)).toHaveValue("<p>do it</p>");
    expect(editorBox(HINT.alternatives)).toHaveValue("<p>alt</p>");
    expect(editorBox(HINT.consequences)).toHaveValue("<p>cons</p>");
    expect(screen.getByTestId("page-subject")).toHaveTextContent("Adopt event bus");

    await user.click(screen.getByRole("button", { name: /PDF$/ }));
    expect(vi.mocked(printAdr).mock.calls[0][0]).toMatchObject({
      consequences: "<p>cons</p>",
      alternatives_considered: "<p>alt</p>",
      attributes: { "ext.vs.score": 3 },
    });

    await user.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/adr/adr-1", {
        title: "Adopt event bus",
        context: "<p>ctx</p>",
        decision: "<p>do it</p>",
        consequences: "<p>cons</p>",
        alternatives_considered: "<p>alt</p>",
      }),
    );
  });

  it("loads a record with nothing filled in as empty sections, no signatories and no cards", async () => {
    const bare = {
      ...base,
      context: null,
      decision: null,
      signatories: undefined,
      linked_cards: undefined,
      attributes: undefined,
    } as unknown as ArchitectureDecision;
    await renderLoaded(bare, { patch: () => ({}) });
    const user = userEvent.setup();

    for (const hint of Object.values(HINT)) expect(editorBox(hint)).toHaveValue("");
    expect(screen.getByText("No cards linked to this decision.")).toBeInTheDocument();
    expect(screen.queryByText(/signatures collected/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Signatures" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /PDF$/ }));
    expect(vi.mocked(printAdr).mock.calls[0][0]).toMatchObject({ attributes: {}, linked_cards: [] });

    await user.click(screen.getByRole("button", { name: /Save$/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/adr/adr-1", {
        title: "Adopt event bus",
        context: null,
        decision: null,
        consequences: null,
        alternatives_considered: null,
      }),
    );
  });

  it("shows the reference as a chip, no revision chip at revision 1, and no banner on a draft", async () => {
    await renderLoaded({ ...base, signed_at: "2026-06-03T12:00:00Z" });
    expect(chipLabels()).toEqual(["ADR-0001", "draft"]);
    expect(screen.queryByText(/This decision was signed on/)).toBeNull();
    expect(screen.queryByText("Revision 1")).toBeNull();
  });

  it("shows no signed banner when a signed record carries no signing date", async () => {
    await renderLoaded({ ...base, status: "signed", signed_at: null, signatories: [ME_SIGNED] });
    expect(screen.getByText("1 of 1 signatures collected")).toBeInTheDocument();
    expect(screen.queryByText(/This decision was signed on/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

describe("ADREditor — signatures", () => {
  it("a signed first revision names the date, marks the signers and reports success", async () => {
    await renderLoaded({
      ...base,
      status: "signed",
      signed_at: "2026-06-03T12:00:00Z",
      signatories: [ME_SIGNED, GRACE_SIGNED],
    });
    expect(screen.getByText("This decision was signed on 2026-06-03 and is read-only.")).toBeInTheDocument();
    expect(chipLabels()).toEqual(["ADR-0001", "signed"]);

    const progress = screen.getByText("2 of 2 signatures collected").closest("[role='alert']") as HTMLElement;
    expect(within(progress).getByTestId("SuccessOutlinedIcon")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Signatures" })).toBeInTheDocument();
    const me = rowOf("Me");
    expect(me).toHaveTextContent("check_circle");
    expect(me).toHaveTextContent("Signed: 2026-06-03");
    expect(within(me).getByText("check_circle")).toHaveStyle({ color: STATUS_COLORS.success });
    expect(rowOf("Grace")).toHaveTextContent("Signed: 2026-06-02");
  });

  it("in review, a pending signer reads as Pending even with a stale signing date", async () => {
    await renderLoaded({
      ...IN_REVIEW,
      signatories: [ME_SIGNED, { ...GRACE_PENDING, signed_at: "2026-05-20T12:00:00Z" }],
    });
    const progress = screen.getByText("1 of 2 signatures collected").closest("[role='alert']") as HTMLElement;
    expect(within(progress).getByTestId("InfoOutlinedIcon")).toBeInTheDocument();

    const grace = rowOf("Grace");
    expect(grace).toHaveTextContent("radio_button_unchecked");
    expect(grace).not.toHaveTextContent("check_circle");
    expect(grace).toHaveTextContent("Pending");
    expect(grace).not.toHaveTextContent("Signed:");
    expect(within(grace).getByText("radio_button_unchecked")).toHaveStyle({
      color: STATUS_COLORS.warning,
    });
    expect(rowOf("Me")).not.toHaveTextContent("radio_button_unchecked");
  });
});

// ---------------------------------------------------------------------------
// Which actions each status offers
// ---------------------------------------------------------------------------

/** The Recall button, by its visible label — which is also its accessible name
 *  (WCAG 2.5.3 label-in-name); the tooltip only describes it. */
const recallButton = () => {
  const button = screen.getByText("Recall Signatures").closest("button") as HTMLButtonElement;
  expect(button).toHaveAccessibleName("undo Recall Signatures");
  return button;
};

describe("ADREditor — actions by status", () => {
  it("a draft never offers Recall, Sign or Reject, even with a pending signatory listed", async () => {
    await renderLoaded({ ...base, signatories: [ME_PENDING] });
    expect(screen.getByRole("button", { name: /Request Signatures/ })).toBeInTheDocument();
    expect(screen.queryByText("Recall Signatures")).toBeNull();
    expect(screen.queryByRole("button", { name: /^draw Sign$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^block Reject$/ })).toBeNull();
  });

  it("in review offers a labelled Recall and no new signature request", async () => {
    await renderLoaded(IN_REVIEW);
    expect(recallButton()).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Request Signatures/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^draw Sign$/ })).toBeInTheDocument();
  });

  it("offers no Sign to a signatory who has already signed while others are pending", async () => {
    await renderLoaded({ ...IN_REVIEW, signatories: [ME_SIGNED, GRACE_PENDING] });
    expect(screen.getByText("1 of 2 signatures collected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^draw Sign$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^block Reject$/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Workflow actions: busy states and what each reply does to the page
// ---------------------------------------------------------------------------

describe("ADREditor — workflow actions", () => {
  it("saving disables the button until the request settles, then confirms", async () => {
    const save = deferred();
    await renderLoaded(base, { patch: () => save.promise });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Save$/ }));
    const busy = screen.getByRole("button", { name: /Saving\.\.\.$/ });
    expect(busy).toBeDisabled();

    save.resolve({});
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save$/ })).toBeEnabled();
  });

  it("confirms a duplicate and a new revision", async () => {
    await renderLoaded(base, {
      post: (path) => (path === "/adr/adr-1/duplicate" ? { ...base, id: "adr-copy" } : {}),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(await screen.findByText("Decision duplicated")).toBeInTheDocument();
  });

  it("confirms a new revision", async () => {
    const signed = { ...base, status: "signed" as const, signed_at: "2026-06-03T12:00:00Z" };
    await renderLoaded(signed, {
      post: (path) => (path === "/adr/adr-1/revise" ? { ...signed, id: "adr-rev" } : {}),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /New Revision/ }));
    expect(await screen.findByText("New revision created")).toBeInTheDocument();
  });

  it("confirms a new revision while it loads, with one confirmation throughout", async () => {
    // The confirmation used to sit inside the loaded page, so it waited for the
    // whole reload of the new revision; hold that reload open to prove it doesn't.
    // And it must be ONE toast: the page switches from the old decision to the
    // spinner to the new one, and a toast remounted at each switch re-animates
    // and restarts its timer (and detached the element a test had just found).
    const signed = { ...base, status: "signed" as const, signed_at: "2026-06-03T12:00:00Z" };
    const reload = deferred();
    let loads = 0;
    await renderLoaded(signed, {
      adr: () => (++loads === 1 ? signed : reload.promise),
      post: (path) => (path === "/adr/adr-1/revise" ? { ...signed, id: "adr-rev" } : {}),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /New Revision/ }));
    const toast = await screen.findByText("New revision created");
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-rev"));
    // The spinner follows the URL by an effect, so wait for it rather than read
    // it in the same tick (a loaded runner showed the old decision there still).
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(toast).toBeInTheDocument();

    reload.resolve({ ...signed, id: "adr-rev" });
    await screen.findByDisplayValue(signed.title);
    expect(toast).toBeInTheDocument();
  });

  it("requesting signatures: dialog copy, busy flag through a failure, and a reply without signatories", async () => {
    const first = deferred();
    let calls = 0;
    await renderLoaded(base, {
      post: () => {
        calls += 1;
        return calls === 1 ? first.promise : { ...base, status: "in_review", signatories: undefined };
      },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Request Signatures/ }));
    const dialog = screen.getByTestId("sign-dialog");
    expect(screen.getByTestId("sign-dialog-title")).toHaveTextContent("Request Signatures");
    expect(screen.getByTestId("sign-dialog-description")).toHaveTextContent(
      "Select users who should sign this decision.",
    );
    expect(dialog).toHaveAttribute("data-requesting", "false");

    await user.click(screen.getByRole("button", { name: "request-one" }));
    expect(screen.getByTestId("sign-dialog")).toHaveAttribute("data-requesting", "true");
    first.reject(new Error("down"));
    expect(await screen.findByText("Failed to request signatures")).toBeInTheDocument();
    expect(screen.getByTestId("sign-dialog")).toHaveAttribute("data-requesting", "false");

    await user.click(screen.getByRole("button", { name: "request-one" }));
    expect(await screen.findByText("Signature requests sent")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
    expect(chipLabels()).toEqual(["ADR-0001", "in review"]);
    expect(screen.queryByText(/signatures collected/)).toBeNull();
  });

  it("signing shows the signatories the server returns", async () => {
    await renderLoaded(IN_REVIEW, {
      post: () => ({
        ...IN_REVIEW,
        status: "signed",
        signed_at: "2026-06-04T12:00:00Z",
        signatories: [ME_SIGNED, GRACE_SIGNED],
      }),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    expect(await screen.findByText("Decision fully signed")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 signatures collected")).toBeInTheDocument();
  });

  it("signing with a reply that carries no signatories empties the list", async () => {
    await renderLoaded(IN_REVIEW, { post: () => ({ ...IN_REVIEW, signatories: undefined }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    expect(await screen.findByText("Signature recorded")).toBeInTheDocument();
    expect(screen.queryByText(/signatures collected/)).toBeNull();
  });

  it("recalling is busy while in flight, posts to its own route and follows the reply", async () => {
    const recall = deferred();
    await renderLoaded(IN_REVIEW, { post: () => recall.promise });
    const user = userEvent.setup();

    const button = recallButton();
    await user.click(button);
    expect(api.post).toHaveBeenCalledWith("/adr/adr-1/recall-signatures", {});
    expect(button).toBeDisabled();

    recall.resolve({ ...IN_REVIEW, status: "draft", signatories: [GRACE_SIGNED] });
    expect(await screen.findByText("Signatures recalled — decision reset to draft")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 signatures collected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save$/ })).toBeEnabled();
  });

  it("a recall reply without signatories empties the list", async () => {
    await renderLoaded(IN_REVIEW, { post: () => ({ ...IN_REVIEW, status: "draft", signatories: undefined }) });
    const user = userEvent.setup();
    await user.click(recallButton());
    expect(await screen.findByText("Signatures recalled — decision reset to draft")).toBeInTheDocument();
    expect(screen.queryByText(/signatures collected/)).toBeNull();
  });

  it("a failed recall re-enables the actions", async () => {
    const recall = deferred();
    await renderLoaded(IN_REVIEW, { post: () => recall.promise });
    const user = userEvent.setup();
    const button = recallButton();
    await user.click(button);
    expect(button).toBeDisabled();
    recall.reject(new Error("x"));
    expect(await screen.findByText("Failed to recall signatures")).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: /Save$/ })).toBeEnabled();
  });

  it("rejecting: needs real text, is busy in flight, closes, applies the reply and clears the reason", async () => {
    const reject = deferred();
    await renderLoaded(IN_REVIEW, { post: () => reject.promise }, "/ea-delivery/adr/adr-1", "/ea-delivery/adr/adr-1?action=reject");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByText(/Explain why you are rejecting this decision\./),
    ).toBeInTheDocument();
    const confirm = dialog.getByRole("button", { name: "Reject" });
    await user.type(dialog.getByLabelText("Reason for rejection"), "   ");
    expect(confirm).toBeDisabled();

    await user.type(dialog.getByLabelText("Reason for rejection"), "No budget");
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    // The row button behind the modal is busy too.
    expect(screen.getByRole("button", { name: /^block Reject$/, hidden: true })).toBeDisabled();

    reject.resolve({ ...IN_REVIEW, status: "draft", revision_number: 2, signatories: [GRACE_SIGNED] });
    expect(await screen.findByText("Decision rejected and reset to draft")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(chipLabels()).toEqual(["ADR-0001", "Revision 2", "draft"]);
    expect(screen.getByText("1 of 1 signatures collected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save$/ })).toBeEnabled();

    // Opened again (here through a deep link), the reason starts blank.
    await user.click(screen.getByRole("button", { name: "follow-deep-link" }));
    const again = within(await screen.findByRole("dialog"));
    expect(again.getByLabelText("Reason for rejection")).toHaveValue("");
  });

  it("a reject reply without signatories empties the list", async () => {
    await renderLoaded(IN_REVIEW, { post: () => ({ ...IN_REVIEW, status: "draft", signatories: undefined }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason for rejection"), "No");
    await user.click(dialog.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Decision rejected and reset to draft")).toBeInTheDocument();
    expect(screen.queryByText(/signatures collected/)).toBeNull();
  });

  it("a failed rejection re-enables the confirm button", async () => {
    const reject = deferred();
    await renderLoaded(IN_REVIEW, { post: () => reject.promise });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^block Reject$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Reason for rejection"), "No");
    const confirm = dialog.getByRole("button", { name: "Reject" });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    reject.reject(new Error("x"));
    expect(await screen.findByText("Failed to reject decision")).toBeInTheDocument();
    expect(confirm).toBeEnabled();
  });

  it("a dismissed error leaves no alert behind", async () => {
    await renderLoaded(base, { post: () => new Error("x") });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Duplicate/ }));
    const alert = (await screen.findByText("Failed to duplicate")).closest("[role='alert']") as HTMLElement;
    await user.click(within(alert).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the reject dialog closes with Escape", async () => {
    await renderLoaded(IN_REVIEW);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^block Reject$/ }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the confirmation dismisses with Escape", async () => {
    await renderLoaded(base, { patch: () => ({}) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Save$/ }));
    expect(await screen.findByText("Saved successfully")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

describe("ADREditor — deep links", () => {
  it("a visit without an action leaves the history entry alone", async () => {
    await renderLoaded(base);
    expect(location()).toBe("/ea-delivery/adr/adr-1");
    expect(new Set(keysSeen).size).toBe(1);
  });

  it("an unknown action opens nothing and is still consumed", async () => {
    await renderLoaded(IN_REVIEW, {}, "/ea-delivery/adr/adr-1?action=bogus");
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("sign-dialog")).toBeNull();
  });

  it("the consumed action replaces its history entry, so Back leaves the editor", async () => {
    await renderLoaded(IN_REVIEW, {}, "/ea-delivery/adr/adr-1?action=sign");
    expect(screen.getByTestId("sign-dialog")).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-1"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "close-sign-dialog" }));
    await user.click(screen.getByRole("button", { name: "Back to EA Delivery" }));
    expect(await screen.findByTestId("previous-page")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Linked cards
// ---------------------------------------------------------------------------

describe("ADREditor — linking cards", () => {
  const KAFKA = { id: "card-2", name: "Kafka", type: "ITComponent" };
  const SAP = { id: "card-1", name: "SAP S/4HANA", type: "Application" };

  it("the picker starts empty, ignores blank input, and closes with Escape", async () => {
    await renderLoaded(base, { cards: () => ({ items: [KAFKA] }) });
    const user = userEvent.setup();
    const optionButtons = () =>
      within(screen.getByRole("dialog"))
        .queryAllByRole("button")
        .filter((b) => b.textContent !== "Cancel");

    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Link Card" })).toBeInTheDocument();
    expect(optionButtons()).toHaveLength(0);

    const box = dialog.getByPlaceholderText("Search cards...");
    await user.type(box, "ka");
    const kafka = (await dialog.findByText("Kafka")).closest("[role='button']") as HTMLElement;
    // Nothing is linked yet, so nothing is marked as such.
    expect(kafka).not.toHaveAttribute("aria-disabled", "true");
    expect(dialog.queryByText("Already linked")).toBeNull();

    await user.clear(box);
    expect(optionButtons()).toHaveLength(0);
    await user.type(box, " ");
    expect(api.get).not.toHaveBeenCalledWith("/cards?search=%20&page_size=20");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("reopening the picker drops the previous results", async () => {
    await renderLoaded(base, { cards: () => ({ items: [KAFKA] }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    let dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByPlaceholderText("Search cards..."), "ka");
    await dialog.findByText("Kafka");
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByPlaceholderText("Search cards...")).toHaveValue("");
    expect(dialog.queryAllByRole("button").filter((b) => b.textContent !== "Cancel")).toHaveLength(0);
  });

  it("marks only the card that is already linked", async () => {
    await renderLoaded({ ...base, linked_cards: [SAP] }, { cards: () => ({ items: [SAP, KAFKA] }) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByPlaceholderText("Search cards..."), "a");
    const kafka = (await dialog.findByText("Kafka")).closest("[role='button']") as HTMLElement;
    const sap = dialog.getByText("SAP S/4HANA").closest("[role='button']") as HTMLElement;
    expect(within(sap).getByText("Already linked")).toBeInTheDocument();
    expect(within(kafka).queryByText("Already linked")).toBeNull();
  });

  it("a link reply that carries no cards leaves the list empty", async () => {
    await renderLoaded(base, {
      cards: () => ({ items: [KAFKA] }),
      post: () => ({ ...base, linked_cards: undefined }),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByPlaceholderText("Search cards..."), "ka");
    await user.click(await dialog.findByText("Kafka"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.post).toHaveBeenCalledWith("/adr/adr-1/cards", { card_id: "card-2" });
    expect(screen.getByText("No cards linked to this decision.")).toBeInTheDocument();
  });

  it("following a linked card is an in-app navigation, not a page load", async () => {
    await renderLoaded({ ...base, linked_cards: [SAP] });
    const link = screen.getByRole("link", { name: "SAP S/4HANA" });
    // fireEvent returns false when the handler cancelled the default action.
    expect(fireEvent.click(link)).toBe(false);
    expect(await screen.findByTestId("card-page")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Extension points
// ---------------------------------------------------------------------------

describe("ADREditor — extension gates", () => {
  beforeEach(() => resetExtensionHost());
  afterEach(() => {
    // Unmount first, so emptying the registry does not re-render a live page.
    cleanup();
    resetExtensionHost();
  });

  function register(key = "vs", panelId = "main", permission?: string) {
    registerExtension(key, {
      key,
      sdkVersion: UI_SDK_VERSION,
      adrPanels: [
        {
          id: panelId,
          permission,
          component: (p: { adrId: string }) => <div data-testid={`panel-${key}`}>{String(p.adrId)}</div>,
        },
      ],
      slots: [
        { slot: "adr.header", id: "hdr", component: () => <span data-testid={`header-${key}`} /> },
        { slot: "adr.signature.footer", id: "ftr", component: () => <span data-testid={`footer-${key}`} /> },
      ],
    });
  }

  it("renders nothing extension-provided on a decision that does not exist yet", async () => {
    register();
    serve(base);
    const { unmount } = renderAt("/ea-delivery/adr/new");
    expect(await screen.findByText("New Architecture Decision")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-vs")).toBeNull();
    expect(screen.queryByTestId("header-vs")).toBeNull();
    expect(screen.queryByTestId("footer-vs")).toBeNull();
    unmount();

    await renderLoaded(base);
    expect(screen.getByTestId("panel-vs")).toHaveTextContent("adr-1");
    expect(screen.getByTestId("header-vs")).toBeInTheDocument();
    expect(screen.getByTestId("footer-vs")).toBeInTheDocument();
  });

  it("with nobody signed in, hides a gated panel without breaking the page", async () => {
    authState.user = null;
    register("vs", "open");
    register("gated", "main", "ext.gated.view");
    await renderLoaded(base);
    expect(screen.getByTestId("panel-vs")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-gated")).toBeNull();
  });

  it("keeps two extensions' same-named panels apart", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    register("alpha", "main");
    register("beta", "main");
    await renderLoaded(base);
    expect(screen.getByTestId("panel-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("panel-beta")).toBeInTheDocument();
    const keyWarnings = errors.mock.calls.filter((c) => String(c[0]).includes("same key"));
    errors.mockRestore();
    expect(keyWarnings).toEqual([]);
  });
});
