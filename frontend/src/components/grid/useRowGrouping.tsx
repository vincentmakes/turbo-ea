import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
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
import { readableTextColor } from "@/lib/color";
import {
  buildGroupedRows,
  collapsedSetForFocus,
  glueGroups,
  groupKeyOn,
  type GroupAxis,
  type GroupedRow,
  type GroupHeaderAnchor,
  type GroupInfo,
} from "./rowGrouping";

/** A group header's geometry plus the pixel span of its rows — the sticky
 * range its bar is allowed to pin within. */
interface StickyGroupAnchor extends GroupHeaderAnchor {
  span: number;
}

/**
 * Stateful half of grid row grouping (see rowGrouping.ts): collapse state,
 * group-header selection, representative members under active grid filters,
 * and the grid props that wire it all into an AG Grid Community instance.
 *
 * Usage (see InventoryPage for the full-featured wiring, RiskRegisterPage /
 * AdrGrid for the minimal one):
 *
 *   const grouping = useRowGrouping(gridRef, { rows, axes, groupBy });
 *   <Box sx={{ ...grouping.sx }}>            // sticky bar positions against this
 *     <AgGridReact
 *       rowData={grouping.rowData}
 *       {...grouping.gridProps}
 *       getRowId={(p) => grouping.groupRowId(p.data)}
 *       onFilterChanged={grouping.handleFilterChanged}   // or chain into yours
 *       onModelUpdated={grouping.handleModelUpdated}     // or chain into yours
 *     />
 *     {grouping.stickyHeader}
 *   </Box>
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

  // A LAYOUT effect, not a plain one: it runs after the DOM is mutated but
  // BEFORE the browser paints, so the measured count and selection land in the
  // same frame as the label. With a plain effect the first paint of any
  // expanded header shows the seed values — "0/25", checkbox clear — and
  // corrects a frame later. That flash is invisible on a row that scrolls into
  // view once, but the sticky bar re-runs this at every group boundary, which
  // is exactly where it reads as flicker.
  useLayoutEffect(() => {
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
      {info.color ? (
        // The grouped field's own option color, as the cell chips render it —
        // readableTextColor keeps the label legible in light and dark alike.
        <Chip
          label={info.label}
          size="small"
          sx={{
            height: 20,
            fontWeight: 600,
            bgcolor: info.color,
            color: readableTextColor(info.color),
          }}
        />
      ) : (
        <Typography variant="body2" fontWeight={600} noWrap>
          {info.label}
        </Typography>
      )}
      <Chip label={countLabel} size="small" sx={{ height: 20 }} />
    </Box>
  );
}

/** Wrapper styling the sticky bar needs: it is positioned against the Box that
 * wraps the grid. Reached by pages as `grouping.sx`, spread alongside
 * `columnFreeze.sx` / `cellMenu.sx`. */
// Wrapper styling. Grid popups no longer render inside the wrapper at all
// (popupParent: document.body in agGridSetup.ts), which is what keeps them
// clear of the sticky group bars' compositing layers on WebKit.
const rowGroupingSx = {
  position: "relative",
  // While the sticky bars are rendering, the REAL full-width group rows
  // never need to paint: each bar overlays its row pixel-exactly and carries
  // the same GroupHeaderRow. Hiding the rows makes a duplicated header
  // impossible BY CONSTRUCTION — WebKit repositions non-composited sticky
  // elements a beat late on scroll direction changes, and with the rows
  // visible that lag exposed the real header next to the bar for a few px.
  // Gated on the bar wrappers actually existing, so autoHeight grids (which
  // render no bars — their viewport is not the scrollport) keep their rows.
  "&:has(.tea-group-sticky-range) .ag-full-width-row": { visibility: "hidden" },
  // The bars are display:none in print — there the real rows are the record.
  "@media print": {
    "& .ag-full-width-row": { visibility: "visible" },
  },
} as const;

