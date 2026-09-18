/**
 * Pure helpers for the call activity → Business Process link.
 *
 * BPMN has exactly one construct for "this step is another process": the
 * **call activity**, whose `calledElement` names a process defined on its own.
 * Turbo EA stores the **BusinessProcess card UUID** there when a process is
 * picked in the modeler — a BPMN process id (`Process_1`) collides across
 * diagrams and cannot be resolved, whereas a card id resolves in one query.
 * Anything else in `calledElement` is a *foreign reference* left by another
 * tool; it is shown as a hint and linked through the picker.
 *
 * Mirrors `as_card_uuid` in `backend/app/services/process_element_sync.py`.
 */

const CARD_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is the canonical form of a card UUID. */
export function isCardUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && CARD_UUID_RE.test(value.trim());
}

/** The bpmn-js element shape these helpers read — kept structural so the pure
 *  helpers need no bpmn-js import and stay unit-testable. */
export interface CallActivityLike {
  businessObject?: {
    $type?: string;
    calledElement?: string;
    get?: (name: string) => unknown;
  };
}

export function isCallActivity(element: CallActivityLike | null | undefined): boolean {
  return element?.businessObject?.$type === "bpmn:CallActivity";
}

/** The raw `calledElement` of an element (empty string when unset). */
export function calledElementOf(element: CallActivityLike | null | undefined): string {
  const bo = element?.businessObject;
  if (!bo) return "";
  const value = typeof bo.get === "function" ? bo.get("calledElement") : bo.calledElement;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The distinct card ids referenced by the call activities among `elements`,
 * in first-seen order — the list the modeler resolves to names after import.
 */
export function collectCalledElementIds(elements: Iterable<CallActivityLike>): string[] {
  const seen = new Set<string>();
  for (const el of elements) {
    if (!isCallActivity(el)) continue;
    const ref = calledElementOf(el);
    if (isCardUuid(ref)) seen.add(ref);
  }
  return Array.from(seen);
}

/** The in-app route a call activity drills down to: the callee's Process Flow tab. */
export function calledProcessPath(cardId: string): string {
  return `/cards/${cardId}?tab=1`;
}

/**
 * The BusinessProcess type colour, as seeded (`seed.py`). The viewer's badge
 * cannot read the metamodel — it also renders inside account-less portals —
 * so the colour is mirrored here, like the Application badge's primary blue.
 */
export const CALLED_PROCESS_COLOR = "#028f00";
