import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { LDV_AGGREGATE_LEVELS, type LdvAggregateBy } from "./ldvAggregate";

interface Props {
  value: LdvAggregateBy;
  onChange: (next: LdvAggregateBy) => void;
}

/**
 * Picks what the Layered Dependency View's related cards are grouped into when
 * relations are aggregated — off, by EA layer, by card type, or by subtype.
 *
 * A level rather than a switch because that is what
 * [#1117](https://github.com/vincentmakes/turbo-ea/discussions/1117) asks for:
 * "grouping should be based on card domain, card type, subtype etc." A landscape
 * reads differently at each, and the same diagram at "by layer" answers a
 * different question than at "by subtype".
 *
 * Presented like `LdvLineStyleSelect` and sitting beside it: both are
 * union-valued options that cannot join the popover's run of switch rows, and
 * two dropdowns in one small popover would read as more machinery than four
 * words in a row.
 *
 * A component of its own because `LayeredDependencyView` cannot mount under
 * jsdom, so anything rendered inside it is untestable.
 */
export default function LdvAggregateSelect({ value, onChange }: Props) {
  const { t } = useTranslation(["reports"]);

  return (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="body2" sx={{ mb: 0.75 }}>
        {t("dependency.aggregateBy")}
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={value}
        onChange={(_e, next: LdvAggregateBy | null) => {
          // `exclusive` hands back null when the active button is re-clicked;
          // the view is always at some level, so keep the current one.
          if (next) onChange(next);
        }}
        aria-label={t("dependency.aggregateBy")}
      >
        {LDV_AGGREGATE_LEVELS.map((level) => {
          const label = t(`dependency.aggregateBy_${level}`);
          return (
            <ToggleButton
              key={level}
              value={level}
              aria-label={label}
              sx={{ py: 0.5, textTransform: "none", fontSize: "0.7rem", lineHeight: 1.2 }}
            >
              {label}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", lineHeight: 1.35, mt: 0.5 }}
      >
        {t("dependency.aggregateByHint")}
      </Typography>
    </Box>
  );
}
