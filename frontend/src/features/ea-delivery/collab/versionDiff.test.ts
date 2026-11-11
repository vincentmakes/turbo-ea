import { describe, expect, it } from "vitest";
import type { MentionLabels } from "@/lib/mentionHtml";
import type { DecisionVersionContent, SoawVersionContent } from "@/types";
import { WORD_DIFF_MAX_TOKENS, decisionDiff, sectionText, soawDiff, textRow, valueRow, wordSegments } from "./versionDiff";

const labels: MentionLabels = {
  restricted: { card: "Restricted card", decision: "Restricted decision", user: "Restricted", other: "Restricted" },
  missing: { card: "Deleted card", decision: "Deleted decision", user: "Unknown person", other: "Deleted item" },
};
const t = (key: string) => `T(${key})`;
const formatDate = (iso: string) => `D(${iso})`;
const opts = { t, labels, formatDate };

const card = (label: string) =>
  `<span data-type="mention" data-kind="card" data-id="c0ffee00-0000-4000-8000-000000000001">@${label}</span>`;

function decision(overrides: Partial<DecisionVersionContent> = {}): DecisionVersionContent {
  return {
    title: "Adopt Kafka",
    context: "<p>We need events.</p>",
    decision: "<p>Use Kafka now</p>",
    consequences: null,
    alternatives_considered: null,
    decided_on: null,
    effective_from: null,
    valid_until: null,
    change_summary: null,
    decision_makers: [],
    participants: [],
    ...overrides,
  };
}

describe("wordSegments", () => {
  it("marks the words removed and added, keeping the rest", () => {
    expect(wordSegments("Use Kafka now", "Use Pulsar now")).toEqual([
      { text: "Use " },
      { text: "Kafka", removed: true },
      { text: "Pulsar", added: true },
      { text: " now" },
    ]);
  });
  it("marks a word only added or only removed", () => {
    expect(wordSegments("a b", "a b c")).toEqual([{ text: "a b" }, { text: " c", added: true }]);
    expect(wordSegments("a b c", "a c")).toEqual([{ text: "a " }, { text: "b ", removed: true }, { text: "c" }]);
  });

  it("compares block by block, keeping unchanged paragraphs whole", () => {
    expect(wordSegments("Intro\nUse Kafka now\nOutro", "Intro\nUse Pulsar now\nOutro")).toEqual([
      { text: "Intro\nUse " },
      { text: "Kafka", removed: true },
      { text: "Pulsar", added: true },
      { text: " now\nOutro" },
    ]);
    expect(wordSegments("A\nB", "A\nNew\nB")).toEqual([{ text: "A\n" }, { text: "New\n", added: true }, { text: "B" }]);
    expect(wordSegments("A\nOld\nB", "A\nB")).toEqual([{ text: "A\n" }, { text: "Old\n", removed: true }, { text: "B" }]);
    expect(wordSegments("", "x\ny")).toEqual([{ text: "x\ny", added: true }]);
    expect(wordSegments("x\ny", "")).toEqual([{ text: "x\ny", removed: true }]);
    expect(wordSegments("", "")).toEqual([]);
  });

  it("reads a small edit in a long paragraph word by word", () => {
    const words = Array.from({ length: 3000 }, (_, i) => `w${i}`);
    const before = words.join(" ");
    const after = [...words.slice(0, 1500), "CHANGED", ...words.slice(1501)].join(" ");
    const segments = wordSegments(before, after);
    expect(segments.filter((s) => s.removed)).toEqual([{ text: "w1500", removed: true }]);
    expect(segments.filter((s) => s.added)).toEqual([{ text: "CHANGED", added: true }]);
    expect(segments.map((s) => s.text).filter((_, i) => !segments[i].removed).join("")).toBe(after);
  });

  it("shows a 10,000-word section rewritten wholesale as removed then added, at once", () => {
    const old = Array.from({ length: 10_000 }, (_, i) => `old${i}`).join(" ");
    const rewritten = Array.from({ length: 10_000 }, (_, i) => `new${i}`).join(" ");
    const started = performance.now();
    const one = wordSegments(old, rewritten);
    // Over several paragraphs, too.
    const para = (prefix: string) =>
      Array.from({ length: 20 }, (_, p) => Array.from({ length: 500 }, (_, i) => `${prefix}${p}x${i}`).join(" ")).join("\n");
    const many = wordSegments(para("a"), para("b"));
    const elapsed = performance.now() - started;
    expect(one).toEqual([
      { text: old, removed: true },
      { text: rewritten, added: true },
    ]);
    expect(many.map((s) => s.text).filter((_, i) => !many[i].added).join("")).toBe(para("a"));
    expect(many.map((s) => s.text).filter((_, i) => !many[i].removed).join("")).toBe(para("b"));
    expect(many.every((s) => s.added || s.removed)).toBe(true);
    // Unbounded, the first of these takes about 19 s; bounded, well under one.
    expect(elapsed).toBeLessThan(3000);
  });

  it("replaces a block whole when it differs too much to diff in time", () => {
    const a = Array.from({ length: 2000 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 2000 }, (_, i) => `b${i}`).join(" ");
    const started = performance.now();
    expect(wordSegments(a, b)).toEqual([
      { text: a, removed: true },
      { text: b, added: true },
    ]);
    // Unbounded this takes about a second.
    expect(performance.now() - started).toBeLessThan(1500);
    // A few words changed in the same block are still read word by word.
    const edited = b.replace("b7 ", "zz ");
    expect(wordSegments(b, edited).filter((s) => s.added || s.removed)).toEqual([
      { text: "b7", removed: true },
      { text: "zz", added: true },
    ]);
  });

  it("word-diffs a changed block up to the size limit, and replaces it whole above", () => {
    const side = (n: number, w: string) => Array.from({ length: n }, () => w).join(" ");
    // Each side, n words then " x", is 2n + 1 tokens: 4n + 2 together.
    const atLimit = Math.floor((WORD_DIFF_MAX_TOKENS - 2) / 4);
    expect(4 * atLimit + 2).toBeLessThanOrEqual(WORD_DIFF_MAX_TOKENS);
    expect(4 * (atLimit + 1) + 2).toBeGreaterThan(WORD_DIFF_MAX_TOKENS);
    const under = wordSegments(`${side(atLimit, "a")} x`, `${side(atLimit, "a")} y`);
    expect(under.filter((s) => s.added)).toEqual([{ text: "y", added: true }]);
    const over = wordSegments(`${side(atLimit + 1, "a")} x`, `${side(atLimit + 1, "a")} y`);
    expect(over).toEqual([
      { text: `${side(atLimit + 1, "a")} x`, removed: true },
      { text: `${side(atLimit + 1, "a")} y`, added: true },
    ]);
  });
});

