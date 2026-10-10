/**
 * What a card's History tab says about each event: its label, icon and
 * colour, the field-level change rows it lists, and the one-line detail for
 * an event that carries no field diff. `HistoryTab` renders these; the rules
 * live here so each can be pinned on its own.
 *
 * A `changes` payload must be `{field: {old, new}}`, with `attributes` and
 * `lifecycle` carrying the WHOLE old/new dict (CLAUDE.md, *A write path that
 * can move cards.updated_at must also persist a card event*). Anything else
 * is dropped here, silently — this is the only reader.
 */

/** What an empty value reads as. */
export const NO_VALUE = "—";

export interface EventMeta {
  /** i18n key, `cards` namespace. */
  labelKey: string;
  icon: string;
  color: string;
}

export const EVENT_META: Record<string, EventMeta> = {
  "card.created": { labelKey: "history.events.created", icon: "add_circle", color: "#4caf50" },
  "card.updated": { labelKey: "history.events.updated", icon: "edit", color: "#1976d2" },
  "card.archived": { labelKey: "history.events.archived", icon: "archive", color: "#ff9800" },
  "card.restored": { labelKey: "history.events.restored", icon: "restore", color: "#4caf50" },
  "card.deleted": { labelKey: "history.events.deleted", icon: "delete", color: "#f44336" },
  "card.approval_status.approve": {
    labelKey: "history.events.approved",
    icon: "verified",
    color: "#4caf50",
  },
  "card.approval_status.reject": {
    labelKey: "history.events.rejected",
    icon: "cancel",
    color: "#f44336",
  },
  "card.approval_status.reset": {
    labelKey: "history.events.resetToDraft",
    icon: "restart_alt",
    color: "#9e9e9e",
  },
  "stakeholder.added": {
    labelKey: "history.events.stakeholderAdded",
    icon: "person_add",
    color: "#1976d2",
  },
  "stakeholder.role_changed": {
    labelKey: "history.events.stakeholderRoleChanged",
    icon: "manage_accounts",
    color: "#1976d2",
  },
  "stakeholder.removed": {
    labelKey: "history.events.stakeholderRemoved",
    icon: "person_remove",
    color: "#f44336",
  },
  "relation.created": { labelKey: "history.events.relationCreated", icon: "link", color: "#1976d2" },
  "relation.updated": {
    labelKey: "history.events.relationUpdated",
    icon: "sync_alt",
    color: "#1976d2",
  },
  "relation.deleted": {
    labelKey: "history.events.relationDeleted",
    icon: "link_off",
    color: "#f44336",
  },
  "risk.added": { labelKey: "history.events.riskAdded", icon: "report", color: "#ff9800" },
  "risk.updated": { labelKey: "history.events.riskUpdated", icon: "edit_note", color: "#ff9800" },
  "risk.removed": { labelKey: "history.events.riskRemoved", icon: "report_off", color: "#9e9e9e" },
  "document.added": { labelKey: "history.events.documentAdded", icon: "link", color: "#1976d2" },
  "document.updated": {
    labelKey: "history.events.documentUpdated",
    icon: "edit_note",
    color: "#1976d2",
  },
  "document.removed": {
    labelKey: "history.events.documentRemoved",
    icon: "link_off",
    color: "#f44336",
  },
  "file.uploaded": {
    labelKey: "history.events.fileUploaded",
    icon: "upload_file",
    color: "#1976d2",
  },
  "file.replaced": { labelKey: "history.events.fileReplaced", icon: "sync", color: "#1976d2" },
  "file.updated": { labelKey: "history.events.fileUpdated", icon: "edit_note", color: "#1976d2" },
  "file.deleted": { labelKey: "history.events.fileDeleted", icon: "delete", color: "#f44336" },
  "card_logo.updated": {
    labelKey: "history.events.cardLogoUpdated",
    icon: "image",
    color: "#1976d2",
  },
  "card_logo.deleted": {
    labelKey: "history.events.cardLogoDeleted",
    icon: "hide_image",
    color: "#f44336",
  },
  "comment.created": { labelKey: "history.events.commentCreated", icon: "chat", color: "#1976d2" },
  // Tagging rescores the card, which moves its Modified date — so it belongs
  // on the timeline like any other edit (#995).
  "tag.added": { labelKey: "history.events.tagAdded", icon: "label", color: "#1976d2" },
  "tag.removed": { labelKey: "history.events.tagRemoved", icon: "label_off", color: "#f44336" },
  // BPM process-flow approval trail. Without these the events render as their
  // raw dotted event_type, which makes the approval history of a process
  // unreadable on the card — and an unreadable trail is not an audit trail.
  "process_flow.submitted": {
    labelKey: "history.events.processFlowSubmitted",
    icon: "send",
    color: "#1976d2",
  },
  "process_flow.approved": {
    labelKey: "history.events.processFlowApproved",
    icon: "verified",
    color: "#4caf50",
  },
  "process_flow.rejected": {
    labelKey: "history.events.processFlowRejected",
    icon: "cancel",
    color: "#f44336",
  },
  "process_flow.withdrawn": {
    labelKey: "history.events.processFlowWithdrawn",
    icon: "unpublished",
    color: "#f44336",
  },
};

