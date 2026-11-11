/**
 * What changed between two saved versions of a decision or a SoAW, for the
 * History view's Changes pane (`VersionChangesPane`, which loads this module
 * on demand so the `diff` package stays out of the main bundle; import `diff`
 * nowhere else).
 *
 * Each text field or section is reduced to plain text — mentions read as their
 * labels (`fillMentionLabels`, then `htmlToPlainText`) — and compared block
 * by block (a paragraph, a list item: a line of the plain text), then word by
 * word inside the blocks that changed. The word diff is bounded, so a long
 * section rewritten wholesale cannot freeze the page: a changed block too
 * large (or too different) to diff in time reads as removed, then added.
 * Before that, both sides are compared in the form the server stores
 * (mention spans without their names): a field whose stored form is equal is
 * unchanged even when a mentioned card was renamed in between. A field whose
 * plain text is equal but whose HTML is not changed its formatting only.
 * Dates, the change summary, names and people are shown as old → new.
 * Unchanged fields are left out.
 */
import { diffArrays, diffWordsWithSpace } from "diff";

import { canonicalMentionHtml, type MentionLabels } from "@/lib/mentionHtml";
import { htmlToPlainText } from "@/lib/richTextCell";
import type {
  DecisionVersionContent,
  SoawVersionContent,
  SoawVersionSection,
} from "@/types";
import type { Translate } from "../decisionStanding";
import { peopleLine } from "./historyModel";

export interface DiffSegment {
  text: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffRow {
  key: string;
  label: string;
  /** `text`: a word-level diff; `value`: the old value, then the new one. */
  kind: "text" | "value";
  segments: DiffSegment[];
  /** The words are the same; only the formatting (bold, lists, links…) changed. */
  formattingOnly: boolean;
}

export interface DiffOptions {
  t: Translate;
  /** The reader's words for restricted and deleted mentions. */
  labels: MentionLabels;
  formatDate: (iso: string) => string;
}

/** Above this many words and spaces (both sides together) a changed block is not word-diffed. */
export const WORD_DIFF_MAX_TOKENS = 12_000;
/** The word diff's work budget: tokens × edit length. */
const WORD_DIFF_BUDGET = 3_000_000;

function tokenCount(text: string): number {
  return text.match(/\S+|\s+/g)?.length ?? 0;
}

/** A text split into blocks (lines), each keeping its line break. */
function blocks(text: string): string[] {
  return text ? text.split(/(?<=\n)/) : [];
}

/** The old block shown removed and the new one added, whole. */
function replaced(before: string, after: string): DiffSegment[] {
  const out: DiffSegment[] = [];
  if (before) out.push({ text: before, removed: true });
  if (after) out.push({ text: after, added: true });
  return out;
}

/** Word segments for one changed run of blocks, or the run replaced whole when that would take too long. */
function blockSegments(before: string, after: string): DiffSegment[] {
  if (!before || !after) return replaced(before, after);
  const tokens = tokenCount(before) + tokenCount(after);
  if (tokens > WORD_DIFF_MAX_TOKENS) return replaced(before, after);
  const changes = diffWordsWithSpace(before, after, {
    maxEditLength: Math.max(64, Math.floor(WORD_DIFF_BUDGET / tokens)),
  });
  if (!changes) return replaced(before, after);
  return changes.map((change) => {
    const segment: DiffSegment = { text: change.value };
    if (change.added) segment.added = true;
    if (change.removed) segment.removed = true;
    return segment;
  });
}

/** Neighbouring segments of the same kind joined into one. */
function merged(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && Boolean(last.added) === Boolean(s.added) && Boolean(last.removed) === Boolean(s.removed)) {
      out[out.length - 1] = { ...last, text: last.text + s.text };
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Segments turning `before` into `after`: blocks (lines) first, then words
 * inside each run of changed blocks, within a bounded amount of work.
 */
export function wordSegments(before: string, after: string): DiffSegment[] {
  const out: DiffSegment[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed || added) out.push(...blockSegments(removed, added));
    removed = "";
    added = "";
  };
  const a = blocks(before);
  const b = blocks(after);
  const lines = a.length + b.length;
  const changes = diffArrays(a, b, { maxEditLength: Math.max(64, Math.floor(WORD_DIFF_BUDGET / Math.max(lines, 1))) });
  // Too many blocks moved to line up in time: the whole text, replaced.
  if (!changes) return replaced(before, after);
  for (const change of changes) {
    const text = change.value.join("");
    if (change.removed) removed += text;
    else if (change.added) added += text;
    else {
      flush();
      out.push({ text });
    }
  }
  flush();
  return merged(out);
}

/** A rich-text field's row, or null when it did not change. */
export function textRow(
  key: string,
  label: string,
  before: string | null | undefined,
  after: string | null | undefined,
  labels: MentionLabels,
): DiffRow | null {
  const a = before ?? "";
  const b = after ?? "";
  if (canonicalMentionHtml(a) === canonicalMentionHtml(b)) return null;
  const plainA = htmlToPlainText(a, labels);
  const plainB = htmlToPlainText(b, labels);
  if (plainA === plainB) {
    return { key, label, kind: "text", segments: [{ text: plainB }], formattingOnly: true };
  }
  return { key, label, kind: "text", segments: wordSegments(plainA, plainB), formattingOnly: false };
}

/** A plain value's row (old, then new), or null when it did not change. */
export function valueRow(key: string, label: string, before: string, after: string): DiffRow | null {
  if (before === after) return null;
  const segments: DiffSegment[] = [];
  if (before) segments.push({ text: before, removed: true });
  if (after) segments.push({ text: after, added: true });
  return { key, label, kind: "value", segments, formattingOnly: false };
}

const DECISION_TEXT: readonly [keyof DecisionVersionContent, string][] = [
  ["context", "adr.context"],
  ["decision", "adr.decision"],
  ["alternatives_considered", "adr.alternativesConsidered"],
  ["consequences", "adr.consequences"],
];

const DECISION_DATES: readonly [keyof DecisionVersionContent, string][] = [
  ["decided_on", "adr.dates.decidedOn"],
  ["effective_from", "adr.dates.effectiveFrom"],
  ["valid_until", "adr.dates.validUntil"],
];

function keep(rows: (DiffRow | null)[]): DiffRow[] {
  return rows.filter((r): r is DiffRow => r !== null);
}

/** Every changed field of a decision, in the order the decision shows them. */
export function decisionDiff(
  before: DecisionVersionContent,
  after: DecisionVersionContent,
  { t, labels, formatDate }: DiffOptions,
): DiffRow[] {
  const date = (v: unknown) => (typeof v === "string" && v ? formatDate(v) : "");
  return keep([
    valueRow("title", t("adr.title"), before.title ?? "", after.title ?? ""),
    ...DECISION_TEXT.map(([key, label]) =>
      textRow(key, t(label), before[key] as string | null, after[key] as string | null, labels),
    ),
    ...DECISION_DATES.map(([key, label]) => valueRow(key, t(label), date(before[key]), date(after[key]))),
    valueRow("decision_makers", t("adr.people.decisionMakers"), peopleLine(before.decision_makers), peopleLine(after.decision_makers)),
    valueRow("participants", t("adr.people.participants"), peopleLine(before.participants), peopleLine(after.participants)),
    valueRow("change_summary", t("adr.revise.changeSummary"), before.change_summary ?? "", after.change_summary ?? ""),
  ]);
}

const DOC_INFO: readonly ["prepared_by" | "reviewed_by" | "review_date", string][] = [
  ["prepared_by", "editor.preparedBy"],
  ["reviewed_by", "editor.reviewedBy"],
  ["review_date", "editor.reviewDate"],
];

/** The hand-kept "Document Version History" table as lines of text. */
function versionTableText(rows: SoawVersionContent["version_history"]): string {
  return (rows ?? [])
    .map((r) => [r.version, r.date, r.revised_by, r.description].filter(Boolean).join(" · "))
    .filter(Boolean)
    .join("\n");
}

/** A SoAW section as plain text: its text, table rows and phase notes, and whether it is hidden. */
export function sectionText(section: SoawVersionSection | undefined, labels: MentionLabels, hiddenLabel: string): string {
  if (!section) return "";
  const lines: string[] = [];
  if (section.hidden) lines.push(hiddenLabel);
  const text = htmlToPlainText(section.content ?? "", labels);
  if (text) lines.push(text);
  for (const row of section.table_data?.rows ?? []) lines.push(row.join(" | "));
  for (const [phase, note] of Object.entries(section.togaf_data ?? {})) {
    if (note) lines.push(`${phase}: ${note}`);
  }
  return lines.join("\n");
}

/** A SoAW section in its stored form, to tell "unchanged" apart from "formatting only". */
function sectionStored(section: SoawVersionSection | undefined): string {
  if (!section) return "";
  return JSON.stringify([
    canonicalMentionHtml(section.content ?? ""),
    section.hidden ?? false,
    section.table_data ?? null,
    section.togaf_data ?? null,
    section.title ?? null,
  ]);
}

/** The keys of two section maps: template order first (as given), then the rest as they appear. */
function sectionKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  order: readonly string[],
): string[] {
  const present = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out = order.filter((k) => present.has(k));
  for (const k of present) if (!out.includes(k)) out.push(k);
  return out;
}

