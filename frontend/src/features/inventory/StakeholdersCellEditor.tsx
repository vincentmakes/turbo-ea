import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useTranslation } from "react-i18next";
import type { GridApi } from "ag-grid-community";
import MaterialSymbol from "@/components/MaterialSymbol";
import UserMultiSelect, { type UserOption } from "@/components/UserMultiSelect";
import type { StakeholderRef } from "@/types";

// AG Grid React v32+ custom editor contract — same shape as TagsCellEditor:
// — `props.value` is the initial value (the card's StakeholderRef[] for ONE role)
// — `props.onValueChange(newValue)` must be called on every change
// — `props.stopEditing()` commits, `props.api.stopEditing(true)` discards
interface Params {
  value: StakeholderRef[] | undefined;
  roleKey: string;
  roleLabel: string;
  stopEditing?: (suppressNavigateAfterEdit?: boolean) => void;
  onValueChange: (value: StakeholderRef[]) => void;
  api: GridApi;
}

export default function StakeholdersCellEditor(props: Params) {
  const { t } = useTranslation(["common", "inventory"]);

  // Seed once from the initial value; the picker owns the state afterwards.
  const initialUsers = useMemo(
    () =>
      (props.value || []).map((s) => ({
        id: s.user_id,
        display_name: s.user_display_name || s.user_email || s.user_id,
        email: s.user_email || "",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [selected, setSelected] = useState<UserOption[]>(initialUsers);

  const handleChange = (next: UserOption[]) => {
    setSelected(next);
    // Preserve the original ref (with its stakeholder id) for users that were
    // already assigned; new assignments get an empty id — the commit path
    // diffs by (user_id, role), so the id is display-only.
    const byUserId = new Map((props.value || []).map((s) => [s.user_id, s]));
    props.onValueChange(
      next.map(
        (u) =>
          byUserId.get(u.id) ?? {
            id: "",
            user_id: u.id,
            user_display_name: u.display_name,
            user_email: u.email,
            role: props.roleKey,
          },
      ),
    );
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
      <UserMultiSelect
        value={selected}
        onChange={handleChange}
        label={props.roleLabel}
        size="small"
        disablePortal
      />
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
