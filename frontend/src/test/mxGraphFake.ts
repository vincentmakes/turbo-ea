/**
 * A fake DrawIO iframe for the `drawio-shapes.ts` helpers.
 *
 * Every helper reads the graph off `iframe.contentWindow.__turboGraph` and the
 * mxGraph classes off the same window, so a test needs a window carrying both.
 * This is the union of the six ad-hoc fakes `drawio-shapes.test.ts` grew, plus
 * listener registration and dispatch, so the lifecycle listeners can be tested:
 *
 * ```ts
 * const f = fakeIframe({ cells: [cardCell("c1", { cardId: "a", cardType: "Application", label: "A" })] });
 * const cleanup = attachCellLifecycleListeners(f.iframe, { onRelationEdgeRemoved });
 * f.graph.removeCells([f.cells.c1]);           // fires CELLS_REMOVED on the graph
 * f.fire.model("CELLS_REMOVED", { cells: [...] }); // DrawIO's model-level route
 * ```
 *
 * Fidelity, where it matters: a user object is a real XML element (so
 * `getAttribute` is `null` for a missing attribute and `setAttribute` /
 * `removeAttribute` behave), `beginUpdate` / `endUpdate` nest and fire `CHANGE`
 * once on the outermost `endUpdate`, `graph.removeCells` fires `CELLS_REMOVED`
 * on the **graph** (mxGraph's `cellsRemoved`) while `model.remove` only
 * produces a `CHANGE`, and `insertVertex` / `insertEdge` fire `CELLS_ADDED` on
 * both the graph and the model so a listener on either side sees it. Root is
 * `"0"` and the default parent `"1"`, which the helpers skip by id.
 *
 * `_style` and `_geo` are accessor aliases of `style` and `geometry`, so cells
 * from the older fakes read the same.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Geo {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Listener = (sender: unknown, evt: FakeEventObject) => void;

export interface FakeEventObject {
  name: string;
  properties: Record<string, unknown>;
  getProperty: (key: string) => unknown;
  consumed: boolean;
  consume: () => void;
}

function eventObject(name: string, properties: Record<string, unknown> = {}): FakeEventObject {
  const evt: FakeEventObject = {
    name,
    properties,
    getProperty: (key) => (key in properties ? properties[key] : null),
    consumed: false,
    consume: () => {
      evt.consumed = true;
    },
  };
  return evt;
}

/** The slice of `mxEventSource` the helpers use. */
export class FakeEventSource {
  private listeners: Array<{ name: string; fn: Listener }> = [];

  addListener(name: string, fn: Listener): void {
    this.listeners.push({ name, fn });
  }

  /** mxGraph's `removeListener(funct)` drops every registration of `fn`. */
  removeListener(fn: Listener): void {
    this.listeners = this.listeners.filter((l) => l.fn !== fn);
  }

  fireEvent(evt: FakeEventObject | string, sender?: unknown): FakeEventObject {
    const e = typeof evt === "string" ? eventObject(evt) : evt;
    for (const l of [...this.listeners]) if (l.name === e.name) l.fn(sender ?? this, e);
    return e;
  }

  listenerCount(name?: string): number {
    return this.listeners.filter((l) => name === undefined || l.name === name).length;
  }
}

export class FakePoint {
  constructor(
    public x: number,
    public y: number,
  ) {}
  clone() {
    return new FakePoint(this.x, this.y);
  }
}

export class FakeRectangle extends FakePoint {
  constructor(
    x: number,
    y: number,
    public width: number,
    public height: number,
  ) {
    super(x, y);
  }
}

export class FakeGeometry extends FakeRectangle {
  points: FakePoint[] | null = null;
  relative = false;
  offset: FakePoint | null = null;
  sourcePoint: FakePoint | null = null;
  targetPoint: FakePoint | null = null;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    super(x, y, width, height);
  }
  clone(): FakeGeometry {
    const g = new FakeGeometry(this.x, this.y, this.width, this.height);
    g.points = this.points ? this.points.map((p) => new FakePoint(p.x, p.y)) : null;
    g.relative = this.relative;
    g.offset = this.offset ? this.offset.clone() : null;
    return g;
  }
}

export class FakeImage {
  constructor(
    public src: string,
    public width: number,
    public height: number,
  ) {}
}

