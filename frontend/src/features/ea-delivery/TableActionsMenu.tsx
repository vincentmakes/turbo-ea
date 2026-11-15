import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import Menu from "@mui/material/Menu";
import { tableActionState, type TableAction } from "./tableActions";
import { tableActionItems } from "./tableActionItems";
import type { TableMenuStore } from "./tableMenuStore";

/**
 * The table actions menu a pointer or a grip opens (document variant only):
 * the set and the viewport point come from the editor's `TableMenuStore`, the
 * items and their enablement from `tableActions.ts`, acting on the editor's
 * selection as it is when the menu opens.
 *
 * Once the menu has closed (an action, Escape or a click outside) the focus
 * goes back to the editor with its selection unchanged. A right-click on the
 * menu or its backdrop closes it and never opens the browser's menu over it.
 */
export default function TableActionsMenu({ editor, store }: { editor: Editor; store: TableMenuStore }) {
  const { t } = useTranslation("delivery");
  const menu = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Selection changes do not re-render the editor on their own.
  const state = useEditorState({ editor, selector: ({ editor: e }) => tableActionState(e) });

  const act = (action: TableAction) => {
    action.run(editor);
    store.close();
  };

  return (
    <Menu
      open={menu.open}
      onClose={store.close}
      anchorReference="anchorPosition"
      anchorPosition={{ top: menu.top, left: menu.left }}
      // The focus goes to the editor, never to whatever held it before.
      disableRestoreFocus
      onContextMenu={(event) => {
        event.preventDefault();
        store.close();
      }}
      slotProps={{
        list: { "aria-label": t("richText.tableActions") },
        transition: {
          onExited: () => {
            if (!editor.isDestroyed) editor.commands.focus();
          },
        },
      }}
    >
      {tableActionItems({ set: menu.set, state, t, onRun: act })}
    </Menu>
  );
}