/**
 * The group bar that stays put under the column headers while you scroll, so a
 * long group never leaves you wondering which one you are inside.
 *
 * AG Grid Community has no `groupRowsSticky` (Enterprise only) and positions
 * its rows absolutely, so a row itself cannot be sticky. Instead, one bar per
 * group is PORTALED INTO the grid's own `.ag-full-width-container` — the
 * absolutely-positioned, full-content-height layer that already holds the
 * real full-width group rows and uses the same `rowTop` coordinates as the
 * anchors. Each bar sits in an absolute wrapper spanning its group's rows and
 * pins with native `position: sticky; top: 0`, so the browser compositor
 * does ALL the positioning: pinning, hand-off between groups (the next
 * wrapper's bottom pushes the previous bar out), elastic rubber-band
 * overscroll, and momentum flings. Earlier versions were a JS overlay driven
 * by scroll events, which was structurally one frame behind the compositor —
 * a 1px bump at every group boundary, and a stuck duplicate header after
 * iOS/macOS rubber-band overscroll, where the settle produces no usable
 * scroll event at all.
 *
 * Living inside the grid element also means the Theming API's `--ag-*`
 * variables resolve here natively (they are scoped to the grid's own element
 * since v33 — a sibling overlay had to read them off the DOM at runtime).
 *
 * It renders `GroupHeaderRow` VERBATIM rather than a lookalike, so the bar
 * and the real row cannot drift apart, and the counts and select-all state
 * are computed by the one piece of code that already knows how.
 *
 * That includes the **select-all checkbox**, which is the point of the whole
 * affordance: the group header exists so you can tick it and then bulk-edit
 * the group. Deep inside a long group, having to scroll back to the real
 * header to reach that tick box is exactly the friction this bar removes.
 * `selectable` is inherited from the grid's own context, so a grid with no
 * row selection (the Risk Register) still gets a bar with no checkbox.
 *
 * The bars stay IN the accessibility tree — each holds a real control, the
 * real header row is often virtualised out of the DOM, and a focusable
 * control inside `aria-hidden` is reachable by keyboard but invisible to
 * assistive tech, which is worse than the duplication it avoids.
 */
