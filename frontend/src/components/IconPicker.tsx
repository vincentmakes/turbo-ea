import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "./MaterialSymbol";
import { ICON_CATEGORIES } from "./iconCatalog";


interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  color?: string;
  disabled?: boolean;
}

export default function IconPicker({ value, onChange, color, disabled }: IconPickerProps) {
  const { t } = useTranslation("common");
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const open = Boolean(anchorEl);

  // Reset search when popover opens
  useEffect(() => {
    if (open) {
      setSearch("");
      // Focus the search field after popover renders
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  const needle = search.toLowerCase().replace(/\s+/g, "_");

  const filteredCategories = useMemo(() => {
    if (!needle) return ICON_CATEGORIES;
    return ICON_CATEGORIES.map((cat) => ({
      ...cat,
      icons: cat.icons.filter((icon) => icon.includes(needle)),
    })).filter((cat) => cat.icons.length > 0);
  }, [needle]);

  const totalResults = useMemo(
    () => filteredCategories.reduce((sum, cat) => sum + cat.icons.length, 0),
    [filteredCategories],
  );

  const handleSelect = useCallback(
    (icon: string) => {
      onChange(icon);
      setAnchorEl(null);
    },
    [onChange],
  );

  return (
    <>
      {/* Trigger — compact icon swatch */}
      <Tooltip title={value.replace(/_/g, " ")} placement="top">
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1,
            bgcolor: color || "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            border: "2px solid",
            borderColor: "divider",
            transition: "border-color 0.15s",
            "&:hover": disabled ? {} : { borderColor: "text.primary" },
          }}
          onClick={(e) => {
            if (!disabled) setAnchorEl(e.currentTarget);
          }}
        >
          <MaterialSymbol icon={value} size={22} color={color ? "#fff" : undefined} />
        </Box>
      </Tooltip>

      {/* Popover with search + icon grid */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: { width: 420, maxHeight: 480, display: "flex", flexDirection: "column" },
          },
        }}
      >
        {/* Search bar */}
        <Box sx={{ p: 1.5, pb: 1, flexShrink: 0 }}>
          <TextField
            inputRef={searchRef}
            size="small"
            fullWidth
            placeholder={t("iconPicker.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={18} color="#999" />
                  </InputAdornment>
                ),
              },
            }}
          />
          {search && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {t("iconPicker.resultCount", { count: totalResults })}
            </Typography>
          )}
        </Box>

        {/* Icon grid */}
        <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
          {filteredCategories.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <MaterialSymbol icon="search_off" size={32} color="#ccc" />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("iconPicker.noMatch", { search })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("iconPicker.noMatchHint")}
              </Typography>
            </Box>
          ) : (
            filteredCategories.map((cat) => (
              <Box key={cat.labelKey} sx={{ mb: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    mb: 0.5,
                    fontSize: "0.68rem",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    fontWeight: 600,
                  }}
                >
                  {t(`iconPicker.categories.${cat.labelKey}`)}
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
                    gap: "2px",
                  }}
                >
                  {cat.icons.map((icon) => (
                    <Tooltip key={icon} title={icon.replace(/_/g, " ")} placement="top" arrow>
                      <Box
                        onClick={() => handleSelect(icon)}
                        sx={{
                          width: 48,
                          height: 48,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 1,
                          cursor: "pointer",
                          border: icon === value ? "2px solid" : "1px solid transparent",
                          borderColor: icon === value ? "primary.main" : "transparent",
                          bgcolor: icon === value ? "primary.50" : "transparent",
                          transition: "all 0.1s",
                          "&:hover": {
                            bgcolor: icon === value ? "primary.100" : "action.hover",
                          },
                        }}
                      >
                        <MaterialSymbol icon={icon} size={24} />
                      </Box>
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            ))
          )}
        </Box>
      </Popover>
    </>
  );
}