describe("textRow", () => {
  it("is null for an unchanged field, empty or not", () => {
    expect(textRow("k", "K", "<p>Same</p>", "<p>Same</p>", labels)).toBeNull();
    expect(textRow("k", "K", null, "", labels)).toBeNull();
  });

  it("diffs the words of a changed field", () => {
    expect(textRow("decision", "Decision", "<p>Use Kafka now</p>", "<p>Use Pulsar now</p>", labels)).toEqual({
      key: "decision",
      label: "Decision",
      kind: "text",
      segments: [{ text: "Use " }, { text: "Kafka", removed: true }, { text: "Pulsar", added: true }, { text: " now" }],
      formattingOnly: false,
    });
  });

  it("shows text written into an empty field as added, and a cleared field as removed", () => {
    expect(textRow("k", "K", null, "<p>New text</p>", labels)?.segments).toEqual([{ text: "New text", added: true }]);
    expect(textRow("k", "K", "<p>Old text</p>", null, labels)?.segments).toEqual([{ text: "Old text", removed: true }]);
  });

  it("reports a change of formatting only when the words are the same", () => {
    expect(textRow("k", "K", "<p>Use Kafka</p>", "<p>Use <strong>Kafka</strong></p>", labels)).toEqual({
      key: "k",
      label: "K",
      kind: "text",
      segments: [{ text: "Use Kafka" }],
      formattingOnly: true,
    });
  });

  it("sees no change when only a mentioned card's name differs", () => {
    expect(textRow("k", "K", `<p>See ${card("Old name")}</p>`, `<p>See ${card("New name")}</p>`, labels)).toBeNull();
  });

  it("reads a mention as its label, and a restricted one in the reader's words", () => {
    const restricted = '<span data-type="mention" data-kind="card" data-restricted="true" data-token="abcd"></span>';
    expect(textRow("k", "K", "<p>See</p>", `<p>See ${card("Billing")} and ${restricted}</p>`, labels)?.segments).toEqual([
      { text: "See" },
      { text: " @Billing and Restricted card", added: true },
    ]);
  });
});

