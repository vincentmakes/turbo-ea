import { describe, expect, it } from "vitest";
import type { DocumentHistoryEntry } from "@/types";
import {
  HISTORY_PAGE_SIZE,
  actorName,
  appendPage,
  canRestore,
  changesView,
  comparePairFor,
  compareOptions,
  contentEntries,
  defaultComparePair,
  entryNote,
  entryTitle,
  historyPath,
  newestFirst,
  orderPair,
  otherSide,
  peopleLine,
  restoreErrorMessage,
  restorePath,
  restoredSource,
  selectedVersion,
  splitSoawSections,
  timelineIcon,
  timelineLabelKey,
  versionPath,
} from "./historyModel";

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : `T(${key})`);
const fmt = (iso: string) => `D(${iso})`;

function entry(overrides: Partial<DocumentHistoryEntry> = {}): DocumentHistoryEntry {
  return {
    id: "e1",
    kind: "save",
    actor: { id: "u1", display_name: "Ada" },
    actor_name: "Ada",
    note: null,
    created_at: "2026-11-01T10:00:00Z",
    has_content: true,
    ...overrides,
  };
}

describe("timeline labels and icons", () => {
  it.each([
    ["created", "collab.history.kind.created", "add_circle"],
    ["baseline", "collab.history.kind.baseline", "inventory_2"],
    ["save", "collab.history.kind.save", "save"],
    ["restored", "collab.history.kind.restored", "restore"],
    ["revised", "collab.history.kind.revised", "content_copy"],
    ["sent_for_review", "collab.history.kind.sentForReview", "send"],
    ["signature", "collab.history.kind.signature", "draw"],
    ["signed", "collab.history.kind.signed", "verified"],
    ["rejected", "collab.history.kind.rejected", "block"],
    ["recalled", "collab.history.kind.recalled", "undo"],
    ["recorded", "collab.history.kind.recorded", "history_edu"],
  ])("%s reads %s with %s", (kind, key, icon) => {
    expect(timelineLabelKey(kind)).toBe(key);
    expect(timelineIcon(kind)).toBe(icon);
  });

  it("gives a step this client does not know a neutral label and icon", () => {
    expect(timelineLabelKey("archived")).toBe("collab.history.kind.unknown");
    expect(timelineIcon("archived")).toBe("radio_button_unchecked");
    expect(timelineLabelKey("toString")).toBe("collab.history.kind.unknown");
  });
});

describe("actorName and entryTitle", () => {
  it("names the account, then the kept name, then an unknown person", () => {
    expect(actorName(entry(), t)).toBe("Ada");
    expect(actorName(entry({ actor: null, actor_name: "Gone" }), t)).toBe("Gone");
    expect(actorName(entry({ actor: null, actor_name: null }), t)).toBe("T(collab.history.unknownActor)");
  });
  it("titles a step with what it was and when", () => {
    expect(entryTitle(entry({ kind: "baseline" }), t, fmt)).toBe(
      'collab.history.entryTitle:{"what":"T(collab.history.kind.baseline)","date":"D(2026-11-01T10:00:00Z)"}',
    );
  });
});

describe("restoredSource and entryNote", () => {
  const source = entry({ id: "src", created_at: "2026-10-01T09:00:00Z" });
  const restored = entry({ id: "r", kind: "restored", note: "src" });
  it("finds the step a restore brought back among the loaded steps", () => {
    expect(restoredSource(restored, [source, restored])).toBe(source);
  });
  it("prefers the source the server names, even when it is not loaded", () => {
    const named = entry({
      id: "r2",
      kind: "restored",
      note: "src",
      restored_from: { id: "src", kind: "save", created_at: "2026-09-09T09:00:00Z" },
    });
    expect(restoredSource(named, [])).toEqual({ id: "src", kind: "save", created_at: "2026-09-09T09:00:00Z" });
    expect(entryNote(named, [source], t, fmt)).toBe('collab.history.restoredFrom:{"date":"D(2026-09-09T09:00:00Z)"}');
    expect(restoredSource({ ...named, kind: "save" }, [source])).toBeNull();
  });
  it("finds none for a source not loaded, a restore without a note, or another kind", () => {
    expect(restoredSource(restored, [restored])).toBeNull();
    expect(restoredSource(entry({ kind: "restored", note: null }), [source])).toBeNull();
    expect(restoredSource(entry({ kind: "save", note: "src" }), [source])).toBeNull();
  });
  it("says which version a restore brought back, or that it was an earlier one", () => {
    expect(entryNote(restored, [source, restored], t, fmt)).toBe(
      'collab.history.restoredFrom:{"date":"D(2026-10-01T09:00:00Z)"}',
    );
    expect(entryNote(restored, [restored], t, fmt)).toBe("T(collab.history.restoredFromEarlier)");
  });
  it("shows a rejection's reason, or that none was given", () => {
    expect(entryNote(entry({ kind: "rejected", note: "Too costly" }), [], t, fmt)).toBe(
      'collab.history.reason:{"note":"Too costly"}',
    );
    expect(entryNote(entry({ kind: "rejected", note: null }), [], t, fmt)).toBe("T(collab.history.noReason)");
    expect(entryNote(entry({ kind: "rejected", note: "" }), [], t, fmt)).toBe("T(collab.history.noReason)");
  });
  it("shows a signing note, and nothing for a signature without one or any other step", () => {
    expect(entryNote(entry({ kind: "signature", note: "Fine" }), [], t, fmt)).toBe(
      'collab.history.signNote:{"note":"Fine"}',
    );
    expect(entryNote(entry({ kind: "signature", note: null }), [], t, fmt)).toBeNull();
    expect(entryNote(entry({ kind: "save", note: "x" }), [], t, fmt)).toBeNull();
  });
});

