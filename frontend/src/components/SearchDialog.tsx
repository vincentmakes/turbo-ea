import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";

interface SearchResult {
  id: string;
  name: string;
  type: string;
  subtype?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SearchDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("nav");
  const { getType } = useMetamodel();
  const typeLabel = useTypeLabel();

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = isMac ? "\u2318K" : "Ctrl+K";

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSearch("");
      setResults([]);
      setSearched(false);
      setLoading(false);
    }
  }, [open]);

  // Close on navigation
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Debounced live search
  const doSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get<{ items: SearchResult[] }>(
        `/cards?search=${encodeURIComponent(query.trim())}&page_size=10`,
      );
      setResults(res.items);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (search.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    timerRef.current = setTimeout(() => doSearch(search), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [search, doSearch]);

  const handleResultClick = (id: string) => {
    onClose();
    navigate(`/cards/${id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && search.trim()) {
      onClose();
      navigate(`/inventory?search=${encodeURIComponent(search.trim())}`);
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: "hidden",
          position: "fixed",
          top: { xs: "10%", sm: "15%" },
          m: 0,
          maxHeight: "70vh",
        },
      }}
      slotProps={{ backdrop: { sx: { backdropFilter: "blur(4px)" } } }}
    >
      {/* p: 0 is intentional — a quick-search command palette uses its own
          internal section padding instead of the standard DialogContent gutter. */}
      <DialogContent sx={{ p: 0 }}>
        {/* Search input */}
        <Box sx={{ px: 2.5, py: 2 }}>
          <TextField
            inputRef={inputRef}
            autoFocus
            fullWidth
            placeholder={t("search.placeholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            variant="standard"
            sx={{
              "& .MuiInput-underline:before": { borderBottom: "none" },
              "& .MuiInput-underline:after": { borderBottom: "none" },
              "& .MuiInput-underline:hover:not(.Mui-disabled):before": { borderBottom: "none" },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 1.5 }}>
                  <MaterialSymbol icon="search" size={24} color="action.active" />
                </InputAdornment>
              ),
              endAdornment: loading ? (
                <InputAdornment position="end">
                  <CircularProgress size={20} />
                </InputAdornment>
              ) : !search ? (
                <InputAdornment position="end">
                  <Box
                    sx={{
                      px: 0.8,
                      py: 0.2,
                      borderRadius: 0.8,
                      border: "1px solid",
                      borderColor: "divider",
                      bgcolor: "action.hover",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        color: "text.secondary",
                        fontFamily: "inherit",
                      }}
                    >
                      {shortcutLabel}
                    </Typography>
                  </Box>
                </InputAdornment>
              ) : null,
              sx: { fontSize: "1.1rem" },
            }}
          />
        </Box>

        {/* Results */}
        {(results.length > 0 || (searched && results.length === 0)) && (
          <>
            <Divider />
            <Box sx={{ maxHeight: "calc(70vh - 100px)", overflow: "auto" }}>
              {results.length === 0 && searched && (
                <Box sx={{ px: 2.5, py: 3, textAlign: "center" }}>
                  <MaterialSymbol icon="search_off" size={40} color="#999" />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t("search.noResults")}
                  </Typography>
                </Box>
              )}

              {results.map((item) => {
                const typeConfig = getType(item.type);
                return (
                  <Box
                    key={item.id}
                    onClick={() => handleResultClick(item.id)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      px: 2.5,
                      py: 1.2,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      "&:last-child": { borderBottom: "none" },
                    }}
                  >
                    <MaterialSymbol
                      icon={typeConfig?.icon || "description"}
                      size={20}
                      color={typeConfig?.color || "#999"}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: "break-word" }}>
                        {item.name}
                      </Typography>
                    </Box>
                    <Chip
                      label={typeConfig ? typeLabel(typeConfig) : item.type}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: "0.7rem",
                        bgcolor: typeConfig?.color ? `${typeConfig.color}18` : "action.selected",
                        color: typeConfig?.color || "text.secondary",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    />
                  </Box>
                );
              })}

              {/* View all results footer */}
              {search.trim().length >= 2 && results.length > 0 && (
                <Box
                  onClick={() => {
                    onClose();
                    navigate(`/inventory?search=${encodeURIComponent(search.trim())}`);
                  }}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 0.5,
                    px: 2.5,
                    py: 1.2,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                    color: "primary.main",
                    borderTop: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <MaterialSymbol icon="search" size={16} />
                  <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
                    {t("search.viewAll", { query: search.trim() })}
                  </Typography>
                </Box>
              )}
            </Box>
          </>
        )}

        {/* Hint when empty */}
        {!searched && results.length === 0 && search.trim().length < 2 && (
          <>
            <Divider />
            <Box sx={{ px: 2.5, py: 3, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {t("search.hint")}
              </Typography>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
