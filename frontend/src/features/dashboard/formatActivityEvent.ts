import type { TFunction } from "i18next";
import type { EventEntry } from "@/types";
import { STATUS_COLORS, SEVERITY_COLORS } from "@/theme/tokens";
import { formatDateWith, getCachedDateFormat } from "@/hooks/useDateFormat";
import { toIsoDate } from "@/lib/dates";

export type ActivityCategory =
  | "create"
  | "update"
  | "approve"
  | "reject"
  | "reset"
  | "archive"
  | "restore"
  | "delete"
  | "relation"
  | "stakeholder"
  | "risk"
  | "document"
  | "comment"
  | "tag"
  | "diagram"
  | "process"
  | "adr"
  | "soaw"
  | "notification"
  | "other";

export interface FormattedActivity {
  category: ActivityCategory;
  icon: string;
  color: string;
  /** Pre-translated, tokenized parts so the UI can render a clickable card link. */
  actionText: string;
  cardName: string | null;
  cardLink: string | null;
}

/* ------------------------------------------------------------------ */
/*  Lookup tables                                                      */
/* ------------------------------------------------------------------ */

const CATEGORY_ICONS: Record<ActivityCategory, string> = {
  create: "add_circle",
  update: "edit",
  approve: "check_circle",
  reject: "cancel",
  reset: "restart_alt",
  archive: "inventory_2",
  restore: "history",
  delete: "delete",
  relation: "link",
  stakeholder: "group",
  risk: "report",
  document: "attach_file",
  comment: "chat_bubble",
  tag: "label",
  diagram: "schema",
  process: "account_tree",
  adr: "gavel",
  soaw: "description",
  notification: "notifications",
  other: "bolt",
};

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  create: STATUS_COLORS.success,
  update: STATUS_COLORS.info,
  approve: STATUS_COLORS.success,
  reject: STATUS_COLORS.error,
  reset: STATUS_COLORS.warning,
  archive: STATUS_COLORS.neutral,
  restore: STATUS_COLORS.success,
  delete: SEVERITY_COLORS.critical,
  relation: "#774fcc",
  stakeholder: "#2889ff",
  risk: STATUS_COLORS.warning,
  document: "#0f7eb5",
  comment: "#0f7eb5",
  tag: "#a6566d",
  diagram: "#02afa4",
  process: "#028f00",
  adr: "#c7527d",
  soaw: "#2889ff",
  notification: STATUS_COLORS.info,
  other: STATUS_COLORS.neutral,
};

/* ------------------------------------------------------------------ */
/*  Categorization                                                     */
/* ------------------------------------------------------------------ */

function categorize(eventType: string): ActivityCategory {
  if (eventType === "card.created") return "create";
  if (eventType === "card.updated") return "update";
  if (eventType === "card.archived") return "archive";
  if (eventType === "card.restored") return "restore";
  if (eventType === "card.deleted") return "delete";
  if (eventType.startsWith("card.approval_status.")) {
    const action = eventType.split(".").pop();
    if (action === "approve") return "approve";
    if (action === "reject") return "reject";
    if (action === "reset") return "reset";
  }
  if (eventType.startsWith("relation.")) return "relation";
  if (eventType.startsWith("stakeholder.")) return "stakeholder";
  if (eventType.startsWith("risk.")) return "risk";
  if (eventType.startsWith("document.") || eventType.startsWith("file.")) return "document";
  if (eventType.startsWith("comment.")) return "comment";
  if (eventType.startsWith("tag.")) return "tag";
  if (eventType.startsWith("process_diagram.")) return "diagram";
  if (eventType.startsWith("process_flow.")) return "process";
  if (eventType.startsWith("adr.")) return "adr";
  if (eventType.startsWith("soaw.")) return "soaw";
  if (eventType.startsWith("notification.")) return "notification";
  return "other";
}

/* ------------------------------------------------------------------ */
/*  High-level filter buckets used by the UI tabs                      */
/* ------------------------------------------------------------------ */

export type ActivityFilter = "all" | "cards" | "approvals" | "relations" | "comments";

