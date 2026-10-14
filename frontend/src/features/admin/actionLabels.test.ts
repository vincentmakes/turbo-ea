/**
 * Contract test: every administrative action the backend records in the
 * Security & admin log has a label, in English and in every shipped locale.
 *
 * The list is hard-coded on purpose — it is the catalogue the backend writes
 * (`audit_log.record(action=...)`) and that `docs/admin/audit-log.md`
 * documents. An action missing a label would render as its raw dotted key.
 */
import { describe, expect, it } from "vitest";

import i18n, { SUPPORTED_LOCALES } from "@/i18n";
import en from "@/i18n/locales/en/admin.json";
import { actionLabelKey } from "./SecurityLogTypes";

const ADMIN_ACTIONS = [
  "admin.user.created",
  "admin.user.updated",
  "admin.user.deleted",
  "admin.user.bulk_updated",
  "admin.user.bulk_deleted",
  "admin.user.unlocked",
  "admin.user.invitation.resent",
  "admin.user.invitation.deleted",
  "admin.role.created",
  "admin.role.updated",
  "admin.role.archived",
  "admin.role.restored",
  "admin.stakeholder_role.created",
  "admin.stakeholder_role.updated",
  "admin.stakeholder_role.deleted",
  "admin.stakeholder_role.archived",
  "admin.stakeholder_role.restored",
  "admin.settings.updated",
  "admin.metamodel.type.created",
  "admin.metamodel.type.updated",
  "admin.metamodel.type.deleted",
  "admin.metamodel.type.references_generated",
  "admin.metamodel.relation_type.created",
  "admin.metamodel.relation_type.updated",
  "admin.metamodel.relation_type.deleted",
  "admin.metamodel.relation_type.restored",
  "admin.metamodel.resource_type.created",
  "admin.metamodel.resource_type.updated",
  "admin.metamodel.resource_type.deleted",
  "admin.principle.created",
  "admin.principle.updated",
  "admin.principle.deleted",
  "admin.principle.imported",
  "admin.regulation.created",
  "admin.regulation.updated",
  "admin.regulation.deleted",
  "admin.tag_group.created",
  "admin.tag_group.updated",
  "admin.tag_group.deleted",
  "admin.tag.created",
  "admin.tag.updated",
  "admin.tag.deleted",
  "admin.calculation.created",
  "admin.calculation.updated",
  "admin.calculation.deleted",
  "admin.calculation.activated",
  "admin.calculation.deactivated",
  "admin.calculation.recalculated",
  "admin.extension.license.updated",
  "admin.extension.license.removed",
  "admin.extension.install.uploaded",
  "admin.extension.install.applied",
  "admin.extension.install.discarded",
  "admin.extension.store.claimed",
  "admin.extension.store.refreshed",
  "admin.extension.store.installed",
  "admin.extension.enabled",
  "admin.extension.disabled",
  "admin.extension.uninstalled",
  "admin.workspace.import.uploaded",
  "admin.workspace.import.applied",
  "admin.workspace.import.completed",
  "admin.workspace.import.discarded",
  "admin.migration.uploaded",
  "admin.migration.field_mappings.updated",
  "admin.migration.applied",
  "admin.migration.deleted",
  "admin.servicenow.connection.created",
  "admin.servicenow.connection.updated",
  "admin.servicenow.connection.deleted",
  "admin.servicenow.mapping.created",
  "admin.servicenow.mapping.updated",
  "admin.servicenow.mapping.deleted",
  "admin.servicenow.sync.pulled",
  "admin.servicenow.sync.pushed",
  "admin.servicenow.sync.applied",
  "admin.web_portal.created",
  "admin.web_portal.updated",
  "admin.web_portal.deleted",
  "admin.diagram.published",
  "admin.diagram.unpublished",
  "admin.survey.sent",
  "admin.survey.closed",
  "admin.ops.rescue_access.granted",
  "admin.ops.rescue_access.revoked",
] as const;

describe("administrative action labels", () => {
  it("lists every action once", () => {
    expect(new Set(ADMIN_ACTIONS).size).toBe(ADMIN_ACTIONS.length);
  });

  it("has a non-empty English label for every action", () => {
    const labels = en as Record<string, string>;
    for (const action of ADMIN_ACTIONS) {
      const label = labels[actionLabelKey(action)];
      expect(typeof label === "string" && label.trim().length > 0, action).toBe(true);
      expect(label, action).not.toBe(action);
    }
  });

  it("has a label for every action in every shipped locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const bundle = i18n.getResourceBundle(locale, "admin") as Record<string, string>;
      for (const action of ADMIN_ACTIONS) {
        const label = bundle[actionLabelKey(action)];
        expect(typeof label === "string" && label.trim().length > 0, `${locale}: ${action}`).toBe(
          true,
        );
      }
    }
  });

  it("labels the Users page lockout controls", () => {
    for (const key of ["locked", "lockedUntil", "unlock", "unlockSuccess", "unlockFailed"]) {
      expect(i18n.exists(`admin:users.${key}`), key).toBe(true);
    }
    expect(i18n.t("admin:users.lockedUntil", { time: "T", lng: "en" })).toBe("Locked until T");
  });
});
