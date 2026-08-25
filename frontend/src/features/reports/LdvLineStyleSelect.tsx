import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { LDV_LINE_STYLES, ldvEdgeStroke, type LdvEdgeLineStyle } from "./ldvLineStyle";

interface Props {
  value: LdvEdgeLineStyle;
  onChange: (next: LdvEdgeLineStyle) => void;
}

/**
 * Picks the idle style of the Layered Dependency View's connection lines.
 *
 * A component of its own rather than JSX inside `LayeredDependencyView`
 * because that view cannot mount under jsdom (React Flow needs layout APIs it
 * does not implement), so anything rendered inside it is untestable — the same
 * reason `LdvShowOnCard` was extracted.
 *
 * Each option draws the actual line next to its name: line style is meaningful
 * vocabulary in every EA notation, and the guidance is unanimous that its
 * meaning should be shown rather than only named.
 */
export default function LdvLineStyleSelect({ value, onChange }: Props) {
  const { t } = useTranslation(["reports"]);

  return (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="body2" sx={{ mb: 0.75 }}>
        {t("dependency.lineStyle")}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={value}
        onChange={(_e, next: LdvEdgeLineStyle | null) => {
          // `exclusive` hands back null when the active button is re-clicked;
          // a line always has a style, so keep the current one.
          if (next) onChange(next);
        }}
        aria-label={t("dependency.lineStyle")}
      >
        {LDV_LINE_STYLES.map((style) => {
          const label = t(`dependency.lineStyle_${style}`);
          const stroke = ldvEdgeStroke(style);
          return (
            <ToggleButton key={style} value={style} aria-label={label} sx={{ py: 0.75 }}>
              <Tooltip title={label} arrow>
                <Box
                  component="svg"
                  width={30}
                  height={10}
                  viewBox="0 0 30 10"
                  aria-hidden
                  sx={{ display: "block" }}
                >
                  <line
                    x1={1}
                    y1={5}
                    x2={29}
                    y2={5}
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeDasharray={stroke.strokeDasharray}
                    strokeLinecap={stroke.strokeLinecap}
                  />
                </Box>
              </Tooltip>
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", lineHeight: 1.35, mt: 0.5 }}
      >
        {t("dependency.lineStyleHint")}
      </Typography>
    </Box>
  );
}
