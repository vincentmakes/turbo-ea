import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { SavedReport } from "@/types";
import { REPORT_TYPE_STYLE } from "@/features/reports/savedReportStyles";
import { getExtensionRoutes, useExtensionUI } from "@/lib/extensionHost";
import SectionPaper, { EmptyState, ViewAllLink } from "./SectionPaper";

const MAX_VISIBLE = 6;
const THUMB_HEIGHT = 72;

export default function MySavedReportsSection() {
  const { t } = useTranslation(["common", "reports"]);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<SavedReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<SavedReport[]>("/saved-reports?filter=my")
      .then((data) => {
        if (!cancelled) setReports(data.slice(0, MAX_VISIBLE));
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-render once extension bundles finish registering so ext:* saved
  // reports resolve to their route/icon (same pattern as SavedReportsPage).
  useExtensionUI();

  // "ext:{extension key}:{route id}" -> the registered extension route, or
  // null for core types and for extensions that are not installed/enabled.
  const extRouteFor = (reportType: string) => {
    if (!reportType.startsWith("ext:")) return null;
    const [, extKey, routeId] = reportType.split(":");
    const match = getExtensionRoutes().find((r) => r.extKey === extKey && r.route.id === routeId);
    return match?.route ?? null;
  };

  const handleOpen = (report: SavedReport) => {
    const style = REPORT_TYPE_STYLE[report.report_type];
    if (style) {
      navigate(`${style.path}?saved_report_id=${report.id}`);
      return;
    }
    const extRoute = extRouteFor(report.report_type);
    if (extRoute) {
      navigate(`${extRoute.path}?saved_report_id=${report.id}`);
    }
  };

  return (
    <SectionPaper
      icon="bookmarks"
      iconColor="#1976d2"
      title={t("common:dashboard.workspace.mySavedReports")}
      action={<ViewAllLink to="/reports/saved" label={t("common:actions.viewAll")} />}
    >
      {loading ? (
        <LinearProgress />
      ) : reports.length === 0 ? (
        <EmptyState message={t("common:dashboard.workspace.empty.savedReports")} />
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 1.25,
          }}
        >
          {reports.map((report) => {
            const style = REPORT_TYPE_STYLE[report.report_type];
            const extRoute = style ? null : extRouteFor(report.report_type);
            const openable = Boolean(style || extRoute);
            const fallbackColor = style?.color ?? (extRoute ? "#607d8b" : "#9e9e9e");
            const fallbackIcon = style?.icon ?? extRoute?.icon ?? "analytics";
            return (
              <Tooltip key={report.id} title={report.name} placement="top" arrow>
                <Box
                  onClick={() => openable && handleOpen(report)}
                  sx={{
                    cursor: openable ? "pointer" : "default",
                    borderRadius: 1,
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                    transition: "border-color 120ms, transform 120ms",
                    "&:hover": openable
                      ? { borderColor: fallbackColor, transform: "translateY(-1px)" }
                      : undefined,
                  }}
                >
                  {report.thumbnail ? (
                    <Box
                      component="img"
                      src={report.thumbnail}
                      alt={report.name}
                      sx={{
                        width: "100%",
                        height: THUMB_HEIGHT,
                        objectFit: "cover",
                        display: "block",
                        bgcolor: "action.hover",
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: "100%",
                        height: THUMB_HEIGHT,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: `${fallbackColor}10`,
                      }}
                    >
                      <MaterialSymbol icon={fallbackIcon} size={28} color={`${fallbackColor}80`} />
                    </Box>
                  )}
                  <Box sx={{ px: 0.75, py: 0.5 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        fontWeight: 600,
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {report.name}
                    </Typography>
                  </Box>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      )}
    </SectionPaper>
  );
}
