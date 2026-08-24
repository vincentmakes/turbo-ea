import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import MaterialSymbol from "@/components/MaterialSymbol";
import { COLUMN_COUNTS, isColumnCount, type ColumnCount } from "@/components/cardColumns";

/**
 * One frame subdivided into N panes, so the three buttons differ only in the
 * number of divisions. `view_stream` is a frame split into two *rows*, so it
 * is turned on its side to read as two columns; the glyph is symmetric, so
 * the rotation needs no RTL handling.
 */
const ICONS: Record<ColumnCount, { icon: string; rotate?: boolean }> = {
  1: { icon: "crop_portrait" },
  2: { icon: "view_stream", rotate: true },
  3: { icon: "view_column" },
};

const TOOLTIP_KEYS: Record<ColumnCount, string> = {
  1: "cardColumns.tooltipOne",
  2: "cardColumns.tooltipTwo",
  3: "cardColumns.tooltipThree",
};

interface Props {
  value: ColumnCount;
  onChange: (value: ColumnCount) => void;
}

/**
 * Segmented picker for how many columns a card grid renders.
 *
 * Icon-only with tooltips, matching every other toggle in a report toolbar
 * (the chart/table switch, the dependency chart mode, the matrix direction).
 * A visible digit would render a bare "1"/"2"/"3" text node next to the
 * reports' metric cards, which read as counts themselves.
 */
export default function ColumnCountPicker({ value, onChange }: Props) {
  const { t } = useTranslation("common");

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      // MUI fires onChange with null when the active button is clicked again;
      // without this guard that would blank the grid template.
      onChange={(_, next) => {
        if (isColumnCount(next)) onChange(next);
      }}
      aria-label={t("cardColumns.label")}
    >
      {COLUMN_COUNTS.map((n) => (
        <ToggleButton
          key={n}
          value={n}
          aria-label={t(TOOLTIP_KEYS[n])}
          sx={{ px: 1 }}
        >
          <Tooltip title={t(TOOLTIP_KEYS[n])}>
            <Box component="span" sx={{ display: "flex" }}>
              <MaterialSymbol
                icon={ICONS[n].icon}
                size={18}
                style={ICONS[n].rotate ? { transform: "rotate(90deg)" } : undefined}
              />
            </Box>
          </Tooltip>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
