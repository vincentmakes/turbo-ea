import type { AnyExtension } from "@tiptap/core";
import { Table, TableCell, type TableOptions, TableHeader, TableRow } from "@tiptap/extension-table";
import { columnResizing, tableEditing } from "@tiptap/pm/tables";
import { tableContextMenu } from "./tableContextMenu";
import { tableHandles, type TableHandleLabels } from "./tableHandles";
import type { TableMenuStore } from "./tableMenuStore";

/**
 * Tables in decision and SoAW sections (the document variant only; a comment
 * has no table nodes, so a table pasted there flattens to its paragraphs).
 *
 * TipTap's `Table` decides at construction whether columns can be resized:
 * it registers `columnResizing` (and leaves the table's node view to that
 * plugin) only when the editor is editable at that moment. This editor is
 * built once and locked or unlocked afterwards (`readOnly` → `setEditable`),
 * so a decision opened locked and then unlocked (a recalled decision) would
 * never resize. Instead `columnResizing` is ALWAYS registered: prosemirror-tables
 * checks `view.editable` in each of its mouse handlers (move, leave, down)
 * when the event happens, so a locked editor neither shows a handle nor
 * resizes, and an unlocked one resizes without a remount. A handle already
 * showing when the editor locks is a decoration left behind; the editor's
 * CSS hides it while not editable.
 *
 * The table's node view comes from the plugin too (`addNodeView` returns
 * null, as TipTap does for a resizable table): its `TableView` keeps the
 * `<colgroup>` in step with the cells' `colwidth` while editing and wraps the
 * table in `div.tableWrapper`, which `renderWrapper: false` keeps out of
 * `getHTML()`.
 *
 * With a `menuStore`, the right-click menu's plugin (`tableContextMenu.ts`)
 * comes first. Its listeners sit on the editor's root in the capture phase,
 * so they run before every plugin's DOM handlers whatever the order; a
 * right-button press it prevents never reaches `columnResizing`, which has no
 * button check and would start a resize drag. With `handleLabels` as well,
 * the row and column handles (`tableHandles.ts`) are drawn too; their
 * widgets stop every event themselves, so their order does not matter.
 */
type DocumentTableOptions = TableOptions & {
  menuStore: TableMenuStore | null;
  handleLabels: { current: TableHandleLabels } | null;
};

const DocumentTable = Table.extend<DocumentTableOptions>({
  addOptions() {
    return { ...this.parent!(), menuStore: null, handleLabels: null };
  },
  addProseMirrorPlugins() {
    const { menuStore, handleLabels } = this.options;
    return [
      ...(menuStore ? [tableContextMenu(menuStore)] : []),
      ...(menuStore && handleLabels
        ? [tableHandles({ editor: this.editor, store: menuStore, labels: handleLabels })]
        : []),
      columnResizing({
        handleWidth: this.options.handleWidth,
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.cellMinWidth,
        View: this.options.View,
        lastColumnResizable: this.options.lastColumnResizable,
      }),
      tableEditing({ allowTableNodeSelection: false }),
    ];
  },
  addNodeView() {
    return null;
  },
});

/**
 * The table nodes every document-variant editor registers, read-only
 * included. A `menuStore` adds the right-click menu, which opens through it;
 * without one there is none. A `menuStore` with `handleLabels` (read each
 * time the handles are drawn) adds the row and column handles.
 */
export function createDocumentTableExtensions(
  options: { menuStore?: TableMenuStore; handleLabels?: { current: TableHandleLabels } } = {},
): AnyExtension[] {
  return [
    DocumentTable.configure({
      menuStore: options.menuStore ?? null,
      handleLabels: options.handleLabels ?? null,
      resizable: true,
      renderWrapper: false,
      lastColumnResizable: true,
      allowTableNodeSelection: false,
    }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}
