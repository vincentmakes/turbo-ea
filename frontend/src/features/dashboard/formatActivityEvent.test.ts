import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import {
  formatActivityEvent,
  groupConsecutive,
  matchesFilter,
  dayBucket,
  relativeTime,
} from "./formatActivityEvent";
import type { EventEntry } from "@/types";

// Minimal i18n stub: returns a non-empty string so tests can assert against
// deterministic strings without booting react-i18next. Mirrors the real
// behaviour of returning a translated value when a key is present.
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (key.startsWith("dashboard.activity.action.") && opts?.defaultValue !== undefined) {
    return key;
  }
  if (opts && typeof opts === "object" && "count" in opts) {
    return `${key}:${(opts as { count: number }).count}`;
  }
  return key;
}) as unknown as TFunction<"common">;

// Stub that mimics the production i18n config (`returnEmptyString: false`)
// where a missing key is returned verbatim, ignoring `defaultValue`. This
// is the exact path that previously leaked raw keys like
// `dashboard.activity.action.risk.added` into the UI.
const tMissingKeyReturnsKey = ((key: string, opts?: Record<string, unknown>) => {
  if (key === "dashboard.activity.action.fallback") {
    return `did ${(opts as { type: string }).type}`;
  }
  // Action keys: pretend they're missing → return the key (production behaviour).
  if (key.startsWith("dashboard.activity.action.")) {
    return key;
  }
  return key;
}) as unknown as TFunction<"common">;

const baseEvent: EventEntry = {
  id: "1",
  card_id: "card-123",
  user_display_name: "Alice",
  event_type: "card.updated",
  data: { id: "card-123", name: "NexaCore ERP", changes: { name: "x", desc: "y" } },
  created_at: "2026-04-27T10:00:00Z",
};

describe("formatActivityEvent", () => {
  it("classifies card.updated as 'update' category and exposes a card link", () => {
    const out = formatActivityEvent(baseEvent, t);
    expect(out.category).toBe("update");
    expect(out.cardLink).toBe("/cards/card-123");
    expect(out.cardName).toBe("NexaCore ERP");
  });

  it("falls back to data.id when card_id is missing", () => {
    const out = formatActivityEvent(
      { ...baseEvent, card_id: undefined },
      t,
    );
    expect(out.cardLink).toBe("/cards/card-123");
  });

  it("prefers server-resolved card_name over data.name when both are present", () => {
    const out = formatActivityEvent(
      { ...baseEvent, card_name: "Renamed Card", data: { id: "card-123", name: "Old Name" } },
      t,
    );
    expect(out.cardName).toBe("Renamed Card");
  });

  it("uses card_name when data has no name (e.g. card.updated, approval events)", () => {
    const out = formatActivityEvent(
      {
        ...baseEvent,
        event_type: "card.approval_status.approve",
        card_name: "NexaCore ERP",
        data: { id: "card-123", approval_status: "APPROVED" },
      },
      t,
    );
    expect(out.cardName).toBe("NexaCore ERP");
    expect(out.category).toBe("approve");
  });

  it("classifies approval events into approve/reject/reset", () => {
    const make = (action: string): EventEntry => ({
      ...baseEvent,
      event_type: `card.approval_status.${action}`,
    });
    expect(formatActivityEvent(make("approve"), t).category).toBe("approve");
    expect(formatActivityEvent(make("reject"), t).category).toBe("reject");
    expect(formatActivityEvent(make("reset"), t).category).toBe("reset");
  });

  it("classifies relation/comment/process/adr/soaw events", () => {
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "relation.created" }, t).category,
    ).toBe("relation");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "comment.created" }, t).category,
    ).toBe("comment");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "process_diagram.saved" }, t).category,
    ).toBe("diagram");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "process_flow.approved" }, t).category,
    ).toBe("process");
    expect(formatActivityEvent({ ...baseEvent, event_type: "adr.signed" }, t).category).toBe("adr");
    expect(formatActivityEvent({ ...baseEvent, event_type: "soaw.signed" }, t).category).toBe(
      "soaw",
    );
  });

  it("classifies stakeholder/risk/document/file events into their own categories", () => {
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "stakeholder.added" }, t).category,
    ).toBe("stakeholder");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "stakeholder.role_changed" }, t).category,
    ).toBe("stakeholder");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "stakeholder.removed" }, t).category,
    ).toBe("stakeholder");
    expect(formatActivityEvent({ ...baseEvent, event_type: "risk.added" }, t).category).toBe(
      "risk",
    );
    expect(formatActivityEvent({ ...baseEvent, event_type: "risk.updated" }, t).category).toBe(
      "risk",
    );
    expect(formatActivityEvent({ ...baseEvent, event_type: "risk.removed" }, t).category).toBe(
      "risk",
    );
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "document.added" }, t).category,
    ).toBe("document");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "document.updated" }, t).category,
    ).toBe("document");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "file.uploaded" }, t).category,
    ).toBe("document");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "file.replaced" }, t).category,
    ).toBe("document");
    expect(
      formatActivityEvent({ ...baseEvent, event_type: "file.updated" }, t).category,
    ).toBe("document");
  });

  it("uses a generic 'other' category and the fallback action text for unknown event types", () => {
    const out = formatActivityEvent(
      { ...baseEvent, event_type: "weird.thing" },
      tMissingKeyReturnsKey,
    );
    expect(out.category).toBe("other");
    expect(out.actionText).toBe("did weird thing");
  });

  it("never leaks the raw translation key when the production i18n config returns the key for a missing label", () => {
    // Regression test: the i18n config has `returnEmptyString: false`,
    // which makes a missing key resolve to itself. A brand-new backend
    // event type must therefore never render the raw "dashboard.activity.action.X"
    // string in the UI; the fallback ("performed {{type}}") must take over.
    const out = formatActivityEvent(
      { ...baseEvent, event_type: "brand.new" },
      tMissingKeyReturnsKey,
    );
    expect(out.actionText).not.toContain("dashboard.activity.action.");
    expect(out.actionText).toBe("did brand new");
  });

});

