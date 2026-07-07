import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import { STATUS_COLORS } from "@/theme/tokens";
import type { Card, EolProduct, EolCycle, EolProductMatch } from "@/types";

const EOL_TYPES = ["Application", "ITComponent"];

function isEolEligible(cardTypeKey: string): boolean {
  return EOL_TYPES.includes(cardTypeKey);
}

/** Parse an EOL date-or-boolean field into a label key (or date string) + color. */
function formatEolField(
  val: string | boolean | null | undefined,
  t: (key: string) => string,
): { label: string; color: string } {
  if (val === true) return { label: t("eol.status.yesEol"), color: STATUS_COLORS.error };
  if (val === false) return { label: t("common:labels.no"), color: STATUS_COLORS.success };
  if (typeof val === "string") {
    const d = new Date(val);
    const now = new Date();
    const isPast = d <= now;
    return { label: val, color: isPast ? STATUS_COLORS.error : STATUS_COLORS.success };
  }
  return { label: t("eol.status.unknown"), color: STATUS_COLORS.neutral };
}

/** Compute overall status from cycle data. */
function computeEolStatus(
  cycle: EolCycle,
  t: (key: string) => string,
): {
  label: string;
  color: string;
  icon: string;
} {
  const eol = cycle.eol;
  if (eol === true)
    return { label: t("eol.status.endOfLife"), color: STATUS_COLORS.error, icon: "cancel" };
  if (typeof eol === "string") {
    const eolDate = new Date(eol);
    const now = new Date();
    if (eolDate <= now)
      return { label: t("eol.status.endOfLife"), color: STATUS_COLORS.error, icon: "cancel" };
    // Warn if within 6 months
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    if (eolDate <= sixMonths)
      return {
        label: t("eol.status.approachingEol"),
        color: STATUS_COLORS.warning,
        icon: "warning",
      };
  }
  // Check active support
  const support = cycle.support;
  if (support === true || support === false || typeof support === "string") {
    if (support === false || (typeof support === "string" && new Date(support) <= new Date())) {
      return {
        label: t("eol.status.securityOnly"),
        color: STATUS_COLORS.warning,
        icon: "shield",
      };
    }
  }
  return { label: t("eol.status.supported"), color: STATUS_COLORS.success, icon: "check_circle" };
}

// ── Inline EOL Picker (used in both Dialog and Detail page) ─────

interface EolPickerProps {
  onSelect: (product: string, cycle: string) => void;
  onCancel: () => void;
  initialProduct?: string;
  resetKey?: number;
  cardName?: string;
}

