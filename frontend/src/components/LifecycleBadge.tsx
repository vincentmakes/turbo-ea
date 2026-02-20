import Chip from "@mui/material/Chip";

const PHASE_COLORS: Record<string, "default" | "primary" | "success" | "warning" | "error"> = {
  plan: "default",
  phaseIn: "primary",
  active: "success",
  phaseOut: "warning",
  endOfLife: "error",
};

const PHASE_LABELS: Record<string, string> = {
  plan: "Plan",
  phaseIn: "Phase In",
  active: "Active",
  phaseOut: "Phase Out",
  endOfLife: "End of Life",
};

export function getCurrentPhase(lifecycle?: Record<string, string>): string | null {
  if (!lifecycle) return null;
  const now = new Date().toISOString().slice(0, 10);
  const phases = ["endOfLife", "phaseOut", "active", "phaseIn", "plan"] as const;
  for (const phase of phases) {
    if (lifecycle[phase] && lifecycle[phase] <= now) return phase;
  }
  if (lifecycle.plan && lifecycle.plan > now) return "plan";
  return null;
}

interface Props {
  lifecycle?: Record<string, string>;
  size?: "small" | "medium";
}

export default function LifecycleBadge({ lifecycle, size = "small" }: Props) {
  const phase = getCurrentPhase(lifecycle);
  if (!phase) return null;
  return (
    <Chip
      size={size}
      label={PHASE_LABELS[phase] || phase}
      color={PHASE_COLORS[phase] || "default"}
    />
  );
}
