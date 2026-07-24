import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  CataloguePrinciple,
  PrinciplesCataloguePayload,
  PrinciplesImportResult,
} from "@/types";

function BulletList({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <Box component="ul" sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}>
      {lines.map((line, idx) => (
        <Typography
          key={idx}
          component="li"
          variant="caption"
          color="text.secondary"
          sx={{ py: 0.1 }}
        >
          {line.replace(/^[-*•]\s*/, "")}
        </Typography>
      ))}
    </Box>
  );
}

export default function PrinciplesCataloguePage() {
  const { t } = useTranslation(["admin", "common"]);
  const navigate = useNavigate();

  const [payload, setPayload] = useState<PrinciplesCataloguePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<PrinciplesImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<PrinciplesCataloguePayload>("/principles-catalogue");
      setPayload(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo<CataloguePrinciple[]>(() => {
    if (!payload) return [];
    const q = search.trim().toLowerCase();
    if (!q) return payload.principles;
    return payload.principles.filter((p) => {
      const haystack = [p.title, p.description ?? "", p.rationale ?? "", p.implications ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [payload, search]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    if (!payload) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of filtered) {
        if (!p.existing_principle_id) next.add(p.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const runImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.post<PrinciplesImportResult>("/principles-catalogue/import", {
        catalogue_ids: Array.from(selected),
      });
      setImportResult(result);
      setSelected(new Set());
      setImportOpen(false);
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportError(msg);
    } finally {
      setImporting(false);
    }
  };

  const totalImportable = (payload?.principles ?? []).filter((p) => !p.existing_principle_id).length;

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", px: { xs: 2, md: 3 }, py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <MaterialSymbol icon="bookmark_star" size={28} color="#1976d2" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={600}>
            {t("principlesCatalogue.pageTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("principlesCatalogue.subtitle")}
          </Typography>
        </Box>
        {payload?.catalogue_version && (
          <Chip
            size="small"
            label={t("principlesCatalogue.versionChip", { version: payload.catalogue_version })}
            sx={{ height: 24 }}
          />
        )}
      </Stack>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>
          {loadError}
        </Alert>
      )}

      <Paper
        elevation={0}
        sx={{
          position: "sticky",
          top: { xs: 0, md: 64 },
          zIndex: 2,
          py: 1.5,
          px: 2,
          mb: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          backgroundColor: "background.paper",
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
          <TextField
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("principlesCatalogue.searchPlaceholder")}
            sx={{ flex: 1, minWidth: 240 }}
            InputProps={{
              startAdornment: (
                <MaterialSymbol icon="search" size={18} color="#999" style={{ marginRight: 6 }} />
              ),
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={selectVisible}
              disabled={filtered.every((p) => !!p.existing_principle_id || selected.has(p.id))}
            >
              {t("principlesCatalogue.selectVisible")}
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={clearSelection}
              disabled={selected.size === 0}
            >
              {t("principlesCatalogue.clearSelection")}
            </Button>
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          {t("principlesCatalogue.matchCount", {
            shown: filtered.length,
            total: payload?.principles.length ?? 0,
            importable: totalImportable,
          })}
        </Typography>
      </Paper>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && filtered.length === 0 && (
        <Box
          sx={{
            py: 6,
            textAlign: "center",
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 2,
          }}
        >
          <MaterialSymbol icon="search_off" size={40} color="#bbb" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("principlesCatalogue.noMatches")}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.5}>
        {filtered.map((p) => {
          const isImported = !!p.existing_principle_id;
          const isSelected = selected.has(p.id);
          return (
            <Card
              key={p.id}
              variant="outlined"
              sx={{
                opacity: isImported ? 0.85 : 1,
                borderColor: isSelected ? "primary.main" : "divider",
                borderWidth: isSelected ? 2 : 1,
              }}
            >
              <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                  {isImported ? (
                    <Tooltip title={t("principlesCatalogue.alreadyExists")}>
                      <Box sx={{ p: "9px" }}>
                        <MaterialSymbol icon="check_circle" size={22} color="#2e7d32" />
                      </Box>
                    </Tooltip>
                  ) : (
                    <Checkbox
                      checked={isSelected}
                      onChange={() => toggleSelected(p.id)}
                      size="small"
                      sx={{ p: "9px" }}
                    />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {p.title}
                      </Typography>
                      <Chip size="small" label={p.id} sx={{ height: 20, fontSize: 11 }} />
                      {isImported && (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label={t("principlesCatalogue.alreadyExists")}
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      )}
                    </Stack>
                    {p.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {p.description}
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      {p.rationale && (
                        <Box sx={{ flex: 1, minWidth: 220 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight={600}
                            sx={{ display: "block", mb: 0.25 }}
                          >
                            {t("principlesCatalogue.rationale")}
                          </Typography>
                          <BulletList text={p.rationale} />
                        </Box>
                      )}
                      {p.implications && (
                        <Box sx={{ flex: 1, minWidth: 220 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight={600}
                            sx={{ display: "block", mb: 0.25 }}
                          >
                            {t("principlesCatalogue.implications")}
                          </Typography>
                          <BulletList text={p.implications} />
                        </Box>
                      )}
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {selected.size > 0 && (
        <Paper
          elevation={6}
          sx={{
            position: "fixed",
            left: { xs: 8, md: 24 },
            right: { xs: 8, md: 24 },
            bottom: 16,
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 2,
            zIndex: 5,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t("principlesCatalogue.selectedLabel", { count: selected.size })}
          </Typography>
          <Button onClick={clearSelection} size="small">
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => setImportOpen(true)}
            startIcon={<MaterialSymbol icon="download" size={16} />}
          >
            {t("principlesCatalogue.import")}
          </Button>
        </Paper>
      )}

      {/* Import confirmation dialog */}
      <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("principlesCatalogue.importConfirmTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t("principlesCatalogue.importConfirmBody", { count: selected.size })}
          </Typography>
          {importError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {importError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportOpen(false)} disabled={importing}>
            {t("common:actions.cancel")}
          </Button>
          <Button onClick={runImport} variant="contained" disabled={importing}>
            {importing ? <CircularProgress size={18} /> : t("principlesCatalogue.import")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Import result dialog */}
      <Dialog
        open={!!importResult}
        onClose={() => setImportResult(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("principlesCatalogue.importDoneTitle")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t("principlesCatalogue.importDoneBody", {
              created: importResult?.created.length ?? 0,
              skipped: importResult?.skipped.length ?? 0,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImportResult(null)}>{t("common:actions.close")}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setImportResult(null);
              navigate("/admin/metamodel");
            }}
          >
            {t("principlesCatalogue.openPrinciplesAdmin")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
