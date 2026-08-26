/**
 * The licence-state chip, shared by the store tile, the store detail drawer
 * and the Installed table.
 *
 * Lifted out of `ExtensionsAdmin.tsx` unchanged, as a component that reaches
 * for `useTranslation` / `useDateFormat` itself rather than a closure over
 * them — three surfaces render this now, and a second implementation is
 * exactly how "Trial until …" and "Renews on …" would drift apart.
 */
import Chip from "@mui/material/Chip";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "@/hooks/useDateFormat";
import { ENTITLEMENT_COLOR, type EntitlementInfo } from "./types";

export default function EntitlementChip({ ent }: { ent: EntitlementInfo }) {
  const { t } = useTranslation("admin");
  const { formatDate: fmtDate } = useDateFormat();

  // Trials first: they have no grace window (expiry is a hard stop), so the
  // chip says exactly that — and an ended trial points at the fix.
  if (ent.trial === true && (ent.state === "active" || ent.state === "grace")) {
    return (
      <Chip
        size="small"
        color="info"
        label={t("extensions.entitlement.trialUntil", "Trial until {{date}}", {
          date: fmtDate(ent.expires_at),
        })}
      />
    );
  }
  if (ent.trial === true && ent.state === "expired") {
    return (
      <Chip
        size="small"
        color="warning"
        label={t("extensions.entitlement.trialEnded", "Trial ended — subscribe to reactivate")}
      />
    );
  }
  // Active + a known auto-renew state: say what actually happens on the
  // date — "renews" vs "will not renew" — instead of the ambiguous
  // "active until". Unknown (manual/offline licenses) keeps today's label.
  if (ent.state === "active" && ent.expires_at && ent.auto_renew === true) {
    return (
      <Chip
        size="small"
        color="success"
        label={t("extensions.entitlement.renewsOn", "Renews on {{date}}", {
          date: fmtDate(ent.expires_at),
        })}
      />
    );
  }
  if (ent.state === "active" && ent.expires_at && ent.auto_renew === false) {
    return (
      <Chip
        size="small"
        color="warning"
        label={t("extensions.entitlement.willNotRenew", "Expires {{date}} — will not renew", {
          date: fmtDate(ent.expires_at),
        })}
      />
    );
  }
  const label =
    ent.state === "free"
      ? t("extensions.entitlement.free", "Free")
      : ent.state === "active"
        ? ent.expires_at
          ? t("extensions.entitlement.activeUntil", "Active until {{date}}", {
              date: fmtDate(ent.expires_at),
            })
          : t("extensions.entitlement.active", "Active")
        : ent.state === "grace"
          ? t("extensions.entitlement.grace", "Grace until {{date}}", {
              date: fmtDate(ent.grace_until),
            })
          : ent.state === "expired"
            ? t("extensions.entitlement.expired", "Expired")
            : t("extensions.entitlement.unlicensed", "Unlicensed");
  return <Chip size="small" color={ENTITLEMENT_COLOR[ent.state]} label={label} />;
}
