/**
 * The marker beside a section's heading: a small chip with the open-thread
 * count in the warning colour (the panel badge's); muted and without a number
 * once every thread on it is resolved; and, on a section with no thread, a
 * muted "add comment" chip of the same size, for a reader who may comment
 * only (nothing for one who may not). Nothing outside a saved document's side
 * panel. Clicking it, in every state, opens the Discussion filtered to the
 * section with the section chosen for a new thread. Screen only: never
 * printed, and the export builders never see it.
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
  if (!ctx) return null;
  const entry = ctx.counts[section];
  const threads = entry !== undefined && entry.total > 0;
  if (!threads && !ctx.canComment) return null;
  const open = threads && entry.open > 0;
  const label = open
    ? t("collab.marker.open", { count: entry.open })
    : threads
      ? t("collab.marker.resolved")
      : t("collab.marker.add");
  return (
    <Tooltip title={label}>
      <Chip
        className="no-print"
        data-testid={`section-marker-${section}`}
        size="small"
        variant={open ? "filled" : "outlined"}
        color={open ? "warning" : "default"}
        icon={<MaterialSymbol icon={threads ? "forum" : "add_comment"} size={16} />}
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
