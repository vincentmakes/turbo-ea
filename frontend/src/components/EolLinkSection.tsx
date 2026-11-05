import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import Link from "@mui/material/Link";
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
import { useSyncedExpanded } from "@/hooks/useSyncedExpanded";
import { api } from "@/api/client";
import { useAbortableEffect, useLatestRequest } from "@/hooks/useLatestRequest";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { STATUS_COLORS } from "@/theme/tokens";
import { toLocalDate } from "@/lib/dates";
import { EOL_STATUS_COLORS, typeKeyTracksEol } from "@/lib/eol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { cycleStatus, customEolKey, eolProductLabel, isCustomEolProduct } from "@/lib/eolCustom";
import { hasPermission } from "@/components/RequirePermission";
import CustomEolProductDialog, { CustomEolCycleDialog } from "@/components/CustomEolProductDialog";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import type { Card, EolProduct, EolCycle, EolProductMatch } from "@/types";
import { useTheme } from "@mui/material/styles";


/** Parse an EOL date-or-boolean field into a label key (or date string) + color. */
function formatEolField(
  val: string | boolean | null | undefined,
  t: (key: string) => string,
): { label: string; color: string } {
  if (val === true) return { label: t("eol.status.yesEol"), color: STATUS_COLORS.error };
  if (val === false) return { label: t("common:labels.no"), color: STATUS_COLORS.success };
  if (typeof val === "string") {
    const d = toLocalDate(val);
    const isPast = !!d && d <= new Date();
    return { label: val, color: isPast ? STATUS_COLORS.error : STATUS_COLORS.success };
  }
  return { label: t("eol.status.unknown"), color: STATUS_COLORS.neutral };
}

/**
 * Active support reads the other way round from EOL: `true` means the cycle is
 * still supported, `false` that support has ended. A date means the same in
 * both (past = ended), so it falls through to `formatEolField`.
 */
function formatSupportField(
  val: string | boolean | null | undefined,
  t: (key: string) => string,
): { label: string; color: string } {
  if (val === true) return { label: t("common:labels.yes"), color: STATUS_COLORS.success };
  if (val === false) return { label: t("common:labels.no"), color: STATUS_COLORS.error };
  return formatEolField(val, t);
}

/**
 * The card's status chip, by the one rule every other EOL surface uses
 * (`cycleStatus`, mirroring the backend): a card and the EOL report must
 * never disagree about the same cycle.
 */
function computeEolStatus(
  cycle: EolCycle,
  t: (key: string) => string,
): { label: string; color: string; icon: string } {
  switch (cycleStatus(cycle.eol, cycle.support)) {
    case "eol":
      return { label: t("eol.status.endOfLife"), color: EOL_STATUS_COLORS.eol, icon: "cancel" };
    case "approaching":
      return {
        label: t("eol.status.approachingEol"),
        color: EOL_STATUS_COLORS.approaching,
        icon: "warning",
      };
    case "supported":
      return {
        label: t("eol.status.supported"),
        color: EOL_STATUS_COLORS.supported,
        icon: "check_circle",
      };
    default:
      return { label: t("eol.status.unknown"), color: EOL_STATUS_COLORS.unknown, icon: "help" };
  }
}

// ── Inline EOL Picker (used in both Dialog and Detail page) ─────

interface EolPickerProps {
  onSelect: (product: string, cycle: string) => void;
  onCancel: () => void;
  initialProduct?: string;
  /** The linked custom product's title, so the search opens on its name. */
  initialTitle?: string | null;
  resetKey?: number;
  cardName?: string;
}

/**
 * A fuzzy suggestion this close is a real match — highlighted in the list,
 * and enough to hold back the offer to create a custom product. Fuzzy search
 * always returns *something*, so "no suggestions" alone would never fire.
 */
const STRONG_MATCH = 0.7;

/** A Select value that is not a cycle: opens the add-cycle dialog. */
const ADD_CYCLE = "__add_cycle__";

/** Settings → EOL → Custom products, for an EOL manager. */
const CUSTOM_PRODUCTS_SETTINGS_PATH = "/admin/settings?tab=eol&eolTab=custom";

/** "Custom" marker beside a custom EOL product's name. */
function CustomChip() {
  const { t } = useTranslation("cards");
  return (
    <Chip
      size="small"
      variant="outlined"
      label={t("eol.custom.badge")}
      icon={<MaterialSymbol icon="edit_note" size={14} />}
      sx={{ height: 20, fontSize: "0.65rem" }}
    />
  );
}