describe("valueRow", () => {
  it("is null when the value did not change", () => {
    expect(valueRow("k", "K", "a", "a")).toBeNull();
    expect(valueRow("k", "K", "", "")).toBeNull();
  });
  it("gives the old value, then the new one", () => {
    expect(valueRow("k", "K", "a", "b")).toEqual({
      key: "k",
      label: "K",
      kind: "value",
      segments: [
        { text: "a", removed: true },
        { text: "b", added: true },
      ],
      formattingOnly: false,
    });
  });
  it("leaves out an empty side", () => {
    expect(valueRow("k", "K", "", "b")?.segments).toEqual([{ text: "b", added: true }]);
    expect(valueRow("k", "K", "a", "")?.segments).toEqual([{ text: "a", removed: true }]);
  });
});

describe("decisionDiff", () => {
  it("lists nothing for two equal versions", () => {
    expect(decisionDiff(decision(), decision(), opts)).toEqual([]);
  });

  it("lists every changed field in the order the decision shows them, and only those", () => {
    const before = decision({
      consequences: "<p>Ops load</p>",
      decided_on: "2026-01-01",
      decision_makers: [{ user_id: "u1", display_name: "Ada" }],
    });
    const after = decision({
      title: "Adopt Pulsar",
      decision: "<p>Use Pulsar now</p>",
      consequences: "<p><em>Ops load</em></p>",
      alternatives_considered: "<p>RabbitMQ</p>",
      decided_on: "2026-02-01",
      valid_until: "2027-01-01",
      decision_makers: [
        { user_id: "u1", display_name: "Ada" },
        { user_id: null, display_name: "Grace" },
      ],
      participants: [{ user_id: "u3", display_name: "Linus" }],
      change_summary: "Switched broker",
    });
    const rows = decisionDiff(before, after, opts);
    expect(rows.map((r) => r.key)).toEqual([
      "title",
      "decision",
      "alternatives_considered",
      "consequences",
      "decided_on",
      "valid_until",
      "decision_makers",
      "participants",
      "change_summary",
    ]);
    expect(rows[0]).toEqual({
      key: "title",
      label: "T(adr.title)",
      kind: "value",
      segments: [
        { text: "Adopt Kafka", removed: true },
        { text: "Adopt Pulsar", added: true },
      ],
      formattingOnly: false,
    });
    expect(rows[1].label).toBe("T(adr.decision)");
    expect(rows[2]).toMatchObject({ label: "T(adr.alternativesConsidered)", segments: [{ text: "RabbitMQ", added: true }] });
    expect(rows[3]).toMatchObject({ label: "T(adr.consequences)", formattingOnly: true, segments: [{ text: "Ops load" }] });
    expect(rows[4]).toMatchObject({
      label: "T(adr.dates.decidedOn)",
      segments: [
        { text: "D(2026-01-01)", removed: true },
        { text: "D(2026-02-01)", added: true },
      ],
    });
    expect(rows[5]).toMatchObject({ label: "T(adr.dates.validUntil)", segments: [{ text: "D(2027-01-01)", added: true }] });
    expect(rows[6]).toMatchObject({
      label: "T(adr.people.decisionMakers)",
      segments: [
        { text: "Ada", removed: true },
        { text: "Ada, Grace", added: true },
      ],
    });
    expect(rows[7]).toMatchObject({ label: "T(adr.people.participants)", segments: [{ text: "Linus", added: true }] });
    expect(rows[8]).toMatchObject({ label: "T(adr.revise.changeSummary)", segments: [{ text: "Switched broker", added: true }] });
  });

  it("reads absent people and dates as empty", () => {
    const before = decision({ decision_makers: null, participants: null, effective_from: null });
    const after = decision({ effective_from: "2026-03-01" });
    expect(decisionDiff(before, after, opts)).toEqual([
      {
        key: "effective_from",
        label: "T(adr.dates.effectiveFrom)",
        kind: "value",
        segments: [{ text: "D(2026-03-01)", added: true }],
        formattingOnly: false,
      },
    ]);
  });
});

function soaw(overrides: Partial<SoawVersionContent> = {}): SoawVersionContent {
  return {
    name: "Billing SoAW",
    document_info: { prepared_by: "Ada", reviewed_by: "", review_date: "" },
    version_history: [{ version: "1.0", date: "2026-01-01", revised_by: "Ada", description: "First" }],
    sections: {
      "1.1": { content: "<p>Scope of work</p>", hidden: false },
      "2.1": { content: "<p>Vision</p>", hidden: false },
    },
    ...overrides,
  };
}

