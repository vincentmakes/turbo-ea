/**
 * The row and column handles' targets (`handleTargets`, pure, on the state of
 * a headless editor carrying the document editor's table nodes) and the
 * handles plugin's hover state. What the handles look like and do in the
 * mounted editor is covered in `RichTextEditor.test.tsx`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CellSelection } from "@tiptap/pm/tables";
import { TABLE_COLSPAN_HEADER, TABLE_ROWSPAN } from "@/test/fixtures/tableMarkup";
import { createDocumentTableExtensions } from "./documentTableExtension";
import { NO_HANDLES, handleTargets, tableHandlesKey, type TableHandleLabels } from "./tableHandles";
import { createTableMenuStore } from "./tableMenuStore";

const LABELS: TableHandleLabels = {
  row: "Row",
  column: "Column",
  "insert-row": "Insert row",
  "insert-column": "Insert column",
  "append-row": "Append row",
  "append-column": "Append column",
};

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
  document.body.innerHTML = "";
});

/** An editor with the plugin, mounted in the page (its decorations are drawn, it can take the focus). */
function editorWith(content: string): Editor {
  const element = document.body.appendChild(document.createElement("div"));
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      ...createDocumentTableExtensions({
        menuStore: createTableMenuStore(),
        handleLabels: { current: LABELS },
      }),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

function table(cols: number, rows: string[][]): string {
  return (
    `<table style="min-width: ${cols * 25}px;"><colgroup>${'<col style="min-width: 25px;">'.repeat(cols)}</colgroup><tbody>` +
    rows.map((r) => `<tr>${r.join("")}</tr>`).join("") +
    "</tbody></table>"
  );
}
const th = (text = "") => `<th colspan="1" rowspan="1"><p>${text}</p></th>`;
const td = (text = "", rowspan = 1) => `<td colspan="1" rowspan="${rowspan}"><p>${text}</p></td>`;

/** A header row A B C and body rows d e f, g h i, then a paragraph. */
const GRID = `${table(3, [
  [th("A"), th("B"), th("C")],
  [td("d"), td("e"), td("f")],
  [td("g"), td("h"), td("i")],
])}<p>z</p>`;

/** The position of the cell holding the text `text`. */
function cellOf(editor: Editor, text: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos;
  });
  expect(at, `no text "${text}"`).toBeGreaterThan(-1);
  return editor.state.doc.resolve(at).before(-1);
}

/** Every cell's position, in document order. */
function cellPositions(editor: Editor): number[] {
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    const role = node.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") cells.push(pos);
  });
  return cells;
}

/** The targets as cell texts, for a table whose cells carry text. */
function named(editor: Editor, hover: string | null, caret: boolean) {
  const targets = handleTargets(editor.state, hover === null ? null : cellOf(editor, hover), { caret });
  const text = (pos: number) => editor.state.doc.nodeAt(pos)!.textContent;
  return Object.fromEntries(
    Object.entries(targets).map(([kind, cells]) => [kind, (cells as number[]).map(text)]),
  );
}

const caretIn = (editor: Editor, text: string) => {
  editor.commands.setTextSelection(cellOf(editor, text) + 2);
};

