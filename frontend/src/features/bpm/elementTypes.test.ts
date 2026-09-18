import { describe, it, expect } from "vitest";

import {
  ARTEFACT_TYPES,
  ELEMENT_TYPE_ICONS,
  EVENT_DEFINITION_ICONS,
  UNKNOWN_ELEMENT_TYPE,
  elementTypeInfo,
  elementTypeLabelKey,
  eventDefinitionLabelKey,
  isArtefactType,
} from "./elementTypes";
import en from "@/i18n/locales/en/bpm.json";

// Mirrors EXTRACTABLE_TYPES in backend/app/services/bpmn_parser.py — every
// string the parser can emit must have an icon and an English label.
const PARSER_TYPES = [
  "task",
  "userTask",
  "serviceTask",
  "scriptTask",
  "businessRuleTask",
  "sendTask",
  "receiveTask",
  "manualTask",
  "callActivity",
  "subProcess",
  "transaction",
  "adHocSubProcess",
  "exclusiveGateway",
  "parallelGateway",
  "inclusiveGateway",
  "eventBasedGateway",
  "complexGateway",
  "startEvent",
  "endEvent",
  "intermediateCatchEvent",
  "intermediateThrowEvent",
  "boundaryEvent",
  "dataObjectReference",
  "dataStoreReference",
];

// The `*EventDefinition` tags bpmn-moddle knows, minus the suffix.
const PARSER_DEFINITIONS = [
  "message",
  "timer",
  "signal",
  "error",
  "escalation",
  "conditional",
  "link",
  "compensate",
  "cancel",
  "terminate",
];

describe("element type vocabulary", () => {
  it("has an icon for every type the parser emits", () => {
    for (const type of PARSER_TYPES) {
      expect(ELEMENT_TYPE_ICONS[type], type).toBeDefined();
    }
  });

  it("has an English label for every type and definition", () => {
    const keys = en as Record<string, string>;
    for (const type of PARSER_TYPES) {
      expect(keys[elementTypeLabelKey(type)], type).toBeTruthy();
    }
    for (const def of PARSER_DEFINITIONS) {
      expect(keys[eventDefinitionLabelKey(def)], def).toBeTruthy();
      expect(EVENT_DEFINITION_ICONS[def], def).toBeTruthy();
    }
  });

  it("falls back to a neutral glyph for a type it does not know", () => {
    expect(elementTypeInfo("somethingNew")).toBe(UNKNOWN_ELEMENT_TYPE);
    expect(elementTypeInfo("userTask")).toBe(ELEMENT_TYPE_ICONS.userTask);
  });

  it("treats data objects and data stores — and nothing else — as artefacts", () => {
    expect([...ARTEFACT_TYPES].sort()).toEqual(["dataObjectReference", "dataStoreReference"]);
    expect(isArtefactType("dataObjectReference")).toBe(true);
    expect(isArtefactType("task")).toBe(false);
  });
});
