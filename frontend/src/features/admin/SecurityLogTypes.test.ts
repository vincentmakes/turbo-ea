import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { STATUS_COLORS, brand } from "@/theme/tokens";
import { fieldLabelKey, formatTarget } from "./securityLogDetails";
import {
  SECURITY_CATEGORIES,
  SECURITY_OUTCOMES,
  actionLabelKey,
  categoryColor,
  outcomeColor,
  reasonLabelKey,
} from "./SecurityLogTypes";

describe("SecurityLogTypes", () => {
  it("flattens a dotted action into one i18n key", () => {
    expect(actionLabelKey("auth.login.failed")).toBe("securityLog.actionLabels.auth_login_failed");
    expect(actionLabelKey("access.audit_log.exported")).toBe(
      "securityLog.actionLabels.access_audit_log_exported",
    );
    expect(actionLabelKey("plain")).toBe("securityLog.actionLabels.plain");
  });

  it("names a reason code's key", () => {
    expect(reasonLabelKey("bad_password")).toBe("securityLog.reasons.bad_password");
  });

  it("every PR A action and reason has an English label", () => {
    const actions = [
      "auth.login.succeeded",
      "auth.login.failed",
      "auth.login.locked",
      "auth.logout",
      "auth.sso.succeeded",
      "auth.sso.failed",
      "auth.proxy_session.succeeded",
      "auth.proxy_session.failed",
      "auth.register",
      "auth.password.set",
      "auth.password.reset_requested",
      "auth.password.reset",
      "auth.password.changed",
      "auth.impersonation.started",
      "auth.impersonation.stopped",
      "access.audit_log.exported",
    ];
    for (const a of actions) {
      expect(i18n.exists(`admin:${actionLabelKey(a)}`), a).toBe(true);
    }
    for (const r of ["unknown_user", "bad_password", "locked", "hd_mismatch", "local_account"]) {
      expect(i18n.exists(`admin:${reasonLabelKey(r)}`), r).toBe(true);
    }
    for (const c of SECURITY_CATEGORIES) expect(i18n.exists(`admin:securityLog.categories.${c}`)).toBe(true);
    for (const o of SECURITY_OUTCOMES) expect(i18n.exists(`admin:securityLog.outcomes.${o}`)).toBe(true);
  });

  it("labels a decision recorded as decided, its target and its context fields", () => {
    const t = i18n.getFixedT("en", "admin");
    expect(t(actionLabelKey("admin.adr.recorded"))).toBe("Decision recorded as decided");
    expect(
      formatTarget(
        {
          target_type: "architecture_decision",
          target_id: "00000000-0000-4000-8000-000000000001",
          target_label: "ADR-012 · Rev 2 — Adopt Kafka",
        },
        (key, opts) => t(key, opts),
      ),
    ).toBe("Architecture decision · ADR-012 · Rev 2 — Adopt Kafka");
    const field = (name: string) => t(fieldLabelKey(name, "architecture_decision"));
    expect(field("decided_on")).toBe("Decided on");
    expect(field("effective_from")).toBe("Effective from");
    expect(field("decision_makers")).toBe("Decision makers");
  });

  it("colours categories and outcomes from the design tokens", () => {
    expect(categoryColor("auth")).toBe(STATUS_COLORS.info);
    expect(categoryColor("admin")).toBe(STATUS_COLORS.warning);
    expect(categoryColor("access")).toBe(brand.primary);
    expect(categoryColor("other")).toBe(STATUS_COLORS.neutral);
    expect(outcomeColor("success")).toBe(STATUS_COLORS.success);
    expect(outcomeColor("failure")).toBe(STATUS_COLORS.error);
    expect(outcomeColor("??")).toBe(STATUS_COLORS.neutral);
  });
});
