/**
 * The table actions menu on a headless editor carrying the document's table
 * nodes, opened through its store. The plugin that opens it on a right-click
 * is tested inside the real editor in `RichTextEditor.test.tsx`.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableActionsMenu from "./TableActionsMenu";
import { createDocumentTableExtensions } from "./documentTableExtension";
import { createTableMenuStore, type TableMenuStore } from "./tableMenuStore";

// jsdom has no layout methods on Range; ProseMirror measures the selection
// after a focused dispatch. Zero rects is the honest answer (as in
// `RichTextEditor.test.tsx`).
beforeAll(() => {
  const empty = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= () => empty;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) {
    const editor = editors.pop()!;
    const element = editor.options.element as HTMLElement | null;
    editor.destroy();
    element?.remove();
  }
});

const cell = (tag: "th" | "td", text: string) => `<${tag}><p>${text}</p></${tag}>`;
/** A header row A B, a body row c d, then a paragraph. */
const GRID =
  `<table><tr>${cell("th", "A")}${cell("th", "B")}</tr><tr>${cell("td", "c")}${cell("td", "d")}</tr></table>` +
  "<p>z</p>";

function setup(): { editor: Editor; store: TableMenuStore } {
  // Attached to the page, so the focus can be checked.
  const element = document.body.appendChild(document.createElement("div"));
  const editor = new Editor({
    element,
    extensions: [StarterKit, ...createDocumentTableExtensions()],
    content: GRID,
  });
  editors.push(editor);
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "c") at = pos;
  });
  editor.commands.setTextSelection(at);
  const store = createTableMenuStore();
  render(<TableActionsMenu editor={editor} store={store} />);
  return { editor, store };
}

const labels = () =>
  [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map((i) => i.textContent);

describe("TableActionsMenu", () => {
  it("renders nothing while the store is closed", () => {
    setup();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the store's set as a labelled menu at the store's point", async () => {
    const { store } = setup();
    act(() => store.open({ set: "context", top: 120, left: 240 }));
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("aria-label", "Table actions");
    expect(labels()).toEqual([
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
      // The table has a header row: the item's tick ligature reads "check".
      "checkHeader row",
      "Merge cells",
      "Split cell",
      "Delete table",
    ]);
    // jsdom measures the paper as 0×0, so it sits exactly at the point.
    const paper = menu.closest(".MuiPaper-root") as HTMLElement;
    expect(paper.style.top).toBe("120px");
    expect(paper.style.left).toBe("240px");
  });

  it("renders the set the store names (the column grip's)", async () => {
    const { store } = setup();
    act(() => store.open({ set: "column", top: 50, left: 50 }));
    await screen.findByRole("menu");
    expect(labels()).toEqual([
      "Add column before",
      "Add column after",
      "Move column before",
      "Move column after",
      "Delete column",
    ]);
  });

  it("runs an action on the editor's selection and closes the store", async () => {
    const { editor, store } = setup();
    act(() => store.open({ set: "context", top: 50, left: 50 }));
    await screen.findByRole("menu");
    fireEvent.click(screen.getByTestId("table-addRowAfter"));
    expect(store.isOpen()).toBe(false);
    expect(editor.getHTML()).toContain(
      '<tr><td colspan="1" rowspan="1"><p></p></td><td colspan="1" rowspan="1"><p></p></td></tr></tbody>',
    );
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("does not run a disabled action", async () => {
    const { editor, store } = setup();
    const before = editor.getHTML();
    act(() => store.open({ set: "context", top: 50, left: 50 }));
    await screen.findByRole("menu");
    // Merging needs a cell selection.
    expect(screen.getByTestId("table-mergeCells")).toHaveAttribute("aria-disabled", "true");
    expect(editor.getHTML()).toBe(before);
  });

  it("closes the store on Escape and gives the editor the focus with its selection kept", async () => {
    const { editor, store } = setup();
    const selection = editor.state.selection;
    act(() => store.open({ set: "context", top: 50, left: 50 }));
    const menu = await screen.findByRole("menu");
    expect(editor.view.dom).not.toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(store.isOpen()).toBe(false);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(editor.view.dom).toHaveFocus());
    expect(editor.state.selection.eq(selection)).toBe(true);
  });

  it("gives the editor the focus after an action too", async () => {
    const { editor, store } = setup();
    act(() => store.open({ set: "context", top: 50, left: 50 }));
    await screen.findByRole("menu");
    fireEvent.click(screen.getByTestId("table-selectRow"));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(editor.view.dom).toHaveFocus());
  });

  it("prevents a right-click on the open menu and closes it", async () => {
    const { store } = setup();
    act(() => store.open({ set: "context", top: 50, left: 50 }));
    const menu = await screen.findByRole("menu");
    expect(fireEvent.contextMenu(menu)).toBe(false);
    expect(store.isOpen()).toBe(false);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
