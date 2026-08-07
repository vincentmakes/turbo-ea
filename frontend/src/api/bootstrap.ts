/**
 * Bootstrap primer — fetches all small public boot-time settings in one
 * round-trip and pushes them into the per-hook singleton caches before any
 * hook component mounts. Replaces what used to be ~8 sequential GETs against
 * /settings/* with a single GET against /settings/bootstrap.
 *
 * Per-hook fetches still exist as a fallback (so each hook works in isolation
 * for tests and for refreshes after admin edits). They become no-ops when this
 * primer has already populated the cache.
 *
 * Order of operations: useAuth.loadUser() awaits auth.me() and then kicks off
 * primeBootstrap() before setting the user. By the time the authenticated UI
 * mounts and its hooks subscribe, the cache is either already populated or
 * has an inflight promise the hooks can attach to.
 */
import { api } from "@/api/client";
import {
  invalidateDateFormat,
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  type DateFormatKey,
} from "@/hooks/useDateFormat";
import { invalidateAppTitle } from "@/hooks/useAppTitle";
import { invalidateCurrency } from "@/hooks/useCurrency";
import { invalidateBpmEnabled } from "@/hooks/useBpmEnabled";
import { invalidateComplianceRegulations } from "@/hooks/useComplianceRegulations";
import { invalidateResourceTypes } from "@/hooks/useResourceTypes";
import { invalidateGrcEnabled } from "@/hooks/useGrcEnabled";
import { invalidateSponsorButtonEnabled } from "@/hooks/useSponsorButtonEnabled";
import { invalidatePpmEnabled } from "@/hooks/usePpmEnabled";
import { invalidateArchiveRetentionDays } from "@/hooks/useArchiveRetentionDays";
import { invalidateFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import { invalidateEnabledLocalesGlobal } from "@/hooks/useEnabledLocales";
import { invalidateLoginBranding } from "@/hooks/useLoginBranding";
import { invalidateNavbarStyle } from "@/hooks/useNavbarStyle";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";
import type { ComplianceRegulation, ResourceType } from "@/types";

type BootstrapResponse = {
  currency: string;
  date_format: string;
  app_title: string;
  navbar_bg: string;
  navbar_fg: string;
  bpm_enabled: boolean;
  ppm_enabled: boolean;
  turbolens_enabled: boolean;
  grc_enabled: boolean;
  sponsor_button_enabled: boolean;
  file_uploads_enabled: boolean;
  enabled_locales: string[];
  fiscal_year_start: number;
  archive_retention_days: number;
  bpm_row_order: string[];
  show_principles_tab: boolean;
  compliance_regulations: ComplianceRegulation[];
  resource_types: ResourceType[];
  login_tagline: string;
  login_tagline_hidden: boolean;
  login_help_text: string;
  login_help_link: string;
  smtp_configured: boolean;
};

let _primed = false;
let _inflight: Promise<void> | null = null;

/**
 * Fetch /settings/bootstrap once per session and prime the singleton caches
 * of each per-setting hook. Subsequent calls are no-ops. Call after the user
 * is authenticated (the underlying singletons require an auth token).
 */
export function primeBootstrap(): Promise<void> {
  if (_primed) return Promise.resolve();
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const r = await api.get<BootstrapResponse>("/settings/bootstrap");

      invalidateCurrency(r.currency);

      const fmt: DateFormatKey = (DATE_FORMAT_OPTIONS as string[]).includes(r.date_format)
        ? (r.date_format as DateFormatKey)
        : DEFAULT_DATE_FORMAT;
      invalidateDateFormat(fmt);

      invalidateAppTitle(r.app_title);

      // invalidateNavbarStyle validates the hex values itself.
      invalidateNavbarStyle({ bg: r.navbar_bg, fg: r.navbar_fg });

      invalidateBpmEnabled(r.bpm_enabled);
      invalidatePpmEnabled(r.ppm_enabled);
      invalidateGrcEnabled(r.grc_enabled);
      invalidateSponsorButtonEnabled(r.sponsor_button_enabled);
      invalidateFileUploadsEnabled(r.file_uploads_enabled);

      if (typeof r.archive_retention_days === "number") {
        invalidateArchiveRetentionDays(r.archive_retention_days);
      }

      const validLocales = r.enabled_locales.filter((l): l is SupportedLocale =>
        (SUPPORTED_LOCALES as readonly string[]).includes(l),
      );
      invalidateEnabledLocalesGlobal(
        validLocales.length > 0 ? validLocales : [...SUPPORTED_LOCALES],
      );

      invalidateComplianceRegulations(
        Array.isArray(r.compliance_regulations) ? r.compliance_regulations : [],
      );

      invalidateResourceTypes(
        Array.isArray(r.resource_types) ? r.resource_types : [],
      );

      invalidateLoginBranding({
        tagline: r.login_tagline || "",
        taglineHidden: Boolean(r.login_tagline_hidden),
        helpText: r.login_help_text || "",
        helpLink: r.login_help_link || "",
        smtpConfigured: Boolean(r.smtp_configured),
      });

      _primed = true;
    } catch {
      // Best-effort — if bootstrap fails, each per-hook fetch still works as
      // an independent fallback. Silently swallow so we don't disrupt boot.
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Reset for tests + after logout so the next session re-primes. */
export function resetBootstrap(): void {
  _primed = false;
  _inflight = null;
}
