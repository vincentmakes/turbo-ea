import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMetamodel } from "@/hooks/useMetamodel";
import { APPROVAL_STATUS_COLORS } from "@/theme/tokens";
import SectionPaper, { EmptyState } from "../workspace/SectionPaper";

export interface PipelineRow {
  type: string;
  draft: number;
  broken: number;
  rejected: number;
  total: number;
}

interface Props {
  rows: PipelineRow[];
  loading: boolean;
}

type PipelineStatus = "DRAFT" | "BROKEN" | "REJECTED";

const STATUS_COLOR: Record<PipelineStatus, string> = {
  DRAFT: APPROVAL_STATUS_COLORS.DRAFT,
  BROKEN: APPROVAL_STATUS_COLORS.BROKEN,
  REJECTED: APPROVAL_STATUS_COLORS.REJECTED,
};

export default function ApprovalPipelineSection({ rows, loading }: Props) {
  const { t } = useTranslation("common");
  const { types } = useMetamodel();
  const navigate = useNavigate();
  const labelByKey = new Map(types.map((tp) => [tp.key, tp.label]));

  const visible = rows.slice(0, 8);

  const goTo = (type: string, status?: PipelineStatus) => {
    const qs = status ? `?type=${type}&approval_status=${status}` : `?type=${type}`;
    navigate(`/inventory${qs}`);
  };

  const labelFor = (status: PipelineStatus) => t(`status.${status.toLowerCase()}`);

  return (
    <SectionPaper
      icon="hourglass_bottom"
      iconColor="#7b1fa2"
      title={t("dashboard.admin.approvalPipeline")}
    >
      {loading ? (
        <LinearProgress />
      ) : visible.length === 0 ? (
        <EmptyState message={t("dashboard.admin.empty.pipeline")} />
      ) : (
        <Box>
          <Box sx={{ display: "flex", gap: 1, mb: 1, px: 1, alignItems: "center" }}>
            <LegendDot color={STATUS_COLOR.DRAFT} label={labelFor("DRAFT")} />
            <LegendDot color={STATUS_COLOR.BROKEN} label={labelFor("BROKEN")} />
            <LegendDot color={STATUS_COLOR.REJECTED} label={labelFor("REJECTED")} />
          </Box>
          {visible.map((r) => {
            const total = Math.max(1, r.total);
            const segments: { key: PipelineStatus; count: number }[] = [
              { key: "DRAFT", count: r.draft },
              { key: "BROKEN", count: r.broken },
              { key: "REJECTED", count: r.rejected },
            ];
            return (
              <Box
                key={r.type}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  py: 0.75,
                  px: 1,
                  borderRadius: 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  noWrap
                  onClick={() => goTo(r.type)}
                >
                  {labelByKey.get(r.type) ?? r.type}
                </Typography>
                <Box
                  sx={{
                    width: 100,
                    height: 8,
                    borderRadius: 1,
                    overflow: "hidden",
                    display: "flex",
                    bgcolor: "action.hover",
                  }}
                >
                  {segments.map((s) =>
                    s.count > 0 ? (
                      <Tooltip key={s.key} title={`${labelFor(s.key)}: ${s.count}`}>
                        <Box
                          onClick={() => goTo(r.type, s.key)}
                          sx={{
                            width: `${(s.count / total) * 100}%`,
                            bgcolor: STATUS_COLOR[s.key],
                            cursor: "pointer",
                          }}
                        />
                      </Tooltip>
                    ) : null,
                  )}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0, minWidth: 80, textAlign: "right" }}
                >
                  {r.draft}/{r.broken}/{r.rejected}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
