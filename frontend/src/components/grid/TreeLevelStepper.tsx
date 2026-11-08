import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import { alpha, type Theme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  /** The level currently open (1 = every parent collapsed). */
  current: number;
  /** How many levels the tree has when fully open. */
  max: number;
  onChange: (level: number) => void;
}

const borderOf = (theme: Theme) => alpha(theme.palette.primary.main, 0.4);

/**
 * The tree layer's per-level expand/collapse control: `−` closes the deepest
 * open level, `+` opens the next one. No visible text — the level is named in
 * the tooltips and aria-labels only. Height matches the small outlined
 * Group by button it sits next to.
 */
export default function TreeLevelStepper({ current, max, onChange }: Props) {
  const { t } = useTranslation("common");
  const half = (
    icon: "remove" | "add",
    label: string,
    disabled: boolean,
    next: number,
    divider: boolean,
  ) => (
    <Tooltip title={label} describeChild>
      {/* A span keeps the tooltip alive on a disabled button. */}
      <Box component="span" sx={{ display: "inline-flex", alignSelf: "stretch" }}>
        <ButtonBase
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(next)}
          sx={(theme) => ({
            px: 1,
            height: "100%",
            color: "primary.main",
            borderInlineStart: divider ? `1px solid ${borderOf(theme)}` : "none",
            transition: theme.transitions.create("background-color", { duration: 120 }),
            "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08) },
            "&.Mui-disabled": { opacity: 0.35 },
            "&.Mui-focusVisible": { bgcolor: alpha(theme.palette.primary.main, 0.16) },
          })}
        >
          <MaterialSymbol icon={icon} size={16} />
        </ButtonBase>
      </Box>
    </Tooltip>
  );

  return (
    <Box
      role="group"
      aria-label={t("groupBy.levelStepperGroup")}
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "stretch",
        height: 30,
        flexShrink: 0,
        border: `1px solid ${borderOf(theme)}`,
        // The toolbar's own radius: the stepper stands among outlined buttons
        // of the same height, so it shares their shape rather than a pill's.
        borderRadius: 1,
        overflow: "hidden",
      })}
    >
      {half(
        "remove",
        t("groupBy.collapseOneLevel", { current, max }),
        current <= 1,
        current - 1,
        false,
      )}
      {half("add", t("groupBy.expandOneLevel", { current, max }), current >= max, current + 1, true)}
    </Box>
  );
}
