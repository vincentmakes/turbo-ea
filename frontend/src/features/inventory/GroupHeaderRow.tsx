import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { GridApi, IRowNode } from "ag-grid-community";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useIsRtl } from "@/hooks/useIsRtl";
import type { InventoryRow } from "./inventoryGrouping";

/** Handlers InventoryPage exposes to the header rows via the grid `context`. */
export interface GroupRowContext {
  toggleGroupCollapse: (key: string) => void;
  selectGroup: (key: string, select: boolean) => void;
  getGroupMemberNodes: (key: string) => IRowNode<InventoryRow>[];
}

interface Props {
  data?: InventoryRow;
  api: GridApi;
  context?: GroupRowContext;
}

/**
 * Full-width group header row for the inventory grid's group-by mode.
 *
 * The checkbox selects/deselects every *displayed* member of the group — the
 * update mechanic is select + mass edit (deliberately no drag-and-drop,
 * discussion #933). Checked/indeterminate state is derived from the grid's own
 * selection, recomputed on every selectionChanged/modelUpdated event, so the
 * header can never disagree with the selection toolbar.
 */
export default function GroupHeaderRow({ data, api, context }: Props) {
  const { t } = useTranslation(["inventory"]);
  const isRtl = useIsRtl();
  const info = data?.__group;

  const [memberState, setMemberState] = useState({ displayed: 0, selected: 0 });

  useEffect(() => {
    if (!info || !context) return;
    const compute = () => {
      const nodes = context.getGroupMemberNodes(info.key);
      let selected = 0;
      for (const n of nodes) if (n.isSelected()) selected++;
      setMemberState({ displayed: nodes.length, selected });
    };
    compute();
    api.addEventListener("selectionChanged", compute);
    api.addEventListener("modelUpdated", compute);
    return () => {
      // The grid may already be destroyed when the row unmounts.
      try {
        api.removeEventListener("selectionChanged", compute);
        api.removeEventListener("modelUpdated", compute);
      } catch {
        // ignore
      }
    };
  }, [api, context, info]);

  const handleToggle = useCallback(() => {
    if (info && context) context.toggleGroupCollapse(info.key);
  }, [context, info]);

  if (!info) return null;

  // A collapsed group has no member rows in the grid — fall back to the
  // sidebar-filtered count (column filters auto-expand groups, so the two
  // regimes never overlap).
  const displayed = info.collapsed ? info.count : memberState.displayed;
  const allSelected = memberState.selected > 0 && memberState.selected >= memberState.displayed;
  const countLabel =
    !info.collapsed && memberState.displayed < info.count
      ? `${memberState.displayed}/${info.count}`
      : `${displayed}`;

  return (
    <Box
      onClick={handleToggle}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        height: "100%",
        px: 1,
        bgcolor: "action.hover",
        borderBottom: 1,
        borderColor: "divider",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <MaterialSymbol
        icon="expand_more"
        size={20}
        style={{
          transform: info.collapsed ? `rotate(${isRtl ? 90 : -90}deg)` : undefined,
          transition: "transform 0.15s",
        }}
      />
      <Checkbox
        size="small"
        checked={!info.collapsed && allSelected}
        indeterminate={!info.collapsed && memberState.selected > 0 && !allSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => context?.selectGroup(info.key, e.target.checked)}
        inputProps={{ "aria-label": t("groupBy.selectGroup", { group: info.label }) }}
        sx={{ p: 0.5 }}
      />
      <Typography variant="body2" fontWeight={600} noWrap>
        {info.label}
      </Typography>
      <Chip label={countLabel} size="small" sx={{ height: 20 }} />
    </Box>
  );
}