const sectionTitles = { "1.1": "Scope", "2.1": "Vision", "3.1": "Plan" };

describe("sectionText", () => {
  it("joins a section's text, table rows and phase notes, and says when it is hidden", () => {
    expect(
      sectionText(
        {
          content: "<p>Intro</p>",
          hidden: true,
          table_data: { columns: ["a", "b"], rows: [["1", "2"]] },
          togaf_data: { A: "Vision work", B: "" },
        },
        labels,
        "[hidden]",
      ),
    ).toBe("[hidden]\nIntro\n1 | 2\nA: Vision work");
    expect(sectionText(undefined, labels, "[hidden]")).toBe("");
  });
});

describe("soawDiff", () => {
  it("lists nothing for two equal versions", () => {
    expect(soawDiff(soaw(), soaw(), { ...opts, sectionTitles })).toEqual([]);
  });

  it("lists the name, changed document info, the version table, then each changed section", () => {
    const after = soaw({
      name: "Billing SoAW v2",
      document_info: { prepared_by: "Ada", reviewed_by: "Grace", review_date: "2026-05-01" },
      version_history: [
        { version: "1.0", date: "2026-01-01", revised_by: "Ada", description: "First" },
        { version: "1.1", date: "", revised_by: "", description: "" },
      ],
      sections: {
        "1.1": { content: "<p>Scope of <strong>work</strong></p>", hidden: false },
        "2.1": { content: "<p>Vision</p>", hidden: true },
        "3.1": { content: "<p>Plan</p>", hidden: false },
        custom_7: { content: "<p>Risks text</p>", hidden: false, title: "Risks" },
      },
    });
    const rows = soawDiff(soaw(), after, { ...opts, sectionTitles });
    expect(rows.map((r) => [r.key, r.label])).toEqual([
      ["name", "T(editor.documentName)"],
      ["reviewed_by", "T(editor.reviewedBy)"],
      ["review_date", "T(editor.reviewDate)"],
      ["version_history", "T(editor.versionHistory)"],
      ["1.1", "Scope"],
      ["2.1", "Vision"],
      ["3.1", "Plan"],
      ["custom_7", "Risks"],
    ]);
    expect(rows[2].segments).toEqual([{ text: "D(2026-05-01)", added: true }]);
    expect(rows[3].segments).toEqual([
      { text: "1.0 · 2026-01-01 · Ada · First" },
      { text: "\n1.1", added: true },
    ]);
    expect(rows[4]).toMatchObject({ formattingOnly: true, segments: [{ text: "Scope of work" }] });
    expect(rows[5]).toMatchObject({
      formattingOnly: false,
      segments: [{ text: "T(collab.compare.hiddenSection)\n", added: true }, { text: "Vision" }],
    });
    expect(rows[6].segments).toEqual([{ text: "Plan", added: true }]);
    expect(rows[7].segments).toEqual([{ text: "Risks text", added: true }]);
  });

  it("names a section removed since by its stored title, and an unknown one by its key", () => {
    const before = soaw({
      sections: {
        custom_1: { content: "<p>Gone</p>", hidden: false, title: "Old part" },
        x_9: { content: "<p>Odd</p>", hidden: false },
      },
    });
    const after = soaw({ sections: {} });
    const rows = soawDiff(before, after, { ...opts, sectionTitles });
    expect(rows.map((r) => [r.key, r.label, r.segments])).toEqual([
      ["custom_1", "Old part", [{ text: "Gone", removed: true }]],
      ["x_9", "x_9", [{ text: "Odd", removed: true }]],
    ]);
  });

  it("reads missing document info, tables and sections as empty", () => {
    const before = soaw({ document_info: null, version_history: null, sections: null });
    const after = soaw({ document_info: null, version_history: null, sections: null, name: "Renamed" });
    expect(soawDiff(before, after, { ...opts, sectionTitles }).map((r) => r.key)).toEqual(["name"]);
  });

  it("sees no change in a section when only a mentioned card's name differs", () => {
    const before = soaw({ sections: { "1.1": { content: `<p>${card("A")}</p>`, hidden: false } } });
    const after = soaw({ sections: { "1.1": { content: `<p>${card("B")}</p>`, hidden: false } } });
    expect(soawDiff(before, after, { ...opts, sectionTitles })).toEqual([]);
  });
});
