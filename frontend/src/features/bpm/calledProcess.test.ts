import { describe, it, expect } from "vitest";

import {
  PROCESS_REF_ATTR,
  calledElementOf,
  calledProcessPath,
  collectProcessRefIds,
  isCallActivity,
  isCardUuid,
  isProcessStep,
  processRefOf,
  processRefProperties,
} from "./calledProcess";

const UUID = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";

/** Every type bpmn-js reports as a `bpmn:FlowNode`, and the ones it does not. */
const FLOW_NODES = [
  "bpmn:Task",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:SubProcess",
  "bpmn:Transaction",
  "bpmn:CallActivity",
  "bpmn:StartEvent",
  "bpmn:BoundaryEvent",
  "bpmn:EndEvent",
  "bpmn:ExclusiveGateway",
  "bpmn:ParallelGateway",
];
const NOT_FLOW_NODES = [
  "bpmn:Participant",
  "bpmn:Lane",
  "bpmn:SequenceFlow",
  "bpmn:MessageFlow",
  "bpmn:DataObjectReference",
  "bpmn:DataStoreReference",
  "bpmn:TextAnnotation",
  "bpmn:Process",
];

/** A bpmn-js element with just enough moddle to answer `$instanceOf` / `get`. */
function element(
  type: string,
  props: { calledElement?: string; processRef?: string } = {},
  extra: { labelTarget?: unknown } = {},
) {
  const values: Record<string, unknown> = {
    calledElement: props.calledElement,
    [PROCESS_REF_ATTR]: props.processRef,
  };
  return {
    ...extra,
    businessObject: {
      $type: type,
      $instanceOf: (t: string) => t === type || (t === "bpmn:FlowNode" && FLOW_NODES.includes(type)),
      calledElement: props.calledElement,
      get: (name: string) => values[name],
    },
  };
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

describe("isProcessStep", () => {
  it("is true for every flow node — tasks, sub-processes, events, gateways", () => {
    for (const type of FLOW_NODES) expect(isProcessStep(element(type))).toBe(true);
  });

  it("is false for pools, lanes, flows, artefacts and the process itself", () => {
    for (const type of NOT_FLOW_NODES) expect(isProcessStep(element(type))).toBe(false);
  });

  it("is false for an external label, whose business object is the labelled node's", () => {
    const label = element("bpmn:StartEvent", {}, { labelTarget: { id: "event" } });
    expect(isProcessStep(label)).toBe(false);
  });

  it("is false with no element and no business object", () => {
    expect(isProcessStep(null)).toBe(false);
    expect(isProcessStep(undefined)).toBe(false);
    expect(isProcessStep({})).toBe(false);
  });
});

describe("calledElementOf / isCallActivity", () => {
  it("reads the attribute through moddle's get when present", () => {
    expect(calledElementOf(element("bpmn:CallActivity", { calledElement: " Process_X " }))).toBe(
      "Process_X",
    );
    expect(isCallActivity(element("bpmn:CallActivity"))).toBe(true);
    expect(isCallActivity(element("bpmn:Task"))).toBe(false);
  });

  it("is empty for a missing attribute and no business object", () => {
    expect(calledElementOf(element("bpmn:CallActivity"))).toBe("");
    expect(calledElementOf({})).toBe("");
    expect(calledElementOf(null)).toBe("");
  });

  it("falls back to the plain property when the object has no get()", () => {
    expect(
      calledElementOf({ businessObject: { $type: "bpmn:CallActivity", calledElement: UUID } }),
    ).toBe(UUID);
  });
});

describe("processRefOf", () => {
  it("reads turboea:processRef on a plain step", () => {
    expect(processRefOf(element("bpmn:ServiceTask", { processRef: UUID }))).toBe(UUID);
    expect(processRefOf(element("bpmn:StartEvent", { processRef: ` ${UUID} ` }))).toBe(UUID);
    expect(processRefOf(element("bpmn:Task"))).toBe("");
  });

  it("prefers calledElement on a call activity that carries both", () => {
    const other = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    expect(
      processRefOf(element("bpmn:CallActivity", { calledElement: other, processRef: UUID })),
    ).toBe(other);
  });

  it("falls back to processRef on a call activity with no callee — a morphed task", () => {
    expect(processRefOf(element("bpmn:CallActivity", { processRef: UUID }))).toBe(UUID);
  });

  it("ignores calledElement on anything but a call activity", () => {
    expect(processRefOf(element("bpmn:Task", { calledElement: UUID }))).toBe("");
  });
});

describe("processRefProperties", () => {
  it("writes BPMN's own calledElement on a call activity, dropping any processRef", () => {
    expect(processRefProperties(element("bpmn:CallActivity"), UUID)).toEqual({
      calledElement: UUID,
      [PROCESS_REF_ATTR]: undefined,
    });
  });

  it("writes the extension attribute on every other step", () => {
    expect(processRefProperties(element("bpmn:UserTask"), UUID)).toEqual({
      [PROCESS_REF_ATTR]: UUID,
    });
  });

  it("clears both attributes, whatever the element is", () => {
    const cleared = { calledElement: undefined, [PROCESS_REF_ATTR]: undefined };
    expect(processRefProperties(element("bpmn:CallActivity", { calledElement: UUID }), null)).toEqual(
      cleared,
    );
    expect(processRefProperties(element("bpmn:Task", { processRef: UUID }), null)).toEqual(cleared);
  });
});

describe("collectProcessRefIds", () => {
  it("returns the distinct card uuids of every step, in first-seen order", () => {
    const other = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    const elements = [
      element("bpmn:DataObjectReference", { processRef: UUID }), // not a step: skipped
      element("bpmn:CallActivity", { calledElement: "Process_Foreign" }), // foreign: skipped
      element("bpmn:ServiceTask", { processRef: other }),
      element("bpmn:CallActivity", { calledElement: UUID }),
      element("bpmn:StartEvent", { processRef: other }), // duplicate
      element("bpmn:Task"), // unlinked
    ];
    expect(collectProcessRefIds(elements)).toEqual([other, UUID]);
  });

  it("is empty for an empty diagram", () => {
    expect(collectProcessRefIds([])).toEqual([]);
  });
});

describe("calledProcessPath", () => {
  it("lands on the linked process's Process Flow tab", () => {
    expect(calledProcessPath(UUID)).toBe(`/cards/${UUID}?tab=1`);
  });
});
