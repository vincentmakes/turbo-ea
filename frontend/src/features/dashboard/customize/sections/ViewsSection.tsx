/**
 * The Inventory views widget's settings: whose saved views it lists (every
 * view the reader can open, their own, or those shared with them) and whether
 * it keeps the query views alone. Both are fixed choices, so the draft is
 * always valid.
 */
import { useTranslation } from "react-i18next";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import { INVENTORY_VIEWS_FILTERS, type InventoryViewsFilter } from "../../widgets/inventoryViewsConfig";
import type { DraftProps } from "./types";

const FILTER_LABEL_KEYS: Record<InventoryViewsFilter, string> = {
  all: "dashboard.inventoryViews.filterAll",
  my: "dashboard.inventoryViews.filterMy",
  shared: "dashboard.inventoryViews.filterShared",
};

export default function ViewsSection({ draft, set }: Pick<DraftProps, "draft" | "set">) {
  const { t } = useTranslation("common");
  return (
    <Stack spacing={1.5} data-testid="config-views">
      <FormControl>
        <FormLabel id="config-views-filter-label">{t("dashboard.inventoryViews.filter")}</FormLabel>
        <RadioGroup
          aria-labelledby="config-views-filter-label"
          value={draft.viewsFilter}
          onChange={(e) => set("viewsFilter", e.target.value as InventoryViewsFilter)}
        >
          {INVENTORY_VIEWS_FILTERS.map((f) => (
            <FormControlLabel key={f} value={f} control={<Radio size="small" />} label={t(FILTER_LABEL_KEYS[f])} />
          ))}
        </RadioGroup>
      </FormControl>
      <FormControlLabel
        control={
          <Switch checked={draft.viewsQueryOnly} onChange={(e) => set("viewsQueryOnly", e.target.checked)} />
        }
        label={t("dashboard.inventoryViews.queryOnly")}
      />
    </Stack>
  );
}
