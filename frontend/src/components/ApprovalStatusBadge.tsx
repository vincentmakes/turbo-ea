import Chip from "@mui/material/Chip";
import MaterialSymbol from "./MaterialSymbol";

interface Props {
  status: string;
  size?: "small" | "medium";
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: "default" | "success" | "warning" | "error"; icon: string }
> = {
  DRAFT: { label: "Draft", color: "default", icon: "edit_note" },
  APPROVED: { label: "Approved", color: "success", icon: "verified" },
  BROKEN: { label: "Broken", color: "warning", icon: "warning" },
  REJECTED: { label: "Rejected", color: "error", icon: "cancel" },
};

export default function ApprovalStatusBadge({ status, size = "small" }: Props) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <Chip
      size={size}
      label={cfg.label}
      color={cfg.color}
      icon={<MaterialSymbol icon={cfg.icon} size={16} />}
    />
  );
}
