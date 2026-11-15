/**
 * The table menu's state, read from a headless editor carrying the same
 * nodes the document editor registers. The menu itself (items, actions,
 * focus) is driven through the real editor in `RichTextEditor.test.tsx`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NEW_TABLE, tableHasHeaderRow, tableMenuState } from "./TableMenu";
import { createDocumentTableExtensions } from "./documentTableExtension";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function editorWith(content: string | JSONContent): Editor {
  const editor = new Editor({
    extensions: [StarterKit, ...createDocumentTableExtensions()],
    content,
  });
  editors.push(editor);
  return editor;
}

/** Puts the caret in the text node whose text is exactly `text`. */
function caretIn(editor: Editor, text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos;
  });
  expect(at).toBeGreaterThan(-1);
  editor.commands.setTextSelection(at);
}

const cell = (tag: "th" | "td", text: string) => `<${tag}><p>${text}</p></${tag}>`;
const WITH_HEADER = `<table><tr>${cell("th", "A")}${cell("th", "B")}</tr><tr>${cell("td", "c")}${cell("td", "d")}</tr></table><p>z</p>`;

describe("NEW_TABLE", () => {
  it("is three by three with a header row", () => {
    expect(NEW_TABLE).toEqual({ rows: 3, cols: 3, withHeaderRow: true });
  });
});

describe("tableHasHeaderRow", () => {
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

describe("tableMenuState", () => {
  it("offers only Insert outside a table", () => {
    const editor = editorWith(WITH_HEADER);
    caretIn(editor, "z");
    expect(tableMenuState(editor)).toEqual({
      inTable: false,
      insert: true,
      addRowBefore: false,
      addRowAfter: false,
      addColumnBefore: false,
      addColumnAfter: false,
      deleteRow: false,
      deleteColumn: false,
      toggleHeaderRow: false,
      headerRow: false,
      mergeCells: false,
      splitCell: false,
      deleteTable: false,
    });
  });

  it("refuses Insert inside a table and reads the header row", () => {
    const editor = editorWith(WITH_HEADER);
    caretIn(editor, "d");
    expect(tableMenuState(editor)).toEqual({
      inTable: true,
      insert: false,
      addRowBefore: true,
      addRowAfter: true,
      addColumnBefore: true,
      addColumnAfter: true,
      deleteRow: true,
      deleteColumn: true,
      toggleHeaderRow: true,
      headerRow: true,
      mergeCells: false,
      splitCell: false,
      deleteTable: true,
    });
  });

  it("offers Merge for several cells and Split for a merged one", () => {
    const editor = editorWith(WITH_HEADER);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") cells.push(pos);
    });
    editor.commands.setCellSelection({ anchorCell: cells[2], headCell: cells[3] });
    expect(tableMenuState(editor)).toMatchObject({ inTable: true, mergeCells: true, splitCell: false });
    editor.commands.mergeCells();
    caretIn(editor, "c");
    expect(tableMenuState(editor)).toMatchObject({ mergeCells: false, splitCell: true });
  });
});
