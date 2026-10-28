import { CATEGORICAL_COLORS, STATUS_COLORS } from "@/theme/tokens";

/**
 * The channel a record came through (`created_via` / `updated_via` on cards,
 * diagrams, risks, ADRs, SoAWs, comments and BPM flow versions, and `origin`
 * on a History event): `web`, `mcp`, `api`, `ext` or `system`. Only the
 * non-web channels are marked — a record made in the web UI, or before the
 * channel was tracked (null), shows nothing.
 *
 * Shape mirrors `features/todos/originMeta.ts`; the enumeration differs.
 */
export type RecordOrigin = "mcp" | "api" | "ext" | "system";

export interface RecordOriginMeta {
  icon: string;
  color: string;
}

export const ORIGIN_META: Record<RecordOrigin, RecordOriginMeta> = {
  mcp: { icon: "smart_toy", color: CATEGORICAL_COLORS[1] },
  api: { icon: "api", color: STATUS_COLORS.info },
  ext: { icon: "extension", color: CATEGORICAL_COLORS[3] },
  system: { icon: "settings", color: STATUS_COLORS.neutral },
};

/** True for the origins `OriginChip` renders — every other value (web, null,
 *  an unknown string) is silent. */
export function isMarkedOrigin(origin: string | null | undefined): origin is RecordOrigin {
  return origin != null && Object.prototype.hasOwnProperty.call(ORIGIN_META, origin);
}