function EolPicker({ onSelect, onCancel, initialProduct, resetKey, cardName }: EolPickerProps) {
  const { t } = useTranslation(["cards", "common"]);
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
  const [eolSuggestions, setEolSuggestions] = useState<EolProductMatch[]>([]);
  const [eolSearching, setEolSearching] = useState(false);
  const [eolAutoSearchDone, setEolAutoSearchDone] = useState(false);

  // Reset all fields when resetKey changes
  useEffect(() => {
    setProductSearch(initialProduct || "");
    setSelectedProduct(initialProduct || null);
    setProductOptions([]);
    setCycles([]);
    setSelectedCycle("");
    setError("");
    setEolSuggestions([]);
    setEolAutoSearchDone(false);
  }, [resetKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fuzzy-search using card name (mirrors CreateCardDialog pattern)
  useEffect(() => {
    const trimmed = (cardName || "").trim();
    if (!trimmed || trimmed.length < 2 || selectedProduct) {
      setEolSuggestions([]);
      setEolAutoSearchDone(false);
      return;
    }
    if (productSearch && productSearch !== trimmed) return;
    const timer = setTimeout(async () => {
      setEolSearching(true);
      try {
        const res = await api.get<EolProductMatch[]>(
          `/eol/products/fuzzy?search=${encodeURIComponent(trimmed)}&limit=5`,
        );
        setEolSuggestions(res);
        setEolAutoSearchDone(true);
      } catch {
        setEolSuggestions([]);
        setEolAutoSearchDone(true);
      } finally {
        setEolSearching(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [cardName, productSearch, selectedProduct]);

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
            label={t("eol.searchProduct")}
            placeholder={t("eol.searchPlaceholder")}
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
        sx={{ mb: 1 }}
      />

      {eolSearching && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress sx={{ mb: 0.5, borderRadius: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {t("eol.searching", { name: (cardName || "").trim() })}
          </Typography>
        </Box>
      )}

      {!eolSearching && eolAutoSearchDone && eolSuggestions.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.5 }}
          >
            {t("eol.suggestedMatches")}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {eolSuggestions.map((s) => (
              <Chip
                key={s.name}
                label={s.name}
                size="small"
                variant="outlined"
                onClick={() => {
                  setProductSearch(s.name);
                  setSelectedProduct(s.name);
                }}
                icon={<MaterialSymbol icon="link" size={14} />}
                sx={{
                  cursor: "pointer",
                  borderColor: s.score >= 0.7 ? "success.main" : "divider",
                  fontWeight: s.score >= 0.7 ? 600 : 400,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              />
            ))}
          </Box>
        </Box>
      )}

      {!eolSearching && eolAutoSearchDone && eolSuggestions.length === 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 0.5, mb: 2, display: "block" }}
        >
          {t("eol.noMatches")}
        </Typography>
      )}

      {selectedProduct && cyclesLoading && <LinearProgress sx={{ mb: 2 }} />}

      {selectedProduct && cycles.length > 0 && (
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>{t("eol.versionCycle")}</InputLabel>
          <Select
            value={selectedCycle}
            label={t("eol.versionCycle")}
            onChange={(e) => setSelectedCycle(e.target.value)}
          >
            {cycles.map((c) => {
              const status = computeEolStatus(c, t);
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
                        ({t("eol.latest", { version: c.latest })})
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
          {t("eol.noCycles", { product: selectedProduct })}
        </Typography>
      )}

      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
        <Button size="small" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!selectedProduct || !selectedCycle}
          onClick={() => onSelect(selectedProduct!, selectedCycle)}
        >
          {t("common:actions.link")}
        </Button>
      </Box>
    </Box>
  );
}

// ── EOL Cycle Details Display ───────────────────────────────────

function EolCycleDetails({ cycle }: { cycle: EolCycle }) {
  const { t } = useTranslation(["cards", "common"]);
  const status = computeEolStatus(cycle, t);
  const eolInfo = formatEolField(cycle.eol, t);
  const supportInfo = formatEolField(cycle.support, t);

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
              {t("eol.releaseDate")}
            </Typography>
            <Typography variant="body2">{cycle.releaseDate}</Typography>
          </Box>
        )}
        {cycle.latest && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              {t("eol.latestVersion")}
            </Typography>
            <Typography variant="body2">{cycle.latest}</Typography>
          </Box>
        )}
        {cycle.latestReleaseDate && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              {t("eol.latestRelease")}
            </Typography>
            <Typography variant="body2">{cycle.latestReleaseDate}</Typography>
          </Box>
        )}
        <Box sx={{ display: "contents" }}>
          <Typography variant="body2" color="text.secondary">
            {t("eol.activeSupport")}
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
            {t("eol.endOfLife")}
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
              {t("eol.lts")}
            </Typography>
            <Typography variant="body2">
              {cycle.lts === true
                ? t("common:labels.yes")
                : cycle.lts === false
                  ? t("common:labels.no")
                  : cycle.lts}
            </Typography>
          </Box>
        )}
        {cycle.codename && (
          <Box sx={{ display: "contents" }}>
            <Typography variant="body2" color="text.secondary">
              {t("eol.codename")}
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
  const { t } = useTranslation(["cards", "common"]);
  const eolProduct = (card.attributes?.eol_product as string) || "";
  const eolCycle = (card.attributes?.eol_cycle as string) || "";
  const isLinked = !!(eolProduct && eolCycle);

  const [cycleData, setCycleData] = useState<EolCycle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [linking, setLinking] = useState(false);
  const [pickerResetKey, setPickerResetKey] = useState(0);

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
    // Record the EOL product/cycle association only. Lifecycle phase dates
    // (including End of Life, which represents the decommission date) are
    // manually owned and must never be auto-filled from vendor EOL data.
    const updates: Record<string, unknown> = {
      attributes: {
        ...(card.attributes || {}),
        eol_product: product,
        eol_cycle: cycle,
      },
    };

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
          <Typography fontWeight={600}>{t("eol.title")}</Typography>
          {isLinked && cycleData && (
            <Chip
              size="small"
              label={computeEolStatus(cycleData, t).label}
              sx={{
                ml: 1,
                height: 20,
                fontSize: "0.7rem",
                bgcolor: computeEolStatus(cycleData, t).color,
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
                {t("eol.linkedTo")}
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
                  title={t("eol.refreshTooltip")}
                >
                  <MaterialSymbol icon="refresh" size={16} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => setLinking(true)}
                  title={t("eol.changeTooltip")}
                >
                  <MaterialSymbol icon="edit" size={16} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={handleUnlink}
                  title={t("eol.unlinkTooltip")}
                >
                  <MaterialSymbol icon="link_off" size={16} color={STATUS_COLORS.error} />
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
                  {t("eol.releaseNotes")}
                </Button>
              </Box>
            )}
          </Box>
        ) : linking || !isLinked ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {card.type === "ITComponent"
                ? t("eol.linkDescription.itComponent")
                : t("eol.linkDescription.application")}
            </Typography>
            <EolPicker
              onSelect={handleLink}
              onCancel={() => {
                setLinking(false);
                setPickerResetKey((k) => k + 1);
              }}
              initialProduct={eolProduct}
              resetKey={pickerResetKey}
              cardName={card.name}
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
  cardName?: string;
}

export function EolLinkDialog({
  open,
  onClose,
  onLink,
  initialProduct,
  cardName,
}: EolLinkDialogProps) {
  const { t } = useTranslation("cards");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("eol.linkDialog.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          {t("eol.linkDialog.description")}
        </Typography>
        <EolPicker
          onSelect={(product, cycle) => {
            onLink(product, cycle);
            onClose();
          }}
          onCancel={onClose}
          initialProduct={initialProduct}
          cardName={cardName}
        />
      </DialogContent>
      <DialogActions />
    </Dialog>
  );
}
