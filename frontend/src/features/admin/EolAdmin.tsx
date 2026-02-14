import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { MassEolResult, EolCycle } from "@/types";

type LinkSelection = Record<
  string,
  { product: string; cycle: string } | null
>;

function computeEolStatus(cycle: EolCycle): {
  label: string;
  color: string;
} {
  const eol = cycle.eol;
  if (eol === true) return { label: "End of Life", color: "#f44336" };
  if (typeof eol === "string") {
    const eolDate = new Date(eol);
    const now = new Date();
    if (eolDate <= now) return { label: "End of Life", color: "#f44336" };
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    if (eolDate <= sixMonths)
      return { label: "Approaching EOL", color: "#ff9800" };
  }
  return { label: "Supported", color: "#4caf50" };
}

// ── Cycle Picker Dialog ──────────────────────────────────────────

interface CyclePickerProps {
  open: boolean;
  onClose: () => void;
  factSheetId: string;
  factSheetName: string;
  product: string;
  onSelect: (fsId: string, product: string, cycle: string) => void;
}

function CyclePickerDialog({
  open,
  onClose,
  factSheetId,
  factSheetName,
  product,
  onSelect,
}: CyclePickerProps) {
  const [cycles, setCycles] = useState<EolCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedCycle, setSelectedCycle] = useState("");

  useEffect(() => {
    if (!open || !product) return;
    setLoading(true);
    setError("");
    setSelectedCycle("");
    api
      .get<EolCycle[]>(`/eol/products/${encodeURIComponent(product)}`)
      .then((res) => setCycles(res))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to fetch cycles"))
      .finally(() => setLoading(false));
  }, [open, product]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Select Version for {factSheetName}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          Product: <strong>{product}</strong>. Select the version/cycle that matches
          your deployment.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        {!loading && cycles.length > 0 && (
          <FormControl fullWidth size="small">
            <InputLabel>Version / Cycle</InputLabel>
            <Select
              value={selectedCycle}
              label="Version / Cycle"
              onChange={(e) => setSelectedCycle(e.target.value)}
            >
              {cycles.map((c) => {
                const status = computeEolStatus(c);
                return (
                  <MenuItem key={c.cycle} value={c.cycle}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        width: "100%",
                      }}
                    >
                      <Typography variant="body2" fontWeight={500}>
                        {c.cycle}
                      </Typography>
                      {c.latest && (
                        <Typography variant="caption" color="text.secondary">
                          (latest: {c.latest})
                        </Typography>
                      )}
                      <Box sx={{ ml: "auto" }}>
                        <Chip
                          size="small"
                          label={status.label}
                          sx={{
                            bgcolor: status.color,
                            color: "#fff",
                            height: 20,
                            fontSize: "0.65rem",
                          }}
                        />
                      </Box>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        )}
        {!loading && cycles.length === 0 && !error && (
          <Typography variant="body2" color="text.secondary">
            No release cycles found for "{product}".
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!selectedCycle}
          onClick={() => {
            onSelect(factSheetId, product, selectedCycle);
            onClose();
          }}
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Admin Page ──────────────────────────────────────────────

export default function EolAdmin() {
  const [typeKey, setTypeKey] = useState<"Application" | "ITComponent">("ITComponent");
  const [results, setResults] = useState<MassEolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selections, setSelections] = useState<LinkSelection>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ count: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "unlinked" | "linked">("all");

  // Cycle picker dialog
  const [cyclePickerOpen, setCyclePickerOpen] = useState(false);
  const [cyclePickerFsId, setCyclePickerFsId] = useState("");
  const [cyclePickerFsName, setCyclePickerFsName] = useState("");
  const [cyclePickerProduct, setCyclePickerProduct] = useState("");

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelections({});
    setSaveResult(null);
    try {
      const res = await api.post<MassEolResult[]>(
        `/eol/mass-search?type_key=${encodeURIComponent(typeKey)}`
      );
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to search");
    } finally {
      setLoading(false);
    }
  }, [typeKey]);

  const openCyclePicker = (fsId: string, fsName: string, product: string) => {
    setCyclePickerFsId(fsId);
    setCyclePickerFsName(fsName);
    setCyclePickerProduct(product);
    setCyclePickerOpen(true);
  };

  const handleCycleSelected = (fsId: string, product: string, cycle: string) => {
    setSelections((prev) => ({
      ...prev,
      [fsId]: { product, cycle },
    }));
  };

  const handleRemoveSelection = (fsId: string) => {
    setSelections((prev) => {
      const next = { ...prev };
      delete next[fsId];
      return next;
    });
  };

  const handleSave = async () => {
    const links = Object.entries(selections)
      .filter(([, sel]) => sel !== null)
      .map(([fsId, sel]) => ({
        fact_sheet_id: fsId,
        eol_product: sel!.product,
        eol_cycle: sel!.cycle,
      }));

    if (links.length === 0) return;

    setSaving(true);
    setError("");
    try {
      const res = await api.post<{ count: number; updated: string[] }>(
        "/eol/mass-link",
        links
      );
      setSaveResult({ count: res.count });
      // Refresh results
      await handleSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const filteredResults = results.filter((r) => {
    if (filter === "unlinked") return !r.current_eol_product;
    if (filter === "linked") return !!r.current_eol_product;
    return true;
  });

  const selectedCount = Object.keys(selections).length;
  const unlinkedCount = results.filter((r) => !r.current_eol_product).length;
  const linkedCount = results.filter((r) => !!r.current_eol_product).length;
  const withCandidatesCount = results.filter(
    (r) => !r.current_eol_product && r.candidates.length > 0
  ).length;

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto" }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
        Mass EOL Search
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Automatically find End-of-Life data for your IT Components and
        Applications by fuzzy-matching their names against endoflife.date.
        Select a product match, choose the version, and bulk-link them.
      </Typography>

      {/* Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", gap: 2, alignItems: "flex-end", flexWrap: "wrap" }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Fact Sheet Type</InputLabel>
              <Select
                value={typeKey}
                label="Fact Sheet Type"
                onChange={(e) =>
                  setTypeKey(e.target.value as "Application" | "ITComponent")
                }
              >
                <MenuItem value="ITComponent">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon="memory" size={18} color="#d29270" />
                    IT Component
                  </Box>
                </MenuItem>
                <MenuItem value="Application">
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon="apps" size={18} color="#0f7eb5" />
                    Application
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              onClick={handleSearch}
              disabled={loading}
              startIcon={
                loading ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <MaterialSymbol icon="search" size={18} />
                )
              }
            >
              {loading ? "Searching..." : "Search EOL Data"}
            </Button>
            {results.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Filter</InputLabel>
                <Select
                  value={filter}
                  label="Filter"
                  onChange={(e) =>
                    setFilter(e.target.value as "all" | "unlinked" | "linked")
                  }
                >
                  <MenuItem value="all">All ({results.length})</MenuItem>
                  <MenuItem value="unlinked">
                    Unlinked ({unlinkedCount})
                  </MenuItem>
                  <MenuItem value="linked">Linked ({linkedCount})</MenuItem>
                </Select>
              </FormControl>
            )}
          </Box>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {saveResult && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaveResult(null)}>
          Successfully linked {saveResult.count} fact sheet(s) to EOL data.
        </Alert>
      )}

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Summary stats */}
      {results.length > 0 && !loading && (
        <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
          <Card sx={{ flex: 1, minWidth: 140 }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">
                Total
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                {results.length}
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1, minWidth: 140 }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">
                Already Linked
              </Typography>
              <Typography variant="h6" fontWeight={700} color="success.main">
                {linkedCount}
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1, minWidth: 140 }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">
                Unlinked
              </Typography>
              <Typography variant="h6" fontWeight={700} color="warning.main">
                {unlinkedCount}
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1, minWidth: 140 }}>
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">
                Matches Found
              </Typography>
              <Typography variant="h6" fontWeight={700} color="info.main">
                {withCandidatesCount}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Results list */}
      {filteredResults.map((r) => {
        const selection = selections[r.fact_sheet_id];
        const isAlreadyLinked = !!r.current_eol_product;

        return (
          <Card
            key={r.fact_sheet_id}
            sx={{
              mb: 1.5,
              borderLeft: 4,
              borderColor: selection
                ? "success.main"
                : isAlreadyLinked
                  ? "info.main"
                  : r.candidates.length > 0
                    ? "warning.main"
                    : "divider",
            }}
          >
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 2,
                  flexWrap: "wrap",
                }}
              >
                {/* Fact sheet info */}
                <Box sx={{ minWidth: 200, flex: "0 0 auto" }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {r.fact_sheet_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {r.fact_sheet_type}
                  </Typography>
                  {isAlreadyLinked && (
                    <Box sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 0.5 }}>
                      <MaterialSymbol icon="check_circle" size={14} color="#4caf50" />
                      <Typography variant="caption" color="success.main">
                        {r.current_eol_product} {r.current_eol_cycle}
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Current selection or candidates */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {selection ? (
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        p: 1,
                        bgcolor: "rgba(76, 175, 80, 0.06)",
                        borderRadius: 1,
                      }}
                    >
                      <MaterialSymbol icon="check_circle" size={18} color="#4caf50" />
                      <Typography variant="body2">
                        Will link to{" "}
                        <strong>
                          {selection.product} {selection.cycle}
                        </strong>
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveSelection(r.fact_sheet_id)}
                        sx={{ ml: "auto" }}
                      >
                        <MaterialSymbol icon="close" size={16} />
                      </IconButton>
                    </Box>
                  ) : r.candidates.length > 0 ? (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}
                      >
                        Suggested matches:
                      </Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {r.candidates.map((c) => (
                          <Tooltip
                            key={c.eol_product}
                            title={`Match score: ${Math.round(c.score * 100)}% — Click to select version`}
                          >
                            <Chip
                              label={c.eol_product}
                              size="small"
                              variant="outlined"
                              onClick={() =>
                                openCyclePicker(
                                  r.fact_sheet_id,
                                  r.fact_sheet_name,
                                  c.eol_product
                                )
                              }
                              icon={<MaterialSymbol icon="link" size={14} />}
                              sx={{
                                cursor: "pointer",
                                borderColor:
                                  c.score >= 0.7 ? "success.main" : "divider",
                                fontWeight: c.score >= 0.7 ? 600 : 400,
                                "&:hover": { bgcolor: "action.hover" },
                              }}
                            />
                          </Tooltip>
                        ))}
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No matches found on endoflife.date
                    </Typography>
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>
        );
      })}

      {/* No results */}
      {!loading && results.length === 0 && (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="search" size={48} color="#ccc" />
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
              Click "Search EOL Data" to scan your{" "}
              {typeKey === "ITComponent" ? "IT Components" : "Applications"} against
              endoflife.date
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Floating action bar */}
      {selectedCount > 0 && (
        <Box
          sx={{
            position: "sticky",
            bottom: 16,
            mt: 2,
            p: 2,
            bgcolor: "background.paper",
            borderRadius: 2,
            boxShadow: 6,
            display: "flex",
            alignItems: "center",
            gap: 2,
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <MaterialSymbol icon="link" size={20} color="#1976d2" />
          <Typography variant="body2" fontWeight={600}>
            {selectedCount} fact sheet(s) selected for EOL linking
          </Typography>
          <Box sx={{ ml: "auto", display: "flex", gap: 1 }}>
            <Button
              size="small"
              onClick={() => setSelections({})}
            >
              Clear All
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleSave}
              disabled={saving}
              startIcon={
                saving ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <MaterialSymbol icon="save" size={16} />
                )
              }
            >
              {saving ? "Saving..." : "Apply Links"}
            </Button>
          </Box>
        </Box>
      )}

      {/* Cycle picker dialog */}
      <CyclePickerDialog
        open={cyclePickerOpen}
        onClose={() => setCyclePickerOpen(false)}
        factSheetId={cyclePickerFsId}
        factSheetName={cyclePickerFsName}
        product={cyclePickerProduct}
        onSelect={handleCycleSelected}
      />
    </Box>
  );
}
