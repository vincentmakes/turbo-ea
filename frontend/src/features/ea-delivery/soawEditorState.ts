/**
 * Pure rules behind the SoAW editor (`SoAWEditor.tsx`): what a save sends in
 * each status, which workflow actions a status offers, and how a refused
 * revise reads. Kept out of the component so each rule has a direct test.
 */
import type { SoAW } from "@/types";

/** What the editor holds for a save. */
export interface SoawEditorFields {
  name: string;
  initiative_id: string | null;
  document_info: SoAW["document_info"];
  version_history: SoAW["version_history"];
  sections: Record<string, unknown>;
}

/**
 * The PATCH / POST body for a save. In review the content is locked and the
 * API accepts the initiative link alone (it is filing, not content), so only
 * that field is sent; any other field would be refused with a 403.
 */
export function soawSavePayload(
  status: string,
  fields: SoawEditorFields,
): SoawEditorFields | Pick<SoawEditorFields, "initiative_id"> {
  if (status === "in_review") return { initiative_id: fields.initiative_id };
  return fields;
}

/** Signatures can be requested on a draft or an approved document only. */
export function canRequestSoawSignatures(status: string): boolean {
  return status === "draft" || status === "approved";
}

/** "New revision" is offered on a signed document that is not itself an
 *  earlier revision (the API would refuse it as `not_latest`). */
export function canReviseSoaw(
  status: string,
  soaw: Pick<SoAW, "is_earlier_revision"> | null | undefined,
): boolean {
  return status === "signed" && soaw?.is_earlier_revision !== true;
}

/** A revise the API refused with a structured 409. */
export type ReviseRefusal =
  | { kind: "open_revision_exists"; revisionId: string }
  | { kind: "not_revisable" };

/**
 * The refusal behind a failed revise, or null for any other error. Read off
 * the `ApiError` shape (`status`, structured `detail`).
 */
export function reviseRefusal(err: unknown): ReviseRefusal | null {
  const e = err as { status?: unknown; detail?: unknown } | null;
  if (!e || typeof e !== "object" || e.status !== 409) return null;
  const detail = e.detail as { error?: unknown; revision_id?: unknown } | null;
  if (!detail || typeof detail !== "object") return null;
  if (detail.error === "open_revision_exists" && typeof detail.revision_id === "string") {
    return { kind: "open_revision_exists", revisionId: detail.revision_id };
  }
  if (detail.error === "not_revisable") return { kind: "not_revisable" };
  return null;
}

/**
 * The chain's current revision for the revision strip: the document itself
 * when it is current, its successor when it is an earlier revision, else (an
 * open revision) the last signed revision of the chain.
 */
export function soawCurrentRevisionId(
  soaw: Pick<SoAW, "id" | "is_current" | "is_earlier_revision" | "superseded_by" | "revisions">,
): string | null {
  if (soaw.is_current) return soaw.id;
  if (soaw.is_earlier_revision && soaw.superseded_by) return soaw.superseded_by.id;
  const signed = (soaw.revisions ?? []).filter((r) => r.status === "signed");
  return signed.length > 0 ? signed[signed.length - 1].id : null;
}
