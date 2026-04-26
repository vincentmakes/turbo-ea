import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import { api } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import MaterialSymbol from "@/components/MaterialSymbol";
import CapabilityCatalogueBrowser from "./CapabilityCatalogueBrowser";
import type {
  CataloguePayload,
  FlatCapability,
  ImportResult,
  UpdateStatus,
} from "./types";

export default function CapabilityCataloguePage() {
  const { t } = useTranslation(["cards", "common"]);
  const { user } = useAuth();
  const navigate = useNavigate();

  const can = (key: string): boolean => {
    const p = user?.permissions;
    if (!p) return false;
    if (p["*"]) return true;
    return !!p[key];
  };
  const canCreate = can("inventory.create");
  const canManageUpdates = can("admin.metamodel");

  const [payload, setPayload] = useState<CataloguePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateFetching, setUpdateFetching] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  // Initial load -----------------------------------------------------------
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<CataloguePayload>("/capability-catalogue");
      setPayload(data);
    } catch (e: any) {
      setLoadError(e?.detail || e?.message || "Failed to load catalogue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const byId = useMemo(() => {
    const m = new Map<string, FlatCapability>();
    for (const c of payload?.capabilities ?? []) m.set(c.id, c);
    return m;
  }, [payload]);

  const selectedCaps = useMemo(
    () => Array.from(selected).map((id) => byId.get(id)).filter(Boolean) as FlatCapability[],
    [selected, byId],
  );

  // Update flow ------------------------------------------------------------
  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    try {
      const status = await api.get<UpdateStatus>("/capability-catalogue/update-status");
      setUpdateStatus(status);
      if (!status.update_available && !status.error) {
        setSnackbar(t("cards:catalogue.updateUpToDate"));
      }
    } catch (e: any) {
      setSnackbar(e?.detail || "Update check failed");
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleFetchUpdate = async () => {
    setUpdateFetching(true);
    try {
      const r = await api.post<{ catalogue_version: string }>(
        "/capability-catalogue/update-fetch",
        {},
      );
      setSnackbar(
        t("cards:catalogue.updateFetched", { version: r.catalogue_version || "?" }),
      );
      setUpdateStatus(null);
      await reload();
    } catch (e: any) {
      setSnackbar(e?.detail || "Update fetch failed");
    } finally {
      setUpdateFetching(false);
    }
  };

  // Import flow ------------------------------------------------------------
  const handleImport = async () => {
    if (selectedCaps.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const r = await api.post<ImportResult>("/capability-catalogue/import", {
        catalogue_ids: selectedCaps.map((c) => c.id),
      });
      setImportResult(r);
      setSelected(new Set());
      await reload(); // newly-created cards must show as ticked next time
    } catch (e: any) {
      setImportError(e?.detail || e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // Render ----------------------------------------------------------------
  if (loading) {
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError || !payload) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError || "No data"}</Alert>
      </Box>
    );
  }

  const v = payload.version;
  const sourceLabel =
    v.source === "remote"
      ? t("cards:catalogue.sourceRemote", { version: v.bundled_version })
      : t("cards:catalogue.sourceBundled");

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
      {/* Header — title, version, admin update controls */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", md: "center" }}
        sx={{ mb: 2 }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" component="h1">
            {t("cards:catalogue.pageTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("cards:catalogue.subtitle")}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Tooltip title={sourceLabel}>
            <Chip
              size="small"
              icon={<MaterialSymbol icon={v.source === "remote" ? "cloud_done" : "inventory_2"} size={16} />}
              label={t("cards:catalogue.versionChip", {
                version: v.catalogue_version,
                count: v.node_count,
              })}
              variant="outlined"
            />
          </Tooltip>

          {canManageUpdates && (
            <>
              <Button
                size="small"
                variant="outlined"
                onClick={handleCheckUpdate}
                disabled={updateChecking}
                startIcon={
                  updateChecking ? (
                    <CircularProgress size={14} />
                  ) : (
                    <MaterialSymbol icon="refresh" size={16} />
                  )
                }
              >
                {t("cards:catalogue.checkUpdate")}
              </Button>
              {updateStatus?.update_available && (
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  onClick={handleFetchUpdate}
                  disabled={updateFetching}
                  startIcon={
                    updateFetching ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <MaterialSymbol icon="cloud_download" size={16} />
                    )
                  }
                >
                  {t("cards:catalogue.fetchUpdate", {
                    version: updateStatus.remote?.catalogue_version || "?",
                  })}
                </Button>
              )}
            </>
          )}
        </Stack>
      </Stack>

      {updateStatus?.error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {updateStatus.error}
        </Alert>
      )}
      {updateStatus && !updateStatus.update_available && !updateStatus.error && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setUpdateStatus(null)}>
          {t("cards:catalogue.upToDateBanner", { version: updateStatus.active_version })}
        </Alert>
      )}

      {/* Browser */}
      <CapabilityCatalogueBrowser
        data={payload.capabilities}
        selected={selected}
        onSelectedChange={setSelected}
        onOpenDetail={setDetailId}
      />

      {/* Sticky bottom action bar — only when something is selected */}
      {selected.size > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: "sticky",
            bottom: 16,
            mt: 2,
            p: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("cards:catalogue.readyToImport", { count: selected.size })}
          </Typography>
          <Button onClick={() => setSelected(new Set())}>
            {t("cards:catalogue.clearSelection")}
          </Button>
          <Tooltip
            title={canCreate ? "" : t("cards:catalogue.noCreatePermission")}
            disableHoverListener={canCreate}
          >
            <span>
              <Button
                variant="contained"
                color="primary"
                disabled={!canCreate}
                onClick={() => setImportOpen(true)}
                startIcon={<MaterialSymbol icon="add_task" size={18} />}
              >
                {t("cards:catalogue.createSelected", { count: selected.size })}
              </Button>
            </span>
          </Tooltip>
        </Paper>
      )}

      {/* Import confirm + result dialog */}
      <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {importResult
            ? t("cards:catalogue.importDoneTitle")
            : t("cards:catalogue.importConfirmTitle")}
        </DialogTitle>
        <DialogContent>
          {!importResult && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t("cards:catalogue.importConfirmBody", { count: selectedCaps.length })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("cards:catalogue.importConfirmHint")}
              </Typography>
              {importError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {importError}
                </Alert>
              )}
            </>
          )}
          {importResult && (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                {t("cards:catalogue.importDoneBody", {
                  created: importResult.created.length,
                  skipped: importResult.skipped.length,
                  relinked: importResult.relinked.length,
                })}
              </Alert>
              {importResult.created.length > 0 && (
                <Button
                  size="small"
                  onClick={() => navigate("/inventory?type=BusinessCapability")}
                >
                  {t("cards:catalogue.openInventory")}
                </Button>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {!importResult && (
            <>
              <Button onClick={() => setImportOpen(false)} disabled={importing}>
                {t("common:actions.cancel")}
              </Button>
              <Button
                onClick={handleImport}
                variant="contained"
                color="primary"
                disabled={importing}
                startIcon={importing ? <CircularProgress size={14} color="inherit" /> : null}
              >
                {t("cards:catalogue.confirmCreate")}
              </Button>
            </>
          )}
          {importResult && (
            <Button
              onClick={() => {
                setImportOpen(false);
                setImportResult(null);
              }}
            >
              {t("common:actions.close")}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Detail dialog */}
      {detailId && byId.get(detailId) && (
        <DetailDialog
          node={byId.get(detailId)!}
          byId={byId}
          byParent={(() => {
            const m = new Map<string | null, FlatCapability[]>();
            for (const c of payload.capabilities) {
              const list = m.get(c.parent_id) ?? [];
              list.push(c);
              m.set(c.parent_id, list);
            }
            return m;
          })()}
          onOpen={setDetailId}
          onClose={() => setDetailId(null)}
        />
      )}

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// DetailDialog — breadcrumb, hero, meta grid, recursive subtree.
// (Minus the GitHub link and "Catalog" root crumb from the upstream site.)
// ---------------------------------------------------------------------------
interface DetailDialogProps {
  node: FlatCapability;
  byId: Map<string, FlatCapability>;
  byParent: Map<string | null, FlatCapability[]>;
  onOpen: (id: string) => void;
  onClose: () => void;
}

function DetailDialog({ node, byId, byParent, onOpen, onClose }: DetailDialogProps) {
  const { t } = useTranslation(["cards", "common"]);

  const ancestors: FlatCapability[] = [];
  let cursor = node.parent_id;
  while (cursor) {
    const a = byId.get(cursor);
    if (!a) break;
    ancestors.unshift(a);
    cursor = a.parent_id;
  }

  const directChildren = byParent.get(node.id) ?? [];
  const descendantCount = (() => {
    let total = 0;
    const stack = [...directChildren];
    while (stack.length > 0) {
      const c = stack.pop()!;
      total += 1;
      for (const k of byParent.get(c.id) ?? []) stack.push(k);
    }
    return total;
  })();

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {ancestors.map((a) => (
            <Box key={a.id} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <Button size="small" onClick={() => onOpen(a.id)} sx={{ minWidth: 0, p: 0.25 }}>
                {a.name}
              </Button>
              <Typography color="text.secondary" sx={{ mx: 0.25 }}>/</Typography>
            </Box>
          ))}
          <Typography variant="h6" component="span">{node.name}</Typography>
        </Stack>
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
          <Chip size="small" label={node.id} variant="outlined" />
          <Chip size="small" color="primary" label={`L${node.level}`} />
          {node.deprecated && (
            <Chip size="small" color="warning" label={t("cards:catalogue.deprecatedLabel")} />
          )}
          {node.existing_card_id && (
            <Chip
              size="small"
              color="success"
              icon={<MaterialSymbol icon="check_circle" size={14} />}
              label={t("cards:catalogue.alreadyExists")}
            />
          )}
        </Stack>

        {node.deprecated && node.deprecation_reason && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <strong>{t("cards:catalogue.deprecatedLabel")}.</strong> {node.deprecation_reason}
          </Alert>
        )}

        {node.description && (
          <Typography variant="body1" sx={{ mb: 2 }}>
            {node.description}
          </Typography>
        )}

        <Stack
          direction="row"
          spacing={3}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 2 }}
        >
          {splitIndustries(node.industry).length > 0 && (
            <MetaCell label={t("cards:catalogue.industryLabel")}>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {splitIndustries(node.industry).map((i) => (
                  <Chip key={i} size="small" label={i} variant="outlined" />
                ))}
              </Stack>
            </MetaCell>
          )}
          {node.aliases.length > 0 && (
            <MetaCell label={t("cards:catalogue.aliasesLabel")}>
              <Typography variant="body2">{node.aliases.join(", ")}</Typography>
            </MetaCell>
          )}
          {node.references.length > 0 && (
            <MetaCell label={t("cards:catalogue.referencesLabel")}>
              <Stack spacing={0.5}>
                {node.references.map((r) => (
                  <a key={r} href={r} target="_blank" rel="noopener noreferrer">
                    {r}
                  </a>
                ))}
              </Stack>
            </MetaCell>
          )}
        </Stack>

        {directChildren.length > 0 && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("cards:catalogue.subtreeHeader", { count: descendantCount })}
            </Typography>
            <Box className="tcc-root">
              <div className="tcc-detail-tree">
                {directChildren.map((c) => (
                  <DetailTreeNode key={c.id} node={c} byParent={byParent} />
                ))}
              </div>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 160 }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

function DetailTreeNode({
  node,
  byParent,
}: {
  node: FlatCapability;
  byParent: Map<string | null, FlatCapability[]>;
}) {
  const kids = byParent.get(node.id) ?? [];
  return (
    <Box>
      <div className="tcc-detail-tree-row">
        <span className="tcc-cap-id">{node.id}</span>
        <span className="tcc-cap-level">L{node.level}</span>
        {node.deprecated && <span className="tcc-deprecated-badge">Dep.</span>}
        {node.existing_card_id && (
          <Tooltip title="Already exists as a card">
            <span className="tcc-existing-tick">
              <MaterialSymbol icon="check_circle" size={14} />
            </span>
          </Tooltip>
        )}
        <span className="tcc-tree-name">{node.name}</span>
        {node.description && <span className="tcc-tree-desc">{node.description}</span>}
      </div>
      {kids.length > 0 && (
        <div className="tcc-detail-tree-children">
          {kids.map((k) => (
            <DetailTreeNode key={k.id} node={k} byParent={byParent} />
          ))}
        </div>
      )}
    </Box>
  );
}

function splitIndustries(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(";").map((x) => x.trim()).filter(Boolean);
}
