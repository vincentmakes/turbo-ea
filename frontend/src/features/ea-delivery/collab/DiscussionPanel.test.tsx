import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { DocumentComment, DocumentDiscussion, DocumentOwner, DocumentThread } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
// TipTap has no place in jsdom: a textarea carries the same contract, and the
// props the composer passes are recorded.
const editorProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("../RichTextEditor", () => ({
  default: (props: {
    content: string;
    onChange: (v: string) => void;
    placeholder?: string;
    variant?: string;
    mentions?: string[];
  }) => {
    editorProps.last = props;
    return (
      <textarea
        aria-label={props.placeholder}
        value={props.content}
        onChange={(e) => props.onChange(e.target.value)}
      />
    );
  },
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { DocumentMentionContext } from "../mentions/documentMentionContext";
import { clearAllDrafts } from "./commentDrafts";
import DiscussionPanel from "./DiscussionPanel";
import { sectionOptions, type SectionOption } from "./discussionModel";
import { useDiscussionView } from "./useDiscussionView";

const tId = (k: string) => k;
const SECTIONS = sectionOptions("adr", (k) =>
  ({
    "collab.discussion.section.general": "General",
    "adr.context": "Context",
    "adr.decision": "Decision",
    "adr.alternativesConsidered": "Alternatives Considered",
    "adr.consequences": "Consequences",
  })[k] ?? tId(k),
);

function comment(overrides: Partial<DocumentComment> = {}): DocumentComment {
  return {
    id: "t1",
    kind: "comment",
    section: "context",
    revision_id: "a2",
    revision_number: 2,
    author: { id: "u1", display_name: "Ada Lovelace" },
    author_name: "Ada Lovelace",
    body: "<p>Is Kafka costed?</p>",
    created_at: "2026-11-01T10:00:00Z",
    edited_at: null,
    deleted: false,
    resolved_at: null,
    resolved_by: null,
    can: { edit: true, delete: true, resolve: true },
    ...overrides,
  };
}

function thread(overrides: Partial<DocumentThread> = {}): DocumentThread {
  return { ...comment(), replies: [], ...overrides };
}

let discussion: DocumentDiscussion;

function serve(d: DocumentDiscussion, chain?: DocumentDiscussion) {
  discussion = d;
  mockApi.on("get", "/adr/a2/comments", () => discussion);
  mockApi.on("get", "/adr/a2/comments?scope=chain", () => chain ?? discussion);
}

interface PanelProps {
  owner?: DocumentOwner;
  sections?: SectionOption[];
  focusThreadId?: string | null;
  refreshKey?: string | number;
}

/** The panel wired as `DocumentSidePanel` wires it: the shared view holds the read and the filter. */
function Wired({ owner = { kind: "adr", id: "a2" }, sections = SECTIONS, focusThreadId, refreshKey }: PanelProps) {
  const view = useDiscussionView(owner, { focusThreadId, refreshKey });
  return <DiscussionPanel owner={owner} sections={sections} focusThreadId={focusThreadId} view={view} />;
}

function renderPanel(props: PanelProps = {}) {
  return renderWithProviders(<Wired {...props} />);
}

const can = { comment: true, moderate: false };

/** Renders the panel with props a test can change later (`set(...)`), inside the providers. */
function renderHarness(initial: PanelProps) {
  let set: (next: PanelProps) => void = () => {};
  function Harness() {
    const [props, setProps] = useState(initial);
    set = (next) => setProps((p) => ({ ...p, ...next }));
    return <Wired {...props} />;
  }
  renderWithProviders(<Harness />);
  return { change: (next: PanelProps) => act(() => set(next)) };
}

beforeEach(() => {
  mockApi.reset();
  editorProps.last = null;
  clearAllDrafts();
});

describe("DiscussionPanel", () => {
  it("starts a thread tagged to a section with the exact POST, and reads the list again", async () => {
    serve({ can, open_count: 0, threads: [] });
    const created = thread({ id: "t9", body: "<p>Why now?</p>", section: "decision" });
    mockApi.on("post", "/adr/a2/comments", () => ({ ...created, unnotified_mentions: [] }));
    const { user } = renderPanel();
    expect(await screen.findByText("No discussion yet.")).toBeInTheDocument();
    expect(editorProps.last).toMatchObject({ variant: "comment", mentions: ["card", "decision", "user"] });

    const chips = within(screen.getByRole("group", { name: "Section" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Context",
      "Decision",
      "Alternatives Considered",
      "Consequences",
    ]);
    await user.click(chips.getByRole("button", { name: "Decision" }));
    expect(chips.getByRole("button", { name: "Decision" })).toHaveAttribute("aria-pressed", "true");
    expect(chips.getByRole("button", { name: "Context" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(screen.getByRole("textbox", { name: /Start a thread/ }), {
      target: { value: "<p>Why now?</p>" },
    });
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect(mockApi.callsOf("post")[0]).toEqual({
      method: "post",
      path: "/adr/a2/comments",
      body: { body: "<p>Why now?</p>", section: "decision" },
    });
    expect(await screen.findByText("Why now?")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(2));
  });

  it("hands the composer the document's mention context, none outside a document", async () => {
    serve({ can, open_count: 0, threads: [] });
    const ctx = { linkedCardIds: ["c1"], priorityUserIds: ["u7"] };
    const { unmount } = renderWithProviders(
      <DocumentMentionContext.Provider value={ctx}>
        <Wired />
      </DocumentMentionContext.Provider>,
    );
    await screen.findByText("No discussion yet.");
    expect(editorProps.last?.mentionContext).toBe(ctx);
    unmount();
    renderPanel();
    await screen.findByText("No discussion yet.");
    expect(editorProps.last?.mentionContext).toBeUndefined();
  });

  it("keeps Post disabled for an empty comment and posts General without a section", async () => {
    serve({ can, open_count: 0, threads: [] });
    mockApi.on("post", "/adr/a2/comments", () => thread({ id: "t9", section: null }));
    const { user } = renderPanel();
    const post = await screen.findByRole("button", { name: "Post" });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Start a thread/ }), { target: { value: "<p>Hi</p>" } });
    await user.click(post);
    await waitFor(() => expect(mockApi.callsOf("post")[0]?.body).toEqual({ body: "<p>Hi</p>" }));
  });

  it("shows a refused post inline", async () => {
    serve({ can, open_count: 0, threads: [] });
    mockApi.fail("post", "/adr/a2/comments", 404, "Card not found");
    const { user } = renderPanel();
    fireEvent.change(await screen.findByRole("textbox", { name: /Start a thread/ }), {
      target: { value: "<p>See x</p>" },
    });
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByText("POST /adr/a2/comments failed")).toBeInTheDocument();
  });

  it("names who a mention could not notify", async () => {
    serve({ can, open_count: 0, threads: [] });
    mockApi.on("post", "/adr/a2/comments", () => ({
      ...thread({ id: "t9" }),
      unnotified_mentions: [
        { id: "u7", display_name: "Grace" },
        { id: "u8", display_name: "Linus" },
      ],
    }));
    const { user } = renderPanel();
    fireEvent.change(await screen.findByRole("textbox", { name: /Start a thread/ }), {
      target: { value: "<p>@Grace</p>" },
    });
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(
      await screen.findByText("Grace, Linus were not notified: they cannot open this document."),
    ).toBeInTheDocument();
  });

  it("replies, resolves and reopens on the thread's own revision", async () => {
    const earlier = thread({ id: "t0", revision_id: "a1", revision_number: 1, section: null });
    serve({ can, open_count: 1, threads: [thread()] }, { can, open_count: 1, threads: [earlier, thread()] });
    mockApi.on("post", "/adr/a2/comments", () => thread({ replies: [comment({ id: "r1", body: "<p>Yes</p>" })] }));
    mockApi.on("post", "/adr/a2/comments/t1/resolve", () => thread({ resolved_at: "2026-11-02T00:00:00Z" }));
    mockApi.on("post", "/adr/a1/comments", () => ({ ...earlier, replies: [comment({ id: "r2", revision_id: "a1" })] }));
    const { user } = renderPanel();

    const t1 = within(await screen.findByTestId("thread-t1"));
    expect(t1.getByText("Context")).toBeInTheDocument();
    await user.click(t1.getByRole("button", { name: "Reply" }));
    fireEvent.change(t1.getByRole("textbox", { name: "Reply…" }), { target: { value: "<p>Yes</p>" } });
    await user.click(t1.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post")[0]).toEqual({
        method: "post",
        path: "/adr/a2/comments",
        body: { body: "<p>Yes</p>", parent_id: "t1" },
      }),
    );
    expect(await screen.findByText("Yes")).toBeInTheDocument();

    await user.click(within(screen.getByTestId("thread-t1")).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/adr/a2/comments/t1/resolve")).toEqual([
        { method: "post", path: "/adr/a2/comments/t1/resolve", body: {} },
      ]),
    );

    // Earlier revisions: read with scope=chain, under "Rev 1", answered on rev 1.
    await user.click(screen.getByRole("checkbox", { name: "Show discussion on earlier revisions" }));
    await waitFor(() => expect(mockApi.callsOf("get", "/adr/a2/comments?scope=chain")).toHaveLength(1));
    expect(await screen.findByText("Rev 1")).toBeInTheDocument();
    const t0 = within(screen.getByTestId("thread-t0"));
    await user.click(t0.getByRole("button", { name: "Reply" }));
    fireEvent.change(t0.getByRole("textbox", { name: "Reply…" }), { target: { value: "<p>Old</p>" } });
    await user.click(t0.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/adr/a1/comments")[0]).toEqual({
        method: "post",
        path: "/adr/a1/comments",
        body: { body: "<p>Old</p>", parent_id: "t0" },
      }),
    );
  });

  it("folds resolved threads behind a toggle and reopens one", async () => {
    const done = thread({
      id: "t5",
      resolved_at: "2026-11-02T00:00:00Z",
      resolved_by: { id: "u2", display_name: "Grace" },
      body: "<p>Settled</p>",
    });
    serve({ can, open_count: 0, threads: [done] });
    mockApi.on("post", "/adr/a2/comments/t5/reopen", () => thread({ id: "t5", body: "<p>Settled</p>" }));
    const { user } = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Show 1 resolved thread" }));
    const t5 = within(screen.getByTestId("thread-t5"));
    expect(t5.getByText("Resolved by Grace")).toBeInTheDocument();
    await user.click(t5.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(mockApi.callsOf("post")).toEqual([{ method: "post", path: "/adr/a2/comments/t5/reopen", body: {} }]),
    );
    // Reopened: back among the open threads, and no resolved ones are left to fold.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Hide resolved threads" })).toBeNull());
    expect(within(screen.getByTestId("thread-t5")).getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });

  it("edits your own comment with the exact PATCH", async () => {
    serve({ can, open_count: 1, threads: [thread()] });
    mockApi.on("patch", "/adr/a2/comments/t1", () => ({
      ...thread({ body: "<p>Edited</p>", edited_at: "2026-11-03T00:00:00Z" }),
      unnotified_mentions: [],
    }));
    const { user } = renderPanel();
    const t1 = within(await screen.findByTestId("thread-t1"));
    await user.click(t1.getByRole("button", { name: "Edit" }));
    fireEvent.change(t1.getByRole("textbox", { name: "Edit your comment…" }), { target: { value: "<p>Edited</p>" } });
    await user.click(t1.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockApi.callsOf("patch")).toEqual([
        { method: "patch", path: "/adr/a2/comments/t1", body: { body: "<p>Edited</p>" } },
      ]),
    );
    expect(await screen.findByText("Edited")).toBeInTheDocument();
    expect(screen.getByText("(edited)")).toBeInTheDocument();
  });

  it("deletes your own comment after asking, leaving a placeholder and the replies", async () => {
    serve({ can, open_count: 1, threads: [thread({ replies: [comment({ id: "r1", body: "<p>A reply</p>" })] })] });
    mockApi.on("delete", "/adr/a2/comments/t1", undefined);
    const { user } = renderPanel();
    const t1 = within(await screen.findByTestId("thread-t1"));
    await user.click(t1.getAllByRole("button", { name: "Delete" })[0]);
    expect(t1.getByText("Delete this comment?")).toBeInTheDocument();
    discussion = {
      can,
      open_count: 0,
      threads: [
        thread({ body: "", deleted: true, replies: [comment({ id: "r1", body: "<p>A reply</p>" })] }),
      ],
    };
    const confirmRow = t1.getByText("Delete this comment?").parentElement as HTMLElement;
    await user.click(within(confirmRow).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockApi.callsOf("delete")).toEqual([{ method: "delete", path: "/adr/a2/comments/t1", body: undefined }]),
    );
    expect(await screen.findByText("Comment deleted")).toBeInTheDocument();
    expect(screen.getByText("A reply")).toBeInTheDocument();
  });

  it("keeps a thread whose last live reply is deleted as one small line, with nothing to act on", async () => {
    const closed = thread({
      body: "",
      deleted: true,
      can: { edit: false, delete: false, resolve: false },
      replies: [comment({ id: "r1", body: "<p>A reply</p>" })],
    });
    serve({ can, open_count: 0, threads: [closed, thread({ id: "t2", body: "<p>Other</p>" })] });
    mockApi.on("delete", "/adr/a2/comments/r1", undefined);
    const { user } = renderPanel();
    const t1 = within(await screen.findByTestId("thread-t1"));
    expect(t1.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(t1.queryByRole("button", { name: "Resolve" })).toBeNull();
    await user.click(t1.getByRole("button", { name: "Delete" }));
    discussion = {
      ...discussion,
      threads: [
        { ...closed, replies: [comment({ id: "r1", body: "", deleted: true })] },
        thread({ id: "t2", body: "<p>Other</p>" }),
      ],
    };
    const confirmRow = t1.getByText("Delete this comment?").parentElement as HTMLElement;
    await user.click(within(confirmRow).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockApi.callsOf("delete")).toEqual([{ method: "delete", path: "/adr/a2/comments/r1", body: undefined }]),
    );
    await waitFor(() => expect(screen.getByTestId("thread-t1")).toHaveAttribute("data-compact", "true"));
    expect(within(screen.getByTestId("thread-t1")).queryByRole("button")).toBeNull();
    expect(screen.queryByText("A reply")).toBeNull();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("marks a rejection reason, gives an empty one its fallback and offers no edit or delete on it", async () => {
    serve({
      can,
      open_count: 1,
      threads: [thread({ id: "rj", kind: "rejection", section: null, body: "", can: { edit: true, delete: true, resolve: true } })],
    });
    renderPanel();
    const rj = within(await screen.findByTestId("thread-rj"));
    expect(rj.getByText("Rejection reason")).toBeInTheDocument();
    expect(rj.getByText("No reason given")).toBeInTheDocument();
    expect(rj.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(rj.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(rj.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });

  it("shows a signing note as such, with nothing to resolve, edit or delete", async () => {
    serve({
      can,
      open_count: 0,
      threads: [
        thread({
          id: "sn",
          kind: "sign_note",
          section: null,
          body: "<p>Signed with care</p>",
          resolved_at: "2026-11-02T00:00:00Z",
          can: { edit: true, delete: true, resolve: true },
        }),
      ],
    });
    renderPanel();
    const sn = within(await screen.findByTestId("thread-sn"));
    expect(sn.getByText("Signing note")).toBeInTheDocument();
    expect(sn.getByText("Signed with care")).toBeInTheDocument();
    expect(sn.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(sn.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(sn.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("labels a thread on a section the document no longer has", async () => {
    serve({ can, open_count: 1, threads: [thread({ section: "custom_4" })] });
    renderPanel();
    expect(await within(await screen.findByTestId("thread-t1")).findByText("Removed section")).toBeInTheDocument();
  });

  it("gives a reader without the comment right no composer and no reply", async () => {
    serve({
      can: { comment: false, moderate: false },
      open_count: 1,
      threads: [thread({ can: { edit: false, delete: false, resolve: false } })],
    });
    renderPanel();
    const t1 = within(await screen.findByTestId("thread-t1"));
    expect(t1.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(t1.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  });

  it("draws out a notification's thread, unfolding it when resolved", async () => {
    serve({ can, open_count: 0, threads: [thread({ id: "t7", resolved_at: "2026-11-02T00:00:00Z" })] });
    renderPanel({ focusThreadId: "t7" });
    const t7 = await screen.findByTestId("thread-t7");
    expect(t7).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide resolved threads" })).toBeInTheDocument();
  });

  it("says when the discussion cannot be read", async () => {
    mockApi.fail("get", "/adr/a2/comments", 403, "Insufficient permissions");
    renderPanel();
    expect(await screen.findByText("GET /adr/a2/comments failed")).toBeInTheDocument();
  });

  it("reads the discussion again when the page's refresh key changes", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "a" })] });
    const { change } = renderHarness({ refreshKey: "v1" });
    await screen.findByTestId("thread-a");
    expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(1);

    // A rejection opened a thread on the server.
    serve({ can, open_count: 2, threads: [thread({ id: "a" }), thread({ id: "r", kind: "rejection", body: "<p>No</p>" })] });
    change({ refreshKey: "v2" });
    expect(await screen.findByTestId("thread-r")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(2);
  });

  it("scrolls a notification's thread into view once, not on every read", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    serve({ can, open_count: 1, threads: [thread({ id: "t7" }), thread({ id: "t8" })] });
    const { change } = renderHarness({ focusThreadId: "t7", refreshKey: 1 });
    await screen.findByTestId("thread-t7");
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("thread-t7"));
    change({ refreshKey: 2 });
    await waitFor(() => expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(2));
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(3));
    expect(scroll).toHaveBeenCalledTimes(1);
    // Another notification's thread is brought into view in its turn.
    change({ focusThreadId: "t8" });
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
    expect(scroll.mock.contexts[1]).toBe(screen.getByTestId("thread-t8"));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("lets the reader fold a notification's resolved thread away like any other", async () => {
    serve({ can, open_count: 0, threads: [thread({ id: "t7", resolved_at: "2026-11-02T00:00:00Z" })] });
    const { user } = renderPanel({ focusThreadId: "t7" });
    await screen.findByTestId("thread-t7");
    await user.click(screen.getByRole("button", { name: "Hide resolved threads" }));
    expect(screen.queryByTestId("thread-t7")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 1 resolved thread" })).toBeInTheDocument();
    // A re-read does not unfold it again.
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(2));
    expect(screen.queryByTestId("thread-t7")).toBeNull();
  });

  it("keeps an unsent comment, reply and edit, and the section picked, across a close and reopen", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "t1" }), thread({ id: "t2", body: "<p>Mine</p>" })] });
    const first = renderPanel();
    const { user } = first;
    await user.click(within(await screen.findByRole("group", { name: "Section" })).getByRole("button", { name: "Decision" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Start a thread/ }), { target: { value: "<p>Half a th</p>" } });
    const t1 = within(screen.getByTestId("thread-t1"));
    await user.click(t1.getByRole("button", { name: "Reply" }));
    fireEvent.change(t1.getByRole("textbox", { name: /Reply/ }), { target: { value: "<p>Half a reply</p>" } });
    const t2 = within(screen.getByTestId("thread-t2"));
    await user.click(t2.getByRole("button", { name: "Edit" }));
    fireEvent.change(t2.getByRole("textbox"), { target: { value: "<p>Mine, edited</p>" } });
    first.unmount();

    renderPanel();
    expect(await screen.findByRole("textbox", { name: /Start a thread/ })).toHaveValue("<p>Half a th</p>");
    expect(
      within(screen.getByRole("group", { name: "Section" })).getByRole("button", { name: "Decision" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("thread-t1")).getByRole("textbox", { name: /Reply/ })).toHaveValue(
      "<p>Half a reply</p>",
    );
    expect(within(screen.getByTestId("thread-t2")).getByRole("textbox")).toHaveValue("<p>Mine, edited</p>");
  });

  it("drops a draft once it is posted or cancelled, and keeps drafts per document", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "t1" })] });
    mockApi.on("post", "/adr/a2/comments", () => ({ ...thread({ id: "t9" }), unnotified_mentions: [] }));
    const first = renderPanel();
    const { user } = first;
    fireEvent.change(await screen.findByRole("textbox", { name: /Start a thread/ }), { target: { value: "<p>Sent</p>" } });
    await user.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    const t1 = within(screen.getByTestId("thread-t1"));
    await user.click(t1.getByRole("button", { name: "Reply" }));
    fireEvent.change(t1.getByRole("textbox", { name: /Reply/ }), { target: { value: "<p>Never mind</p>" } });
    await user.click(t1.getByRole("button", { name: "Cancel" }));
    first.unmount();

    const second = renderPanel();
    expect(await screen.findByRole("textbox", { name: /Start a thread/ })).toHaveValue("");
    expect(within(screen.getByTestId("thread-t1")).queryByRole("textbox")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /Start a thread/ }), { target: { value: "<p>For a2</p>" } });
    second.unmount();

    mockApi.on("get", "/adr/b7/comments", { can, open_count: 0, threads: [] });
    renderWithProviders(<Wired owner={{ kind: "adr", id: "b7" }} />);
    expect(await screen.findByRole("textbox", { name: /Start a thread/ })).toHaveValue("");
  });
});

