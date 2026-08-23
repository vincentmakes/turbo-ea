import { useId } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";

/**
 * The collapsible "Filters" row in a report toolbar.
 *
 * The filter block is the tallest thing in a report toolbar — four wrapping
 * sub-sections on the Portfolio report — so it folds away, expanded by
 * default, with the collapse state persisted by the report alongside every
 * other setting (`filtersCollapsed` in its saved-report config).
 *
 * Extracted from the Portfolio and Capability Map reports, whose headers were
 * duplicated near-verbatim. It mirrors the vocabulary of the grid filter
 * sidebars' `FilterSectionHeader` (chevron -> section glyph -> label ->
 * primary count chip) rather than reusing it: that one is sidebar-typography,
 * has nowhere to put the clear-all chip, and is a bare `Box onClick` with no
 * button semantics.
 *
 * Two structural rules that look like styling but are not:
 *  - `width: "100%"` on the wrapper is what keeps the block on its own line in
 *    the toolbar's wrapping flex row. Without it a collapsed header shrinks to
 *    its natural width and flows up beside the controls above, so folding the
 *    section reflows the whole toolbar.
 *  - the clear-all chip is a SIBLING of the toggle button, never a child. A
 *    deletable chip inside a `<button>` is a second tab stop inside the first
 *    and needs `stopPropagation` on click *and* keydown to avoid toggling the
 *    section. Placing it outside makes that whole class of bug unreachable —
 *    the same reasoning as the freeze pin in `FilterCheckboxList`.
 */
export interface ReportFilterSectionProps {
  /** Section label, already translated. */
  label: string;
  /** Leading section glyph. */
  icon?: string;
  /** True = body folded away. Owned and persisted by the report. */
  collapsed: boolean;
  onToggle: () => void;
  /**
   * Active filter selections *inside this section*. Hidden at 0. Must be the
   * same number the report puts in its print params, so a collapsed section
   * on screen and the printed header can never disagree.
   */
  count?: number;
  /** Clear-all affordance; rendered only when both props are supplied. */
  clearAllLabel?: string;
  onClearAll?: () => void;
  /** The filter controls themselves. */
  children: ReactNode;
}

export default function ReportFilterSection({
  label,
  icon = "filter_alt",
  collapsed,
  onToggle,
  count,
  clearAllLabel,
  onClearAll,
  children,
}: ReportFilterSectionProps) {
  const { t } = useTranslation(["reports"]);
  const uid = useId();
  const headerId = `${uid}-header`;
  const bodyId = `${uid}-body`;

  return (
    <Box sx={{ width: "100%", pt: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <ButtonBase
          id={headerId}
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 0.5,
            py: 0.25,
            borderRadius: 1,
            "&:hover": { bgcolor: "action.hover" },
            "&.Mui-focusVisible": {
              outline: "2px solid",
              outlineColor: "primary.main",
              outlineOffset: 2,
            },
          }}
        >
          <MaterialSymbol icon={collapsed ? "chevron_right" : "expand_more"} size={16} color="#999" />
          <MaterialSymbol icon={icon} size={16} color="#999" />
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {!!count && (
            // `component="span"`: Chip's root is a <div>, which is invalid
            // inside the <button> ButtonBase renders.
            <Chip
              component="span"
              size="small"
              color="primary"
              label={count}
              aria-label={t("common.filtersActive", { count })}
              sx={{ height: 18, fontSize: 11 }}
            />
          )}
        </ButtonBase>

        {onClearAll && clearAllLabel && (
          <Chip
            size="small"
            label={clearAllLabel}
            variant="outlined"
            onDelete={onClearAll}
            sx={{ fontSize: "0.7rem", height: 22 }}
          />
        )}
      </Box>

      {/* The header-to-content gap lives INSIDE the collapse, so folding the
          section leaves no dead space under the header. The wrapper's `pt`
          stays outside — that one separates the block from the row above and
          must survive collapsing. */}
      <Collapse in={!collapsed} id={bodyId} role="region" aria-labelledby={headerId}>
        <Box sx={{ pt: 1, display: "flex", gap: 2, flexWrap: "wrap" }}>{children}</Box>
      </Collapse>
    </Box>
  );
}
