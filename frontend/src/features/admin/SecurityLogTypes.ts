/**
 * Shared types for the **Security & admin** sub-tab of the Audit log. Matches
 * the response shape of `GET /api/v1/admin/audit-log`.
 */
import { STATUS_COLORS, brand } from "@/theme/tokens";

export const SECURITY_CATEGORIES = ["auth", "admin", "access"] as const;
export type SecurityCategory = (typeof SECURITY_CATEGORIES)[number];

export const SECURITY_OUTCOMES = ["success", "failure"] as const;
export type SecurityOutcome = (typeof SECURITY_OUTCOMES)[number];

export interface SecurityLogEntry {
  id: string;
  created_at: string;
  category: SecurityCategory | string;
  /** Dotted action key, e.g. `auth.login.failed`. */
  action: string;
  outcome: SecurityOutcome | string;
  actor_user_id: string | null;
  actor_email: string | null;
  subject_email: string | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  ip: string | null;
  user_agent: string | null;
  origin: string | null;
  impersonator_user_id: string | null;
  impersonated_role: string | null;
  /** Reason codes, `{field: {old, new}}` diffs — secrets masked at write time. */
  details: Record<string, unknown> | null;
}

export interface SecurityLogPage {
  items: SecurityLogEntry[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * The i18n key holding an action's label. Locale files use flat dotted keys,
 * so the action's own dots would nest ambiguously (`auth.login` would be both a
 * label and a prefix); they are replaced by underscores instead:
 * `auth.login.failed` → `securityLog.actionLabels.auth_login_failed`.
 * Callers pass `{ defaultValue: action }` so an action this build has no label
 * for still renders as its raw key.
 */
export function actionLabelKey(action: string): string {
  return `securityLog.actionLabels.${action.replace(/\./g, "_")}`;
}

/** The i18n key for a failure reason code (`details.reason`). */
export function reasonLabelKey(reason: string): string {
  return `securityLog.reasons.${reason}`;
}

/** Category colours — design tokens, shared by the grid chip and the sidebar. */
export const CATEGORY_COLORS: Record<SecurityCategory, string> = {
  auth: STATUS_COLORS.info,
  admin: STATUS_COLORS.warning,
  access: brand.primary,
};

export const OUTCOME_COLORS: Record<SecurityOutcome, string> = {
  success: STATUS_COLORS.success,
  failure: STATUS_COLORS.error,
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category as SecurityCategory] ?? STATUS_COLORS.neutral;
}

export function outcomeColor(outcome: string): string {
  return OUTCOME_COLORS[outcome as SecurityOutcome] ?? STATUS_COLORS.neutral;
}

/** True when every value of `details` is an `{old, new}` pair. */
export function isFieldDiff(
  details: Record<string, unknown> | null | undefined,
): details is Record<string, { old: unknown; new: unknown }> {
  if (!details) return false;
  const values = Object.values(details);
  if (values.length === 0) return false;
  return values.every(
    (v) =>
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      "old" in (v as object) &&
      "new" in (v as object),
  );
}
