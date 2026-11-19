import { useMemo, useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { api, ApiError, apiErrorMessage } from "@/api/client";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import FiscalYearTimeTravel from "@/components/FiscalYearTimeTravel";
import PairBars from "@/components/licensing/PairBars";
import PairHistory from "@/components/licensing/PairHistory";
import {
  buildPairGroups,
  pairHistoryRows,
  pairHues,
  pairName,
} from "@/components/licensing/licensePairs";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useLicenseCatalogue } from "@/hooks/useLicenseCatalogue";
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import { shortFiscalYear } from "@/lib/costItems";
import { addableCatalogue, pairKey, statusColor } from "@/lib/licenses";
import { SECTION_SCROLL_MARGIN, sectionAnchor } from "@/features/cards/dataQualityJump";
import { CHART_OTHER } from "@/theme/tokens";
import type { CardLicensesResponse } from "@/types";
import LicenseItemDialog, { type LicenseCell } from "./LicenseItemDialog";

interface Props {
  cardId: string;
  initialExpanded?: boolean;
  expandOn?: number;
  /** After an edit, confirm or delete went through. */
  onChanged?: () => void;
}

type DialogState = { cell: LicenseCell | null } | null;
type Pair = { metric: string; key: string };

/**
 * The Licensing section: the pairs Metric:Type a card has in the selected fiscal year, as
 * bars grouped by metric; a click on a bar shows that pair's history below. Rendered only
 * when the server answers (a 403/404 means no access or not a license-bearing card).
 */
export default function LicensingSection({
  cardId,
  initialExpanded = true,
  expandOn,
  onChanged,
}: Props) {
  const { t, i18n } = useTranslation("cards");
  const locale = i18n.language;
  const chrome = useEChartsTheme();
  const { metrics: catalogue, loading, failed } = useLicenseCatalogue();
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded, expandOn);
  const [version, setVersion] = useState(0);
  const { data, error } = useApiQuery<CardLicensesResponse>(`/cards/${cardId}/licenses`, {
    refetchKey: version,
  });
  const [picked, setPicked] = useState<number | null>(null);
  const [selected, setSelected] = useState<Pair | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const hues = useMemo(
    () => pairHues(catalogue, chrome.categorical, CHART_OTHER[chrome.mode]),
    [catalogue, chrome.categorical, chrome.mode],
  );
  const colorOf = (metric: string, key: string) =>
    hues.get(pairKey(metric, key)) ?? chrome.categorical[0];

  // 403/404: no access or not a license-bearing card, so the section does not exist for this user.
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
  if ((error && !data) || failed) return <Alert severity="error">{t("licensing.loadFailed")}</Alert>;
  // Without the catalogue a bar would carry a raw key as its label.
  if (!data || loading) return null;

  const years = data.years;
  const currentFy = years.find((y) => y.is_current)?.fiscal_year ?? years[0].fiscal_year;
  const forecastFy = years.find((y) => y.is_forecast)?.fiscal_year ?? currentFy + 1;
  const year = years[
    Math.max(
      0,
      years.findIndex((y) => y.fiscal_year === (picked ?? currentFy)),
    )
  ];
  const forecast = year.is_forecast;
  const editable = data.can_edit;
  const reload = () => {
    setVersion((v) => v + 1);
    onChanged?.();
  };

  const archived = ` (${t("licensing.archived")})`;

  const pairsByKey = new Map<string, Pair>(
    year.metrics.flatMap((m) =>
      m.types.map((r) => [pairKey(m.metric, r.key), { metric: m.metric, key: r.key }] as const),
    ),
  );
  const held = new Set(pairsByKey.keys());
  const canAdd = addableCatalogue(catalogue, held).length > 0;
  const groups = buildPairGroups(year.metrics, {
    catalogue,
    locale,
    t,
    suffix: archived,
    forecast,
    colorOf,
  });
  // The cell of the picked pair in the picked year, if the year has it (it may not).
  const cellOf = (p: Pair) =>
    year.metrics.find((m) => m.metric === p.metric)?.types.find((r) => r.key === p.key);
  const active = selected && cellOf(selected) ? selected : null;

  const confirmYear = async () => {
    setActionError(null);
    try {
      await api.post(`/cards/${cardId}/licenses/${year.fiscal_year}/confirm`);
      reload();
    } catch (e) {
      setActionError(apiErrorMessage(e, t("licensing.confirmFailed")));
    }
  };

  const pick = (key: string) => {
    const pair = pairsByKey.get(key);
    if (!pair) return;
    setSelected(active && pairKey(active.metric, active.key) === key ? null : pair);
  };

  const renderHistory = (p: Pair) => {
    const cell = cellOf(p);
    return (
      <>
        <PairHistory
          pair={{ label: pairName(catalogue, p.metric, p.key, locale, archived), color: colorOf(p.metric, p.key) }}
          years={pairHistoryRows(years, p.metric, p.key)}
        />
        {editable && cell && (
          <Button
            size="small"
            onClick={() =>
              setDialog({
                cell: { metric: p.metric, key: p.key, licensed: cell.licensed, actual: cell.actual },
              })
            }
          >
            {t("common:actions.edit")}
          </Button>
        )}
      </>
    );
  };

  return (
    <Accordion
      id={sectionAnchor("licensing")}
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
      sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}
    >
      <AccordionSummary component="div" expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="badge" size={20} />
          <Typography fontWeight={600}>{t("licensing.title")}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <FiscalYearTimeTravel
          years={years.map((y) => y.fiscal_year)}
          currentFy={currentFy}
          value={year.fiscal_year}
          onChange={(fy) => {
            setPicked(fy);
            setSelected(null);
          }}
        />
        {!year.confirmed && (
          <Alert
            severity="warning"
            sx={{ my: 1 }}
            action={
              editable ? (
                <Button color="inherit" size="small" onClick={confirmYear}>
                  {t("licensing.confirm", { year: shortFiscalYear(year.fiscal_year) })}
                </Button>
              ) : undefined
            }
          >
            {t("licensing.fallbackBanner", {
              year: shortFiscalYear(year.fiscal_year),
              from: year.fallback_from != null ? shortFiscalYear(year.fallback_from) : "",
            })}
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {actionError}
          </Alert>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 1 }}>
          <Box sx={{ flex: 1 }}>
            {!forecast && year.status && groups.length > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={t(`licensing.status.${year.status}`)}
                sx={{ borderColor: statusColor(year.status), color: statusColor(year.status) }}
              />
            )}
          </Box>
          {editable && canAdd && (
            <Button size="small" variant="outlined" onClick={() => setDialog({ cell: null })}>
              {`+ ${t("licensing.addItem")}`}
            </Button>
          )}
        </Box>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
            {t("licensing.noPairs")}
          </Typography>
        ) : (
          <PairBars
            groups={groups}
            selectedKey={active && pairKey(active.metric, active.key)}
            forecast={forecast}
            confirmed={year.confirmed}
            onPick={pick}
          />
        )}
        {active && renderHistory(active)}

        {dialog && (
          <LicenseItemDialog
            cardId={cardId}
            fiscalYear={year.fiscal_year}
            forecastYear={forecastFy}
            cell={dialog.cell}
            catalogue={catalogue}
            held={held}
            onClose={() => setDialog(null)}
            onChanged={(opts) => {
              if (!opts?.keepOpen) setDialog(null);
              reload();
            }}
          />
        )}
      </AccordionDetails>
    </Accordion>
  );
}
