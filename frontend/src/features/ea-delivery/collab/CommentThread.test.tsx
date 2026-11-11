import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import type { DocumentComment, DocumentThread } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("../RichTextEditor", () => ({
  default: (props: { content: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label={props.placeholder} value={props.content} onChange={(e) => props.onChange(e.target.value)} />
  ),
}));

import { formatDateTimeWith } from "@/hooks/useDateFormat";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import CommentThread from "./CommentThread";
import { clearAllDrafts, draftKey, readDraft, writeDraft } from "./commentDrafts";

const OWNER = { kind: "adr" as const, id: "a2" };
const CREATED = "2026-11-01T10:00:00Z";
const DATE = formatDateTimeWith("YYYY-MM-DD", CREATED);

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
    created_at: CREATED,
    edited_at: null,
    deleted: false,
    resolved_at: null,
    resolved_by: null,
    can: { edit: true, delete: true, resolve: true },
    ...overrides,
  };
}

const NONE = { edit: false, delete: false, resolve: false };

function thread(overrides: Partial<DocumentThread> = {}): DocumentThread {
  return { ...comment(), replies: [], ...overrides };
}

function deleted(overrides: Partial<DocumentComment> = {}): DocumentComment {
  return comment({ body: "", deleted: true, edited_at: CREATED, can: NONE, ...overrides });
}

const actions = {
  onReply: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onResolve: vi.fn(),
  onReopen: vi.fn(),
};

function renderThread(th: DocumentThread, opts: { canComment?: boolean; sectionLabel?: string | null } = {}) {
  return renderWithProviders(
    <CommentThread
      thread={th}
      sectionLabel={opts.sectionLabel === undefined ? "Context" : opts.sectionLabel}
      canComment={opts.canComment ?? true}
      owner={OWNER}
      {...actions}
    />,
  );
}

beforeEach(() => {
  mockApi.reset();
  clearAllDrafts();
  vi.clearAllMocks();
});

describe("CommentThread — a deleted comment", () => {
  it("is one small line naming its author and date, with nothing to act on", () => {
    renderThread(
      thread({
        replies: [deleted({ id: "r1", author: { id: "u2", display_name: "Bo" }, author_name: "Bo" }), comment({ id: "r2", body: "<p>Live</p>" })],
      }),
    );
    const line = screen.getByTestId("deleted-r1");
    expect(line.textContent).toBe(`Bo · ${DATE} · Comment deleted`);
    expect(line.className).toMatch(/MuiTypography-caption/);
    expect(within(line).queryByRole("button")).toBeNull();
    expect(screen.queryByText("(edited)")).toBeNull();
    // The live comments around it keep their edit and delete.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("falls back to the author's stored name", () => {
    renderThread(thread({ replies: [deleted({ id: "r1", author: null, author_name: "Gone" }), comment({ id: "r2" })] }));
    expect(screen.getByTestId("deleted-r1").textContent).toBe(`Gone · ${DATE} · Comment deleted`);
  });

  it("keeps a live thread's Reply and Resolve when only a reply is deleted", () => {
    renderThread(thread({ replies: [deleted({ id: "r1" })] }));
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
  });
});

describe("CommentThread — a closed thread (first comment deleted)", () => {
  const closed = () =>
    thread({
      deleted: true,
      body: "",
      can: NONE,
      resolved_at: CREATED,
      resolved_by: { id: "u3", display_name: "Cy" },
      replies: [comment({ id: "r1", body: "<p>Still here</p>", author: { id: "u2", display_name: "Bo" }, author_name: "Bo" })],
    });

  it("keeps its card, chips and live replies, with no Reply, Resolve or Reopen", () => {
    renderThread(closed());
    const card = screen.getByTestId("thread-t1");
    expect(card).not.toHaveAttribute("data-compact");
    expect(screen.getByTestId("deleted-t1").textContent).toBe(`Ada Lovelace · ${DATE} · Comment deleted`);
    expect(screen.getByText("Still here")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("Resolved by Cy")).toBeInTheDocument();
    for (const name of ["Reply", "Resolve", "Reopen"]) expect(screen.queryByRole("button", { name })).toBeNull();
    // The live reply is still its author's to edit and delete.
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("drops a kept reply draft instead of reopening the composer", () => {
    const key = draftKey(OWNER, { kind: "reply", threadId: "t1" });
    writeDraft(key, { body: "<p>half-written</p>" });
    renderThread(closed());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(readDraft(key)).toBeUndefined();
  });

  it("reopens a kept reply draft on a live thread", () => {
    const key = draftKey(OWNER, { kind: "reply", threadId: "t1" });
    writeDraft(key, { body: "<p>half-written</p>" });
    renderThread(thread());
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(readDraft(key)).toEqual({ body: "<p>half-written</p>" });
  });
});

describe("CommentThread — a thread with nothing live left", () => {
  it("is the one small line alone: no card, chips or buttons, still findable by id", () => {
    renderThread(
      thread({
        deleted: true,
        body: "",
        can: NONE,
        resolved_at: CREATED,
        replies: [deleted({ id: "r1" })],
      }),
    );
    const row = screen.getByTestId("thread-t1");
    expect(row).toHaveAttribute("id", "thread-t1");
    expect(row).toHaveAttribute("data-compact", "true");
    expect(row.textContent).toBe(`Ada Lovelace · ${DATE} · Comment deleted`);
    expect(within(row).queryByRole("button")).toBeNull();
    expect(screen.queryByText("Context")).toBeNull();
    expect(screen.queryByTestId("deleted-r1")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("is compact with no reply at all", () => {
    renderThread(thread({ deleted: true, body: "", can: NONE }), { sectionLabel: null });
    expect(screen.getByTestId("thread-t1")).toHaveAttribute("data-compact", "true");
  });
});
