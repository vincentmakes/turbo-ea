/**
 * The table action model, read and run on a headless editor carrying the same
 * nodes the document editor registers. The menus that render it are driven
 * through the real editor in `RichTextEditor.test.tsx` and `TableMenu.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CellSelection } from "@tiptap/pm/tables";
import { TABLE_COLSPAN_HEADER, TABLE_ROWSPAN } from "@/test/fixtures/tableMarkup";
import {
  NEW_TABLE,
  TABLE_ACTION,
  TABLE_ACTIONS,
  TABLE_MENU_SETS,
  runTableAction,
  tableActionCount,
  tableActionState,
  tableHasHeaderRow,
  tableMenuGroups,
  type TableActionKey,
} from "./tableActions";
import { createDocumentTableExtensions } from "./documentTableExtension";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function editorWith(content: string | JSONContent, onUpdate = vi.fn()): Editor {
  const editor = new Editor({
    extensions: [StarterKit, ...createDocumentTableExtensions()],
    content,
    onUpdate,
  });
  editors.push(editor);
  return editor;
}

/** The position of the text node whose text is exactly `text`. */
function textAt(editor: Editor, text: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos;
  });
  expect(at, `no text "${text}"`).toBeGreaterThan(-1);
  return at;
}

function caretIn(editor: Editor, text: string) {
  editor.commands.setTextSelection(textAt(editor, text));
}

/** Every cell's position, in document order. */
function cellPositions(editor: Editor): number[] {
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") cells.push(pos);
  });
  return cells;
}

/** A cell selection from the cell holding `from` to the cell holding `to`. */
function selectCells(editor: Editor, from: string, to: string) {
  const cellOf = (text: string) => editor.state.doc.resolve(textAt(editor, text)).before(-1);
  editor.commands.setCellSelection({ anchorCell: cellOf(from), headCell: cellOf(to) });
}

/** The caret in the `index`-th cell (document order) of an empty-celled table. */
function caretInCell(editor: Editor, index: number) {
  editor.commands.setTextSelection(cellPositions(editor)[index] + 2);
}

/** The text of every selected cell, in document order. */
function selectedTexts(editor: Editor): string[] {
  const sel = editor.state.selection;
  expect(sel).toBeInstanceOf(CellSelection);
  const out: { pos: number; text: string }[] = [];
  (sel as CellSelection).forEachCell((cell, pos) => out.push({ pos, text: cell.textContent }));
  return out.sort((a, b) => a.pos - b.pos).map((c) => c.text);
}

/** A table as the editor writes it, from rows of cells. */
function table(cols: number, rows: string[][]): string {
  return (
    `<table style="min-width: ${cols * 25}px;"><colgroup>${'<col style="min-width: 25px;">'.repeat(cols)}</colgroup><tbody>` +
    rows.map((r) => `<tr>${r.join("")}</tr>`).join("") +
    "</tbody></table>"
  );
}
const th = (text = "") => `<th colspan="1" rowspan="1"><p>${text}</p></th>`;
const td = (text = "") => `<td colspan="1" rowspan="1"><p>${text}</p></td>`;

/** A header row A B C and body rows d e f, g h i, then a paragraph. */
const GRID = `${table(3, [
  [th("A"), th("B"), th("C")],
  [td("d"), td("e"), td("f")],
  [td("g"), td("h"), td("i")],
])}<p>z</p>`;
/** The same without a header row. */
const PLAIN = `${table(3, [
  [td("A"), td("B"), td("C")],
  [td("d"), td("e"), td("f")],
  [td("g"), td("h"), td("i")],
])}<p>z</p>`;

const ALL_KEYS: TableActionKey[] = [
  "insert",
  "selectRow",
  "selectColumn",
  "addRowBefore",
  "addRowAfter",
  "addColumnBefore",
  "addColumnAfter",
  "moveRowUp",
  "moveRowDown",
  "moveColumnBefore",
  "moveColumnAfter",
  "deleteRow",
  "deleteColumn",
  "toggleHeaderRow",
  "mergeCells",
  "splitCell",
  "deleteTable",
];

describe("NEW_TABLE", () => {
  it("is three by three with a header row", () => {
    expect(NEW_TABLE).toEqual({ rows: 3, cols: 3, withHeaderRow: true });
  });
});

