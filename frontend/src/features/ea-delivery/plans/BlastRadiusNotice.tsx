/**
 * Impact / blast-radius summary for a card the plan is about to remove or
 * replace. Reuses the app's own `GET /cards/{id}/archive-impact` — the same
 * "what breaks if you retire this" payload the archive flow shows — so the
 * removal is a considered architectural decision, not a silent card deletion.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import { useMetamodel } from "@/hooks/useMetamodel";

interface ArchiveImpact {
  descendant_count: number;
  related_cards: { id: string; name: string; type: string; direction: string }[];
}

export default function BlastRadiusNotice({ cardId }: { cardId: string | null }) {
  const { t } = useTranslation("delivery");
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const [impact, setImpact] = useState<ArchiveImpact | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cardId) {
      setImpact(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<ArchiveImpact>(`/cards/${cardId}/archive-impact`)
      .then((r) => {
        if (!cancelled) setImpact(r);
      })
      .catch(() => {
        if (!cancelled) setImpact(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (!cardId) return null;
  if (loading) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">
          {t("plan.impact.checking")}
        </Typography>
      </Stack>
    );
  }
  if (!impact) return null;

  const dependents = impact.related_cards.length;
  const descendants = impact.descendant_count;
  if (dependents === 0 && descendants === 0) {
    return (
      <Alert severity="success" sx={{ mt: 1.5 }} variant="outlined">
        {t("plan.impact.none")}
      </Alert>
    );
  }

  // Break dependents down by card type for a readable "N applications, M interfaces".
  const byType = new Map<string, number>();
  for (const rc of impact.related_cards) byType.set(rc.type, (byType.get(rc.type) ?? 0) + 1);
  const parts = [...byType.entries()].map(
    ([typeKey, count]) =>
      `${count} ${typeLabel(types.find((x) => x.key === typeKey) ?? { key: typeKey, label: typeKey })}`,
  );

  return (
    <Alert severity="warning" sx={{ mt: 1.5 }}>
      <Typography variant="body2" fontWeight={600}>
        {t("plan.impact.title", { count: dependents })}
      </Typography>
      {parts.length > 0 && (
        <Typography variant="body2">{parts.join(" · ")}</Typography>
      )}
      {descendants > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("plan.impact.descendants", { count: descendants })}
        </Typography>
      )}
    </Alert>
  );
}
