/**
 * The Process Navigator's state, as plain functions: the process tree built
 * from the map payload, the organisation filter and zoom over it, the opening
 * state read from the URL and the stored preferences, the URL the state writes
 * back, the Process House rows, card and row reordering, the search match, and
 * the small lookups the drawer and the matrix/dependency views make.
 *
 * `ProcessNavigator.tsx` renders; this decides. Nothing here touches React,
 * the router or the API, so each rule is unit-tested on its own
 * (`processNavigatorState.test.ts`) and the component tests stay the
 * integration contract.
 */
import { DEFAULT_COLUMNS, isColumnCount, type ColumnCount } from "@/components/cardColumns";
import type { NavigatorCapabilities } from "./ProcessNavigatorContext";
import type { ProcessTypeOption } from "./useProcessTypeOptions";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AppData {
  id: string;
  name: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  rel_attributes?: Record<string, unknown>;
}

export interface DataObjRef {
  id: string;
  name: string;
}

export interface ProcItem {
  id: string;
  name: string;
  subtype?: string;
  parent_id: string | null;
  /** Carried by the public process map, so a portal drawer needs no card fetch. */
  description?: string;
  attributes?: Record<string, unknown>;
  lifecycle?: Record<string, string>;
  app_count: number;
  total_cost: number;
  apps: AppData[];
  data_objects: DataObjRef[];
  org_ids: string[];
  ctx_ids: string[];
  has_diagram?: boolean;
  element_count?: number;
}

export interface RefItem {
  id: string;
  name: string;
}

export interface ProcNode extends ProcItem {
  children: ProcNode[];
  level: number;
  deepAppCount: number;
  deepUniqueApps: Map<string, AppData>;
  deepDataObjects: Map<string, DataObjRef>;
}

export type ColorOverlay = "processType" | "maturity" | "automationLevel" | "riskLevel";
export type ViewMode = "house" | "matrix" | "dependencies";

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

/**
 * Legend and card colours for the three fixed overlays. Their keys MUST match
 * the seeded option keys (issue #762, pinned by the component test).
 * processType is deliberately absent: its labels and colours are
 * admin-editable metamodel data, resolved via useProcessTypeOptions (#857).
 */
export const ATTR_COLORS: Record<string, Record<string, { label: string; color: string }>> = {
  maturity: {
    initial: { label: "1-Initial", color: "#d32f2f" },
    managed: { label: "2-Managed", color: "#f57c00" },
    defined: { label: "3-Defined", color: "#fbc02d" },
    measured: { label: "4-Measured", color: "#66bb6a" },
    optimized: { label: "5-Optimized", color: "#2e7d32" },
  },
  automationLevel: {
    manual: { label: "Manual", color: "#d32f2f" },
    partiallyAutomated: { label: "Partial", color: "#f57c00" },
    fullyAutomated: { label: "Fully Auto", color: "#2e7d32" },
  },
  riskLevel: {
    low: { label: "Low", color: "#66bb6a" },
    medium: { label: "Medium", color: "#fbc02d" },
    high: { label: "High", color: "#f57c00" },
    critical: { label: "Critical", color: "#d32f2f" },
  },
};

/** The colour of a card with no value for the overlay, or one no option knows. */
export const UNSET_COLOR = "#bdbdbd";

/** A card's colour under the chosen overlay. */
export function getCardColor(
  node: Pick<ProcItem, "attributes">,
  overlay: ColorOverlay,
  resolveProcessType: (key: string | null | undefined) => ProcessTypeOption,
): string {
  const val = node.attributes?.[overlay] as string | undefined;
  if (!val) return UNSET_COLOR;
  if (overlay === "processType") return resolveProcessType(val).color;
  return ATTR_COLORS[overlay]?.[val]?.color ?? UNSET_COLOR;
}

/* ------------------------------------------------------------------ */
/*  Tree                                                               */
/* ------------------------------------------------------------------ */

/**
 * Sibling order: the admin-set `sortOrder` first (unset sorts last), then the
 * name. The house, the drawer and a drag-reorder all order siblings this way.
 */