describe("tableHasHeaderRow", () => {
  const cell = (tag: "th" | "td", text: string) => `<${tag}><p>${text}</p></${tag}>`;
  const WITH_HEADER = `<table><tr>${cell("th", "A")}${cell("th", "B")}</tr><tr>${cell("td", "c")}${cell("td", "d")}</tr></table><p>z</p>`;

  it("is false outside a table", () => {
    const editor = editorWith(WITH_HEADER);
    caretIn(editor, "z");
    expect(tableHasHeaderRow(editor.state)).toBe(false);
  });

  it("is true in a body cell of a table whose first row is all header cells", () => {
    const editor = editorWith(WITH_HEADER);
    caretIn(editor, "c");
    expect(tableHasHeaderRow(editor.state)).toBe(true);
    caretIn(editor, "A");
    expect(tableHasHeaderRow(editor.state)).toBe(true);
  });

  it("is false when the first row mixes header and body cells (a header column)", () => {
    const editor = editorWith(
      `<table><tr>${cell("th", "A")}${cell("td", "B")}</tr><tr>${cell("th", "c")}${cell("td", "d")}</tr></table>`,
    );
    caretIn(editor, "c");
    expect(tableHasHeaderRow(editor.state)).toBe(false);
  });

  it("is false when only a later cell of the first row is a body cell", () => {
    const editor = editorWith(
      `<table><tr>${cell("th", "A")}${cell("th", "B")}${cell("td", "C")}</tr></table>`,
    );
    caretIn(editor, "A");
    expect(tableHasHeaderRow(editor.state)).toBe(false);
  });

  it("is false for a table without a header row", () => {
    const editor = editorWith(`<table><tr>${cell("td", "A")}</tr><tr>${cell("th", "c")}</tr></table>`);
    caretIn(editor, "c");
    expect(tableHasHeaderRow(editor.state)).toBe(false);
  });

  it("reads the table nearest the caret", () => {
    // Only the API can store a nested table; the menu reads the inner one.
    const editor = editorWith(
      `<table><tr><th><p>A</p><table><tr>${cell("td", "x")}</tr></table></th></tr></table>`,
    );
    caretIn(editor, "x");
    expect(tableHasHeaderRow(editor.state)).toBe(false);
    caretIn(editor, "A");
    expect(tableHasHeaderRow(editor.state)).toBe(true);
  });

  it("is false for a table whose first row has no cells", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [] },
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] },
              ],
            },
          ],
        },
      ],
    });
    caretIn(editor, "c");
    expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(0);
    expect(tableHasHeaderRow(editor.state)).toBe(false);
  });
});

