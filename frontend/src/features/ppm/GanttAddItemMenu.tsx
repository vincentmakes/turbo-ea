/**
 * What the Gantt's trailing "+" row creates.
 *
 * It used to open the work-package dialog outright, so a user who typed a
 * "task" there made a work package — which the Tasks tab never lists (#1111).
 * Asking is cheaper than explaining: three entries, the same three the toolbar
 * offers, so the empty row is a shortcut and not a fourth vocabulary.
 */

import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";

export interface GanttAddItemMenuProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onAddWbs: () => void;
  onAddMilestone: () => void;
  onAddTask: () => void;
}

export default function GanttAddItemMenu({
  anchorEl,
  onClose,
  onAddWbs,
  onAddMilestone,
  onAddTask,
}: GanttAddItemMenuProps) {
  const { t } = useTranslation("ppm");
  const pick = (action: () => void) => () => {
    onClose();
    action();
  };
  return (
    <Menu open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={onClose}>
      <MenuItem onClick={pick(onAddWbs)}>
        <ListItemIcon>
          <MaterialSymbol icon="add" size={18} />
        </ListItemIcon>
        <ListItemText>{t("addWbs")}</ListItemText>
      </MenuItem>
      <MenuItem onClick={pick(onAddMilestone)}>
        <ListItemIcon>
          <MaterialSymbol icon="flag" size={18} />
        </ListItemIcon>
        <ListItemText>{t("addMilestone")}</ListItemText>
      </MenuItem>
      <MenuItem onClick={pick(onAddTask)}>
        <ListItemIcon>
          <MaterialSymbol icon="add_task" size={18} />
        </ListItemIcon>
        <ListItemText>{t("createTask")}</ListItemText>
      </MenuItem>
    </Menu>
  );
}
