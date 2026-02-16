/**
 * Smart vendor field that searches existing Provider cards and
 * offers to link or create one. When a Provider is selected, the vendor
 * text attribute is updated and the Provider relation (discovered
 * dynamically from the metamodel) is created automatically.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
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
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
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
  /** Fact sheet type (ITComponent or Application) */
  cardTypeKey: string;
  /** Fact sheet ID — if provided, relations are managed automatically */
  fsId?: string;
  /** Size variant */
  size?: "small" | "medium";
  /** Label override */
  label?: string;
  /** Called after a relation is created/removed (to refresh RelationsSection) */
  onRelationChange?: () => void;
}

export default function VendorField({
  value,
  onChange,
  cardTypeKey,
  fsId,
  size = "small",
  label = "Vendor",
  onRelationChange,
}: VendorFieldProps) {
  const { relationTypes } = useMetamodel();
  const [inputValue, setInputValue] = useState(value || "");
  const [options, setOptions] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkedProvider, setLinkedProvider] = useState<ProviderOption | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderOption | null>(null);
  const [creating, setCreating] = useState(false);

  // Dynamically find a Provider↔cardTypeKey relation type from the metamodel
  const relType = useMemo(() => {
    const rt = relationTypes.find(
      (r) =>
        (r.source_type_key === "Provider" && r.target_type_key === cardTypeKey) ||
        (r.target_type_key === "Provider" && r.source_type_key === cardTypeKey)
    );
    return rt?.key ?? null;
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

  // Check existing Provider relation on mount
  useEffect(() => {
    if (!fsId || !relType) return;

    api
      .get<Relation[]>(`/relations?card_id=${fsId}&type=${relType}`)
      .then((rels) => {
        // Find the Provider linked to this card
        for (const r of rels) {
          const isTarget = r.target_id === fsId;
          const provider = isTarget ? r.source : r.target;
          if (provider?.name) {
            setLinkedProvider({ id: provider.id, name: provider.name });
            break;
          }
        }
      })
      .catch(() => {});
  }, [fsId, relType]);

  // Search providers
  const searchProviders = useCallback(
    async (query: string) => {
      if (query.length < 1) {
        setOptions([]);
        return;
      }
      setLoading(true);
      try {
        const res = await api.get<{ items: { id: string; name: string }[] }>(
          `/cards?type=Provider&search=${encodeURIComponent(query)}&page_size=10`
        );
        setOptions(res.items.map((p) => ({ id: p.id, name: p.name })));
      } catch {
        setOptions([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => searchProviders(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue, searchProviders]);

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

    // Create relation if we have a card ID
    if (fsId) {
      await linkProvider(provider.id);
    }
  };

  const handleCreateAndLink = async () => {
    if (!pendingProvider?.inputValue) return;
    setCreating(true);
    try {
      const newFs = await api.post<{ id: string; name: string }>("/cards", {
        type: "Provider",
        name: pendingProvider.inputValue,
      });

      onChange(newFs.name);
      setInputValue(newFs.name);
      setLinkedProvider({ id: newFs.id, name: newFs.name });

      if (fsId) {
        await linkProvider(newFs.id);
      }
    } catch {
      // Silent fail — vendor text is still set
    } finally {
      setCreating(false);
      setConfirmOpen(false);
      setPendingProvider(null);
    }
  };

  const linkProvider = async (providerId: string) => {
    if (!relType || !fsId) return;

    try {
      // Remove existing provider relations first
      const existing = await api.get<Relation[]>(
        `/relations?card_id=${fsId}&type=${relType}`
      );
      for (const r of existing) {
        await api.delete(`/relations/${r.id}`);
      }

      // Create new relation respecting the metamodel direction
      await api.post("/relations", {
        type: relType,
        source_id: providerIsSource ? providerId : fsId,
        target_id: providerIsSource ? fsId : providerId,
      });

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
    } catch {
      // Relation creation failed silently
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
            if (newVal && typeof newVal !== "string") {
              handleSelect(newVal as ProviderOption);
            } else if (typeof newVal === "string") {
              onChange(newVal || undefined);
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
            if (iv && !opts.some((o) => o.name.toLowerCase() === iv.toLowerCase())) {
              filtered.push({
                id: "__new__",
                name: `Create Provider "${iv}"`,
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
                    <MaterialSymbol icon="storefront" size={18} color="#ffa31f" />
                    <Typography variant="body2">{option.name}</Typography>
                  </Box>
                )}
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={label}
              placeholder="Search existing providers or type a new name..."
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
              borderColor: "#ffa31f",
              color: "#e68a00",
              "& .MuiChip-icon": { color: "#ffa31f" },
              fontSize: "0.75rem",
            }}
          />
        )}
      </Box>

      {/* Create Provider confirmation dialog */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Create New Provider</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No existing Provider matches "{pendingProvider?.inputValue}".
            Create a new Provider card and link it?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateAndLink}
            disabled={creating}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {creating ? "Creating..." : "Create & Link"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
