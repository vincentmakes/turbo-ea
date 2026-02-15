/**
 * ProcessFlowTab — Rendered inside FactSheetDetail for BusinessProcess.
 *
 * Three sub-tabs:
 *   Published — The current approved process flow (read-only, watermark + seal).
 *   Drafts    — Work-in-progress flows visible to member/bpm_admin/admin/process_owner/responsible/observer.
 *   Archived  — Previously published versions (read-only list with revision + archival date).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import BpmnViewer from "./BpmnViewer";
import BpmnTemplateChooser from "./BpmnTemplateChooser";
import { api } from "@/api/client";
import type { ProcessFlowVersion, ProcessFlowPermissions } from "@/types";

interface Props {
  processId: string;
  processName?: string;
}

const STATUS_COLORS: Record<string, "success" | "warning" | "info" | "default" | "error"> = {
  published: "success",
  draft: "default",
  pending: "warning",
  archived: "info",
};

export default function ProcessFlowTab({ processId, processName }: Props) {
  const navigate = useNavigate();
  const [subTab, setSubTab] = useState(0);

  // Permissions
  const [perms, setPerms] = useState<ProcessFlowPermissions>({
    can_view_drafts: false,
    can_edit_draft: false,
    can_approve: false,
  });

  // Published
  const [published, setPublished] = useState<ProcessFlowVersion | null>(null);
  const [loadingPub, setLoadingPub] = useState(true);

  // Drafts
  const [drafts, setDrafts] = useState<ProcessFlowVersion[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  // Archived
  const [archived, setArchived] = useState<ProcessFlowVersion[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);

  // Dialog states
  const [showTemplateChooser, setShowTemplateChooser] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<ProcessFlowVersion | null>(null);
  const [fullScreenOpen, setFullScreenOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "submit" | "approve" | "reject" | "delete";
    version: ProcessFlowVersion;
  } | null>(null);
  const [actionError, setActionError] = useState("");

  // Ref for the full-screen BPMN container (used for SVG extraction in print)
  const fullScreenBpmnRef = useRef<HTMLDivElement>(null);

  // Load permissions and published version
  const loadInitial = useCallback(async () => {
    setLoadingPub(true);
    try {
      const [permsData, pubData] = await Promise.all([
        api.get<ProcessFlowPermissions>(`/bpm/processes/${processId}/flow/permissions`),
        api.get<ProcessFlowVersion | null>(`/bpm/processes/${processId}/flow/published`),
      ]);
      setPerms(permsData);
      setPublished(pubData);
    } catch {
      setPublished(null);
    } finally {
      setLoadingPub(false);
    }
  }, [processId]);

  const loadDrafts = useCallback(async () => {
    if (!perms.can_view_drafts) return;
    setLoadingDrafts(true);
    try {
      const data = await api.get<ProcessFlowVersion[]>(
        `/bpm/processes/${processId}/flow/drafts`
      );
      setDrafts(data);
    } catch {
      setDrafts([]);
    } finally {
      setLoadingDrafts(false);
    }
  }, [processId, perms.can_view_drafts]);

  const loadArchived = useCallback(async () => {
    if (!perms.can_view_drafts) return;
    setLoadingArchived(true);
    try {
      const data = await api.get<ProcessFlowVersion[]>(
        `/bpm/processes/${processId}/flow/archived`
      );
      setArchived(data);
    } catch {
      setArchived([]);
    } finally {
      setLoadingArchived(false);
    }
  }, [processId, perms.can_view_drafts]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (subTab === 1) loadDrafts();
    if (subTab === 2) loadArchived();
  }, [subTab, loadDrafts, loadArchived]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handleCreateDraftFromScratch = async (bpmnXml: string) => {
    try {
      let svgThumbnail: string | undefined;
      try {
        const NavigatedViewer = (await import("bpmn-js/lib/NavigatedViewer")).default;
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;left:-9999px;width:1200px;height:800px";
        document.body.appendChild(el);
        const viewer = new NavigatedViewer({ container: el });
        await viewer.importXML(bpmnXml);
        const result = await (viewer as any).saveSVG();
        svgThumbnail = result.svg;
        viewer.destroy();
        document.body.removeChild(el);
      } catch {
        // SVG generation optional
      }
      await api.post(`/bpm/processes/${processId}/flow/drafts`, {
        bpmn_xml: bpmnXml,
        svg_thumbnail: svgThumbnail,
      });
      setShowTemplateChooser(false);
      setSubTab(1);
      loadDrafts();
    } catch (err) {
      console.error("Failed to create draft:", err);
    }
  };

  const handleCreateDraftFromVersion = async (versionId: string) => {
    try {
      await api.post(`/bpm/processes/${processId}/flow/drafts`, {
        bpmn_xml: "",
        based_on_id: versionId,
      });
      setSubTab(1);
      loadDrafts();
    } catch (err) {
      console.error("Failed to clone version:", err);
    }
  };

  const handleAction = async () => {
    if (!confirmAction) return;
    setActionError("");
    const { type, version } = confirmAction;
    try {
      if (type === "submit") {
        await api.post(
          `/bpm/processes/${processId}/flow/versions/${version.id}/submit`
        );
      } else if (type === "approve") {
        await api.post(
          `/bpm/processes/${processId}/flow/versions/${version.id}/approve`
        );
      } else if (type === "reject") {
        await api.post(
          `/bpm/processes/${processId}/flow/versions/${version.id}/reject`
        );
      } else if (type === "delete") {
        await api.delete(
          `/bpm/processes/${processId}/flow/versions/${version.id}`
        );
      }
      setConfirmAction(null);
      loadInitial();
      loadDrafts();
      loadArchived();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  };

  const loadVersionDetail = async (versionId: string) => {
    try {
      const data = await api.get<ProcessFlowVersion>(
        `/bpm/processes/${processId}/flow/versions/${versionId}`
      );
      setViewingVersion(data);
      setFullScreenOpen(true);
    } catch (err) {
      console.error("Failed to load version:", err);
    }
  };

  const openPublishedFullScreen = () => {
    if (published) {
      setViewingVersion(published);
      setFullScreenOpen(true);
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── Print / PDF ────────────────────────────────────────────────────

  const handlePrint = async (version: ProcessFlowVersion) => {
    if (!version.bpmn_xml) return;

    // Extract SVG from the bpmn-js viewer off-screen
    let svgContent = "";
    try {
      const NavigatedViewer = (await import("bpmn-js/lib/NavigatedViewer")).default;
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;left:-9999px;width:1400px;height:900px";
      document.body.appendChild(el);
      const viewer = new NavigatedViewer({ container: el });
      await viewer.importXML(version.bpmn_xml);
      const result = await (viewer as any).saveSVG();
      svgContent = result.svg;
      viewer.destroy();
      document.body.removeChild(el);
    } catch {
      // Fallback: try svg_thumbnail
      svgContent = version.svg_thumbnail || "";
    }

    if (!svgContent) return;

    const title = processName || "Process Flow";
    const watermarkText = version.approved_by_name
      ? `Revision ${version.revision} \u2014 Approved by ${version.approved_by_name} on ${formatDate(version.approved_at)}`
      : `Revision ${version.revision}`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title} - Rev ${version.revision}</title>
  <style>
    @page { size: landscape; margin: 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 2px solid #4caf50; margin-bottom: 16px; }
    .header h1 { font-size: 18px; color: #333; }
    .watermark { display: inline-flex; align-items: center; gap: 6px; background: rgba(76,175,80,0.1); border: 1px solid #4caf50; border-radius: 4px; padding: 4px 12px; }
    .watermark svg { width: 16px; height: 16px; fill: #4caf50; }
    .watermark span { color: #4caf50; font-weight: 600; font-size: 12px; }
    .diagram { width: 100%; text-align: center; }
    .diagram svg { max-width: 100%; height: auto; }
    .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-size: 11px; color: #888; }
    @media print {
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="padding:12px;text-align:center;background:#f5f5f5;border-bottom:1px solid #ddd">
    <button onclick="window.print()" style="padding:8px 24px;font-size:14px;cursor:pointer;background:#1976d2;color:#fff;border:none;border-radius:4px">
      Print / Save as PDF
    </button>
    <button onclick="window.close()" style="padding:8px 24px;font-size:14px;cursor:pointer;background:#fff;color:#333;border:1px solid #ccc;border-radius:4px;margin-left:8px">
      Close
    </button>
  </div>
  <div class="header">
    <h1>${title}</h1>
    <div class="watermark">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
      <span>${watermarkText}</span>
    </div>
  </div>
  <div class="diagram">${svgContent}</div>
  <div class="footer">
    <span>Printed on ${new Date().toLocaleDateString()}</span>
    <span>${watermarkText}</span>
  </div>
</body>
</html>`);
    printWindow.document.close();
  };

  // ── Published Tab ────────────────────────────────────────────────────

  const renderPublished = () => {
    if (loadingPub) {
      return (
        <Typography color="text.secondary">Loading published flow...</Typography>
      );
    }
    if (!published) {
      return (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <MaterialSymbol icon="route" size={48} color="#666" />
          <Typography variant="h6" gutterBottom>
            No published process flow yet
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Create a draft, then submit it for approval to publish.
          </Typography>
          {perms.can_edit_draft && (
            <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
              <Button
                variant="contained"
                startIcon={<MaterialSymbol icon="add" />}
                onClick={() => setShowTemplateChooser(true)}
              >
                New Draft from Template
              </Button>
              <Button
                variant="outlined"
                startIcon={<MaterialSymbol icon="edit" />}
                onClick={() => navigate(`/bpm/processes/${processId}/flow`)}
              >
                Open Editor
              </Button>
            </Box>
          )}
          <BpmnTemplateChooser
            open={showTemplateChooser}
            onClose={() => setShowTemplateChooser(false)}
            onSelect={handleCreateDraftFromScratch}
          />
        </Box>
      );
    }

    return (
      <Box>
        {/* Approval watermark */}
        <Alert
          severity="success"
          icon={<MaterialSymbol icon="verified" size={20} />}
          sx={{ mb: 2 }}
        >
          <strong>Approved</strong> by {published.approved_by_name || "\u2014"} on{" "}
          {formatDate(published.approved_at)} &mdash; Revision {published.revision}
        </Alert>

        {/* Actions */}
        <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
          {perms.can_edit_draft && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<MaterialSymbol icon="content_copy" />}
              onClick={() => handleCreateDraftFromVersion(published.id)}
            >
              Create New Draft from This
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            size="small"
            startIcon={<MaterialSymbol icon="fullscreen" />}
            onClick={openPublishedFullScreen}
          >
            View Full Size
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<MaterialSymbol icon="print" />}
            onClick={() => handlePrint(published)}
          >
            Print / PDF
          </Button>
          <Chip
            label={`Revision ${published.revision}`}
            size="small"
            variant="outlined"
          />
        </Box>

        {/* Read-only BPMN viewer */}
        {published.bpmn_xml && (
          <Box sx={{ position: "relative" }}>
            <BpmnViewer
              bpmnXml={published.bpmn_xml}
              elements={[]}
              onElementClick={() => {}}
              height={400}
            />
            {/* Watermark overlay */}
            <Box
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                bgcolor: "rgba(76,175,80,0.1)",
                border: "1px solid #4caf50",
                borderRadius: 1,
                px: 1.5,
                py: 0.5,
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                pointerEvents: "none",
              }}
            >
              <MaterialSymbol icon="verified" size={16} color="#4caf50" />
              <Typography
                variant="caption"
                sx={{ color: "#4caf50", fontWeight: 600 }}
              >
                Rev {published.revision} &middot; Approved by{" "}
                {published.approved_by_name || "\u2014"} on{" "}
                {formatDate(published.approved_at)}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    );
  };

  // ── Drafts Tab ───────────────────────────────────────────────────────

  const renderDrafts = () => {
    if (loadingDrafts) {
      return (
        <Typography color="text.secondary">Loading drafts...</Typography>
      );
    }

    return (
      <Box>
        {perms.can_edit_draft && (
          <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<MaterialSymbol icon="add" />}
              onClick={() => setShowTemplateChooser(true)}
            >
              New Draft from Template
            </Button>
            {published && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<MaterialSymbol icon="content_copy" />}
                onClick={() => handleCreateDraftFromVersion(published.id)}
              >
                Clone Published Version
              </Button>
            )}
          </Box>
        )}

        {drafts.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 3 }}>
            <Typography color="text.secondary">No draft process flows.</Typography>
          </Box>
        ) : (
          <List>
            {drafts.map((d) => (
              <Paper key={d.id} variant="outlined" sx={{ mb: 1 }}>
                <ListItemButton onClick={() => loadVersionDetail(d.id)}>
                  <ListItemIcon>
                    <MaterialSymbol
                      icon={d.status === "pending" ? "hourglass_top" : "edit_note"}
                      size={24}
                      color={d.status === "pending" ? "#ed6c02" : "#666"}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="body1" fontWeight={500}>
                          Revision {d.revision}
                        </Typography>
                        <Chip
                          label={d.status}
                          size="small"
                          color={STATUS_COLORS[d.status] || "default"}
                        />
                      </Box>
                    }
                    secondary={
                      <>
                        Created by {d.created_by_name || "\u2014"} on{" "}
                        {formatDate(d.created_at)}
                        {d.status === "pending" && d.submitted_by_name && (
                          <> &mdash; Submitted by {d.submitted_by_name}</>
                        )}
                      </>
                    }
                  />
                  <Box
                    sx={{ display: "flex", gap: 0.5 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {d.status === "draft" && perms.can_edit_draft && (
                      <>
                        <Tooltip title="Edit in BPMN editor">
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() =>
                              navigate(
                                `/bpm/processes/${processId}/flow?versionId=${d.id}`
                              )
                            }
                          >
                            Edit
                          </Button>
                        </Tooltip>
                        <Tooltip title="Submit for approval">
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={() =>
                              setConfirmAction({ type: "submit", version: d })
                            }
                          >
                            Submit
                          </Button>
                        </Tooltip>
                        <Tooltip title="Delete draft">
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() =>
                              setConfirmAction({ type: "delete", version: d })
                            }
                          >
                            Delete
                          </Button>
                        </Tooltip>
                      </>
                    )}
                    {d.status === "pending" && perms.can_approve && (
                      <>
                        <Tooltip title="Approve and publish">
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            onClick={() =>
                              setConfirmAction({ type: "approve", version: d })
                            }
                          >
                            Approve
                          </Button>
                        </Tooltip>
                        <Tooltip title="Reject and return to draft">
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() =>
                              setConfirmAction({ type: "reject", version: d })
                            }
                          >
                            Reject
                          </Button>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                </ListItemButton>
              </Paper>
            ))}
          </List>
        )}

        <BpmnTemplateChooser
          open={showTemplateChooser}
          onClose={() => setShowTemplateChooser(false)}
          onSelect={handleCreateDraftFromScratch}
        />
      </Box>
    );
  };

  // ── Archived Tab ─────────────────────────────────────────────────────

  const renderArchived = () => {
    if (loadingArchived) {
      return (
        <Typography color="text.secondary">Loading archived flows...</Typography>
      );
    }

    if (archived.length === 0) {
      return (
        <Box sx={{ textAlign: "center", py: 3 }}>
          <Typography color="text.secondary">No archived process flows.</Typography>
        </Box>
      );
    }

    return (
      <List>
        {archived.map((a) => (
          <Paper key={a.id} variant="outlined" sx={{ mb: 1 }}>
            <ListItemButton onClick={() => loadVersionDetail(a.id)}>
              <ListItemIcon>
                <MaterialSymbol icon="inventory_2" size={24} color="#999" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body1" fontWeight={500}>
                      Revision {a.revision}
                    </Typography>
                    <Chip label="Archived" size="small" color="info" />
                  </Box>
                }
                secondary={
                  <>
                    Approved by {a.approved_by_name || "\u2014"} on{" "}
                    {formatDate(a.approved_at)} &mdash; Archived on{" "}
                    {formatDate(a.archived_at)}
                  </>
                }
              />
            </ListItemButton>
          </Paper>
        ))}
      </List>
    );
  };

  // ── Full-screen version viewer dialog ──────────────────────────────

  const buildWatermarkText = (v: ProcessFlowVersion) => {
    if (v.status === "published" || v.status === "archived") {
      return `Rev ${v.revision} \u2014 Approved by ${v.approved_by_name || "\u2014"} on ${formatDate(v.approved_at)}`;
    }
    if (v.status === "pending") {
      return `Rev ${v.revision} \u2014 Pending approval (submitted by ${v.submitted_by_name || "\u2014"})`;
    }
    return `Rev ${v.revision} \u2014 Draft`;
  };

  const renderFullScreenDialog = () => (
    <Dialog
      open={fullScreenOpen}
      onClose={() => { setFullScreenOpen(false); setViewingVersion(null); }}
      fullScreen
    >
      {viewingVersion && (
        <>
          <AppBar sx={{ position: "relative" }} color="default" elevation={1}>
            <Toolbar>
              <IconButton
                edge="start"
                onClick={() => { setFullScreenOpen(false); setViewingVersion(null); }}
                aria-label="close"
              >
                <MaterialSymbol icon="close" />
              </IconButton>
              <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
                {processName || "Process Flow"} &mdash; Revision {viewingVersion.revision}
              </Typography>
              <Chip
                label={viewingVersion.status}
                size="small"
                color={STATUS_COLORS[viewingVersion.status] || "default"}
                sx={{ mr: 2 }}
              />
              {(viewingVersion.status === "published" || viewingVersion.status === "archived") && (
                <Button
                  color="inherit"
                  startIcon={<MaterialSymbol icon="print" />}
                  onClick={() => handlePrint(viewingVersion)}
                >
                  Print / PDF
                </Button>
              )}
            </Toolbar>
          </AppBar>
          <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
            {/* Watermark banner */}
            {viewingVersion.status === "published" && (
              <Alert
                severity="success"
                icon={<MaterialSymbol icon="verified" size={20} />}
                sx={{ borderRadius: 0 }}
              >
                <strong>Approved</strong> by {viewingVersion.approved_by_name || "\u2014"} on{" "}
                {formatDate(viewingVersion.approved_at)} &mdash; Revision {viewingVersion.revision}
              </Alert>
            )}
            {viewingVersion.status === "archived" && (
              <Alert severity="info" sx={{ borderRadius: 0 }}>
                <strong>Archived</strong> on {formatDate(viewingVersion.archived_at)}.
                Originally approved by {viewingVersion.approved_by_name || "\u2014"} on{" "}
                {formatDate(viewingVersion.approved_at)} &mdash; Revision {viewingVersion.revision}
              </Alert>
            )}
            {viewingVersion.status === "pending" && (
              <Alert severity="warning" sx={{ borderRadius: 0 }}>
                <strong>Pending Approval</strong> &mdash; Submitted by{" "}
                {viewingVersion.submitted_by_name || "\u2014"} on{" "}
                {formatDate(viewingVersion.submitted_at)} &mdash; Revision {viewingVersion.revision}
              </Alert>
            )}

            {/* BPMN Viewer with watermark overlay */}
            {viewingVersion.bpmn_xml && (
              <Box sx={{ flex: 1, position: "relative", minHeight: 0 }} ref={fullScreenBpmnRef}>
                <BpmnViewer
                  bpmnXml={viewingVersion.bpmn_xml}
                  elements={[]}
                  onElementClick={() => {}}
                  height="100%"
                />
                {/* Corner watermark */}
                {(viewingVersion.status === "published" || viewingVersion.status === "archived") && (
                  <Box
                    sx={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      bgcolor: viewingVersion.status === "published"
                        ? "rgba(76,175,80,0.1)"
                        : "rgba(33,150,243,0.1)",
                      border: `1px solid ${viewingVersion.status === "published" ? "#4caf50" : "#2196f3"}`,
                      borderRadius: 1,
                      px: 2,
                      py: 0.75,
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      pointerEvents: "none",
                    }}
                  >
                    <MaterialSymbol
                      icon="verified"
                      size={18}
                      color={viewingVersion.status === "published" ? "#4caf50" : "#2196f3"}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        color: viewingVersion.status === "published" ? "#4caf50" : "#2196f3",
                        fontWeight: 600,
                      }}
                    >
                      {buildWatermarkText(viewingVersion)}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  );

  // ── Confirm action dialog ────────────────────────────────────────────

  const actionLabels: Record<string, { title: string; description: string; button: string; color: "primary" | "success" | "error" }> = {
    submit: {
      title: "Submit for Approval?",
      description:
        "This draft will be sent to the business process owner for approval. You will not be able to edit it while it is pending.",
      button: "Submit",
      color: "primary",
    },
    approve: {
      title: "Approve and Publish?",
      description:
        "This will publish the process flow. The current published version (if any) will be archived. This action cannot be undone.",
      button: "Approve & Publish",
      color: "success",
    },
    reject: {
      title: "Reject Draft?",
      description:
        "This will return the draft to the author for revision. They will be notified.",
      button: "Reject",
      color: "error",
    },
    delete: {
      title: "Delete Draft?",
      description: "This will permanently delete the draft. This cannot be undone.",
      button: "Delete",
      color: "error",
    },
  };

  const renderConfirmDialog = () => {
    if (!confirmAction) return null;
    const labels = actionLabels[confirmAction.type];
    return (
      <Dialog open onClose={() => setConfirmAction(null)}>
        <DialogTitle>{labels.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{labels.description}</DialogContentText>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Revision: {confirmAction.version.revision}
          </Typography>
          {actionError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmAction(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={labels.color}
            onClick={handleAction}
          >
            {labels.button}
          </Button>
        </DialogActions>
      </Dialog>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <Box>
      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        <Tab label="Published" />
        {perms.can_view_drafts && <Tab label="Drafts" />}
        {perms.can_view_drafts && <Tab label="Archived" />}
      </Tabs>

      {subTab === 0 && renderPublished()}
      {subTab === 1 && perms.can_view_drafts && renderDrafts()}
      {subTab === 2 && perms.can_view_drafts && renderArchived()}

      {renderFullScreenDialog()}
      {renderConfirmDialog()}
    </Box>
  );
}
