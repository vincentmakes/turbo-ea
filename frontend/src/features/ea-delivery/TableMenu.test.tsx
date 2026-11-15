/**
 * The toolbar's Table menu and the shared item renderer, on a headless editor
 * carrying the same nodes the document editor registers. The action model is
 * tested in `tableActions.test.ts`; the menu inside the real editor (focus,
 * stored markup) in `RichTextEditor.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CellSelection } from "@tiptap/pm/tables";
import Menu from "@mui/material/Menu";
import TableMenu from "./TableMenu";
import { tableActionItems } from "./tableActionItems";
import { TABLE_ACTION, tableActionState, type TableAction, type TableMenuSet } from "./tableActions";
import { createDocumentTableExtensions } from "./documentTableExtension";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

const cell = (tag: "th" | "td", text: string) => `<${tag}><p>${text}</p></${tag}>`;
/** A header row A B, body rows c d and e f, then a paragraph. */
const GRID =
  `<table><tr>${cell("th", "A")}${cell("th", "B")}</tr><tr>${cell("td", "c")}${cell("td", "d")}</tr>` +
  `<tr>${cell("td", "e")}${cell("td", "f")}</tr></table><p>z</p>`;

function editorWith(content: string): Editor {
  const editor = new Editor({ extensions: [StarterKit, ...createDocumentTableExtensions()], content });
  editors.push(editor);
  return editor;
}

function textAt(editor: Editor, text: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) at = pos;
  });
  expect(at).toBeGreaterThan(-1);
  return at;
}

function selectCells(editor: Editor, from: string, to: string) {
  const cellOf = (text: string) => editor.state.doc.resolve(textAt(editor, text)).before(-1);
  editor.commands.setCellSelection({ anchorCell: cellOf(from), headCell: cellOf(to) });
}

/** Every item of the open menu, checkbox items included, in order. */
const items = () => [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')];
const labels = () => items().map((i) => i.textContent);
const disabled = () =>
  items()
    .filter((i) => i.getAttribute("aria-disabled") === "true")
    .map((i) => i.getAttribute("data-testid"));

describe("TableMenu", () => {
  async function openMenu() {
    fireEvent.click(screen.getByText("table").closest("button")!);
    return screen.findByRole("menu");
  }

  it("lists the toolbar set in order, with a divider between its groups", async () => {
    const editor = editorWith(GRID);
    editor.commands.setTextSelection(textAt(editor, "d"));
    render(<TableMenu editor={editor} />);
    const menu = await openMenu();
    expect(labels()).toEqual([
      "Insert table",
      "Select row",
      "Select column",
      "Add row above",
      "Add row below",
      "Add column before",
      "Add column after",
      "Move row up",
      "Move row down",
      "Move column before",
      "Move column after",
      "Delete row",
      "Delete column",
      "checkHeader row",
      "Merge cells",
      "Split cell",
      "Delete table",
    ]);
    expect(menu.querySelectorAll("hr")).toHaveLength(6);
    // Row 1 does not move above the header row; the last column moves no further.
    expect(disabled()).toEqual([
      "table-insert",
      "table-moveRowUp",
      "table-moveColumnAfter",
      "table-mergeCells",
      "table-splitCell",
    ]);
  });

  it("counts the rows and columns a selection would delete", async () => {
    const editor = editorWith(GRID);
    selectCells(editor, "c", "e");
    render(<TableMenu editor={editor} />);
    await openMenu();
    expect(screen.getByTestId("table-deleteRow")).toHaveTextContent(/^Delete 2 rows$/);
    expect(screen.getByTestId("table-deleteColumn")).toHaveTextContent(/^Delete column$/);
  });

  it("follows the selection while open, and runs Select row on the editor", async () => {
    const editor = editorWith(GRID);
    editor.commands.setTextSelection(textAt(editor, "z"));
    render(<TableMenu editor={editor} />);
    await openMenu();
    expect(screen.getByTestId("table-selectRow")).toHaveAttribute("aria-disabled", "true");
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "d"));
    });
    await waitFor(() => expect(screen.getByTestId("table-selectRow")).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByTestId("table-selectRow"));
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});

describe("tableActionItems", () => {
  function Harness({ editor, set, onRun }: { editor: Editor; set: TableMenuSet; onRun: (a: TableAction) => void }) {
    const { t } = useTranslation("delivery");
    return (
      <Menu open anchorEl={document.body}>
        {tableActionItems({ set, state: tableActionState(editor), t, onRun })}
      </Menu>
    );
  }

  it("renders the row set, with Header row as a ticked checkbox on the first row", () => {
    const editor = editorWith(GRID);
    editor.commands.setTextSelection(textAt(editor, "B"));
    render(<Harness editor={editor} set="row" onRun={vi.fn()} />);
    expect(labels()).toEqual([
      "Add row above",
      "Add row below",
      "Move row up",
      "Move row down",
      "Delete row",
      "checkHeader row",
    ]);
    const toggle = screen.getByRole("menuitemcheckbox");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("data-testid", "table-toggleHeaderRow");
    // Above the header row, and across it.
    expect(disabled()).toEqual(["table-addRowBefore", "table-moveRowUp", "table-moveRowDown"]);
  });

  it("leaves Header row out of the row set below the first row, unticked where there is none", () => {
    const editor = editorWith(GRID);
    editor.commands.setTextSelection(textAt(editor, "d"));
    const { unmount } = render(<Harness editor={editor} set="row" onRun={vi.fn()} />);
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    unmount();

    editor.commands.toggleHeaderRow();
    editor.commands.setTextSelection(textAt(editor, "A"));
    render(<Harness editor={editor} set="row" onRun={vi.fn()} />);
    const toggle = screen.getByRole("menuitemcheckbox");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.textContent).toBe("Header row");
  });

  it("hands the clicked action to onRun", () => {
    const editor = editorWith(GRID);
    editor.commands.setTextSelection(textAt(editor, "c"));
    const onRun = vi.fn();
    render(<Harness editor={editor} set="column" onRun={onRun} />);
    expect(labels()).toEqual([
      "Add column before",
      "Add column after",
      "Move column before",
      "Move column after",
      "Delete column",
    ]);
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("table-moveColumnAfter"));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith(TABLE_ACTION.moveColumnAfter);
  });
});
