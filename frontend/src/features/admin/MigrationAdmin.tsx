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
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
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

// Admin surface for the platform-migration importer. Lives under
// Settings → Migration. End-to-end flow: pick a source platform, upload
// a snapshot, watch the backend stage it, browse the diff, and apply.
// The source picker is registry-driven (GET /migration/sources) so
// adding a new adapter on the backend shows up here without a frontend
// change.

interface SourceInfo {
  key: string;
  label: string;
  accepted_extensions: string[];
}

interface Migration {
  id: string;
  name: string;
  source_type: string;
  status: string;
  file_hash: string;
  file_size: number | null;
  snapshot_version: string | null;
  stats: Record<string, unknown> | null;
  metamodel_diff: Record<string, unknown> | null;
  field_mappings: Record<string, Record<string, string>> | null;
  error_message: string | null;
  parsed_at: string | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface FieldMappingTargetOption {
  key: string;
  label: string;
  type: string;
  section: string | null;
}

interface FieldMappingSourceRow {
  source_field_key: string;
  label: string | null;
  native_data_type: string | null;
  tea_type: string | null;
  target_tea_type: string;
  mapped_to: string | null;
}

interface FieldMappingBlock {
  native_type: string;
  target_tea_type: string;
  target_type_label: string;
  source_fields: FieldMappingSourceRow[];
  available_targets: FieldMappingTargetOption[];
}

interface FieldMappingOptions {
  blocks: FieldMappingBlock[];
}

interface StagedRecord {
  id: string;
  entity_kind: string;
  source_id: string;
  source_type: string;
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
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<Migration | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewPage | null>>({});
  const [activeKind, setActiveKind] = useState<EntityKind>("card");
  const [mappingOptions, setMappingOptions] = useState<FieldMappingOptions | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, Record<string, string>>>({});
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const sourceLabel = useCallback(
    (key: string) => sources.find((s) => s.key === key)?.label || key,
    [sources],
  );

