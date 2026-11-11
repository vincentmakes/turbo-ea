/**
 * What one row of the "@" popup (and of the browse dialog's decision list)
 * shows:
 * - a card: its type's colour and icon, its name, and "Type · Subtype · in
 *   Parent" under it (labels resolved for the reader's language, never a
 *   key; the parent once its name has arrived);
 * - a decision: its reference ("ADR-012 · Rev 2"), its title and the chip of
 *   its standing (its workflow status before it is signed);
 * - a person: name and e-mail.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useSubtypeLabel, useTypeLabel } from "@/hooks/useResolveLabel";
import { readableTextColor } from "@/lib/color";
import { DecisionStateChip } from "../DecisionStandingChip";
import { cardRowMeta, type MentionItem } from "./mentionModel";

const TEXT_SX = { flex: 1, minWidth: 0 } as const;

function CardMentionRow({ name, card }: { name: string; card: NonNullable<MentionItem["card"]> }) {
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();
  const subtypeLabel = useSubtypeLabel();
  const { t } = useTranslation("delivery");
  const meta = cardRowMeta(card, getType(card.type), typeLabel, subtypeLabel, (parent) =>
    t("mention.inParent", { name: parent }),
  );
  return (
    <>
      {meta.color && meta.icon ? (
        <Box
          data-testid="mention-type-icon"
          sx={{
            width: 22,
            height: 22,
            borderRadius: "4px",
            bgcolor: meta.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <MaterialSymbol icon={meta.icon} size={14} color={readableTextColor(meta.color)} />
        </Box>
      ) : (
        <Box sx={{ width: 22, flexShrink: 0 }} />
      )}
      <Box sx={TEXT_SX}>
        <Typography variant="body2" noWrap>
          {name}
        </Typography>
        {meta.detail && (
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {meta.detail}
          </Typography>
        )}
      </Box>
    </>
  );
}

export default function MentionRow({ item }: { item: MentionItem }) {
  let body;
  if (item.card) {
    body = <CardMentionRow name={item.label} card={item.card} />;
  } else if (item.decision) {
    const d = item.decision;
    body = (
      <>
        <Box sx={TEXT_SX}>
          <Typography variant="caption" color="text.secondary" fontWeight={600} component="div" noWrap>
            {d.reference}
          </Typography>
          <Typography variant="body2" noWrap>
            {d.title}
          </Typography>
        </Box>
        <DecisionStateChip
          adr={{ status: d.status, standing: d.standing ?? null, recorded_at: d.recorded_at ?? null }}
          sx={{ flexShrink: 0 }}
        />
      </>
    );
  } else {
    body = (
      <Box sx={TEXT_SX}>
        <Typography variant="body2" noWrap>
          {item.label}
        </Typography>
        {item.secondary && (
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {item.secondary}
          </Typography>
        )}
      </Box>
    );
  }
  return <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", minWidth: 0 }}>{body}</Box>;
}
