import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { tableActionState, type TableAction } from "./tableActions";
import { tableActionItems } from "./tableActionItems";

/**
 * The editor's table button and its menu (document variant only): the
 * `toolbar` set of `tableActions.ts`, the complete keyboard path to every
 * table action.
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
  const state = useEditorState({ editor, selector: ({ editor: e }) => tableActionState(e) });

  const act = (action: TableAction) => {
    action.run(editor);
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
        {tableActionItems({ set: "toolbar", state, t, onRun: act })}
      </Menu>
    </>
  );
}

