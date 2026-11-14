import { useMemo, useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import { alpha } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { api, ApiError, apiErrorMessage } from "@/api/client";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import FiscalYearTimeTravel from "@/components/FiscalYearTimeTravel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import { todayIsoDate } from "@/lib/dates";
import { isRenewalNear, shortFiscalYear } from "@/lib/costItems";
import { SECTION_SCROLL_MARGIN, sectionAnchor } from "@/features/cards/dataQualityJump";
import { CATEGORICAL_COLORS, EOL_WARNING_COLOR, RAG_COLORS, STATUS_COLORS } from "@/theme/tokens";
import type { CardCostsResponse, CostItemType, CostLine } from "@/types";
import CostItemDialog from "./CostItemDialog";
import { buildCostsYearBarsOption, type CostYearBar } from "./costsYearBarsOption";

interface Props {
  cardId: string;
  initialExpanded?: boolean;
  expandOn?: number;
  /** After an edit, confirm or delete went through (the card's derived total changed). */
  onChanged?: () => void;
}

type DialogState = { line: CostLine | null } | null;

/**
 * The Costs section: the card's cost items per fiscal year. Rendered only when
 * the server answers (a 403/404 means no access or not a cost-bearing card).
 */
export default function CostsSection({
  cardId,
  initialExpanded = true,
  expandOn,
  onChanged,
}: Props) {
  const { t } = useTranslation("cards");
  const { fmt } = useCurrency();
  const { formatDate } = useDateFormat();
  const chrome = useEChartsTheme();
  const fieldLabel = useFieldLabel();
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded, expandOn);
  const [version, setVersion] = useState(0);
  const { data, error } = useApiQuery<CardCostsResponse>(`/cards/${cardId}/costs`, {
    refetchKey: version,
  });
  const [picked, setPicked] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const today = useMemo(() => todayIsoDate(), []);

  const catalogue = data?.catalogue;
  const byKey = useMemo(() => new Map((catalogue ?? []).map((c) => [c.key, c])), [catalogue]);
  // A colour per active catalogue item, stable across years; archived items are grey.
  const colorIndex = useMemo(
    () => new Map((catalogue ?? []).filter((c) => !c.archived).map((c, i) => [c.key, i])),
    [catalogue],
  );
  const colorOf = (key: string): string => {
    const i = colorIndex.get(key);
    return i === undefined ? STATUS_COLORS.neutral : CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length];
  };
  // Catalogue rows always carry a label; a key with no row is not expected.
  const labelOf = (key: string): string => {
    const item = byKey.get(key);
    return item ? fieldLabel(item) : key;
  };

  // 403/404: no access or not a cost-bearing card, so the section does not exist for this user.
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
  if (error && !data) return <Alert severity="error">{t("costs.loadFailed")}</Alert>;
  if (!data) return null;

  const years = data.years;
  const currentFy = years.find((y) => y.is_current)?.fiscal_year ?? years[0].fiscal_year;
  const forecastFy = years.find((y) => y.is_forecast)?.fiscal_year ?? currentFy + 1;
  const idx = Math.max(
    0,
    years.findIndex((y) => y.fiscal_year === (picked ?? currentFy)),
  );
  const year = years[idx];
  const editable = data.can_edit; // the server decides (costs.edit, not inventory.edit)
  const present = new Set(year.items.map((i) => i.key));
  const addable: CostItemType[] = data.catalogue.filter((c) => !c.archived && !present.has(c.key));
  const reload = () => {
    setVersion((v) => v + 1);
    onChanged?.();
  };

  const confirmYear = async () => {
    setActionError(null);
    try {
      await api.post(`/cards/${cardId}/costs/${year.fiscal_year}/confirm`);
      reload();
    } catch (e) {
      setActionError(apiErrorMessage(e, t("costs.confirmFailed")));
    }
  };

  // One bar per fiscal year, the forecast on top; segments in catalogue order so
  // colours and stacking stay the same from one year to the next.
  const bars: CostYearBar[] = [...years].reverse().map((y) => {
    const amounts = new Map(y.items.map((i) => [i.key, i.amount]));
    return {
      fiscalYear: y.fiscal_year,
      label: shortFiscalYear(y.fiscal_year),
      confirmed: y.confirmed,
      total: y.tco,
      segments: data.catalogue
        .filter((c) => amounts.has(c.key))
        .map((c) => ({
          key: c.key,
          label: labelOf(c.key),
          amount: amounts.get(c.key) ?? 0,
          color: colorOf(c.key),
        })),
    };
  });
  const barOption = buildCostsYearBarsOption(bars, year.fiscal_year, {
    chrome,
    isRtl: chrome.isRtl,
    format: (v) => fmt.format(v),
    tintColor: alpha(RAG_COLORS.green, 0.12),
  });

  return (
    <Accordion
      id={sectionAnchor("costs")}
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
      sx={{ scrollMarginTop: SECTION_SCROLL_MARGIN }}
    >
      <AccordionSummary component="div" expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="payments" size={20} />
          <Typography fontWeight={600}>{t("costs.title")}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <FiscalYearTimeTravel
          years={years.map((y) => y.fiscal_year)}
          currentFy={currentFy}
          value={year.fiscal_year}
          onChange={setPicked}
        />

        {!year.confirmed && (
          <Alert
            severity="warning"
            sx={{ my: 1 }}
            action={
              editable ? (
                <Button color="inherit" size="small" onClick={confirmYear}>
                  {t("costs.confirm", { year: shortFiscalYear(year.fiscal_year) })}
                </Button>
              ) : undefined
            }
          >
            {t("costs.fallbackBanner", {
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

        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 1 }}>
          <Typography variant="h5" fontWeight={700}>
            {fmt.format(year.tco)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {!year.confirmed && year.fallback_from != null
              ? t("costs.tcoFrom", { year: shortFiscalYear(year.fallback_from) })
              : t("costs.tco")}
          </Typography>
        </Box>

        <Box sx={{ my: 1 }}>
          <EChart
            option={barOption}
            style={{ height: bars.length * 22 }}
            ariaLabel={t("costs.barLabel")}
          />
        </Box>
        {year.items.length > 0 ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 1,
              opacity: year.confirmed ? 1 : 0.75,
            }}
          >
            {year.items.map((line) => {
              const near = isRenewalNear(line.renewal_date, today);
              return (
                <ButtonBase
                  key={line.key}
                  disabled={!editable}
                  onClick={() => setDialog({ line })}
                  data-testid={`cost-tile-${line.key}`}
                  sx={{
                    display: "block",
                    textAlign: "start",
                    p: 1.25,
                    borderRadius: 1,
                    border: 1,
                    borderStyle: line.archived ? "dashed" : "solid",
                    borderColor: near && !line.archived ? EOL_WARNING_COLOR : "divider",
                    bgcolor: line.archived ? "action.hover" : "transparent",
                    color: line.archived ? "text.secondary" : "text.primary",
                    "&.Mui-disabled": { pointerEvents: "auto" },
                  }}
                >
                  <Typography variant="caption" sx={{ color: colorOf(line.key), display: "block" }}>
                    {"● "}
                    {labelOf(line.key)}
                    {line.archived ? ` (${t("costs.archived")})` : ""}
                  </Typography>
                  <Typography fontWeight={600}>{fmt.format(line.amount)}</Typography>
                  {line.archived ? (
                    <Typography variant="caption" color="text.secondary">
                      {t("costs.archivedCounted")}
                    </Typography>
                  ) : (
                    line.renewal_date && (
                      <Typography
                        variant="caption"
                        data-near={near ? "true" : "false"}
                        sx={{
                          color: near ? EOL_WARNING_COLOR : "text.secondary",
                          fontWeight: near ? 600 : 400,
                        }}
                      >
                        {t("costs.renewal", { date: formatDate(line.renewal_date) })}
                      </Typography>
                    )
                  )}
                </ButtonBase>
              );
            })}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
            {t("costs.empty")}
          </Typography>
        )}

        {editable && addable.length > 0 && (
          <Button
            fullWidth
            size="small"
            variant="outlined"
            sx={{ mt: 1.5, borderStyle: "dashed" }}
            onClick={() => setDialog({ line: null })}
          >
            {`+ ${t("costs.addItem")}`}
          </Button>
        )}

        {dialog && (
          <CostItemDialog
            cardId={cardId}
            fiscalYear={year.fiscal_year}
            forecastYear={forecastFy}
            line={dialog.line}
            options={addable}
            labelOf={labelOf}
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