describe("DiscussionPanel section filter", () => {
  const filterRow = () => within(screen.getByRole("group", { name: "Filter the discussion by section" }));
  const chipNames = () =>
    filterRow()
      .getAllByRole("button")
      .map((b) => b.textContent);
  const listedIds = () =>
    screen.queryAllByTestId(/^thread-/).map((el) => el.getAttribute("data-testid")?.slice("thread-".length));

  const MIXED = [
    thread({ id: "a", section: "decision" }),
    thread({ id: "b", section: null }),
    thread({ id: "c", section: "context" }),
    thread({ id: "d", section: "decision" }),
  ];

  it("shows one chip per section with its count, in the document's order, and General when both kinds exist", async () => {
    serve({ can, open_count: 4, threads: MIXED });
    renderPanel();
    await screen.findByTestId("thread-a");
    expect(chipNames()).toEqual(["General (1)", "Context (1)", "Decision (2)"]);
    expect(filterRow().getByRole("button", { name: "Decision (2)" })).toHaveAttribute("aria-pressed", "false");
    expect(filterRow().queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("shows no filter row when no thread has a section", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "a", section: null })] });
    renderPanel();
    await screen.findByTestId("thread-a");
    expect(screen.queryByRole("group", { name: "Filter the discussion by section" })).toBeNull();
  });

  it("filters on one or several chips, turns one off on a second click, and clears", async () => {
    serve({ can, open_count: 4, threads: MIXED });
    const { user } = renderPanel();
    await screen.findByTestId("thread-a");

    await user.click(filterRow().getByRole("button", { name: "Decision (2)" }));
    expect(listedIds()).toEqual(["a", "d"]);
    expect(filterRow().getByRole("button", { name: "Decision (2)" })).toHaveAttribute("aria-pressed", "true");

    await user.click(filterRow().getByRole("button", { name: "General (1)" }));
    expect(listedIds()).toEqual(["a", "b", "d"]);

    await user.click(filterRow().getByRole("button", { name: "Decision (2)" }));
    expect(listedIds()).toEqual(["b"]);

    await user.click(filterRow().getByRole("button", { name: "Clear" }));
    expect(listedIds()).toEqual(["a", "b", "c", "d"]);
    expect(filterRow().queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("turns a section's filter on from a thread's own section chip", async () => {
    serve({ can, open_count: 4, threads: MIXED });
    const { user } = renderPanel();
    await user.click(within(await screen.findByTestId("thread-c")).getByRole("button", { name: "Context" }));
    expect(listedIds()).toEqual(["c"]);
    // A second click keeps it on.
    await user.click(within(screen.getByTestId("thread-c")).getByRole("button", { name: "Context" }));
    expect(listedIds()).toEqual(["c"]);
    expect(filterRow().getByRole("button", { name: "Context (1)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("counts what the resolved toggle lists, and filters the resolved threads too", async () => {
    serve({
      can,
      open_count: 1,
      threads: [
        thread({ id: "a", section: "decision" }),
        thread({ id: "r1", section: "decision", resolved_at: "2026-11-02T00:00:00Z" }),
        thread({ id: "r2", section: "context", resolved_at: "2026-11-02T00:00:00Z" }),
      ],
    });
    const { user } = renderPanel();
    await screen.findByTestId("thread-a");
    expect(chipNames()).toEqual(["Decision (1)"]);
    await user.click(screen.getByRole("button", { name: "Show 2 resolved threads" }));
    expect(chipNames()).toEqual(["Context (1)", "Decision (2)"]);

    await user.click(filterRow().getByRole("button", { name: "Decision (2)" }));
    expect(listedIds()).toEqual(["a", "r1"]);
    await user.click(screen.getByRole("button", { name: "Hide resolved threads" }));
    expect(screen.getByRole("button", { name: "Show 1 resolved thread" })).toBeInTheDocument();
    expect(chipNames()).toEqual(["Decision (1)", "Clear"]);
  });

  it("says when the filter leaves nothing, and clears from there", async () => {
    const chain = {
      can,
      open_count: 1,
      threads: [
        thread({ id: "a", section: "decision" }),
        thread({ id: "e1", section: "context", revision_id: "a1", revision_number: 1 }),
      ],
    };
    serve({ can, open_count: 1, threads: [thread({ id: "a", section: "decision" })] }, chain);
    const { user } = renderPanel();
    await screen.findByTestId("thread-a");
    const earlier = screen.getByRole("checkbox", { name: "Show discussion on earlier revisions" });
    await user.click(earlier);
    await screen.findByTestId("thread-e1");
    await user.click(filterRow().getByRole("button", { name: "Context (1)" }));
    expect(listedIds()).toEqual(["e1"]);
    expect(screen.queryByText("No thread matches this filter.")).toBeNull();
    await user.click(earlier);
    // The chip that is on stays, at 0, and the line says why the list is
    // empty: no thread read carries the section any more.
    await waitFor(() => expect(listedIds()).toEqual([]));
    expect(chipNames()).toEqual(["Context (0)", "Decision (1)"]);
    expect(screen.getByText("No discussion on this section yet.")).toBeInTheDocument();
    expect(screen.queryByText("No thread matches this filter.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(listedIds()).toEqual(["a"]);
    expect(screen.queryByText("No discussion on this section yet.")).toBeNull();
  });

  /** The panel and two buttons doing what a section marker does to the shared view. */
  function WiredWithMarker() {
    const owner: DocumentOwner = { kind: "adr", id: "a2" };
    const view = useDiscussionView(owner, {});
    return (
      <>
        <button
          type="button"
          onClick={() => {
            view.setFilter(["decision"]);
            view.requestComposeSection("decision");
          }}
        >
          marker decision
        </button>
        <button type="button" onClick={() => view.setFilter(["decision", "consequences"])}>
          two sections
        </button>
        <DiscussionPanel owner={owner} sections={SECTIONS} view={view} />
      </>
    );
  }

  it("filters on a section with no thread yet: its chip pressed at 0, says so, and the composer has it chosen", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "c", section: "context" })] });
    const { user } = renderWithProviders(<WiredWithMarker />);
    await screen.findByTestId("thread-c");
    await user.click(screen.getByRole("button", { name: "marker decision" }));
    expect(chipNames()).toEqual(["Context (1)", "Decision (0)"]);
    expect(filterRow().getByRole("button", { name: "Decision (0)" })).toHaveAttribute("aria-pressed", "true");
    expect(filterRow().getByRole("button", { name: "Context (1)" })).toHaveAttribute("aria-pressed", "false");
    expect(listedIds()).toEqual([]);
    expect(screen.getByText("No discussion on this section yet.")).toBeInTheDocument();
    expect(screen.queryByText("No thread matches this filter.")).toBeNull();
    expect(screen.queryByText("No discussion yet.")).toBeNull();
    const composer = within(screen.getByRole("group", { name: "Section" }));
    expect(composer.getByRole("button", { name: "Decision" })).toHaveAttribute("aria-pressed", "true");
    expect(editorProps.last?.focusRequest).toBe(1);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(chipNames()).toEqual(["Context (1)"]);
    expect(listedIds()).toEqual(["c"]);
    expect(screen.queryByText("No discussion on this section yet.")).toBeNull();
    // The composer keeps the section chosen for the thread being written.
    expect(composer.getByRole("button", { name: "Decision" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says nothing matches when several sections are on and none has a thread", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "c", section: "context" })] });
    const { user } = renderWithProviders(<WiredWithMarker />);
    await screen.findByTestId("thread-c");
    await user.click(screen.getByRole("button", { name: "two sections" }));
    expect(chipNames()).toEqual(["Context (1)", "Decision (0)", "Consequences (0)"]);
    expect(screen.getByText("No thread matches this filter.")).toBeInTheDocument();
    expect(screen.queryByText("No discussion on this section yet.")).toBeNull();
  });

  it("says a section has no discussion yet on a document with no thread at all, once", async () => {
    serve({ can, open_count: 0, threads: [] });
    const { user } = renderWithProviders(<WiredWithMarker />);
    expect(await screen.findByText("No discussion yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "marker decision" }));
    expect(chipNames()).toEqual(["Decision (0)"]);
    expect(screen.getByText("No discussion on this section yet.")).toBeInTheDocument();
    expect(screen.queryByText("No discussion yet.")).toBeNull();
  });

  it("keeps a resolved match behind the fold rather than saying nothing matches", async () => {
    serve({
      can,
      open_count: 1,
      threads: [thread({ id: "a", section: "decision" }), thread({ id: "r", section: "context", resolved_at: "x" })],
    });
    const { user } = renderPanel();
    await screen.findByTestId("thread-a");
    await user.click(screen.getByRole("button", { name: "Show 1 resolved thread" }));
    await user.click(filterRow().getByRole("button", { name: "Context (1)" }));
    await user.click(screen.getByRole("button", { name: "Hide resolved threads" }));
    expect(listedIds()).toEqual([]);
    expect(screen.getByRole("button", { name: "Show 1 resolved thread" })).toBeInTheDocument();
    expect(screen.queryByText("No thread matches this filter.")).toBeNull();
    expect(chipNames()).toEqual(["Context (0)", "Decision (1)", "Clear"]);
  });

  it("keeps a notification's thread through the filter, and starts with no filter when one is opened", async () => {
    serve({ can, open_count: 4, threads: MIXED });
    const { change } = renderHarness({});
    await screen.findByTestId("thread-a");
    fireEvent.click(filterRow().getByRole("button", { name: "Context (1)" }));
    expect(listedIds()).toEqual(["c"]);
    change({ focusThreadId: "b" });
    expect(listedIds()).toEqual(["a", "b", "c", "d"]);
    fireEvent.click(filterRow().getByRole("button", { name: "Context (1)" }));
    expect(listedIds()).toEqual(["b", "c"]);
  });

  it("filters the earlier revisions' groups and leaves out a group with nothing left", async () => {
    const chain = {
      can,
      open_count: 1,
      threads: [
        thread({ id: "a", section: "decision" }),
        thread({ id: "e1", section: "context", revision_id: "a1", revision_number: 1 }),
        thread({ id: "e0", section: "decision", revision_id: "a0", revision_number: 0 }),
      ],
    };
    serve({ can, open_count: 1, threads: [thread({ id: "a", section: "decision" })] }, chain);
    const { user } = renderPanel();
    await screen.findByTestId("thread-a");
    await user.click(screen.getByRole("checkbox", { name: "Show discussion on earlier revisions" }));
    await screen.findByTestId("thread-e1");
    expect(chipNames()).toEqual(["Context (1)", "Decision (2)"]);
    expect(screen.getByText("Rev 1")).toBeInTheDocument();

    await user.click(filterRow().getByRole("button", { name: "Decision (2)" }));
    expect(listedIds()).toEqual(["a", "e0"]);
    expect(screen.queryByText("Rev 1")).toBeNull();
  });

  it("offers a long list's used sections as composer chips", async () => {
    const long = sectionOptions("soaw", tId, [
      { key: "1.1", label: "Scope" },
      { key: "1.2", label: "Vision" },
      { key: "2.1", label: "Objectives" },
      { key: "2.2", label: "Constraints" },
      { key: "3.1", label: "Process" },
      { key: "4.1", label: "Baseline" },
      { key: "4.2", label: "Target" },
    ]);
    serve({ can, open_count: 1, threads: [thread({ id: "a", section: "2.1" })] });
    renderPanel({ sections: long });
    await screen.findByTestId("thread-a");
    const composer = within(screen.getByRole("group", { name: "Section" }));
    expect(composer.getAllByRole("button").map((b) => b.querySelector(".MuiChip-label")?.textContent)).toEqual([
      "Objectives",
      "More…",
    ]);
  });
});
