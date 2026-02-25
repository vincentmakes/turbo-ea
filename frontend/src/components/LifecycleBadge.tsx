import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

const PHASE_COLORS: Record<string, "default" | "primary" | "success" | "warning" | "error"> = {
  plan: "default",
  phaseIn: "primary",
  active: "success",
  phaseOut: "warning",
  endOfLife: "error",
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
  const { t } = useTranslation("common");
  const theme = useTheme();
  const phase = getCurrentPhase(lifecycle);
  if (!phase) return null;
  const chipColor = PHASE_COLORS[phase] || "default";
  const dotColor =
    chipColor === "default"
      ? theme.palette.text.secondary
      : theme.palette[chipColor].main;
  return (
    <Chip
      size={size}
      label={t(`lifecycle.${phase}`) || phase}
      color={chipColor}
      variant="outlined"
      icon={
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: dotColor,
            flexShrink: 0,
          }}
        />
      }
    />
  );
}
