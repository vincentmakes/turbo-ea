/**
 * The BPMN element-type vocabulary the app renders.
 *
 * `element_type` and `event_definition_type` are the parser's strings
 * (`backend/app/services/bpmn_parser.py` — `EXTRACTABLE_TYPES` and the
 * `*EventDefinition` suffix strip). Every consumer that shows a type — the
 * elements table, the navigator, the viewer popover, the element linker, the
 * element × application report — reads its icon and label from here, so a
 * type the backend starts producing is added in exactly one place.
 */

export interface ElementTypeInfo {
  icon: string;
  color: string;
}

export const ELEMENT_TYPE_ICONS: Record<string, ElementTypeInfo> = {
  task: { icon: "check_box", color: "#1976d2" },
  userTask: { icon: "person", color: "#1976d2" },
  serviceTask: { icon: "settings", color: "#7b1fa2" },
  scriptTask: { icon: "code", color: "#00695c" },
  businessRuleTask: { icon: "rule", color: "#e65100" },
  sendTask: { icon: "send", color: "#0097a7" },
  receiveTask: { icon: "call_received", color: "#0097a7" },
  manualTask: { icon: "back_hand", color: "#795548" },
  callActivity: { icon: "call_split", color: "#512da8" },
  subProcess: { icon: "account_tree", color: "#512da8" },
  transaction: { icon: "receipt_long", color: "#512da8" },
  adHocSubProcess: { icon: "shuffle", color: "#512da8" },
  exclusiveGateway: { icon: "call_split", color: "#f57c00" },
  parallelGateway: { icon: "add", color: "#f57c00" },
  inclusiveGateway: { icon: "radio_button_checked", color: "#f57c00" },
  eventBasedGateway: { icon: "bolt", color: "#f57c00" },
  complexGateway: { icon: "asterisk", color: "#f57c00" },
  startEvent: { icon: "play_circle", color: "#2e7d32" },
  endEvent: { icon: "stop_circle", color: "#c62828" },
  intermediateThrowEvent: { icon: "send", color: "#f57c00" },
  intermediateCatchEvent: { icon: "call_received", color: "#f57c00" },
  boundaryEvent: { icon: "adjust", color: "#e65100" },
  dataObjectReference: { icon: "description", color: "#774fcc" },
  dataStoreReference: { icon: "database", color: "#774fcc" },
};

export const UNKNOWN_ELEMENT_TYPE: ElementTypeInfo = { icon: "radio_button_unchecked", color: "#999" };

/** The glyph bpmn-js draws inside an event for each definition sub-type. */
export const EVENT_DEFINITION_ICONS: Record<string, string> = {
  message: "mail",
  timer: "schedule",
  signal: "sensors",
  error: "error",
  escalation: "priority_high",
  conditional: "rule",
  link: "link",
  compensate: "undo",
  cancel: "cancel",
  terminate: "stop",
};

/**
 * Data artefacts are extracted so they can be linked to a DataObject card,
 * but they are not steps: no lane, no automation, no Application / IT
 * Component / TCode / Organization cells. Mirrors `ARTEFACT_TYPES` on the
 * backend.
 */
export const ARTEFACT_TYPES = new Set(["dataObjectReference", "dataStoreReference"]);

export function isArtefactType(elementType: string): boolean {
  return ARTEFACT_TYPES.has(elementType);
}

export function elementTypeInfo(elementType: string): ElementTypeInfo {
  return ELEMENT_TYPE_ICONS[elementType] ?? UNKNOWN_ELEMENT_TYPE;
}

/** The `bpm` namespace key holding the translated label of an element type. */
export function elementTypeLabelKey(elementType: string): string {
  return `elementTypes.${elementType}`;
}

/** The `bpm` namespace key holding the translated label of an event definition. */
export function eventDefinitionLabelKey(definitionType: string): string {
  return `eventDefinitions.${definitionType}`;
}
