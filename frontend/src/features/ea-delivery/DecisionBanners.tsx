/**
 * The banners on top of a decision (or a SoAW) page that say where it stands:
 * an earlier revision pointing to the current one, superseded, revoked,
 * amended, scheduled, expired, a change scheduled to take effect, a revision
 * being drafted, an amendment consolidated elsewhere, the review outcome
 * (changes requested, rejected, withdrawn: who, when and why), the in-review
 * and closed locks, and the "recorded, not signed" line.
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

import LinkifiedText from "@/components/LinkifiedText";
import { useDateFormat } from "@/hooks/useDateFormat";
import type { ArchitectureDecision, DecisionRef, ReviewOutcome, ReviewOutcomeKind, SoAW } from "@/types";
import { decisionRefLabel, revisionLabel, type Translate } from "./decisionStanding";
import { isClosed, outcomeKind, outcomeSentence } from "./reviewOutcome";

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
  /** Free text a person typed (a review outcome's reason), shown after the
   *  message through `LinkifiedText`. */
  reason?: string;
}

/** Banner id and severity per outcome kind. */
const OUTCOME_BANNER: Record<ReviewOutcomeKind, { id: string; severity: AlertColor }> = {
  changes_requested: { id: "changes-requested", severity: "warning" },
  rejected: { id: "rejected", severity: "error" },
  withdrawn: { id: "withdrawn", severity: "info" },
};

/**
 * The review outcome banner of a decision or SoAW draft: "Rejected by Ada on
 * 27 Nov 2026:" followed by the reason. Null when there is no outcome (or the
 * document is no longer a draft).
 */
function outcomeBanner(
  doc: { status?: string; outcome?: ReviewOutcome | null },
  t: Translate,
  formatDate: (value: string | null | undefined) => string,
): Banner | null {
  const kind = outcomeKind(doc);
  const message = outcomeSentence(doc, t, formatDate);
  if (!kind || message === null) return null;
  const spec = OUTCOME_BANNER[kind];
  // The reason is free text: it is rendered after the message, linkified, and
  // never interpolated into the translated sentence.
  return {
    id: spec.id,
    severity: spec.severity,
    message,
    links: [],
    reason: doc.outcome?.note || t("collab.discussion.noReason"),
  };
}

/** The lock line of a closed document (editor only). */
function closedLockBanner(t: Translate): Banner {
  return { id: "closed-lock", severity: "info", message: t("adr.banner.closedLock"), links: [] };
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

  const outcome = outcomeBanner(adr, t, formatDate);
  if (outcome) out.push(outcome);

  if (mode === "editor" && adr.status === "in_review") {
    out.push({ id: "in-review", severity: "info", message: t("adr.banner.inReviewLock"), links: [] });
  }
  if (mode === "editor" && isClosed(adr)) {
    out.push(closedLockBanner(t));
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

type SoawBannerFields = Pick<
  SoAW,
  "status" | "is_earlier_revision" | "superseded_by" | "open_revision" | "outcome"
>;

/** The SoAW page's banners: earlier revision, revision being drafted, the
 *  review outcome, the review and closed locks. */
export function buildSoawBanners(
  soaw: SoawBannerFields,
  {
    mode,
    t,
    formatDate = (v) => v ?? "",
  }: Omit<BuildOptions, "formatDate"> & { formatDate?: BuildOptions["formatDate"] },
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
  const outcome = outcomeBanner(soaw, t, formatDate);
  if (outcome) out.push(outcome);
  if (mode === "editor" && soaw.status === "in_review") {
    out.push({ id: "in-review", severity: "info", message: t("adr.banner.inReviewLock"), links: [] });
  }
  if (mode === "editor" && isClosed(soaw)) {
    out.push(closedLockBanner(t));
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
            {b.reason !== undefined && (
              <>
                {" "}
                <Box component="span" data-banner-reason sx={{ whiteSpace: "pre-wrap" }}>
                  <LinkifiedText text={b.reason} />
                </Box>
              </>
            )}
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
  soaw: SoawBannerFields;
  mode: BannerMode;
  /** Where a SoAW link goes; defaults to the SoAW editor route. */
  hrefFor?: (id: string) => string;
}

export function SoawBanners({ soaw, mode, hrefFor = soawHref }: SoawBannersProps) {
  const { t } = useTranslation("delivery");
  const { formatDate } = useDateFormat();
  return <BannerList banners={buildSoawBanners(soaw, { mode, t, formatDate })} hrefFor={hrefFor} />;
}
