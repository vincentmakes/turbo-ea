import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import StatusReportDialog from "./StatusReportDialog";
import StatusReportCard from "./StatusReportCard";
import type { PpmStatusReport } from "@/types";

interface Props {
  initiativeId: string;
  reports: PpmStatusReport[];
  onRefresh: () => void;
}

export default function PpmReportsTab({ initiativeId, reports, onRefresh }: Props) {
  const { t } = useTranslation("ppm");
  const [reportDialog, setReportDialog] = useState<{
    open: boolean;
    report?: PpmStatusReport;
  }>({ open: false });
  // A failed delete, shown above the reports.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (reportId: string) => {
    setDeleteError(null);
    try {
      await api.delete(`/ppm/reports/${reportId}`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t("common:errors.generic"));
      return;
    }
    onRefresh();
  };

  return (
    <Box>
      <Box display="flex" justifyContent="flex-end" mb={2}>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => setReportDialog({ open: true })}
        >
          {t("addReport")}
        </Button>
      </Box>

      {deleteError && (
        // Stryker disable next-line ObjectLiteral: spacing is presentation
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      )}

      {reports.length === 0 ? (
        <Paper sx={{ p: { xs: 3, sm: 4 }, textAlign: "center" }}>
          <Typography color="text.secondary">{t("noReportsYet")}</Typography>
        </Paper>
      ) : (
        reports.map((report) => (
          <StatusReportCard
            key={report.id}
            report={report}
            actions={
              <>
                <IconButton
                  size="small"
                  aria-label={t("editReport")}
                  onClick={() => setReportDialog({ open: true, report })}
                >
                  <MaterialSymbol icon="edit" size={18} />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={t("deleteReport")}
                  onClick={() => handleDelete(report.id)}
                >
                  <MaterialSymbol icon="delete" size={18} />
                </IconButton>
              </>
            }
          />
        ))
      )}

      {reportDialog.open && (
        <StatusReportDialog
          initiativeId={initiativeId}
          report={reportDialog.report}
          onClose={() => setReportDialog({ open: false })}
          onSaved={() => {
            setReportDialog({ open: false });
            onRefresh();
          }}
        />
      )}
    </Box>
  );
}
