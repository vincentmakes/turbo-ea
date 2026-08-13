import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import type { AgGridReact } from "ag-grid-react";
import type { GridApi, IRowNode } from "ag-grid-community";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useIsRtl } from "@/hooks/useIsRtl";
import {
  buildGroupedRows,
  glueGroups,
  groupKeyOn,
  type GroupAxis,
  type GroupedRow,
} from "./rowGrouping";

/**
 * Stateful half of grid row grouping (see rowGrouping.ts): collapse state,
 * group-header selection, representative members under active grid filters,
 * and the grid props that wire it all into an AG Grid Community instance.
 *
 * Usage (see InventoryPage for the full-featured wiring, RiskRegisterPage /
 * AdrGrid for the minimal one):
 *
 *   const grouping = useRowGrouping(gridRef, { rows, axes, groupBy });
 *   <AgGridReact
 *     rowData={grouping.rowData}
 *     {...grouping.gridProps}
 *     getRowId={(p) => grouping.groupRowId(p.data)}
 *     onFilterChanged={grouping.handleFilterChanged}   // or chain into yours
 *     onModelUpdated={grouping.handleModelUpdated}     // or chain into yours
 *   />
 *
 * Pages with their own onRowClicked / getRowStyle / selection handlers must
 * early-return on `grouping.isGroupRow(data)`.
 */

/** Handlers the header rows receive via the grid `context`. */
export interface GroupRowContext {
  toggleGroupCollapse: (key: string) => void;
  selectGroup: (key: string, select: boolean) => void;
  getGroupMemberNodes: (key: string) => IRowNode[];
  /** Whether this grid has row selection — hides the header checkbox when not. */
  selectable: boolean;
}

interface GroupHeaderRowProps {
  data?: GroupedRow<unknown>;
  api: GridApi;
  context?: GroupRowContext;
}

/**
 * Full-width group header row: chevron, optional select-all checkbox, label,
 * count chip. The checkbox selects every *displayed* member of the group —
 * the update mechanic is select + the page's own bulk actions (deliberately
 * no drag-and-drop, discussion #933). Checked/indeterminate state is derived
 * from the grid's own selection, recomputed on every selectionChanged /
 * modelUpdated event, so the header can never disagree with the grid.
 */
export function GroupHeaderRow({ data, api, context }: GroupHeaderRowProps) {
  const { t } = useTranslation("common");
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
  // pre-grid-filter count (grid filters auto-expand groups, so the two
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
      {context?.selectable !== false && (
        <Checkbox
          size="small"
          checked={!info.collapsed && allSelected}
          indeterminate={!info.collapsed && memberState.selected > 0 && !allSelected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => context?.selectGroup(info.key, e.target.checked)}
          inputProps={{ "aria-label": t("groupBy.selectGroup", { group: info.label }) }}
          sx={{ p: 0.5 }}
        />
      )}
      <Typography variant="body2" fontWeight={600} noWrap>
        {info.label}
      </Typography>
      <Chip label={countLabel} size="small" sx={{ height: 20 }} />
    </Box>
  );
}

export interface UseRowGroupingOptions<T extends { id: string }> {
  rows: T[];
  /** The axes this grid can group by. An unknown `groupBy` value (stale pref,
   * prerequisites gone) simply resolves to ungrouped. */
  axes: GroupAxis<T>[];
  /** Active axis key (wire format), or null for no grouping. */
  groupBy: string | null;
  /** Whether the grid has row selection (shows the header checkbox). Default true. */
  selectable?: boolean;
}

