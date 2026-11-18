import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CardLogoAvatar from "@/components/CardLogoAvatar";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import MaterialSymbol from "@/components/MaterialSymbol";
import PairBars from "@/components/licensing/PairBars";
import { buildPairGroups, pairHues } from "@/components/licensing/licensePairs";
import { useLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { useIsRtl } from "@/hooks/useIsRtl";
import { useMetamodel } from "@/hooks/useMetamodel";
import { STATUS_LABEL_KEY, statusColor } from "@/lib/licenses";
import { CHART_OTHER, STATUS_COLORS } from "@/theme/tokens";
import type { LicenseReportRow } from "@/types";

interface Props {
  row: LicenseReportRow;
  expanded: boolean;
  onToggle: () => void;
  /** The `metric:type` key of the pair whose history is shown, if it is one of this card's. */
  selectedPairKey: string | null;
  onPick: (pairKey: string) => void;
  onOpen: (cardId: string) => void;
}

/** What an expanded row shows: the card's Licensing bars for the selected year, once the catalogue is there. */
function RowBars({ row, selectedPairKey, onPick }: Pick<Props, "row" | "selectedPairKey" | "onPick">) {
  const { t, i18n } = useTranslation(["cards"]);
  const chrome = useEChartsTheme();
  const { metrics: catalogue, loading, failed } = useLicenseCatalogue();
  const hues = useMemo(
    () => pairHues(catalogue, chrome.categorical, CHART_OTHER[chrome.mode]),
    [catalogue, chrome.categorical, chrome.mode],
  );
  // Without the catalogue a bar would carry a raw key as its label.
  if (failed) return <Alert severity="error">{t("cards:licensing.loadFailed")}</Alert>;
  if (loading) return null;
  if (row.by_metric.length === 0)
    return (
      <Typography variant="body2" color="text.secondary">
        {t("cards:licensing.noPairs")}
      </Typography>
    );
  return (
    <PairBars
      groups={buildPairGroups(row.by_metric, {
        catalogue,
        locale: i18n.language,
        t,
        suffix: ` (${t("cards:licensing.archived")})`,
        forecast: false,
        colorOf: (metric, key) => hues.get(`${metric}:${key}`) ?? chrome.categorical[0],
      })}
      selectedKey={selectedPairKey}
      forecast={false}
      confirmed
      onPick={onPick}
    />
  );
}

/**
 * One card of the report's list. The header is a button (keyboard and screen reader);
 * opening the card is a second button beside it, never nested in it.
 */
export default function LicensingCardRow({ row, expanded, onToggle, selectedPairKey, onPick, onOpen }: Props) {
  const { t } = useTranslation(["reports", "common"]);
  const { getType } = useMetamodel();
  const isRtl = useIsRtl();
  const type = getType(row.type);
  const bodyId = `licensing-row-${row.id}`;
  return (
    <Paper variant="outlined" sx={{ mb: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <ButtonBase
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 1.5, p: 1.5, textAlign: "start", justifyContent: "flex-start" }}
        >
          <Box component="span" aria-hidden sx={{ display: "inline-flex" }}>
            <MaterialSymbol icon={expanded ? "expand_more" : isRtl ? "chevron_left" : "chevron_right"} size={20} />
          </Box>
          <CardLogoAvatar
            cardId={row.id}
            logoUpdatedAt={row.logo_updated_at}
            typeIcon={type?.icon ?? "badge"}
            typeColor={type?.color ?? STATUS_COLORS.neutral}
            size={32}
            radius={1.5}
          />
          <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="div" fontWeight={600} noWrap>
              {row.name}
            </Typography>
            {row.alias && (
              <Typography component="div" variant="caption" color="text.secondary" noWrap>
                {row.alias}
              </Typography>
            )}
          </Box>
          {row.status && (
            <Chip
              size="small"
              variant="outlined"
              label={t(STATUS_LABEL_KEY[row.status])}
              sx={{ borderColor: statusColor(row.status), color: statusColor(row.status) }}
            />
          )}
        </ButtonBase>
        <IconButton
          size="small"
          aria-label={t("licensing.openCard", { name: row.name })}
          onClick={() => onOpen(row.id)}
          sx={{ mx: 1 }}
        >
          <MaterialSymbol icon="open_in_new" size={18} />
        </IconButton>
      </Box>
      {expanded && (
        <Box id={bodyId} sx={{ px: 2, pb: 2 }}>
          <RowBars row={row} selectedPairKey={selectedPairKey} onPick={onPick} />
        </Box>
      )}
    </Paper>
  );
}
