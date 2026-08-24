import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";

/**
 * Section header for a `Menu` or `Popover` that holds more than one setting.
 *
 * The sidebar equivalent (`FilterSidebarSection`'s `FilterSectionHeader`) owns
 * an expand/collapse chevron and an `onToggle` contract a menu has no use for,
 * so this is the denser, caption-weight variant: uppercase, no chevron, and an
 * optional count on the right.
 *
 * `UI_GUIDELINES.md` §3.11 — a section header always carries a glyph, and a
 * count when it has one to show. That rule exists because this component had
 * already been re-invented three times; extract rather than write a fourth.
 */
export default function MenuSectionHeader({
  icon,
  label,
  count,
  px = 2,
}: {
  icon: string;
  label: string;
  /** Shown as a chip on the right. Hidden when 0 or undefined. */
  count?: number;
  /** Horizontal inset. Defaults to a `Menu`'s item padding; pass 0 inside a
   *  `Popover` that already pads its own paper, or the header sits indented
   *  from the rows it heads. */
  px?: number;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px,
        py: 0.5,
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "text.secondary",
      }}
    >
      {/* No `color` prop: MaterialSymbol writes it as an inline CSS value, so a
          theme token would not resolve. The glyph inherits `text.secondary`
          from this Box instead — which is the point of the rule against hex
          literals here (UI_GUIDELINES §3.9). */}
      <MaterialSymbol icon={icon} size={14} />
      {label}
      {count != null && count > 0 && (
        <Chip
          size="small"
          label={count}
          sx={{ ml: "auto", height: 18, fontSize: "0.65rem" }}
        />
      )}
    </Box>
  );
}
