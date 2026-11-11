/**
 * The banners on top of a decision (or a SoAW) page that say where it stands:
 * an earlier revision pointing to the current one, superseded, revoked,
 * amended, scheduled, expired, a change scheduled to take effect, a revision
 * being drafted, an amendment consolidated elsewhere, the in-review lock, and
 * the "recorded, not signed" line.
 *
 * Presentational only: everything is computed from the payload the page
 * already holds. `buildDecisionBanners` / `buildSoawBanners` are the pure part.
 */
import Alert, { type AlertColor } from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { Link as RouterLink } from "react-router";
import { useTranslation } from "react-i18next";

import { useDateFormat } from "@/hooks/useDateFormat";
import type { ArchitectureDecision, DecisionRef, SoAW } from "@/types";
import { decisionRefLabel, revisionLabel, type Translate } from "./decisionStanding";

export type BannerMode = "editor" | "preview";

export interface BannerLink {
  id: string;
  label: string;
}

export interface Banner {
  /** Stable key, also the banner's `data-banner` attribute. */
  id: string;
  severity: AlertColor;
  message: string;
  links: BannerLink[];
  /** Offer "Create consolidated revision". */
  consolidate?: boolean;
}

interface BuildOptions {
  mode: BannerMode;
  t: Translate;
  formatDate: (value: string | null | undefined) => string;
}

/** The decision page's banners, top to bottom. */
export function buildDecisionBanners(
  adr: ArchitectureDecision,
  { mode, t, formatDate, canConsolidate = false }: BuildOptions & { canConsolidate?: boolean },
): Banner[] {
  const ref = (r: DecisionRef) => decisionRefLabel(r, t);
  const open = (r: DecisionRef, labelKey = "adr.banner.open"): BannerLink => ({
    id: r.id,
    label: t(labelKey),
  });
  const out: Banner[] = [];

  if (adr.is_earlier_revision && adr.superseded_by) {
    out.push({
      id: "earlier-revision",
      severity: "warning",
      message: t("adr.banner.earlierRevision", { current: ref(adr.superseded_by) }),
      links: [open(adr.superseded_by, "adr.banner.openCurrent")],
    });
  } else if (adr.standing === "superseded" && adr.superseded_by) {
    out.push({
      id: "superseded",
      severity: "warning",
      message: t("adr.banner.supersededBy", { by: ref(adr.superseded_by) }),
      links: [open(adr.superseded_by)],
    });
  }

  if (adr.standing === "revoked" && adr.revoked_by) {
    out.push({
      id: "revoked",
      severity: "error",
      message: t("adr.banner.revokedBy", { by: ref(adr.revoked_by) }),
      links: [open(adr.revoked_by)],
    });
  }

  const amendedBy = adr.amended_by ?? [];
  if (adr.standing === "amended" && amendedBy.length > 0) {
    out.push({
      id: "amended",
      severity: "info",
      message: t("adr.banner.amendedBy"),
      links: amendedBy.map((r) => ({ id: r.id, label: ref(r) })),
      consolidate: canConsolidate,
    });
  }

  if (adr.standing === "scheduled") {
    out.push({
      id: "scheduled",
      severity: "info",
      message: t("adr.banner.scheduled", { date: formatDate(adr.effective_from) }),
      links: [],
    });
  }

  if (adr.standing === "expired") {
    out.push({
      id: "expired",
      severity: "warning",
      message: t("adr.banner.expired", { date: formatDate(adr.valid_until) }),
      links: [],
    });
  }

  for (const change of adr.upcoming ?? []) {
    const date = formatDate(change.effective_from);
    const message =
      change.kind === "revision"
        ? t("adr.banner.upcomingRevision", { number: change.by.revision_number, date })
        : change.kind === "replaces"
          ? t("adr.banner.willBeReplaced", { by: ref(change.by), date })
          : t("adr.banner.willBeRevoked", { by: ref(change.by), date });
    out.push({
      id: `upcoming-${change.kind}-${change.by.id}`,
      severity: "info",
      message,
      links: [open(change.by)],
    });
  }

  if (adr.open_revision) {
    out.push({
      id: "open-revision",
      severity: "info",
      message: t("adr.banner.openRevision", { revision: ref(adr.open_revision) }),
      links: [open(adr.open_revision)],
    });
  }

  if (adr.consolidated_into) {
    out.push({
      id: "consolidated",
      severity: "info",
      message: t("adr.banner.consolidatedInto", { into: ref(adr.consolidated_into) }),
      links: [open(adr.consolidated_into)],
    });
  }

  if (mode === "editor" && adr.status === "in_review") {
    out.push({ id: "in-review", severity: "info", message: t("adr.banner.inReviewLock"), links: [] });
  }

  if (adr.status === "signed" && adr.recorded_at) {
    const name = adr.recorded_by?.display_name;
    const date = formatDate(adr.recorded_at);
    out.push({
      id: "recorded",
      severity: "info",
      message: name
        ? t("adr.banner.recorded", { name, date })
        : t("adr.banner.recordedNoName", { date }),
      links: [],
    });
  }

  return out;
}

