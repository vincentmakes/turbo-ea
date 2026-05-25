/**
 * ArchiMate 3.2 derivation rules: which relation types are valid between which element types.
 * Based on the ArchiMate 3.2 specification, Table B-2 (Derivation Rules).
 *
 * Two categories:
 * - Universal relations (Association, Specialization): allowed between any element pair
 * - Constrained relations: only allowed between specific source/target element types,
 *   encoded as allowedPairs (with "*" as wildcard)
 */

export type ArchiMateAspect = "ActiveStructure" | "Behavior" | "PassiveStructure" | "Other";

export interface RelationPair {
  sourceKey: string;
  targetKey: string;
}

export type RelationRule =
  | { allowAll: true; allowedPairs?: never }
  | { allowAll: false; allowedPairs: RelationPair[] };

export interface AspectCompatibility {
  canAssignTo: ArchiMateAspect[];
  canServe: ArchiMateAspect[];
  canCompose: ArchiMateAspect[];
  canAggregate: ArchiMateAspect[];
  canRealize: ArchiMateAspect[];
  canAccess: ArchiMateAspect[];
  canInfluence: ArchiMateAspect[];
  canTrigger: ArchiMateAspect[];
  canFlow: ArchiMateAspect[];
}

// Active Structure elements (structural — perform behavior)
const ACTIVE_STRUCTURE = [
  // Business
  "arch_BusinessActor", "arch_BusinessRole", "arch_BusinessCollaboration", "arch_BusinessInterface",
  // Application
  "arch_ApplicationComponent", "arch_ApplicationCollaboration", "arch_ApplicationInterface",
  // Technology
  "arch_Node", "arch_Device", "arch_SystemSoftware", "arch_TechnologyCollaboration",
  "arch_TechnologyInterface", "arch_Path", "arch_CommunicationNetwork",
  // Physical
  "arch_Equipment", "arch_Facility", "arch_DistributionNetwork",
  // Strategy
  "arch_Resource",
  // Composite
  "arch_Grouping", "arch_Location",
];

// Behavior elements (actions performed by active structure)
const BEHAVIOR = [
  // Business
  "arch_BusinessProcess", "arch_BusinessFunction", "arch_BusinessInteraction",
  "arch_BusinessEvent", "arch_BusinessService",
  // Application
  "arch_ApplicationProcess", "arch_ApplicationFunction", "arch_ApplicationInteraction",
  "arch_ApplicationEvent", "arch_ApplicationService",
  // Technology
  "arch_TechnologyProcess", "arch_TechnologyFunction", "arch_TechnologyInteraction",
  "arch_TechnologyEvent", "arch_TechnologyService", "arch_Artifact",
  // Physical
  "arch_Material",
  // Strategy
  "arch_Capability", "arch_ValueStream", "arch_CourseOfAction",
  // Implementation
  "arch_WorkPackage", "arch_ImplementationEvent", "arch_Deliverable", "arch_Gap", "arch_Plateau",
  // Composite
  "arch_Junction",
];

// Passive Structure elements (objects acted upon)
const PASSIVE_STRUCTURE = [
  "arch_BusinessObject", "arch_Contract", "arch_Representation", "arch_Product",
  "arch_DataObject",
];

// Motivation elements
const MOTIVATION = [
  "arch_Stakeholder", "arch_Driver", "arch_Assessment", "arch_Goal", "arch_Outcome",
  "arch_Principle", "arch_Requirement", "arch_Constraint", "arch_Meaning", "arch_Value",
];

// All element keys for wildcard use
const ALL_ELEMENTS = [...ACTIVE_STRUCTURE, ...BEHAVIOR, ...PASSIVE_STRUCTURE, ...MOTIVATION];

// Helper: generate all pairs where source is from srcList, target is from tgtList
function pairs(srcList: string[], tgtList: string[]): RelationPair[] {
  const result: RelationPair[] = [];
  for (const src of srcList) {
    for (const tgt of tgtList) {
      result.push({ sourceKey: src, targetKey: tgt });
    }
  }
  return result;
}

