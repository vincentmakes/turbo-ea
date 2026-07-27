import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import type { GridApi } from "ag-grid-community";
import MaterialSymbol from "@/components/MaterialSymbol";
import CardPicker, { type CardOption } from "@/components/CardPicker";

// Same AG Grid React v32+ custom editor contract as TagsCellEditor:
// — `props.value` is the initial value
// — `props.onValueChange(newValue)` must be called on every change; AG Grid
//   stores it internally and returns it from `getValue()` when edit ends
// — `props.stopEditing()` ends the edit and commits the latest value
// — `props.api.stopEditing(true)` ends the edit AND discards changes
interface Params {
  value: CardOption | null | undefined;
  /** The row being edited — its own id can never be its parent. */
  cardId: string;
  /** Card type to browse. Parent is same-type by convention throughout. */
  typeKey: string;
  /** Self + descendants, so the picker can't offer an obvious cycle. */
  excludeIds: string[];
  stopEditing?: (suppressNavigateAfterEdit?: boolean) => void;
  onValueChange: (value: CardOption | null) => void;
  api: GridApi;
}

export default function ParentCellEditor(props: Params) {
  const { t } = useTranslation(["inventory", "common"]);
  const [parent, setParent] = useState<CardOption | null>(props.value ?? null);

  const handleChange = (next: CardOption | null) => {
    setParent(next);
    props.onValueChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.api.stopEditing(true);
    }
  };

  return (
    <Box
      sx={{ p: 1.5, minWidth: 340, bgcolor: "background.paper" }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <CardPicker
        types={props.typeKey}
        value={parent}
        onChange={handleChange}
        excludeIds={props.excludeIds}
        fullWidth
        label={t("columns.parent")}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        {t("gridEdit.parentHint")}
      </Typography>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
        <Button
          size="small"
          onClick={() => props.api.stopEditing(true)}
          startIcon={<MaterialSymbol icon="close" size={16} />}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={() => props.stopEditing?.()}
          startIcon={<MaterialSymbol icon="check" size={16} />}
        >
          {t("common:actions.save")}
        </Button>
      </Stack>
    </Box>
  );
}
