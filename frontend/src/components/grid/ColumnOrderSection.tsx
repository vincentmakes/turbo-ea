/**
 * The "Column order" section at the top of every grid's Columns tab — the
 * discoverable, touch- and keyboard-usable twin of dragging a column header.
 *
 * It lists only the columns currently on screen, in the order the table draws
 * them, and hands back a *full* order (hidden columns keep their slots, see
 * `applyVisibleOrder`) ready for the page to persist.
 *
 * Three things here are deliberate:
 *
 *  - **Frozen columns are their own block, first.** Pinning does not move a
 *    column in the grid's logical order, but AG Grid draws the whole pinned
 *    region ahead of everything unpinned. A single flat list would therefore
 *    disagree with the table, and dragging a frozen row would produce no
 *    visible change at all. So the two blocks are separate `SortableContext`s
 *    and a drop across the boundary is a no-op — the freeze pin on each row is
 *    the way out, which is why it is rendered here as well as in the checkbox
 *    lists below.
 *  - **The drag listeners live on the handle alone.** That is what keeps the
 *    list scrollable under a finger inside the mobile filter Drawer, and what
 *    lets the freeze pin stay tappable. `touchAction: "none"` on the handle is
 *    not optional: without it the browser claims the gesture as a scroll and
 *    fires `pointercancel`, so a touch drag never starts.
 *  - **The row is not a button.** This section owns order only — visibility
 *    still belongs to the checkbox lists below it — so there is no nested
 *    `<button>` to work around, unlike `ColumnFreezeToggle`'s situation.
 *
 * The section deliberately does not participate in the Columns tab's search
 * box: reordering a filtered list by index is not sound.
 */
import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColumnFreezeToggle from "@/components/grid/ColumnFreezeToggle";
import { FilterSectionHeader } from "@/components/FilterSidebarSection";
import { applyVisibleOrder, mergeOrder } from "./columnOrder";

export interface ColumnOrderItem {
  colId: string;
  label: string;
  /** Material Symbol name — §3.11 wants a glyph on every column row. */
  icon?: string;
}

interface Props {
  /** The columns currently visible and movable, in any order. */
  items: ColumnOrderItem[];
  /** The full stored order — may hold ids that are hidden or not present. */
  order?: string[];
  frozen?: ReadonlySet<string>;
  onToggleFrozen?: (colId: string) => void;
  /** Receives the full new order, ready to persist. */
  onReorder: (nextOrder: string[]) => void;
  onReset?: () => void;
  /** Collapsed by default — this is a power-user affordance. */
  defaultExpanded?: boolean;
}

function SortableRow({
  item,
  frozen,
  onToggleFrozen,
}: {
  item: ColumnOrderItem;
  frozen?: boolean;
  onToggleFrozen?: () => void;
}) {
  const { t } = useTranslation("common");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.colId,
  });

  return (
    <Box
      ref={setNodeRef}
      // Inline `style`, never `sx`: `stylis-plugin-rtl` flips X translations in
      // emotion-processed CSS, which would invert dragging under Arabic.
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: "flex",
        alignItems: "center",
        borderRadius: 1,
        opacity: isDragging ? 0.4 : 1,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Tooltip title={t("grid.reorderColumn", { label: item.label })} placement="right">
        <Box
          {...attributes}
          {...listeners}
          aria-label={t("grid.reorderColumn", { label: item.label })}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            p: 0.5,
            borderRadius: 1,
            cursor: "grab",
            color: "text.secondary",
            opacity: 0.55,
            // Mandatory for touch: otherwise the browser treats the gesture as
            // a scroll and cancels the drag before it starts.
            touchAction: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
            "&:active": { cursor: "grabbing" },
            "&:hover": { opacity: 1, color: "primary.main" },
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
          }}
        >
          <MaterialSymbol icon="drag_indicator" size={16} />
        </Box>
      </Tooltip>
      <ListItem dense disablePadding sx={{ py: 0.25, px: 0.5, flex: 1, minWidth: 0 }}>
        <ListItemIcon sx={{ minWidth: 24 }}>
          <MaterialSymbol icon={item.icon ?? "view_column"} size={16} />
        </ListItemIcon>
        <ListItemText
          primary={item.label}
          primaryTypographyProps={{ fontSize: 13, noWrap: true }}
        />
      </ListItem>
      {onToggleFrozen && <ColumnFreezeToggle frozen={!!frozen} onToggle={onToggleFrozen} />}
    </Box>
  );
}

