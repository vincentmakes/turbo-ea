/**
 * The table actions of the document editor, as data: what each one is called,
 * when it may run, what it does, and which menu shows it where. The toolbar's
 * Table menu, the right-click menu and the row / column grips all render from
 * this one model (`tableActionItems.tsx` turns a set into menu items), so an
 * action is enabled by the same rule wherever it appears.
 *
 * Enablement reads the selection's rectangle (`selectedRect`), not only
 * `editor.can()`: prosemirror-tables answers several of these checks inside
 * its `dispatch` branch, so `can()` says yes to a run that would refuse
 * (deleting every row or column). Where the engine's own check is exact the
 * answer is delegated to it.
 *
 * "Before" / "after" for columns are column indexes, not left / right: in a
 * right-to-left document the previous index sits to the right.
 */
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import {
  CellSelection,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
} from "@tiptap/pm/tables";

/** The size "Insert table" gives: three by three, the first row a header. */
export const NEW_TABLE = { rows: 3, cols: 3, withHeaderRow: true } as const;

/**
 * Whether the table holding the selection starts with a header row (every
 * cell of its first row a header cell). False outside a table.
 */
export function tableHasHeaderRow(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.spec.tableRole !== "table") continue;
    const first = node.firstChild;
    if (!first || first.childCount === 0) return false;
    let all = true;
    first.forEach((cell) => {
      if (cell.type.spec.tableRole !== "header_cell") all = false;
    });
    return all;
  }
  return false;
}

export type TableActionKey =
  | "insert"
  | "selectRow"
  | "selectColumn"
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "moveRowUp"
  | "moveRowDown"
  | "moveColumnBefore"
  | "moveColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "toggleHeaderRow"
  | "mergeCells"
  | "splitCell"
  | "deleteTable";

export type TableActionGroup = "insert" | "select" | "add" | "move" | "delete" | "cell" | "table";

/** What each action may do now, and what a menu shows about the selection. */
export type TableActionState = Record<TableActionKey, boolean> & {
  /** The selection is in a table. */
  inTable: boolean;
  /** The table starts with a header row (the Header row item's tick). */
  headerRow: boolean;
  /** How many rows the selection's rectangle covers; 0 outside a table. */
  rowCount: number;
  /** How many columns the selection's rectangle covers; 0 outside a table. */
  columnCount: number;
  /** The selection's rectangle starts at the table's first row. */
  firstRow: boolean;
};

export interface TableAction {
  key: TableActionKey;
  /** A `delivery` key; a counted action's key has `_one` / `_other` forms. */
  labelKey: string;
  group: TableActionGroup;
  /** Rendered as a checkbox item, checked by this state flag. */
  checkedBy?: "headerRow";
  /** The label counts this state value ("Delete 2 rows"). */
  countBy?: "rowCount" | "columnCount";
  /**
   * Runs the action on the editor's selection, when its state allows it.
   * True when it ran. It does not move the focus.
   */
  run: (editor: Editor) => boolean;
}

/** Whether `table` has a cell spanning more than one row / column. */
function hasSpan(table: PmNode, attr: "rowspan" | "colspan"): boolean {
  let found = false;
  table.forEach((row) => {
    row.forEach((cell) => {
      if (cell.attrs[attr] > 1) found = true;
    });
  });
  return found;
}

const OUTSIDE: TableActionState = {
  inTable: false,
  headerRow: false,
  rowCount: 0,
  columnCount: 0,
  firstRow: false,
  insert: false,
  selectRow: false,
  selectColumn: false,
  addRowBefore: false,
  addRowAfter: false,
  addColumnBefore: false,
  addColumnAfter: false,
  moveRowUp: false,
  moveRowDown: false,
  moveColumnBefore: false,
  moveColumnAfter: false,
  deleteRow: false,
  deleteColumn: false,
  toggleHeaderRow: false,
  mergeCells: false,
  splitCell: false,
  deleteTable: false,
};

/**
 * The actions' state for an editor. Outside a table only Insert is offered;
 * inside one Insert is not (a table nested in a cell is not offered, though
 * the command would allow it).
 */
