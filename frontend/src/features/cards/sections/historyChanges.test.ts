import { describe, expect, it } from "vitest";
import {
  EVENT_META,
  NO_VALUE,
  RISK_LEVEL_COLOR,
  attributeLabels,
  eventDetailModel,
  eventMeta,
  fieldLabelsFor,
  fmtVal,
  parseChanges,
  resolveFieldLabel,
  type ChangeLabels,
} from "./historyChanges";

const echo = (key: string) => `t(${key})`;

function labels(over: Partial<ChangeLabels> = {}): ChangeLabels {
  return {
    fields: { name: "Name", approval_status: "Approval" },
    phases: { plan: "Plan", active: "Active" },
    attributes: { costTotal: "Total cost", type: "Kind" },
    statuses: { DRAFT: "Draft", APPROVED: "Approved" },
    ...over,
  };
}

describe("eventMeta", () => {
  it("labels a known event from its i18n key, with its icon and colour", () => {
    expect(eventMeta("card.updated", echo)).toEqual({
      label: "t(history.events.updated)",
      icon: "edit",
      color: "#1976d2",
    });
    expect(eventMeta("process_flow.withdrawn", echo)).toEqual({
      label: "t(history.events.processFlowWithdrawn)",
      icon: "unpublished",
      color: "#f44336",
    });
  });

  it("shows an unknown event as its raw type with a grey info icon", () => {
    expect(eventMeta("something.new", echo)).toEqual({
      label: "something.new",
      icon: "info",
      color: "#9e9e9e",
    });
  });

  it("knows the 33 event types the backend emits on a card", () => {
    expect(Object.keys(EVENT_META)).toHaveLength(33);
    expect(EVENT_META["tag.removed"]).toEqual({
      labelKey: "history.events.tagRemoved",
      icon: "label_off",
      color: "#f44336",
    });
  });
});

describe("fmtVal", () => {
  const phases = { plan: "Plan" };

  it("reads an empty value as a dash", () => {
    expect(NO_VALUE).toBe("—");
    expect(fmtVal(null, phases)).toBe("—");
    expect(fmtVal(undefined, phases)).toBe("—");
    expect(fmtVal("", phases)).toBe("—");
    expect(fmtVal({}, phases)).toBe("—");
    expect(fmtVal({ a: null, b: "" }, phases)).toBe("—");
  });

  it("writes scalars as text", () => {
    expect(fmtVal("x", phases)).toBe("x");
    expect(fmtVal(0, phases)).toBe("0");
    expect(fmtVal(12.5, phases)).toBe("12.5");
    expect(fmtVal(false, phases)).toBe("false");
  });

  it("joins a list, and a dict as key: value with phase labels", () => {
    expect(fmtVal(["a", 2, null], phases)).toBe("a, 2, —");
    expect(fmtVal({ plan: "2026-01-01", other: 3, gone: null }, phases)).toBe(
      "Plan: 2026-01-01, other: 3",
    );
  });
});

describe("resolveFieldLabel", () => {
  const fields = { name: "Name" };
  const phases = { plan: "Plan" };
  const attrs = { cost: "Cost", name: "Attr name" };

  it("prefers a built-in field, then a phase, then an attribute, then the key", () => {
    expect(resolveFieldLabel("name", fields, phases, attrs)).toBe("Name");
    expect(resolveFieldLabel("plan", fields, phases, attrs)).toBe("Plan");
    expect(resolveFieldLabel("cost", fields, phases, attrs)).toBe("Cost");
    expect(resolveFieldLabel("unknown", fields, phases, attrs)).toBe("unknown");
  });

  it("strips the survey path's attr_ prefix before an attribute lookup", () => {
    expect(resolveFieldLabel("attr_cost", fields, phases, attrs)).toBe("Cost");
    expect(resolveFieldLabel("attr_missing", fields, phases, attrs)).toBe("attr_missing");
  });
});

