import { useMemo, useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { api, ApiError, apiErrorMessage } from "@/api/client";
import EChart from "@/components/charts/EChart";
import { useEChartsTheme } from "@/components/charts/echartsTheme";
import FiscalYearTimeTravel from "@/components/FiscalYearTimeTravel";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useFieldLabel, useOptionLabel } from "@/hooks/useResolveLabel";
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import { shortFiscalYear } from "@/lib/costItems";
import { formatPct, LICENSE_METRICS, statusColor } from "@/lib/licenses";
import { catalogueHues } from "@/features/reports/costColors";
import { SECTION_SCROLL_MARGIN, sectionAnchor } from "@/features/cards/dataQualityJump";
import { CHART_OTHER } from "@/theme/tokens";
import type {
  CardLicensesResponse,
  FieldDef,
  LicenseMetric,
  LicenseMetricResult,
  LicenseType,
  LicenseTypeResult,
} from "@/types";
import LicenseItemDialog, { type LicenseCell } from "./LicenseItemDialog";
import { buildLicensingBarOption } from "./licensingBarOption";

interface Props {
  cardId: string;
  initialExpanded?: boolean;
  expandOn?: number;
  /** The type's `licensingModel` field (its options and their labels). */
  modelField?: FieldDef;
  /** Saves the card's `licensingModel`; without it the model is read-only. */
  onSaveModel?: (next: LicenseMetric[]) => Promise<void>;
  /** After an edit, confirm or delete went through. */
  onChanged?: () => void;
}

type DialogState = { cell: LicenseCell | null } | null;

/**
 * The Licensing section: the card's license counts per metric, license type and
 * fiscal year. Rendered only when the server answers (a 403/404 means no access
 * or not a license-bearing card).
 */
