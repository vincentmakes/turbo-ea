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

import { BPMN_ELEMENT_COLORS } from "@/theme/tokens";

export interface ElementTypeInfo {
  icon: string;
  color: string;
}

export const ELEMENT_TYPE_ICONS: Record<string, ElementTypeInfo> = {
  task: { icon: "check_box", color: BPMN_ELEMENT_COLORS.task },
  userTask: { icon: "person", color: BPMN_ELEMENT_COLORS.task },
  serviceTask: { icon: "settings", color: BPMN_ELEMENT_COLORS.service },
  scriptTask: { icon: "code", color: BPMN_ELEMENT_COLORS.script },
  businessRuleTask: { icon: "rule", color: BPMN_ELEMENT_COLORS.rule },
  sendTask: { icon: "send", color: BPMN_ELEMENT_COLORS.messaging },
  receiveTask: { icon: "call_received", color: BPMN_ELEMENT_COLORS.messaging },
  manualTask: { icon: "back_hand", color: BPMN_ELEMENT_COLORS.manual },
  callActivity: { icon: "call_split", color: BPMN_ELEMENT_COLORS.subprocess },
  subProcess: { icon: "account_tree", color: BPMN_ELEMENT_COLORS.subprocess },
  transaction: { icon: "receipt_long", color: BPMN_ELEMENT_COLORS.subprocess },
  adHocSubProcess: { icon: "shuffle", color: BPMN_ELEMENT_COLORS.subprocess },
  exclusiveGateway: { icon: "call_split", color: BPMN_ELEMENT_COLORS.gateway },
  parallelGateway: { icon: "add", color: BPMN_ELEMENT_COLORS.gateway },
  inclusiveGateway: { icon: "radio_button_checked", color: BPMN_ELEMENT_COLORS.gateway },
  eventBasedGateway: { icon: "bolt", color: BPMN_ELEMENT_COLORS.gateway },
  complexGateway: { icon: "asterisk", color: BPMN_ELEMENT_COLORS.gateway },
  startEvent: { icon: "play_circle", color: BPMN_ELEMENT_COLORS.start },
  endEvent: { icon: "stop_circle", color: BPMN_ELEMENT_COLORS.end },
  intermediateThrowEvent: { icon: "send", color: BPMN_ELEMENT_COLORS.gateway },
  intermediateCatchEvent: { icon: "call_received", color: BPMN_ELEMENT_COLORS.gateway },
  boundaryEvent: { icon: "adjust", color: BPMN_ELEMENT_COLORS.rule },
  dataObjectReference: { icon: "description", color: BPMN_ELEMENT_COLORS.data },
  dataStoreReference: { icon: "database", color: BPMN_ELEMENT_COLORS.data },
};

export const UNKNOWN_ELEMENT_TYPE: ElementTypeInfo = { icon: "radio_button_unchecked", color: BPMN_ELEMENT_COLORS.unknown };

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