describe("tableActionState", () => {
  it("offers only Insert outside a table", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "z");
    const state = tableActionState(editor);
    expect(state).toEqual({
      inTable: false,
      headerRow: false,
      rowCount: 0,
      columnCount: 0,
      firstRow: false,
      ...Object.fromEntries(ALL_KEYS.map((k) => [k, k === "insert"])),
    });
  });

  it("reads a caret in a middle body cell", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "e");
    expect(tableActionState(editor)).toEqual({
      inTable: true,
      headerRow: true,
      rowCount: 1,
      columnCount: 1,
      firstRow: false,
      insert: false,
      selectRow: true,
      selectColumn: true,
      addRowBefore: true,
      addRowAfter: true,
      addColumnBefore: true,
      addColumnAfter: true,
      // Row 1 does not move above the header row.
      moveRowUp: false,
      moveRowDown: true,
      moveColumnBefore: true,
      moveColumnAfter: true,
      deleteRow: true,
      deleteColumn: true,
      toggleHeaderRow: true,
      mergeCells: false,
      splitCell: false,
      deleteTable: true,
    });
  });

  it("counts the rows and columns a cell selection covers, and marks the first row", () => {
    const editor = editorWith(GRID);
    selectCells(editor, "B", "f");
    expect(tableActionState(editor)).toMatchObject({ rowCount: 2, columnCount: 2, firstRow: true });
    selectCells(editor, "d", "h");
    expect(tableActionState(editor)).toMatchObject({ rowCount: 2, columnCount: 2, firstRow: false });
  });

  describe("delete row / column", () => {
    it("refuses Delete row with every row selected, and Delete column with every column", () => {
      const editor = editorWith(GRID);
      selectCells(editor, "A", "i");
      const state = tableActionState(editor);
      expect(state).toMatchObject({ rowCount: 3, columnCount: 3, deleteRow: false, deleteColumn: false });
      // The engine's own `can()` would offer both.
      expect(editor.can().deleteRow()).toBe(true);
      expect(editor.can().deleteColumn()).toBe(true);
    });

    it("offers Delete row with some rows selected, and Delete column with some columns", () => {
      const editor = editorWith(GRID);
      // Every column of rows 1–2: rows yes, columns no.
      selectCells(editor, "d", "i");
      expect(tableActionState(editor)).toMatchObject({ deleteRow: true, deleteColumn: false });
      // Every row of columns 1–2: columns yes, rows no.
      selectCells(editor, "B", "i");
      expect(tableActionState(editor)).toMatchObject({ deleteRow: false, deleteColumn: true });
      // A last row alone, a last column alone.
      selectCells(editor, "g", "i");
      expect(tableActionState(editor)).toMatchObject({ deleteRow: true, deleteColumn: false });
      selectCells(editor, "C", "i");
      expect(tableActionState(editor)).toMatchObject({ deleteRow: false, deleteColumn: true });
    });

    it("does not run Delete row with every row selected", () => {
      const onUpdate = vi.fn();
      const editor = editorWith(GRID, onUpdate);
      selectCells(editor, "A", "i");
      const before = editor.getHTML();
      expect(runTableAction(editor, "deleteRow")).toBe(false);
      expect(runTableAction(editor, "deleteColumn")).toBe(false);
      expect(editor.getHTML()).toBe(before);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("deletes every row of a multi-row selection, and every column of a multi-column one", () => {
      const editor = editorWith(GRID);
      selectCells(editor, "d", "h");
      expect(runTableAction(editor, "deleteRow")).toBe(true);
      expect(editor.getHTML()).toBe(`${table(3, [[th("A"), th("B"), th("C")]])}<p>z</p>`);

      const other = editorWith(GRID);
      selectCells(other, "B", "f");
      expect(runTableAction(other, "deleteColumn")).toBe(true);
      expect(other.getHTML()).toBe(`${table(1, [[th("A")], [td("d")], [td("g")]])}<p>z</p>`);
    });
  });

  describe("add row above", () => {
    it("is refused in the first row of a table with a header row", () => {
      const editor = editorWith(GRID);
      caretIn(editor, "B");
      expect(tableActionState(editor)).toMatchObject({ addRowBefore: false, addRowAfter: true, firstRow: true });
      // A selection starting in the header row too.
      selectCells(editor, "A", "e");
      expect(tableActionState(editor).addRowBefore).toBe(false);
    });

    it("is offered in the first row of a table without a header row, and below the header row", () => {
      const plain = editorWith(PLAIN);
      caretIn(plain, "B");
      expect(tableActionState(plain)).toMatchObject({ addRowBefore: true, headerRow: false, firstRow: true });
      const editor = editorWith(GRID);
      caretIn(editor, "d");
      expect(tableActionState(editor).addRowBefore).toBe(true);
    });

    it("does not run above the header row, which the engine itself would do", () => {
      const onUpdate = vi.fn();
      const editor = editorWith(GRID, onUpdate);
      caretIn(editor, "A");
      expect(editor.can().addRowBefore()).toBe(true);
      expect(runTableAction(editor, "addRowBefore")).toBe(false);
      expect(editor.getHTML()).toBe(GRID);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("adds a body row above a body row", () => {
      const editor = editorWith(GRID);
      caretIn(editor, "g");
      expect(runTableAction(editor, "addRowBefore")).toBe(true);
      expect(editor.getHTML()).toBe(
        `${table(3, [
          [th("A"), th("B"), th("C")],
          [td("d"), td("e"), td("f")],
          [td(), td(), td()],
          [td("g"), td("h"), td("i")],
        ])}<p>z</p>`,
      );
    });
  });

  describe("move", () => {
    const moves = (editor: Editor) => {
      const s = tableActionState(editor);
      return {
        up: s.moveRowUp,
        down: s.moveRowDown,
        before: s.moveColumnBefore,
        after: s.moveColumnAfter,
      };
    };

    it("is refused at the edge it would cross", () => {
      const plain = editorWith(PLAIN);
      caretIn(plain, "A");
      expect(moves(plain)).toEqual({ up: false, down: true, before: false, after: true });
      caretIn(plain, "i");
      expect(moves(plain)).toEqual({ up: true, down: false, before: true, after: false });
      caretIn(plain, "e");
      expect(moves(plain)).toEqual({ up: true, down: true, before: true, after: true });
    });

    it("never crosses the header row", () => {
      const editor = editorWith(GRID);
      caretIn(editor, "B");
      expect(moves(editor)).toEqual({ up: false, down: false, before: true, after: true });
      caretIn(editor, "e");
      expect(moves(editor)).toMatchObject({ up: false, down: true });
      caretIn(editor, "h");
      expect(moves(editor)).toMatchObject({ up: true, down: false });
    });

    it("is refused with more than one row (rows) or column (columns) selected", () => {
      const plain = editorWith(PLAIN);
      selectCells(plain, "d", "e");
      expect(moves(plain)).toEqual({ up: true, down: true, before: false, after: false });
      selectCells(plain, "B", "e");
      expect(moves(plain)).toEqual({ up: false, down: false, before: true, after: true });
    });

    it("moves no row in a table with a cell over two rows, and still moves its columns", () => {
      const editor = editorWith(TABLE_ROWSPAN);
      // The last row's single cell: in the second column, below a body row.
      caretInCell(editor, 4);
      expect(tableActionState(editor)).toMatchObject({ rowCount: 1, columnCount: 1 });
      expect(moves(editor)).toEqual({ up: false, down: false, before: true, after: false });
    });

    it("moves no column in a table with a cell over two columns, and still moves its rows", () => {
      const editor = editorWith(TABLE_COLSPAN_HEADER);
      caretInCell(editor, 1);
      expect(moves(editor)).toEqual({ up: false, down: false, before: false, after: false });
      const plain = editorWith(
        `<table><tr><td colspan="2"><p>A</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table><p>z</p>`,
      );
      caretIn(plain, "c");
      expect(moves(plain)).toEqual({ up: true, down: false, before: false, after: false });
    });

    it("moves a row down and up, leaving it selected", () => {
      const onUpdate = vi.fn();
      const editor = editorWith(GRID, onUpdate);
      caretIn(editor, "d");
      expect(runTableAction(editor, "moveRowDown")).toBe(true);
      const moved = `${table(3, [
        [th("A"), th("B"), th("C")],
        [td("g"), td("h"), td("i")],
        [td("d"), td("e"), td("f")],
      ])}<p>z</p>`;
      expect(editor.getHTML()).toBe(moved);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
      expect(selectedTexts(editor)).toEqual(["d", "e", "f"]);

      expect(runTableAction(editor, "moveRowUp")).toBe(true);
      expect(editor.getHTML()).toBe(GRID);
      expect(selectedTexts(editor)).toEqual(["d", "e", "f"]);
    });

    it("moves a column after and before, leaving it selected", () => {
      const editor = editorWith(GRID);
      caretIn(editor, "e");
      expect(runTableAction(editor, "moveColumnAfter")).toBe(true);
      expect(editor.getHTML()).toBe(
        `${table(3, [
          [th("A"), th("C"), th("B")],
          [td("d"), td("f"), td("e")],
          [td("g"), td("i"), td("h")],
        ])}<p>z</p>`,
      );
      expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
      expect(selectedTexts(editor)).toEqual(["B", "e", "h"]);

      expect(runTableAction(editor, "moveColumnBefore")).toBe(true);
      expect(runTableAction(editor, "moveColumnBefore")).toBe(true);
      expect(editor.getHTML()).toBe(
        `${table(3, [
          [th("B"), th("A"), th("C")],
          [td("e"), td("d"), td("f")],
          [td("h"), td("g"), td("i")],
        ])}<p>z</p>`,
      );
      expect(selectedTexts(editor)).toEqual(["B", "e", "h"]);
    });

    it("carries a column's width with it", () => {
      const cell = (tag: string, w: number, text: string) =>
        `<${tag} colspan="1" rowspan="1" colwidth="${w}"><p>${text}</p></${tag}>`;
      const resized = (a: number, b: number, [x, y, u, v]: string[]) =>
        `<table style="width: ${a + b}px;"><colgroup><col style="width: ${a}px;"><col style="width: ${b}px;"></colgroup><tbody>` +
        `<tr>${cell("th", a, x)}${cell("th", b, y)}</tr><tr>${cell("td", a, u)}${cell("td", b, v)}</tr>` +
        "</tbody></table><p>z</p>";
      const editor = editorWith(resized(150, 200, ["A", "B", "c", "d"]));
      expect(editor.getHTML()).toBe(resized(150, 200, ["A", "B", "c", "d"]));
      caretIn(editor, "c");
      expect(runTableAction(editor, "moveColumnAfter")).toBe(true);
      expect(editor.getHTML()).toBe(resized(200, 150, ["B", "A", "d", "c"]));
    });

    it("does not run where its state refuses it", () => {
      const editor = editorWith(GRID);
      caretIn(editor, "e");
      expect(runTableAction(editor, "moveRowUp")).toBe(false);
      expect(editor.getHTML()).toBe(GRID);
    });
  });

  describe("select row / column", () => {
    it("selects the caret's row, in one transaction with no edit", () => {
      const onUpdate = vi.fn();
      const editor = editorWith(GRID, onUpdate);
      caretIn(editor, "e");
      const doc = editor.state.doc;
      const transactions = vi.fn();
      editor.on("transaction", transactions);
      expect(runTableAction(editor, "selectRow")).toBe(true);
      expect(transactions).toHaveBeenCalledTimes(1);
      expect(editor.state.doc).toBe(doc);
      expect(onUpdate).not.toHaveBeenCalled();
      const sel = editor.state.selection as CellSelection;
      expect(sel.isRowSelection()).toBe(true);
      expect(sel.isColSelection()).toBe(false);
      expect(selectedTexts(editor)).toEqual(["d", "e", "f"]);
      expect(tableActionState(editor)).toMatchObject({ rowCount: 1, columnCount: 3 });
    });

    it("selects the caret's column", () => {
      const onUpdate = vi.fn();
      const editor = editorWith(GRID, onUpdate);
      caretIn(editor, "e");
      expect(runTableAction(editor, "selectColumn")).toBe(true);
      const sel = editor.state.selection as CellSelection;
      expect(sel.isColSelection()).toBe(true);
      expect(sel.isRowSelection()).toBe(false);
      expect(selectedTexts(editor)).toEqual(["B", "e", "h"]);
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it("extends a multi-cell selection to whole rows / columns of its rectangle", () => {
      const editor = editorWith(GRID);
      selectCells(editor, "e", "i");
      expect(runTableAction(editor, "selectRow")).toBe(true);
      expect(selectedTexts(editor)).toEqual(["d", "e", "f", "g", "h", "i"]);
      expect(tableActionState(editor)).toMatchObject({ rowCount: 2, columnCount: 3 });

      selectCells(editor, "e", "i");
      expect(runTableAction(editor, "selectColumn")).toBe(true);
      expect(selectedTexts(editor)).toEqual(["B", "C", "e", "f", "h", "i"]);
      expect(tableActionState(editor)).toMatchObject({ rowCount: 3, columnCount: 2 });
    });

    it("selects both rows of a cell merged across two", () => {
      const editor = editorWith(TABLE_ROWSPAN);
      caretInCell(editor, 2);
      expect(tableActionState(editor)).toMatchObject({ rowCount: 2, columnCount: 1, firstRow: false });
      expect(runTableAction(editor, "selectRow")).toBe(true);
      const sel = editor.state.selection as CellSelection;
      expect(sel.isRowSelection()).toBe(true);
      const cells = cellPositions(editor);
      const covered: number[] = [];
      sel.forEachCell((_cell, pos) => covered.push(pos));
      expect(covered.sort((a, b) => a - b)).toEqual(cells.slice(2));
      expect(tableActionState(editor)).toMatchObject({ rowCount: 2, columnCount: 2 });
    });

    it("selects nothing outside a table", () => {
      const editor = editorWith(GRID);
      caretIn(editor, "z");
      expect(runTableAction(editor, "selectRow")).toBe(false);
      expect(runTableAction(editor, "selectColumn")).toBe(false);
      expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
    });
  });

  it("follows the engine for Merge and Split", () => {
    const editor = editorWith(GRID);
    selectCells(editor, "d", "e");
    expect(tableActionState(editor)).toMatchObject({ mergeCells: true, splitCell: false });
    expect(runTableAction(editor, "mergeCells")).toBe(true);
    caretIn(editor, "d");
    expect(tableActionState(editor)).toMatchObject({ mergeCells: false, splitCell: true });
    expect(runTableAction(editor, "splitCell")).toBe(true);
    expect(tableActionState(editor).splitCell).toBe(false);
  });

  it("toggles the header row from any row, and inserts a table outside one", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "h");
    expect(runTableAction(editor, "toggleHeaderRow")).toBe(true);
    expect(tableActionState(editor).headerRow).toBe(false);
    expect(runTableAction(editor, "deleteTable")).toBe(true);
    expect(editor.getHTML()).toBe("<p>z</p>");
    expect(runTableAction(editor, "deleteTable")).toBe(false);
    caretIn(editor, "z");
    expect(runTableAction(editor, "insert")).toBe(true);
    expect(tableActionState(editor)).toMatchObject({ inTable: true, rowCount: 1, columnCount: 1, headerRow: true });
  });
});

describe("the pinned merged tables", () => {
  it("are what the commands write", () => {
    const editor = editorWith("");
    editor.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: true });
    let cells = cellPositions(editor);
    editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[4] });
    editor.commands.mergeCells();
    expect(editor.getHTML()).toBe(`${TABLE_ROWSPAN}<p></p>`);

    editor.commands.setContent("", { emitUpdate: false });
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    cells = cellPositions(editor);
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
    editor.commands.mergeCells();
    expect(editor.getHTML()).toBe(`${TABLE_COLSPAN_HEADER}<p></p>`);
  });
});

