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
import type { ArchLensAssessment } from "@/types";

export default function ArchLensAssessments() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<ArchLensAssessment[]>([]);

  useEffect(() => {
    api
      .get<ArchLensAssessment[]>("/archlens/assessments")
      .then(setAssessments)
      .catch(() => {});
  }, []);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {t("archlens_assessments_title")}
      </Typography>
      <Paper variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("archlens_assessment_col_title")}</TableCell>
              <TableCell>{t("archlens_assessment_created_by")}</TableCell>
              <TableCell>{t("archlens_status")}</TableCell>
              <TableCell>{t("archlens_assessment_linked_initiative")}</TableCell>
              <TableCell>{t("archlens_started_at")}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {assessments.map((a) => (
              <TableRow
                key={a.id}
                hover
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/archlens/assessments/${a.id}`)}
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
                        ? t("archlens_assessment_status_committed")
                        : t("archlens_assessment_status_saved")
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
                      {a.initiative_name || t("archlens_assessment_linked_initiative")}
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
                <TableCell>
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
                    {t("archlens_no_assessments")}
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
