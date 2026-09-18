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
  /** The shape id — for a step, the `bpmn_element_id` a link is keyed on. */
  id?: string;
  /** Set on an external label; its `businessObject` is the labelled element's. */
  labelTarget?: { id?: string } | unknown;
  businessObject?: {
    $type?: string;
    $instanceOf?: (type: string) => boolean;
    calledElement?: string;
    get?: (name: string) => unknown;
  };
}

/** The four links that live on the step row, beside the process link. */
export type CardLinkKind = "application" | "data_object" | "it_component" | "organization";
/** Every link a step can carry. */
export type LinkKind = "process" | CardLinkKind;

/** Panel row order — the order the steps table shows the columns in. */
export const LINK_KIND_ORDER: readonly LinkKind[] = [
  "process",
  "application",
  "data_object",
  "it_component",
  "organization",
];

/** The card type each kind picks from. */
export const LINK_KIND_TYPE: Record<LinkKind, string> = {
  process: "BusinessProcess",
  application: "Application",
  data_object: "DataObject",
  it_component: "ITComponent",
  organization: "Organization",
};

/** The `PUT …/draft-elements/{id}` body key each kind writes. */
export const LINK_BODY_KEY: Record<LinkKind, string> = {
  process: "business_process_id",
  application: "application_id",
  data_object: "data_object_id",
  it_component: "it_component_id",
  organization: "organization_ids",
};

/** A linked card, as much of it as a panel row renders. */
export interface LinkedCard {
  id: string;
  name: string;
}

/** Every link a step carries, as the draft-elements payload reports them. */
export interface ElementLinks {
  business_process?: LinkedCard;
  application?: LinkedCard;
  data_object?: LinkedCard;
  it_component?: LinkedCard;
  organizations: LinkedCard[];
}

export function emptyLinks(): ElementLinks {
  return { organizations: [] };
}

/** The `ElementLinks` key each single-card kind reads. */
const SINGLE_LINK_FIELD: Record<
  Exclude<LinkKind, "organization">,
  "business_process" | "application" | "data_object" | "it_component"
> = {
  process: "business_process",
  application: "application",
  data_object: "data_object",
  it_component: "it_component",
};

/** The card linked for a single-card kind (never call it for organizations). */
export function singleLinkOf(
  links: ElementLinks,
  kind: Exclude<LinkKind, "organization">,
): LinkedCard | undefined {
  return links[SINGLE_LINK_FIELD[kind]];
}

/** `links` with `kind` set to `card` (or cleared with `null`). */
export function withLink(
  links: ElementLinks,
  kind: LinkKind,
  card: LinkedCard | LinkedCard[] | null,
): ElementLinks {
  if (kind === "organization") {
    return { ...links, organizations: Array.isArray(card) ? card : [] };
  }
  return { ...links, [SINGLE_LINK_FIELD[kind]]: (card as LinkedCard | null) ?? undefined };
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

/**
 * True for a data object / data store shape. Not a `bpmn:FlowNode`, so
 * `isProcessStep` excludes it — it has no lane, no automation and no
 * supporting application, and the steps table offers it the Data Object link
 * alone. The panel follows the table.
 */
export function isDataArtefact(element: FlowNodeLike | null | undefined): boolean {
  if (!element || element.labelTarget) return false;
  const bo = element.businessObject;
  if (typeof bo?.$instanceOf !== "function") return false;
  return bo.$instanceOf("bpmn:DataObjectReference") || bo.$instanceOf("bpmn:DataStoreReference");
}

/**
 * The link kinds a shape offers, in panel order.
 *
 * `canLinkCards` is "this modeler is editing a draft": the four card links are
 * stored as draft links through the API, so without a draft there is nowhere
 * to put them and only the process link — which lives in the diagram itself —
 * is offered.
 */
export function linkKindsFor(
  element: FlowNodeLike | null | undefined,
  canLinkCards: boolean,
): LinkKind[] {
  if (isDataArtefact(element)) return canLinkCards ? ["data_object"] : [];
  if (!isProcessStep(element)) return [];
  return canLinkCards ? [...LINK_KIND_ORDER] : ["process"];
}

/**
 * The `bpmn_element_id` a link is keyed on. An external label defers to the
 * shape it labels, so dragging a label never writes a link of its own.
 */
export function elementIdOf(element: FlowNodeLike | null | undefined): string {
  if (!element) return "";
  const target = element.labelTarget as { id?: string } | undefined;
  return (target?.id ?? element.id ?? "") || "";
}

/** The shape `GET …/draft-elements` returns, as far as the links go. */
interface DraftElementRow {
  bpmn_element_id: string;
  application_id?: string | null;
  application_name?: string | null;
  data_object_id?: string | null;
  data_object_name?: string | null;
  it_component_id?: string | null;
  it_component_name?: string | null;
  business_process_id?: string | null;
  business_process_name?: string | null;
  organizations?: { id: string; name: string }[];
}

/**
 * `GET …/draft-elements` rows → the links map the panel reads.
 *
 * The server has already applied the precedence rule (the draft's own link
 * wins, the diagram's reference is the fallback), so the panel renders what
 * this returns and never re-derives it.
 */
export function linksFromDraftElements(
  rows: readonly DraftElementRow[],
): Record<string, ElementLinks> {
  const map: Record<string, ElementLinks> = {};
  for (const row of rows) {
    const links = emptyLinks();
    let any = false;
    for (const [kind, idKey, nameKey] of [
      ["business_process", "business_process_id", "business_process_name"],
      ["application", "application_id", "application_name"],
      ["data_object", "data_object_id", "data_object_name"],
      ["it_component", "it_component_id", "it_component_name"],
    ] as const) {
      const id = row[idKey];
      if (id) {
        links[kind] = { id, name: row[nameKey] || id };
        any = true;
      }
    }
    if (row.organizations?.length) {
      links.organizations = row.organizations.map((o) => ({ id: o.id, name: o.name || o.id }));
      any = true;
    }
    // An element with nothing linked is still listed: the panel must be able
    // to tell "the server knows this shape and it has no links" from "the
    // shape is not saved yet", which is what its fallback to the live
    // diagram reference turns on.
    map[row.bpmn_element_id] = any ? links : emptyLinks();
  }
  return map;
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