export default function ColumnOrderSection({
  items,
  // Defaulted rather than merely required: this renders inside a filter
  // sidebar, and throwing here would blank the whole panel.
  order = [],
  frozen,
  onToggleFrozen,
  onReorder,
  onReset,
  defaultExpanded = false,
}: Props) {
  const { t } = useTranslation("common");
  const [expanded, setExpanded] = useState(defaultExpanded);
  // dnd-kit renders its screen-reader live region into `document.body`, which
  // the mobile filter Drawer (a MUI `Modal`) `aria-hidden`s. Host it in here.
  const [liveRegionHost, setLiveRegionHost] = useState<HTMLElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The items in the sequence the table actually draws them in. */
  const displayed = useMemo(() => {
    const byId = new Map(items.map((i) => [i.colId, i]));
    const sequence = mergeOrder(
      items.map((i) => i.colId),
      order,
    )
      .map((id) => byId.get(id))
      .filter((i): i is ColumnOrderItem => !!i);
    // Pinned columns render ahead of the rest regardless of logical order.
    const isFrozen = (i: ColumnOrderItem) => !!frozen?.has(i.colId);
    return {
      frozen: sequence.filter(isFrozen),
      loose: sequence.filter((i) => !isFrozen(i)),
      all: [...sequence.filter(isFrozen), ...sequence.filter((i) => !isFrozen(i))],
    };
  }, [items, order, frozen]);

  const labelOf = (id: UniqueIdentifier) =>
    displayed.all.find((i) => i.colId === id)?.label ?? String(id);
  const positionOf = (id: UniqueIdentifier) => displayed.all.findIndex((i) => i.colId === id) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("grid.columnOrder.a11y.dragStart", {
        label: labelOf(active.id),
        position: positionOf(active.id),
        total: displayed.all.length,
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t("grid.columnOrder.a11y.dragOver", {
            label: labelOf(active.id),
            position: positionOf(over.id),
            total: displayed.all.length,
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("grid.columnOrder.a11y.dragEnd", {
            label: labelOf(active.id),
            position: positionOf(over.id),
            total: displayed.all.length,
          })
        : undefined,
    onDragCancel: ({ active }) =>
      t("grid.columnOrder.a11y.dragCancel", {
        label: labelOf(active.id),
        position: positionOf(active.id),
        total: displayed.all.length,
      }),
  };

  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: t("grid.columnOrder.a11y.instructions"),
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    // A frozen column can never be dropped among the unfrozen ones (or vice
    // versa) — it would move in the stored order without moving on screen.
    // Unfreeze it with the pin on its row instead.
    const wasFrozen = !!frozen?.has(String(active.id));
    if (wasFrozen !== !!frozen?.has(String(over.id))) return;

    const from = displayed.all.findIndex((i) => i.colId === active.id);
    const to = displayed.all.findIndex((i) => i.colId === over.id);
    if (from < 0 || to < 0) return;

    const next = arrayMove(displayed.all, from, to).map((i) => i.colId);
    onReorder(applyVisibleOrder(order, next));
  };

  const renderBlock = (block: ColumnOrderItem[]) =>
    block.map((item) => (
      <SortableRow
        key={item.colId}
        item={item}
        frozen={frozen?.has(item.colId)}
        onToggleFrozen={onToggleFrozen ? () => onToggleFrozen(item.colId) : undefined}
      />
    ));

  return (
    // The gap below the section belongs out here, not inside the `Collapse`:
    // in there it exists only while the section is open, and this section is
    // collapsed by default, so the header would sit flush against whatever the
    // Columns tab puts after it.
    <Box ref={setLiveRegionHost} sx={{ mb: 1 }}>
      <FilterSectionHeader
        label={t("grid.columnOrder.title")}
        icon="swap_vert"
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        count={items.length}
      />
      <Collapse in={expanded} unmountOnExit>
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", px: 0.5, pb: 0.5 }}
          >
            {t("grid.columnOrder.hint")}
          </Typography>

          {displayed.all.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
              {t("grid.columnOrder.empty")}
            </Typography>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              accessibility={{
                announcements,
                screenReaderInstructions,
                container: liveRegionHost ?? undefined,
              }}
            >
              {displayed.frozen.length > 0 && (
                <Box
                  role="group"
                  aria-label={t("grid.columnOrder.frozenGroup")}
                  sx={{ mb: 0.5, pb: 0.5, borderBottom: 1, borderColor: "divider" }}
                >
                  <List dense disablePadding>
                    <SortableContext
                      items={displayed.frozen.map((i) => i.colId)}
                      strategy={verticalListSortingStrategy}
                    >
                      {renderBlock(displayed.frozen)}
                    </SortableContext>
                  </List>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", px: 0.5, fontStyle: "italic" }}
                  >
                    {t("grid.columnOrder.frozenHint")}
                  </Typography>
                </Box>
              )}

              <List dense disablePadding>
                <SortableContext
                  items={displayed.loose.map((i) => i.colId)}
                  strategy={verticalListSortingStrategy}
                >
                  {renderBlock(displayed.loose)}
                </SortableContext>
              </List>
            </DndContext>
          )}

          {onReset && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.5 }}>
              <Button
                size="small"
                onClick={onReset}
                startIcon={<MaterialSymbol icon="restart_alt" size={14} />}
                sx={{ textTransform: "none", fontSize: 12, minWidth: 0, px: 1 }}
              >
                {t("grid.columnOrder.reset")}
              </Button>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
