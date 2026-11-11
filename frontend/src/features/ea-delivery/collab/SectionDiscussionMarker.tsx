/**
 * The marker beside a section's heading: a small icon button, drawn like a
 * miniature of the page's chat button. With open threads it is the `forum`
 * icon under a small warning badge carrying the open-thread count; once every
 * thread on the section is resolved, the same icon muted and without a badge;
 * and, on a section with no thread, a muted `add_comment` icon (weighted and
 * mirrored, `ADD_GLYPH`) for a reader who may comment only (nothing for one who may not). Nothing outside a saved
 * document's side panel. Clicking it, in every state, opens the Discussion
 * filtered to the section with the section chosen for a new thread. Screen
 * only: never printed, and the export builders never see it.
 */
import { useContext, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { iconSize } from "@/theme/tokens";
import { SectionDiscussionContext } from "./sectionDiscussionContext";

/**
 * The "add a comment" glyph as people know it: a firm stroke and the bubble's
 * tail at the bottom right. Material Symbols draws `add_comment` thin with
 * the tail on the left, so it is weighted and mirrored (the plus is
 * symmetric); beside a heading the thin one read as a small box.
 */
const ADD_GLYPH: CSSProperties = { fontVariationSettings: "'wght' 600", transform: "scaleX(-1)" };

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
  const icon = threads ? (
    <MaterialSymbol icon="forum" size={iconSize.md} />
  ) : (
    <MaterialSymbol icon="add_comment" size={iconSize.md} style={ADD_GLYPH} />
  );
  return (
    <Tooltip title={label}>
      <IconButton
        className="no-print"
        data-testid={`section-marker-${section}`}
        size="small"
        aria-label={label}
        onClick={() => ctx.openSection(section)}
        sx={{
          ml: 0.5,
          verticalAlign: "middle",
          color: open ? undefined : "text.secondary",
          "@media print": { display: "none" },
        }}
      >
        {open ? (
          <Badge
            badgeContent={entry.open}
            color="warning"
            overlap="circular"
            sx={{ "& .MuiBadge-badge": { height: 16, minWidth: 16, px: 0.5, fontSize: "0.625rem" } }}
          >
            {icon}
          </Badge>
        ) : (
          icon
        )}
      </IconButton>
    </Tooltip>
  );
}
