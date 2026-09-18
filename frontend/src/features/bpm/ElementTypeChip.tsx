/**
 * ElementTypeChip — the one rendering of a BPMN element's type.
 *
 * Icon + translated label from `elementTypes.ts`, plus the event definition
 * (message, timer, …) and the Message / Signal / Error name the element
 * refers to when the parser resolved one — "Start event · Message: Order".
 * Every place that used to print the raw `element_type` string renders this
 * instead, so a message start event reads as one wherever it appears.
 */
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  EVENT_DEFINITION_ICONS,
  elementTypeInfo,
  elementTypeLabelKey,
  eventDefinitionLabelKey,
} from "./elementTypes";

interface Props {
  elementType: string;
  eventDefinitionType?: string | null;
  definitionName?: string | null;
  /** `chip` (default) renders an outlined MUI Chip; `text` renders inline text. */
  variant?: "chip" | "text";
}

export default function ElementTypeChip({
  elementType,
  eventDefinitionType,
  definitionName,
  variant = "chip",
}: Props) {
  const { t } = useTranslation("bpm");
  const info = elementTypeInfo(elementType);
  const typeLabel = t(elementTypeLabelKey(elementType), { defaultValue: elementType });
  const definitionLabel = eventDefinitionType
    ? t(eventDefinitionLabelKey(eventDefinitionType), { defaultValue: eventDefinitionType })
    : null;
  const definitionIcon = eventDefinitionType ? EVENT_DEFINITION_ICONS[eventDefinitionType] : null;

  // "Message: Order received" — the definition kind plus the name it resolves
  // to; a send/receive task has a name but no definition kind.
  const detail = definitionLabel
    ? definitionName
      ? `${definitionLabel}: ${definitionName}`
      : definitionLabel
    : definitionName || null;

  if (variant === "text") {
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        <MaterialSymbol icon={info.icon} size={14} color={info.color} />
        <Typography component="span" variant="inherit">
          {typeLabel}
        </Typography>
        {detail && (
          <Typography component="span" variant="inherit" color="text.secondary">
            · {definitionIcon && <MaterialSymbol icon={definitionIcon} size={12} />} {detail}
          </Typography>
        )}
      </Box>
    );
  }

  const chip = (
    <Chip
      size="small"
      variant="outlined"
      icon={<MaterialSymbol icon={info.icon} size={14} color={info.color} />}
      label={
        detail ? (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            {typeLabel}
            <Box component="span" sx={{ color: "text.secondary", display: "inline-flex", alignItems: "center", gap: 0.25 }}>
              · {definitionIcon && <MaterialSymbol icon={definitionIcon} size={12} />}
              {detail}
            </Box>
          </Box>
        ) : (
          typeLabel
        )
      }
      sx={{ maxWidth: 260, "& .MuiChip-label": { display: "inline-flex" } }}
    />
  );

  return detail ? <Tooltip title={`${typeLabel} — ${detail}`}>{chip}</Tooltip> : chip;
}
