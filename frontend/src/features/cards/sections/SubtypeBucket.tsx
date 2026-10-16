/**
 * One collapsible subtype group in card detail: a header row (chevron,
 * subtype label, count) over a list that collapses beneath it.
 *
 * Shared by every surface that groups cards by subtype — the Relations
 * section's per-relation-type buckets (#792), the "+N in sub-items" drawer
 * (#863) and the Hierarchy section's children (#1269) — so the three read as
 * one control rather than three lookalikes. Label resolution stays with the
 * caller (resolve the whole SubtypeDef, never the key — see useResolveLabel).
 */
import { useEffect, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

export function SubtypeBucket({
  label,
  isNoSubtype,
  count,
  open,
  onToggle,
  px = 1.5,
  children,
}: {
  label: string;
  /** The trailing "No subtype" bucket renders its label muted and italic. */
  isNoSubtype: boolean;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Horizontal padding of the header, matching the surrounding list. */
  px?: number;
  children: ReactNode;
}) {
  return (
    <Box>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        sx={{
          all: "unset",
          boxSizing: "border-box",
          width: "100%",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px,
          py: 0.5,
          bgcolor: "background.default",
          borderTop: "1px solid",
          borderColor: "divider",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <MaterialSymbol icon={open ? "expand_more" : "chevron_right"} size={16} />
        <Typography
          variant="caption"
          fontWeight={600}
          color={isNoSubtype ? "text.disabled" : "text.secondary"}
          sx={{ flex: 1, fontStyle: isNoSubtype ? "italic" : "normal" }}
        >
          {label}
        </Typography>
        <Chip
          size="small"
          label={count}
          variant="outlined"
          sx={{ height: 18, fontSize: "0.65rem" }}
        />
      </Box>
      <Collapse in={open} unmountOnExit>
        {children}
      </Collapse>
    </Box>
  );
}

/** Which buckets are collapsed. Every bucket starts open; nothing persists. */
export function useCollapsedBuckets() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { isOpen: (key: string) => !collapsed.has(key), toggle };
}

/**
 * The grouped/flat switch. Follows `autoGroup` (re-synced as the item set
 * changes — adding or removing a card can cross the threshold) until the
 * user clicks the toggle; from then on their choice holds.
 */
export function useSubtypeGrouping(autoGroup: boolean) {
  const [grouped, setGrouped] = useState(autoGroup);
  const [userToggled, setUserToggled] = useState(false);
  useEffect(() => {
    if (!userToggled) setGrouped(autoGroup);
  }, [autoGroup, userToggled]);
  const toggleGrouped = () => {
    setUserToggled(true);
    setGrouped((g) => !g);
  };
  return { grouped, toggleGrouped };
}
