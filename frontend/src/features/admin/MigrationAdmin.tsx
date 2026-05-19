import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";

// Phase 1 admin surface for the LeanIX workspace-snapshot importer.
// Lives under Settings → Migration. Minimal end-to-end flow: pick a
// gzipped snapshot, watch the backend stage it, browse the diff, and
// apply. Phase-3+ will swap the bare staged-record list for a richer
// `MetamodelMappingPanel` and per-entity tabs.

interface Migration {
  id: string;
  name: string;
  status: string;
  file_hash: string;
  file_size: number | null;
  snapshot_version: string | null;
  stats: Record<string, unknown> | null;
  metamodel_diff: Record<string, unknown> | null;
  error_message: string | null;
  parsed_at: string | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface StagedRecord {
  id: string;
  entity_kind: string;
  leanix_id: string;
  card_type_key: string | null;
  action: string;
  status: string;
  diff: Record<string, unknown> | null;
  error_message: string | null;
  target_id: string | null;
}

interface PreviewPage {
  items: StagedRecord[];
  total: number;
  offset: number;
  limit: number;
}

type EntityKind =
  | "metamodel_type"
  | "metamodel_field"
  | "metamodel_relation_type"
  | "user"
  | "card"
  | "relation"
  | "tag"
  | "tag_group"
  | "card_tag"
  | "subscription"
  | "document"
  | "comment";

const ENTITY_KIND_ORDER: EntityKind[] = [
  "metamodel_type",
  "metamodel_field",
  "metamodel_relation_type",
  "user",
  "card",
  "relation",
  "tag",
  "tag_group",
  "card_tag",
  "subscription",
  "document",
  "comment",
];

const STATUS_COLORS: Record<string, "default" | "info" | "success" | "warning" | "error"> = {
  uploaded: "info",
  parsed: "info",
  previewed: "info",
  applying: "warning",
  applied: "success",
  failed: "error",
  aborted: "default",
};

const ACTION_COLORS: Record<string, "default" | "success" | "info" | "warning" | "error"> = {
  create: "success",
  update: "info",
  skip: "default",
  conflict: "warning",
};

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function MigrationAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<Migration | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewPage | null>>({});
  const [activeKind, setActiveKind] = useState<EntityKind>("card");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const rows = await api.get<Migration[]>("/migration/leanix");
      setMigrations(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Active migration polling — when a migration is mid-parse or
  // mid-apply, refresh the row every 3 s so the status moves on its
  // own. We poll the list (not each row) so the table-level counters
  // also stay live without per-row state.
  useEffect(() => {
    const active = migrations.some((m) => m.status === "uploaded" || m.status === "applying");
    if (active && !pollTimer.current) {
      pollTimer.current = setInterval(loadList, 3000);
    } else if (!active && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [migrations, loadList]);

  const fetchPreview = useCallback(async (id: string, kind: EntityKind): Promise<PreviewPage> => {
    return api.get<PreviewPage>(`/migration/leanix/${id}/preview?entity_kind=${kind}&limit=100`);
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    const m = await api.get<Migration>(`/migration/leanix/${selected.id}`);
    setSelected(m);
    setMigrations((prev) => prev.map((row) => (row.id === m.id ? m : row)));
    if (m.status === "parsed" || m.status === "applied" || m.status === "failed") {
      const fresh = await Promise.all(
        ENTITY_KIND_ORDER.map(async (kind) => [kind, await fetchPreview(m.id, kind)] as const),
      );
      setPreviews(Object.fromEntries(fresh));
    }
  }, [selected, fetchPreview]);

  // Re-fetch the selected migration's detail whenever the list updates
  // — keeps the open detail dialog in sync with the polling above.
  useEffect(() => {
    if (!selected) return;
    const updated = migrations.find((m) => m.id === selected.id);
    if (updated && updated.status !== selected.status) {
      refreshSelected();
    }
  }, [migrations, selected, refreshSelected]);

  const handleUpload = async (file: File, name: string, includeArchived: boolean) => {
    setError(null);
    try {
      await api.upload("/migration/leanix/upload", file, "file", {
        name,
        include_archived: includeArchived ? "true" : "false",
      });
      setUploadOpen(false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleApply = async (m: Migration) => {
    setError(null);
    try {
      await api.post<Migration>(`/migration/leanix/${m.id}/apply`);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (m: Migration) => {
    if (!window.confirm(t("migration.confirmDelete", { name: m.name }))) return;
    try {
      await api.delete(`/migration/leanix/${m.id}`);
      if (selected?.id === m.id) {
        setSelected(null);
        setPreviews({});
      }
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenDetail = async (m: Migration) => {
    setSelected(m);
    setPreviews({});
    setActiveKind("card");
    try {
      const fresh = await Promise.all(
        ENTITY_KIND_ORDER.map(async (kind) => [kind, await fetchPreview(m.id, kind)] as const),
      );
      setPreviews(Object.fromEntries(fresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stats = useMemo(() => (selected?.stats ?? {}) as Record<string, unknown>, [selected]);
  const cardStats = useMemo(
    () => ((stats.cards as Record<string, number>) ?? {}) as Record<string, number>,
    [stats],
  );
  const relationStats = useMemo(
    () => ((stats.relations as Record<string, number>) ?? {}) as Record<string, number>,
    [stats],
  );
  const tagStats = useMemo(
    () => ((stats.tags as Record<string, number>) ?? {}) as Record<string, number>,
    [stats],
  );
  const applyStats = useMemo(
    () => ((stats.apply as Record<string, number>) ?? {}) as Record<string, number>,
    [stats],
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="swap_horiz" />
            {t("migration.title", "Platform migration")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              "migration.subtitle",
              "Import a LeanIX workspace snapshot. Phase 1 lands cards; relations, tags, stakeholders and the metamodel diff follow.",
            )}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<MaterialSymbol icon="upload" />} onClick={() => setUploadOpen(true)}>
          {t("migration.newButton", "New migration")}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("migration.col.name", "Name")}</TableCell>
              <TableCell>{t("migration.col.status", "Status")}</TableCell>
              <TableCell>{t("migration.col.version", "Snapshot")}</TableCell>
              <TableCell align="right">{t("migration.col.size", "Size")}</TableCell>
              <TableCell align="right">{t("migration.col.factSheets", "Fact sheets")}</TableCell>
              <TableCell>{t("migration.col.created", "Uploaded")}</TableCell>
              <TableCell align="right">{t("migration.col.actions", "")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {migrations.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                    {t("migration.empty", "No migrations yet. Upload a LeanIX snapshot to get started.")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {migrations.map((m) => {
              const rowStats = (m.stats ?? {}) as Record<string, unknown>;
              const factSheetCount = rowStats.fact_sheets as number | undefined;
              return (
                <TableRow key={m.id} hover sx={{ cursor: "pointer" }} onClick={() => handleOpenDetail(m)}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={m.status}
                      color={STATUS_COLORS[m.status] || "default"}
                    />
                    {(m.status === "uploaded" || m.status === "applying") && (
                      <LinearProgress sx={{ mt: 0.5, width: 60 }} />
                    )}
                  </TableCell>
                  <TableCell>{m.snapshot_version || "—"}</TableCell>
                  <TableCell align="right">{fmtBytes(m.file_size)}</TableCell>
                  <TableCell align="right">{factSheetCount ?? "—"}</TableCell>
                  <TableCell>{fmtDate(m.created_at)}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {(m.status === "parsed" || m.status === "previewed") && (
                      <Tooltip title={t("migration.applyTooltip", "Apply staged records")}>
                        <IconButton size="small" color="primary" onClick={() => handleApply(m)}>
                          <MaterialSymbol icon="play_arrow" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={t("common.delete", "Delete")}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={m.status === "applying"}
                          onClick={() => handleDelete(m)}
                        >
                          <MaterialSymbol icon="delete" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onSubmit={handleUpload} />

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {selected?.name}{" "}
          {selected && (
            <Chip
              size="small"
              label={selected.status}
              color={STATUS_COLORS[selected.status] || "default"}
              sx={{ ml: 1 }}
            />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {selected?.error_message && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {selected.error_message}
            </Alert>
          )}

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t("migration.detail.stats", "Stats")}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
            <Chip label={`${(stats.fact_sheets as number | undefined) ?? 0} fact sheets`} />
            <Chip label={`${(stats.relation_count as number | undefined) ?? 0} relations`} />
            <Chip label={`${(stats.tag_count as number | undefined) ?? 0} tags`} />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Cards
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
            <Chip label={`${cardStats.create ?? 0} create`} color="success" variant="outlined" />
            <Chip label={`${cardStats.update ?? 0} update`} color="info" variant="outlined" />
            <Chip label={`${cardStats.skip ?? 0} skip`} variant="outlined" />
            <Chip label={`${cardStats.conflict ?? 0} conflict`} color="warning" variant="outlined" />
            {cardStats.unknown_type ? (
              <Chip
                label={`${cardStats.unknown_type} unmapped type`}
                color="warning"
                variant="outlined"
              />
            ) : null}
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Relations
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
            <Chip label={`${relationStats.create ?? 0} create`} color="success" variant="outlined" />
            <Chip label={`${relationStats.update ?? 0} update`} color="info" variant="outlined" />
            <Chip label={`${relationStats.skip ?? 0} skip`} variant="outlined" />
            <Chip
              label={`${relationStats.conflict ?? 0} conflict`}
              color="warning"
              variant="outlined"
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            Tags
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
            <Chip
              label={`${tagStats.groups_create ?? 0} new groups`}
              color="success"
              variant="outlined"
            />
            <Chip
              label={`${tagStats.tags_create ?? 0} new tags`}
              color="success"
              variant="outlined"
            />
            <Chip label={`${tagStats.links ?? 0} card↔tag links`} variant="outlined" />
          </Stack>

          {selected?.applied_at && (
            <>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t("migration.detail.applyResult", "Apply result")}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                <Chip
                  label={`${applyStats.created ?? 0} created`}
                  color="success"
                  variant="outlined"
                />
                <Chip
                  label={`${applyStats.updated ?? 0} updated`}
                  color="info"
                  variant="outlined"
                />
                <Chip label={`${applyStats.skipped ?? 0} skipped`} variant="outlined" />
                <Chip
                  label={`${applyStats.errors ?? 0} errors`}
                  color={applyStats.errors ? "error" : "default"}
                  variant="outlined"
                />
              </Stack>
            </>
          )}

          <Tabs
            value={activeKind}
            onChange={(_, v) => setActiveKind(v)}
            sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
          >
            {ENTITY_KIND_ORDER.map((kind) => {
              const total = previews[kind]?.total ?? 0;
              return (
                <Tab
                  key={kind}
                  value={kind}
                  label={`${t(`migration.kind.${kind}`, kind)} (${total})`}
                />
              );
            })}
          </Tabs>

          {!previews[activeKind] ? (
            <CircularProgress size={20} />
          ) : previews[activeKind]!.items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("migration.detail.noStaged", "No items staged for this kind.")}
            </Typography>
          ) : (
            <StagedTable rows={previews[activeKind]!.items} />
          )}
        </DialogContent>
        <DialogActions>
          {selected &&
            (selected.status === "applied" || selected.status === "failed") &&
            ((applyStats.errors ?? 0) > 0 ||
              ENTITY_KIND_ORDER.some((k) =>
                previews[k]?.items.some((r) => r.status === "error"),
              )) && (
              <Button
                startIcon={<MaterialSymbol icon="download" />}
                href={`/api/v1/migration/leanix/${selected.id}/errors.csv`}
                target="_blank"
                rel="noopener"
              >
                {t("migration.detail.downloadErrors", "Download error report")}
              </Button>
            )}
          {selected && (selected.status === "parsed" || selected.status === "previewed") && (
            <Button
              variant="contained"
              startIcon={<MaterialSymbol icon="play_arrow" />}
              onClick={() => handleApply(selected)}
            >
              {t("migration.detail.apply", "Apply migration")}
            </Button>
          )}
          <Button onClick={() => setSelected(null)}>{t("common.close", "Close")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Staged-record table
// ---------------------------------------------------------------------------

interface StagedTableProps {
  rows: StagedRecord[];
}

function StagedTable({ rows }: StagedTableProps) {
  const { t } = useTranslation(["admin", "common"]);
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t("migration.col.leanixId", "LeanIX ID")}</TableCell>
          <TableCell>{t("migration.col.type", "Type")}</TableCell>
          <TableCell>{t("migration.col.action", "Action")}</TableCell>
          <TableCell>{t("migration.col.statusShort", "Status")}</TableCell>
          <TableCell>{t("migration.col.note", "Note")}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <code>{row.leanix_id}</code>
            </TableCell>
            <TableCell>{row.card_type_key || "—"}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={row.action}
                color={ACTION_COLORS[row.action] || "default"}
              />
            </TableCell>
            <TableCell>
              <Chip
                size="small"
                label={row.status}
                color={row.status === "error" ? "error" : "default"}
              />
            </TableCell>
            <TableCell>
              {row.error_message ||
                (row.diff && Object.keys(row.diff).length > 0
                  ? Object.keys(row.diff).join(", ")
                  : "—")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Upload dialog
// ---------------------------------------------------------------------------

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (file: File, name: string, includeArchived: boolean) => Promise<void>;
}

function UploadDialog({ open, onClose, onSubmit }: UploadDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setName("");
      setIncludeArchived(false);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!file || !name) return;
    setSubmitting(true);
    try {
      await onSubmit(file, name, includeArchived);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("migration.upload.title", "Import a LeanIX snapshot")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t(
              "migration.upload.help",
              "Drop a gzipped LeanIX workspace snapshot here. The parser handles both .json and .json.gz files; the snapshot stays on disk and is purged when you delete the migration.",
            )}
          </Typography>
          <TextField
            autoFocus
            label={t("migration.upload.name", "Migration label")}
            placeholder="LeanIX prod export 2026-05"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <Button
            variant="outlined"
            component="label"
            startIcon={<MaterialSymbol icon="attach_file" />}
          >
            {file ? file.name : t("migration.upload.pick", "Choose snapshot file")}
            <input
              type="file"
              hidden
              accept=".gz,.json,application/gzip,application/json"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Button>
          {file && (
            <Typography variant="caption" color="text.secondary">
              {fmtBytes(file.size)}
            </Typography>
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
            }
            label={t(
              "migration.upload.includeArchived",
              "Also import LeanIX-archived fact sheets (off by default)",
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
        <Button
          variant="contained"
          disabled={!file || !name || submitting}
          onClick={handleSubmit}
        >
          {submitting ? <CircularProgress size={18} /> : t("migration.upload.submit", "Upload")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
