/**
 * Readable messages for the structured refusals the decision API returns:
 * `{error, problems?, ...}` on a 400 / 409 (`adr_service` / `decision_standing`
 * problem codes). One map so the editor's Save, the record dialog and the
 * revise menu say the same thing for the same code.
 */
import type { Translate } from "./decisionStanding";

/** Problem code → `delivery` key. Codes not listed fall back to the caller's message. */
export const PROBLEM_LABEL_KEYS: Record<string, string> = {
  unknown_kind: "adr.editor.problem.unknownKind",
  target_missing: "adr.editor.problem.targetMissing",
  decision_not_found: "adr.editor.problem.targetMissing",
  same_chain: "adr.editor.problem.sameChain",
  consolidates_needs_revision: "adr.editor.problem.consolidatesNeedsRevision",
  consolidates_not_amender: "adr.editor.problem.consolidatesNotAmender",
  valid_until_before_effective: "adr.editor.problem.validUntilBeforeEffective",
  valid_until_past: "adr.editor.problem.validUntilPast",
  decided_on_future: "adr.editor.problem.decidedOnFuture",
  link_target_not_locked: "adr.editor.problem.linkTargetNotLocked",
  chain_closed: "adr.editor.problem.chainClosed",
  no_decision_maker: "adr.editor.problem.noDecisionMaker",
  not_draft: "adr.editor.problem.notDraft",
};

/** The problem codes a refusal detail carries, `problems` first, else `error`. */
export function problemCodes(detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const d = detail as { error?: unknown; problems?: unknown };
  if (Array.isArray(d.problems)) {
    return d.problems.filter((p): p is string => typeof p === "string");
  }
  return typeof d.error === "string" ? [d.error] : [];
}

/**
 * The readable message for an API error's structured detail, or null when it
 * carries no code this map knows (the caller then shows its own fallback).
 * Several problems are joined with a space, each once.
 */
export function problemMessage(err: unknown, t: Translate): string | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  const keys = problemCodes(detail)
    .map((code) => PROBLEM_LABEL_KEYS[code])
    .filter((key): key is string => Boolean(key));
  if (keys.length === 0) return null;
  return Array.from(new Set(keys), (key) => t(key)).join(" ");
}
