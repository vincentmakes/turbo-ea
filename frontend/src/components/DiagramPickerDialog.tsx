/**
 * Pick one existing free-draw diagram. The list comes from `GET /diagrams`,
 * which searches on the server (name, description, author and the cards a
 * diagram holds), so the search box debounces what goes to the server and the
 * rows are re-ranked on the raw input meanwhile. Diagrams already chosen
 * (`excludeIds`) stay listed, greyed out and marked, so the list does not
 * shift under the pointer. A pick closes the dialog.
 */
import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { diagramThumbnailSrc } from "@/lib/diagramThumbnail";
import { compareByRank } from "@/lib/searchRank";
import type { DiagramSummary } from "@/types";

/** The material symbol a diagram without a thumbnail shows (the gallery's). */
export const DIAGRAM_ICON = "schema";

/** The list request: alphabetical, narrowed by the server when searching. */
export function diagramListPath(search: string): string {
  const params = new URLSearchParams({ sort_by: "name", sort_dir: "asc" });
  const term = search.trim();
  if (term) params.set("search", term);
  return `/diagrams?${params.toString()}`;
}

// Stryker disable all: static layout, which jsdom cannot measure.
const SX = {
  content: { display: "flex", flexDirection: "column", minHeight: 360, pb: 0 },
  search: { mb: 1, flexShrink: 0 },
  list: { flex: 1, overflow: "auto", minHeight: 0 },
  thumb: {
    width: 64,
    height: 44,
    mr: 1.5,
    flexShrink: 0,
    borderRadius: 1,
    overflow: "hidden",
    bgcolor: "action.hover",
    border: 1,
    borderColor: "divider",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  img: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" },
  message: { py: 3, textAlign: "center" },
} as const;
// Stryker restore all

export interface DiagramPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onPick: (diagram: DiagramSummary) => void;
  /** Diagrams already chosen: listed, but inert and marked. */
  excludeIds?: string[];
  title?: string;
}

export default function DiagramPickerDialog({
  open,
  onClose,
  onPick,
  excludeIds = [],
  title,
}: DiagramPickerDialogProps) {
  const { t } = useTranslation(["delivery", "diagrams", "common"]);
  const [search, setSearch] = useState("");
  const [debounced, pending] = useDebouncedValue(search, 300);
  const { data, loading, error, refetch } = useApiQuery<DiagramSummary[]>(
    open ? diagramListPath(debounced) : null,
  );

  const rows = useMemo(
    () => (Array.isArray(data) ? [...data].sort(compareByRank(search)) : []),
    [data, search],
  );
  const excluded = new Set(excludeIds);
  const busy = loading || pending;

  const close = () => {
    setSearch("");
    onClose();
  };

  const pick = (d: DiagramSummary) => {
    setSearch("");
    onPick(d);
  };

  let body: React.ReactNode;
  if (error) {
    body = (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={refetch}>
            {t("common:actions.retry")}
          </Button>
        }
      >
        {t("diagramPicker.loadFailed")}
      </Alert>
    );
  } else if (rows.length === 0) {
    body = busy ? null : (
      <Typography variant="body2" color="text.secondary" sx={SX.message}>
        {debounced.trim() ? t("diagramPicker.noResults") : t("diagramPicker.empty")}
      </Typography>
    );
  } else {
    body = (
      <List dense disablePadding aria-label={title ?? t("diagramPicker.title")}>
        {rows.map((d) => {
          const attached = excluded.has(d.id);
          const src = diagramThumbnailSrc(d.thumbnail);
          const secondary = [
            t("diagrams:gallery.cardCount", { count: d.card_count ?? 0 }),
            d.created_by_name,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <ListItemButton
              key={d.id}
              disabled={attached}
              onClick={() => pick(d)}
              data-testid={`diagram-option-${d.id}`}
            >
              <Box sx={SX.thumb}>
                {src ? (
                  <Box component="img" src={src} alt="" sx={SX.img} />
                ) : (
                  <MaterialSymbol icon={DIAGRAM_ICON} size={24} />
                )}
              </Box>
              <ListItemText
                primary={d.name}
                secondary={secondary}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
              {attached && (
                <Chip size="small" variant="outlined" label={t("diagramPicker.attached")} />
              )}
            </ListItemButton>
          );
        })}
      </List>
    );
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{title ?? t("diagramPicker.title")}</DialogTitle>
      <DialogContent sx={SX.content}>
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder={t("diagramPicker.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={SX.search}
          slotProps={{
            htmlInput: { "aria-label": t("diagramPicker.search") },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MaterialSymbol icon="search" size={20} />
                </InputAdornment>
              ),
            },
          }}
        />
        {busy && <LinearProgress data-testid="diagram-picker-loading" />}
        <Box sx={SX.list}>{body}</Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t("common:actions.cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
