/**
 * The decision editor's pure parts: what Save sends, which controls a status
 * allows, and which revision of a chain is the current one. Kept out of
 * `ADREditor.tsx` so each rule is a small tested function rather than a
 * condition buried in JSX.
 */
import { hasPermission } from "@/components/RequirePermission";
import type {
  ArchitectureDecision,
  DecisionLinkInput,
  DecisionLinks,
  DecisionPerson,
  DecisionPersonInput,
} from "@/types";
import { peoplePayload } from "./DecisionPeopleField";
import { isLocked } from "./decisionStanding";

/** What the editor holds for the decision's content. */
export interface EditorContent {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  decidedOn: string;
  effectiveFrom: string;
  validUntil: string;
  decisionMakers: DecisionPerson[];
  participants: DecisionPerson[];
  links: DecisionLinkInput[];
  changeSummary: string;
}

export interface SavePayload {
  title: string;
  context: string | null;
  decision: string | null;
  consequences: string | null;
  alternatives_considered: string | null;
  decided_on: string | null;
  effective_from: string | null;
  valid_until: string | null;
  decision_makers: DecisionPersonInput[];
  participants: DecisionPersonInput[];
  links: DecisionLinkInput[];
  change_summary?: string | null;
}

/** The outgoing links a decision holds, in the write shape. */
export function linksFromDetail(links: DecisionLinks | undefined): DecisionLinkInput[] {
  return (links?.outgoing ?? []).map((entry) => ({
    decision_id: entry.decision.id,
    kind: entry.kind,
    note: entry.note,
  }));
}

/** The links Save sends: rows without a picked decision are dropped, notes trimmed. */
export function linksPayload(links: DecisionLinkInput[]): DecisionLinkInput[] {
  return links
    .filter((l) => l.decision_id !== "")
    .map((l) => ({ decision_id: l.decision_id, kind: l.kind, note: l.note?.trim() || null }));
}

/**
 * The body of `POST /adr` / `PATCH /adr/{id}`. Empty text is sent as null so a
 * cleared field is cleared; `change_summary` belongs to a revision and is only
 * sent on one. `related_decisions` is never sent: links carry it.
 */
export function buildSavePayload(content: EditorContent, isRevision: boolean): SavePayload {
  const payload: SavePayload = {
    title: content.title,
    context: content.context || null,
    decision: content.decision || null,
    consequences: content.consequences || null,
    alternatives_considered: content.alternatives || null,
    decided_on: content.decidedOn || null,
    effective_from: content.effectiveFrom || null,
    valid_until: content.validUntil || null,
    decision_makers: peoplePayload(content.decisionMakers),
    participants: peoplePayload(content.participants),
    links: linksPayload(content.links),
  };
  if (isRevision) payload.change_summary = content.changeSummary.trim() || null;
  return payload;
}

/** The editor's content as a decision detail fills it (load, and every action reply). */
export function contentFromDetail(adr: ArchitectureDecision): EditorContent {
  return {
    title: adr.title,
    context: adr.context || "",
    decision: adr.decision || "",
    consequences: adr.consequences || "",
    alternatives: adr.alternatives_considered || "",
    decidedOn: adr.decided_on || "",
    effectiveFrom: adr.effective_from || "",
    validUntil: adr.valid_until || "",
    decisionMakers: adr.decision_makers || [],
    participants: adr.participants || [],
    links: linksFromDetail(adr.links),
    changeSummary: adr.change_summary || "",
  };
}

/**
 * What the server holds, as the payload Save would send for it: the baseline
 * the editor compares its live payload with to know whether it has edits to
 * save before a workflow step (request signatures, record as decided).
 */
export function storedPayload(adr: ArchitectureDecision): SavePayload {
  return buildSavePayload(contentFromDetail(adr), Boolean(adr.parent_id));
}

/** What a status allows on the editor page. */
export interface EditorAccess {
  /** Content (text, dates, people, links, change summary, files, Save) is read-only. */
  locked: boolean;
  /** Linked cards are filing, not content: editable until signed. */
  cardsEditable: boolean;
  /** Files can be uploaded and deleted: a saved draft only. */
  filesEditable: boolean;
  /** Extension panels must not offer edits (the SDK `readOnly` contract). */
  panelReadOnly: boolean;
}

export function editorAccess(status: string, isNew: boolean): EditorAccess {
  return {
    locked: isLocked(status),
    cardsEditable: status !== "signed",
    filesEditable: !isNew && status === "draft",
    panelReadOnly: status !== "draft",
  };
}

/** "Record as decided" is offered on a saved draft to holders of `adr.record`. */
export function canRecord(
  permissions: Record<string, boolean> | undefined,
  status: string,
  isNew: boolean,
): boolean {
  return !isNew && status === "draft" && hasPermission(permissions, "adr.record");
}

/** The ids of the decision's own chain (itself included): never a link target. */
export function chainIds(adr: Pick<ArchitectureDecision, "id" | "revisions">): string[] {
  const ids = (adr.revisions ?? []).map((r) => r.id);
  return ids.includes(adr.id) ? ids : [adr.id, ...ids];
}

/**
 * The chain's current revision, for the revision strip: the decision itself
 * when it is current, the one it points to when it is an earlier revision,
 * else the first signed revision that is neither superseded nor scheduled.
 */
export function currentRevisionId(
  adr: Pick<
    ArchitectureDecision,
    "id" | "is_current" | "is_earlier_revision" | "superseded_by" | "revisions"
  >,
): string | null {
  if (adr.is_current) return adr.id;
  if (adr.is_earlier_revision && adr.superseded_by) return adr.superseded_by.id;
  const live = (adr.revisions ?? []).find(
    (r) => r.status === "signed" && r.standing !== "superseded" && r.standing !== "scheduled",
  );
  return live?.id ?? null;
}
