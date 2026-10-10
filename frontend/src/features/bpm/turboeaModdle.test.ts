/**
 * The `turboea:processRef` BPMN extension: what makes a step's link to a
 * Business Process survive a save and a reload of the diagram.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { BpmnModdle } from "bpmn-moddle";

import { TURBO_NS, TURBOEA_MODDLE } from "./turboeaModdle";

const PROCESS_ID = "6f1c2c0e-0000-4000-8000-000000000001";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:turboea="${TURBO_NS}" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:task id="T" name="Hand over" turboea:processRef="${PROCESS_ID}" />
  </bpmn:process>
</bpmn:definitions>`;

afterEach(() => {
  vi.resetModules();
});

describe("turboeaModdle", () => {
  it("names the namespace the backend parser looks for", async () => {
    // Read from a fresh load: the constant is built while the file loads.
    vi.resetModules();
    const fresh = await import("./turboeaModdle");
    expect(fresh.TURBO_NS).toBe("http://turbo-ea.io/schema/bpmn/1.0");
    expect(fresh.TURBOEA_MODDLE.uri).toBe(fresh.TURBO_NS);
    expect(fresh.TURBOEA_MODDLE.prefix).toBe("turboea");
  });

  it("reads processRef off a flow node and writes it back", async () => {
    // The registration the modeler passes as `moddleExtensions`, on a copy:
    // moddle annotates the descriptor it is given in place.
    const moddle = BpmnModdle({ turboea: structuredClone(TURBOEA_MODDLE) as never });
    const { rootElement, warnings } = await moddle.fromXML(XML);
    expect(warnings).toEqual([]);
    const task = rootElement.rootElements[0].flowElements[0];
    expect(task.get("turboea:processRef")).toBe(PROCESS_ID);

    task.set("turboea:processRef", "other-id");
    const { xml } = await moddle.toXML(rootElement);
    expect(xml).toContain(`xmlns:turboea="${TURBO_NS}"`);
    expect(xml).toContain('turboea:processRef="other-id"');
  });

  it("is an attribute every flow node may carry, and nothing else", () => {
    expect(TURBOEA_MODDLE.types).toEqual([
      {
        name: "TurboEAFlowNode",
        isAbstract: true,
        extends: ["bpmn:FlowNode"],
        properties: [{ name: "processRef", isAttr: true, type: "String" }],
      },
    ]);
  });
});
