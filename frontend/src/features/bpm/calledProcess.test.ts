import { describe, it, expect } from "vitest";

import {
  LINK_KIND_ORDER,
  PROCESS_REF_ATTR,
  calledElementOf,
  calledProcessPath,
  collectProcessRefIds,
  elementIdOf,
  emptyLinks,
  isCallActivity,
  isCardUuid,
  isDataArtefact,
  isProcessStep,
  linkKindsFor,
  linksFromDraftElements,
  processRefOf,
  processRefProperties,
  singleLinkOf,
  withLink,
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
  props: { calledElement?: string; processRef?: string; id?: string } = {},
  extra: { labelTarget?: unknown } = {},
) {
  const values: Record<string, unknown> = {
    calledElement: props.calledElement,
    [PROCESS_REF_ATTR]: props.processRef,
  };
  return {
    id: props.id ?? "shape_1",
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

describe("isDataArtefact", () => {
  it("is true for a data object and a data store reference", () => {
    expect(isDataArtefact(element("bpmn:DataObjectReference"))).toBe(true);
    expect(isDataArtefact(element("bpmn:DataStoreReference"))).toBe(true);
  });

  it("is false for a step, a pool and an artefact's own label", () => {
    expect(isDataArtefact(element("bpmn:Task"))).toBe(false);
    expect(isDataArtefact(element("bpmn:Participant"))).toBe(false);
    const label = element("bpmn:DataObjectReference", {}, { labelTarget: { id: "do" } });
    expect(isDataArtefact(label)).toBe(false);
    expect(isDataArtefact(null)).toBe(false);
  });
});

describe("linkKindsFor", () => {
  it("offers every kind on a step of a draft, in panel order", () => {
    expect(linkKindsFor(element("bpmn:UserTask"), true)).toEqual([...LINK_KIND_ORDER]);
    expect(linkKindsFor(element("bpmn:StartEvent"), true)).toHaveLength(5);
  });

  it("offers the process alone without a draft — the card links have nowhere to go", () => {
    expect(linkKindsFor(element("bpmn:UserTask"), false)).toEqual(["process"]);
  });

  it("offers a data artefact the Data Object link only, like the steps table", () => {
    expect(linkKindsFor(element("bpmn:DataObjectReference"), true)).toEqual(["data_object"]);
    expect(linkKindsFor(element("bpmn:DataStoreReference"), false)).toEqual([]);
  });

  it("offers nothing on a pool, a flow or a label", () => {
    expect(linkKindsFor(element("bpmn:Participant"), true)).toEqual([]);
    expect(linkKindsFor(element("bpmn:SequenceFlow"), true)).toEqual([]);
    expect(linkKindsFor(element("bpmn:Task", {}, { labelTarget: { id: "t" } }), true)).toEqual([]);
  });
});

describe("elementIdOf", () => {
  it("is the shape id, and a label defers to the shape it labels", () => {
    expect(elementIdOf(element("bpmn:Task", { id: "task_1" }))).toBe("task_1");
    const label = element("bpmn:StartEvent", { id: "label" }, { labelTarget: { id: "start_1" } });
    expect(elementIdOf(label)).toBe("start_1");
    expect(elementIdOf(null)).toBe("");
  });
});

describe("singleLinkOf / withLink", () => {
  it("reads and writes each kind's own field", () => {
    const links = withLink(emptyLinks(), "application", { id: UUID, name: "SAP" });
    expect(singleLinkOf(links, "application")).toEqual({ id: UUID, name: "SAP" });
    expect(singleLinkOf(links, "process")).toBeUndefined();
    expect(singleLinkOf(withLink(links, "application", null), "application")).toBeUndefined();
  });

  it("replaces the whole organization list", () => {
    const orgs = [{ id: UUID, name: "Sales" }];
    expect(withLink(emptyLinks(), "organization", orgs).organizations).toEqual(orgs);
    expect(withLink(emptyLinks(), "organization", null).organizations).toEqual([]);
  });
});

describe("linksFromDraftElements", () => {
  it("maps every link with its resolved name", () => {
    const map = linksFromDraftElements([
      {
        bpmn_element_id: "task_1",
        application_id: "a1",
        application_name: "SAP",
        business_process_id: "p1",
        business_process_name: "Credit Check",
        organizations: [{ id: "o1", name: "Sales" }],
      },
    ]);
    expect(map.task_1.application).toEqual({ id: "a1", name: "SAP" });
    expect(map.task_1.business_process).toEqual({ id: "p1", name: "Credit Check" });
    expect(map.task_1.organizations).toEqual([{ id: "o1", name: "Sales" }]);
    expect(map.task_1.data_object).toBeUndefined();
  });

  it("lists an unlinked element too — that is how the panel knows the server has seen it", () => {
    const map = linksFromDraftElements([{ bpmn_element_id: "task_2" }]);
    expect(map).toHaveProperty("task_2");
    expect(map.task_2).toEqual(emptyLinks());
  });

  it("falls back to the id when a name did not resolve", () => {
    const map = linksFromDraftElements([
      { bpmn_element_id: "t", application_id: "a1", application_name: null },
    ]);
    expect(map.t.application).toEqual({ id: "a1", name: "a1" });
  });
});
