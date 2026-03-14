import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import type { ArchLensAnalysisRun } from "@/types";
import { statusColor } from "./utils";


export default function ArchLensHistory() {
  const { t } = useTranslation("admin");
  const [runs, setRuns] = useState<ArchLensAnalysisRun[]>([]);

  useEffect(() => {
    api.get<ArchLensAnalysisRun[]>("/archlens/analysis-runs").then(setRuns).catch(() => {});
  }, []);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>{t("archlens_history_title")}</Typography>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("archlens_analysis_type")}</TableCell>
              <TableCell>{t("archlens_status")}</TableCell>
              <TableCell>{t("archlens_started_at")}</TableCell>
              <TableCell>{t("archlens_completed_at")}</TableCell>
              <TableCell>{t("archlens_error")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>{run.analysis_type}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={run.status}
                    color={statusColor(run.status)}
                  />
                </TableCell>
                <TableCell>{run.started_at ? new Date(run.started_at).toLocaleString() : "—"}</TableCell>
                <TableCell>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}</TableCell>
                <TableCell>{run.error_message || "—"}</TableCell>
              </TableRow>
            ))}
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                    {t("archlens_no_history")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
