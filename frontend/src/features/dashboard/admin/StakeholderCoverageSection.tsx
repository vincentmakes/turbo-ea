import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useMetamodel } from "@/hooks/useMetamodel";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";

export interface CoverageRow {
  type: string;
  total: number;
  with_stakeholders: number;
  missing: number;
}

interface Props {
  rows: CoverageRow[];
  loading: boolean;
}

export default function StakeholderCoverageSection({ rows, loading }: Props) {
  const { t } = useTranslation("common");
  const { types } = useMetamodel();
  const navigate = useNavigate();

  const labelByKey = new Map(types.map((tp) => [tp.key, tp.label]));

  const visible = rows.filter((r) => r.missing > 0).slice(0, 8);

  return (
    <SectionPaper
      icon="person_off"
      iconColor="#ef6c00"
      title={t("dashboard.admin.stakeholderCoverage")}
    >
      {loading ? (
        <LinearProgress />
      ) : visible.length === 0 ? (
        <EmptyState message={t("dashboard.admin.empty.coverage")} />
      ) : (
        <Box>
          {visible.map((r) => {
            const ratio = r.total === 0 ? 0 : r.with_stakeholders / r.total;
            const pct = Math.round(ratio * 100);
            return (
              <Box
                key={r.type}
                onClick={() => navigate(`/inventory?type=${r.type}`)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {labelByKey.get(r.type) ?? r.type}
                </Typography>
                <Box
                  sx={{
                    width: 80,
                    height: 4,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      width: `${pct}%`,
                      height: "100%",
                      bgcolor: pct < 50 ? "#ef6c00" : pct < 80 ? "#f5a623" : "#43a047",
                    }}
                  />
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0, minWidth: 80, textAlign: "right" }}
                >
                  {t("dashboard.admin.coverageMissing", {
                    missing: r.missing,
                    total: r.total,
                  })}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}
