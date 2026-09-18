/**
 * Pure helpers for a step's link to a Business Process.
 *
 * Any flow node — a task, a sub-process, an event, a gateway — can link to
 * the BusinessProcess card it hands over to. The link lives in the diagram:
 *
 * - a **call activity** stores it in `calledElement`, BPMN's own construct
 *   for "this step is another process" (what other tools read);
 * - any **other flow node** stores it in `turboea:processRef`, the Turbo EA
 *   extension attribute registered by `turboeaModdle.ts`, since BPMN has no
 *   native slot for it.
 *
 * Either way the value is the **BusinessProcess card UUID** — a BPMN process
 * id (`Process_1`) collides across diagrams and cannot be resolved, whereas a
 * card id resolves in one query. Anything else in `calledElement` is a
 * *foreign reference* left by another tool; it is shown as a hint and linked
 * through the picker.
 *
 * Mirrors `ExtractedElement.process_reference` / `as_card_uuid` in
 * `backend/app/services/bpmn_parser.py` / `process_element_sync.py`.
 */

const CARD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The extension attribute, as moddle names it once the descriptor is registered. */
export const PROCESS_REF_ATTR = "turboea:processRef";

/** True when `value` is the canonical form of a card UUID. */
export function isCardUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && CARD_UUID_RE.test(value.trim());
}

/** The bpmn-js element shape these helpers read — kept structural so the pure
 *  helpers need no bpmn-js import and stay unit-testable. */
export interface FlowNodeLike {
  /** Set on an external label; its `businessObject` is the labelled element's. */
  labelTarget?: unknown;
  businessObject?: {
    $type?: string;
    $instanceOf?: (type: string) => boolean;
    calledElement?: string;
    get?: (name: string) => unknown;
  };
}

/** @deprecated alias kept for the call-activity-only helpers below. */
export type CallActivityLike = FlowNodeLike;

export function isCallActivity(element: FlowNodeLike | null | undefined): boolean {
  return element?.businessObject?.$type === "bpmn:CallActivity";
}

/**
 * True for the shapes that can link a process: every `bpmn:FlowNode` (tasks,
 * sub-processes, events, gateways, call activities) — never a participant, a
 * lane, a sequence flow, a data artefact, and never an external label (its
 * business object is the labelled node's, so it would otherwise pass).
 */
export function isProcessStep(element: FlowNodeLike | null | undefined): boolean {
  if (!element || element.labelTarget) return false;
  const bo = element.businessObject;
  return typeof bo?.$instanceOf === "function" && bo.$instanceOf("bpmn:FlowNode");
}

function readAttr(element: FlowNodeLike | null | undefined, name: string): string {
  const bo = element?.businessObject;
  if (!bo) return "";
  const value =
    typeof bo.get === "function"
      ? bo.get(name)
      : (bo as Record<string, unknown>)[name === PROCESS_REF_ATTR ? "processRef" : name];
  return typeof value === "string" ? value.trim() : "";
}

/** The raw `calledElement` of an element (empty string when unset). */
export function calledElementOf(element: FlowNodeLike | null | undefined): string {
  return readAttr(element, "calledElement");
}

/**
 * The step's effective process reference: a call activity's `calledElement`
 * when set, else `turboea:processRef`. Empty string when there is none.
 */
export function processRefOf(element: FlowNodeLike | null | undefined): string {
  if (isCallActivity(element)) {
    const called = calledElementOf(element);
    if (called) return called;
  }
  return readAttr(element, PROCESS_REF_ATTR);
}

/**
 * The `modeling.updateProperties` payload that links `element` to `cardId`
 * (or clears the link with `null`). A call activity writes BPMN's own
 * `calledElement` and drops any `processRef` it carried — a task linked then
 * morphed into a call activity brings `processRef` along, and two references
 * on one shape would be two truths; every other flow node writes
 * `processRef`. `undefined` removes an attribute; `""` would serialise it.
 */
export function processRefProperties(
  element: FlowNodeLike | null | undefined,
  cardId: string | null,
): Record<string, string | undefined> {
  if (cardId === null) {
    return { calledElement: undefined, [PROCESS_REF_ATTR]: undefined };
  }
  if (isCallActivity(element)) {
    return { calledElement: cardId, [PROCESS_REF_ATTR]: undefined };
  }
  return { [PROCESS_REF_ATTR]: cardId };
}

/**
 * The distinct card ids the steps among `elements` reference, in first-seen
 * order — the list the modeler resolves to names after import.
 */
export function collectProcessRefIds(elements: Iterable<FlowNodeLike>): string[] {
  const seen = new Set<string>();
  for (const el of elements) {
    if (!isProcessStep(el)) continue;
    const ref = processRefOf(el);
    if (isCardUuid(ref)) seen.add(ref);
  }
  return Array.from(seen);
}

/** The in-app route a linked step drills down to: the process's Process Flow tab. */
export function calledProcessPath(cardId: string): string {
  return `/cards/${cardId}?tab=1`;
}

/**
 * The BusinessProcess type colour, as seeded (`seed.py`). The viewer's badge
 * cannot read the metamodel — it also renders inside account-less portals —
 * so the colour is mirrored here, like the Application badge's primary blue.
 */
export const CALLED_PROCESS_COLOR = "#028f00";
