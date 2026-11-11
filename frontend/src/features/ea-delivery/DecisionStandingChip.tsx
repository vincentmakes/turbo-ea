/**
 * Small chips naming a decision's standing ("In force", "Revoked", …) and its
 * workflow status ("Draft", "Signed", "Recorded", …). Colours and labels come
 * from `decisionStanding.ts`, the one home of that vocabulary.
 */
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

import type { ArchitectureDecision, DecisionStanding } from "@/types";
import { STANDING_CHIP, type ChipStyle, statusChip } from "./decisionStanding";

const CHIP_SX = { fontSize: 11, height: 20, fontWeight: 500 } as const;

function StyledChip({ style, sx }: { style: ChipStyle; sx?: SxProps<Theme> }) {
  const { t } = useTranslation("delivery");
  return (
    <Chip
      label={t(style.labelKey)}
      size="small"
      color={style.color}
      variant={style.variant}
      sx={[CHIP_SX, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}
    />
  );
}

export interface DecisionStandingChipProps {
  standing: DecisionStanding | null | undefined;
  sx?: SxProps<Theme>;
}

/** The standing of a signed decision; nothing for a decision with none. */
export function DecisionStandingChip({ standing, sx }: DecisionStandingChipProps) {
  const style = standing ? STANDING_CHIP[standing] : undefined;
  if (!style) return null;
  return <StyledChip style={style} sx={sx} />;
}

export interface DecisionStatusChipProps {
  adr: Pick<ArchitectureDecision, "status" | "recorded_at">;
  sx?: SxProps<Theme>;
}

/** The workflow status; "Recorded" for a decision recorded as decided. */
export function DecisionStatusChip({ adr, sx }: DecisionStatusChipProps) {
  return <StyledChip style={statusChip(adr)} sx={sx} />;
}

/**
 * What a list shows for a decision: its standing once signed, its workflow
 * status before that.
 */
export function DecisionStateChip({
  adr,
  sx,
}: {
  adr: Pick<ArchitectureDecision, "status" | "recorded_at" | "standing">;
  sx?: SxProps<Theme>;
}) {
  if (adr.standing) return <DecisionStandingChip standing={adr.standing} sx={sx} />;
  return <DecisionStatusChip adr={adr} sx={sx} />;
}
