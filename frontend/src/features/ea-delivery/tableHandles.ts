/**
 * Row and column handles on the tables of the document editor: a grip beside
 * a row and above a column, a "+" on the border between two rows (in the
 * start gutter) and between two columns (in the top gutter), and a bar under
 * the last row and after the last column.
 *
 * They are widget decorations at the end of a cell's content, drawn by this
 * plugin and placed by the editor's CSS (`EDITOR_TABLE_SX` in
 * `RichTextEditor.tsx`) into a gutter around the table. They are never part
 * of the document: drawing, moving or removing them changes no text and
 * reports no edit.
 *
 * Which cells carry a handle is `handleTargets`, a pure function of the state:
 * the cell under the pointer (the plugin's `hover`) and the cell holding the
 * selection's head (the caret) each make their row and column active, so a
 * hovered row and the caret's row both show their grip. Hover does not
 * replace the caret's handles: those are the ones a touch screen and a
 * returning pointer rely on, and taking them away whenever the pointer
 * crosses the table would make them flicker.
 *
 * A grip's click selects its row (or column) and opens that menu
 * (`TableActionsMenu.tsx`, through the editor's `TableMenuStore`) at the grip;
 * a right-click on a grip does the same. A "+" inserts a row after its row
 * (or a column after its column), and an append bar adds one at the end;
 * either puts the caret in the new row's or column's first cell, in one
 * transaction, so one undo removes it.
 *
 * The widgets carry `stopEvent: () => true`: ProseMirror ignores every event
 * on them, so neither a cell-drag selection (`tableEditing`) nor a column
 * resize (`columnResizing`) starts on a press there, and this plugin's own
 * `mousemove` does not see a pointer over a handle either, which is what
 * keeps the hover (and the handle) in place while the pointer is on it.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { CellSelection, TableMap, addColumn, addRow, type Rect } from "@tiptap/pm/tables";
import { cellPosOf, selectionCellPos } from "./tableContextMenu";
import type { TableMenuStore } from "./tableMenuStore";

export type TableHandleKind =
  | "row"
  | "column"
  | "insert-row"
  | "insert-column"
  | "append-row"
  | "append-column";

/** Each handle's accessible name (and tooltip), translated by the editor. */
export type TableHandleLabels = Record<TableHandleKind, string>;

/** Cell positions (before the cell node), ascending, for each kind of handle. */
export interface HandleTargets {
  /** The first-column cell of each active row (one grip for every row it spans). */
  rowGrips: number[];
  /** The first-row cell of each active column (one grip for every column it spans). */
  columnGrips: number[];
  /** Row grip cells whose lower border is not the table's end: "+" inserts below them. */
  rowInserts: number[];
  /** Column grip cells whose end border is not the table's end: "+" inserts after them. */
  columnInserts: number[];
  /** The cells along the last row: the bar under the table. */
  appendRow: number[];
  /** The cells along the last column: the bar after the table. */
  appendColumn: number[];
}

export interface HandleTargetOptions {
  /** Whether the selection's head counts (the editor has the focus, or its menu is open). */
  caret: boolean;
}

export const NO_HANDLES: HandleTargets = {
  rowGrips: [],
  columnGrips: [],
  rowInserts: [],
  columnInserts: [],
  appendRow: [],
  appendColumn: [],
};

const isCellRole = (node: PmNode | null | undefined) => {
  const role = node?.type.spec.tableRole;
  return role === "cell" || role === "header_cell";
};

interface CellInTable {
  table: PmNode;
  tableStart: number;
  map: TableMap;
  rect: Rect;
}

/** The table around the cell at `cellPos`, its map, and the cell's rectangle. */
function cellInTable(doc: PmNode, cellPos: number): CellInTable {
  const $cell = doc.resolve(cellPos);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  return { table, tableStart, map, rect: map.findCell(cellPos - tableStart) };
}

const sortedUnique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/**
 * Which cells carry which handle, for one table: the hovered cell's table
 * when the pointer is over a cell, else the selection's (with `caret`). The
 * selection's head cell counts only when it is in that same table.
 */
