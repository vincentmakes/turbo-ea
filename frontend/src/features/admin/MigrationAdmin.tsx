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
import { invalidateCache as invalidateMetamodelCache } from "@/hooks/useMetamodel";

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

interface AutoMappedColumn {
  source_column: string;
  tea_target: string;
}

interface FieldMappingOptions {
  blocks: FieldMappingBlock[];
  auto_mapped_columns: AutoMappedColumn[];
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
  display_name: string | null;
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
  // Filter pill state — keyed by EntityKind so switching tabs preserves
  // the selection per tab. ``null`` means "no filter / All".
  const [pillFilter, setPillFilter] = useState<Partial<Record<EntityKind, string | null>>>({});
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
    // Pull the full set in one request so the per-card-type filter
    // pills + client-side filtering work without re-fetching. The
    // backend caps at 10 000 per call; tabs that exceed that on real
    // tenants would need server-side pagination but we haven't seen
    // it in practice yet (the largest single bucket on the demo
    // snapshot is 272 ``metamodel_field`` rows).
    return api.get<PreviewPage>(`/migration/${id}/preview?entity_kind=${kind}&limit=10000`);
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

  // Pending migration to apply once the conflict-confirmation dialog
  // resolves. Null means no pending confirmation (i.e. handleApply
  // fired directly because there was nothing to confirm).
  const [confirmApply, setConfirmApply] = useState<Migration | null>(null);