export class FakeCellOverlay extends FakeEventSource {
  cursor = "default";
  tooltip: string | null;
  constructor(
    public image: FakeImage,
    tooltip: string | null,
    public align: string,
    public verticalAlign: string,
    public offset: FakePoint | null,
    cursor?: string,
  ) {
    super();
    this.tooltip = tooltip;
    if (cursor) this.cursor = cursor;
  }
  /** Fire this overlay's CLICK the way mxGraph does: `evt.properties.event` is the DOM event. */
  click(event: Partial<MouseEvent> = {}): FakeEventObject {
    return this.fireEvent(eventObject(MX_EVENT.CLICK, { event }), this);
  }
}

export const MX_CONSTANTS = {
  ALIGN_LEFT: "left",
  ALIGN_CENTER: "center",
  ALIGN_RIGHT: "right",
  ALIGN_TOP: "top",
  ALIGN_MIDDLE: "middle",
  ALIGN_BOTTOM: "bottom",
  STYLE_FILLCOLOR: "fillColor",
  STYLE_STROKECOLOR: "strokeColor",
  STYLE_FONTCOLOR: "fontColor",
  NONE: "none",
};

export const MX_EVENT = {
  CHANGE: "change",
  CELLS_ADDED: "cellsAdded",
  CELLS_REMOVED: "cellsRemoved",
  CELLS_MOVED: "cellsMoved",
  MOVE_CELLS: "moveCells",
  CELLS_RESIZED: "cellsResized",
  RESIZE_CELLS: "resizeCells",
  LABEL_CHANGED: "labelChanged",
  CLICK: "click",
  ADD_OVERLAY: "addOverlay",
  REMOVE_OVERLAY: "removeOverlay",
};

/** The XML document user objects are created in (never the HTML document). */
export function xmlDocument(): XMLDocument {
  return document.implementation.createDocument(null, null, null);
}

