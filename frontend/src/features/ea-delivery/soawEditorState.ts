/**
 * Pure rules behind the SoAW editor (`SoAWEditor.tsx`): what a save sends in
 * each status, which workflow actions a status offers, and how a refused
 * revise reads. Kept out of the component so each rule has a direct test.
 */
import type { SoAW, SoAWSectionData } from "@/types";
import { buildDefaultSections } from "./soawTemplate";

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

/** A section the author added, kept beside the template sections. */
export interface SoawCustomSection {
  id: string;
  title: string;
  content: string;
  insertAfter: string;
}

/** What the editor holds for a document. */
export interface SoawEditorState {
  name: string;
  /** "" for no initiative (the select's empty value). */
  initiativeId: string;
  docInfo: SoAW["document_info"];
  versionHistory: SoAW["version_history"];
  /** Template sections only, merged over the template's defaults. */
  sections: Record<string, SoAWSectionData>;
  customSections: SoawCustomSection[];
}

export const EMPTY_DOC_INFO: SoAW["document_info"] = {
  prepared_by: "",
  reviewed_by: "",
  review_date: "",
};

export const EMPTY_VERSION_ROW: SoAW["version_history"][number] = {
  version: "",
  date: "",
  revised_by: "",
  description: "",
};

/**
 * The editor state for a document as the server returned it (load, and every
 * action reply). Stored sections are merged over the template defaults, so a
 * template section added later still appears; `custom_*` keys become custom
 * sections. A document without document info or version history gets the
 * empty defaults, so nothing from a previously shown document lingers.
 */
export function soawStateFromLoaded(data: SoAW): SoawEditorState {
  const sections: Record<string, SoAWSectionData> = { ...buildDefaultSections() };
  const customSections: SoawCustomSection[] = [];
  for (const [key, val] of Object.entries(data.sections ?? {})) {
    if (key.startsWith("custom_")) {
      const extra = val as SoAWSectionData & { title?: string; insertAfter?: string };
      customSections.push({
        id: key,
        title: extra.title ?? key,
        content: val.content,
        insertAfter: extra.insertAfter ?? "",
      });
    } else {
      sections[key] = { ...sections[key], ...val };
    }
  }
  return {
    name: data.name,
    initiativeId: data.initiative_id ?? "",
    docInfo: data.document_info ?? { ...EMPTY_DOC_INFO },
    versionHistory: data.version_history?.length
      ? data.version_history
      : [{ ...EMPTY_VERSION_ROW }],
    sections,
    customSections,
  };
}

/** The fields a save sends for an editor state: custom sections fold back into `sections`. */
export function soawEditorFields(state: SoawEditorState): SoawEditorFields {
  const sections: Record<string, unknown> = { ...state.sections };
  for (const cs of state.customSections) {
    sections[cs.id] = {
      content: cs.content,
      hidden: false,
      title: cs.title,
      insertAfter: cs.insertAfter,
    };
  }
  return {
    name: state.name.trim(),
    initiative_id: state.initiativeId || null,
    document_info: state.docInfo,
    version_history: state.versionHistory,
    sections,
  };
}

/**
 * Whether Save is offered: never on a signed document; in review only when
 * the initiative link (the one thing review leaves editable) was changed.
 */
export function canSaveSoaw(status: string, initiativeChanged: boolean): boolean {
  if (status === "signed") return false;
  return status !== "in_review" || initiativeChanged;
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