export function compareBySortOrder(
  a: Pick<ProcItem, "name" | "attributes">,
  b: Pick<ProcItem, "name" | "attributes">,
): number {
  const oa = (a.attributes?.sortOrder as number) ?? 999;
  const ob = (b.attributes?.sortOrder as number) ?? 999;
  if (oa !== ob) return oa - ob;
  return a.name.localeCompare(b.name);
}

/**
 * Nest the flat map payload into a tree: a process whose parent is not in the
 * payload is a root; each level is sorted; levels are 1-based; every node
 * carries the applications and data objects of its whole subtree, deduplicated.
 */
export function buildTree(items: ProcItem[]): ProcNode[] {
  const nodeMap = new Map<string, ProcNode>();
  for (const item of items) {
    nodeMap.set(item.id, {
      ...item,
      children: [],
      level: 0,
      deepAppCount: 0,
      deepUniqueApps: new Map(),
      deepDataObjects: new Map(),
    });
  }

  const roots: ProcNode[] = [];
  for (const node of nodeMap.values()) {
    const parent = node.parent_id ? nodeMap.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  function setLevel(nodes: ProcNode[], lvl: number) {
    for (const n of nodes) {
      n.level = lvl;
      n.children.sort(compareBySortOrder);
      setLevel(n.children, lvl + 1);
    }
  }
  roots.sort(compareBySortOrder);
  setLevel(roots, 1);

  function propagate(n: ProcNode) {
    for (const a of n.apps) n.deepUniqueApps.set(a.id, a);
    for (const d of n.data_objects) n.deepDataObjects.set(d.id, d);
    for (const ch of n.children) {
      propagate(ch);
      for (const [id, a] of ch.deepUniqueApps) n.deepUniqueApps.set(id, a);
      for (const [id, d] of ch.deepDataObjects) n.deepDataObjects.set(id, d);
    }
    n.deepAppCount = n.deepUniqueApps.size;
  }
  for (const r of roots) propagate(r);

  return roots;
}

/** Every node, depth first, parents before their children. */
export function flatCollect(nodes: ProcNode[]): ProcNode[] {
  return nodes.flatMap((n) => [n, ...flatCollect(n.children)]);
}

/** The deepest level in the tree; 0 for an empty one. */
export function getMaxLevel(nodes: ProcNode[]): number {
  return flatCollect(nodes).reduce((mx, n) => Math.max(mx, n.level), 0);
}

/** The node with this id anywhere in the tree. */
export function findNode(nodes: ProcNode[], id: string): ProcNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** The path from a root down to the node with this id, both ends included; [] when absent. */
export function getAncestors(nodes: ProcNode[], id: string): ProcNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const below = getAncestors(n.children, id);
    if (below.length > 0) return [n, ...below];
  }
  return [];
}

/**
 * Keep the processes linked to one of the organisations, with their
 * ancestors: a process stays when it or any descendant is linked. No
 * organisation selected keeps the tree as it is.
 */
export function filterTreeByOrgs(tree: ProcNode[], orgIds: ReadonlySet<string>): ProcNode[] {
  if (orgIds.size === 0) return tree;
  const matches = (n: ProcNode): boolean =>
    n.org_ids.some((oid) => orgIds.has(oid)) || n.children.some(matches);
  const keep = (nodes: ProcNode[]): ProcNode[] =>
    nodes.filter(matches).map((n) => ({ ...n, children: keep(n.children) }));
  return keep(tree);
}

/**
 * Zoom into one process: the house shows its children (or the process itself
 * when it has none) under a breadcrumb trail of its ancestors. No zoom, or a
 * zoom onto a process the tree no longer has, shows the whole tree.
 */
export function zoomInto(
  tree: ProcNode[],
  zoomId: string | null,
): { displayTree: ProcNode[]; breadcrumbs: ProcNode[] } {
  const zoomNode = zoomId ? findNode(tree, zoomId) : null;
  if (!zoomNode) return { displayTree: tree, breadcrumbs: [] };
  return {
    displayTree: zoomNode.children.length > 0 ? zoomNode.children : [zoomNode],
    breadcrumbs: getAncestors(tree, zoomNode.id),
  };
}