function EolPicker({
  onSelect,
  onCancel,
  initialProduct,
  initialTitle,
  resetKey,
  cardName,
}: EolPickerProps) {
  const { t } = useTranslation(["cards", "common"]);
  const user = useOptionalAuthUser();
  // Defining a product the whole landscape can link to is EOL management,
  // not card editing — the same grant the admin catalogue requires.
  const canManage = hasPermission(user?.permissions, "eol.manage");
  const [productSearch, setProductSearch] = useState(
    initialProduct ? eolProductLabel(initialProduct, initialTitle) : "",
  );
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
  // A search that failed (endoflife.date unreachable) says nothing about
  // whether it tracks the product, so neither may prompt "define it here".
  const [suggestFailed, setSuggestFailed] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [addCycleOpen, setAddCycleOpen] = useState(false);
  const [cyclesRev, setCyclesRev] = useState(0);
  // The cycle to select once the product's cycles arrive — set after a
  // product or cycle is created here, so the user lands on what they made.
  const pendingCycleRef = useRef<string | null>(null);
  // Custom products are named by their title, which only the search knows.
  const [knownTitles, setKnownTitles] = useState<Record<string, string>>(
    initialProduct && initialTitle ? { [initialProduct]: initialTitle } : {},
  );
  const labelOf = useCallback(
    (name: string) => eolProductLabel(name, knownTitles[name]),
    [knownTitles],
  );
  const rememberTitles = useCallback((items: { name: string; title?: string | null }[]) => {
    const titled = items.filter((p) => p.title);
    if (titled.length === 0) return;
    setKnownTitles((prev) => {
      const next = { ...prev };
      for (const p of titled) next[p.name] = p.title as string;
      return next;
    });
  }, []);
  const customNames = useMemo(
    () => new Set(productOptions.filter((p) => p.custom).map((p) => p.name)),
    [productOptions],
  );

  // Reset all fields when resetKey changes
  useEffect(() => {
    setProductSearch(initialProduct ? eolProductLabel(initialProduct, initialTitle) : "");
    setSelectedProduct(initialProduct || null);
    setProductOptions([]);
    setCycles([]);
    setSelectedCycle("");
    setError("");
    setEolSuggestions([]);
    setEolAutoSearchDone(false);
    setSuggestFailed(false);
    setSearchFailed(false);
  }, [resetKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fuzzy-search using card name (mirrors CreateCardDialog pattern)
  const [debouncedCardName] = useDebouncedValue(cardName, 600);
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      const trimmed = (debouncedCardName || "").trim();
      if (!trimmed || trimmed.length < 2 || selectedProduct) {
        setEolSuggestions([]);
        setEolAutoSearchDone(false);
        setEolSearching(false);
        setSuggestFailed(false);
        return;
      }
      if (productSearch && productSearch !== trimmed) return;
      setEolSearching(true);
      try {
        const res = await api.get<EolProductMatch[]>(
          `/eol/products/fuzzy?search=${encodeURIComponent(trimmed)}&limit=5`,
          { signal },
        );
        if (!isCurrent()) return;
        setEolSuggestions(res);
        rememberTitles(res);
        setSuggestFailed(false);
        setEolAutoSearchDone(true);
      } catch {
        if (!isCurrent()) return;
        setEolSuggestions([]);
        setSuggestFailed(true);
        setEolAutoSearchDone(true);
      } finally {
        if (isCurrent()) setEolSearching(false);
      }
    },
    [debouncedCardName, productSearch, selectedProduct],
  );

  // Search products. The timer was cancelled on each keystroke but a dispatched
  // request was not, so a stale response could replace newer options (#882).
  const [debouncedProductSearch] = useDebouncedValue(productSearch, 300);
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (debouncedProductSearch.length < 2) {
        setProductOptions([]);
        setProductLoading(false);
        setSearchFailed(false);
        return;
      }
      setProductLoading(true);
      try {
        const res = await api.get<EolProduct[]>(
          `/eol/products?search=${encodeURIComponent(debouncedProductSearch)}`,
          { signal },
        );
        if (!isCurrent()) return;
        setProductOptions(res);
        rememberTitles(res);
        setSearchFailed(false);
      } catch {
        if (!isCurrent()) return;
        setProductOptions([]);
        setSearchFailed(true);
      } finally {
        if (isCurrent()) setProductLoading(false);
      }
    },
    [debouncedProductSearch],
  );

  // Fetch cycles when product is selected. Picking another product while a
  // slow reply is in flight must not let that reply land on the new product.
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      if (!selectedProduct) {
        setCycles([]);
        setSelectedCycle("");
        setCyclesLoading(false);
        return;
      }
      setCyclesLoading(true);
      setError("");
      try {
        const res = await api.get<EolCycle[]>(
          `/eol/products/${encodeURIComponent(selectedProduct)}`,
          { signal },
        );
        if (!isCurrent()) return;
        setCycles(res);
        const pending = pendingCycleRef.current;
        pendingCycleRef.current = null;
        setSelectedCycle(pending && res.some((c) => c.cycle === pending) ? pending : "");
      } catch (e) {
        if (!isCurrent()) return;
        setCycles([]);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (isCurrent()) setCyclesLoading(false);
      }
    },
    [selectedProduct, cyclesRev],
  );

  const selectedIsCustom = isCustomEolProduct(selectedProduct);
  // Nothing on endoflife.date for what was typed (or, before anything was
  // typed, for the card's own name) — only once the search has settled, so
  // the hint never flashes mid-typing. It gates the hint for a user who
  // cannot define products; an EOL manager's link is there whenever nothing
  // is selected, because a strong but wrong upstream match must not hide it.
  const typed = productSearch.trim();
  const searchSettled = debouncedProductSearch === productSearch && !productLoading;
  const noUpstreamForTyped =
    typed.length >= 2 &&
    searchSettled &&
    !searchFailed &&
    !productOptions.some((p) => !p.custom);
  const noUpstreamForCard =
    !typed &&
    eolAutoSearchDone &&
    !eolSearching &&
    !suggestFailed &&
    // Any strong match, custom included: a strong custom one already exists.
    !eolSuggestions.some((s) => s.score >= STRONG_MATCH);
  const noUpstream = noUpstreamForTyped || noUpstreamForCard;
  // The name the create form opens with: what was typed, else the card's.
  const createFrom = typed || (cardName || "").trim();

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
        getOptionLabel={(name) => labelOf(name)}
        renderOption={(props, name) => {
          const { key, ...rest } = props as typeof props & { key: string };
          return (
            <li key={key} {...rest}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                <span>{labelOf(name)}</span>
                {customNames.has(name) && (
                  <Box sx={{ ml: "auto" }}>
                    <CustomChip />
                  </Box>
                )}
              </Box>
            </li>
          );
        }}
        loading={productLoading}
        inputValue={productSearch}
        onInputChange={(_, val) => {
          setProductSearch(val);
          if (selectedProduct && val !== labelOf(selectedProduct)) {
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

      {!selectedProduct && (canManage || noUpstream) && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 2 }}
        >
          {t("eol.custom.notOnEolDate")}{" "}
          {canManage ? (
            <Link
              component="button"
              type="button"
              variant="caption"
              onClick={() => setCreateOpen(true)}
            >
              {t("eol.custom.createAction")}
            </Link>
          ) : (
            t("eol.custom.askManager")
          )}
        </Typography>
      )}

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
                label={labelOf(s.name)}
                size="small"
                variant="outlined"
                onClick={() => {
                  setProductSearch(labelOf(s.name));
                  setSelectedProduct(s.name);
                }}
                icon={<MaterialSymbol icon={s.custom ? "edit_note" : "link"} size={14} />}
                sx={{
                  cursor: "pointer",
                  borderColor: s.score >= STRONG_MATCH ? "success.main" : "divider",
                  fontWeight: s.score >= STRONG_MATCH ? 600 : 400,
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
            onChange={(e) => {
              if (e.target.value === ADD_CYCLE) setAddCycleOpen(true);
              else setSelectedCycle(e.target.value);
            }}
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
                          color: "common.white",
                          height: 20,
                          fontSize: "0.65rem",
                        }}
                      />
                    </Box>
                  </Box>
                </MenuItem>
              );
            })}
            {selectedIsCustom && canManage && (
              <MenuItem value={ADD_CYCLE}>
                <MaterialSymbol icon="add" size={16} />
                <Typography variant="body2" sx={{ ml: 1 }}>
                  {t("eol.custom.addCycleOption")}
                </Typography>
              </MenuItem>
            )}
          </Select>
        </FormControl>
      )}

      {selectedProduct && !cyclesLoading && cycles.length === 0 && !error && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t("eol.noCycles", { product: labelOf(selectedProduct) })}
          </Typography>
          {selectedIsCustom && canManage && (
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={() => setAddCycleOpen(true)}
            >
              {t("eol.custom.addCycleOption")}
            </Button>
          )}
          {selectedIsCustom && !canManage && (
            <Typography variant="caption" color="text.secondary">
              {t("eol.custom.askManagerCycle")}
            </Typography>
          )}
        </Box>
      )}

      <CustomEolProductDialog
        open={createOpen}
        initialTitle={createFrom}
        onClose={() => setCreateOpen(false)}
        onSaved={(product) => {
          setCreateOpen(false);
          rememberTitles([{ name: product.product, title: product.title }]);
          setProductOptions((prev) => [
            { name: product.product, title: product.title, custom: true },
            ...prev.filter((p) => p.name !== product.product),
          ]);
          // Land on the cycle the user just described (the newest first).
          pendingCycleRef.current = product.cycles[0]?.cycle ?? null;
          setProductSearch(product.title);
          setSelectedProduct(product.product);
        }}
      />
      {selectedProduct && selectedIsCustom && (
        <CustomEolCycleDialog
          open={addCycleOpen}
          productKey={customEolKey(selectedProduct)}
          productLabel={labelOf(selectedProduct)}
          onClose={() => setAddCycleOpen(false)}
          onSaved={(cycle) => {
            setAddCycleOpen(false);
            pendingCycleRef.current = cycle.cycle;
            setCyclesRev((r) => r + 1);
          }}
        />
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
  const supportInfo = formatSupportField(cycle.support, t);

  return (
    <Box>
      {/* Status badge */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <MaterialSymbol icon={status.icon} size={20} color={status.color} />
        <Chip
          label={status.label}
          sx={{ bgcolor: status.color, color: "common.white", fontWeight: 600 }}
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

/** A cycle-fetch failure: the message as received, or a key worded at render. */
type EolCycleError = string | { key: string; params?: Record<string, string> };

interface EolLinkSectionProps {
  card: Card;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  initialExpanded?: boolean;
  /** Whether the viewer may change the link; read-only shows the details alone. */
  canEdit?: boolean;
}

export default function EolLinkSection({
  card,
  onSave,
  initialExpanded,
  canEdit = true,
}: EolLinkSectionProps) {
  const theme = useTheme();
  const user = useOptionalAuthUser();
  const canManage = hasPermission(user?.permissions, "eol.manage");
  // Whether this type tracks End of Life is its own End of Life section
  // toggle (Card Layout editor), read from the metamodel.
  const { types } = useMetamodel();
  const { t } = useTranslation(["cards", "common"]);
  const eolProduct = (card.attributes?.eol_product as string) || "";
  const eolCycle = (card.attributes?.eol_cycle as string) || "";
  const isLinked = !!(eolProduct && eolCycle);

  const [cycleData, setCycleData] = useState<EolCycle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<EolCycleError>("");
  // A failed link/unlink save — an error, unlike the fetch warning above.
  const [saveError, setSaveError] = useState("");
  const [linking, setLinking] = useState(false);
  const [pickerResetKey, setPickerResetKey] = useState(0);
  // No explicit setting from the metamodel → expand only when a product is
  // actually linked. Either way the value can change after mount, so the
  // accordion is controlled rather than relying on `defaultExpanded`.
  const [expanded, setExpanded] = useSyncedExpanded(initialExpanded ?? isLinked);

  // Fetch cycle data when linked. Effect-driven AND called by Refresh, so it
  // runs through `useLatestRequest`: a reply for the product the card was
  // linked to before can never overwrite the current one's.
  const { run } = useLatestRequest();
  const fetchCycleData = useCallback(
    () =>
      run(async ({ signal, isCurrent }) => {
        if (!eolProduct || !eolCycle) {
          setCycleData(null);
          setLoading(false);
          return;
        }
        setLoading(true);
        setError("");
        try {
          const cycles = await api.get<EolCycle[]>(
            `/eol/products/${encodeURIComponent(eolProduct)}`,
            // Stryker disable next-line ObjectLiteral: the signal only cancels the request on the wire; the stale-reply guard, which is what the tests pin, is isCurrent()
            { signal },
          );
          if (!isCurrent()) return;
          const match = cycles.find((c) => String(c.cycle) === String(eolCycle));
          setCycleData(match || null);
          if (!match)
            setError({
              key: "eol.errors.cycleNotFound",
              params: {
                cycle: eolCycle,
                product: eolProductLabel(eolProduct, cycles[0]?.title),
              },
            });
        } catch (e) {
          if (!isCurrent()) return;
          setError(e instanceof Error ? e.message : { key: "eol.errors.fetchFailed" });
        } finally {
          if (isCurrent()) setLoading(false);
        }
      }),
    // Not `t`: the error is stored as a key and worded at render, so a language
    // switch re-words it without blanking the details and fetching them again.
    [run, eolProduct, eolCycle],
  );

  useEffect(() => {
    // A different product/cycle: the previous one's details must not sit under
    // the new header while its own fetch is in flight. (Refresh keeps them.)
    setCycleData(null);
    fetchCycleData();
  }, [fetchCycleData]);

  if (!typeKeyTracksEol(card.type, types)) return null;

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

    setSaveError("");
    try {
      await onSave(updates);
      setLinking(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("common:errors.generic"));
    }
  };

  const handleUnlink = async () => {
    const newAttrs = { ...(card.attributes || {}) };
    delete newAttrs.eol_product;
    delete newAttrs.eol_cycle;
    setSaveError("");
    try {
      await onSave({ attributes: newAttrs });
      setCycleData(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("common:errors.generic"));
    }
  };

  return (
    <Accordion disableGutters expanded={expanded} onChange={(_, v) => setExpanded(v)}>
      <AccordionSummary
        expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
          <MaterialSymbol icon="update" size={20} color={theme.palette.text.secondary} />
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
                color: "common.white",
              }}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {saveError && (
          // Stryker disable next-line ObjectLiteral: spacing is presentation
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError("")}>
            {saveError}
          </Alert>
        )}
        {error && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError("")}>
            {typeof error === "string" ? error : t(error.key, error.params)}
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
                label={`${eolProductLabel(eolProduct, cycleData?.title)} ${eolCycle}`}
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />
              {isCustomEolProduct(eolProduct) && <CustomChip />}
              <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                {isCustomEolProduct(eolProduct) && canManage && (
                  <IconButton
                    size="small"
                    component="a"
                    href={CUSTOM_PRODUCTS_SETTINGS_PATH}
                    title={t("eol.custom.manageLink")}
                    aria-label={t("eol.custom.manageLink")}
                  >
                    <MaterialSymbol icon="settings" size={16} />
                  </IconButton>
                )}
                <IconButton
                  size="small"
                  onClick={fetchCycleData}
                  title={t("eol.refreshTooltip")}
                >
                  <MaterialSymbol icon="refresh" size={16} />
                </IconButton>
                {canEdit && (
                  <IconButton
                    size="small"
                    onClick={() => setLinking(true)}
                    title={t("eol.changeTooltip")}
                  >
                    <MaterialSymbol icon="edit" size={16} />
                  </IconButton>
                )}
                {canEdit && (
                  <IconButton
                    size="small"
                    onClick={handleUnlink}
                    title={t("eol.unlinkTooltip")}
                  >
                    <MaterialSymbol icon="link_off" size={16} color={STATUS_COLORS.error} />
                  </IconButton>
                )}
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
                  {isCustomEolProduct(eolProduct)
                    ? t("eol.custom.vendorPage")
                    : t("eol.releaseNotes")}
                </Button>
              </Box>
            )}
          </Box>
        ) : !canEdit ? (
          <Typography variant="body2" color="text.secondary">
            {t("eol.custom.nothingLinked")}
          </Typography>
        ) : linking || !isLinked ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {card.type === "ITComponent"
                ? t("eol.linkDescription.itComponent")
                : card.type === "Application"
                  ? t("eol.linkDescription.application")
                  : t("eol.linkDescription.other")}
            </Typography>
            <EolPicker
              onSelect={handleLink}
              onCancel={() => {
                setLinking(false);
                setSaveError("");
                setPickerResetKey((k) => k + 1);
              }}
              initialProduct={eolProduct}
              initialTitle={cycleData?.title}
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
