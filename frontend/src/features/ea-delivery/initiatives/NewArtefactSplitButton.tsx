import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { CARD_TYPE_COLORS, STATUS_COLORS } from "@/theme/tokens";

export type ArtefactKind = "soaw" | "diagram" | "adr";

interface Props {
  /** When set, the dispatched create handler will pre-link to this initiative. */
  initiativeId?: string;
  onSelect: (kind: ArtefactKind, initiativeId?: string) => void;
  /**
   * - `"contained"`: full primary CTA with label (page header)
   * - `"text"`: compact "+ Add" trigger for inside section headers
   * - `"icon"`: bare round icon button for tight spaces
   */
  variant?: "contained" | "text" | "icon";
  label?: string;
  disabled?: boolean;
  /** Limit which artefact kinds the menu offers. */
  kinds?: ArtefactKind[];
}

const ALL_KINDS: ArtefactKind[] = ["soaw", "diagram", "adr"];

/**
 * Reusable trigger that opens a menu of artefact creation options
 * (SoAW · Diagram · ADR). Used both as the page-level primary CTA and as
 * per-section "+ Add" buttons inside the workspace.
 */
export default function NewArtefactSplitButton({
  initiativeId,
  onSelect,
  variant = "contained",
  label,
  disabled,
  kinds = ALL_KINDS,
}: Props) {
  const { t } = useTranslation(["delivery", "common"]);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const meta: Record<
    ArtefactKind,
    { icon: string; color: string; labelKey: string }
  > = {
    soaw: {
      icon: "description",
      color: "#e65100",
      labelKey: "header.newSoaw",
    },
    diagram: {
      icon: "schema",
      color: CARD_TYPE_COLORS.Application,
      labelKey: "header.newDiagram",
    },
    adr: {
      icon: "gavel",
      color: STATUS_COLORS.info,
      labelKey: "header.newAdr",
    },
  };

  const handleSelect = (kind: ArtefactKind) => {
    setOpen(false);
    onSelect(kind, initiativeId);
  };

  const triggerLabel = label ?? t("header.newArtefact");

  return (
    <>
      {variant === "icon" ? (
        <Tooltip title={triggerLabel}>
          <span>
            <IconButton
              ref={anchorRef as unknown as React.RefObject<HTMLButtonElement>}
              size="small"
              disabled={disabled}
              onClick={() => setOpen((v) => !v)}
            >
              <MaterialSymbol icon="add_circle" size={20} />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button
          ref={anchorRef}
          variant={variant}
          size={variant === "text" ? "small" : "medium"}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          startIcon={<MaterialSymbol icon="add" size={18} />}
          endIcon={<MaterialSymbol icon="arrow_drop_down" size={18} />}
          sx={{ textTransform: "none" }}
        >
          {triggerLabel}
        </Button>
      )}

      <Menu
        anchorEl={anchorRef.current}
        open={open}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {kinds.map((kind) => {
          const m = meta[kind];
          return (
            <MenuItem key={kind} onClick={() => handleSelect(kind)}>
              <ListItemIcon>
                <MaterialSymbol icon={m.icon} size={20} color={m.color} />
              </ListItemIcon>
              <ListItemText>{t(m.labelKey)}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