export function handleTargets(
  state: EditorState,
  hoverCellPos: number | null,
  { caret }: HandleTargetOptions,
): HandleTargets {
  const { doc } = state;
  const hover = hoverCellPos !== null && isCellRole(doc.nodeAt(hoverCellPos)) ? hoverCellPos : null;
  const head = caret ? selectionCellPos(state) : null;
  const first = hover ?? head;
  if (first === null) return NO_HANDLES;

  const { table, tableStart, map } = cellInTable(doc, first);
  const active = [first];
  if (head !== null && head !== first && cellInTable(doc, head).table === table) active.push(head);

  const at = (row: number, col: number) => tableStart + map.map[row * map.width + col];
  const rectOf = (pos: number) => map.findCell(pos - tableStart);
  const rowGrips = sortedUnique(active.map((pos) => at(rectOf(pos).top, 0)));
  const columnGrips = sortedUnique(active.map((pos) => at(0, rectOf(pos).left)));
  const lastRow = Array.from({ length: map.width }, (_, col) => at(map.height - 1, col));
  const lastColumn = Array.from({ length: map.height }, (_, row) => at(row, map.width - 1));
  return {
    rowGrips,
    columnGrips,
    rowInserts: rowGrips.filter((pos) => rectOf(pos).bottom < map.height),
    columnInserts: columnGrips.filter((pos) => rectOf(pos).right < map.width),
    appendRow: sortedUnique(lastRow),
    appendColumn: sortedUnique(lastColumn),
  };
}

interface HoverState {
  /** The cell under the pointer, or null. */
  hover: number | null;
}

const NO_HOVER: HoverState = { hover: null };

export const tableHandlesKey = new PluginKey<HoverState>("tableHandles");

const GLYPH: Record<TableHandleKind, string> = {
  row: "drag_indicator",
  column: "drag_indicator",
  "insert-row": "add",
  "insert-column": "add",
  "append-row": "add",
  "append-column": "add",
};

/**
 * The cell a handle's widget sits in (it is placed at the end of the cell's
 * content); null once the widget is no longer drawn.
 */
function handleCellPos(getPos: () => number | undefined, state: EditorState): number | null {
  const pos = getPos();
  return pos === undefined ? null : state.doc.resolve(pos).before();
}

/** Selects the grip cell's rows (or columns), the grip cell as the head, and opens that menu at `at`. */
function openGrip(
  view: EditorView,
  store: TableMenuStore,
  axis: "row" | "column",
  cellPos: number,
  at: DOMRect,
): void {
  const { doc } = view.state;
  const { tableStart, map, rect } = cellInTable(doc, cellPos);
  const $cell = doc.resolve(cellPos);
  const selection =
    axis === "row"
      ? CellSelection.rowSelection(
          doc.resolve(tableStart + map.map[(rect.bottom - 1) * map.width + map.width - 1]),
          $cell,
        )
      : CellSelection.colSelection(
          doc.resolve(tableStart + map.map[(map.height - 1) * map.width + rect.right - 1]),
          $cell,
        );
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  store.open({ set: axis, top: at.bottom, left: at.left });
}

/**
 * Adds a row (at row index `index`) or a column (at column index `index`) to
 * the table of the cell at `cellPos`, the caret in the new line's first cell.
 */
function insertLine(view: EditorView, axis: "row" | "column", cellPos: number, index: number): void {
  const { state } = view;
  const { table, tableStart, map, rect } = cellInTable(state.doc, cellPos);
  const tr = state.tr;
  if (axis === "row") addRow(tr, { ...rect, map, table, tableStart }, index);
  else addColumn(tr, { ...rect, map, table, tableStart }, index);
  const next = TableMap.get(tr.doc.nodeAt(tableStart - 1)!);
  const firstCell = tableStart + next.map[axis === "row" ? index * next.width : index];
  tr.setSelection(TextSelection.near(tr.doc.resolve(firstCell + 1)));
  view.dispatch(tr);
  view.focus();
}

/** What a handle does when clicked; nothing in a locked editor. */
function runHandle(
  view: EditorView,
  store: TableMenuStore,
  kind: TableHandleKind,
  cellPos: number,
  at: DOMRect,
): void {
  if (kind === "row" || kind === "column") {
    openGrip(view, store, kind, cellPos, at);
    return;
  }
  const { map, rect } = cellInTable(view.state.doc, cellPos);
  if (kind === "insert-row") insertLine(view, "row", cellPos, rect.bottom);
  else if (kind === "insert-column") insertLine(view, "column", cellPos, rect.right);
  else if (kind === "append-row") insertLine(view, "row", cellPos, map.height);
  else insertLine(view, "column", cellPos, map.width);
}

/**
 * A handle's DOM, built once and never changed afterwards (a change inside
 * the editable content would be read as an edit). An unlabelled one (a
 * further segment of an append bar) is hidden from assistive technology and
 * only widens the bar's hit area.
 */
