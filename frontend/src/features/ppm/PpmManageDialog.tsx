import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { Card, PpmRollupOut, PpmStatusReport } from "@/types";

const PpmCostTab = lazy(() => import("./PpmCostTab"));
const PpmGanttTab = lazy(() => import("./PpmGanttTab"));
const PpmReportsTab = lazy(() => import("./PpmReportsTab"));

interface Props {
  card: Card;
  tab: "cost" | "gantt" | "reports";
  onClose: () => void;
  onChanged: () => void;
}

export default function PpmManageDialog({ card, tab, onClose, onChanged }: Props) {
  const { t } = useTranslation(["ppm", "common"]);
  const rollup = useApiQuery<PpmRollupOut>(
    tab === "cost" ? "/ppm/initiatives/" + encodeURIComponent(card.id) + "/rollup" : null,
    { keepPreviousData: false },
  );
  const reports = useApiQuery<PpmStatusReport[]>(
    tab === "reports" ? "/ppm/initiatives/" + encodeURIComponent(card.id) + "/reports" : null,
    { keepPreviousData: false },
  );
  const title = tab === "cost" ? t("budgetAndCosts") : tab === "reports" ? t("statusReports") : t("gantt");

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      disableRestoreFocus
      aria-labelledby="ppm-manage-title"
    >
      <DialogTitle id="ppm-manage-title">{title}</DialogTitle>
      <DialogContent dividers>
        {rollup.error && <Alert severity="error">{rollup.error.message}</Alert>}
        {reports.error && <Alert severity="error">{reports.error.message}</Alert>}
        <Suspense
          fallback={
            <Box display="flex" justifyContent="center">
              <CircularProgress />
            </Box>
          }
        >
          {tab === "cost" ? (
            <PpmCostTab
              initiativeId={card.id}
              costLines={[]}
              rollup={rollup.data ?? null}
              onRefresh={onChanged}
            />
          ) : tab === "reports" ? (
            reports.data ? (
              <PpmReportsTab
                initiativeId={card.id}
                reports={reports.data}
                onRefresh={() => {
                  reports.refetch();
                  onChanged();
                }}
              />
            ) : reports.loading ? (
              <CircularProgress />
            ) : null
          ) : (
            <PpmGanttTab initiativeId={card.id} card={card} />
          )}
        </Suspense>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