// Helper: generate all pairs within a list (including self)
function selfPairs(list: string[]): RelationPair[] {
  return pairs(list, list);
}

export const ARCHIMATE_RELATION_RULES: Record<string, RelationRule> = {
  // Universal: any element can be associated with any other element
  arch_rel_Association: { allowAll: true },

  // Universal: any element can specialize any element of the same type
  arch_rel_Specialization: { allowAll: true },

  // Composition: whole-part structural composition (same aspect or Grouping/Location)
  arch_rel_Composition: {
    allowAll: false,
    allowedPairs: [
      ...selfPairs(ACTIVE_STRUCTURE),
      ...selfPairs(BEHAVIOR),
      ...selfPairs(PASSIVE_STRUCTURE),
      ...selfPairs(MOTIVATION),
      // Grouping/Location can compose anything
      ...pairs(["arch_Grouping", "arch_Location"], ALL_ELEMENTS),
      ...pairs(ALL_ELEMENTS, ["arch_Grouping", "arch_Location"]),
    ],
  },

  // Aggregation: weak whole-part (same rules as Composition)
  arch_rel_Aggregation: {
    allowAll: false,
    allowedPairs: [
      ...selfPairs(ACTIVE_STRUCTURE),
      ...selfPairs(BEHAVIOR),
      ...selfPairs(PASSIVE_STRUCTURE),
      ...selfPairs(MOTIVATION),
      ...pairs(["arch_Grouping", "arch_Location"], ALL_ELEMENTS),
      ...pairs(ALL_ELEMENTS, ["arch_Grouping", "arch_Location"]),
    ],
  },

  // Realization: behavior/structure realizes services or passive structure
  arch_rel_Realization: {
    allowAll: false,
    allowedPairs: [
      // Behavior realizes services (within and cross-layer)
      ...pairs(BEHAVIOR, BEHAVIOR),
      // Active structure realizes behavior (e.g. ApplicationComponent realizes ApplicationService)
      ...pairs(ACTIVE_STRUCTURE, BEHAVIOR),
      // Active structure realizes passive structure
      ...pairs(ACTIVE_STRUCTURE, PASSIVE_STRUCTURE),
      // Behavior realizes passive structure (e.g. Process realizes BusinessObject)
      ...pairs(BEHAVIOR, PASSIVE_STRUCTURE),
      // Motivation elements realized by behavior/structure
      ...pairs(BEHAVIOR, MOTIVATION),
      ...pairs(ACTIVE_STRUCTURE, MOTIVATION),
      ...pairs(PASSIVE_STRUCTURE, MOTIVATION),
    ],
  },

  // Assignment: active structure assigned to behavior it performs
  arch_rel_Assignment: {
    allowAll: false,
    allowedPairs: [
      // Active structure assigned to behavior
      ...pairs(ACTIVE_STRUCTURE, BEHAVIOR),
      // Active structure assigned to active structure (e.g. BusinessRole→BusinessActor)
      ...pairs(ACTIVE_STRUCTURE, ACTIVE_STRUCTURE),
    ],
  },

  // Serving: one element provides services to another (cross-layer or same layer)
  arch_rel_Serving: {
    allowAll: false,
    allowedPairs: [
      // Behavior serves behavior
      ...pairs(BEHAVIOR, BEHAVIOR),
      // Behavior serves active structure
      ...pairs(BEHAVIOR, ACTIVE_STRUCTURE),
      // Behavior serves passive structure
      ...pairs(BEHAVIOR, PASSIVE_STRUCTURE),
      // Active structure serves active structure
      ...pairs(ACTIVE_STRUCTURE, ACTIVE_STRUCTURE),
      // Serving across layers (Application → Business, Technology → Application)
      ...pairs(ACTIVE_STRUCTURE, BEHAVIOR),
    ],
  },

  // Access: behavior reads/writes passive structure
  arch_rel_Access: {
    allowAll: false,
    allowedPairs: [
      ...pairs(BEHAVIOR, PASSIVE_STRUCTURE),
      // Active structure can also directly access passive structure
      ...pairs(ACTIVE_STRUCTURE, PASSIVE_STRUCTURE),
    ],
  },

  // Influence: element influences another (primarily motivation, but also behavior)
  arch_rel_Influence: {
    allowAll: false,
    allowedPairs: [
      ...selfPairs(MOTIVATION),
      ...pairs(MOTIVATION, BEHAVIOR),
      ...pairs(MOTIVATION, PASSIVE_STRUCTURE),
      ...pairs(MOTIVATION, ACTIVE_STRUCTURE),
      ...pairs(BEHAVIOR, MOTIVATION),
      ...pairs(ACTIVE_STRUCTURE, MOTIVATION),
      ...pairs(PASSIVE_STRUCTURE, MOTIVATION),
    ],
  },

  // Triggering: causal relationship between behavior elements
  arch_rel_Triggering: {
    allowAll: false,
    allowedPairs: [
      ...selfPairs(BEHAVIOR),
      // Events trigger behavior
      ...pairs(ACTIVE_STRUCTURE, BEHAVIOR),
    ],
  },

  // Flow: information/data/material flow between behavior or passive elements
  arch_rel_Flow: {
    allowAll: false,
    allowedPairs: [
      ...selfPairs(BEHAVIOR),
      ...selfPairs(PASSIVE_STRUCTURE),
      ...pairs(BEHAVIOR, PASSIVE_STRUCTURE),
      ...pairs(PASSIVE_STRUCTURE, BEHAVIOR),
      ...pairs(ACTIVE_STRUCTURE, BEHAVIOR),
      ...pairs(BEHAVIOR, ACTIVE_STRUCTURE),
    ],
  },
};