/**
 * Every changed part of a SoAW: name, document info, the version table, then
 * one row per section present on either side. `sectionTitles` maps template
 * section keys to their titles (in template order); a custom section uses
 * its own title.
 */
export function soawDiff(
  before: SoawVersionContent,
  after: SoawVersionContent,
  opts: DiffOptions & { sectionTitles: Record<string, string> },
): DiffRow[] {
  const { t, labels, formatDate, sectionTitles } = opts;
  const infoA = before.document_info ?? { prepared_by: "", reviewed_by: "", review_date: "" };
  const infoB = after.document_info ?? { prepared_by: "", reviewed_by: "", review_date: "" };
  const shown = (key: string, v: string) => (key === "review_date" && v ? formatDate(v) : v ?? "");
  const rows: (DiffRow | null)[] = [
    valueRow("name", t("editor.documentName"), before.name ?? "", after.name ?? ""),
    ...DOC_INFO.map(([key, label]) => valueRow(key, t(label), shown(key, infoA[key]), shown(key, infoB[key]))),
  ];
  const tableA = versionTableText(before.version_history);
  const tableB = versionTableText(after.version_history);
  if (tableA !== tableB) {
    rows.push({
      key: "version_history",
      label: t("editor.versionHistory"),
      kind: "text",
      segments: wordSegments(tableA, tableB),
      formattingOnly: false,
    });
  }
  const secA = before.sections ?? {};
  const secB = after.sections ?? {};
  const hidden = t("collab.compare.hiddenSection");
  for (const key of sectionKeys(secA, secB, Object.keys(sectionTitles))) {
    const a = secA[key];
    const b = secB[key];
    if (sectionStored(a) === sectionStored(b)) continue;
    const label = sectionTitles[key] ?? b?.title ?? a?.title ?? key;
    const textA = sectionText(a, labels, hidden);
    const textB = sectionText(b, labels, hidden);
    rows.push(
      textA === textB
        ? { key, label, kind: "text", segments: [{ text: textB }], formattingOnly: true }
        : { key, label, kind: "text", segments: wordSegments(textA, textB), formattingOnly: false },
    );
  }
  return keep(rows);
}