/** An event type this build has no entry for: its raw type, an info icon, grey. */
export function eventMeta(
  eventType: string,
  t: (key: string) => string,
): { label: string; icon: string; color: string } {
  const meta = EVENT_META[eventType];
  if (!meta) return { label: eventType, icon: "info", color: "#9e9e9e" };
  return { label: t(meta.labelKey), icon: meta.icon, color: meta.color };
}

/** A change value as one line of text; lifecycle phase keys read as their labels. */
export function fmtVal(val: unknown, phaseLabels: Record<string, string>): string {
  if (val == null || val === "") return NO_VALUE;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return val.map((v) => fmtVal(v, phaseLabels)).join(", ");
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>).filter(
      ([, v]) => v != null && v !== "",
    );
    if (entries.length === 0) return NO_VALUE;
    return entries.map(([k, v]) => `${phaseLabels[k] || k}: ${v}`).join(", ");
  }
  return String(val);
}

/**
 * A change key's label, from the first source that knows it: a built-in
 * field, a lifecycle phase, the card type's attribute labels (after stripping
 * the `attr_` prefix the survey-apply path writes), else the key itself.
 */
export function resolveFieldLabel(
  rawKey: string,
  fieldLabels: Record<string, string>,
  phaseLabels: Record<string, string>,
  attrLabels: Record<string, string>,
): string {
  if (fieldLabels[rawKey]) return fieldLabels[rawKey];
  if (phaseLabels[rawKey]) return phaseLabels[rawKey];
  const attrKey = rawKey.startsWith("attr_") ? rawKey.slice(5) : rawKey;
  return attrLabels[attrKey] || rawKey;
}

export interface ChangeRow {
  field: string;
  oldVal: string;
  newVal: string;
}

export interface ChangeLabels {
  fields: Record<string, string>;
  phases: Record<string, string>;
  attributes: Record<string, string>;
  /** Approval status enum → its label, as the approval badge shows it. */
  statuses: Record<string, string>;
}

function isDict(value: unknown): boolean {
  return typeof value === "object";
}

/**
 * One row per changed field. `attributes` and `lifecycle` expand into one row
 * per key whose value differs; an entry that is not `{old, new}` is skipped.
 */
export function parseChanges(changes: Record<string, unknown>, labels: ChangeLabels): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const label = (key: string) =>
    resolveFieldLabel(key, labels.fields, labels.phases, labels.attributes);
  const fmt = (v: unknown) => fmtVal(v, labels.phases);
  for (const [field, change] of Object.entries(changes)) {
    if (!change || typeof change !== "object" || !("old" in change) || !("new" in change)) {
      continue;
    }
    const c = change as { old: unknown; new: unknown };
    if ((field === "attributes" || field === "lifecycle") && isDict(c.old) && isDict(c.new)) {
      const oldD = (c.old || {}) as Record<string, unknown>;
      const newD = (c.new || {}) as Record<string, unknown>;
      for (const key of new Set([...Object.keys(oldD), ...Object.keys(newD)])) {
        if (field === "attributes") {
          if (JSON.stringify(oldD[key]) !== JSON.stringify(newD[key])) {
            rows.push({ field: label(key), oldVal: fmt(oldD[key]), newVal: fmt(newD[key]) });
          }
        } else if (oldD[key] !== newD[key]) {
          rows.push({
            field: labels.phases[key] || key,
            oldVal: fmt(oldD[key]),
            newVal: fmt(newD[key]),
          });
        }
      }
    } else if (field === "approval_status") {
      // A status this build has not heard of still renders as its raw value.
      rows.push({
        field: label(field),
        oldVal: labels.statuses[String(c.old)] ?? fmt(c.old),
        newVal: labels.statuses[String(c.new)] ?? fmt(c.new),
      });
    } else {
      rows.push({ field: label(field), oldVal: fmt(c.old), newVal: fmt(c.new) });
    }
  }
  return rows;
}