describe("TABLE_ACTIONS", () => {
  it("lists every action once, with its label key and group, in the toolbar's order", () => {
    expect(TABLE_ACTIONS.map((a) => [a.key, a.labelKey, a.group])).toEqual([
      ["insert", "richText.tableInsert", "insert"],
      ["selectRow", "richText.tableSelectRow", "select"],
      ["selectColumn", "richText.tableSelectColumn", "select"],
      ["addRowBefore", "richText.tableAddRowBefore", "add"],
      ["addRowAfter", "richText.tableAddRowAfter", "add"],
      ["addColumnBefore", "richText.tableAddColumnBefore", "add"],
      ["addColumnAfter", "richText.tableAddColumnAfter", "add"],
      ["moveRowUp", "richText.tableMoveRowUp", "move"],
      ["moveRowDown", "richText.tableMoveRowDown", "move"],
      ["moveColumnBefore", "richText.tableMoveColumnBefore", "move"],
      ["moveColumnAfter", "richText.tableMoveColumnAfter", "move"],
      ["deleteRow", "richText.tableDeleteRow", "delete"],
      ["deleteColumn", "richText.tableDeleteColumn", "delete"],
      ["toggleHeaderRow", "richText.tableHeaderRow", "cell"],
      ["mergeCells", "richText.tableMergeCells", "cell"],
      ["splitCell", "richText.tableSplitCell", "cell"],
      ["deleteTable", "richText.tableDelete", "table"],
    ]);
    for (const action of TABLE_ACTIONS) expect(TABLE_ACTION[action.key]).toBe(action);
  });

  it("marks Header row as a checkbox and the two deletes as counted", () => {
    const special = TABLE_ACTIONS.filter((a) => a.checkedBy || a.countBy).map((a) => [
      a.key,
      a.checkedBy,
      a.countBy,
    ]);
    expect(special).toEqual([
      ["deleteRow", undefined, "rowCount"],
      ["deleteColumn", undefined, "columnCount"],
      ["toggleHeaderRow", "headerRow", undefined],
    ]);
  });
});