  const performApply = useCallback(
    async (m: Migration) => {
      setError(null);
      try {
        await api.post<Migration>(`/migration/${m.id}/apply`);
        // Imports routinely land brand-new card / relation types into the
        // metamodel. Drop the cached snapshot in `useMetamodel` and broadcast
        // the fresh one so every mounted consumer (Inventory's filter sidebar,
        // CreateCardDialog, report axes, …) picks them up without a full page
        // refresh.
        await invalidateMetamodelCache();
        loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadList],
  );

  // Conflict tally across every staging tab — drives the "X rows in
  // conflict" warning and the pre-apply confirmation dialog. Recomputes
  // when the preview cache changes.
  const conflictCounts = useMemo(() => {
    const byKind: Partial<Record<EntityKind, number>> = {};
    let total = 0;
    for (const kind of ENTITY_KIND_ORDER) {
      const c =
        previews[kind]?.items.filter((r) => r.action === "conflict").length ?? 0;
      if (c > 0) {
        byKind[kind] = c;
        total += c;
      }
    }
    return { total, byKind };
  }, [previews]);

  const handleApply = (m: Migration) => {
    // If we know about conflicts on this migration, force an explicit
    // acknowledgement before kicking off the apply. The dialog uses the
    // currently-cached previews so it's only authoritative for the
    // migration whose detail view is open; row-action apply (from the
    // list table) bypasses the confirmation because the previews
    // aren't loaded yet.
    if (selected?.id === m.id && conflictCounts.total > 0) {
      setConfirmApply(m);
      return;
    }
    performApply(m);
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
    setPillFilter({});
    setMappingOptions(null);
    setMappingDraft({});
    setMappingError(null);
    try {
      const fresh = await Promise.all(
        ENTITY_KIND_ORDER.map(async (kind) => [kind, await fetchPreview(m.id, kind)] as const),
      );
      setPreviews(Object.fromEntries(fresh));
      // Load mapping options whenever the snapshot has been parsed at
      // least once. Edit-time states (parsed / previewed) drive the
      // Save button; applied / failed states render the dropdowns as
      // a read-only audit of what was mapped before apply.
      if (m.status !== "uploaded") {
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
        {/* maxWidth stays at lg because the metamodel_field tab needs
            five columns including the inline mapping dropdown. */}
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
                  label={`${applyStats.conflicts ?? 0} conflicts`}
                  color={applyStats.conflicts ? "warning" : "default"}
                  variant="outlined"
                />
                <Chip
                  label={`${applyStats.errors ?? 0} errors`}
                  color={applyStats.errors ? "error" : "default"}
                  variant="outlined"
                />
              </Stack>
            </>
          )}

          {selected &&
            (selected.status === "parsed" || selected.status === "previewed") &&
            conflictCounts.total > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {t(
                    "migration.conflicts.warning",
                    "{{count}} row(s) couldn't be resolved and will be skipped on apply.",
                    { count: conflictCounts.total },
                  )}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
                  {Object.entries(conflictCounts.byKind).map(([kind, c]) => (
                    <Chip
                      key={kind}
                      size="small"
                      label={`${t(`migration.kind.${kind}`, kind)}: ${c}`}
                      color="warning"
                      variant="outlined"
                      onClick={() => setActiveKind(kind as EntityKind)}
                    />
                  ))}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {t(
                    "migration.conflicts.helpText",
                    "Click a chip to jump to the affected tab. Conflicts stay visible in the staged records after apply so they can be inspected later.",
                  )}
                </Typography>
              </Alert>
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
            (() => {
              const allRows = previews[activeKind]!.items;
              const selectedPill = pillFilter[activeKind] ?? null;
              const filteredRows = selectedPill
                ? allRows.filter((r) => filterDimension(r) === selectedPill)
                : allRows;
              return (
                <>
                  <FilterPills
                    rows={allRows}
                    selected={selectedPill}
                    onChange={(v) => setPillFilter({ ...pillFilter, [activeKind]: v })}
                  />
                  {activeKind === "metamodel_field" ? (
                    <MetamodelFieldTab
                      rows={filteredRows}
                      mappingOptions={mappingOptions}
                      draft={mappingDraft}
                      onChange={setMappingDraft}
                      onSave={handleSaveMappings}
                      saving={mappingSaving}
                      error={mappingError}
                      editable={
                        selected?.status === "parsed" || selected?.status === "previewed"
                      }
                    />
                  ) : (
                    <StagedTable rows={filteredRows} />
                  )}
                </>
              );
            })()
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

      <Dialog
        open={!!confirmApply}
        onClose={() => setConfirmApply(null)}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
      >
        <DialogTitle>
          {t("migration.conflicts.confirmTitle", "Apply with unresolved conflicts?")}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t(
              "migration.conflicts.confirmBody",
              "{{count}} row(s) couldn't be resolved during staging and will be skipped on apply. The skipped rows stay visible in the staged records so they can be inspected and re-imported after fixing the source data.",
              { count: conflictCounts.total },
            )}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
            {Object.entries(conflictCounts.byKind).map(([kind, c]) => (
              <Chip
                key={kind}
                size="small"
                label={`${t(`migration.kind.${kind}`, kind)}: ${c}`}
                color="warning"
                variant="outlined"
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmApply(null)}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              const m = confirmApply!;
              setConfirmApply(null);
              performApply(m);
            }}
          >
            {t("migration.conflicts.confirmApply", "Apply and skip conflicts")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Filter pills — one pill per distinct dimension value above the table
// ---------------------------------------------------------------------------

/**
 * Pick the value a row contributes to the filter pills. Default to the
 * staged ``card_type_key`` when it's set (covers ``card``, ``card_tag``,
 * ``metamodel_field``); otherwise fall back to the ``action`` column so
 * every tab gets a useful set of pills (e.g. user-staging: create / skip).
 */
function filterDimension(row: StagedRecord): string {
  return row.card_type_key || row.action || "—";
}

interface FilterPillsProps {
  rows: StagedRecord[];
  selected: string | null;
  onChange: (value: string | null) => void;
}

function FilterPills({ rows, selected, onChange }: FilterPillsProps) {
  const { t } = useTranslation(["admin", "common"]);
  // Count rows per dimension value, preserving first-seen order so
  // pills don't reshuffle between renders.
  const counts: { key: string; count: number }[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = filterDimension(r);
    if (seen.has(k)) {
      counts[seen.get(k)!].count += 1;
    } else {
      seen.set(k, counts.length);
      counts.push({ key: k, count: 1 });
    }
  }
  // No useful filter when everything collapses to a single bucket.
  if (counts.length <= 1) return null;
  // Sort alphabetically so re-opens are deterministic; "All" comes
  // first and is always visible.
  counts.sort((a, b) => a.key.localeCompare(b.key));
  const total = rows.length;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 0.5 }}
    >
      <Chip
        size="small"
        label={`${t("migration.filter.all", "All")} (${total})`}
        color={selected === null ? "primary" : "default"}
        variant={selected === null ? "filled" : "outlined"}
        onClick={() => onChange(null)}
      />
      {counts.map((c) => (
        <Chip
          key={c.key}
          size="small"
          label={`${c.key} (${c.count})`}
          color={selected === c.key ? "primary" : "default"}
          variant={selected === c.key ? "filled" : "outlined"}
          onClick={() => onChange(selected === c.key ? null : c.key)}
        />
      ))}
    </Stack>
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
  // Show the Name column whenever at least one row has a resolved
  // display_name (cards, users, tags, …). Tabs whose rows are
  // anonymous join-table edges (card_tag) skip it so the layout
  // stays tight.
  const showName = rows.some((r) => !!r.display_name);
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          {showName && <TableCell>{t("migration.col.name", "Name")}</TableCell>}
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
            {showName && (
              <TableCell sx={{ wordBreak: "break-word" }}>
                {row.display_name || "—"}
              </TableCell>
            )}
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
            <TableCell sx={{ wordBreak: "break-word" }}>
              <StagedRowNote row={row} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Render the per-row Note cell. Conflicts carry their explanation under
 * ``diff.reason`` — surface that text directly instead of the literal
 * key. Updates carry a per-field ``{old, new}`` map; show the field
 * names that changed (with a tooltip listing the old → new values) so
 * the admin sees what's about to be touched without an attribute dump.
 */
function StagedRowNote({ row }: { row: StagedRecord }) {
  if (row.error_message) {
    return <span>{row.error_message}</span>;
  }
  const diff = row.diff || {};
  if (typeof diff.reason === "string" && diff.reason) {
    return <span>{diff.reason}</span>;
  }
  const keys = Object.keys(diff).filter((k) => k !== "reason");
  if (keys.length === 0) return <span>—</span>;
  // Build a short ``"old" → "new"`` summary per changed field so the
  // tooltip is human-scannable. Nested attribute diffs collapse to the
  // attribute key list.
  const tooltip = keys
    .map((k) => {
      const v = diff[k] as { old?: unknown; new?: unknown } | Record<string, unknown>;
      if (v && typeof v === "object" && "old" in v && "new" in v) {
        const oldV = (v as { old: unknown }).old;
        const newV = (v as { new: unknown }).new;
        return `${k}: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`;
      }
      if (v && typeof v === "object") {
        return `${k}: ${Object.keys(v).join(", ")}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
  return (
    <Tooltip title={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{tooltip}</pre>}>
      <span style={{ textDecoration: "underline dotted", cursor: "help" }}>
        {keys.join(", ")}
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Metamodel-field tab — inline mapping selector per staged custom field
// ---------------------------------------------------------------------------

interface MetamodelFieldTabProps {
  rows: StagedRecord[];
  mappingOptions: FieldMappingOptions | null;
  draft: Record<string, Record<string, string>>;
  onChange: (draft: Record<string, Record<string, string>>) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  editable: boolean;
}

// Sentinel "do not import" target — also recognised by the backend.
const SKIP_VALUE = "__skip__";

function MetamodelFieldTab({
  rows,
  mappingOptions,
  draft,
  onChange,
  onSave,
  saving,
  error,
  editable,
}: MetamodelFieldTabProps) {
  const { t } = useTranslation(["admin", "common"]);

  // Group source_id (``<NativeType>:<field_key>``) into a quick lookup of
  // the matching FieldMappingOptions block for the row's target type.
  const blockByTargetType = useMemo(() => {
    const out = new Map<string, FieldMappingBlock>();
    for (const block of mappingOptions?.blocks || []) {
      out.set(block.target_tea_type, block);
    }
    return out;
  }, [mappingOptions]);

  // Group rows by their target card type so the admin sees one section
  // per type — a flat 272-row list is impossible to navigate.
  const rowsByTarget = useMemo(() => {
    const out = new Map<string, StagedRecord[]>();
    for (const row of rows) {
      const payload = (row as unknown as { source_data?: Record<string, unknown> }).source_data;
      const targetType =
        row.card_type_key || (payload?.target_type as string | undefined) || "—";
      if (!out.has(targetType)) out.set(targetType, []);
      out.get(targetType)!.push(row);
    }
    // Stable alphabetical type order.
    return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }, [rows]);

  const setOne = (nativeType: string, fieldKey: string, value: string) => {
    onChange({
      ...draft,
      [nativeType]: { ...(draft[nativeType] || {}), [fieldKey]: value },
    });
  };

  // Dirty if any draft value differs from the server's current mapping.
  const dirty = useMemo(() => {
    if (!mappingOptions) return false;
    return mappingOptions.blocks.some((block) =>
      block.source_fields.some(
        (row) =>
          (draft[block.native_type]?.[row.source_field_key] || "") !== (row.mapped_to || ""),
      ),
    );
  }, [mappingOptions, draft]);

  return (
    <Box>
      {editable && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 1 }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
            {t(
              "migration.mapping.help",
              "Optional. Route a source platform field onto an existing Turbo EA field on the target card type, or skip it entirely. Unmapped fields land as new custom attributes under an “Imported from…” section.",
            )}
          </Typography>
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
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {(mappingOptions?.auto_mapped_columns?.length ?? 0) > 0 && (
        <Alert severity="info" icon={<MaterialSymbol icon="info" />} sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t(
              "migration.mapping.coreFieldsTitle",
              "Source-platform core columns are auto-mapped to Turbo EA standard fields and don't appear in the list below:",
            )}
          </Typography>
          <Typography variant="caption" component="div" color="text.secondary">
            {mappingOptions!.auto_mapped_columns.map((col, idx) => (
              <span key={col.source_column}>
                {idx > 0 && " · "}
                <code>{col.source_column}</code>
                {col.tea_target !== col.source_column && (
                  <>
                    {" → "}
                    <em>{col.tea_target}</em>
                  </>
                )}
              </span>
            ))}
          </Typography>
        </Alert>
      )}
      {rowsByTarget.size === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("migration.detail.noStaged", "No items staged for this kind.")}
        </Typography>
      ) : (
        [...rowsByTarget.entries()].map(([targetType, typeRows]) => {
          const block = blockByTargetType.get(targetType);
          return (
            <Box key={targetType} sx={{ mb: 3 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Typography variant="subtitle2">
                  {block?.target_type_label || targetType}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  · {typeRows.length}{" "}
                  {t("migration.mapping.fieldsCount", { count: typeRows.length, defaultValue: "fields" })}
                </Typography>
              </Stack>
              <Table size="small" sx={{ tableLayout: "fixed" }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: "34%" }}>
                      {t("migration.mapping.col.sourceField", "Source field")}
                    </TableCell>
                    <TableCell sx={{ width: "14%" }}>
                      {t("migration.mapping.col.sourceType", "Source type")}
                    </TableCell>
                    <TableCell sx={{ width: "40%" }}>
                      {t("migration.mapping.col.target", "Map to Turbo EA field")}
                    </TableCell>
                    <TableCell sx={{ width: "12%" }}>
                      {t("migration.col.statusShort", "Status")}
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {typeRows.map((row) => {
                    const sd = (row.diff || {}) as Record<string, unknown>;
                    const payload = (row as unknown as { source_data?: Record<string, unknown> })
                      .source_data;
                    const [nativeType, ...rest] = (row.source_id || "").split(":");
                    const fieldKey =
                      (payload?.field_key as string | undefined) ||
                      rest.join(":") ||
                      row.source_id;
                    const label =
                      (payload?.label as string | undefined) ||
                      (payload?.field_key as string | undefined) ||
                      fieldKey;
                    const nativeDataType =
                      (payload?.native_data_type as string | undefined) ||
                      (payload?.tea_type as string | undefined) ||
                      null;
                    const value = draft[nativeType]?.[fieldKey] || "";
                    const reason = (sd.reason as string | undefined) || null;
                    const targetByKey = new Map(
                      (block?.available_targets || []).map((o) => [o.key, o]),
                    );
                    const canMap =
                      editable && row.action !== "conflict" && block !== undefined;
                    return (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ wordBreak: "break-word" }}>
                          <Typography variant="body2">{label}</Typography>
                          {label !== fieldKey && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ wordBreak: "break-all" }}
                            >
                              <code>{fieldKey}</code>
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={nativeDataType || "—"}
                          />
                        </TableCell>
                        <TableCell>
                          {row.action === "conflict" ? (
                            <Typography variant="caption" color="warning.main">
                              {reason ||
                                t(
                                  "migration.mapping.unmappable",
                                  "Unmappable — see status note.",
                                )}
                            </Typography>
                          ) : !block ? (
                            <Typography variant="caption" color="text.secondary">
                              {t(
                                "migration.mapping.noTargets",
                                "No target type yet — will land as a new custom field.",
                              )}
                            </Typography>
                          ) : (
                            <FormControl fullWidth size="small" disabled={!canMap}>
                              <Select
                                displayEmpty
                                value={value}
                                onChange={(e) =>
                                  setOne(nativeType, fieldKey, String(e.target.value))
                                }
                                renderValue={(selected) => {
                                  const s = String(selected || "");
                                  if (s === "") {
                                    return (
                                      <Box
                                        component="em"
                                        sx={{
                                          color: "text.secondary",
                                          fontStyle: "italic",
                                        }}
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
                                        sx={{
                                          color: "text.secondary",
                                          fontStyle: "italic",
                                        }}
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
                                {(block.available_targets || []).map((opt) => (
                                  <MenuItem
                                    key={opt.key}
                                    value={opt.key}
                                    sx={{
                                      flexDirection: "column",
                                      alignItems: "flex-start",
                                      py: 0.75,
                                    }}
                                  >
                                    <Typography variant="body2">{opt.label}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {[opt.section, opt.type].filter(Boolean).join(" · ")}
                                    </Typography>
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={row.action}
                            color={ACTION_COLORS[row.action] || "default"}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          );
        })
      )}
    </Box>
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
