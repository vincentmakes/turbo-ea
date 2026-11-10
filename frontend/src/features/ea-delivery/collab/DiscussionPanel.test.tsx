import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

beforeEach(() => {
  mockApi.reset();
  editorProps.last = null;
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
});