describe("matchesFilter", () => {
  it("respects each filter bucket", () => {
    expect(matchesFilter("create", "all")).toBe(true);
    expect(matchesFilter("create", "cards")).toBe(true);
    expect(matchesFilter("approve", "approvals")).toBe(true);
    expect(matchesFilter("approve", "cards")).toBe(false);
    expect(matchesFilter("relation", "relations")).toBe(true);
    expect(matchesFilter("comment", "comments")).toBe(true);
    expect(matchesFilter("update", "approvals")).toBe(false);
  });
});

describe("groupConsecutive", () => {
  const evt = (id: string, type: string, user: string, card: string): EventEntry => ({
    id,
    user_id: user,
    card_id: card,
    event_type: type,
    user_display_name: user,
    data: { id: card, name: "Card " + card },
  });

  it("collapses consecutive same-user same-card update events", () => {
    const events = [
      evt("1", "card.updated", "u1", "c1"),
      evt("2", "card.updated", "u1", "c1"),
      evt("3", "card.updated", "u1", "c1"),
    ];
    const groups = groupConsecutive(events);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it("does not collapse different users", () => {
    const events = [
      evt("1", "card.updated", "u1", "c1"),
      evt("2", "card.updated", "u2", "c1"),
    ];
    expect(groupConsecutive(events)).toHaveLength(2);
  });

  it("does not collapse different cards", () => {
    const events = [
      evt("1", "card.updated", "u1", "c1"),
      evt("2", "card.updated", "u1", "c2"),
    ];
    expect(groupConsecutive(events)).toHaveLength(2);
  });

  it("does not collapse non-update events", () => {
    const events = [
      evt("1", "card.approval_status.approve", "u1", "c1"),
      evt("2", "card.approval_status.approve", "u1", "c1"),
    ];
    expect(groupConsecutive(events)).toHaveLength(2);
  });
});

describe("dayBucket", () => {
  it("labels today's events as Today", () => {
    const iso = new Date().toISOString();
    expect(dayBucket(iso, t).label).toBe("dashboard.activity.day.today");
  });

  it("labels yesterday's events as Yesterday", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    expect(dayBucket(d.toISOString(), t).label).toBe("dashboard.activity.day.yesterday");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for sub-minute deltas", () => {
    const iso = new Date(Date.now() - 5_000).toISOString();
    expect(relativeTime(iso, t)).toBe("dashboard.activity.time.justNow");
  });

  it("uses minute granularity under one hour", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(iso, t)).toBe("dashboard.activity.time.minutesAgo:5");
  });

  it("uses hour granularity under one day", () => {
    const iso = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(iso, t)).toBe("dashboard.activity.time.hoursAgo:3");
  });
});
