/**
 * Smart vendor field that searches existing Provider cards and
 * offers to link or create one. When a Provider is selected, the vendor
 * text attribute is updated and the Provider relation (discovered
 * dynamically from the metamodel) is created automatically.
 */
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { hasTypePermission } from "@/components/RequirePermission";
import { useAuthContext } from "@/hooks/AuthContext";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useAbortableEffect } from "@/hooks/useLatestRequest";
import { VENDOR_ACCENT } from "@/theme/tokens";
import type { Relation } from "@/types";

interface ProviderOption {
  id: string;
  name: string;
  isNew?: boolean;
  inputValue?: string;
}

const filter = createFilterOptions<ProviderOption>();

interface VendorFieldProps {
  /** Current vendor text value */
  value: string;
  /** Called when vendor text changes */
  onChange: (value: string | undefined) => void;
  /** Card type (ITComponent or Application) */
  cardTypeKey: string;
  /** Card ID — if provided, relations are managed automatically */
  fsId?: string;
  /** Size variant */
  size?: "small" | "medium";
  /** Label override */
  label?: string;
  /** Called after a relation is created/removed (to refresh RelationsSection) */
  onRelationChange?: () => void;
  /**
   * Fired whenever the user picks an existing Provider, creates a new one,
   * or clears the selection. Used by the Create Card flow (where `fsId` is
   * not yet available) to remember which Provider to link once the new
   * card has been saved.
   */
  onProviderSelected?: (provider: { id: string; name: string } | null) => void;
}

