import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { TurboLensAssessment } from "@/types";

export default function TurboLensAssessments() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<TurboLensAssessment[]>([]);

  useEffect(() => {
    api
      .get<TurboLensAssessment[]>("/turbolens/assessments")
      .then(setAssessments)
      .catch(() => {});
  }, []);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t("turbolens_assessments_title")}
      </Typography>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("turbolens_assessment_col_title")}</TableCell>
              <TableCell>{t("turbolens_assessment_created_by")}</TableCell>
              <TableCell>{t("turbolens_status")}</TableCell>
              <TableCell>{t("turbolens_assessment_linked_initiative")}</TableCell>
              <TableCell>{t("turbolens_started_at")}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {assessments.map((a) => (
              <TableRow
                key={a.id}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/turbolens/assessments/${a.id}`)}
              >
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>
                    {a.title}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {a.created_by_name || "—"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={
                      a.status === "committed"
                        ? t("turbolens_assessment_status_committed")
                        : t("turbolens_assessment_status_saved")
                    }
                    color={a.status === "committed" ? "success" : "primary"}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {a.initiative_id ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/cards/${a.initiative_id}`);
                      }}
                      startIcon={<MaterialSymbol icon="rocket_launch" size={14} />}
                    >
                      {a.initiative_name || t("turbolens_assessment_linked_initiative")}
                    </Button>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {a.created_at
                    ? new Date(a.created_at).toLocaleDateString()
                    : "—"}
                </TableCell>
                <TableCell align="right">
                  {a.status !== "committed" && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/turbolens?tab=architect&resume=${a.id}`);
                      }}
                      startIcon={<MaterialSymbol icon="play_arrow" size={14} />}
                      sx={{ mr: 1 }}
                    >
                      {t("turbolens_assessment_resume")}
                    </Button>
                  )}
                  <MaterialSymbol icon="chevron_right" size={18} />
                </TableCell>
              </TableRow>
            ))}
            {assessments.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ py: 2 }}
                  >
                    {t("turbolens_no_assessments")}
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
