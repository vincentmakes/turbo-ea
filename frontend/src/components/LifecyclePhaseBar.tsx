import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import type { LifecyclePhase } from "@/lib/lifecyclePhases";
import { phaseSegments, type BarAxis } from "@/lib/lifecycleBar";
import { LIFECYCLE_PHASE_COLORS, STATUS_CHIP_COLORS, STATUS_COLORS } from "@/theme/tokens";

export interface LifecyclePhaseBarProps {
  /** The five phase dates (`plan` … `endOfLife` → ISO date); absent ones are skipped. */
  lifecycle: Record<string, string | undefined> | undefined;
  axis: BarAxis;
  /** The translated name of a phase, for the tooltips. */
  phaseLabel: (phase: LifecyclePhase) => string;
  /** How a phase date reads in the tooltips. */
  formatDate: (iso: string | undefined) => string;
  /** The slimmer track a sub-row or a compact panel uses (28px row). */
  dense?: boolean;
  /** Leads every tooltip ("Prefix · Active: …"), so two bars on one page
   *  never share a name. */
  titlePrefix?: string;
}

/**
 * One lifecycle drawn on a time axis: a coloured bar per dated phase, each
 * running to the next dated phase (the last to the axis end), and End of Life
 * as a pin. The track is absolutely placed — the caller supplies a relatively
 * positioned row (32px, or 28px when `dense`). Positions go through `sx`
 * `left` / `width` in %, so right-to-left mirroring keeps working.
 *
 * The geometry is `phaseSegments` (`lib/lifecycleBar.ts`), the Lifecycle
 * report's own rule.
 */
export default function LifecyclePhaseBar({
  lifecycle,
  axis,
  phaseLabel,
  formatDate,
  dense = false,
  titlePrefix,
}: LifecyclePhaseBarProps) {
  const theme = useTheme();
  const { segments, eolPct } = phaseSegments(lifecycle, axis);
  const title = (phase: LifecyclePhase) => {
    const text = `${phaseLabel(phase)}: ${formatDate(lifecycle?.[phase])}`;
    return titlePrefix ? `${titlePrefix} · ${text}` : text;
  };
  const pin = dense ? 14 : 20;
  return (
    <Box
      sx={{
        position: "absolute",
        top: dense ? 9 : 8,
        left: 0,
        right: 0,
        height: dense ? 10 : 16,
      }}
    >
      {segments.map((s, i) => (
        <Tooltip key={s.phase} title={title(s.phase)}>
          <Box
            sx={{
              position: "absolute",
              left: `${s.left}%`,
              width: `${s.width}%`,
              height: "100%",
              bgcolor: LIFECYCLE_PHASE_COLORS[s.phase],
              borderRadius:
                i === 0 ? "3px 0 0 3px" : i === segments.length - 1 ? "0 3px 3px 0" : 0,
            }}
          />
        </Tooltip>
      ))}
      {eolPct != null && (
        <Tooltip title={title("endOfLife")}>
          <Box
            sx={{
              position: "absolute",
              left: `${eolPct}%`,
              top: -2,
              transform: "translateX(-50%)",
              zIndex: 2,
              lineHeight: 0,
            }}
          >
            <svg width={pin} height={pin} viewBox="0 0 20 20">
              <circle
                cx="10"
                cy="10"
                r="9"
                fill={STATUS_COLORS.error}
                stroke={STATUS_CHIP_COLORS.error.text}
                strokeWidth="1"
              />
              <rect x="4" y="8" width="12" height="4" rx="1" fill={theme.palette.common.white} />
            </svg>
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}