describe("ordering and versions", () => {
  const v1 = entry({ id: "v1", created_at: "2026-11-01T10:00:00Z" });
  const sent = entry({ id: "s", kind: "sent_for_review", has_content: false, created_at: "2026-11-01T11:00:00Z" });
  const v2 = entry({ id: "v2", created_at: "2026-11-02T10:00:00Z" });
  const v3 = entry({ id: "v3", created_at: "2026-11-03T10:00:00Z" });

  it("keeps the steps that hold a version", () => {
    expect(contentEntries([v1, sent, v2])).toEqual([v1, v2]);
  });
  it("puts the newest first and keeps the server's order for steps of the same instant", () => {
    const a = entry({ id: "a", created_at: "2026-11-02T10:00:00Z" });
    const b = entry({ id: "b", created_at: "2026-11-02T10:00:00Z" });
    expect(newestFirst([v1, a, b, v3]).map((e) => e.id)).toEqual(["v3", "a", "b", "v1"]);
  });
  it("compares a version with the one saved before it", () => {
    expect(defaultComparePair("v3", [v3, v2, sent, v1])).toEqual({ from: "v2", to: "v3" });
    expect(defaultComparePair("v2", [v1, v2, v3])).toEqual({ from: "v1", to: "v2" });
  });
  it("compares the oldest version with the one after it", () => {
    expect(defaultComparePair("v1", [v3, v2, v1])).toEqual({ from: "v1", to: "v2" });
  });
  it("offers no comparison with fewer than two versions, or for a step without one", () => {
    expect(defaultComparePair("v1", [v1, sent])).toBeNull();
    expect(defaultComparePair("s", [v1, sent, v2])).toBeNull();
  });
  it("orders two picked versions in time", () => {
    expect(orderPair("v3", "v1", [v1, v2, v3])).toEqual({ from: "v1", to: "v3" });
    expect(orderPair("v1", "v3", [v1, v2, v3])).toEqual({ from: "v1", to: "v3" });
    expect(orderPair("v2", "v2", [v2])).toEqual({ from: "v2", to: "v2" });
  });
  it("adds a later page's steps without repeating any", () => {
    expect(appendPage([v1, v2], [v2, v3]).map((e) => e.id)).toEqual(["v1", "v2", "v3"]);
    expect(appendPage([], [v1])).toEqual([v1]);
  });
});

describe("paths", () => {
  it("reads a page, a version, and restores one", () => {
    expect(HISTORY_PAGE_SIZE).toBe(20);
    expect(historyPath({ kind: "adr", id: "a1" }, 2)).toBe("/adr/a1/history?page=2&page_size=20");
    expect(versionPath({ kind: "soaw", id: "s1" }, "e9")).toBe("/soaw/s1/history/e9");
    expect(restorePath({ kind: "adr", id: "a1" }, "e9")).toBe("/adr/a1/history/e9/restore");
  });
});

describe("canRestore", () => {
  it("offers restore on a version of a draft to a reader the server allows", () => {
    expect(canRestore(true, "draft", { has_content: true })).toBe(true);
  });
  it("offers none otherwise", () => {
    expect(canRestore(false, "draft", { has_content: true })).toBe(false);
    expect(canRestore(true, "in_review", { has_content: true })).toBe(false);
    expect(canRestore(true, "draft", { has_content: false })).toBe(false);
  });
});

describe("restoreErrorMessage", () => {
  const apiError = (detail: unknown, message = "") => Object.assign(new Error(message), { detail });
  it("says the document is no longer a draft", () => {
    expect(restoreErrorMessage(apiError({ error: "not_draft" }), t)).toBe("T(collab.history.restoreNotDraft)");
  });
  it("names refused dates by their problem codes", () => {
    expect(restoreErrorMessage(apiError({ error: "invalid", problems: ["valid_until_past"] }), t)).toBe(
      "T(adr.editor.problem.validUntilPast)",
    );
  });
  it("falls back to the server's words, then a generic failure", () => {
    expect(restoreErrorMessage(apiError("x", "Not found"), t)).toBe("Not found");
    expect(restoreErrorMessage(apiError(null), t)).toBe("T(collab.history.restoreFailed)");
    expect(restoreErrorMessage(null, t)).toBe("T(collab.history.restoreFailed)");
  });
});

