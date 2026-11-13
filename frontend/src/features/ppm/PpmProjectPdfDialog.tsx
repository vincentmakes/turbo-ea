import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useCardSubtypeLabel } from "@/hooks/useCardSubtypeLabel";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useFiscalYearStart } from "@/hooks/useFiscalYearStart";
import { useFullScreenDialog } from "@/hooks/useFullScreenDialog";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import { openPrintWindow } from "@/lib/printDocument";
import { useInitiativeStatusLabel } from "@/features/ea-delivery/initiatives/useInitiativeStatus";
import type {
  Card,
  PpmBudgetLine,
  PpmCostLine,
  PpmRisk,
  PpmRollupOut,
  PpmStatusReport,
  PpmTask,
  PpmWbs,
} from "@/types";
import {
  loadPrintSections,
  orderedSections,
  PPM_PRINT_SECTIONS,
  printProject,
  savePrintSections,
  SECTION_LABEL_KEYS,
  type PpmPrintSection,
  type ProjectCompletion,
  type ProjectPrintData,
  type ProjectPrintFormat,
} from "./ppmProjectPrint";

interface Props {
  card: Card;
  reports: PpmStatusReport[];
  costLines: PpmCostLine[];
  budgetLines: PpmBudgetLine[];
  risks: PpmRisk[];
  rollup: PpmRollupOut | null;
  onClose: () => void;
}

/**
 * The initiative's PDF: a checkbox per section, then the shared pop-up print
 * path. Mounted by the page only while open. What the page already holds is
 * passed in; only what a ticked section needs beyond it is read here.
 */
export default function PpmProjectPdfDialog({
  card,
  reports,
  costLines,
  budgetLines,
  risks,
  rollup,
  onClose,
}: Props) {
  const { t } = useTranslation(["ppm", "common", "delivery"]);
  const fullScreen = useFullScreenDialog();
  const subtypeLabel = useCardSubtypeLabel();
  // The same naming the initiative workspace gives the status: the metamodel option first.
  const initiativeStatusLabel = useInitiativeStatusLabel();
  const { fmt: currencyFmt } = useCurrency();
  const { formatDate, formatDateTime } = useDateFormat();
  const { month: fiscalYearStart } = useFiscalYearStart();
  const [selected, setSelected] = useState<PpmPrintSection[]>(loadPrintSections);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useSubmitOnce();

  const toggle = (s: PpmPrintSection) =>
    setSelected((prev) => orderedSections(prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleExport = () =>
    run(async () => {
      // Open before any await, or a pop-up blocker eats the window (Safari/Firefox).
      const win = openPrintWindow();
      if (!win) return;
      setError(null);
      try {
        const id = card.id;
        const raw = card.attributes?.initiativeStatus;
        const status = typeof raw === "string" ? raw : "";
        const wantSchedule = selected.includes("schedule");
        const [completion, wbs, tasks] = await Promise.all([
          selected.includes("overview")
            ? api.get<ProjectCompletion>(`/ppm/initiatives/${id}/completion`)
            : Promise.resolve(null),
          wantSchedule ? api.get<PpmWbs[]>(`/ppm/initiatives/${id}/wbs`) : Promise.resolve([]),
          wantSchedule ? api.get<PpmTask[]>(`/ppm/initiatives/${id}/tasks`) : Promise.resolve([]),
        ]);
        const data: ProjectPrintData = {
          card,
          subtypeLabel: card.subtype ? subtypeLabel(card.type, card.subtype) : null,
          initiativeStatusLabel: status ? initiativeStatusLabel(status) : null,
          reports,
          costLines,
          budgetLines,
          risks,
          rollup,
          completion,
          wbs,
          tasks,
        };
        const fmt: ProjectPrintFormat = {
          amount: (n) => currencyFmt.format(n),
          date: formatDate,
          dateTime: formatDateTime,
          fiscalYearStart,
        };
        printProject(data, selected, fmt, win);
        savePrintSections(selected);
        onClose();
      } catch (e) {
        win.close();
        setError(e instanceof Error ? e.message : t("common:errors.generic"));
      }
    });

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} maxWidth="xs" fullWidth>
      <DialogTitle>{t("pdfDialogTitle")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t("pdfDialogHint")}
        </Typography>
        <Box display="flex" gap={1} mb={1}>
          <Button size="small" onClick={() => setSelected([...PPM_PRINT_SECTIONS])}>
            {t("common:actions.selectAll")}
          </Button>
          <Button size="small" onClick={() => setSelected([])}>
            {t("common:actions.deselectAll")}
          </Button>
        </Box>
        <FormGroup aria-label={t("pdfSections")}>
          {PPM_PRINT_SECTIONS.map((s) => (
            <FormControlLabel
              key={s}
              control={<Checkbox checked={selected.includes(s)} onChange={() => toggle(s)} />}
              label={t(SECTION_LABEL_KEYS[s])}
            />
          ))}
        </FormGroup>
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="picture_as_pdf" size={18} />}
          disabled={selected.length === 0 || busy}
          onClick={handleExport}
        >
          {t("delivery:editor.exportPdf")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