describe("parseChanges", () => {
  it("lists a scalar field with its label", () => {
    expect(parseChanges({ name: { old: "A", new: "B" } }, labels())).toEqual([
      { field: "Name", oldVal: "A", newVal: "B" },
    ]);
  });

  it("skips an entry that is not {old, new}", () => {
    const changes = {
      legacy: "A -> B",
      half: { old: 1 },
      other: { new: 1 },
      empty: null,
      name: { old: null, new: "B" },
    };
    expect(parseChanges(changes, labels())).toEqual([
      { field: "Name", oldVal: "—", newVal: "B" },
    ]);
  });

  it("expands attributes into one row per changed key, compared as JSON", () => {
    const changes = {
      attributes: {
        old: { costTotal: 10, tags: ["a"], same: { x: 1 }, gone: "x" },
        new: { costTotal: 20, tags: ["a"], same: { x: 1 }, added: true },
      },
    };
    expect(parseChanges(changes, labels())).toEqual([
      { field: "Total cost", oldVal: "10", newVal: "20" },
      { field: "gone", oldVal: "x", newVal: "—" },
      { field: "added", oldVal: "—", newVal: "true" },
    ]);
  });

  it("treats a null whole-dict side as empty", () => {
    expect(parseChanges({ attributes: { old: null, new: { costTotal: 5 } } }, labels())).toEqual([
      { field: "Total cost", oldVal: "—", newVal: "5" },
    ]);
  });

  it("does not expand an attributes change that is not two dicts", () => {
    expect(parseChanges({ attributes: { old: "a", new: "b" } }, labels())).toEqual([
      { field: "attributes", oldVal: "a", newVal: "b" },
    ]);
  });

  it("expands lifecycle into one row per changed phase, named by the phase", () => {
    const changes = {
      lifecycle: {
        old: { plan: "2026-01-01", active: "2026-06-01" },
        new: { plan: "2026-01-01", active: "2026-07-01", endOfLife: "2030-01-01" },
      },
    };
    expect(parseChanges(changes, labels())).toEqual([
      { field: "Active", oldVal: "2026-06-01", newVal: "2026-07-01" },
      { field: "endOfLife", oldVal: "—", newVal: "2030-01-01" },
    ]);
  });

  it("names approval states as the badge does, falling back to the raw value", () => {
    expect(
      parseChanges({ approval_status: { old: "DRAFT", new: "BROKEN" } }, labels()),
    ).toEqual([{ field: "Approval", oldVal: "Draft", newVal: "BROKEN" }]);
    expect(
      parseChanges({ approval_status: { old: null, new: "APPROVED" } }, labels()),
    ).toEqual([{ field: "Approval", oldVal: "—", newVal: "Approved" }]);
  });
});

describe("fieldLabelsFor", () => {
  const fields = { name: "Name" };
  const resource = { url: "URL", type: "Link type", category: "Category" };

  it("labels a document or file edit's own fields as the Resources dialogs do", () => {
    expect(fieldLabelsFor("document.updated", fields, resource)).toEqual({
      name: "Name",
      url: "URL",
      type: "Link type",
      category: "Category",
    });
    expect(fieldLabelsFor("file.updated", fields, resource).category).toBe("Category");
  });

  it("leaves every other event's labels alone", () => {
    expect(fieldLabelsFor("card.updated", fields, resource)).toBe(fields);
    expect(fieldLabelsFor("document.added", fields, resource)).toBe(fields);
  });
});