describe("splitSoawSections and peopleLine", () => {
  it("splits template and custom sections the way the preview renders them", () => {
    expect(
      splitSoawSections({
        "1.1": { content: "<p>a</p>", hidden: false },
        custom_1: { content: "<p>b</p>", hidden: false, title: "Risks", insertAfter: "1.1" },
        custom_2: { content: "", hidden: false },
      }),
    ).toEqual({
      template: { "1.1": { content: "<p>a</p>", hidden: false } },
      custom: [
        { id: "custom_1", title: "Risks", content: "<p>b</p>", insertAfter: "1.1" },
        { id: "custom_2", title: "custom_2", content: "", insertAfter: "" },
      ],
    });
    expect(splitSoawSections(null)).toEqual({ template: {}, custom: [] });
  });
  it("joins people's names, an older row's free-text name included", () => {
    expect(
      peopleLine([
        { user_id: "u1", display_name: "Ada" },
        { user_id: null, display_name: "" },
        { name: "Grace" } as never,
      ]),
    ).toBe("Ada, Grace");
    expect(peopleLine(null)).toBe("");
  });
});

describe("the History view's selection and comparison", () => {
  const v1 = entry({ id: "v1", created_at: "2026-10-01T09:00:00Z" });
  const sent = entry({ id: "s", kind: "sent_for_review", has_content: false, created_at: "2026-10-04T09:00:00Z" });
  const v2 = entry({ id: "v2", created_at: "2026-10-02T09:00:00Z" });
  const v3 = entry({ id: "v3", created_at: "2026-10-03T09:00:00Z" });
  const rows = [v1, sent, v3, v2];

  it("selects the picked version, else the newest one, never a step without a version", () => {
    expect(selectedVersion(null, rows)).toBe(v3);
    expect(selectedVersion("v1", rows)).toBe(v1);
    expect(selectedVersion("s", rows)).toBe(v3);
    expect(selectedVersion("gone", rows)).toBe(v3);
    expect(selectedVersion(null, [sent])).toBeNull();
    expect(selectedVersion(null, [])).toBeNull();
  });

  it("offers every other version to compare with, newest first", () => {
    expect(compareOptions("v2", rows).map((e) => e.id)).toEqual(["v3", "v1"]);
    expect(compareOptions("v3", rows).map((e) => e.id)).toEqual(["v2", "v1"]);
    expect(compareOptions("v1", [v1, sent])).toEqual([]);
  });

  it("compares with the version before by default, and with the picked one in time order", () => {
    expect(comparePairFor("v3", null, rows)).toEqual({ from: "v2", to: "v3" });
    expect(comparePairFor("v1", null, rows)).toEqual({ from: "v1", to: "v2" });
    expect(comparePairFor("v3", "v1", rows)).toEqual({ from: "v1", to: "v3" });
    expect(comparePairFor("v1", "v3", rows)).toEqual({ from: "v1", to: "v3" });
    // A pick that is the selection itself, not a version, or no longer loaded: the default.
    expect(comparePairFor("v3", "v3", rows)).toEqual({ from: "v2", to: "v3" });
    expect(comparePairFor("v3", "s", rows)).toEqual({ from: "v2", to: "v3" });
    expect(comparePairFor("v3", "gone", rows)).toEqual({ from: "v2", to: "v3" });
    expect(comparePairFor("v1", null, [v1, sent])).toBeNull();
  });

  it("never compares the oldest loaded version with a newer one while earlier rows are not loaded", () => {
    // Fully loaded: the oldest against the one after it, the others against the one before.
    expect(changesView("v1", null, rows, false)).toEqual({ kind: "pair", pair: { from: "v1", to: "v2" } });
    expect(changesView("v3", null, rows, false)).toEqual({ kind: "pair", pair: { from: "v2", to: "v3" } });
    // Earlier rows on a page not read yet: the oldest loaded version waits for them.
    expect(changesView("v1", null, rows, true)).toEqual({ kind: "earlierNotLoaded" });
    expect(changesView("v2", null, rows, true)).toEqual({ kind: "pair", pair: { from: "v1", to: "v2" } });
    // A version picked to compare with is honoured, loaded or not loaded earlier rows.
    expect(changesView("v1", "v3", rows, true)).toEqual({ kind: "pair", pair: { from: "v1", to: "v3" } });
    // A pick that is no longer offered does not count as one.
    expect(changesView("v1", "gone", rows, true)).toEqual({ kind: "earlierNotLoaded" });
    expect(changesView("v1", "v1", rows, true)).toEqual({ kind: "earlierNotLoaded" });
    // One loaded version: "the only one" only when nothing earlier is left to load.
    expect(changesView("v1", null, [v1, sent], true)).toEqual({ kind: "earlierNotLoaded" });
    expect(changesView("v1", null, [v1, sent], false)).toEqual({ kind: "onlyOne" });
  });

  it("names the other side of a pair", () => {
    expect(otherSide("v3", { from: "v2", to: "v3" })).toBe("v2");
    expect(otherSide("v1", { from: "v1", to: "v2" })).toBe("v2");
  });
});