/** A real XML `<object>` element carrying `attrs`: the user object of a card or edge cell. */
export function attrBag(attrs: Record<string, string> = {}): Element {
  const el = xmlDocument().createElement("object");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export interface FakeCell {
  id: string;
  value: any;
  style: string;
  geometry: FakeGeometry | null;
  parent: FakeCell | null;
  children: FakeCell[];
  edge: boolean;
  vertex: boolean;
  source: FakeCell | null;
  target: FakeCell | null;
  edges: FakeCell[];
  collapsed: boolean;
  overlays: FakeCellOverlay[];
  /** Alias of `style`. */
  _style: string;
  /** Alias of `geometry`. */
  _geo: FakeGeometry | null;
  getId: () => string;
  getParent: () => FakeCell | null;
  getGeometry: () => FakeGeometry | null;
  setGeometry: (g: FakeGeometry | null) => void;
  getStyle: () => string;
  getValue: () => any;
  getAttribute: (name: string, defaultValue?: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  isEdge: () => boolean;
  isVertex: () => boolean;
  isCollapsed: () => boolean;
  getTerminal: (isSource: boolean) => FakeCell | null;
  getChildCount: () => number;
  getChildAt: (i: number) => FakeCell | null;
}

export interface CellOptions {
  value?: any;
  style?: string;
  geometry?: Partial<Geo> | FakeGeometry | null;
  parent?: FakeCell | null;
  collapsed?: boolean;
}

function toGeometry(g: CellOptions["geometry"]): FakeGeometry | null {
  if (g === null) return null;
  if (g instanceof FakeGeometry) return g;
  const { x = 0, y = 0, width = 0, height = 0 } = g ?? {};
  return new FakeGeometry(x, y, width, height);
}

function baseCell(id: string, opts: CellOptions & { edge?: boolean }): FakeCell {
  const cell = {
    id,
    value: opts.value ?? null,
    style: opts.style ?? "",
    geometry: toGeometry(opts.geometry === undefined && opts.edge ? new FakeGeometry() : opts.geometry),
    parent: opts.parent ?? null,
    children: [] as FakeCell[],
    edge: Boolean(opts.edge),
    vertex: !opts.edge,
    source: null as FakeCell | null,
    target: null as FakeCell | null,
    edges: [] as FakeCell[],
    collapsed: Boolean(opts.collapsed),
    overlays: [] as FakeCellOverlay[],
  } as FakeCell;
  Object.defineProperty(cell, "_style", {
    get: () => cell.style,
    set: (v: string) => {
      cell.style = v;
    },
    enumerable: false,
  });
  Object.defineProperty(cell, "_geo", {
    get: () => cell.geometry,
    set: (v: FakeGeometry | null) => {
      cell.geometry = v;
    },
    enumerable: false,
  });
  cell.getId = () => cell.id;
  cell.getParent = () => cell.parent;
  cell.getGeometry = () => cell.geometry;
  cell.setGeometry = (g) => {
    cell.geometry = g;
  };
  cell.getStyle = () => cell.style;
  cell.getValue = () => cell.value;
  cell.getAttribute = (name, defaultValue) => {
    const v = cell.value?.getAttribute?.(name) ?? null;
    return v ?? defaultValue ?? null;
  };
  cell.setAttribute = (name, v) => cell.value?.setAttribute?.(name, v);
  cell.isEdge = () => cell.edge;
  cell.isVertex = () => cell.vertex;
  cell.isCollapsed = () => cell.collapsed;
  cell.getTerminal = (isSource) => (isSource ? cell.source : cell.target);
  cell.getChildCount = () => cell.children.length;
  cell.getChildAt = (i) => cell.children[i] ?? null;
  return cell;
}

export interface CardCellOptions extends CellOptions {
  cardId: string;
  cardType: string;
  /** The composed label (`label` attribute); defaults to `name`. */
  label?: string;
  /** The plain name (`cardName` attribute); omitted when absent. */
  name?: string;
  pending?: boolean;
  parentGroupCell?: string;
  /** Any further user-object attributes (`drillDownChild`, `rollUpChild`, …). */
  attrs?: Record<string, string>;
}

/** A synced (or pending) card vertex: an XML user object with the card attributes. */
export function cardCell(id: string, opts: CardCellOptions): FakeCell {
  const attrs: Record<string, string> = {
    cardId: opts.cardId,
    cardType: opts.cardType,
    label: opts.label ?? opts.name ?? opts.cardId,
    ...(opts.name ? { cardName: opts.name } : {}),
    ...(opts.pending ? { pending: "1" } : {}),
    ...(opts.parentGroupCell ? { parentGroupCell: opts.parentGroupCell } : {}),
    ...(opts.attrs ?? {}),
  };
  return baseCell(id, {
    value: opts.value ?? attrBag(attrs),
    style: opts.style ?? "rounded=1;whiteSpace=wrap;html=1;fillColor=#0f7eb5;",
    geometry: opts.geometry === undefined ? { x: 0, y: 0, width: 210, height: 60 } : opts.geometry,
    parent: opts.parent,
    collapsed: opts.collapsed,
  });
}

/** A plain DrawIO shape: a string label and no card attributes. */
export function plainCell(id: string, opts: CellOptions & { label?: string; edge?: boolean } = {}): FakeCell {
  return baseCell(id, {
    value: opts.value ?? opts.label ?? "",
    style: opts.style ?? "rounded=0;whiteSpace=wrap;html=1;",
    geometry:
      opts.geometry === undefined
        ? opts.edge
          ? new FakeGeometry()
          : { x: 0, y: 0, width: 120, height: 60 }
        : opts.geometry,
    parent: opts.parent,
    collapsed: opts.collapsed,
    edge: opts.edge,
  });
}

/** A card cell styled as a container (swimlane), the shape an expanded or drilled-down card becomes. */
export function containerCell(id: string, opts: CardCellOptions): FakeCell {
  return cardCell(id, {
    ...opts,
    style: opts.style ?? "shape=swimlane;whiteSpace=wrap;html=1;startSize=28;fillColor=#0f7eb5;",
    geometry: opts.geometry === undefined ? { x: 0, y: 0, width: 400, height: 300 } : opts.geometry,
  });
}

export interface EdgeCellOptions extends CellOptions {
  relationId?: string;
  relationType?: string;
  label?: string;
  pending?: boolean;
  flowDirection?: string;
  reversed?: boolean;
  attrs?: Record<string, string>;
}

/** An edge between two cells; with `relationType` it is a relation edge (XML user object), else a plain line. */
export function edgeCell(id: string, source: FakeCell | null, target: FakeCell | null, opts: EdgeCellOptions = {}): FakeCell {
  const isRelation = opts.relationType !== undefined || opts.relationId !== undefined || opts.attrs !== undefined;
  const attrs: Record<string, string> = {
    ...(opts.relationId ? { relationId: opts.relationId } : {}),
    ...(opts.relationType ? { relationType: opts.relationType } : {}),
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.pending ? { pending: "1" } : {}),
    ...(opts.flowDirection ? { flowDirection: opts.flowDirection } : {}),
    ...(opts.reversed ? { reversed: "1" } : {}),
    ...(opts.attrs ?? {}),
  };
  const cell = baseCell(id, {
    value: opts.value ?? (isRelation ? attrBag(attrs) : (opts.label ?? "")),
    style: opts.style ?? "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;",
    geometry: opts.geometry,
    parent: opts.parent,
    edge: true,
  });
  cell.source = source;
  cell.target = target;
  if (source) source.edges.push(cell);
  if (target && target !== source) target.edges.push(cell);
  return cell;
}

export class FakeModel extends FakeEventSource {
  cells: Record<string, FakeCell> = {};
  updateLevel = 0;
  /** Set when a `CHANGE` is pending for the outermost `endUpdate`. */
  private dirty = false;

  constructor(public root: FakeCell) {
    super();
    this.register(root);
  }

  register(cell: FakeCell): void {
    this.cells[cell.id] = cell;
  }

  getCell(id: string): FakeCell | null {
    return this.cells[id] ?? null;
  }

  getRoot(): FakeCell {
    return this.root;
  }

  beginUpdate(): void {
    this.updateLevel += 1;
  }

  endUpdate(): void {
    this.updateLevel = Math.max(0, this.updateLevel - 1);
    if (this.updateLevel === 0 && this.dirty) {
      this.dirty = false;
      this.fireEvent(eventObject(MX_EVENT.CHANGE), this);
    }
  }

  /** Mark the transaction dirty; fires `CHANGE` now when no update is open. */
  private touch(): void {
    if (this.updateLevel === 0) this.fireEvent(eventObject(MX_EVENT.CHANGE), this);
    else this.dirty = true;
  }

  /** Re-parent (or first-parent) `child` under `parent`, like `mxGraphModel.add`. */
  add(parent: FakeCell, child: FakeCell, index?: number): FakeCell {
    if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
    child.parent = parent;
    if (index === undefined || index >= parent.children.length) parent.children.push(child);
    else parent.children.splice(index, 0, child);
    this.register(child);
    this.touch();
    return child;
  }

  /** Remove a cell (and its subtree) from the model. Only a `CHANGE` results — no `CELLS_REMOVED`. */
  remove(cell: FakeCell): FakeCell {
    this.detach(cell);
    this.touch();
    return cell;
  }

  private detach(cell: FakeCell): void {
    for (const child of [...(cell.children ?? [])]) this.detach(child);
    if (cell.parent?.children) cell.parent.children = cell.parent.children.filter((c) => c !== cell);
    cell.parent = null;
    for (const e of [...(cell.edges ?? [])]) {
      if (e.source === cell) e.source = null;
      if (e.target === cell) e.target = null;
    }
    if (cell.edge) {
      if (cell.source) cell.source.edges = cell.source.edges.filter((e) => e !== cell);
      if (cell.target) cell.target.edges = cell.target.edges.filter((e) => e !== cell);
    }
    delete this.cells[cell.id];
  }

  getStyle(cell: FakeCell): string {
    return cell.style ?? "";
  }

  setStyle(cell: FakeCell, style: string): void {
    cell.style = style;
    this.touch();
  }

  getValue(cell: FakeCell): any {
    return cell.value;
  }

  setValue(cell: FakeCell, value: any): void {
    cell.value = value;
    this.touch();
  }

  getGeometry(cell: FakeCell): FakeGeometry | null {
    return cell.geometry ?? null;
  }

  setGeometry(cell: FakeCell, geometry: FakeGeometry | null): void {
    cell.geometry = geometry;
    this.touch();
  }

  getParent(cell: FakeCell): FakeCell | null {
    return cell.parent;
  }

  getChildCount(cell: FakeCell): number {
    return (cell.children ?? []).length;
  }

  getChildAt(cell: FakeCell, index: number): FakeCell | null {
    return (cell.children ?? [])[index] ?? null;
  }

  getChildren(cell: FakeCell): FakeCell[] {
    return cell.children ?? [];
  }

  getTerminal(cell: FakeCell, isSource: boolean): FakeCell | null {
    return isSource ? cell.source : cell.target;
  }

  setTerminal(edge: FakeCell, terminal: FakeCell | null, isSource: boolean): void {
    const prev = isSource ? edge.source : edge.target;
    if (prev) prev.edges = prev.edges.filter((e) => e !== edge);
    if (isSource) edge.source = terminal;
    else edge.target = terminal;
    if (terminal && !terminal.edges.includes(edge)) terminal.edges.push(edge);
    this.touch();
  }

  isEdge(cell: FakeCell): boolean {
    return Boolean(cell?.edge);
  }

  isVertex(cell: FakeCell): boolean {
    return Boolean(cell?.vertex);
  }

  isCollapsed(cell: FakeCell): boolean {
    return Boolean(cell?.collapsed);
  }

  setCollapsed(cell: FakeCell, collapsed: boolean): void {
    cell.collapsed = collapsed;
    this.touch();
  }
}

export interface FakeContainer {
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
  clientHeight: number;
  listeners: Array<{ name: string; fn: (e: Event) => void }>;
  addEventListener: (name: string, fn: (e: Event) => void) => void;
  removeEventListener: (name: string, fn: (e: Event) => void) => void;
  getBoundingClientRect: () => Geo & { top: number; left: number; right: number; bottom: number };
}

export class FakeGraph extends FakeEventSource {
  container: FakeContainer;
  view = { scale: 1, translate: new FakePoint(0, 0) };
  /** Every `refresh(cell?)` argument, in order. */
  refreshed: Array<FakeCell | undefined> = [];

  constructor(
    public model: FakeModel,
    public defaultParent: FakeCell,
  ) {
    super();
    const listeners: FakeContainer["listeners"] = [];
    this.container = {
      scrollTop: 0,
      scrollLeft: 0,
      clientWidth: 1200,
      clientHeight: 800,
      listeners,
      addEventListener: (name, fn) => {
        listeners.push({ name, fn });
      },
      removeEventListener: (name, fn) => {
        const i = listeners.findIndex((l) => l.name === name && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 }),
    };
  }

  getModel(): FakeModel {
    return this.model;
  }

  getDefaultParent(): FakeCell {
    return this.defaultParent;
  }

  getCellGeometry(cell: FakeCell): FakeGeometry | null {
    return cell?.geometry ?? null;
  }

  refresh(cell?: FakeCell): void {
    this.refreshed.push(cell);
  }

  insertVertex(parent: FakeCell, id: string | null, value: any, x: number, y: number, width: number, height: number, style = ""): FakeCell {
    const cell = baseCell(id ?? `v${Object.keys(this.model.cells).length + 1}`, {
      value,
      style,
      geometry: { x, y, width, height },
    });
    this.model.beginUpdate();
    try {
      this.model.add(parent, cell);
      this.fireCellsAdded([cell], parent);
    } finally {
      this.model.endUpdate();
    }
    return cell;
  }

  insertEdge(parent: FakeCell, id: string | null, value: any, source: FakeCell | null, target: FakeCell | null, style = ""): FakeCell {
    const cell = edgeCell(id ?? `e${Object.keys(this.model.cells).length + 1}`, source, target, {
      value: value ?? "",
      style,
      geometry: Object.assign(new FakeGeometry(), { relative: true }),
    });
    this.model.beginUpdate();
    try {
      this.model.add(parent, cell);
      this.fireCellsAdded([cell], parent);
    } finally {
      this.model.endUpdate();
    }
    return cell;
  }

  private fireCellsAdded(cells: FakeCell[], parent: FakeCell): void {
    const props = { cells, parent, index: parent.children.length - 1 };
    this.fireEvent(eventObject(MX_EVENT.CELLS_ADDED, props), this);
    this.model.fireEvent(eventObject(MX_EVENT.CELLS_ADDED, props), this.model);
  }

  /** mxGraph's `removeCells`: detach from the model and fire `CELLS_REMOVED` on the graph. */
  removeCells(cells: FakeCell[], includeEdges = true): FakeCell[] {
    const removed: FakeCell[] = [];
    this.model.beginUpdate();
    try {
      for (const cell of cells) {
        if (!cell || !this.model.cells[cell.id]) continue;
        if (includeEdges) {
          for (const e of [...(cell.edges ?? [])]) {
            if (this.model.cells[e.id] && !cells.includes(e)) {
              this.model.remove(e);
              removed.push(e);
            }
          }
        }
        this.model.remove(cell);
        removed.push(cell);
      }
      this.fireEvent(eventObject(MX_EVENT.CELLS_REMOVED, { cells: removed, includeEdges }), this);
    } finally {
      this.model.endUpdate();
    }
    return removed;
  }

  resizeCell(cell: FakeCell, bounds: Geo): FakeCell {
    const g = cell.geometry ? cell.geometry.clone() : new FakeGeometry();
    g.x = bounds.x;
    g.y = bounds.y;
    g.width = bounds.width;
    g.height = bounds.height;
    this.model.setGeometry(cell, g);
    this.fireEvent(eventObject(MX_EVENT.CELLS_RESIZED, { cells: [cell], bounds: [bounds] }), this);
    return cell;
  }

  moveCells(cells: FakeCell[], dx = 0, dy = 0, _clone = false, target?: FakeCell): FakeCell[] {
    this.model.beginUpdate();
    try {
      for (const cell of cells) {
        if (cell.geometry) {
          const g = cell.geometry.clone();
          g.x += dx;
          g.y += dy;
          this.model.setGeometry(cell, g);
        }
        if (target && cell.parent !== target) this.model.add(target, cell);
      }
      this.fireEvent(eventObject(MX_EVENT.MOVE_CELLS, { cells, dx, dy, target: target ?? null }), this);
    } finally {
      this.model.endUpdate();
    }
    return cells;
  }

  addCellOverlay(cell: FakeCell, overlay: FakeCellOverlay): FakeCellOverlay {
    (cell.overlays ??= []).push(overlay);
    this.fireEvent(eventObject(MX_EVENT.ADD_OVERLAY, { cell, overlay }), this);
    return overlay;
  }

  getCellOverlays(cell: FakeCell): FakeCellOverlay[] | null {
    return cell.overlays?.length ? cell.overlays : null;
  }

  removeCellOverlays(cell: FakeCell): FakeCellOverlay[] | null {
    const removed = cell.overlays ?? [];
    cell.overlays = [];
    return removed.length ? removed : null;
  }

  /** Set `key=value` on each cell's style string, replacing an existing token. */
  setCellStyles(key: string, value: string | null, cells: FakeCell[]): void {
    this.model.beginUpdate();
    try {
      for (const cell of cells) {
        const parts = (cell.style ?? "").split(";").filter((p) => p && !p.startsWith(`${key}=`));
        if (value != null) parts.push(`${key}=${value}`);
        this.model.setStyle(cell, `${parts.join(";")};`);
      }
    } finally {
      this.model.endUpdate();
    }
  }

  getEdgesBetween(source: FakeCell, target: FakeCell, directed = false): FakeCell[] {
    return Object.values(this.model.cells).filter(
      (c) =>
        c.edge &&
        ((c.source === source && c.target === target) ||
          (!directed && c.source === target && c.target === source)),
    );
  }

  getEdges(cell: FakeCell): FakeCell[] {
    return [...(cell.edges ?? [])];
  }

  getSelectionCells(): FakeCell[] {
    return [];
  }

  getSelectionCell(): FakeCell | null {
    return null;
  }

  setSelectionCells(): void {}

  clearSelection(): void {}

  isCellCollapsed(cell: FakeCell): boolean {
    return this.model.isCollapsed(cell);
  }

  getChildVertices(parent: FakeCell): FakeCell[] {
    return (parent.children ?? []).filter((c) => c.vertex);
  }

  getChildEdges(parent: FakeCell): FakeCell[] {
    return (parent.children ?? []).filter((c) => c.edge);
  }
}

export interface FakeWindowOptions {
  /** Extra members on the fake window (`mxUtils.fit`, `document`, …). */
  win?: Record<string, unknown>;
  /** Where the iframe sits in the parent page (`iframe.getBoundingClientRect()`); default at the origin. */
  iframeRect?: Partial<Geo>;
}

export interface FakeIframe {
  iframe: HTMLIFrameElement;
  win: any;
  graph: FakeGraph;
  model: FakeModel;
  /** Every cell by id, the live model map (root `"0"`, default parent `"1"`). */
  cells: Record<string, FakeCell>;
  root: FakeCell;
  defaultParent: FakeCell;
  /** What the window's `parent.postMessage` received. */
  posted: unknown[];
  fire: {
    /** Fire a model-level event (DrawIO sometimes routes deletes through the model). */
    model: (name: keyof typeof MX_EVENT | string, props?: Record<string, unknown>) => FakeEventObject;
    /** Fire a graph-level event. */
    graph: (name: keyof typeof MX_EVENT | string, props?: Record<string, unknown>) => FakeEventObject;
    /** A `CHANGE` on the model, as after any DrawIO edit. */
    change: () => FakeEventObject;
    /** Dispatch a `mouseup` on the canvas container. */
    mouseup: () => void;
    /** Fire a card label edit (`LABEL_CHANGED`) for `cell`. */
    labelChanged: (cell: FakeCell, value?: string) => FakeEventObject;
  };
}

function resolveEvent(name: string): string {
  return (MX_EVENT as Record<string, string>)[name] ?? name;
}

/**
 * Build a fake DrawIO iframe. `cells` without a parent land under the default
 * parent; a cell whose `parent` is set keeps it and is registered along with
 * it, so a whole subtree can be built with the cell builders and passed once.
 */
export function fakeIframe(opts: { cells?: FakeCell[] | Record<string, FakeCell> } & FakeWindowOptions = {}): FakeIframe {
  const root = baseCell("0", { geometry: null });
  const defaultParent = baseCell("1", { geometry: null, parent: root });
  root.children.push(defaultParent);
  const model = new FakeModel(root);
  model.register(defaultParent);
  const graph = new FakeGraph(model, defaultParent);

  const initial = Array.isArray(opts.cells) ? opts.cells : Object.values(opts.cells ?? {});
  const seen = new Set<FakeCell>();
  const place = (cell: FakeCell) => {
    if (seen.has(cell)) return;
    seen.add(cell);
    if (!cell.parent) {
      cell.parent = defaultParent;
      defaultParent.children.push(cell);
    } else {
      place(cell.parent);
      cell.parent.children ??= [];
      if (!cell.parent.children.includes(cell)) cell.parent.children.push(cell);
    }
    model.register(cell);
    for (const child of cell.children ?? []) {
      if (!child.parent) child.parent = cell;
      place(child);
    }
  };
  for (const cell of initial) place(cell);

  const posted: unknown[] = [];
  const win: any = {
    __turboGraph: graph,
    mxUtils: {
      createXmlDocument: xmlDocument,
      fit: () => {},
      getValue: (style: Record<string, unknown>, key: string, def: unknown) => style?.[key] ?? def,
    },
    mxRectangle: FakeRectangle,
    mxPoint: FakePoint,
    mxGeometry: FakeGeometry,
    mxImage: FakeImage,
    mxCellOverlay: FakeCellOverlay,
    mxConstants: MX_CONSTANTS,
    mxEvent: MX_EVENT,
    parent: {
      postMessage: (msg: unknown) => {
        posted.push(msg);
      },
    },
    document,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    ...(opts.win ?? {}),
  };
  const r = { x: 0, y: 0, width: 1200, height: 800, ...(opts.iframeRect ?? {}) };
  const iframe = {
    contentWindow: win,
    contentDocument: document,
    getBoundingClientRect: () => ({
      ...r,
      left: r.x,
      top: r.y,
      right: r.x + r.width,
      bottom: r.y + r.height,
      toJSON: () => r,
    }),
  } as unknown as HTMLIFrameElement;

  const fire: FakeIframe["fire"] = {
    model: (name, props = {}) => model.fireEvent(eventObject(resolveEvent(name), props), model),
    graph: (name, props = {}) => graph.fireEvent(eventObject(resolveEvent(name), props), graph),
    change: () => model.fireEvent(eventObject(MX_EVENT.CHANGE), model),
    mouseup: () => {
      const e = new Event("mouseup");
      for (const l of [...graph.container.listeners]) if (l.name === "mouseup") l.fn(e);
    },
    labelChanged: (cell, value) =>
      graph.fireEvent(eventObject(MX_EVENT.LABEL_CHANGED, { cell, value: value ?? cell.value, old: null }), graph),
  };

  return { iframe, win, graph, model, cells: model.cells, root, defaultParent, posted, fire };
}

/** The `key=value` tokens of a style string, for assertions. */
export function styleTokens(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(";")) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) out[part] = "";
    else out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