/** The SoAW page's banners: earlier revision, revision being drafted, review lock. */
export function buildSoawBanners(
  soaw: Pick<SoAW, "status" | "is_earlier_revision" | "superseded_by" | "open_revision">,
  { mode, t }: Omit<BuildOptions, "formatDate">,
): Banner[] {
  const out: Banner[] = [];
  if (soaw.is_earlier_revision && soaw.superseded_by) {
    out.push({
      id: "earlier-revision",
      severity: "warning",
      message: t("adr.banner.earlierRevision", {
        current: revisionLabel(soaw.superseded_by.revision_number, t),
      }),
      links: [{ id: soaw.superseded_by.id, label: t("adr.banner.openCurrent") }],
    });
  }
  if (soaw.open_revision) {
    out.push({
      id: "open-revision",
      severity: "info",
      message: t("adr.banner.openRevision", {
        revision: revisionLabel(soaw.open_revision.revision_number, t),
      }),
      links: [{ id: soaw.open_revision.id, label: t("adr.banner.open") }],
    });
  }
  if (mode === "editor" && soaw.status === "in_review") {
    out.push({ id: "in-review", severity: "info", message: t("adr.banner.inReviewLock"), links: [] });
  }
  return out;
}

function BannerList({
  banners,
  hrefFor,
  onCreateConsolidatedRevision,
}: {
  banners: Banner[];
  hrefFor: (id: string) => string;
  onCreateConsolidatedRevision?: () => void;
}) {
  const { t } = useTranslation("delivery");
  if (banners.length === 0) return null;
  return (
    <Stack spacing={1}>
      {banners.map((b) => {
        // A single pointer sits in the Alert's action slot; a list of them
        // (the amending decisions) follows the message.
        const single = b.links.length === 1 && !b.consolidate ? b.links[0] : null;
        return (
          <Alert
            key={b.id}
            severity={b.severity}
            data-banner={b.id}
            action={
              single ? (
                <Button component={RouterLink} to={hrefFor(single.id)} color="inherit" size="small">
                  {single.label}
                </Button>
              ) : undefined
            }
          >
            {b.message}
            {!single && (b.links.length > 0 || b.consolidate) && (
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mt: 0.5 }}>
                {b.links.map((l) => (
                  <Button
                    key={l.id}
                    component={RouterLink}
                    to={hrefFor(l.id)}
                    color="inherit"
                    size="small"
                    variant="outlined"
                  >
                    {l.label}
                  </Button>
                ))}
                {b.consolidate && onCreateConsolidatedRevision && (
                  <Button size="small" variant="contained" onClick={onCreateConsolidatedRevision}>
                    {t("adr.banner.createConsolidated")}
                  </Button>
                )}
              </Box>
            )}
          </Alert>
        );
      })}
    </Stack>
  );
}

export const decisionHref = (id: string) => `/ea-delivery/adr/${id}`;
export const soawHref = (id: string) => `/ea-delivery/soaw/${id}`;

export interface DecisionBannersProps {
  adr: ArchitectureDecision;
  mode: BannerMode;
  /** Where a decision link goes; defaults to the decision editor route. */
  hrefFor?: (id: string) => string;
  /** When given, the amended banner offers "Create consolidated revision". */
  onCreateConsolidatedRevision?: () => void;
}

export default function DecisionBanners({
  adr,
  mode,
  hrefFor = decisionHref,
  onCreateConsolidatedRevision,
}: DecisionBannersProps) {
  const { t } = useTranslation("delivery");
  const { formatDate } = useDateFormat();
  const banners = buildDecisionBanners(adr, {
    mode,
    t,
    formatDate,
    canConsolidate: Boolean(onCreateConsolidatedRevision),
  });
  return (
    <BannerList
      banners={banners}
      hrefFor={hrefFor}
      onCreateConsolidatedRevision={onCreateConsolidatedRevision}
    />
  );
}

export interface SoawBannersProps {
  soaw: Pick<SoAW, "status" | "is_earlier_revision" | "superseded_by" | "open_revision">;
  mode: BannerMode;
  /** Where a SoAW link goes; defaults to the SoAW editor route. */
  hrefFor?: (id: string) => string;
}

export function SoawBanners({ soaw, mode, hrefFor = soawHref }: SoawBannersProps) {
  const { t } = useTranslation("delivery");
  return <BannerList banners={buildSoawBanners(soaw, { mode, t })} hrefFor={hrefFor} />;
}
