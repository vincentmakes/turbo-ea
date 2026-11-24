import { useId, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListSubheader from "@mui/material/ListSubheader";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { FILTER_KIND_ICONS, searchFilterCatalog } from "@/lib/fieldFilters";
import type { FilterCatalog } from "@/lib/fieldFilters";

export interface AddFilterMenuProps<F extends { key: string; label: string }> {
  /** The fields that can be added, grouped by section (`addableFields`). */
  sections: FilterCatalog<F>;
  /** A field was picked: add it to the block's `filterFields`. */
  onAdd: (key: string) => void;
}

/**
 * The "Add filter" chip at the end of a Fields row: a popover with a search
 * box over the fields a block does not show yet, grouped under their section
 * headings. The search runs on the raw input over field AND section labels and
 * is ranked like every other search box. Arrow keys move through the list,
 * Enter adds the highlighted field, Escape closes; picking a field adds it and
 * closes the popover, which hands focus back to the chip.
 */
export default function AddFilterMenu<F extends { key: string; label: string }>({
  sections,
  onAdd,
}: AddFilterMenuProps<F>) {
  const { t, i18n } = useTranslation("common");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const shown = useMemo(
    () => searchFilterCatalog(sections, query, i18n.language),
    [sections, query, i18n.language],
  );
  const flat = useMemo(() => shown.flatMap((s) => s.fields), [shown]);
  // Where each section's options start in `flat`, so every option knows its index.
  const starts = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const s of shown) {
      out.push(at);
      at += s.fields.length;
    }
    return out;
  }, [shown]);
  const optionId = (i: number) => `${listId}-option-${i}`;

  const close = () => {
    setAnchor(null);
    setQuery("");
    setActive(0);
  };
  const pick = (key: string) => {
    onAdd(key);
    close();
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(flat[active].field.key);
    }
  };

  return (
    <>
      <Chip
        size="small"
        icon={<MaterialSymbol icon="add" size={14} />}
        label={t("fieldFilters.add")}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)}
        sx={{
          height: 26,
          fontSize: "0.72rem",
          fontWeight: 500,
          cursor: "pointer",
          bgcolor: "background.paper",
          border: "1px dashed",
          borderColor: "divider",
          "&:hover": { bgcolor: "action.hover" },
        }}
      />
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 320, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Box sx={{ p: 1 }}>
          <TextField
            fullWidth
            size="small"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={t("fieldFilters.searchPlaceholder")}
            slotProps={{
              input: {
                startAdornment: <MaterialSymbol icon="search" size={18} />,
                endAdornment: query ? (
                  <IconButton
                    size="small"
                    aria-label={t("fieldFilters.clearSearch")}
                    onClick={() => {
                      setQuery("");
                      setActive(0);
                    }}
                  >
                    <MaterialSymbol icon="close" size={16} />
                  </IconButton>
                ) : undefined,
              },
              htmlInput: {
                "aria-label": t("fieldFilters.search"),
                "aria-controls": listId,
                "aria-activedescendant": flat.length > 0 ? optionId(active) : undefined,
              },
            }}
          />
        </Box>
        {flat.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1.5 }}>
            {t("fieldFilters.noMatch")}
          </Typography>
        ) : (
          <List
            id={listId}
            role="listbox"
            aria-label={t("fieldFilters.add")}
            dense
            disablePadding
            sx={{ maxHeight: 320, overflowY: "auto", pb: 0.5 }}
          >
            {shown.map((section, si) => (
              <Box key={`${si}:${section.key}`} role="group" aria-label={section.label}>
                <ListSubheader
                  disableSticky
                  sx={{ lineHeight: "28px", fontSize: "0.7rem", fontWeight: 600, color: "text.secondary" }}
                >
                  {section.label}
                </ListSubheader>
                {section.fields.map((entry, fi) => {
                  const i = starts[si] + fi;
                  const selected = i === active;
                  return (
                    <ListItemButton
                      key={entry.field.key}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(entry.field.key)}
                      sx={{ gap: 1 }}
                    >
                      <Box component="span" aria-hidden sx={{ display: "flex", color: "text.secondary" }}>
                        <MaterialSymbol icon={FILTER_KIND_ICONS[entry.kind]} size={16} />
                      </Box>
                      <Typography variant="body2">{entry.field.label}</Typography>
                    </ListItemButton>
                  );
                })}
              </Box>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