/* ------------------------------------------------------------------ */
/*  Opening state, URL and stored preferences                         */
/* ------------------------------------------------------------------ */

export const STORAGE_KEY = "turboea-report:process-navigator";

export const DEFAULT_LEVEL = 2;

/**
 * The preferences the navigator opens with when the URL carries none. A
 * portal visitor gets the opening state its administrator configured and
 * nothing is remembered; anyone else gets what they last left, from storage.
 *
 * The capability's `level` is mapped onto the stored key `displayLevel`:
 * passed through unchanged it would silently be ignored. `storage` is a
 * getter so that reaching `localStorage` at all, which throws where site
 * data is blocked, happens inside the guard.
 */
export function loadOpeningConfig(
  caps: Pick<NavigatorCapabilities, "persistPreferences" | "initial">,
  storage: () => Pick<Storage, "getItem"> = () => localStorage,
): Record<string, unknown> | null {
  if (!caps.persistPreferences) {
    const init = caps.initial;
    if (!init) return null;
    return { displayLevel: init.level, overlay: init.overlay, columns: init.columns };
  }
  try {
    const raw = storage().getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* unreadable storage or a corrupt entry: open with the defaults */
  }
  return null;
}

export interface NavigatorState {
  viewMode: ViewMode;
  search: string;
  displayLevel: number;
  overlay: ColorOverlay;
  columns: ColumnCount;
  zoomNodeId: string | null;
  openId: string | null;
}

/**
 * The state the navigator opens in. Any URL parameter means the URL is the
 * whole truth (a shared link opens exactly as it was copied); only a bare URL
 * falls back to the stored preferences, then to the defaults.
 */
export function readOpeningState(
  params: URLSearchParams,
  stored: Record<string, unknown> | null,
): NavigatorState {
  const fallback = params.toString().length > 0 ? null : stored;
  const level =
    params.get("level") ||
    (fallback?.displayLevel != null ? String(fallback.displayLevel) : String(DEFAULT_LEVEL));
  const columns = Number(params.get("cols") ?? fallback?.columns);
  return {
    viewMode: ((params.get("view") || fallback?.viewMode) as ViewMode) || "house",
    search: params.get("search") || "",
    displayLevel: parseInt(level, 10),
    overlay: ((params.get("overlay") || fallback?.overlay) as ColorOverlay) || "processType",
    columns: isColumnCount(columns) ? columns : DEFAULT_COLUMNS,
    zoomNodeId: params.get("zoom") || null,
    openId: params.get("open") || null,
  };
}

/** The URL parameters for a state: only what differs from the defaults. */
export function stateToParams(state: NavigatorState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.viewMode !== "house") params.view = state.viewMode;
  if (state.search) params.search = state.search;
  if (state.displayLevel !== DEFAULT_LEVEL) params.level = String(state.displayLevel);
  if (state.overlay !== "processType") params.overlay = state.overlay;
  if (state.columns !== DEFAULT_COLUMNS) params.cols = String(state.columns);
  if (state.zoomNodeId) params.zoom = state.zoomNodeId;
  if (state.openId) params.open = state.openId;
  return params;
}

/* ------------------------------------------------------------------ */
/*  Process House rows                                                 */
/* ------------------------------------------------------------------ */

/** A process's row: its process type, or the default type when it has none. */
export function rowKeyOf(item: Pick<ProcItem, "attributes">, defaultKey: string): string {
  return (item.attributes?.processType as string) || defaultKey;
}

/**
 * The house's rows, one per process-type option (empty ones included), plus a
 * row of its own for each type a process carries that no option knows, so an
 * unknown or hidden type is never folded into the default row.
 */
export function groupHouseRows(
  displayTree: ProcNode[],
  optionKeys: string[],
  defaultKey: string,
): Record<string, ProcNode[]> {
  const rows: Record<string, ProcNode[]> = Object.fromEntries(optionKeys.map((k) => [k, []]));
  for (const node of displayTree) {
    const key = rowKeyOf(node, defaultKey);
    (rows[key] ??= []).push(node);
  }
  return rows;
}