  const loadList = useCallback(async () => {
    try {
      const rows = await api.get<Migration[]>("/migration");
      setMigrations(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const rows = await api.get<SourceInfo[]>("/migration/sources");
      setSources(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadList();
    loadSources();
  }, [loadList, loadSources]);

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
    return api.get<PreviewPage>(`/migration/${id}/preview?entity_kind=${kind}&limit=100`);
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selected) return;
    const m = await api.get<Migration>(`/migration/${selected.id}`);
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

  const handleUpload = async (
    file: File,
    name: string,
    sourceKey: string,
    includeArchived: boolean,
  ) => {
    setError(null);
    try {
      await api.upload("/migration/upload", file, "file", {
        name,
        source_key: sourceKey,
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
      await api.post<Migration>(`/migration/${m.id}/apply`);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (m: Migration) => {
    if (!window.confirm(t("migration.confirmDelete", { name: m.name }))) return;
    try {
      await api.delete(`/migration/${m.id}`);
      if (selected?.id === m.id) {
        setSelected(null);
        setPreviews({});
      }
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadFieldMappings = useCallback(async (m: Migration) => {
    setMappingError(null);
    try {
      const opts = await api.get<FieldMappingOptions>(`/migration/${m.id}/field-mappings`);
      setMappingOptions(opts);
      // Seed the editable draft from the server's current mapping +
      // every source field (default to "" → unmapped).
      const draft: Record<string, Record<string, string>> = {};
      for (const block of opts.blocks) {
        const perType: Record<string, string> = {};
        for (const row of block.source_fields) {
          perType[row.source_field_key] = row.mapped_to || "";
        }
        draft[block.native_type] = perType;
      }
      setMappingDraft(draft);
    } catch (e) {
      setMappingError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleSaveMappings = async () => {
    if (!selected) return;
    setMappingSaving(true);
    setMappingError(null);
    try {
      // Strip empty values — the backend already does this but it keeps
      // the wire payload small and the round-trip echo predictable.
      const cleaned: Record<string, Record<string, string>> = {};
      for (const [nativeType, perType] of Object.entries(mappingDraft)) {
        const kept = Object.fromEntries(
          Object.entries(perType).filter(([, v]) => v && v.length > 0),
        );
        if (Object.keys(kept).length > 0) cleaned[nativeType] = kept;
      }
      const updated = await api.put<Migration>(`/migration/${selected.id}/field-mappings`, {
        field_mappings: cleaned,
      });
      setSelected(updated);
      setMigrations((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      await loadFieldMappings(updated);
    } catch (e) {
      setMappingError(e instanceof Error ? e.message : String(e));
    } finally {
      setMappingSaving(false);
    }
  };

  const handleOpenDetail = async (m: Migration) => {
    setSelected(m);
    setPreviews({});
    setActiveKind("card");
    setMappingOptions(null);
    setMappingDraft({});
    setMappingError(null);
    try {
      const fresh = await Promise.all(
        ENTITY_KIND_ORDER.map(async (kind) => [kind, await fetchPreview(m.id, kind)] as const),
      );
      setPreviews(Object.fromEntries(fresh));
      if (m.status === "parsed" || m.status === "previewed") {
        await loadFieldMappings(m);
      }
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
              "Import a platform snapshot. Supported sources today: SAP LeanIX. Cards, relations, tags, stakeholders, and the metamodel diff all land in one reviewable operation.",
            )}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="upload" />}
          onClick={() => setUploadOpen(true)}
          disabled={sources.length === 0}
        >
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
              <TableCell>{t("migration.col.source", "Source")}</TableCell>
              <TableCell>{t("migration.col.status", "Status")}</TableCell>
              <TableCell>{t("migration.col.version", "Snapshot")}</TableCell>
              <TableCell align="right">{t("migration.col.size", "Size")}</TableCell>
              <TableCell align="right">{t("migration.col.entities", "Entities")}</TableCell>
              <TableCell>{t("migration.col.created", "Uploaded")}</TableCell>
              <TableCell align="right">{t("migration.col.actions", "")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {migrations.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
                    {t(
                      "migration.empty",
                      "No migrations yet. Upload a platform snapshot to get started.",
                    )}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {migrations.map((m) => {
              const rowStats = (m.stats ?? {}) as Record<string, unknown>;
              const entityCount =
                (rowStats.entities as number | undefined) ??
                (rowStats.fact_sheets as number | undefined);
              return (
                <TableRow
                  key={m.id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => handleOpenDetail(m)}
                >
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={sourceLabel(m.source_type)} variant="outlined" />
                  </TableCell>
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
                  <TableCell align="right">{entityCount ?? "—"}</TableCell>
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

      <UploadDialog
        open={uploadOpen}
        sources={sources}
        onClose={() => setUploadOpen(false)}
        onSubmit={handleUpload}
      />

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="lg" fullWidth>
        <DialogTitle>
          {selected?.name}
          {selected && (
            <>
              <Chip
                size="small"
                label={sourceLabel(selected.source_type)}
                variant="outlined"
                sx={{ ml: 1 }}
              />
              <Chip
                size="small"
                label={selected.status}
                color={STATUS_COLORS[selected.status] || "default"}
                sx={{ ml: 1 }}
              />
            </>
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
            <Chip
              label={`${
                (stats.entities as number | undefined) ??
                (stats.fact_sheets as number | undefined) ??
                0
              } entities`}
            />
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

          {selected && (selected.status === "parsed" || selected.status === "previewed") && (
            <FieldMappingPanel
              options={mappingOptions}
              draft={mappingDraft}
              onChange={setMappingDraft}
              onSave={handleSaveMappings}
              saving={mappingSaving}
              error={mappingError}
            />
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
                href={`/api/v1/migration/${selected.id}/errors.csv`}
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
          <TableCell>{t("migration.col.sourceId", "Source ID")}</TableCell>
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
              <code>{row.source_id}</code>
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
// Field mapping panel
// ---------------------------------------------------------------------------

interface FieldMappingPanelProps {
  options: FieldMappingOptions | null;
  draft: Record<string, Record<string, string>>;
  onChange: (draft: Record<string, Record<string, string>>) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}

function FieldMappingPanel({
  options,
  draft,
  onChange,
  onSave,
  saving,
  error,
}: FieldMappingPanelProps) {
  const { t } = useTranslation(["admin", "common"]);

  // Sentinel "do not import" target — also recognised by the backend.
  const SKIP_VALUE = "__skip__";

  const setOne = (nativeType: string, fieldKey: string, value: string) => {
    onChange({
      ...draft,
      [nativeType]: { ...(draft[nativeType] || {}), [fieldKey]: value },
    });
  };

  if (options === null) {
    return null;
  }

  if (options.blocks.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t("migration.mapping.title", "Map imported fields")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t(
            "migration.mapping.empty",
            "The snapshot did not contain any custom fields to remap — every field already lands on a built-in Turbo EA column.",
          )}
        </Typography>
      </Paper>
    );
  }

  // Dirty if any draft value differs from the server's current mapping.
  const dirty = options.blocks.some((block) =>
    block.source_fields.some(
      (row) =>
        (draft[block.native_type]?.[row.source_field_key] || "") !== (row.mapped_to || ""),
    ),
  );

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ mb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">
            {t("migration.mapping.title", "Map imported fields")}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t(
              "migration.mapping.help",
              "Optional. Route a source platform field onto an existing Turbo EA field on the target card type, or skip it entirely. Unmapped fields land as new custom attributes under an “Imported from…” section.",
            )}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="contained"
          onClick={onSave}
          disabled={!dirty || saving}
          startIcon={saving ? <CircularProgress size={14} /> : <MaterialSymbol icon="save" />}
          sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
        >
          {t("migration.mapping.save", "Save mappings")}
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}

      {options.blocks.map((block) => {
        const targetByKey = new Map(block.available_targets.map((o) => [o.key, o]));
        return (
          <Box key={`${block.native_type}->${block.target_tea_type}`} sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {block.native_type} → {block.target_type_label}
            </Typography>
            <Table size="small" sx={{ tableLayout: "fixed" }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: "38%" }}>
                    {t("migration.mapping.col.sourceField", "Source field")}
                  </TableCell>
                  <TableCell sx={{ width: "14%" }}>
                    {t("migration.mapping.col.sourceType", "Source type")}
                  </TableCell>
                  <TableCell sx={{ width: "48%" }}>
                    {t("migration.mapping.col.target", "Map to Turbo EA field")}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {block.source_fields.map((row) => {
                  const value = draft[block.native_type]?.[row.source_field_key] || "";
                  return (
                    <TableRow key={row.source_field_key} hover>
                      <TableCell sx={{ wordBreak: "break-word" }}>
                        <Typography variant="body2">
                          {row.label || row.source_field_key}
                        </Typography>
                        {row.label && row.label !== row.source_field_key && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ wordBreak: "break-all" }}
                          >
                            <code>{row.source_field_key}</code>
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={row.native_data_type || row.tea_type || "—"}
                        />
                      </TableCell>
                      <TableCell>
                        <FormControl fullWidth size="small">
                          <Select
                            displayEmpty
                            value={value}
                            onChange={(e) =>
                              setOne(
                                block.native_type,
                                row.source_field_key,
                                String(e.target.value),
                              )
                            }
                            renderValue={(selected) => {
                              const s = String(selected || "");
                              if (s === "") {
                                return (
                                  <Box
                                    component="em"
                                    sx={{ color: "text.secondary", fontStyle: "italic" }}
                                  >
                                    {t(
                                      "migration.mapping.option.newCustom",
                                      "(Import as new custom field — default)",
                                    )}
                                  </Box>
                                );
                              }
                              if (s === SKIP_VALUE) {
                                return (
                                  <Box
                                    component="em"
                                    sx={{ color: "text.secondary", fontStyle: "italic" }}
                                  >
                                    {t(
                                      "migration.mapping.option.skip",
                                      "(Do not import this field)",
                                    )}
                                  </Box>
                                );
                              }
                              const opt = targetByKey.get(s);
                              return opt ? opt.label : s;
                            }}
                          >
                            <MenuItem value="">
                              <em>
                                {t(
                                  "migration.mapping.option.newCustom",
                                  "(Import as new custom field — default)",
                                )}
                              </em>
                            </MenuItem>
                            <MenuItem value={SKIP_VALUE}>
                              <em>
                                {t(
                                  "migration.mapping.option.skip",
                                  "(Do not import this field)",
                                )}
                              </em>
                            </MenuItem>
                            {block.available_targets.map((opt) => (
                              <MenuItem
                                key={opt.key}
                                value={opt.key}
                                sx={{ flexDirection: "column", alignItems: "flex-start", py: 0.75 }}
                              >
                                <Typography variant="body2">{opt.label}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {[opt.section, opt.type].filter(Boolean).join(" · ")}
                                </Typography>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        );
      })}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Upload dialog
// ---------------------------------------------------------------------------

interface UploadDialogProps {
  open: boolean;
  sources: SourceInfo[];
  onClose: () => void;
  onSubmit: (
    file: File,
    name: string,
    sourceKey: string,
    includeArchived: boolean,
  ) => Promise<void>;
}

function UploadDialog({ open, sources, onClose, onSubmit }: UploadDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [sourceKey, setSourceKey] = useState<string>("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setName("");
      setIncludeArchived(false);
      setSubmitting(false);
    } else {
      // Default to the first registered source so single-source installs
      // (the case today) don't make the user click the picker.
      setSourceKey((prev) => prev || sources[0]?.key || "");
    }
  }, [open, sources]);

  const activeSource = sources.find((s) => s.key === sourceKey);
  const acceptedExts = activeSource?.accepted_extensions.join(",") || ".xlsx";

  const handleSubmit = async () => {
    if (!file || !name || !sourceKey) return;
    setSubmitting(true);
    try {
      await onSubmit(file, name, sourceKey, includeArchived);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("migration.upload.title", "Import a platform snapshot")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t(
              "migration.upload.help",
              "Pick the source platform, then drop the snapshot export. The file stays on disk and is purged when you delete the migration.",
            )}
          </Typography>
          <FormControl fullWidth>
            <InputLabel id="migration-source-label">
              {t("migration.upload.source", "Source platform")}
            </InputLabel>
            <Select
              labelId="migration-source-label"
              label={t("migration.upload.source", "Source platform")}
              value={sourceKey}
              onChange={(e) => setSourceKey(String(e.target.value))}
            >
              {sources.map((s) => (
                <MenuItem key={s.key} value={s.key}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
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
              accept={acceptedExts}
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
              "Also import archived entities (off by default)",
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
        <Button
          variant="contained"
          disabled={!file || !name || !sourceKey || submitting}
          onClick={handleSubmit}
        >
          {submitting ? <CircularProgress size={18} /> : t("migration.upload.submit", "Upload")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
