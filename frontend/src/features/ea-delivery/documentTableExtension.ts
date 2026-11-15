import type { AnyExtension } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { columnResizing, tableEditing } from "@tiptap/pm/tables";

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
 */
const DocumentTable = Table.extend({
  addProseMirrorPlugins() {
    return [
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

/** The table nodes every document-variant editor registers, read-only included. */
export function createDocumentTableExtensions(): AnyExtension[] {
  return [
    DocumentTable.configure({
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
