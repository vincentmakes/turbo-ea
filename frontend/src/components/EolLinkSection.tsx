import { useState, useEffect, useCallback } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { Card, EolProduct, EolCycle } from "@/types";

const EOL_TYPES = ["Application", "ITComponent"];

function isEolEligible(cardTypeKey: string): boolean {
  return EOL_TYPES.includes(cardTypeKey);
}

/** Parse an EOL date-or-boolean field into a readable label + color. */
function formatEolField(
  val: string | boolean | null | undefined
): { label: string; color: string } {
  if (val === true) return { label: "Yes (EOL)", color: "#f44336" };
  if (val === false) return { label: "No", color: "#4caf50" };
  if (typeof val === "string") {
    const d = new Date(val);
    const now = new Date();
    const isPast = d <= now;
    return { label: val, color: isPast ? "#f44336" : "#4caf50" };
  }
  return { label: "Unknown", color: "#9e9e9e" };
}

/** Compute overall status from cycle data. */
function computeEolStatus(cycle: EolCycle): {
  label: string;
  color: string;
  icon: string;
} {
  const eol = cycle.eol;
  if (eol === true)
    return { label: "End of Life", color: "#f44336", icon: "cancel" };
  if (typeof eol === "string") {
    const eolDate = new Date(eol);
    const now = new Date();
    if (eolDate <= now)
      return { label: "End of Life", color: "#f44336", icon: "cancel" };
    // Warn if within 6 months
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    if (eolDate <= sixMonths)
      return {
        label: "Approaching EOL",
        color: "#ff9800",
        icon: "warning",
      };
  }
  // Check active support
  const support = cycle.support;
  if (support === true || support === false || typeof support === "string") {
    if (support === false || (typeof support === "string" && new Date(support) <= new Date())) {
      return {
        label: "Security fixes only",
        color: "#ff9800",
        icon: "shield",
      };
    }
  }
  return { label: "Supported", color: "#4caf50", icon: "check_circle" };
}

// ── Inline EOL Picker (used in both Dialog and Detail page) ─────

interface EolPickerProps {
  onSelect: (product: string, cycle: string) => void;
  onCancel: () => void;
  initialProduct?: string;
}