describe("handleTargets", () => {
  it("gives nothing outside a table, and ignores a hover that is not a cell", () => {
    const editor = editorWith(GRID);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(handleTargets(editor.state, null, { caret: true })).toEqual(NO_HANDLES);
    // The position of the paragraph after the table.
    const paragraph = editor.state.doc.content.size - 3;
    expect(editor.state.doc.nodeAt(paragraph)?.type.name).toBe("paragraph");
    expect(handleTargets(editor.state, paragraph, { caret: true })).toEqual(NO_HANDLES);
  });

  it("puts every handle on a corner cell's row and column, the bars along the last row and column", () => {
    const editor = editorWith(GRID);
    expect(named(editor, "A", false)).toEqual({
      rowGrips: ["A"],
      columnGrips: ["A"],
      rowInserts: ["A"],
      columnInserts: ["A"],
      appendRow: ["g", "h", "i"],
      appendColumn: ["C", "f", "i"],
    });
  });

  it("puts a middle cell's grips on its row's first cell and its column's top cell", () => {
    const editor = editorWith(GRID);
    expect(named(editor, "e", false)).toMatchObject({
      rowGrips: ["d"],
      columnGrips: ["B"],
      rowInserts: ["d"],
      columnInserts: ["B"],
    });
  });

  it("draws no '+' on the table's last border, where the append bar is", () => {
    const editor = editorWith(GRID);
    expect(named(editor, "i", false)).toMatchObject({
      rowGrips: ["g"],
      columnGrips: ["C"],
      rowInserts: [],
      columnInserts: [],
    });
    expect(named(editor, "h", false)).toMatchObject({ rowInserts: [], columnInserts: ["B"] });
    expect(named(editor, "f", false)).toMatchObject({ rowInserts: ["d"], columnInserts: [] });
  });

  it("shows the hovered row and the caret's row, each once", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "i");
    expect(named(editor, "e", true)).toMatchObject({
      rowGrips: ["d", "g"],
      columnGrips: ["B", "C"],
      rowInserts: ["d"],
      columnInserts: ["B"],
    });
    // Without the caret (the editor is blurred) only the hover counts.
    expect(named(editor, "e", false)).toMatchObject({ rowGrips: ["d"], columnGrips: ["B"] });
    // Hover and caret in the same cell: one set.
    expect(named(editor, "i", true)).toMatchObject({ rowGrips: ["g"], columnGrips: ["C"] });
    // In the same row, different columns: one row grip, two column grips.
    expect(named(editor, "g", true)).toMatchObject({ rowGrips: ["g"], columnGrips: ["A", "C"] });
  });

  it("follows the caret with no hover, only when the caret counts", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "e");
    expect(named(editor, null, true)).toEqual({
      rowGrips: ["d"],
      columnGrips: ["B"],
      rowInserts: ["d"],
      columnInserts: ["B"],
      appendRow: ["g", "h", "i"],
      appendColumn: ["C", "f", "i"],
    });
    expect(handleTargets(editor.state, null, { caret: false })).toEqual(NO_HANDLES);
  });

  it("takes a cell selection's head cell as the caret", () => {
    const editor = editorWith(GRID);
    editor.commands.setCellSelection({ anchorCell: cellOf(editor, "A"), headCell: cellOf(editor, "h") });
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect(named(editor, null, true)).toMatchObject({ rowGrips: ["g"], columnGrips: ["B"] });
  });

  it("gives a cell merged across two rows one grip, and no '+' when the span ends the table", () => {
    const editor = editorWith(TABLE_ROWSPAN);
    // (0,0) (0,1) / merged (1,1) / (2,1)
    const [h0, h1, merged, b1, c1] = cellPositions(editor);
    for (const hover of [b1, c1, merged]) {
      expect(handleTargets(editor.state, hover, { caret: false })).toMatchObject({
        rowGrips: [merged],
        rowInserts: [],
      });
    }
    expect(handleTargets(editor.state, c1, { caret: false })).toEqual({
      rowGrips: [merged],
      columnGrips: [h1],
      rowInserts: [],
      columnInserts: [],
      appendRow: [merged, c1],
      appendColumn: [h1, b1, c1],
    });
    expect(handleTargets(editor.state, h1, { caret: false })).toMatchObject({
      rowGrips: [h0],
      rowInserts: [h0],
    });
  });

  it("puts the '+' after the last row a merged first-column cell spans", () => {
    const editor = editorWith(
      `${table(2, [[th("A"), th("B")], [td("m", 2), td("b")], [td("c")], [td("d"), td("e")]])}<p>z</p>`,
    );
    for (const hover of ["b", "c", "m"]) {
      expect(named(editor, hover, false)).toMatchObject({ rowGrips: ["m"], rowInserts: ["m"] });
    }
    expect(named(editor, "e", false)).toMatchObject({ rowGrips: ["d"], rowInserts: [] });
  });

  it("gives a header cell merged across two columns one grip for both", () => {
    const editor = editorWith(TABLE_COLSPAN_HEADER);
    const [header, b0, b1] = cellPositions(editor);
    for (const hover of [b0, b1, header]) {
      expect(handleTargets(editor.state, hover, { caret: false })).toMatchObject({
        columnGrips: [header],
        columnInserts: [],
      });
    }
    expect(handleTargets(editor.state, b0, { caret: false })).toEqual({
      rowGrips: [b0],
      columnGrips: [header],
      rowInserts: [],
      columnInserts: [],
      appendRow: [b0, b1],
      appendColumn: [header, b1],
    });
  });

  it("uses the innermost table of a nested one, and leaves out a caret in another table", () => {
    const inner = table(2, [[td("i1"), td("i2")], [td("i3"), td("i4")]]);
    const editor = editorWith(
      `${table(2, [[`<td colspan="1" rowspan="1"><p>o1</p>${inner}</td>`, td("o2")]])}<p>z</p>`,
    );
    expect(named(editor, "i4", false)).toEqual({
      rowGrips: ["i3"],
      columnGrips: ["i2"],
      rowInserts: [],
      columnInserts: [],
      appendRow: ["i3", "i4"],
      appendColumn: ["i2", "i4"],
    });
    caretIn(editor, "i1");
    expect(named(editor, null, true)).toMatchObject({ rowGrips: ["i1"], columnGrips: ["i1"] });
    // The hover's table wins; the caret, in the inner table, is not added.
    expect(named(editor, "o2", true)).toMatchObject({
      rowGrips: ["o1i1i2i3i4"],
      columnGrips: ["o2"],
      appendRow: ["o1i1i2i3i4", "o2"],
    });
  });
});

