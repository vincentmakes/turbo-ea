import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { DocumentComment, DocumentDiscussion, DocumentThread } from "@/types";

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
import { sectionOptions } from "./discussionModel";

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

function renderPanel(props: Partial<React.ComponentProps<typeof DiscussionPanel>> = {}) {
  return renderWithProviders(
    <DiscussionPanel owner={{ kind: "adr", id: "a2" }} sections={SECTIONS} {...props} />,
  );
}

const can = { comment: true, moderate: false };

type PanelProps = Partial<React.ComponentProps<typeof DiscussionPanel>>;
/** Renders the panel with props a test can change later (`set(...)`), inside the providers. */
function renderHarness(initial: PanelProps) {
  let set: (next: PanelProps) => void = () => {};
  function Harness() {
    const [props, setProps] = useState(initial);
    set = (next) => setProps((p) => ({ ...p, ...next }));
    return <DiscussionPanel owner={{ kind: "adr", id: "a2" }} sections={SECTIONS} {...props} />;
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

    await user.click(screen.getByRole("combobox", { name: "About" }));
    await user.click(await screen.findByRole("option", { name: "Decision" }));
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
        <DiscussionPanel owner={{ kind: "adr", id: "a2" }} sections={SECTIONS} />
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
    expect(await screen.findByText("This comment was deleted.")).toBeInTheDocument();
    expect(screen.getByText("A reply")).toBeInTheDocument();
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

  it("reports this revision's open-thread count", async () => {
    serve({
      can,
      open_count: 2,
      threads: [thread({ id: "a" }), thread({ id: "b", kind: "rejection" }), thread({ id: "c", resolved_at: "x" })],
    });
    const onOpenCountChange = vi.fn();
    renderPanel({ onOpenCountChange });
    await waitFor(() => expect(onOpenCountChange).toHaveBeenLastCalledWith(2));
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

  it("reads the discussion again when the page's refresh key changes, and reports the count after each read", async () => {
    serve({ can, open_count: 1, threads: [thread({ id: "a" })] });
    const onOpenCountChange = vi.fn();
    const { change } = renderHarness({ onOpenCountChange, refreshKey: "v1" });
    await waitFor(() => expect(onOpenCountChange).toHaveBeenCalledWith(1));
    expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(1);

    // A rejection opened a thread on the server.
    serve({ can, open_count: 2, threads: [thread({ id: "a" }), thread({ id: "r", kind: "rejection", body: "<p>No</p>" })] });
    change({ refreshKey: "v2" });
    expect(await screen.findByTestId("thread-r")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/adr/a2/comments")).toHaveLength(2);
    await waitFor(() => expect(onOpenCountChange).toHaveBeenLastCalledWith(2));

    // The same count read again is still reported (the page's own count may have moved).
    const before = onOpenCountChange.mock.calls.length;
    serve({ can, open_count: 2, threads: [thread({ id: "a" }), thread({ id: "r", kind: "rejection", body: "<p>No</p>" })] });
    change({ refreshKey: "v3" });
    await waitFor(() => expect(onOpenCountChange.mock.calls.length).toBe(before + 1));
    expect(onOpenCountChange).toHaveBeenLastCalledWith(2);
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
    await user.click(await screen.findByRole("combobox", { name: "About" }));
    await user.click(await screen.findByRole("option", { name: "Decision" }));
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
    expect(screen.getByRole("combobox", { name: "About" })).toHaveTextContent("Decision");
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
    renderWithProviders(<DiscussionPanel owner={{ kind: "adr", id: "b7" }} sections={SECTIONS} />);
    expect(await screen.findByRole("textbox", { name: /Start a thread/ })).toHaveValue("");
  });
});
