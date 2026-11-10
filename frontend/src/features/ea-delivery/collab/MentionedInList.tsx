/**
 * "Mentioned in": the decisions and SoAWs whose text or discussion mention a
 * card (on the card's decisions tab) or a decision (on its preview), limited
 * by the server to what the reader may open. Renders nothing when there are
 * none, or when the reader may not ask.
 */
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { MentionedIn } from "@/types";
import { DecisionStateChip } from "../DecisionStandingChip";
import { decisionRefLabel, revisionLabel } from "../decisionStanding";

interface Props {
  target: { kind: "card" | "decision"; id: string };
}

/** `GET` path of what mentions a card or a decision. */
function mentionedInPath(target: Props["target"]): string {
  return target.kind === "card" ? `/mentions/cards/${target.id}` : `/mentions/decisions/${target.id}`;
}

export default function MentionedInList({ target }: Props) {
  const { t } = useTranslation("delivery");
  const { data } = useApiQuery<MentionedIn>(mentionedInPath(target));
  const decisions = data?.decisions ?? [];
  const soaws = data?.soaws ?? [];
  if (decisions.length === 0 && soaws.length === 0) return null;

  const viaComment = (via: string | undefined) =>
    via === "comment" && (
      <Chip size="small" variant="outlined" label={t("collab.mentionedIn.inDiscussion")} sx={{ height: 20 }} />
    );

  return (
    <Box data-testid="mentioned-in">
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {t("collab.mentionedIn.title")}
      </Typography>
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
        {decisions.map((d) => (
          <Box component="li" key={`adr-${d.id}`} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <MaterialSymbol icon="gavel" size={16} />
            <Link component={RouterLink} to={`/ea-delivery/adr/${d.id}/preview`} variant="body2">
              {`${decisionRefLabel(d, t)} ${d.title}`}
            </Link>
            <DecisionStateChip adr={{ status: d.status, standing: d.standing, recorded_at: null }} />
            {viaComment(d.via)}
          </Box>
        ))}
        {soaws.map((s) => (
          <Box component="li" key={`soaw-${s.id}`} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <MaterialSymbol icon="description" size={16} />
            <Link component={RouterLink} to={`/ea-delivery/soaw/${s.id}/preview`} variant="body2">
              {s.revision_number > 1 ? `${s.name} (${revisionLabel(s.revision_number, t)})` : s.name}
            </Link>
            {viaComment(s.via)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