function EolPicker({ onSelect, onCancel, initialProduct }: EolPickerProps) {
  const [productSearch, setProductSearch] = useState(initialProduct || "");
  const [productOptions, setProductOptions] = useState<EolProduct[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(
    initialProduct || null
  );
  const [cycles, setCycles] = useState<EolCycle[]>([]);
  const [cyclesLoading, setCyclesLoading] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState("");
  const [error, setError] = useState("");

  // Search products
  useEffect(() => {
    if (productSearch.length < 2) {
      setProductOptions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setProductLoading(true);
      try {
        const res = await api.get<EolProduct[]>(
          `/eol/products?search=${encodeURIComponent(productSearch)}`
        );
        setProductOptions(res);
      } catch {
        setProductOptions([]);
      } finally {
        setProductLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  // Fetch cycles when product is selected
  useEffect(() => {
    if (!selectedProduct) {
      setCycles([]);
      setSelectedCycle("");
      return;
    }
    setCyclesLoading(true);
    setError("");
    api
      .get<EolCycle[]>(`/eol/products/${encodeURIComponent(selectedProduct)}`)
      .then((res) => {
        setCycles(res);
        setSelectedCycle("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setCyclesLoading(false));
  }, [selectedProduct]);

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Autocomplete
        freeSolo
        options={productOptions.map((p) => p.name)}
        loading={productLoading}
        inputValue={productSearch}
        onInputChange={(_, val) => {
          setProductSearch(val);
          if (selectedProduct && val !== selectedProduct) {
            setSelectedProduct(null);
          }
        }}
        onChange={(_, val) => {
          if (val) setSelectedProduct(val);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Search product on endoflife.date"
            placeholder="e.g. python, nodejs, postgresql..."
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {productLoading ? (
                    <CircularProgress color="inherit" size={18} />
                  ) : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
        sx={{ mb: 2 }}
      />

      {selectedProduct && cyclesLoading && <LinearProgress sx={{ mb: 2 }} />}

      {selectedProduct && cycles.length > 0 && (
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
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

      {selectedProduct && !cyclesLoading && cycles.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No release cycles found for &quot;{selectedProduct}&quot;.
        </Typography>
      )}

      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!selectedProduct || !selectedCycle}
          onClick={() => onSelect(selectedProduct!, selectedCycle)}
        >
          Link
        </Button>
      </Box>
    </Box>
  );
}

// ── EOL Cycle Details Display ───────────────────────────────────

function EolCycleDetails({ cycle }: { cycle: EolCycle }) {
  const status = computeEolStatus(cycle);
  const eolInfo = formatEolField(cycle.eol);
  const supportInfo = formatEolField(cycle.support);

  return (
    <Box>
      {/* Status badge */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <MaterialSymbol icon={status.icon} size={20} color={status.color} />
        <Chip
          label={status.label}
          sx={{ bgcolor: status.color, color: "#fff", fontWeight: 600 }}
          size="small"
        />
      </Box>

      {/* Details grid */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "160px 1fr" },
          rowGap: 1,
          columnGap: 2,
          alignItems: { sm: "center" },
        }}
      >
        {/* Note: chips use fixed 140px width for visual consistency */}
        {cycle.releaseDate && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              Release Date
            </Typography>
            <Typography variant="body2">{cycle.releaseDate}</Typography>
          </Box>
        )}
        {cycle.latest && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              Latest Version
            </Typography>
            <Typography variant="body2">{cycle.latest}</Typography>
          </Box>
        )}
        {cycle.latestReleaseDate && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              Latest Release
            </Typography>
            <Typography variant="body2">{cycle.latestReleaseDate}</Typography>
          </Box>
        )}
        <Box sx={{ display: "contents" }}>
          <Typography variant="body2" color="text.secondary">
            Active Support
          </Typography>
          <Chip
            size="small"
            label={supportInfo.label}
            sx={{
              width: 180,
              maxWidth: "100%",
              justifyContent: "center",
              bgcolor: supportInfo.color + "20",
              color: supportInfo.color,
              fontWeight: 500,
              height: 22,
              "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
            }}
          />
        </Box>
        <Box sx={{ display: "contents" }}>
          <Typography variant="body2" color="text.secondary">
            End of Life
          </Typography>
          <Chip
            size="small"
            label={eolInfo.label}
            sx={{
              width: 180,
              maxWidth: "100%",
              justifyContent: "center",
              bgcolor: eolInfo.color + "20",
              color: eolInfo.color,
              fontWeight: 500,
              height: 22,
              "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
            }}
          />
        </Box>
        {cycle.lts !== undefined && cycle.lts !== null && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              LTS
            </Typography>
            <Typography variant="body2">
              {cycle.lts === true
                ? "Yes"
                : cycle.lts === false
                  ? "No"
                  : cycle.lts}
            </Typography>
          </Box>
        )}
        {cycle.codename && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              Codename
            </Typography>
            <Typography variant="body2">{cycle.codename}</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ── Main EolLinkSection (for CardDetail) ───────────────────

interface EolLinkSectionProps {
  card: Card;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  initialExpanded?: boolean;
}

export default function EolLinkSection({ card, onSave, initialExpanded }: EolLinkSectionProps) {
  const eolProduct = (card.attributes?.eol_product as string) || "";
  const eolCycle = (card.attributes?.eol_cycle as string) || "";
  const isLinked = !!(eolProduct && eolCycle);

  const [cycleData, setCycleData] = useState<EolCycle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linking, setLinking] = useState(false);

  // Fetch cycle data when linked
  const fetchCycleData = useCallback(async () => {
    if (!eolProduct || !eolCycle) {
      setCycleData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cycles = await api.get<EolCycle[]>(
        `/eol/products/${encodeURIComponent(eolProduct)}`
      );
      const match = cycles.find((c) => String(c.cycle) === String(eolCycle));
      setCycleData(match || null);
      if (!match) setError(`Cycle "${eolCycle}" not found for ${eolProduct}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch EOL data");
    } finally {
      setLoading(false);
    }
  }, [eolProduct, eolCycle]);

  useEffect(() => {
    fetchCycleData();
  }, [fetchCycleData]);

  if (!isEolEligible(card.type)) return null;

  const handleLink = async (product: string, cycle: string) => {
    // Build the attributes update
    const updates: Record<string, unknown> = {
      attributes: {
        ...(card.attributes || {}),
        eol_product: product,
        eol_cycle: cycle,
      },
    };

    // For ITComponent: sync lifecycle dates from EOL data
    if (card.type === "ITComponent") {
      try {
        const cycles = await api.get<EolCycle[]>(
          `/eol/products/${encodeURIComponent(product)}`
        );
        const match = cycles.find((c) => String(c.cycle) === String(cycle));
        if (match) {
          const lifecycle: Record<string, string> = {
            ...(card.lifecycle || {}),
          };
          if (match.releaseDate) lifecycle.active = match.releaseDate;
          if (typeof match.support === "string")
            lifecycle.phaseOut = match.support;
          if (typeof match.eol === "string") lifecycle.endOfLife = match.eol;
          updates.lifecycle = lifecycle;
        }
      } catch {
        // If fetching cycles fails, just link without syncing lifecycle
      }
    }

    await onSave(updates);
    setLinking(false);
  };

  const handleUnlink = async () => {
    const newAttrs = { ...(card.attributes || {}) };
    delete newAttrs.eol_product;
    delete newAttrs.eol_cycle;
    await onSave({ attributes: newAttrs });
    setCycleData(null);
  };

  return (
    <Accordion disableGutters defaultExpanded={initialExpanded ?? isLinked}>
      <AccordionSummary
        expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="update" size={20} color="#666" />
          <Typography fontWeight={600}>End of Life</Typography>
          {isLinked && cycleData && (
            <Chip
              size="small"
              label={computeEolStatus(cycleData).label}
              sx={{
                ml: 1,
                height: 20,
                fontSize: "0.7rem",
                bgcolor: computeEolStatus(cycleData).color,
                color: "#fff",
              }}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {isLinked && !linking ? (
          <Box>
            {/* Linked product header */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 2,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Linked to
              </Typography>
              <Chip
                size="small"
                label={`${eolProduct} ${eolCycle}`}
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
              <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                <IconButton
                  size="small"
                  onClick={fetchCycleData}
                  title="Refresh EOL data"
                >
                  <MaterialSymbol icon="refresh" size={16} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => setLinking(true)}
                  title="Change linked product"
                >
                  <MaterialSymbol icon="edit" size={16} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={handleUnlink}
                  title="Unlink EOL data"
                >
                  <MaterialSymbol icon="link_off" size={16} color="#f44336" />
                </IconButton>
              </Box>
            </Box>

            {loading && <LinearProgress sx={{ mb: 2 }} />}

            {cycleData && <EolCycleDetails cycle={cycleData} />}

            {cycleData?.link && (
              <Box sx={{ mt: 2 }}>
                <Button
                  size="small"
                  href={cycleData.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
                >
                  Release notes
                </Button>
              </Box>
            )}
          </Box>
        ) : linking || !isLinked ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Link this {card.type === "ITComponent" ? "IT component" : "application"} to
              a product on endoflife.date to track its support lifecycle.
              {card.type === "ITComponent"
                ? " Lifecycle dates will be synced automatically."
                : ""}
            </Typography>
            <EolPicker
              onSelect={handleLink}
              onCancel={() => setLinking(false)}
              initialProduct={eolProduct}
            />
          </Box>
        ) : null}
      </AccordionDetails>
    </Accordion>
  );
}

// ── EOL Picker Dialog (for CreateCardDialog) ───────────────

interface EolLinkDialogProps {
  open: boolean;
  onClose: () => void;
  onLink: (product: string, cycle: string) => void;
  initialProduct?: string;
}

export function EolLinkDialog({ open, onClose, onLink, initialProduct }: EolLinkDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Link End-of-Life Data</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          Search for a product on endoflife.date and select the version you are
          using to track its support lifecycle.
        </Typography>
        <EolPicker
          onSelect={(product, cycle) => {
            onLink(product, cycle);
            onClose();
          }}
          onCancel={onClose}
          initialProduct={initialProduct}
        />
      </DialogContent>
      <DialogActions />
    </Dialog>
  );
}