export function tableActionState(editor: Editor): TableActionState {
  const { state } = editor;
  const can = editor.can();
  if (!isInTable(state)) return { ...OUTSIDE, insert: can.insertTable(NEW_TABLE) };

  const { top, bottom, left, right, map, table } = selectedRect(state);
  const headerRow = tableHasHeaderRow(state);
  const rowCount = bottom - top;
  const columnCount = right - left;
  const oneRow = rowCount === 1 && !hasSpan(table, "rowspan");
  const oneColumn = columnCount === 1 && !hasSpan(table, "colspan");
  return {
    inTable: true,
    headerRow,
    rowCount,
    columnCount,
    firstRow: top === 0,
    insert: false,
    selectRow: true,
    selectColumn: true,
    // Never a body row above the header row.
    addRowBefore: !(top === 0 && headerRow),
    addRowAfter: can.addRowAfter(),
    addColumnBefore: can.addColumnBefore(),
    addColumnAfter: can.addColumnAfter(),
    // Never into or out of the header row.
    moveRowUp: oneRow && top > 0 && !(headerRow && top === 1),
    moveRowDown: oneRow && bottom < map.height && !(headerRow && top === 0),
    moveColumnBefore: oneColumn && left > 0,
    moveColumnAfter: oneColumn && right < map.width,
    // A table keeps at least one row and one column.
    deleteRow: !(top === 0 && bottom === map.height),
    deleteColumn: !(left === 0 && right === map.width),
    toggleHeaderRow: can.toggleHeaderRow(),
    mergeCells: can.mergeCells(),
    splitCell: can.splitCell(),
    deleteTable: can.deleteTable(),
  };
}

/** Selects whole rows (or columns) over the selection's rectangle, in one transaction. */
function selectLines(editor: Editor, axis: "row" | "column"): boolean {
  return editor.commands.command(({ tr }) => {
    const { top, bottom, left, right, map, tableStart } = selectedRect(editor.state);
    const at = (row: number, col: number) => tr.doc.resolve(tableStart + map.map[row * map.width + col]);
    const selection =
      axis === "row"
        ? CellSelection.rowSelection(at(top, 0), at(bottom - 1, map.width - 1))
        : CellSelection.colSelection(at(0, left), at(map.height - 1, right - 1));
    tr.setSelection(selection);
    return true;
  });
}

/** Moves the selection's row (or column) by one, leaving it selected. */
function moveLine(editor: Editor, axis: "row" | "column", by: -1 | 1): boolean {
  const { top, left } = selectedRect(editor.state);
  const from = axis === "row" ? top : left;
  const move = axis === "row" ? moveTableRow : moveTableColumn;
  return editor.commands.command(({ state, dispatch }) =>
    move({ from, to: from + by, select: true })(state, dispatch),
  );
}

type Spec = Omit<TableAction, "run"> & { act: (editor: Editor) => boolean };

const SPECS: readonly Spec[] = [
  {
    key: "insert",
    labelKey: "richText.tableInsert",
    group: "insert",
    act: (e) => e.chain().insertTable(NEW_TABLE).run(),
  },
  {
    key: "selectRow",
    labelKey: "richText.tableSelectRow",
    group: "select",
    act: (e) => selectLines(e, "row"),
  },
  {
    key: "selectColumn",
    labelKey: "richText.tableSelectColumn",
    group: "select",
    act: (e) => selectLines(e, "column"),
  },
  {
    key: "addRowBefore",
    labelKey: "richText.tableAddRowBefore",
    group: "add",
    act: (e) => e.chain().addRowBefore().run(),
  },
  {
    key: "addRowAfter",
    labelKey: "richText.tableAddRowAfter",
    group: "add",
    act: (e) => e.chain().addRowAfter().run(),
  },
  {
    key: "addColumnBefore",
    labelKey: "richText.tableAddColumnBefore",
    group: "add",
    act: (e) => e.chain().addColumnBefore().run(),
  },
  {
    key: "addColumnAfter",
    labelKey: "richText.tableAddColumnAfter",
    group: "add",
    act: (e) => e.chain().addColumnAfter().run(),
  },
  {
    key: "moveRowUp",
    labelKey: "richText.tableMoveRowUp",
    group: "move",
    act: (e) => moveLine(e, "row", -1),
  },
  {
    key: "moveRowDown",
    labelKey: "richText.tableMoveRowDown",
    group: "move",
    act: (e) => moveLine(e, "row", 1),
  },
  {
    key: "moveColumnBefore",
    labelKey: "richText.tableMoveColumnBefore",
    group: "move",
    act: (e) => moveLine(e, "column", -1),
  },
  {
    key: "moveColumnAfter",
    labelKey: "richText.tableMoveColumnAfter",
    group: "move",
    act: (e) => moveLine(e, "column", 1),
  },
  {
    key: "deleteRow",
    labelKey: "richText.tableDeleteRow",
    group: "delete",
    countBy: "rowCount",
    act: (e) => e.chain().deleteRow().run(),
  },
  {
    key: "deleteColumn",
    labelKey: "richText.tableDeleteColumn",
    group: "delete",
    countBy: "columnCount",
    act: (e) => e.chain().deleteColumn().run(),
  },
  {
    key: "toggleHeaderRow",
    labelKey: "richText.tableHeaderRow",
    group: "cell",
    checkedBy: "headerRow",
    act: (e) => e.chain().toggleHeaderRow().run(),
  },
  {
    key: "mergeCells",
    labelKey: "richText.tableMergeCells",
    group: "cell",
    act: (e) => e.chain().mergeCells().run(),
  },
  {
    key: "splitCell",
    labelKey: "richText.tableSplitCell",
    group: "cell",
    act: (e) => e.chain().splitCell().run(),
  },
  {
    key: "deleteTable",
    labelKey: "richText.tableDelete",
    group: "table",
    act: (e) => e.chain().deleteTable().run(),
  },
];

