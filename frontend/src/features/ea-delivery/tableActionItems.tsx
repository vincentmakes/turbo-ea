import type { ReactElement } from "react";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  tableActionCount,
  tableMenuGroups,
  type TableAction,
  type TableActionState,
  type TableMenuSet,
} from "./tableActions";

/** A `delivery`-bound `t`. */
export type TableActionT = (key: string, options?: { count: number }) => string;

/**
 * One table menu's items, as a flat array of `MenuItem` / `Divider` elements:
 * MUI's `MenuList` moves the focus over its direct children only, so the
 * items go straight into a `Menu`, never inside a wrapper component.
 *
 * Each item carries `data-testid="table-<key>"`; Header row is a
 * `menuitemcheckbox` with a tick; an action its state refuses is disabled.
 */
export function tableActionItems({
  set,
  state,
  t,
  onRun,
}: {
  set: TableMenuSet;
  state: TableActionState;
  t: TableActionT;
  onRun: (action: TableAction) => void;
}): ReactElement[] {
  return tableMenuGroups(set, state).flatMap((group, i) => [
    ...(i > 0 ? [<Divider key={`divider-${i}`} />] : []),
    ...group.map((action) => {
      const checked = action.checkedBy ? state[action.checkedBy] : undefined;
      const count = tableActionCount(action, state);
      return (
        <MenuItem
          key={action.key}
          data-testid={`table-${action.key}`}
          disabled={!state[action.key]}
          onClick={() => onRun(action)}
          {...(checked === undefined ? {} : { role: "menuitemcheckbox", "aria-checked": checked })}
        >
          <ListItemIcon>{checked ? <MaterialSymbol icon="check" size={18} /> : null}</ListItemIcon>
          <ListItemText
            primary={count === undefined ? t(action.labelKey) : t(action.labelKey, { count })}
          />
        </MenuItem>
      );
    }),
  ]);
}