export default function LicensingSection({
  cardId,
  initialExpanded = true,
  expandOn,
  modelField,
  onSaveModel,
  onChanged,
}: Props) {
  const { t } = useTranslation("cards");
  const chrome = useEChartsTheme();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded, expandOn);
  const [version, setVersion] = useState(0);
  const { data, error } = useApiQuery<CardLicensesResponse>(`/cards/${cardId}/licenses`, {
    refetchKey: version,
  });
  const [picked, setPicked] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<LicenseMetric[] | null>(null); // non-null: editing the model
  const [modelError, setModelError] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);

  const catalogue = data?.catalogue;
  const byKey = useMemo(() => new Map((catalogue ?? []).map((c) => [c.key, c])), [catalogue]);
  // A hue per catalogue key by sort order, archived included, so it is stable across years.
  const hues = useMemo(
    () =>
      catalogueHues(
        [...(catalogue ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.key),
        chrome.categorical,
        CHART_OTHER[chrome.mode],
      ),
    [catalogue, chrome.categorical, chrome.mode],
  );
  const labelOf = (key: string): string => {
    const item = byKey.get(key);
    return item ? fieldLabel(item) : key;
  };

  // 403/404: no access or not a license-bearing card, so the section does not exist for this user.
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
  if (error && !data) return <Alert severity="error">{t("licensing.loadFailed")}</Alert>;
  if (!data) return null;

  const years = data.years;
  const currentFy = years.find((y) => y.is_current)?.fiscal_year ?? years[0].fiscal_year;
  const forecastFy = years.find((y) => y.is_forecast)?.fiscal_year ?? currentFy + 1;
  const idx = Math.max(
    0,
    years.findIndex((y) => y.fiscal_year === (picked ?? currentFy)),
  );
  const year = years[idx];
  const editable = data.can_edit;
  const model = data.licensing_model;
  const addable: LicenseType[] = data.catalogue.filter((c) => !c.archived);
  const reload = () => {
    setVersion((v) => v + 1);
    onChanged?.();
  };

  const confirmYear = async () => {
    setActionError(null);
    try {
      await api.post(`/cards/${cardId}/licenses/${year.fiscal_year}/confirm`);
      reload();
    } catch (e) {
      setActionError(apiErrorMessage(e, t("licensing.confirmFailed")));
    }
  };

  const saveModel = async () => {
    if (!onSaveModel || !draft) return;
    setSavingModel(true);
    setModelError(null);
    try {
      await onSaveModel(draft);
      setDraft(null);
      reload();
    } catch (e) {
      setModelError(apiErrorMessage(e, t("licensing.modelSaveFailed")));
    } finally {
      setSavingModel(false);
    }
  };
  const editModelButton = onSaveModel && modelField && (
    <Button
      size="small"
      onClick={() => {
        setModelError(null);
        setDraft([...model]);
      }}
    >
      {t("licensing.editModel")}
    </Button>
  );
  const modelEditor = draft && modelField && (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, flexWrap: "wrap" }}>
      {(modelField.options ?? [])
        .filter((o) => (LICENSE_METRICS as readonly string[]).includes(o.key))
        .map((o) => (
          <FormControlLabel
            key={o.key}
            label={optionLabel(o)}
            control={
              <Checkbox
                size="small"
                checked={draft.includes(o.key as LicenseMetric)}
                onChange={(_, on) =>
                  setDraft(
                    on ? [...draft, o.key as LicenseMetric] : draft.filter((m) => m !== o.key),
                  )
                }
              />
            }
          />
        ))}
      <Button size="small" variant="contained" disabled={savingModel} onClick={saveModel}>
        {t("common:actions.save")}
      </Button>
      <Button size="small" disabled={savingModel} onClick={() => setDraft(null)}>
        {t("common:actions.cancel")}
      </Button>
      {modelError && (
        <Typography variant="caption" color="error" role="alert">
          {modelError}
        </Typography>
      )}
    </Box>
  );

  const metricName = (m: LicenseMetric) => t(`licensing.metrics.${m}`);

  const renderTile = (m: LicenseMetricResult, r: LicenseTypeResult) => {
    const archived = byKey.get(r.key)?.archived ?? false;
    const color = hues.get(r.key) ?? chrome.categorical[0];
    const forecast = year.is_forecast;
    return (
      <ButtonBase
        key={r.key}
        disabled={!editable}
        onClick={() =>
          setDialog({ cell: { metric: m.metric, key: r.key, licensed: r.licensed, actual: r.actual } })
        }
        data-testid={`license-tile-${m.metric}-${r.key}`}
        sx={{
          display: "block",
          textAlign: "start",
          p: 1.25,
          borderRadius: 1,
          border: 1,
          borderStyle: archived ? "dashed" : "solid",
          borderColor: "divider",
          bgcolor: archived ? "action.hover" : "transparent",
          "&.Mui-disabled": { pointerEvents: "auto" },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
          <Typography variant="caption" sx={{ color, flex: 1 }}>
            {"● "}
            {labelOf(r.key)}
            {archived ? ` (${t("licensing.archived")})` : ""}
          </Typography>
          {forecast ? (
            <Typography variant="caption" color="text.secondary">
              {t("licensing.licensedOnly")}
            </Typography>
          ) : (
            <Chip
              size="small"
              variant="outlined"
              label={t(`licensing.status.${r.status}`)}
              sx={{ borderColor: statusColor(r.status), color: statusColor(r.status) }}
            />
          )}
        </Box>
        {forecast ? (
          <Typography fontWeight={600}>{r.licensed}</Typography>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
              <Typography fontWeight={600}>
                {r.actual ?? "—"} / {r.licensed}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatPct(r.pct, r.no_licence, t)}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={r.no_licence ? 100 : Math.min(r.pct ?? 0, 100)}
              sx={{
                mt: 0.5,
                height: 6,
                borderRadius: 3,
                "& .MuiLinearProgress-bar": { bgcolor: statusColor(r.status) },
              }}
            />
          </>
        )}
      </ButtonBase>
    );
  };

  const renderMetric = (m: LicenseMetricResult) => {
    const forecast = year.is_forecast;
    const bar = buildLicensingBarOption(
      m.types.map((r) => ({
        key: r.key,
        label: labelOf(r.key),
        licensed: r.licensed,
        actual: forecast ? null : r.actual,
        color: hues.get(r.key) ?? chrome.categorical[0],
      })),
      {
        chrome,
        isRtl: chrome.isRtl,
        licensedLabel: t("licensing.licensed"),
        actualLabel: t("licensing.actual"),
      },
    );
    const headline = forecast
      ? t("licensing.metricTotalLicensedOnly", { licensed: m.licensed_total })
      : m.actual_total == null
        ? t("licensing.metricTotalNoActual", { licensed: m.licensed_total })
        : t("licensing.metricTotal", { actual: m.actual_total, licensed: m.licensed_total });
    return (
      <Box key={m.metric} data-testid={`license-block-${m.metric}`} sx={{ mt: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography fontWeight={600}>{metricName(m.metric)}</Typography>
          {!forecast && (
            <Chip
              size="small"
              variant="outlined"
              label={t(`licensing.status.${m.status}`)}
              sx={{ borderColor: statusColor(m.status), color: statusColor(m.status) }}
            />
          )}
        </Box>
        <Typography variant="h6" fontWeight={700}>
          {headline}
        </Typography>
        {m.types.length > 0 ? (
          <>
            <Box sx={{ height: 44, my: 1 }}>
              <EChart
                option={bar}
                style={{ height: 44 }}
                ariaLabel={`${t("licensing.barLabel")}: ${metricName(m.metric)}`}
              />
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 1,
                opacity: year.confirmed ? 1 : 0.75,
              }}
            >
              {m.types.map((r) => renderTile(m, r))}
            </Box>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
            {t("licensing.noType")}
          </Typography>
        )}
      </Box>
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
          onChange={setPicked}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {modelEditor || (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flex: 1, flexWrap: "wrap" }}>
              {model.length > 0 ? (
                <>
                  <Typography variant="caption" color="text.secondary">
                    {t("licensing.model")}
                  </Typography>
                  {model.map((m) => (
                    <Chip key={m} size="small" label={metricName(m)} />
                  ))}
                  {editModelButton}
                </>
              ) : null}
            </Box>
          )}
        </Box>

        {model.length === 0 ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 1, flexWrap: "wrap" }}>
            <Typography variant="body2" color="text.secondary">
              {t("licensing.emptyModel")}
            </Typography>
            {!draft && editModelButton}
          </Box>
        ) : (
          <>
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
            {year.metrics.map(renderMetric)}
            {editable && addable.length > 0 && (
              <Button
                fullWidth
                size="small"
                variant="outlined"
                sx={{ mt: 1.5, borderStyle: "dashed" }}
                onClick={() => setDialog({ cell: null })}
              >
                {`+ ${t("licensing.addItem")}`}
              </Button>
            )}
          </>
        )}

        {dialog && (
          <LicenseItemDialog
            cardId={cardId}
            fiscalYear={year.fiscal_year}
            forecastYear={forecastFy}
            metrics={model}
            cell={dialog.cell}
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
