import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import StatusReportDialog from "./StatusReportDialog";
import type { PpmStatusReport } from "@/types";

const RAG_COLORS: Record<string, string> = {
  onTrack: "#2e7d32",
  atRisk: "#ed6c02",
  offTrack: "#d32f2f",
};

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

  const handleDelete = async (reportId: string) => {
    await api.delete(`/ppm/reports/${reportId}`);
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

      {reports.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">{t("noReportsYet")}</Typography>
        </Paper>
      ) : (
        reports.map((report) => (
          <Paper key={report.id} sx={{ p: 3, mb: 2 }}>
            {/* Header */}
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb={2}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {new Date(report.report_date).toLocaleDateString()}
                </Typography>
                <Box display="flex" gap={0.75}>
                  {(
                    [
                      ["schedule_health", t("health_schedule")],
                      ["cost_health", t("health_cost")],
                      ["scope_health", t("health_scope")],
                    ] as const
                  ).map(([key, label]) => (
                    <Box
                      key={key}
                      sx={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        bgcolor:
                          RAG_COLORS[
                            report[key as keyof PpmStatusReport] as string
                          ] || "#bdbdbd",
                      }}
                      title={label}
                    />
                  ))}
                </Box>
                {report.reporter && (
                  <Typography variant="caption" color="text.secondary">
                    {report.reporter.display_name}
                  </Typography>
                )}
              </Box>
              <Box>
                <IconButton
                  size="small"
                  onClick={() => setReportDialog({ open: true, report })}
                >
                  <MaterialSymbol icon="edit" size={18} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => handleDelete(report.id)}
                >
                  <MaterialSymbol icon="delete" size={18} />
                </IconButton>
              </Box>
            </Box>

            {/* Summary */}
            {report.summary && (
              <Box mb={2}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="text.secondary"
                  display="block"
                  mb={0.5}
                >
                  {t("summary")}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {report.summary}
                </Typography>
              </Box>
            )}

            {/* Accomplishments & Next Steps */}
            {(report.accomplishments || report.next_steps) && <Divider sx={{ my: 1.5 }} />}

            {report.accomplishments && (
              <Box mb={1.5}>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="text.secondary"
                  display="block"
                  mb={0.5}
                >
                  {t("accomplishments")}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {report.accomplishments}
                </Typography>
              </Box>
            )}

            {report.next_steps && (
              <Box>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  color="text.secondary"
                  display="block"
                  mb={0.5}
                >
                  {t("nextSteps")}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {report.next_steps}
                </Typography>
              </Box>
            )}
          </Paper>
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
