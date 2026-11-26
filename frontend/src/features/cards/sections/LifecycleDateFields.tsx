import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/DateField";
import { PHASES, getPhaseLabels } from "@/lib/lifecyclePhases";
import { useLifecycleOrderWarning } from "@/hooks/useLifecycleOrderWarning";

/** What a caller wants said about one phase, beyond its date. */
export type PhaseAnnotation = {
  /** Rendered under the phase, in both the timeline and the edit row. */
  note?: React.ReactNode;
  /** Marks the phase as differing from some baseline the caller knows about. */
  highlighted?: boolean;
};

/**
 * One date field per lifecycle phase, labelled with the phase names, each
 * carrying the advisory out-of-order warning. Presentational: the caller owns
 * the draft and what saving means — the card's Lifecycle section commits it
 * through its `onSave`, a relation row's clock PATCHes the relation.
 *
 * Each field sits in a `[data-phase]` box so a caller can focus a phase.
 */
export default function LifecycleDateFields({
  lifecycle,
  onChange,
  phaseAnnotation,
  disabled,
}: {
  lifecycle: Record<string, string>;
  /** The whole draft with one phase changed. */
  onChange: (next: Record<string, string>) => void;
  phaseAnnotation?: (phase: string) => PhaseAnnotation | null | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const phaseLabels = getPhaseLabels(t);
  const orderWarning = useLifecycleOrderWarning(lifecycle);
  return (
    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
      {PHASES.map((phase) => {
        const annotation = phaseAnnotation?.(phase);
        const warning = orderWarning(phase);
        return (
          <Box key={phase} data-phase={phase} sx={{ maxWidth: 170 }}>
            <DateField
              label={phaseLabels[phase]}
              size="small"
              value={lifecycle[phase] || ""}
              onChange={(v) => onChange({ ...lifecycle, [phase]: v })}
              disabled={disabled}
              helperText={warning ?? undefined}
              slotProps={
                warning
                  ? { formHelperText: { sx: { color: "warning.main", mx: 0 } } }
                  : undefined
              }
              sx={{
                width: 170,
                ...(annotation?.highlighted
                  ? {
                      "& .MuiOutlinedInput-notchedOutline": {
                        borderColor: "primary.main",
                      },
                      "& .MuiInputLabel-root": { color: "primary.main" },
                    }
                  : null),
              }}
            />
            {annotation?.note}
          </Box>
        );
      })}
    </Box>
  );
}
