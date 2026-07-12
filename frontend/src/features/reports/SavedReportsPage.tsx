import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import EditReportDialog from "./EditReportDialog";
import { api } from "@/api/client";
import { getExtensionRoutes, useExtensionUI } from "@/lib/extensionHost";
import type { SavedReport } from "@/types";
import {
  REPORT_TYPE_STYLE,
  VISIBILITY_STYLE,
  getReportTypeLabels,
  getVisibilityLabels,
} from "./savedReportStyles";

export default function SavedReportsPage() {
  const { t } = useTranslation(["reports", "common"]);
  const navigate = useNavigate();

  const REPORT_TYPE_LABELS: Record<string, string> = useMemo(() => getReportTypeLabels(t), [t]);
  const VISIBILITY_LABELS: Record<string, string> = useMemo(() => getVisibilityLabels(t), [t]);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0); // 0 = My Reports, 1 = Shared with Me, 2 = Public
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; report: SavedReport } | null>(null);
  const [editReport, setEditReport] = useState<SavedReport | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<SavedReport | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const filter = tab === 0 ? "my" : tab === 1 ? "shared" : "public";
      const data = await api.get<SavedReport[]>(`/saved-reports?filter=${filter}`);
      setReports(data);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Re-render when extension bundles finish loading (they register async after
  // login) so ext:* saved reports resolve to their route/icon/label.
  useExtensionUI();

  // Extension reports save with report_type "ext:{extension key}:{route id}";
  // resolve that back to the registered route. Null for core types, and for an
  // extension that is not installed/enabled (its card degrades gracefully).
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

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/saved-reports/${deleteConfirm.id}`);
      setDeleteConfirm(null);
      fetchReports();
    } catch {
      // error handled by api client
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <MaterialSymbol icon="bookmarks" size={26} color="#1976d2" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {t("saved.title")}
        </Typography>
      </Box>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab
          label={t("saved.myReports")}
          icon={<MaterialSymbol icon="person" size={18} />}
          iconPosition="start"
          sx={{ textTransform: "none", minHeight: 42 }}
        />
        <Tab
          label={t("saved.sharedWithMe")}
          icon={<MaterialSymbol icon="group" size={18} />}
          iconPosition="start"
          sx={{ textTransform: "none", minHeight: 42 }}
        />
        <Tab
          label={t("saved.public")}
          icon={<MaterialSymbol icon="public" size={18} />}
          iconPosition="start"
          sx={{ textTransform: "none", minHeight: 42 }}
        />
      </Tabs>

      {/* Content */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : reports.length === 0 ? (
        <Alert severity="info" sx={{ maxWidth: 500 }}>
          {tab === 0
            ? t("saved.emptyMy")
            : tab === 1
              ? t("saved.emptyShared")
              : t("saved.emptyPublic")}
        </Alert>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 2 }}>
          {reports.map((report) => {
            const extRoute = extRouteFor(report.report_type);
            const style = REPORT_TYPE_STYLE[report.report_type] ||
              (extRoute
                ? { icon: extRoute.icon, color: "#607d8b", path: extRoute.path }
                : { icon: "analytics", color: "#90a4ae", path: "#" });
            const metaLabel =
              REPORT_TYPE_LABELS[report.report_type] || extRoute?.label || report.report_type;
            const visStyle = VISIBILITY_STYLE[report.visibility] || VISIBILITY_STYLE.private;
            const visLabel = VISIBILITY_LABELS[report.visibility] || VISIBILITY_LABELS.private;

            return (
              <Card key={report.id} variant="outlined" sx={{ position: "relative" }}>
                <CardActionArea onClick={() => handleOpen(report)}>
                  {/* Thumbnail */}
                  {report.thumbnail ? (
                    <Box
                      component="img"
                      src={report.thumbnail}
                      alt={report.name}
                      sx={{
                        width: "100%",
                        height: 160,
                        objectFit: "cover",
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        bgcolor: "action.hover",
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: "100%",
                        height: 160,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: `${style.color}08`,
                        borderBottom: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <MaterialSymbol icon={style.icon} size={56} color={`${style.color}40`} />
                    </Box>
                  )}
                  <CardContent sx={{ pb: "12px !important" }}>
                    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1, lineHeight: 1.3 }} noWrap>
                        {report.name}
                      </Typography>
                    </Box>
                    {report.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {report.description}
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Chip
                        icon={<MaterialSymbol icon={style.icon} size={14} />}
                        label={metaLabel}
                        size="small"
                        sx={{ height: 22, fontSize: "0.7rem", bgcolor: `${style.color}14`, color: style.color, fontWeight: 600 }}
                      />
                      <Chip
                        icon={<MaterialSymbol icon={visStyle.icon} size={14} />}
                        label={visLabel}
                        size="small"
                        variant="outlined"
                        sx={{ height: 22, fontSize: "0.7rem", color: visStyle.color, borderColor: `${visStyle.color}40` }}
                      />
                      {!report.is_owner && report.owner_name && (
                        <Typography variant="caption" color="text.secondary">
                          {t("saved.byOwner", { name: report.owner_name })}
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </CardActionArea>

                {/* Actions menu (owner only) */}
                {report.is_owner && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuAnchor({ el: e.currentTarget, report });
                    }}
                    sx={{ position: "absolute", top: 8, right: 8, bgcolor: "rgba(255,255,255,0.85)", "&:hover": { bgcolor: "rgba(255,255,255,0.95)" } }}
                  >
                    <MaterialSymbol icon="more_vert" size={18} />
                  </IconButton>
                )}
              </Card>
            );
          })}
        </Box>
      )}

      {/* Actions menu */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setEditReport(menuAnchor!.report);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon><MaterialSymbol icon="edit" size={18} /></ListItemIcon>
          <ListItemText>{t("common:actions.edit")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setDeleteConfirm(menuAnchor!.report);
            setMenuAnchor(null);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon><MaterialSymbol icon="delete" size={18} color="#d32f2f" /></ListItemIcon>
          <ListItemText>{t("common:actions.delete")}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Edit dialog */}
      <EditReportDialog
        open={!!editReport}
        report={editReport}
        onClose={() => setEditReport(null)}
        onUpdated={fetchReports}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>{t("saved.deleteTitle")}</DialogTitle>
        <DialogContent>
          <Typography>
            <Trans i18nKey="saved.deleteConfirm" ns="reports" values={{ name: deleteConfirm?.name }}>
              Are you sure you want to delete <strong>{{ name: deleteConfirm?.name } as any}</strong>? This cannot be undone.
            </Trans>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            {t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
