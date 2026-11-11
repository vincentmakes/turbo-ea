/**
 * A compact strip of a revision chain ("Revisions: Rev 1 · Rev 2 · Rev 3"),
 * shared by decisions and SoAWs. The revision on screen is highlighted, the
 * chain's current revision is tagged, and every other revision is a link.
 * Nothing renders for a chain of one.
 */
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router";
import { useTranslation } from "react-i18next";

import { useDateFormat } from "@/hooks/useDateFormat";
import type { DecisionRevision, DecisionStanding, SoAWRevision } from "@/types";
import {
  STANDING_CHIP,
  STATUS_CHIP,
  revisionLabel,
  standingLabelKey,
  type Translate,
} from "./decisionStanding";

export interface RevisionStripItem {
  id: string;
  label: string;
  /** Workflow status (`draft`, `in_review`, `approved`, `signed`). */
  status: string;
  standing?: DecisionStanding | null;
  signedAt?: string | null;
}

/** Status label keys, SoAW's `approved` included. */
const STATUS_LABEL_KEYS: Record<string, string> = {
  draft: "status.draft",
  in_review: "status.inReview",
  approved: "status.approved",
  signed: "status.signed",
};

/** Strip items for a decision chain (`GET /adr/{id}` → `revisions`). */
export function decisionRevisionItems(
  revisions: DecisionRevision[],
  t: Translate,
): RevisionStripItem[] {
  return revisions.map((r) => ({
    id: r.id,
    label: revisionLabel(r.revision_number, t),
    status: r.status,
    standing: r.standing,
  }));
}

/** Strip items for a SoAW chain (`GET /soaw/{id}` → `revisions`). */
export function soawRevisionItems(revisions: SoAWRevision[], t: Translate): RevisionStripItem[] {
  return revisions.map((r) => ({
    id: r.id,
    label: revisionLabel(r.revision_number, t),
    status: r.status,
    signedAt: r.signed_at ?? null,
  }));
}

/** Whether the strip shows at all: a chain of one has nothing to show. */
export function showsRevisionStrip(items: readonly RevisionStripItem[]): boolean {
  return items.length > 1;
}

export interface RevisionStripProps {
  items: RevisionStripItem[];
  /** The revision on screen: highlighted, not a link. */
  activeId: string;
  /** The chain's current revision, tagged "Current". */
  currentId?: string | null;
  /** In-app path of a revision; the chips render as router links. */
  hrefFor?: (id: string) => string;
  /** Click handler, used when `hrefFor` is not given. */
  onOpen?: (id: string) => void;
}

export default function RevisionStrip({
  items,
  activeId,
  currentId,
  hrefFor,
  onOpen,
}: RevisionStripProps) {
  const { t } = useTranslation("delivery");
  const { formatDate } = useDateFormat();
  if (!showsRevisionStrip(items)) return null;

  return (
    <Box
      component="nav"
      aria-label={t("adr.revision.strip")}
      sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75 }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        {t("adr.revision.strip")}
      </Typography>
      {items.map((item) => {
        const active = item.id === activeId;
        const isCurrent = item.id === currentId;
        const tip = [
          t(STATUS_LABEL_KEYS[item.status] ?? "status.draft"),
          item.standing ? t(standingLabelKey(item.standing)) : null,
          item.signedAt ? t("adr.revision.signedOn", { date: formatDate(item.signedAt) }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const dot =
          (item.standing && STANDING_CHIP[item.standing]?.dot) ||
          STATUS_CHIP[item.status as keyof typeof STATUS_CHIP]?.dot ||
          STATUS_CHIP.draft.dot;
        const label = (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            <Box
              component="span"
              sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: dot, flexShrink: 0 }}
            />
            {item.label}
            {isCurrent && (
              <Box component="span" sx={{ fontWeight: 600 }}>
                {`· ${t("adr.revision.current")}`}
              </Box>
            )}
          </Box>
        );
        const linkProps = active
          ? {}
          : hrefFor
            ? { component: RouterLink, to: hrefFor(item.id), clickable: true }
            : onOpen
              ? { onClick: () => onOpen(item.id), clickable: true }
              : {};
        return (
          <Tooltip key={item.id} title={tip} arrow>
            <Chip
              size="small"
              label={label}
              color={active ? "primary" : "default"}
              variant={active ? "filled" : "outlined"}
              aria-current={active ? "page" : undefined}
              data-testid={`revision-${item.id}`}
              {...linkProps}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}
