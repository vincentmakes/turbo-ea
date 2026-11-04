/**
 * Popup cell editor for a custom EOL cycle's dates: a plain date, or an EOL /
 * end-of-support milestone (a date, "still going" or "already over").
 *
 * AG Grid React custom-editor contract, as in `MultiSelectCellEditor`:
 * `onValueChange` on every change, `stopEditing()` to commit,
 * `api.stopEditing(true)` to discard. The date input commits on blur, which
 * happens before the Apply click lands, so Apply always commits the final value.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { GridApi } from "ag-grid-community";
import { DateField } from "@/components/DateField";
import { MilestoneField } from "@/components/CustomEolProductDialog";
import type { MilestoneKind } from "@/lib/eolCustom";
import type { EolMilestone } from "@/types";

interface Params {
  value: EolMilestone | undefined;
  /** `date` for a release date; a milestone kind for EOL / end of support. */
  mode: "date" | MilestoneKind;
  onValueChange: (value: EolMilestone) => void;
  stopEditing?: (suppressNavigateAfterEdit?: boolean) => void;
  api: GridApi;
}

export default function EolCycleCellEditor(props: Params) {
  const { t } = useTranslation(["cards", "common"]);
  const [value, setValue] = useState<EolMilestone>(props.value ?? null);

  const change = (next: EolMilestone) => {
    setValue(next);
    props.onValueChange(next);
  };

  return (
    <Box
      sx={{ p: 1.5, minWidth: 320, bgcolor: "background.paper" }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.api.stopEditing(true);
        }
      }}
    >
      {props.mode === "date" ? (
        <DateField
          size="small"
          fullWidth
          autoFocus
          label={t("eol.custom.date")}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => change(v || null)}
        />
      ) : (
        <MilestoneField kind={props.mode} value={value} onChange={change} />
      )}
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
        <Button size="small" onClick={() => props.api.stopEditing(true)}>
          {t("common:actions.cancel")}
        </Button>
        <Button size="small" variant="contained" onClick={() => props.stopEditing?.()}>
          {t("common:actions.apply")}
        </Button>
      </Stack>
    </Box>
  );
}
