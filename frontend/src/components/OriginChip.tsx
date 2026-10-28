import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "./MaterialSymbol";
import { useDateFormat } from "@/hooks/useDateFormat";
import { ORIGIN_META, isMarkedOrigin } from "./originMeta";

interface Props {
  origin: string | null | undefined;
  /** The person behind the write — enables the tooltip. */
  name?: string | null;
  /** When the write happened (ISO), shown in the tooltip. */
  at?: string | null;
}

/**
 * A small outlined chip naming the channel a record came through — an AI
 * agent (MCP), a direct API call, an extension or a background job — beside
 * the person in `created_by`. Renders nothing for the web UI and for records
 * made before the channel was tracked. See `originMeta.ts`.
 */
export default function OriginChip({ origin, name, at }: Props) {
  const { t } = useTranslation("common");
  if (!isMarkedOrigin(origin)) return null;
  const meta = ORIGIN_META[origin];
  const label = t(`origin.${origin}`);
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      icon={<MaterialSymbol icon={meta.icon} size={14} color={meta.color} />}
      data-origin={origin}
      sx={{
        height: 20,
        fontSize: "0.7rem",
        borderColor: meta.color,
        color: meta.color,
        "& .MuiChip-icon": { ml: 0.5, mr: -0.25 },
      }}
    />
  );
  if (!name) return chip;
  return (
    <OriginTooltip label={label} name={name} at={at}>
      {chip}
    </OriginTooltip>
  );
}

/** Split out so the date-format hook only runs where a tooltip is shown. */
function OriginTooltip({
  label,
  name,
  at,
  children,
}: {
  label: string;
  name: string;
  at?: string | null;
  children: React.ReactElement;
}) {
  const { t } = useTranslation("common");
  const { formatDate } = useDateFormat();
  return (
    <Tooltip title={t("origin.tooltip", { origin: label, name, date: formatDate(at) })}>
      {children}
    </Tooltip>
  );
}