// Aspect-level compatibility matrix (ArchiMate spec Table B-2 summary)
export const ARCHIMATE_ASPECT_COMPATIBILITY: Record<ArchiMateAspect, AspectCompatibility> = {
  ActiveStructure: {
    canAssignTo: ["Behavior", "ActiveStructure"],
    canServe: ["ActiveStructure", "Behavior"],
    canCompose: ["ActiveStructure"],
    canAggregate: ["ActiveStructure"],
    canRealize: ["PassiveStructure"],
    canAccess: ["PassiveStructure"],
    canInfluence: ["Other"],
    canTrigger: [],
    canFlow: [],
  },
  Behavior: {
    canAssignTo: [],
    canServe: ["Behavior", "ActiveStructure"],
    canCompose: ["Behavior"],
    canAggregate: ["Behavior"],
    canRealize: ["Behavior", "PassiveStructure"],
    canAccess: ["PassiveStructure"],
    canInfluence: ["Other"],
    canTrigger: ["Behavior"],
    canFlow: ["Behavior", "PassiveStructure"],
  },
  PassiveStructure: {
    canAssignTo: [],
    canServe: [],
    canCompose: ["PassiveStructure"],
    canAggregate: ["PassiveStructure"],
    canRealize: ["Other"],
    canAccess: [],
    canInfluence: ["Other"],
    canTrigger: [],
    canFlow: ["Behavior"],
  },
  Other: {
    canAssignTo: [],
    canServe: [],
    canCompose: ["Other"],
    canAggregate: ["Other"],
    canRealize: [],
    canAccess: [],
    canInfluence: ["Other"],
    canTrigger: [],
    canFlow: [],
  },
};

/**
 * Returns valid relation type keys for a given source and target element type.
 * Used by the frontend to restrict which connections are drawable between nodes.
 */
export function getValidRelations(sourceKey: string, targetKey: string): string[] {
  return Object.entries(ARCHIMATE_RELATION_RULES)
    .filter(([, rule]) => {
      if (rule.allowAll) return true;
      return rule.allowedPairs.some(
        (p) =>
          (p.sourceKey === "*" || p.sourceKey === sourceKey) &&
          (p.targetKey === "*" || p.targetKey === targetKey),
      );
    })
    .map(([key]) => key);
}
