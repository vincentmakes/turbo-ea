import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChainedCommands, Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { isInTable } from "@tiptap/pm/tables";
import { useEditorState } from "@tiptap/react";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";

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

/** What each item may do now, read from `editor.can()`. */
export interface TableMenuState {
  inTable: boolean;
  insert: boolean;
  addRowBefore: boolean;
  addRowAfter: boolean;
  addColumnBefore: boolean;
  addColumnAfter: boolean;
  deleteRow: boolean;
  deleteColumn: boolean;
  toggleHeaderRow: boolean;
  headerRow: boolean;
  mergeCells: boolean;
  splitCell: boolean;
  deleteTable: boolean;
}

/**
 * The menu's state for an editor. Inserting is refused inside a table: a
 * table nested in a cell is not offered (the command itself would allow it).
 */
export function tableMenuState(editor: Editor): TableMenuState {
  const inTable = isInTable(editor.state);
  const can = editor.can();
  return {
    inTable,
    insert: !inTable && can.insertTable(NEW_TABLE),
    addRowBefore: can.addRowBefore(),
    addRowAfter: can.addRowAfter(),
    addColumnBefore: can.addColumnBefore(),
    addColumnAfter: can.addColumnAfter(),
    deleteRow: can.deleteRow(),
    deleteColumn: can.deleteColumn(),
    toggleHeaderRow: can.toggleHeaderRow(),
    headerRow: tableHasHeaderRow(editor.state),
    mergeCells: can.mergeCells(),
    splitCell: can.splitCell(),
    deleteTable: can.deleteTable(),
  };
}

type ItemKey = Exclude<keyof TableMenuState, "inTable" | "headerRow">;

interface Item {
  key: ItemKey;
  label: string;
  run: (chain: ChainedCommands) => ChainedCommands;
}

/**
 * The editor's table button and its menu (document variant only).
 *
 * Columns are added "before" / "after" the current one, not left / right:
 * the commands insert at the previous / next column index, which sits to the
 * right / left of the current column in a right-to-left document.
 *
 * The command runs on the editor's own selection (kept while the menu holds
 * the focus); once the menu has closed the focus goes back to the editor.
 */
export default function TableMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation("delivery");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Set by an action: the menu's exit hands the focus to the editor.
  const acted = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Selection changes do not re-render the editor on their own.
  const state = useEditorState({ editor, selector: ({ editor: e }) => tableMenuState(e) });

  const groups: Item[][] = [
    [{ key: "insert", label: t("richText.tableInsert"), run: (c) => c.insertTable(NEW_TABLE) }],
    [
      { key: "addRowBefore", label: t("richText.tableAddRowBefore"), run: (c) => c.addRowBefore() },
      { key: "addRowAfter", label: t("richText.tableAddRowAfter"), run: (c) => c.addRowAfter() },
      {
        key: "addColumnBefore",
        label: t("richText.tableAddColumnBefore"),
        run: (c) => c.addColumnBefore(),
      },
      {
        key: "addColumnAfter",
        label: t("richText.tableAddColumnAfter"),
        run: (c) => c.addColumnAfter(),
      },
      { key: "deleteRow", label: t("richText.tableDeleteRow"), run: (c) => c.deleteRow() },
      { key: "deleteColumn", label: t("richText.tableDeleteColumn"), run: (c) => c.deleteColumn() },
    ],
    [
      { key: "toggleHeaderRow", label: t("richText.tableHeaderRow"), run: (c) => c.toggleHeaderRow() },
      { key: "mergeCells", label: t("richText.tableMergeCells"), run: (c) => c.mergeCells() },
      { key: "splitCell", label: t("richText.tableSplitCell"), run: (c) => c.splitCell() },
    ],
    [{ key: "deleteTable", label: t("richText.tableDelete"), run: (c) => c.deleteTable() }],
  ];

  const act = (item: Item) => {
    item.run(editor.chain()).run();
    acted.current = true;
    setAnchor(null);
  };

  return (
    <>
      <Tooltip title={t("richText.table")}>
        <IconButton
          ref={buttonRef}
          size="small"
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            borderRadius: 1,
            bgcolor: state.inTable ? "action.selected" : "transparent",
            mx: 0.15,
          }}
        >
          <MaterialSymbol icon="table" size={18} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        // After an action the focus goes to the editor, not back to the button.
        disableRestoreFocus
        slotProps={{
          transition: {
            onExited: () => {
              // Escape or a click outside: back to the button, as a menu's
              // focus would go.
              if (!acted.current) {
                buttonRef.current?.focus();
                return;
              }
              acted.current = false;
              if (!editor.isDestroyed) editor.commands.focus();
            },
          },
        }}
      >
        {groups.flatMap((group, i) => [
          ...(i > 0 ? [<Divider key={`divider-${i}`} />] : []),
          ...group.map((item) => {
            const toggle = item.key === "toggleHeaderRow";
            return (
              <MenuItem
                key={item.key}
                data-testid={`table-${item.key}`}
                disabled={!state[item.key]}
                onClick={() => act(item)}
                {...(toggle
                  ? { role: "menuitemcheckbox", "aria-checked": state.headerRow }
                  : {})}
              >
                <ListItemIcon>
                  {toggle && state.headerRow ? <MaterialSymbol icon="check" size={18} /> : null}
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </MenuItem>
            );
          }),
        ])}
      </Menu>
    </>
  );
}

