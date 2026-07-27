import { useTranslation } from "react-i18next";
import BulkSelectionBar, { BulkSelectionAction } from "@/components/BulkSelectionBar";

interface BulkActionsToolbarProps {
  selectedCount: number;
  onChangeRole: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
}

/**
 * User-management bulk actions. The bar chrome lives in the shared
 * `BulkSelectionBar`; this file owns only the four user-specific actions
 * and their `users.bulk.*` keys.
 */
export default function BulkActionsToolbar({
  selectedCount,
  onChangeRole,
  onActivate,
  onDeactivate,
  onDelete,
  onClear,
  busy = false,
}: BulkActionsToolbarProps) {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <BulkSelectionBar
      selectedCount={selectedCount}
      label={t("users.bulk.selected", { count: selectedCount })}
      onClear={onClear}
      clearTitle={t("users.bulk.clear")}
    >
      <BulkSelectionAction
        label={t("users.bulk.changeRole")}
        icon="badge"
        onClick={onChangeRole}
        disabled={busy}
      />
      <BulkSelectionAction
        label={t("users.bulk.activate")}
        icon="person"
        onClick={onActivate}
        disabled={busy}
      />
      <BulkSelectionAction
        label={t("users.bulk.deactivate")}
        icon="person_off"
        onClick={onDeactivate}
        disabled={busy}
      />
      <BulkSelectionAction
        label={t("users.bulk.delete")}
        icon="delete"
        onClick={onDelete}
        disabled={busy}
      />
    </BulkSelectionBar>
  );
}
