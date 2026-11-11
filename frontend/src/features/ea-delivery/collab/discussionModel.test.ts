import { describe, expect, it } from "vitest";
import type { DocumentComment, DocumentThread } from "@/types";
import {
  GENERAL_SECTION,
  REJECT_REASON_MAX,
  SECTION_CHIPS_ALL_MAX,
  addFilterKey,
  applySectionFilter,
  composerSectionChips,
  sectionFilterChips,
  threadSectionKey,
  toggleFilterKey,
  SIGN_NOTE_MAX,
  applyThread,
  authorName,
  discussionPath,
  groupThreads,
  isBlankHtml,
  hasLiveComment,
  isOpenThread,
  threadClosed,
  markDeleted,
  markerUnfoldsResolved,
  newCommentBody,
  openCount,
  rejectionBodyOrFallback,
  sectionLabel,
  sectionOptions,
  sectionThreadCounts,
  sectionWithoutThreads,
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

describe("threadClosed / hasLiveComment", () => {
  it("closes a thread whose first comment is deleted, and only that one", () => {
    expect(threadClosed(thread({ deleted: true }))).toBe(true);
    expect(threadClosed(thread({ deleted: false, replies: [comment({ id: "r", deleted: true })] }))).toBe(false);
  });
  it("finds a live comment in the thread's first comment or any reply", () => {
    expect(hasLiveComment(thread())).toBe(true);
    expect(hasLiveComment(thread({ replies: [comment({ id: "r", deleted: true })] }))).toBe(true);
    expect(hasLiveComment(thread({ deleted: true }))).toBe(false);
    expect(hasLiveComment(thread({ deleted: true, replies: [comment({ id: "r", deleted: true })] }))).toBe(false);
    expect(
      hasLiveComment(
        thread({ deleted: true, replies: [comment({ id: "r", deleted: true }), comment({ id: "s" })] }),
      ),
    ).toBe(true);
  });
});

describe("a deleted thread in the counts and the filter", () => {
  const sections = [{ key: "context", label: "Context" }];
  const t = (k: string) => k;
  const dead = thread({ id: "d", section: "context", deleted: true });
  const closed = thread({ id: "c", section: "context", deleted: true, replies: [comment({ id: "r" })] });
  it("never counts as open, nor in a section marker", () => {
    expect(isOpenThread(dead)).toBe(false);
    expect(isOpenThread(closed)).toBe(false);
    expect(openCount([dead, closed], dead.revision_id)).toBe(0);
    expect(sectionThreadCounts([dead, closed], dead.revision_id, sections)).toEqual({});
  });
  it("stays listed and filterable under its section", () => {
    expect(sectionFilterChips([dead, closed, thread({ id: "g", section: null })], sections, [], t)).toEqual([
      { key: "general", label: "collab.discussion.section.general", count: 1, active: false },
      { key: "context", label: "Context", count: 2, active: false },
    ]);
    expect(applySectionFilter([dead, closed, thread({ id: "g", section: null })], ["context"]).map((x) => x.id)).toEqual([
      "d",
      "c",
    ]);
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
  it("keeps a thread in place once its last live reply is deleted", () => {
    const out = markDeleted([thread({ id: "t", deleted: true, replies: [comment({ id: "r" })] })], "r");
    expect(out.map((th) => th.id)).toEqual(["t"]);
    expect(out[0].deleted).toBe(true);
    expect(out[0].replies[0].deleted).toBe(true);
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
    expect(isBlankHtml("<p>\u00a0</p><p> \n\t</p>")).toBe(true);
  });
  it("is not blank with text or a mention", () => {
    expect(isBlankHtml("<p>a</p>")).toBe(false);
    expect(isBlankHtml("<p> &nbsp;a </p>")).toBe(false);
    expect(isBlankHtml('<p><span data-type="mention" data-kind="card" data-id="x"></span></p>')).toBe(false);
  });
  it("reads the text a browser would show, not what a tag pattern leaves", () => {
    // Markup is never text, however it is broken or nested.
    expect(isBlankHtml("<p")).toBe(true);
    expect(isBlankHtml('<p><img src="x" alt="y"></p>')).toBe(true);
    expect(isBlankHtml("<p><!-- a note --></p>")).toBe(true);
    expect(isBlankHtml("<div><p><strong><em></em></strong></p></div>")).toBe(true);
    // Text is text, including what a single pass of a tag pattern would mangle.
    expect(isBlankHtml("<scr<script>ipt>")).toBe(false);
    expect(isBlankHtml("<<p>></p>")).toBe(false);
    expect(isBlankHtml("<p>&lt;p&gt;</p>")).toBe(false);
    expect(isBlankHtml("<p>a &lt; b</p>")).toBe(false);
  });
  it("runs nothing and loads nothing while it reads", () => {
    const w = window as unknown as { __blankProbe?: number };
    delete w.__blankProbe;
    const image = '<img src="x" onerror="window.__blankProbe = 1">';
    expect(isBlankHtml(image)).toBe(true);
    // A script's source is text to the parser, and it is never run.
    expect(isBlankHtml(`${image}<script>window.__blankProbe = 2</script>`)).toBe(false);
    expect(w.__blankProbe).toBeUndefined();
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

describe("threadSectionKey", () => {
  it("is the thread's section, or General without one", () => {
    expect(threadSectionKey({ section: "context" })).toBe("context");
    expect(threadSectionKey({ section: null })).toBe(GENERAL_SECTION);
    expect(threadSectionKey({ section: "" })).toBe(GENERAL_SECTION);
  });
});

describe("composerSectionChips", () => {
  const opts = (n: number) => [
    { key: GENERAL_SECTION, label: "General" },
    ...Array.from({ length: n }, (_, i) => ({ key: `s${i + 1}`, label: `S${i + 1}` })),
  ];

  it("shows every section of a short list, General left out", () => {
    expect(SECTION_CHIPS_ALL_MAX).toBe(6);
    expect(composerSectionChips(opts(4), [], "")).toEqual({ chips: opts(4).slice(1), more: [] });
    expect(composerSectionChips(opts(6), [], "").chips).toHaveLength(6);
  });

  it("shows the used and the chosen sections of a long list in document order, the rest behind More", () => {
    const { chips, more } = composerSectionChips(opts(7), ["s5", null, "s2", "gone"], "s7");
    expect(chips.map((c) => c.key)).toEqual(["s2", "s5", "s7"]);
    expect(more.map((c) => c.key)).toEqual(["s1", "s3", "s4", "s6"]);
  });

  it("shows no chip of a long list when nothing is used or chosen", () => {
    const { chips, more } = composerSectionChips(opts(7), [], "");
    expect(chips).toEqual([]);
    expect(more).toHaveLength(7);
  });
});

describe("sectionFilterChips", () => {
  const sections = [
    { key: GENERAL_SECTION, label: "General" },
    { key: "context", label: "Context" },
    { key: "decision", label: "Decision" },
  ];

  it("has no chip when no thread has a section", () => {
    expect(sectionFilterChips([{ section: null }, { section: null }], sections, [], t)).toEqual([]);
    expect(sectionFilterChips([], sections, [], t)).toEqual([]);
  });

  it("counts each section in document order, General first when both kinds are listed, removed ones last", () => {
    const threads = [
      { section: "gone" },
      { section: "decision" },
      { section: null },
      { section: "context" },
      { section: "decision" },
    ];
    expect(sectionFilterChips(threads, sections, ["decision"], t)).toEqual([
      { key: GENERAL_SECTION, label: "T(collab.discussion.section.general)", count: 1, active: false },
      { key: "context", label: "Context", count: 1, active: false },
      { key: "decision", label: "Decision", count: 2, active: true },
      { key: "gone", label: "T(collab.discussion.section.removed)", count: 1, active: false },
    ]);
  });

  it("leaves General out when every listed thread has a section", () => {
    expect(sectionFilterChips([{ section: "context" }], sections, [], t).map((c) => c.key)).toEqual(["context"]);
  });

  it("keeps a chip that is on at 0 so it can be turned off", () => {
    expect(sectionFilterChips([{ section: "context" }], sections, ["decision", GENERAL_SECTION], t)).toEqual([
      { key: GENERAL_SECTION, label: "T(collab.discussion.section.general)", count: 0, active: true },
      { key: "context", label: "Context", count: 1, active: false },
      { key: "decision", label: "Decision", count: 0, active: true },
    ]);
  });
});

describe("sectionFilterChips on a section with no thread (a section marker)", () => {
  it("shows the one section that is on, pressed at 0, even with no thread at all", () => {
    const sections = [
      { key: GENERAL_SECTION, label: "General" },
      { key: "context", label: "Context" },
    ];
    expect(sectionFilterChips([], sections, ["context"], t)).toEqual([
      { key: "context", label: "Context", count: 0, active: true },
    ]);
  });
});

describe("sectionWithoutThreads", () => {
  const threads = [{ section: "context" }, { section: null }];

  it("is true for one section no thread carries", () => {
    expect(sectionWithoutThreads(threads, ["decision"])).toBe(true);
    expect(sectionWithoutThreads([], ["decision"])).toBe(true);
  });

  it("is false for a section a thread carries, General included", () => {
    expect(sectionWithoutThreads(threads, ["context"])).toBe(false);
    expect(sectionWithoutThreads(threads, [GENERAL_SECTION])).toBe(false);
  });

  it("is false with no filter or several sections", () => {
    expect(sectionWithoutThreads(threads, [])).toBe(false);
    expect(sectionWithoutThreads(threads, ["decision", "consequences"])).toBe(false);
    expect(sectionWithoutThreads([], ["decision", "consequences"])).toBe(false);
  });
});

describe("composerSectionChips with a section a marker chose", () => {
  it("shows the chosen section's chip in a long list, in document order", () => {
    const opts = [
      { key: GENERAL_SECTION, label: "General" },
      ...Array.from({ length: SECTION_CHIPS_ALL_MAX + 1 }, (_, i) => ({ key: `s${i + 1}`, label: `S${i + 1}` })),
    ];
    const { chips, more } = composerSectionChips(opts, ["s5"], "s2");
    expect(chips.map((c) => c.key)).toEqual(["s2", "s5"]);
    expect(more.map((c) => c.key)).not.toContain("s2");
  });
});

describe("filter keys", () => {
  it("toggles a key on and off, keeping the order", () => {
    expect(toggleFilterKey([], "a")).toEqual(["a"]);
    expect(toggleFilterKey(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleFilterKey(["a", "b"], "a")).toEqual(["b"]);
  });

  it("adds a key once", () => {
    expect(addFilterKey(["a"], "b")).toEqual(["a", "b"]);
    const kept = ["a"];
    const next = addFilterKey(kept, "a");
    expect(next).toEqual(["a"]);
    expect(next).not.toBe(kept);
  });
});

describe("applySectionFilter", () => {
  const threads = [
    { id: "1", section: "context" },
    { id: "2", section: null },
    { id: "3", section: "decision" },
  ];

  it("lets everything through without a filter, as a new list", () => {
    const out = applySectionFilter(threads, []);
    expect(out).toEqual(threads);
    expect(out).not.toBe(threads);
  });

  it("keeps the threads of any section that is on, General included", () => {
    expect(applySectionFilter(threads, ["decision", GENERAL_SECTION]).map((th) => th.id)).toEqual(["2", "3"]);
    expect(applySectionFilter(threads, ["context"]).map((th) => th.id)).toEqual(["1"]);
  });

  it("always keeps the thread a notification points at", () => {
    expect(applySectionFilter(threads, ["context"], "3").map((th) => th.id)).toEqual(["1", "3"]);
    expect(applySectionFilter(threads, ["context"], null).map((th) => th.id)).toEqual(["1"]);
  });
});

describe("sectionThreadCounts", () => {
  const SECTIONS = [
    { key: GENERAL_SECTION, label: "General" },
    { key: "context", label: "Context" },
    { key: "decision", label: "Decision" },
    { key: "consequences", label: "Consequences" },
  ];

  it("counts each section's open threads and all its threads, on the document shown only", () => {
    const counts = sectionThreadCounts(
      [
        thread({ id: "a", section: "context" }),
        thread({ id: "b", section: "context", resolved_at: "2026-11-02T00:00:00Z" }),
        thread({ id: "c", section: "context", kind: "rejection" }),
        thread({ id: "d", section: "decision", resolved_at: "2026-11-02T00:00:00Z" }),
        // An earlier revision's thread is that revision's.
        thread({ id: "e", section: "consequences", revision_id: "doc-1", revision_number: 1 }),
      ],
      "doc-2",
      SECTIONS,
    );
    expect({ ...counts }).toEqual({
      context: { open: 2, total: 3 },
      decision: { open: 0, total: 1 },
    });
  });

  it("leaves out General threads, deleted threads, signing notes and removed sections", () => {
    const counts = sectionThreadCounts(
      [
        thread({ id: "g", section: null }),
        thread({ id: "g2", section: GENERAL_SECTION }),
        thread({ id: "x", section: "context", deleted: true }),
        thread({ id: "s", section: "decision", kind: "sign_note" }),
        thread({ id: "r", section: "custom_gone" }),
      ],
      "doc-2",
      SECTIONS,
    );
    expect({ ...counts }).toEqual({});
  });

  it("gives an inherited property name no entry of its own", () => {
    const counts = sectionThreadCounts([thread({ id: "a", section: "context" })], "doc-2", SECTIONS);
    expect(counts.toString).toBeUndefined();
    expect(counts.context).toEqual({ open: 1, total: 1 });
  });

  it("counts a section key that happens to name an object property like any other", () => {
    const counts = sectionThreadCounts(
      [thread({ id: "a", section: "constructor" }), thread({ id: "b", section: "constructor" })],
      "doc-2",
      [{ key: "constructor", label: "Odd" }],
    );
    expect(counts.constructor).toEqual({ open: 2, total: 2 });
  });
});

describe("markerUnfoldsResolved", () => {
  it("unfolds for a section whose threads are all resolved, never for one with an open thread or none", () => {
    expect(markerUnfoldsResolved({ open: 0, total: 2 })).toBe(true);
    expect(markerUnfoldsResolved({ open: 1, total: 2 })).toBe(false);
    expect(markerUnfoldsResolved({ open: 0, total: 0 })).toBe(false);
    expect(markerUnfoldsResolved(undefined)).toBe(false);
  });
});
