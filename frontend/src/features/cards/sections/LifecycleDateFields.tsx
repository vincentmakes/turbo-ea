import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/DateField";
import MaterialSymbol from "@/components/MaterialSymbol";
import { PHASES, getPhaseLabels } from "@/lib/lifecyclePhases";
import { manualPhaseBounds } from "./lifecycleMaintained";
import { useLifecycleOrderWarning } from "@/hooks/useLifecycleOrderWarning";

/** What a caller wants said about one phase, beyond its date. */
export type PhaseAnnotation = {
  /** Rendered under the phase, in both the timeline and the edit row. */
  note?: React.ReactNode;
  /** Marks the phase as differing from some baseline the caller knows about. */
  highlighted?: boolean;
};

/**
 * Marks a lifecycle phase whose date an installed extension maintains: shown,
 * never editable by hand (the backend refuses a change while the lock holds).
 * `name` is the extension's display name, said in the tooltip.
 */
export function MaintainedPhaseChip({ phase, name }: { phase: string; name: string }) {
  const { t } = useTranslation("cards");
  return (
    <Tooltip title={t("lifecycle.maintained.tooltip", { name })}>
      <Chip
        component="span"
        size="small"
        data-testid="lifecycle-maintained-chip"
        data-maintained-phase={phase}
        icon={<MaterialSymbol icon="lock" size={12} />}
        label={t("lifecycle.maintained.chip")}
        sx={{ height: 18, fontSize: "0.6rem", mt: 0.5, verticalAlign: "middle" }}
      />
    </Tooltip>
  );
}

/**
 * One date field per lifecycle phase, labelled with the phase names, each
 * carrying the advisory out-of-order warning. Presentational: the caller owns
 * the draft and what saving means — the card's Lifecycle section commits it
 * through its `onSave`, a relation row's clock PATCHes the relation.
 *
 * Each field sits in a `[data-phase]` box so a caller can focus a phase.
 *
 * `lockedPhases` (optional) names phases an installed extension maintains:
 * their fields are disabled and carry a chip naming `lockedBy`, and every
 * other phase is bounded by its nearest maintained neighbours' dates. Without
 * it the component renders exactly as before.
 */
export default function LifecycleDateFields({
  lifecycle,
  onChange,
  phaseAnnotation,
  disabled,
  lockedPhases,
  lockedBy = "",
}: {
  lifecycle: Record<string, string>;
  /** The whole draft with one phase changed. */
  onChange: (next: Record<string, string>) => void;
  phaseAnnotation?: (phase: string) => PhaseAnnotation | null | undefined;
  disabled?: boolean;
  /** Phases maintained by an installed extension — shown, not editable. */
  lockedPhases?: readonly string[];
  /** Display name of the extension maintaining `lockedPhases`. */
  lockedBy?: string;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const phaseLabels = getPhaseLabels(t);
  const orderWarning = useLifecycleOrderWarning(lifecycle);
  const locked = new Set(lockedPhases ?? []);
  return (
    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
      {PHASES.map((phase) => {
        const annotation = phaseAnnotation?.(phase);
        const warning = orderWarning(phase);
        const isLocked = locked.has(phase);
        const { min, max } = manualPhaseBounds(phase, lifecycle, locked);
        const bounded = min !== undefined || max !== undefined;
        const helper = warning ?? (bounded ? t("lifecycle.maintained.boundHint") : undefined);
        return (
          <Box key={phase} data-phase={phase} sx={{ maxWidth: 170 }}>
            <DateField
              label={phaseLabels[phase]}
              size="small"
              value={lifecycle[phase] || ""}
              onChange={(v) => onChange({ ...lifecycle, [phase]: v })}
              disabled={disabled || isLocked}
              helperText={helper}
              slotProps={
                warning || bounded
                  ? {
                      ...(warning
                        ? { formHelperText: { sx: { color: "warning.main", mx: 0 } } }
                        : { formHelperText: { sx: { mx: 0 } } }),
                      ...(bounded ? { htmlInput: { min, max } } : {}),
                    }
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
            {isLocked && <MaintainedPhaseChip phase={phase} name={lockedBy} />}
            {annotation?.note}
          </Box>
        );
      })}
    </Box>
  );
}