export function useRowGrouping<T extends { id: string }>(
  // Accepts both untyped (AgGridReact) and row-typed (AgGridReact<T>) refs.
  gridRef: RefObject<AgGridReact<T> | AgGridReact | null>,
  { rows, axes, groupBy, selectable = true }: UseRowGroupingOptions<T>,
) {
  const { t } = useTranslation("common");

  const activeAxis = useMemo(
    () => (groupBy ? (axes.find((a) => a.key === groupBy) ?? null) : null),
    [axes, groupBy],
  );
  const activeAxisRef = useRef<GroupAxis<T> | null>(null);
  activeAxisRef.current = activeAxis;

  // Collapsed group keys — session-only by design (a transient reading aid).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  useEffect(() => {
    setCollapsed(new Set());
  }, [activeAxis?.key]);

  // Per-group representative members known to pass the active grid filters
  // (column and quick filters alike). A header row is a clone of its
  // representative, so it is displayed exactly when the group has at least
  // one visible member. Null while no grid filter is active.
  const repsRef = useRef<Map<string, T> | null>(null);
  const [repsRev, setRepsRev] = useState(0);
  // A group whose members must be selected once its rows exist — set when the
  // header checkbox is clicked on a collapsed group (expand first, then
  // select), consumed in handleModelUpdated.
  const pendingSelectRef = useRef<string | null>(null);

  const rowData = useMemo<GroupedRow<T>[]>(() => {
    if (!activeAxis) return rows;
    void repsRev; // reps live in a ref; the rev forces the rebuild
    return buildGroupedRows(rows, activeAxis, collapsed, repsRef.current, t("groupBy.notSet"));
  }, [rows, activeAxis, collapsed, repsRev, t]);

  const isGroupRow = useCallback(
    (data: GroupedRow<T> | null | undefined): boolean => !!data?.__group,
    [],
  );

  // Header row ids are namespaced by axis so switching the group-by can never
  // hand AG Grid a stale row under a reused id.
  const groupRowId = useCallback(
    (data: GroupedRow<T>) =>
      data.__group ? `group:${data.__group.axis}:${data.__group.key}` : data.id,
    [],
  );

  // Displayed member nodes of one group (after grid filters).
  const getGroupMemberNodes = useCallback(
    (key: string) => {
      const api = gridRef.current?.api;
      const axis = activeAxisRef.current;
      const nodes: IRowNode[] = [];
      if (!api || !axis) return nodes;
      api.forEachNodeAfterFilter((n) => {
        const d = n.data as GroupedRow<T> | undefined;
        if (d && !d.__group && groupKeyOn(d, axis) === key) nodes.push(n);
      });
      return nodes;
    },
    [gridRef],
  );

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Select/deselect every displayed member of a group. Members of a collapsed
  // group have no grid rows, so selecting one expands it first and finishes in
  // handleModelUpdated once the rows exist.
  const selectGroup = useCallback(
    (key: string, select: boolean) => {
      const api = gridRef.current?.api;
      if (!api) return;
      if (select && collapsedRef.current.has(key)) {
        pendingSelectRef.current = key;
        toggleGroupCollapse(key);
        return;
      }
      api.setNodesSelected({ nodes: getGroupMemberNodes(key), newValue: select });
    },
    [gridRef, getGroupMemberNodes, toggleGroupCollapse],
  );

  const context = useMemo<GroupRowContext>(
    () => ({ toggleGroupCollapse, selectGroup, getGroupMemberNodes, selectable }),
    [toggleGroupCollapse, selectGroup, getGroupMemberNodes, selectable],
  );

  /**
   * Call from the grid's onFilterChanged (or chain inside your own handler).
   * Recomputes the per-group representatives whenever grid filters change.
   * Collapsed groups have no member rows to pick a representative from, so
   * activating a filter auto-expands everything — the alternative is
   * collapsed headers that silently vanish and can't be reopened.
   */
  const handleFilterChanged = useCallback(() => {
    const api = gridRef.current?.api;
    const axis = activeAxisRef.current;
    if (!api || !axis) return;
    if (!api.isAnyFilterPresent()) {
      if (repsRef.current) {
        repsRef.current = null;
        setRepsRev((v) => v + 1);
      }
      return;
    }
    if (collapsedRef.current.size > 0) setCollapsed(new Set());
    const reps = new Map<string, T>();
    api.forEachNodeAfterFilter((n) => {
      const d = n.data as GroupedRow<T> | undefined;
      if (d && !d.__group) {
        const key = groupKeyOn(d, axis);
        if (!reps.has(key)) reps.set(key, d);
      }
    });
    repsRef.current = reps;
    setRepsRev((v) => v + 1);
  }, [gridRef]);

  /** Call from the grid's onModelUpdated (or chain inside your own handler). */
  const handleModelUpdated = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const pending = pendingSelectRef.current;
    if (pending) {
      pendingSelectRef.current = null;
      api.setNodesSelected({ nodes: getGroupMemberNodes(pending), newValue: true });
    }
  }, [gridRef, getGroupMemberNodes]);

  // Stable spreadable grid props. postSortRows re-glues each group header
  // above its members after every sort — headers are member clones, so AG
  // Grid sorts them among the leaves.
  const gridProps = useMemo(
    () => ({
      isFullWidthRow: (p: { rowNode: IRowNode }) =>
        !!(p.rowNode.data as GroupedRow<T> | undefined)?.__group,
      fullWidthCellRenderer: GroupHeaderRow,
      postSortRows: (params: { nodes: IRowNode[] }) => {
        const axis = activeAxisRef.current;
        if (axis) {
          glueGroups(params.nodes as unknown as { data?: GroupedRow<T> }[], axis);
        }
      },
      isRowSelectable: (node: IRowNode) => !(node.data as GroupedRow<T> | undefined)?.__group,
      context,
    }),
    [context],
  );

  return {
    activeAxis,
    rowData,
    isGroupRow,
    groupRowId,
    gridProps,
    handleFilterChanged,
    handleModelUpdated,
  };
}

/**
 * The "Group by" picker every grouped grid shares: a toolbar button (icon-only
 * in `compact` mode) opening a menu of None + the grid's axes.
 */
export function GroupByMenuButton({
  axes,
  groupBy,
  onChange,
  compact = false,
}: {
  axes: Array<{ key: string; label: string }>;
  groupBy: string | null;
  onChange: (groupBy: string | null) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation("common");
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const active = groupBy ? axes.find((a) => a.key === groupBy) : undefined;

  return (
    <>
      {compact ? (
        <Tooltip title={t("groupBy.label")}>
          <IconButton
            size="small"
            color={active ? "primary" : "default"}
            onClick={(e) => setAnchor(e.currentTarget)}
          >
            <MaterialSymbol icon="workspaces" size={20} />
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          size="small"
          variant="outlined"
          color={active ? "primary" : "inherit"}
          startIcon={<MaterialSymbol icon="workspaces" size={16} />}
          endIcon={<MaterialSymbol icon="arrow_drop_down" size={16} />}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ textTransform: "none" }}
        >
          {active ? t("groupBy.buttonActive", { label: active.label }) : t("groupBy.label")}
        </Button>
      )}
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem
          selected={!active}
          onClick={() => {
            onChange(null);
            setAnchor(null);
          }}
        >
          {t("groupBy.none")}
        </MenuItem>
        <Divider />
        {axes.map((a) => (
          <MenuItem
            key={a.key}
            selected={groupBy === a.key}
            onClick={() => {
              onChange(a.key);
              setAnchor(null);
            }}
          >
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
