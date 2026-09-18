import { describe, it, expect } from "vitest";

import {
  calledElementOf,
  calledProcessPath,
  collectCalledElementIds,
  isCallActivity,
  isCardUuid,
} from "./calledProcess";

const UUID = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";

function bo(type: string, calledElement?: string) {
  const props: Record<string, unknown> = { $type: type, calledElement };
  return { businessObject: { ...props, get: (name: string) => props[name] } };
}

describe("isCardUuid", () => {
  it("accepts a canonical card uuid, in either case, ignoring padding", () => {
    expect(isCardUuid(UUID)).toBe(true);
    expect(isCardUuid(UUID.toUpperCase())).toBe(true);
    expect(isCardUuid(`  ${UUID} `)).toBe(true);
  });

  it("rejects a BPMN process id, an empty value and a near miss", () => {
    expect(isCardUuid("Process_CreditCheck")).toBe(false);
    expect(isCardUuid("")).toBe(false);
    expect(isCardUuid(null)).toBe(false);
    expect(isCardUuid(undefined)).toBe(false);
    expect(isCardUuid(UUID.slice(0, -1))).toBe(false);
    expect(isCardUuid(UUID.replace(/-/g, ""))).toBe(false);
  });
});

describe("calledElementOf / isCallActivity", () => {
  it("reads the attribute through moddle's get when present", () => {
    expect(calledElementOf(bo("bpmn:CallActivity", " Process_X "))).toBe("Process_X");
    expect(isCallActivity(bo("bpmn:CallActivity"))).toBe(true);
  });

  it("is empty / false for a task, a missing attribute and no business object", () => {
    expect(calledElementOf(bo("bpmn:Task", "ignored"))).toBe("ignored");
    expect(isCallActivity(bo("bpmn:Task"))).toBe(false);
    expect(calledElementOf(bo("bpmn:CallActivity"))).toBe("");
    expect(calledElementOf({})).toBe("");
    expect(calledElementOf(null)).toBe("");
  });

  it("falls back to the plain property when the object has no get()", () => {
    expect(
      calledElementOf({ businessObject: { $type: "bpmn:CallActivity", calledElement: UUID } }),
    ).toBe(UUID);
  });
});

describe("collectCalledElementIds", () => {
  it("returns the distinct card uuids of call activities only, in first-seen order", () => {
    const other = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const elements = [
      bo("bpmn:Task", UUID), // a task carrying the attribute is not a call
      bo("bpmn:CallActivity", "Process_Foreign"), // foreign reference: skipped
      bo("bpmn:CallActivity", other),
      bo("bpmn:CallActivity", UUID),
      bo("bpmn:CallActivity", other), // duplicate
      bo("bpmn:CallActivity"), // unlinked
    ];
    expect(collectCalledElementIds(elements)).toEqual([other, UUID]);
  });

  it("is empty for an empty diagram", () => {
    expect(collectCalledElementIds([])).toEqual([]);
  });
});

describe("calledProcessPath", () => {
  it("lands on the callee's Process Flow tab", () => {
    expect(calledProcessPath(UUID)).toBe(`/cards/${UUID}?tab=1`);
  });
});