describe("the handles plugin's hover", () => {
  const hover = (editor: Editor) => tableHandlesKey.getState(editor.state)?.hover;
  const setHover = (editor: Editor, pos: number | null) =>
    editor.view.dispatch(editor.state.tr.setMeta(tableHandlesKey, { hover: pos }));

  it("starts empty, is set and cleared by its meta, and never changes the document", () => {
    const editor = editorWith(GRID);
    const html = editor.getHTML();
    expect(hover(editor)).toBeNull();
    setHover(editor, cellOf(editor, "e"));
    expect(hover(editor)).toBe(cellOf(editor, "e"));
    setHover(editor, null);
    expect(hover(editor)).toBeNull();
    expect(editor.getHTML()).toBe(html);
  });

  it("is kept by a selection change and follows its cell through an edit", () => {
    const editor = editorWith(GRID);
    setHover(editor, cellOf(editor, "e"));
    const before = tableHandlesKey.getState(editor.state);
    caretIn(editor, "A");
    expect(tableHandlesKey.getState(editor.state)).toBe(before);
    editor.commands.insertContentAt(cellOf(editor, "A") + 2, "xy");
    expect(hover(editor)).toBe(cellOf(editor, "e"));
    expect(editor.state.doc.nodeAt(hover(editor)!)!.textContent).toBe("e");
  });

  it("follows its cell when a column is inserted before it", () => {
    const editor = editorWith(GRID);
    setHover(editor, cellOf(editor, "e"));
    caretIn(editor, "e");
    editor.commands.addColumnBefore();
    expect(editor.state.doc.nodeAt(hover(editor)!)!.textContent).toBe("e");
  });

  it("is cleared when its cell is deleted, even when another cell takes its place", () => {
    const editor = editorWith(GRID);
    setHover(editor, cellOf(editor, "e"));
    caretIn(editor, "e");
    editor.commands.deleteColumn();
    // "f" now starts where "e" did.
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).not.toContain("e");
    expect(hover(editor)).toBeNull();
  });

  it("is cleared when its row is deleted", () => {
    const editor = editorWith(GRID);
    setHover(editor, cellOf(editor, "e"));
    caretIn(editor, "e");
    editor.commands.deleteRow();
    expect(hover(editor)).toBeNull();
  });

  it("is cleared when the editor locks or unlocks", () => {
    const editor = editorWith(GRID);
    setHover(editor, cellOf(editor, "e"));
    editor.view.dispatch(editor.state.tr.setMeta("editableChanged", true));
    expect(hover(editor)).toBeNull();
  });
});

describe("the handles plugin's widgets", () => {
  const handles = (editor: Editor) =>
    Array.from(editor.view.dom.querySelectorAll("[data-table-handle]")).map((el) => ({
      kind: el.getAttribute("data-table-handle"),
      cell: (el.parentElement as HTMLElement).textContent!.replace(/drag_indicator|add/g, ""),
      label: el.getAttribute("aria-label"),
    }));
  const setHover = (editor: Editor, text: string | null) =>
    editor.view.dispatch(
      editor.state.tr.setMeta(tableHandlesKey, { hover: text === null ? null : cellOf(editor, text) }),
    );

  it("draws one widget per target, labelled, the append bars on their first segment only", () => {
    const editor = editorWith(GRID);
    expect(handles(editor)).toEqual([]);
    setHover(editor, "e");
    expect(handles(editor)).toEqual([
      { kind: "column", cell: "B", label: "Column" },
      { kind: "insert-column", cell: "B", label: "Insert column" },
      { kind: "append-column", cell: "C", label: "Append column" },
      { kind: "row", cell: "d", label: "Row" },
      { kind: "insert-row", cell: "d", label: "Insert row" },
      { kind: "append-column", cell: "f", label: null },
      { kind: "append-row", cell: "g", label: "Append row" },
      { kind: "append-row", cell: "h", label: null },
      { kind: "append-row", cell: "i", label: null },
      { kind: "append-column", cell: "i", label: null },
    ]);
    setHover(editor, null);
    expect(handles(editor)).toEqual([]);
  });

  it("keeps a handle's element while it stays, and draws none in a locked editor", () => {
    const editor = editorWith(GRID);
    setHover(editor, "e");
    const grip = editor.view.dom.querySelector('[data-table-handle="row"]');
    setHover(editor, "f");
    expect(editor.view.dom.querySelector('[data-table-handle="row"]')).toBe(grip);
    editor.setEditable(false, false);
    setHover(editor, "e");
    expect(handles(editor)).toEqual([]);
  });

  it("shows the caret's handles only while the editor has the focus", () => {
    const editor = editorWith(GRID);
    caretIn(editor, "e");
    expect(handles(editor)).toEqual([]);
    editor.view.focus();
    expect(editor.isFocused).toBe(true);
    expect(handles(editor).filter((h) => h.kind === "row")).toEqual([
      { kind: "row", cell: "d", label: "Row" },
    ]);
    (editor.view.dom as HTMLElement).blur();
    expect(editor.isFocused).toBe(false);
    expect(handles(editor)).toEqual([]);
  });
});