/**
 * The labels a change row uses for this event. A document link's `url` /
 * `type` and a file's `category` are the resource's own fields, not the
 * card's, so they take the Resources dialogs' labels and a card attribute
 * that happens to be keyed `type` is never borrowed (#1166).
 */
export function fieldLabelsFor(
  eventType: string,
  fieldLabels: Record<string, string>,
  resourceLabels: { url: string; type: string; category: string },
): Record<string, string> {
  if (eventType === "document.updated" || eventType === "file.updated") {
    return { ...fieldLabels, ...resourceLabels };
  }
  return fieldLabels;
}

export const RISK_LEVEL_COLOR: Record<string, string> = {
  critical: "#d32f2f",
  high: "#f57c00",
  medium: "#fbc02d",
  low: "#388e3c",
};

export type EventDetail =
  | {
      kind: "relation";
      label: string;
      outgoing: boolean;
      peerId?: string;
      peerName: string;
      peerType?: string | null;
    }
  | { kind: "risk"; reference?: string; link?: string; level?: string; levelColor?: string; title?: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "processFlow"; revision?: number; reason?: string }
  | { kind: "plain"; text: string }
  | null;

function plain(text: string | null): EventDetail {
  return text ? { kind: "plain", text } : null;
}

function fileLine(d: Record<string, unknown>): string {
  const name = (d.name as string) || "";
  const size = d.size as number | undefined;
  return size != null ? `${name} · ${(size / 1024).toFixed(1)} KB` : name;
}

/**
 * The detail line under an event that carries structured context but no
 * field diff (relations, risks, documents, files, flow approvals); otherwise
 * the event's plain summary, or nothing.
 */
export function eventDetailModel(
  eventType: string,
  data: Record<string, unknown> | undefined,
  summary: string | null,
): EventDetail {
  if (!data) return plain(summary);

  if (eventType.startsWith("relation.")) {
    const peerId = data.peer_id as string | undefined;
    return {
      kind: "relation",
      label:
        (data.directional_label as string) ||
        (data.relation_label as string) ||
        (data.type as string),
      outgoing: ((data.direction as string) || "outgoing") === "outgoing",
      peerId,
      peerName: (data.peer_name as string) || peerId || "",
      peerType: data.peer_type as string | null | undefined,
    };
  }

  if (eventType.startsWith("risk.")) {
    const level = (data.level as string | undefined)?.toLowerCase();
    return {
      kind: "risk",
      reference: data.reference as string | undefined,
      link: data.link as string | undefined,
      level,
      levelColor: level ? RISK_LEVEL_COLOR[level] : undefined,
      title: data.title as string | undefined,
    };
  }

  if (
    eventType === "document.added" ||
    eventType === "document.updated" ||
    eventType === "document.removed"
  ) {
    const text = (data.name as string) || (data.url as string) || summary || "";
    const url = data.url as string | undefined;
    if (eventType !== "document.removed" && url) return { kind: "link", text, url };
    return { kind: "plain", text };
  }

  if (eventType === "card_logo.updated" || eventType === "card_logo.deleted") {
    // No `changes` payload: image bytes have no business in a diff.
    return { kind: "plain", text: summary || "" };
  }

  if (eventType.startsWith("file.")) {
    const current = fileLine(data) || summary || "";
    // A replace carries the version it superseded as `previous` (not as
    // `changes`: a raw byte count is not a field diff anyone wants to read).
    const previous = data.previous as Record<string, unknown> | undefined;
    if (eventType === "file.replaced" && previous) {
      return { kind: "plain", text: `${fileLine(previous)} → ${current}` };
    }
    return { kind: "plain", text: current };
  }

  if (eventType.startsWith("process_flow.")) {
    // All four flow events carry the revision; only a withdrawal carries a
    // reason, rendered in full — an audit trail that hides the justification
    // defeats its own purpose.
    const revision = data.revision as number | undefined;
    const reason = (data.reason as string | undefined)?.trim();
    if (revision == null && !reason) return plain(summary);
    return { kind: "processFlow", revision, reason: reason || undefined };
  }

  // Stakeholder events, and any other, ship a clean summary already.
  return plain(summary);
}

/** `{attribute key: label}` for every field of a card type. */
export function attributeLabels(
  fieldsSchema: { fields?: { key: string }[] }[] | undefined,
  label: (field: { key: string }) => string,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const section of fieldsSchema ?? []) {
    for (const field of section.fields ?? []) labels[field.key] = label(field);
  }
  return labels;
}
