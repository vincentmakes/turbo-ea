/**
 * Turbo EA's BPMN moddle extension.
 *
 * BPMN has a native slot for "this step is another process" — a call
 * activity's `calledElement` — but none for "this task belongs to / hands over
 * to that process". `turboea:processRef` is that slot: an attribute any
 * `bpmn:FlowNode` (every task, sub-process, event and gateway) may carry,
 * holding the BusinessProcess card UUID the step links to.
 *
 * Registered through `Modeler`'s `moddleExtensions`, which is what makes the
 * attribute round-trip: `businessObject.get("turboea:processRef")` and
 * `modeling.updateProperties(el, { "turboea:processRef": id })` are typed
 * (undoable; `undefined` deletes), `saveXML` emits `xmlns:turboea` on
 * `<definitions>` by itself, and `importXML` reads it back. Without the
 * descriptor bpmn-js keeps the attribute only if the file already declared the
 * namespace, and drops it with a console warning otherwise.
 *
 * `uri` must equal `TURBO_NS` in `backend/app/services/bpmn_parser.py` —
 * that is how the parser finds the attribute — and a backend test pins it.
 * A single `extends: ["bpmn:FlowNode"]` covers every step type; data objects
 * and participants are not flow nodes, which is exactly the population the
 * steps table links.
 */
export const TURBO_NS = "http://turbo-ea.io/schema/bpmn/1.0";

export const TURBOEA_MODDLE = {
  name: "TurboEA",
  uri: TURBO_NS,
  prefix: "turboea",
  xml: { tagAlias: "lowerCase" },
  associations: [],
  enumerations: [],
  types: [
    {
      name: "TurboEAFlowNode",
      isAbstract: true,
      extends: ["bpmn:FlowNode"],
      properties: [{ name: "processRef", isAttr: true, type: "String" }],
    },
  ],
} as const;