/**
 * The order the rows render in: the persisted order first (keys with no row
 * dropped), then any option or data-derived row it does not cover yet, in
 * metamodel order.
 */
export function orderRows(rowOrder: string[], optionKeys: string[], rowKeys: string[]): string[] {
  const known = new Set(rowKeys);
  return [...new Set([...rowOrder, ...optionKeys, ...rowKeys])].filter((k) => known.has(k));
}

/* ------------------------------------------------------------------ */
/*  Reordering                                                         */
/* ------------------------------------------------------------------ */

/**
 * The siblings of a drag in their new order, or null when the drop changes
 * nothing. `rowType` is a process-type row key for a top-level card, or the
 * parent's id for a card nested in a container.
 */
export function reorderSiblings(
  items: ProcItem[],
  dragId: string,
  dropId: string,
  rowType: string,
  isProcessRow: boolean,
  defaultKey: string,
): ProcItem[] | null {
  if (dragId === dropId) return null;
  const siblings = items
    .filter((d) =>
      isProcessRow ? !d.parent_id && rowKeyOf(d, defaultKey) === rowType : d.parent_id === rowType,
    )
    .sort(compareBySortOrder);
  const fromIdx = siblings.findIndex((s) => s.id === dragId);
  const toIdx = siblings.findIndex((s) => s.id === dropId);
  if (fromIdx < 0 || toIdx < 0) return null;
  const [moved] = siblings.splice(fromIdx, 1);
  siblings.splice(toIdx, 0, moved);
  return siblings;
}

/** The row order with one row moved a step up or down, or null at either end. */
export function moveRow(
  order: string[],
  rowType: string,
  direction: "up" | "down",
): string[] | null {
  const idx = order.indexOf(rowType);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= order.length) return null;
  const next = [...order];
  [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
  return next;
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

/** Whether a name matches the search, case-insensitively; everything matches no search. */
export function nameMatches(name: string, search: string): boolean {
  return name.toLowerCase().includes(search.toLowerCase());
}

/**
 * The ids the house keeps visible for a search: every matching process and
 * all of its ancestors, so the containers that hold a match stay on screen.
 * Null when there is no search.
 */
export function matchingIds(flat: ProcItem[], search: string): Set<string> | null {
  if (!search) return null;
  const byId = new Map(flat.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const n of flat) {
    if (!nameMatches(n.name, search)) continue;
    let cur: ProcItem | undefined = n;
    while (cur && !ids.has(cur.id)) {
      ids.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/*  Drawer and views                                                   */
/* ------------------------------------------------------------------ */

/** Steps grouped by their lane, in first-appearance order; a step with no lane goes to `defaultLane`. */
export function groupByLane<T extends { lane_name?: string | null }>(
  steps: T[],
  defaultLane: string,
): Map<string, T[]> {
  const lanes = new Map<string, T[]>();
  for (const step of steps) {
    const lane = step.lane_name || defaultLane;
    lanes.set(lane, [...(lanes.get(lane) ?? []), step]);
  }
  return lanes;
}

export interface MatrixCell {
  process_id: string;
  application_id: string;
  source: string;
  element_name?: string;
}

/**
 * What links one process to one application in the matrix: the links found,
 * and whether any of them comes from a BPMN element (`E`) rather than only a
 * relation (`R`).
 */
export function matrixCell(
  cells: MatrixCell[],
  processId: string,
  applicationId: string,
): { links: MatrixCell[]; viaElement: boolean } {
  const links = cells.filter(
    (x) => x.process_id === processId && x.application_id === applicationId,
  );
  return { links, viaElement: links.some((x) => x.source === "element") };
}

/** The name of a node in a list, or its id when the list does not have it. */
export function nameOrId(nodes: RefItem[], id: string): string {
  return nodes.find((n) => n.id === id)?.name || id;
}

/** The overlay legend: the process-type options, or the fixed overlay's colours. */
export function legendItems(
  overlay: ColorOverlay,
  processTypeOptions: { label: string; color: string }[],
): { label: string; color: string }[] {
  return overlay === "processType"
    ? processTypeOptions.map(({ label, color }) => ({ label, color }))
    : Object.values(ATTR_COLORS[overlay] ?? {});
}