export function matchesFilter(category: ActivityCategory, filter: ActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "cards") {
    return ["create", "update", "archive", "restore", "delete", "tag"].includes(category);
  }
  if (filter === "approvals") {
    return ["approve", "reject", "reset"].includes(category);
  }
  if (filter === "relations") return category === "relation";
  if (filter === "comments") return category === "comment";
  return false;
}

/* ------------------------------------------------------------------ */
/*  Format                                                             */
/* ------------------------------------------------------------------ */

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function formatActivityEvent(
  e: EventEntry,
  t: TFunction<"common">,
): FormattedActivity {
  const category = categorize(e.event_type);
  const data = (e.data ?? {}) as Record<string, unknown>;
  const cardId = e.card_id ?? asString(data.id);
  const cardLink = cardId ? `/cards/${cardId}` : null;
  // Prefer the server-resolved name (set on every event with a card_id),
  // then the legacy in-payload name, then null.
  const cardName = asString(e.card_name) ?? asString(data.name);

  // The i18n config has `returnEmptyString: false`, which causes a missing
  // key to be returned verbatim instead of honouring `defaultValue`. We
  // therefore detect "missing" by comparing the result to a sentinel AND to
  // the key itself, so a brand-new backend event type doesn't leak its raw
  // translation key into the UI.
  const actionKey = `dashboard.activity.action.${e.event_type}`;
  const MISSING = "__missing_action_label__";
  let actionText = t(actionKey, { defaultValue: MISSING }) as string;
  if (actionText === MISSING || actionText === actionKey || !actionText) {
    actionText = t("dashboard.activity.action.fallback", {
      type: e.event_type.replace(/[._]/g, " "),
    }) as string;
  }

  return {
    category,
    icon: CATEGORY_ICONS[category],
    color: CATEGORY_COLORS[category],
    actionText,
    cardName,
    cardLink,
  };
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                       */
/* ------------------------------------------------------------------ */

export function relativeTime(iso: string | undefined, t: TFunction<"common">): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("dashboard.activity.time.justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("dashboard.activity.time.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("dashboard.activity.time.hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("dashboard.activity.time.daysAgo", { count: day });
  return formatDateWith(getCachedDateFormat(), iso);
}

/** Returns a stable bucket key per day, plus a localized label for the heading. */
export function dayBucket(
  iso: string | undefined,
  t: TFunction<"common">,
): { key: string; label: string } {
  if (!iso) return { key: "unknown", label: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: "unknown", label: "" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
  const key = toIsoDate(target);
  let label: string;
  if (dayDiff === 0) label = t("dashboard.activity.day.today");
  else if (dayDiff === 1) label = t("dashboard.activity.day.yesterday");
  else label = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return { key, label };
}

/* ------------------------------------------------------------------ */
/*  Grouping consecutive same-user same-card edits                     */
/* ------------------------------------------------------------------ */

export interface ActivityGroup {
  /** First event of the group is the "primary" (most recent in desc order). */
  events: EventEntry[];
  /** When > 1 we render as a collapsed cluster. */
  count: number;
}

/**
 * Collapse runs of consecutive events that share user + card + category
 * into a single group, so a burst of 5 sequential edits to one card by one
 * person renders as one row "Vincent made 5 edits to NexaCore ERP".
 *
 * Only `update` events collapse; everything else passes through as a
 * single-event group so distinct actions stay individually visible.
 */
export function groupConsecutive(events: EventEntry[]): ActivityGroup[] {
  const out: ActivityGroup[] = [];
  for (const e of events) {
    const cat = categorize(e.event_type);
    const prev = out[out.length - 1];
    if (
      prev &&
      cat === "update" &&
      categorize(prev.events[0].event_type) === "update" &&
      prev.events[0].user_id === e.user_id &&
      prev.events[0].card_id === e.card_id &&
      prev.events[0].card_id != null
    ) {
      prev.events.push(e);
      prev.count += 1;
    } else {
      out.push({ events: [e], count: 1 });
    }
  }
  return out;
}