/** Every table action, in the toolbar menu's order. */
export const TABLE_ACTIONS: readonly TableAction[] = SPECS.map(({ act, ...action }) => ({
  ...action,
  run: (editor: Editor) => tableActionState(editor)[action.key] && act(editor),
}));

/** The actions by key. */
export const TABLE_ACTION = Object.fromEntries(TABLE_ACTIONS.map((a) => [a.key, a])) as Record<
  TableActionKey,
  TableAction
>;

/** Runs one action by key; true when it ran. */
export function runTableAction(editor: Editor, key: TableActionKey): boolean {
  return TABLE_ACTION[key].run(editor);
}

/** The count an action's label shows (at least 1, so a disabled item still reads "Delete row"). */
export function tableActionCount(action: TableAction, state: TableActionState): number | undefined {
  return action.countBy ? Math.max(1, state[action.countBy]) : undefined;
}

export type TableMenuSet = "toolbar" | "context" | "row" | "column";

/** Each menu's actions, in order, as groups (a divider between groups). */
export const TABLE_MENU_SETS: Readonly<Record<TableMenuSet, readonly (readonly TableActionKey[])[]>> = {
  toolbar: [
    ["insert"],
    ["selectRow", "selectColumn"],
    ["addRowBefore", "addRowAfter", "addColumnBefore", "addColumnAfter"],
    ["moveRowUp", "moveRowDown", "moveColumnBefore", "moveColumnAfter"],
    ["deleteRow", "deleteColumn"],
    ["toggleHeaderRow", "mergeCells", "splitCell"],
    ["deleteTable"],
  ],
  context: [
    ["selectRow", "selectColumn"],
    ["addRowBefore", "addRowAfter", "addColumnBefore", "addColumnAfter"],
    ["moveRowUp", "moveRowDown", "moveColumnBefore", "moveColumnAfter"],
    ["deleteRow", "deleteColumn"],
    ["toggleHeaderRow", "mergeCells", "splitCell"],
    ["deleteTable"],
  ],
  row: [["addRowBefore", "addRowAfter"], ["moveRowUp", "moveRowDown"], ["deleteRow"], ["toggleHeaderRow"]],
  column: [["addColumnBefore", "addColumnAfter"], ["moveColumnBefore", "moveColumnAfter"], ["deleteColumn"]],
};

/**
 * The groups a menu shows for this state: the row menu offers Header row
 * only on the first row (the toggle always acts on the first row), and a
 * group left empty is dropped.
 */
export function tableMenuGroups(set: TableMenuSet, state: TableActionState): TableAction[][] {
  return TABLE_MENU_SETS[set]
    .map((group) =>
      group
        .filter((key) => !(set === "row" && key === "toggleHeaderRow" && !state.firstRow))
        .map((key) => TABLE_ACTION[key]),
    )
    .filter((group) => group.length > 0);
}