export default function VendorField({
  value,
  onChange,
  cardTypeKey,
  fsId,
  size = "small",
  label,
  onRelationChange,
  onProviderSelected,
}: VendorFieldProps) {
  const { t } = useTranslation(["cards", "common"]);
  const resolvedLabel = label ?? t("vendor.label");
  const { relationTypes } = useMetamodel();
  const [inputValue, setInputValue] = useState(value || "");
  const [debouncedInput, setDebouncedInput] = useState(value || "");
  const [linkedProvider, setLinkedProvider] = useState<ProviderOption | null>(null);
  // The freeSolo "create new Provider" affordance creates a Provider card, so
  // it is offered only when this role may create that type (discussion #1068).
  const { user } = useAuthContext();
  const canCreateProvider = hasTypePermission(user, "inventory.create", "Provider");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderOption | null>(null);
  const [creating, setCreating] = useState(false);
  // A failed create stays in its dialog; a failed link shows under the field.
  const [createError, setCreateError] = useState("");
  const [linkError, setLinkError] = useState("");
  const errorMessage = (err: unknown) =>
    err instanceof Error ? err.message : t("common:errors.generic");

  // Dynamically find a Provider↔cardTypeKey relation type from the metamodel.
  // Several may connect the pair, and this field carries one vendor link, so the
  // choice is fixed to the lowest sort_order rather than left to row order.
  const relType = useMemo(() => {
    const candidates = relationTypes.filter(
      (r) =>
        (r.source_type_key === "Provider" && r.target_type_key === cardTypeKey) ||
        (r.target_type_key === "Provider" && r.source_type_key === cardTypeKey)
    );
    if (candidates.length === 0) return null;
    return [...candidates].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key)
    )[0].key;
  }, [relationTypes, cardTypeKey]);

  // Determine if Provider is the source side of the relation
  const providerIsSource = useMemo(() => {
    const rt = relationTypes.find((r) => r.key === relType);
    return rt ? rt.source_type_key === "Provider" : true;
  }, [relationTypes, relType]);

  // Sync input value when external value changes
  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  // Check the existing Provider relation. Keyed on the card, so a reply for
  // the card shown before must never land on this one (#882).
  useAbortableEffect(
    async ({ signal, isCurrent }) => {
      // The chip is this card's: the previous card's Provider must not stay on
      // it while the lookup runs, nor after it finds none.
      setLinkedProvider(null);
      if (!fsId || !relType) return;
      try {
        const rels = await api.get<Relation[]>(
          `/relations?card_id=${fsId}&type=${relType}`,
          { signal },
        );
        if (!isCurrent()) return;
        // Find the Provider linked to this card
        for (const r of rels) {
          const isTarget = r.target_id === fsId;
          const provider = isTarget ? r.source : r.target;
          if (provider?.name) {
            setLinkedProvider({ id: provider.id, name: provider.name });
            break;
          }
        }
      } catch {
        // The chip is a hint beside the vendor text, which is still shown:
        // a failed lookup simply leaves it out.
      }
    },
    [fsId, relType],
  );

  // Browse + search Provider cards via the shared engine: an empty input
  // lists all Providers (browse), typing filters server-side (#702).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedInput(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { items, loading } = useCardSearch({
    types: ["Provider"],
    search: debouncedInput,
    enabled: true,
    pageSize: 50,
  });

  const options = useMemo<ProviderOption[]>(
    () => items.map((p) => ({ id: p.id, name: p.name })),
    [items],
  );

  const handleSelect = async (provider: ProviderOption) => {
    if (provider.isNew) {
      // Create new Provider card
      setPendingProvider(provider);
      setConfirmOpen(true);
      return;
    }

    // Set vendor text
    onChange(provider.name);
    setInputValue(provider.name);

    // Always notify parent — the Create Card flow needs the id to link the
    // relation after the new card is saved (no fsId yet at that point).
    onProviderSelected?.({ id: provider.id, name: provider.name });

    // Create relation if we have a card ID (detail-page editing flow)
    if (fsId) {
      await linkProvider(provider.id);
    } else {
      // Show the chip optimistically so the user gets the same feedback
      // as in the detail-page flow.
      setLinkedProvider({ id: provider.id, name: provider.name });
    }
  };

  const handleCreateAndLink = async () => {
    if (!pendingProvider?.inputValue) return;
    setCreating(true);
    setCreateError("");
    try {
      const newFs = await api.post<{ id: string; name: string }>("/cards", {
        type: "Provider",
        name: pendingProvider.inputValue,
      });

      onChange(newFs.name);
      setInputValue(newFs.name);

      onProviderSelected?.({ id: newFs.id, name: newFs.name });

      if (fsId) {
        // The chip appears once linkProvider has linked it; a link failure is
        // reported by linkProvider itself, under the field.
        await linkProvider(newFs.id);
      } else {
        // No card to link yet: the chip is the feedback for the pick.
        setLinkedProvider({ id: newFs.id, name: newFs.name });
      }
      closeConfirm();
    } catch (err) {
      // Nothing was created: keep the dialog open so the user can retry.
      setCreateError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  // Cancel and Escape both forget the pending Provider, so nothing can still
  // create it from the dialog while it closes.
  const closeConfirm = () => {
    setConfirmOpen(false);
    setPendingProvider(null);
    setCreateError("");
  };

  const linkProvider = async (providerId: string) => {
    if (!relType || !fsId) return;

    setLinkError("");
    try {
      // Link the new Provider first, respecting the metamodel direction, so a
      // failed link leaves the card with the Provider it had. POST /relations
      // checks no cardinality and is idempotent on the pair, so re-picking
      // the linked Provider keeps its row.
      await api.post("/relations", {
        type: relType,
        source_id: providerIsSource ? providerId : fsId,
        target_id: providerIsSource ? fsId : providerId,
      });

      // Then remove the card's other Provider relations of this type.
      const existing = await api.get<Relation[]>(
        `/relations?card_id=${fsId}&type=${relType}`
      );
      for (const r of existing) {
        const providerEnd = r.target_id === fsId ? r.source_id : r.target_id;
        if (providerEnd !== providerId) await api.delete(`/relations/${r.id}`);
      }

      setLinkedProvider({ id: providerId, name: "" });

      // Refresh to get the name
      const rels = await api.get<Relation[]>(
        `/relations?card_id=${fsId}&type=${relType}`
      );
      for (const r of rels) {
        const isTarget = r.target_id === fsId;
        const provider = isTarget ? r.source : r.target;
        if (provider?.name) {
          setLinkedProvider({ id: provider.id, name: provider.name });
          break;
        }
      }

      onRelationChange?.();
    } catch (err) {
      setLinkError(errorMessage(err));
    }
  };

  return (
    <>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Autocomplete
          freeSolo
          size={size}
          value={inputValue}
          inputValue={inputValue}
          onInputChange={(_e, newVal, reason) => {
            setInputValue(newVal);
            if (reason === "input") {
              onChange(newVal || undefined);
            }
          }}
          onChange={(_e, newVal) => {
            // `value` is the input text itself, so freeSolo never reports a
            // typed string here: typing goes through onInputChange.
            if (newVal && typeof newVal !== "string") {
              handleSelect(newVal as ProviderOption);
            } else if (newVal === null) {
              onChange(undefined);
              setLinkedProvider(null);
              onProviderSelected?.(null);
            }
          }}
          options={options}
          loading={loading}
          getOptionLabel={(opt) =>
            typeof opt === "string" ? opt : opt.inputValue ?? opt.name
          }
          filterOptions={(opts, params) => {
            const filtered = filter(opts, params);
            const { inputValue: iv } = params;
            // Add "Create new" option if no exact match
            if (
              canCreateProvider &&
              iv &&
              !opts.some((o) => o.name.toLowerCase() === iv.toLowerCase())
            ) {
              filtered.push({
                id: "__new__",
                name: t("vendor.createProvider", { name: iv }),
                isNew: true,
                inputValue: iv,
              });
            }
            return filtered;
          }}
          renderOption={(props, option) => {
            const { key, ...rest } = props;
            return (
              <li key={key} {...rest}>
                {option.isNew ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "primary.main" }}>
                    <MaterialSymbol icon="add_circle" size={18} />
                    <Typography variant="body2">{option.name}</Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <MaterialSymbol icon="storefront" size={18} color={VENDOR_ACCENT.fill} />
                    <Typography variant="body2">{option.name}</Typography>
                  </Box>
                )}
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={resolvedLabel}
              placeholder={t("vendor.searchPlaceholder")}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
              sx={{ minWidth: 300 }}
            />
          )}
        />
        {linkedProvider && linkedProvider.name && (
          <Chip
            size="small"
            label={linkedProvider.name}
            icon={<MaterialSymbol icon="storefront" size={14} />}
            variant="outlined"
            sx={{
              alignSelf: "flex-start",
              borderColor: VENDOR_ACCENT.fill,
              color: VENDOR_ACCENT.border,
              "& .MuiChip-icon": { color: VENDOR_ACCENT.fill },
              fontSize: "0.75rem",
            }}
          />
        )}
        {linkError && (
          <Alert severity="error" onClose={() => setLinkError("")}>
            {linkError}
          </Alert>
        )}
      </Box>

      {/* Create Provider confirmation dialog */}
      <Dialog open={confirmOpen} onClose={closeConfirm} maxWidth="xs" fullWidth>
        <DialogTitle>{t("vendor.createNew.title")}</DialogTitle>
        <DialogContent>
          {createError && (
            <Alert severity="error" onClose={() => setCreateError("")} sx={{ mt: 1 }}>
              {createError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("vendor.createNew.description", { name: pendingProvider?.inputValue })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirm}>{t("common:actions.cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleCreateAndLink}
            disabled={creating}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {creating ? t("vendor.createNew.creating") : t("vendor.createNew.submit")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
