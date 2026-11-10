import { describe, expect, it } from "vitest";
import type { DocumentComment, DocumentThread } from "@/types";
import {
  GENERAL_SECTION,
  REJECT_REASON_MAX,
  SIGN_NOTE_MAX,
  applyThread,
  authorName,
  discussionPath,
  groupThreads,
  isBlankHtml,
  isOpenThread,
  markDeleted,
  newCommentBody,
  openCount,
  rejectionBodyOrFallback,
  sectionLabel,
  sectionOptions,
  signBody,
  soawSectionOptions,
  splitResolved,
  threadPaths,
  writeErrorMessage,
} from "./discussionModel";

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : `T(${key})`);

function comment(overrides: Partial<DocumentComment> = {}): DocumentComment {
  return {
    id: "c1",
    kind: "comment",
    section: null,
    revision_id: "doc-2",
    revision_number: 2,
    author: { id: "u1", display_name: "Ada" },
    author_name: "Ada",
    body: "<p>Hello</p>",
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

describe("sectionOptions", () => {
  it("offers General then the decision's four sections in the order the decision shows them", () => {
    expect(sectionOptions("adr", t)).toEqual([
      { key: "general", label: "T(collab.discussion.section.general)" },
      { key: "context", label: "T(adr.context)" },
      { key: "decision", label: "T(adr.decision)" },
      { key: "alternatives_considered", label: "T(adr.alternativesConsidered)" },
      { key: "consequences", label: "T(adr.consequences)" },
    ]);
  });

  it("offers General then the SoAW sections it is given", () => {
    const soaw = [{ key: "1.1", label: "Scope" }];
    expect(sectionOptions("soaw", t, soaw)).toEqual([
      { key: "general", label: "T(collab.discussion.section.general)" },
      { key: "1.1", label: "Scope" },
    ]);
    expect(sectionOptions("soaw", t)).toEqual([{ key: "general", label: "T(collab.discussion.section.general)" }]);
  });
});

describe("soawSectionOptions", () => {
  it("lists template sections in template order, then custom sections under their titles", () => {
    expect(
      soawSectionOptions(
        [
          { id: "1.1", title: "Scope" },
          { id: "2.1", title: "Vision" },
        ],
        {
          "2.1": { content: "x" },
          custom_9: { title: "Risks" },
          custom_4: { title: "" },
          custom_5: { title: 3 },
        },
      ),
    ).toEqual([
      { key: "1.1", label: "Scope" },
      { key: "2.1", label: "Vision" },
      { key: "custom_9", label: "Risks" },
      { key: "custom_4", label: "custom_4" },
      { key: "custom_5", label: "custom_5" },
    ]);
  });

  it("lists the template alone for a document with no sections", () => {
    expect(soawSectionOptions([{ id: "1.1", title: "Scope" }], null)).toEqual([{ key: "1.1", label: "Scope" }]);
    expect(soawSectionOptions([], undefined)).toEqual([]);
  });
});

describe("sectionLabel", () => {
  const options = [
    { key: GENERAL_SECTION, label: "General" },
    { key: "custom_1", label: "Risks" },
  ];
  it("labels a known section with its title", () => {
    expect(sectionLabel("custom_1", options, t)).toBe("Risks");
    expect(sectionLabel("general", options, t)).toBe("General");
  });
  it("labels a section the document no longer has as removed", () => {
    expect(sectionLabel("custom_2", options, t)).toBe("T(collab.discussion.section.removed)");
  });
  it("gives an untagged thread no label", () => {
    expect(sectionLabel(null, options, t)).toBeNull();
    expect(sectionLabel("", options, t)).toBeNull();
  });
});

describe("groupThreads", () => {
  it("puts this revision's threads first and the others under one group per revision, in order", () => {
    const a = thread({ id: "a", revision_id: "doc-1", revision_number: 1 });
    const b = thread({ id: "b", revision_id: "doc-2", revision_number: 2 });
    const c = thread({ id: "c", revision_id: "doc-1", revision_number: 1 });
    const d = thread({ id: "d", revision_id: "doc-0", revision_number: 3 });
    const e = thread({ id: "e", revision_id: "doc-2", revision_number: 2 });
    const grouped = groupThreads([a, b, c, d, e], "doc-2");
    expect(grouped.current.map((th) => th.id)).toEqual(["b", "e"]);
    expect(grouped.earlier).toEqual([
      { revisionId: "doc-1", revisionNumber: 1, threads: [a, c] },
      { revisionId: "doc-0", revisionNumber: 3, threads: [d] },
    ]);
  });

  it("has no earlier groups when every thread is on this revision", () => {
    const a = thread({ id: "a" });
    expect(groupThreads([a], "doc-2")).toEqual({ current: [a], earlier: [] });
  });
});

describe("open threads", () => {
  it("counts an unresolved, undeleted comment or rejection as open", () => {
    expect(isOpenThread(thread())).toBe(true);
    expect(isOpenThread(thread({ kind: "rejection" }))).toBe(true);
  });
  it("does not count a resolved, a deleted or a signing-note thread", () => {
    expect(isOpenThread(thread({ resolved_at: "2026-11-02T00:00:00Z" }))).toBe(false);
    expect(isOpenThread(thread({ deleted: true }))).toBe(false);
    expect(isOpenThread(thread({ kind: "sign_note" }))).toBe(false);
  });
  it("counts the open threads of this revision only", () => {
    const threads = [
      thread({ id: "1" }),
      thread({ id: "2", kind: "rejection" }),
      thread({ id: "3", resolved_at: "2026-11-02T00:00:00Z" }),
      thread({ id: "4", revision_id: "doc-1" }),
      thread({ id: "5", kind: "sign_note" }),
    ];
    expect(openCount(threads, "doc-2")).toBe(2);
    expect(openCount(threads, "doc-1")).toBe(1);
    expect(openCount([], "doc-2")).toBe(0);
  });
});

describe("splitResolved", () => {
  it("folds resolved threads away but never a signing note", () => {
    const open = thread({ id: "o" });
    const done = thread({ id: "d", resolved_at: "2026-11-02T00:00:00Z" });
    const note = thread({ id: "n", kind: "sign_note", resolved_at: "2026-11-02T00:00:00Z" });
    expect(splitResolved([open, done, note])).toEqual({ shown: [open, note], resolved: [done] });
  });
});

describe("paths", () => {
  const owner = { kind: "adr" as const, id: "doc-2" };
  it("reads this document's discussion, or the chain's", () => {
    expect(discussionPath(owner, "document")).toBe("/adr/doc-2/comments");
    expect(discussionPath({ kind: "soaw", id: "s1" }, "chain")).toBe("/soaw/s1/comments?scope=chain");
  });
  it("builds every thread action on the thread's own revision", () => {
    const paths = threadPaths(owner, { id: "t1", revision_id: "doc-1" });
    expect(paths.replies).toBe("/adr/doc-1/comments");
    expect(paths.resolve).toBe("/adr/doc-1/comments/t1/resolve");
    expect(paths.reopen).toBe("/adr/doc-1/comments/t1/reopen");
    expect(paths.comment("r9")).toBe("/adr/doc-1/comments/r9");
    expect(threadPaths({ kind: "soaw", id: "s2" }, { id: "t", revision_id: "s2" }).comment("t")).toBe(
      "/soaw/s2/comments/t",
    );
  });
});

describe("newCommentBody", () => {
  it("sends a reply's parent and no section", () => {
    expect(newCommentBody("<p>x</p>", { parentId: "t1", section: "context" })).toEqual({
      body: "<p>x</p>",
      parent_id: "t1",
    });
  });
  it("sends a new thread's section, and none for General", () => {
    expect(newCommentBody("<p>x</p>", { section: "context" })).toEqual({ body: "<p>x</p>", section: "context" });
    expect(newCommentBody("<p>x</p>", { section: "general" })).toEqual({ body: "<p>x</p>" });
    expect(newCommentBody("<p>x</p>", {})).toEqual({ body: "<p>x</p>" });
    expect(newCommentBody("<p>x</p>", { section: null, parentId: null })).toEqual({ body: "<p>x</p>" });
  });
});

describe("applyThread", () => {
  it("replaces the thread of the same id in place, without the write's extra fields", () => {
    const a = thread({ id: "a" });
    const b = thread({ id: "b" });
    const updated = { ...thread({ id: "a", body: "<p>new</p>" }), unnotified_mentions: [{ id: "u", display_name: "U" }] };
    const out = applyThread([a, b], updated);
    expect(out).toEqual([thread({ id: "a", body: "<p>new</p>" }), b]);
    expect(out[1]).toBe(b);
    expect("unnotified_mentions" in out[0]).toBe(false);
  });
  it("appends a thread it does not hold yet", () => {
    const a = thread({ id: "a" });
    const n = thread({ id: "n" });
    expect(applyThread([a], n)).toEqual([a, n]);
  });
});

describe("markDeleted", () => {
  it("blanks a deleted thread and keeps its replies", () => {
    const reply = comment({ id: "r" });
    const out = markDeleted([thread({ id: "t", replies: [reply] }), thread({ id: "u" })], "t");
    expect(out[0]).toEqual({
      ...thread({ id: "t", replies: [reply] }),
      body: "",
      deleted: true,
      can: { edit: false, delete: false, resolve: false },
    });
    expect(out[0].replies).toEqual([reply]);
    expect(out[1]).toEqual(thread({ id: "u" }));
  });
  it("blanks a deleted reply in its thread", () => {
    const keep = comment({ id: "k" });
    const out = markDeleted([thread({ id: "t", replies: [comment({ id: "r" }), keep] })], "r");
    expect(out[0].body).toBe("<p>Hello</p>");
    expect(out[0].replies[0]).toEqual({
      ...comment({ id: "r" }),
      body: "",
      deleted: true,
      can: { edit: false, delete: false, resolve: false },
    });
    expect(out[0].replies[1]).toBe(keep);
  });
  it("leaves the list alone for an id it does not hold", () => {
    const th = thread({ id: "t" });
    expect(markDeleted([th], "zzz")[0]).toBe(th);
  });
});

describe("isBlankHtml", () => {
  it("is blank for no text", () => {
    expect(isBlankHtml("")).toBe(true);
    expect(isBlankHtml("<p></p>")).toBe(true);
    expect(isBlankHtml("<p> &nbsp; </p>")).toBe(true);
  });
  it("is not blank with text or a mention", () => {
    expect(isBlankHtml("<p>a</p>")).toBe(false);
    expect(isBlankHtml('<p><span data-type="mention" data-kind="card" data-id="x"></span></p>')).toBe(false);
  });
});

describe("rejectionBodyOrFallback", () => {
  it("gives an empty rejection the fallback, escaped", () => {
    expect(rejectionBodyOrFallback({ kind: "rejection", body: "" }, "No <reason>")).toBe("<p>No &lt;reason&gt;</p>");
    expect(rejectionBodyOrFallback({ kind: "rejection", body: "<p></p>" }, "None")).toBe("<p>None</p>");
  });
  it("keeps a rejection's reason and any other comment as they are", () => {
    expect(rejectionBodyOrFallback({ kind: "rejection", body: "<p>Too costly</p>" }, "None")).toBe(
      "<p>Too costly</p>",
    );
    expect(rejectionBodyOrFallback({ kind: "comment", body: "" }, "None")).toBe("");
    expect(rejectionBodyOrFallback({ kind: "sign_note", body: "" }, "None")).toBe("");
  });
});

describe("authorName", () => {
  it("prefers the account's name, then the kept name, then the fallback", () => {
    expect(authorName({ author: { id: "u", display_name: "Ada" }, author_name: "Old" }, "?")).toBe("Ada");
    expect(authorName({ author: null, author_name: "Old" }, "?")).toBe("Old");
    expect(authorName({ author: null, author_name: null }, "?")).toBe("?");
  });
});

describe("writeErrorMessage", () => {
  it("shows the server's words, else the fallback", () => {
    expect(writeErrorMessage(new Error("Unknown section"), "fail")).toBe("Unknown section");
    expect(writeErrorMessage(new Error(""), "fail")).toBe("fail");
    expect(writeErrorMessage("boom", "fail")).toBe("fail");
  });
});

describe("review limits and the sign body", () => {
  it("caps a rejection reason at 4000 and a signing note at 2000 characters", () => {
    expect(REJECT_REASON_MAX).toBe(4000);
    expect(SIGN_NOTE_MAX).toBe(2000);
  });
  it("sends a decision's note as comment, and an empty object without one", () => {
    expect(signBody("adr", "  Looks right  ")).toEqual({ comment: "Looks right" });
    expect(signBody("adr", "   ")).toEqual({});
  });
  it("sends a SoAW's note as note, and no body without one", () => {
    expect(signBody("soaw", " ok ")).toEqual({ note: "ok" });
    expect(signBody("soaw", "")).toBeUndefined();
  });
});