function StickyGroupHeader<T extends { id: string }>({
  gridRef,
  heads,
  context,
}: {
  gridRef: RefObject<AgGridReact<T> | AgGridReact | null>;
  /** Every group header currently in the row list, with its grid row id. */
  heads: Array<{ id: string; info: GroupInfo }>;
  context: GroupRowContext;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const anchorsRef = useRef<StickyGroupAnchor[]>([]);
  const [api, setApi] = useState<GridApi | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<StickyGroupAnchor[]>([]);
  // An autoHeight grid's viewport never scrolls, so the nearest scrollport is
  // some page-level container — the bars would pin against THAT and float
  // over unrelated content. Render nothing there; the real header rows are
  // always on screen anyway.
  const [autoHeight, setAutoHeight] = useState(false);

  // The grid creates its api in its own effect, so it may not exist on our
  // first pass. Poll for a bounded number of frames rather than making every
  // page wire an onGridReady just for this.
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const grab = () => {
      const next = gridRef.current?.api;
      if (next) {
        setApi(next);
        return;
      }
      if (tries++ < 120) raf = requestAnimationFrame(grab);
    };
    grab();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [gridRef]);

  // Mount the portal host inside the grid's full-width row layer. Keyed on
  // the api so the RTL remount (the pages key the grid on direction) gets a
  // fresh host inside the fresh grid DOM.
  useEffect(() => {
    if (!api) return;
    // The probe's parent is the wrapper Box the pages render both the grid
    // and this component into (see `rowGroupingSx`).
    const wrap = anchorRef.current?.parentElement;
    const container = wrap?.querySelector<HTMLElement>(".ag-full-width-container");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "tea-group-sticky-host";
    // Later sibling of the real rows in the same container, so it paints
    // above them without any z-index games; pointer events stay off so the
    // member rows underneath keep hover/click, and only the bars themselves
    // opt back in.
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    container.appendChild(el);
    setHost(el);
    return () => {
      setHost(null);
      try {
        el.remove();
      } catch {
        // The grid may have torn the container down already.
      }
    };
  }, [api]);

  // Group geometry, refreshed on model updates only. `rowTop` is assigned
  // when AG Grid lays the displayed rows out — after `postSortRows` — so
  // reading it from inside the sort glue would give stale geometry. Resolving
  // by row id keeps this O(groups) instead of a walk over every row. Each
  // anchor's `span` reaches to the next group header (or the last row's
  // bottom), which is what bounds its bar's sticky range: the next group
  // pushes the previous bar out natively.
  const rebuildAnchors = useCallback(() => {
    const a = gridRef.current?.api;
    const out: StickyGroupAnchor[] = [];
    if (a) {
      for (const head of heads) {
        const node = a.getRowNode(head.id);
        if (node?.rowTop != null && node.rowIndex != null) {
          out.push({
            top: node.rowTop,
            height: node.rowHeight ?? 0,
            rowIndex: node.rowIndex,
            group: head.info,
            span: 0,
          });
        }
      }
      out.sort((x, y) => x.top - y.top);
      const count = a.getDisplayedRowCount?.() ?? 0;
      const last = count > 0 ? a.getDisplayedRowAtIndex?.(count - 1) : null;
      const contentEnd = last?.rowTop != null ? last.rowTop + (last.rowHeight ?? 0) : null;
      out.forEach((x, i) => {
        x.span = (out[i + 1]?.top ?? contentEnd ?? x.top + x.height) - x.top;
      });
    }
    anchorsRef.current = out;
    setAnchors(out);
    const wrap = anchorRef.current?.parentElement;
    setAutoHeight(!!wrap?.querySelector(".ag-layout-auto-height"));
  }, [gridRef, heads]);

  useEffect(() => {
    if (!api) return;
    rebuildAnchors();
    api.addEventListener("modelUpdated", rebuildAnchors);
    api.addEventListener("firstDataRendered", rebuildAnchors);
    return () => {
      try {
        api.removeEventListener("modelUpdated", rebuildAnchors);
        api.removeEventListener("firstDataRendered", rebuildAnchors);
      } catch {
        // The grid may already be destroyed.
      }
    };
  }, [api, rebuildAnchors]);

  const stickyContext = useMemo<GroupRowContext>(
    () => ({
      // `selectable` rides along from the grid's own context: the bar carries
      // the same select-all tick box as the real header, and no checkbox at
      // all on a grid that has no row selection.
      ...context,
      // Collapsing the group you are scrolled *inside* removes rows from above
      // the viewport, which would fling the scroll position somewhere
      // arbitrary. Bring the real header to the top first: everything above it
      // is untouched by the collapse, so it stays exactly where the bar was.
      toggleGroupCollapse: (key: string) => {
        const a = gridRef.current?.api;
        const anchor = anchorsRef.current.find((x) => x.group.key === key);
        if (a && anchor) {
          try {
            a.ensureIndexVisible(anchor.rowIndex, "top");
          } catch {
            // Non-fatal — the collapse below is the part that matters.
          }
        }
        context.toggleGroupCollapse(key);
      },
    }),
    [context, gridRef],
  );

  return (
    <>
      {/* Zero-size probe: gives the effects a handle on the wrapper element
          without competing for the wrapper's own ref (which the pages already
          hand to useColumnFreeze). A plain div, not a Box — it is never
          painted, so it has no business minting an emotion class. */}
      <div ref={anchorRef} className="tea-group-sticky-probe" style={{ display: "none" }} />
      {api &&
        host &&
        !autoHeight &&
        createPortal(
          anchors.map((a) => (
            // Geometry rides on plain inline styles: it changes with every
            // model update, and a per-group `sx` would mint a fresh emotion
            // class each time. The static bits (print, theming) keep stable
            // sx objects and so stable classes.
            <Box
              key={a.group.key}
              className="tea-group-sticky-range"
              style={{
                position: "absolute",
                top: `${a.top}px`,
                height: `${a.span}px`,
                left: 0,
                right: 0,
                pointerEvents: "none",
              }}
              sx={{ "@media print": { display: "none" } }}
            >
              <Box
                style={{
                  position: "sticky",
                  top: 0,
                  height: `${a.height}px`,
                  // Forces the bar onto its own compositor layer so WebKit
                  // updates its stuck position on the compositor thread —
                  // without it, iPadOS repositions the bar a frame late on
                  // direction changes and it shows a few px off its pin
                  // (reading as a brief duplicate next to the real row).
                  transform: "translateZ(0)",
                }}
                sx={{
                  pointerEvents: "auto",
                  // Paint EXACTLY what a real group header row paints, so bar
                  // and row are indistinguishable when they overlap at rest:
                  // the row canvas (GroupHeaderRow's own `action.hover` is
                  // translucent, and while pinned this floats over member
                  // rows, so it cannot be transparent) plus the row's own
                  // bottom border. Inside the grid element the Theming API
                  // variables resolve directly. Deliberately NO elevation —
                  // a shadow that exists only while floating is a flicker at
                  // every hand-off.
                  bgcolor: "var(--ag-background-color)",
                  borderBottom: "var(--ag-row-border)",
                }}
              >
                <GroupHeaderRow
                  data={{ __group: a.group } as GroupedRow<T>}
                  api={api}
                  context={stickyContext}
                />
              </Box>
            </Box>
          )),
          host,
        )}
    </>
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
  /**
   * One-shot focus: once rows are available on the active axis, collapse
   * every group except this key (deep-link `?expand_group=` — the clicked
   * report group lands open, the rest as collapsed headers with counts).
   * Later expand/collapse behaves as usual.
   */
  initialFocusGroup?: string | null;
}

export function useRowGrouping<T extends { id: string }>(
  // Accepts both untyped (AgGridReact) and row-typed (AgGridReact<T>) refs.
  gridRef: RefObject<AgGridReact<T> | AgGridReact | null>,
  { rows, axes, groupBy, selectable = true, initialFocusGroup = null }: UseRowGroupingOptions<T>,
) {
  const { t } = useTranslation("common");
  const isRtl = useIsRtl();

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

  // One-shot deep-link focus: rows load asynchronously (and attribute axes
  // only resolve once the metamodel arrives), so the seeding waits for both
  // and then never runs again — the user's own expand/collapse takes over.
  const pendingFocusRef = useRef<string | null>(initialFocusGroup ?? null);
  useEffect(() => {
    const focus = pendingFocusRef.current;
    if (!focus || !activeAxis || rows.length === 0) return;
    pendingFocusRef.current = null;
    setCollapsed(collapsedSetForFocus(rows, activeAxis, focus));
  }, [rows, activeAxis]);

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

  // Group headers currently in the row list, with the grid row id each one was
  // registered under — the sticky bar resolves their positions through these.
  const heads = useMemo(
    () =>
      activeAxis
        ? rowData.flatMap((row) => (row.__group ? [{ id: groupRowId(row), info: row.__group }] : []))
        : [],
    [activeAxis, rowData, groupRowId],
  );

  return {
    activeAxis,
    rowData,
    isGroupRow,
    groupRowId,
    gridProps,
    handleFilterChanged,
    handleModelUpdated,
    /** Spread into the grid wrapper's `sx` — the sticky bar positions against it. */
    sx: rowGroupingSx,
    /** Render inside the grid wrapper, after `<AgGridReact>`. */
    stickyHeader: activeAxis ? (
      // Keyed like the grid itself: a writing-direction flip remounts the grid
      // and mints a new api, so the bar has to start over too.
      <StickyGroupHeader
        key={isRtl ? "rtl" : "ltr"}
        gridRef={gridRef}
        heads={heads}
        context={context}
      />
    ) : null,
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
