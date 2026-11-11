/**
 * The marker beside a section's heading that says the section has discussion:
 * a small chip with the open-thread count in the warning colour (the panel
 * badge's), or muted and without a number once every thread on it is
 * resolved. Nothing for a section with no thread, or outside a saved
 * document's side panel. Clicking it opens the Discussion filtered to the
 * section. Screen only: never printed, and the export builders never see it.
 */
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { SectionDiscussionContext } from "./sectionDiscussionContext";

interface Props {
  /** The section's key, as the discussion tags threads (`sectionOptions`). */
  section: string;
}

export default function SectionDiscussionMarker({ section }: Props) {
  const { t } = useTranslation("delivery");
  const ctx = useContext(SectionDiscussionContext);
  const entry = ctx?.counts[section];
  if (!ctx || !entry || entry.total === 0) return null;
  const open = entry.open > 0;
  const label = open ? t("collab.marker.open", { count: entry.open }) : t("collab.marker.resolved");
  return (
    <Tooltip title={label}>
      <Chip
        className="no-print"
        data-testid={`section-marker-${section}`}
        size="small"
        variant={open ? "filled" : "outlined"}
        color={open ? "warning" : "default"}
        icon={<MaterialSymbol icon="forum" size={16} />}
        label={open ? entry.open : undefined}
        aria-label={label}
        onClick={() => ctx.openSection(section)}
        sx={{
          ml: 1,
          verticalAlign: "middle",
          color: open ? undefined : "text.secondary",
          "& .MuiChip-label": open ? undefined : { display: "none" },
          "& .MuiChip-icon": open ? undefined : { mx: 0.5, color: "text.secondary" },
          "@media print": { display: "none" },
        }}
      />
    </Tooltip>
  );
}
