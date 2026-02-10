import Chip from "@mui/material/Chip";
import MaterialSymbol from "./MaterialSymbol";

interface Props {
  seal: string;
  size?: "small" | "medium";
}

export default function QualitySealBadge({ seal, size = "small" }: Props) {
  if (seal === "APPROVED") {
    return (
      <Chip
        size={size}
        label="Approved"
        color="success"
        icon={<MaterialSymbol icon="verified" size={16} />}
      />
    );
  }
  if (seal === "BROKEN") {
    return (
      <Chip
        size={size}
        label="Broken"
        color="warning"
        icon={<MaterialSymbol icon="warning" size={16} />}
      />
    );
  }
  return null;
}