describe("eventDetailModel", () => {
  it("falls back to the summary when there is no data", () => {
    expect(eventDetailModel("card.updated", undefined, "Edited")).toEqual({
      kind: "plain",
      text: "Edited",
    });
    expect(eventDetailModel("card.updated", undefined, null)).toBeNull();
  });

  it("describes a relation by its verb, direction and peer", () => {
    expect(
      eventDetailModel(
        "relation.created",
        {
          directional_label: "is used by",
          relation_label: "uses",
          type: "relAppToItc",
          direction: "incoming",
          peer_id: "p1",
          peer_name: "SAP",
          peer_type: "Application",
        },
        null,
      ),
    ).toEqual({
      kind: "relation",
      label: "is used by",
      outgoing: false,
      peerId: "p1",
      peerName: "SAP",
      peerType: "Application",
    });
  });

  it("falls back through the relation label, the type, and the peer id", () => {
    expect(
      eventDetailModel("relation.deleted", { relation_label: "uses", peer_id: "p1" }, null),
    ).toEqual({
      kind: "relation",
      label: "uses",
      outgoing: true,
      peerId: "p1",
      peerName: "p1",
      peerType: undefined,
    });
    expect(eventDetailModel("relation.updated", { type: "relX" }, null)).toEqual({
      kind: "relation",
      label: "relX",
      outgoing: true,
      peerId: undefined,
      peerName: "",
      peerType: undefined,
    });
  });

  it("describes a risk with its reference, link, lower-cased level and colour", () => {
    expect(
      eventDetailModel(
        "risk.added",
        { reference: "R-000001", title: "Outage", level: "HIGH", link: "/grc/risks/1" },
        null,
      ),
    ).toEqual({
      kind: "risk",
      reference: "R-000001",
      link: "/grc/risks/1",
      level: "high",
      levelColor: RISK_LEVEL_COLOR.high,
      title: "Outage",
    });
    expect(RISK_LEVEL_COLOR).toEqual({
      critical: "#d32f2f",
      high: "#f57c00",
      medium: "#fbc02d",
      low: "#388e3c",
    });
    expect(eventDetailModel("risk.removed", { title: "T" }, null)).toEqual({
      kind: "risk",
      reference: undefined,
      link: undefined,
      level: undefined,
      levelColor: undefined,
      title: "T",
    });
  });

  it("links a document unless it was removed", () => {
    const data = { name: "Spec", url: "https://example.invalid/spec" };
    expect(eventDetailModel("document.added", data, null)).toEqual({
      kind: "link",
      text: "Spec",
      url: "https://example.invalid/spec",
    });
    expect(eventDetailModel("document.updated", data, null)?.kind).toBe("link");
    expect(eventDetailModel("document.removed", data, null)).toEqual({
      kind: "plain",
      text: "Spec",
    });
  });

  it("names a document by its name, then its URL, then the summary", () => {
    expect(eventDetailModel("document.removed", { url: "https://x.invalid" }, "s")).toEqual({
      kind: "plain",
      text: "https://x.invalid",
    });
    expect(eventDetailModel("document.removed", {}, "Summary")).toEqual({
      kind: "plain",
      text: "Summary",
    });
    expect(eventDetailModel("document.removed", {}, null)).toEqual({ kind: "plain", text: "" });
  });

  it("shows a logo change by its summary only", () => {
    expect(eventDetailModel("card_logo.updated", { mime: "image/png" }, "New logo")).toEqual({
      kind: "plain",
      text: "New logo",
    });
    expect(eventDetailModel("card_logo.deleted", {}, null)).toEqual({ kind: "plain", text: "" });
  });

  it("describes a file by name and size, and a replace as previous → current", () => {
    expect(eventDetailModel("file.uploaded", { name: "a.pdf", size: 2048 }, null)).toEqual({
      kind: "plain",
      text: "a.pdf · 2.0 KB",
    });
    expect(eventDetailModel("file.deleted", { name: "a.pdf" }, null)).toEqual({
      kind: "plain",
      text: "a.pdf",
    });
    expect(
      eventDetailModel(
        "file.replaced",
        { name: "b.pdf", size: 1536, previous: { name: "a.pdf", size: 512 } },
        null,
      ),
    ).toEqual({ kind: "plain", text: "a.pdf · 0.5 KB → b.pdf · 1.5 KB" });
    expect(eventDetailModel("file.replaced", { name: "b.pdf" }, null)).toEqual({
      kind: "plain",
      text: "b.pdf",
    });
    expect(eventDetailModel("file.uploaded", {}, "Uploaded")).toEqual({
      kind: "plain",
      text: "Uploaded",
    });
  });

  it("shows a flow approval's revision and a withdrawal's reason, trimmed", () => {
    expect(eventDetailModel("process_flow.approved", { revision: 3 }, null)).toEqual({
      kind: "processFlow",
      revision: 3,
      reason: undefined,
    });
    expect(
      eventDetailModel("process_flow.withdrawn", { revision: 0, reason: "  wrong lane  " }, null),
    ).toEqual({ kind: "processFlow", revision: 0, reason: "wrong lane" });
    expect(eventDetailModel("process_flow.withdrawn", { reason: "   " }, "s")).toEqual({
      kind: "plain",
      text: "s",
    });
    expect(eventDetailModel("process_flow.submitted", {}, null)).toBeNull();
  });

  it("uses the summary for stakeholder and other events", () => {
    expect(eventDetailModel("stakeholder.added", { user: "u" }, "Ann · Owner")).toEqual({
      kind: "plain",
      text: "Ann · Owner",
    });
    expect(eventDetailModel("comment.created", { id: "c" }, null)).toBeNull();
  });
});

describe("attributeLabels", () => {
  it("labels every field of every section", () => {
    const schema = [
      { fields: [{ key: "a" }, { key: "b" }] },
      { fields: [{ key: "c" }] },
      {},
    ];
    expect(attributeLabels(schema, (f) => f.key.toUpperCase())).toEqual({
      a: "A",
      b: "B",
      c: "C",
    });
    expect(attributeLabels(undefined, () => "x")).toEqual({});
  });
});
