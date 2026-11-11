/**
 * What a decision's Word export (`adrExport.ts`) and print view (`adrPrint.ts`)
 * say about it, as plain strings: the heading ("ADR-012 · Rev 2 — title"),
 * the facts table, the typed links in both directions, the file names and the
 * "recorded" line. One builder, two renderers, so the two documents cannot
 * drift apart. Pure; `t` is the `delivery` namespace's.
 */
import type { ArchitectureDecision, DecisionLinkEntry, DecisionPerson } from "@/types";
import {
  LINK_KIND_LABEL_KEYS,
  DATE_LABEL_KEYS,
  decisionRefLabel,
  isRecorded,
  standingLabelKey,
  statusLabelKey,
  type Translate,
} from "./decisionStanding";

/** A decision as the exports read it (`files`, `links`, `participants`
 *  arrive on the detail only). */
export type ExportableDecision = ArchitectureDecision;

/** "ADR-012 · Rev 2 — Adopt event streaming". */
export function adrHeading(adr: ArchitectureDecision, t: Translate): string {
  return `${decisionRefLabel(adr, t)} — ${adr.title}`;
}

/** People's names joined for one table cell. */
export function peopleNames(people: DecisionPerson[] | undefined): string {
  return (people ?? [])
    .map((p) => p.display_name)
    .filter(Boolean)
    .join(", ");
}

/** The signatories who signed, joined. */
function signedNames(adr: ArchitectureDecision): string {
  return (adr.signatories ?? [])
    .filter((s) => s.status === "signed")
    .map((s) => s.display_name)
    .filter(Boolean)
    .join(", ");
}

/**
 * The facts table, label → value, in reading order. A value may be empty;
 * each renderer leaves empty rows out.
 */
export function adrFactRows(
  adr: ArchitectureDecision,
  t: Translate,
  date: (iso: string | null | undefined) => string,
): [string, string][] {
  return [
    [t("adr.grid.status"), t(statusLabelKey(adr))],
    [t("adr.grid.standing"), adr.standing ? t(standingLabelKey(adr.standing)) : ""],
    [t(DATE_LABEL_KEYS.decided_on), date(adr.decided_on)],
    [t(DATE_LABEL_KEYS.effective_from), date(adr.effective_from)],
    [t(DATE_LABEL_KEYS.valid_until), date(adr.valid_until)],
    [t("adr.people.decisionMakers"), peopleNames(adr.decision_makers)],
    [t("adr.people.participants"), peopleNames(adr.participants)],
    [t("adr.grid.createdBy"), adr.creator_name ?? ""],
    [t("adr.grid.created"), date(adr.created_at)],
    [t("adr.grid.lastModified"), date(adr.updated_at)],
    [t("adr.grid.signed"), date(adr.signed_at)],
    [t("adr.grid.signedBy"), signedNames(adr)],
  ];
}

function linkRow(entry: DecisionLinkEntry, direction: "outgoing" | "incoming", t: Translate) {
  return [
    t(LINK_KIND_LABEL_KEYS[direction][entry.kind]),
    `${decisionRefLabel(entry.decision, t)} — ${entry.decision.title}`,
    entry.note ?? "",
  ];
}

/**
 * The typed links, outgoing ("Replaces ADR-003") then incoming ("Replaced by
 * ADR-012"), each `[relation, decision, note]`. Empty when the decision
 * carries no `links` (a list row).
 */
export function adrLinkRows(adr: ArchitectureDecision, t: Translate): string[][] {
  const links = adr.links;
  if (!links) return [];
  return [
    ...links.outgoing.map((e) => linkRow(e, "outgoing", t)),
    ...links.incoming.map((e) => linkRow(e, "incoming", t)),
  ];
}

/** The headers of the links table. */
export function adrLinkHeaders(t: Translate): string[] {
  return [t("adr.export.linkRelation"), t("adr.export.linkDecision"), t("adr.export.linkNote")];
}

/** The names of the files on the decision (detail only). */
export function adrFileNames(adr: ExportableDecision): string[] {
  return (adr.files ?? []).map((f) => f.name).filter(Boolean);
}

/**
 * "Recorded by X on date, not signed in Turbo EA" for a decision recorded as
 * decided outside Turbo EA; null for any other decision. It replaces the
 * signatures block, which a recorded decision does not have.
 */
export function adrRecordedLine(
  adr: ArchitectureDecision,
  t: Translate,
  date: (iso: string | null | undefined) => string,
): string | null {
  if (!isRecorded(adr)) return null;
  const when = date(adr.recorded_at);
  const name = adr.recorded_by?.display_name;
  return name
    ? t("adr.banner.recorded", { name, date: when })
    : t("adr.banner.recordedNoName", { date: when });
}