describe("tableActionCount", () => {
  it("counts the selection's rows / columns for the deletes, at least one, and nothing else", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "z");
    const outside = tableActionState(editor);
    expect(tableActionCount(TABLE_ACTION.deleteRow, outside)).toBe(1);
    selectCells(editor, "d", "i");
    const rows = tableActionState(editor);
    expect(tableActionCount(TABLE_ACTION.deleteRow, rows)).toBe(2);
    expect(tableActionCount(TABLE_ACTION.deleteColumn, rows)).toBe(3);
    expect(tableActionCount(TABLE_ACTION.addRowAfter, rows)).toBeUndefined();
  });
});

describe("menu sets", () => {
  const keys = (groups: { key: TableActionKey }[][]) => groups.map((g) => g.map((a) => a.key));

  it("orders each set", () => {
    expect(TABLE_MENU_SETS).toEqual({
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
    });
  });

  it("is the toolbar set without Insert in the right-click menu", () => {
    expect(TABLE_MENU_SETS.context).toEqual(TABLE_MENU_SETS.toolbar.slice(1));
  });

  it("shows Header row in the row menu on the first row only, and always in the full menus", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "e");
    const body = tableActionState(editor);
    expect(keys(tableMenuGroups("row", body))).toEqual([
      ["addRowBefore", "addRowAfter"],
      ["moveRowUp", "moveRowDown"],
      ["deleteRow"],
    ]);
    expect(keys(tableMenuGroups("toolbar", body))).toEqual(TABLE_MENU_SETS.toolbar);
    expect(keys(tableMenuGroups("context", body))).toEqual(TABLE_MENU_SETS.context);
    expect(keys(tableMenuGroups("column", body))).toEqual(TABLE_MENU_SETS.column);

    caretIn(editor, "B");
    expect(keys(tableMenuGroups("row", tableActionState(editor)))).toEqual(TABLE_MENU_SETS.row);
  });
});