function handleDom(
  view: EditorView,
  getPos: () => number | undefined,
  store: TableMenuStore,
  kind: TableHandleKind,
  label: string | null,
): HTMLElement {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("span");
  dom.setAttribute("contenteditable", "false");
  dom.setAttribute("data-table-handle", kind);
  if (label === null) {
    dom.setAttribute("aria-hidden", "true");
  } else {
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", label);
    dom.setAttribute("title", label);
  }
  const glyph = doc.createElement("span");
  glyph.className = "material-symbols-outlined";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = GLYPH[kind];
  dom.append(glyph);

  // A press keeps the focus and the selection where they are.
  const hold = (event: Event) => event.preventDefault();
  dom.addEventListener("pointerdown", hold);
  dom.addEventListener("mousedown", hold);
  const act = () => {
    if (!view.editable) return;
    const cellPos = handleCellPos(getPos, view.state);
    if (cellPos === null) return;
    // Measured now: the selection this runs may draw the handle anew.
    runHandle(view, store, kind, cellPos, dom.getBoundingClientRect());
  };
  dom.addEventListener("click", (event) => {
    event.preventDefault();
    act();
  });
  if (kind === "row" || kind === "column") {
    dom.addEventListener("contextmenu", (event) => {
      if (!view.editable) return;
      event.preventDefault();
      act();
    });
  }
  return dom;
}

/** The nearest cell or table wrapper around `target` inside the editor. */
function hoverTarget(view: EditorView, target: EventTarget | null): "wrapper" | HTMLElement | null {
  for (let node = target as Node | null; node && node !== view.dom; node = node.parentNode) {
    if (node.nodeName === "TD" || node.nodeName === "TH") return node as HTMLElement;
    if ((node as Element).classList?.contains("tableWrapper")) return "wrapper";
  }
  return null;
}

export interface TableHandlesOptions {
  editor: Editor;
  store: TableMenuStore;
  /** Read each time handles are drawn, so a language change applies to the next ones. */
  labels: { current: TableHandleLabels };
}

/** The handles plugin of a document editor, opening its grip menus through `store`. */
export function tableHandles({ editor, store, labels }: TableHandlesOptions): Plugin<HoverState> {
  const setHover = (view: EditorView, hover: number | null) => {
    if (tableHandlesKey.getState(view.state)?.hover !== hover) {
      view.dispatch(view.state.tr.setMeta(tableHandlesKey, { hover }));
    }
  };

  const widget = (
    kind: TableHandleKind,
    cellPos: number,
    cell: PmNode,
    labelled: boolean,
  ): Decoration => {
    const label = labelled ? labels.current[kind] : null;
    return Decoration.widget(
      cellPos + cell.nodeSize - 1,
      (view, getPos) => handleDom(view, getPos, store, kind, label),
      {
        // The label is part of the key, so a new language draws a new handle.
        key: `${kind}:${cellPos}:${label ?? ""}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
      },
    );
  };

  return new Plugin<HoverState>({
    key: tableHandlesKey,
    state: {
      init: () => NO_HOVER,
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(tableHandlesKey) as HoverState | undefined;
        if (meta) return meta;
        // Locking or unlocking forgets the hover: the pointer says again where it is.
        if (tr.getMeta("editableChanged")) return NO_HOVER;
        if (value.hover === null || !tr.docChanged) return value;
        const { pos, deleted } = tr.mapping.mapResult(value.hover, 1);
        return !deleted && isCellRole(state.doc.nodeAt(pos)) ? { hover: pos } : NO_HOVER;
      },
    },
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!view.editable) return false;
          const target = hoverTarget(view, event.target);
          // In the table's gutter (its wrapper's padding) the hover stays.
          if (target === "wrapper") return false;
          setHover(view, target === null ? null : cellPosOf(view, target));
          return false;
        },
        mouseleave: (view) => {
          setHover(view, null);
          return false;
        },
      },
      decorations: (state) => {
        if (!editor.isEditable) return null;
        const hover = tableHandlesKey.getState(state)?.hover ?? null;
        const targets = handleTargets(state, hover, { caret: editor.isFocused || store.isOpen() });
        const { doc } = state;
        const decorations: Decoration[] = [];
        const add = (kind: TableHandleKind, cells: number[], labelFirstOnly = false) => {
          cells.forEach((pos, i) => {
            decorations.push(widget(kind, pos, doc.nodeAt(pos)!, !labelFirstOnly || i === 0));
          });
        };
        add("row", targets.rowGrips);
        add("column", targets.columnGrips);
        add("insert-row", targets.rowInserts);
        add("insert-column", targets.columnInserts);
        add("append-row", targets.appendRow, true);
        add("append-column", targets.appendColumn, true);
        return DecorationSet.create(doc, decorations);
      },
    },
  });
}
