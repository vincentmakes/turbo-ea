/**
 * The Security & admin entry drawer: read-only metadata plus the `details`
 * payload in plain language — change sentences, a labelled Field / Before /
 * After table, a labelled context list, and JSON only for what fits none.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

vi.mock("@/hooks/useDateFormat", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDateFormat")>("@/hooks/useDateFormat");
  return {
    ...actual,
    useDateFormat: () => ({
      dateFormat: "YYYY-MM-DD",
      loading: false,
      formatDate: (d?: string | null) => (d ? `D[${d}]` : ""),
      formatDateTime: (d?: string | null) => (d ? `DT[${d}]` : ""),
      invalidate: vi.fn(),
      example: "",
    }),
  };
});

import SecurityLogEntryDrawer, { flattenAppSchema } from "./SecurityLogEntryDrawer";
import type { SecurityLogEntry } from "./SecurityLogTypes";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const EMPTY = "—";
const YES = i18n.t("common:labels.yes") as string;
const NO = i18n.t("common:labels.no") as string;
const SECRET = t("securityLog.entry.masked");
const field = (k: string) => t(`securityLog.fields.${k}`);

beforeEach(() => {
  mockApi.reset();
});

function entry(overrides: Partial<SecurityLogEntry> = {}): SecurityLogEntry {
  return {
    id: "e1",
    created_at: "2026-03-02T10:00:00Z",
    category: "auth",
    action: "auth.login.failed",
    outcome: "failure",
    actor_user_id: null,
    actor_email: null,
    subject_email: "dana@example.com",
    target_type: null,
    target_id: null,
    target_label: null,
    ip: "203.0.113.7",
    user_agent: "Mozilla/5.0 (X11)",
    origin: "web",
    impersonator_user_id: null,
    impersonated_role: null,
    details: { reason: "bad_password" },
    ...overrides,
  };
}

function renderDrawer(e: SecurityLogEntry | null, onClose = vi.fn()) {
  const r = renderWithProviders(<SecurityLogEntryDrawer entry={e} open={e !== null} onClose={onClose} />);
  return { ...r, onClose };
}

describe("SecurityLogEntryDrawer", () => {
  it("renders nothing without an entry", () => {
    renderDrawer(null);
    expect(screen.queryByText(t("securityLog.entry.title"))).not.toBeInTheDocument();
  });

  it("shows the metadata and translates the reason code", () => {
    renderDrawer(entry());
    expect(screen.getByText(t("securityLog.entry.title"))).toBeInTheDocument();
    expect(screen.getByText(t("securityLog.actionLabels.auth_login_failed"))).toBeInTheDocument();
    expect(screen.getByText("auth.login.failed")).toBeInTheDocument();
    expect(screen.getByText(t("securityLog.categories.auth"))).toBeInTheDocument();
    expect(screen.getByText(t("securityLog.outcomes.failure"))).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.getByText("DT[2026-03-02T10:00:00Z]")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.7")).toBeInTheDocument();
    expect(screen.getByText("Mozilla/5.0 (X11)")).toBeInTheDocument();
    expect(screen.getByTestId("security-reason")).toHaveTextContent(t("securityLog.reasons.bad_password"));
    expect(screen.getByTestId("security-reason")).toHaveTextContent("(bad_password)");
    // `reason` was the only detail, and it is shown above — nothing else to list.
    expect(screen.getByText(t("securityLog.entry.noDetails"))).toBeInTheDocument();
  });

  it("falls back to raw keys for an unknown action, category, outcome and reason", () => {
    renderDrawer(
      entry({ action: "x.y", category: "zzz", outcome: "maybe", origin: null, details: { reason: "odd" } }),
    );
    expect(screen.getAllByText("x.y")).toHaveLength(2);
    expect(screen.getByText("zzz")).toBeInTheDocument();
    expect(screen.getByText("maybe")).toBeInTheDocument();
    expect(screen.getByTestId("security-reason")).toHaveTextContent("odd");
  });

  it("renders a field diff as a labelled table with formatted values", () => {
    renderDrawer(
      entry({
        category: "admin",
        action: "admin.settings.updated",
        outcome: "success",
        actor_email: "admin@example.com",
        target_type: "setting",
        target_label: "smtp",
        details: {
          smtp_host: { old: "a.example", new: "b.example" },
          smtp_password: { old: "***", new: "***" },
          smtp_port: { old: 25, new: null },
          tags: { old: ["x", "y"], new: true },
        },
      }),
    );
    const table = screen.getByTestId("security-details-diff");
    expect(within(table).getByText(t("securityLog.entry.field"))).toBeInTheDocument();
    expect(within(table).getByText(t("securityLog.entry.old"))).toBeInTheDocument();
    expect(within(table).getByText(t("securityLog.entry.new"))).toBeInTheDocument();
    // The stored field name stays available as the label's tooltip.
    expect(within(table).getByText(field("smtp_host"))).toHaveAttribute("aria-label", "smtp_host");
    expect(within(table).queryByText("smtp_host")).not.toBeInTheDocument();
    expect(within(table).getByText("a.example")).toBeInTheDocument();
    expect(within(table).getByText("b.example")).toBeInTheDocument();
    const secrets = within(table).getAllByText(SECRET);
    expect(secrets).toHaveLength(2);
    expect(secrets[0].closest(".MuiChip-root")).toHaveClass("MuiChip-outlined");
    expect(within(table).getByText("25")).toBeInTheDocument();
    expect(within(table).getByText(EMPTY)).toBeInTheDocument();
    expect(within(table).getByText("x, y")).toBeInTheDocument();
    expect(within(table).getByText(YES)).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-details-items")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-details-context")).not.toBeInTheDocument();
    expect(screen.getByText(`${t("securityLog.targetTypes.setting")} · smtp`)).toBeInTheDocument();
    expect(screen.queryByTestId("security-reason")).not.toBeInTheDocument();
  });

  it("shows plain values of an older row as context, not JSON", () => {
    renderDrawer(
      entry({
        details: { reason: "unknown_user", provider: "google", attempts: 3 },
        target_id: "abc",
        impersonated_role: "viewer",
      }),
    );
    const ctx = screen.getByTestId("security-details-context");
    expect(within(ctx).getByText(field("provider"))).toBeInTheDocument();
    expect(within(ctx).getByText(t("securityLog.values.google"))).toBeInTheDocument();
    expect(within(ctx).getByText(field("attempts"))).toBeInTheDocument();
    expect(within(ctx).getByText("3")).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-details-diff")).not.toBeInTheDocument();
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
  });

  it("shows placeholders for missing metadata and no reason without one", () => {
    renderDrawer(
      entry({ subject_email: null, ip: null, user_agent: null, origin: null, details: null }),
    );
    // actor, subject, target, ip, origin, impersonated role, user agent
    expect(screen.getAllByText(EMPTY).length).toBeGreaterThanOrEqual(7);
    expect(screen.queryByTestId("security-reason")).not.toBeInTheDocument();
    expect(screen.getByText(t("securityLog.entry.noDetails"))).toBeInTheDocument();
  });

  it("renders the `changes` as the table and `context` beneath it as a labelled list", () => {
    renderDrawer(
      entry({
        category: "admin",
        action: "admin.web_portal.updated",
        outcome: "success",
        details: {
          changes: { is_published: { old: true, new: false } },
          context: { slug: "app-catalog", is_published: false, view: "cards" },
        },
      }),
    );
    const table = screen.getByTestId("security-details-diff");
    expect(within(table).getByText(field("is_published"))).toBeInTheDocument();
    expect(within(table).getByText(YES)).toBeInTheDocument();
    expect(within(table).getByText(NO)).toBeInTheDocument();
    // `context` is not a row of the table.
    expect(within(table).queryByText("app-catalog")).not.toBeInTheDocument();

    const ctx = screen.getByTestId("security-details-context");
    expect(within(ctx).getByText(t("securityLog.entry.context"))).toBeInTheDocument();
    expect(within(ctx).getByText(field("slug"))).toBeInTheDocument();
    // A plain value carries no tooltip; only a permission key does.
    expect(within(ctx).getByText("app-catalog").getAttribute("aria-label")).toBeNull();
    expect(within(ctx).getByText(field("is_published"))).toBeInTheDocument();
    expect(within(ctx).getByText(NO)).toBeInTheDocument();
    expect(within(ctx).getByText(field("view"))).toBeInTheDocument();
    expect(within(ctx).getByText(t("securityLog.values.cards"))).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
  });

  it("renders `context` alone when there is no diff", () => {
    renderDrawer(entry({ details: { context: { credentials_changed: false } } }));
    const ctx = screen.getByTestId("security-details-context");
    expect(within(ctx).getByText(field("credentials_changed"))).toBeInTheDocument();
    expect(within(ctx).getByText(NO)).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-diff")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
  });

  it("reads an empty `context` and nothing else as no details", () => {
    renderDrawer(entry({ details: { reason: "x", context: {} } }));
    expect(screen.getByText(t("securityLog.entry.noDetails"))).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-context")).not.toBeInTheDocument();
  });

  it("keeps only what is nested as JSON, beside the readable parts", () => {
    renderDrawer(entry({ details: { count: 2, nested: { a: [1, 2] }, role: { old: "a", new: "b" } } }));
    expect(screen.getByTestId("security-details-json").textContent).toBe(
      JSON.stringify({ nested: { a: [1, 2] } }, null, 2),
    );
    expect(screen.getByTestId("security-details-json").tagName).toBe("PRE");
    expect(within(screen.getByTestId("security-details-context")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("security-details-diff")).getByText(field("role"))).toBeInTheDocument();
    expect(screen.queryByText(t("securityLog.entry.noDetails"))).not.toBeInTheDocument();
  });

  it("ignores a non-string reason", () => {
    renderDrawer(entry({ details: { reason: 42 } }));
    expect(screen.queryByTestId("security-reason")).not.toBeInTheDocument();
  });

  it("closes from the header button", async () => {
    const { user, onClose } = renderDrawer(entry());
    await user.click(screen.getByRole("button", { name: t("securityLog.entry.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Each value under its own label, and the exact details rendering.
// ---------------------------------------------------------------------------

/** The rendered value of the metadata field captioned `labelKey`. */
function metaValue(labelKey: string): HTMLElement {
  const caption = screen.getByText(t(labelKey), { selector: "span.MuiTypography-caption" });
  return caption.nextElementSibling as HTMLElement;
}

describe("SecurityLogEntryDrawer — metadata fields", () => {
  it("renders every field under its own label", () => {
    renderDrawer(
      entry({
        category: "admin",
        action: "auth.logout",
        outcome: "success",
        actor_email: "admin@example.com",
        subject_email: "dana@example.com",
        target_type: "setting",
        target_id: "t-1",
        target_label: "smtp",
        ip: "198.51.100.4",
        user_agent: "curl/8.0",
        origin: "api",
        impersonated_role: "viewer",
        details: { reason: "locked" },
      }),
    );
    expect(metaValue("securityLog.columns.action")).toHaveTextContent(
      `${t("securityLog.actionLabels.auth_logout")}auth.logout`,
    );
    expect(metaValue("securityLog.columns.category")).toHaveTextContent(
      t("securityLog.categories.admin"),
    );
    expect(metaValue("securityLog.columns.outcome")).toHaveTextContent(
      t("securityLog.outcomes.success"),
    );
    expect(metaValue("securityLog.columns.origin")).toHaveTextContent(/^api$/);
    expect(metaValue("securityLog.columns.when")).toHaveTextContent(/^DT\[2026-03-02T10:00:00Z\]$/);
    expect(metaValue("securityLog.columns.actor")).toHaveTextContent(/^admin@example\.com$/);
    expect(metaValue("securityLog.columns.subject")).toHaveTextContent(/^dana@example\.com$/);
    // The label wins over the id when both are present.
    expect(metaValue("securityLog.columns.target")).toHaveTextContent(`${t("securityLog.targetTypes.setting")} · smtp`);
    expect(metaValue("securityLog.columns.ip")).toHaveTextContent(/^198\.51\.100\.4$/);
    expect(metaValue("securityLog.columns.ip").querySelector("code")).toHaveTextContent(
      "198.51.100.4",
    );
    expect(metaValue("securityLog.columns.impersonatedRole")).toHaveTextContent(/^viewer$/);
    expect(metaValue("securityLog.columns.userAgent")).toHaveTextContent(/^curl\/8\.0$/);
    expect(metaValue("securityLog.columns.userAgent").querySelector("code")).not.toBeNull();
    expect(metaValue("securityLog.entry.reason")).toHaveTextContent(
      `${t("securityLog.reasons.locked")} (locked)`,
    );
  });

  it("shows the placeholder under every label that has no value", () => {
    renderDrawer(
      entry({
        actor_email: null,
        subject_email: null,
        target_type: "user",
        target_id: null,
        target_label: null,
        ip: null,
        user_agent: null,
        origin: null,
        impersonated_role: null,
        details: null,
      }),
    );
    for (const key of [
      "securityLog.columns.actor",
      "securityLog.columns.subject",
      "securityLog.columns.target",
      "securityLog.columns.ip",
      "securityLog.columns.origin",
      "securityLog.columns.impersonatedRole",
      "securityLog.columns.userAgent",
    ]) {
      expect(metaValue(key).textContent).toBe(EMPTY);
    }
    expect(metaValue("securityLog.columns.ip").querySelector("code")).toBeNull();
    expect(metaValue("securityLog.columns.userAgent").querySelector("code")).toBeNull();
    expect(
      screen.queryByText(t("securityLog.entry.reason"), { selector: "span.MuiTypography-caption" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [{ target_type: null, target_id: "abc", target_label: null }, "abc"],
    [{ target_type: "user", target_id: "abc", target_label: null }, "User · abc"],
    [{ target_type: null, target_id: null, target_label: "smtp" }, "smtp"],
    [{ target_type: "setting", target_id: "abc", target_label: "smtp" }, "Setting · smtp"],
    [{ target_type: "setting", target_id: "date-format", target_label: "date-format" }, "Setting · Date format"],
    [{ target_type: "card_type", target_id: "x", target_label: "Application" }, "Card type · Application"],
    [{ target_type: "brand_new", target_id: "x", target_label: "X" }, "Brand new · X"],
  ])("formats the target %j as %s", (fields, expected) => {
    renderDrawer(entry(fields));
    expect(metaValue("securityLog.columns.target").textContent).toBe(expected);
  });

  it("an MCP origin is a filled chip, any other origin outlined", () => {
    const { unmount } = renderDrawer(entry({ origin: "mcp" }));
    const mcp = within(metaValue("securityLog.columns.origin")).getByText("mcp").closest(".MuiChip-root");
    expect(mcp).toHaveClass("MuiChip-filled");
    unmount();
    renderDrawer(entry({ origin: "web" }));
    const web = within(metaValue("securityLog.columns.origin")).getByText("web").closest(".MuiChip-root");
    expect(web).toHaveClass("MuiChip-outlined");
  });

  it("the category is an outlined chip and the outcome a filled one", () => {
    renderDrawer(entry());
    expect(
      within(metaValue("securityLog.columns.category"))
        .getByText(t("securityLog.categories.auth"))
        .closest(".MuiChip-root"),
    ).toHaveClass("MuiChip-outlined");
    expect(
      within(metaValue("securityLog.columns.outcome"))
        .getByText(t("securityLog.outcomes.failure"))
        .closest(".MuiChip-root"),
    ).toHaveClass("MuiChip-filled");
  });

  it("carries the panel glyph and the details heading", () => {
    renderDrawer(entry());
    expect(screen.getByText("admin_panel_settings")).toBeInTheDocument();
    expect(screen.getByText(t("securityLog.entry.details"))).toBeInTheDocument();
  });
});

describe("SecurityLogEntryDrawer — reason label", () => {
  it.each(["bad_password", "unknown_user", "inactive", "expired"])(
    "%s resolves through securityLog.reasons.*",
    (code) => {
      renderDrawer(entry({ details: { reason: code } }));
      const label = t(`securityLog.reasons.${code}`);
      expect(label).not.toBe(code);
      expect(screen.getByTestId("security-reason").textContent).toBe(`${label} (${code})`);
    },
  );

  it("falls back to the raw code when the build has no label", () => {
    renderDrawer(entry({ details: { reason: "brand_new_reason" } }));
    expect(screen.getByTestId("security-reason").textContent).toBe(
      "brand_new_reason (brand_new_reason)",
    );
  });
});

describe("SecurityLogEntryDrawer — details rendering", () => {
  const bodyRows = () =>
    within(screen.getByTestId("security-details-diff"))
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

  it("renders exactly one Field/Before/After row per changed field, in order", () => {
    renderDrawer(
      entry({
        details: {
          role: { old: "viewer", new: "member" },
          is_active: { old: true, new: false },
        },
      }),
    );
    const header = within(screen.getByTestId("security-details-diff"))
      .getAllByRole("row")[0]
      .textContent;
    expect(header).toBe(
      `${t("securityLog.entry.field")}${t("securityLog.entry.old")}${t("securityLog.entry.new")}`,
    );
    expect(bodyRows()).toEqual([
      [field("role"), "viewer", "member"],
      [field("is_active"), YES, NO],
    ]);
    expect(screen.queryByText(t("securityLog.entry.noDetails"))).not.toBeInTheDocument();
  });

  it("keeps the reason out of the diff table and shows it as the reason", () => {
    renderDrawer(
      entry({ details: { reason: "locked", attempts: { old: 4, new: 5 } } }),
    );
    expect(bodyRows()).toEqual([[field("attempts"), "4", "5"]]);
    expect(screen.getByTestId("security-reason").textContent).toBe(
      `${t("securityLog.reasons.locked")} (locked)`,
    );
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
  });

  it("renders a placeholder for a missing side of a change", () => {
    renderDrawer(entry({ details: { email: { old: null, new: "x@example.com" } } }));
    expect(bodyRows()).toEqual([[field("email"), EMPTY, "x@example.com"]]);
  });

  it("renders non-diff details as pretty JSON without the reason", () => {
    renderDrawer(
      entry({ details: { reason: "bad_password", nested: { a: [1, 2] }, attempts: 3 } }),
    );
    const pre = screen.getByTestId("security-details-json");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe(JSON.stringify({ nested: { a: [1, 2] } }, null, 2));
    expect(pre.textContent).not.toContain("reason");
    expect(screen.queryByTestId("security-details-diff")).not.toBeInTheDocument();
    expect(screen.queryByText(t("securityLog.entry.noDetails"))).not.toBeInTheDocument();
  });

  it("a mixed payload (one diff, one scalar) is a table and a context list", () => {
    renderDrawer(entry({ details: { role: { old: "a", new: "b" }, note: "x" } }));
    expect(bodyRows()).toEqual([[field("role"), "a", "b"]]);
    const ctx = screen.getByTestId("security-details-context");
    expect(within(ctx).getByText("Note")).toBeInTheDocument();
    expect(within(ctx).getByText("x")).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
  });

  it("empty details read as no details", () => {
    renderDrawer(entry({ details: {} }));
    expect(screen.getByText(t("securityLog.entry.noDetails"))).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-details-diff")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The `details` contract: change sentences, formatted values, permissions.
// ---------------------------------------------------------------------------

const items = () =>
  within(screen.getByTestId("security-details-items"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("SecurityLogEntryDrawer — change items", () => {
  it("renders the metamodel example as a sentence under the Changes heading", () => {
    renderDrawer(
      entry({
        category: "admin",
        action: "admin.card_type.updated",
        outcome: "success",
        target_type: "card_type",
        target_label: "Application",
        details: {
          items: [
            {
              kind: "field.added",
              section: "Governance",
              field: "Business criticality",
              type: "single_select",
            },
          ],
        },
      }),
    );
    const list = screen.getByTestId("security-details-items");
    expect(within(list).getByText(t("securityLog.entry.changes"))).toBeInTheDocument();
    expect(items()).toEqual([
      "Field “Business criticality” (Single select) added to section “Governance”",
    ]);
    expect(within(list).getByRole("listitem")).toHaveAttribute("data-kind", "field.added");
    expect(metaValue("securityLog.columns.target").textContent).toBe("Card type · Application");
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
  });

  it("formats every argument: booleans, codes, the description section, lists, dates", async () => {
    mockApi.lenient({});
    renderDrawer(
      entry({
        details: {
          items: [
            { kind: "field.changed", section: "__description", field: "Owner", property: "required", old: false, new: true },
            { kind: "section.changed", section: "Main", property: "defaultExpanded", old: true, new: null },
            { kind: "layout.reordered", old: ["__description", "Main"], new: ["Main", "__description"] },
            { kind: "type_permission.changed", role: "Viewer", permission: "inventory.view", old: "inherit", new: "deny" },
            { kind: "user.changed", user: "a@example.com", field: "locked_until", old: null, new: "2026-03-05T08:00:00Z" },
            { kind: "locale.enabled", locale: "de" },
            { kind: "image.removed", image: "favicon" },
            { kind: "portal_option.changed", option: "show_logo", old: true, new: false },
            { kind: "section.moved", section: "Main", from: 1, to: 3 },
            { kind: "portal_toggle.changed", item: "lifecycle", surface: "detail", old: false, new: true },
            { kind: "portal_toggle.changed", item: "Owner", surface: "card", old: true, new: false },
          ],
        },
      }),
    );
    // The permission key asks for the schemas; empty ones leave the key shown.
    await waitFor(() => expect(mockApi.calls).toHaveLength(2));
    expect(items()).toEqual([
      `Field “Owner” in section “Description”: ${field("required")} changed from ${NO} to ${YES}`,
      `Section “Main”: ${field("default_expanded")} changed from ${YES} to ${EMPTY}`,
      "Sections reordered: Description, Main → Main, Description",
      "Viewer: inventory.view Inherit → Deny",
      `User a@example.com: ${field("locked_until")} changed from ${EMPTY} to DT[2026-03-05T08:00:00Z]`,
      "Language enabled: Deutsch",
      "Favicon removed",
      `Portal option Show logo changed from ${YES} to ${NO}`,
      "Section “Main” moved from position 1 to 3",
      `Show “Lifecycle” (Detail page): ${NO} → ${YES}`,
      `Show “Owner” (Card): ${YES} → ${NO}`,
    ]);
  });

  it("names a translation's scope and a bare translated property", () => {
    renderDrawer(
      entry({
        details: {
          items: [
            { kind: "translation.changed", property: "field_help:Owner", locale: "fr", old: null, new: "Aide" },
            { kind: "translation.changed", property: "reverse_label", locale: "de", old: "a", new: "b" },
            { kind: "translation.changed", property: "mystery:X", locale: "xx", old: "a", new: "b" },
          ],
        },
      }),
    );
    expect(items()).toEqual([
      `Translation (Français) of field help “Owner” changed: “${EMPTY}” → “Aide”`,
      `Translation (Deutsch) of ${field("reverse_label")} changed: “a” → “b”`,
      "Translation (xx) of Mystery “X” changed: “a” → “b”",
    ]);
  });

  it("pluralises the overflow line", () => {
    renderDrawer(entry({ details: { items: [{ kind: "more", count: 1 }, { kind: "more", count: 5 }] } }));
    expect(items()).toEqual(["…and 1 more change", "…and 5 more changes"]);
  });

  it("renders an unknown kind generically with labelled arguments", () => {
    renderDrawer(
      entry({
        details: {
          items: [
            { kind: "widget.frobbed", slug: "s", enabled: true },
            { kind: "bare.kind" },
            { kind: "quality_weight.changed", component: 5, old: 1, new: 2 },
            { kind: "quality_weight.changed", component: "field:x", old: 1, new: 2 },
          ],
        },
      }),
    );
    expect(items()).toEqual([
      `Widget frobbed: ${field("slug")} = s, ${field("enabled")} = ${YES}`,
      "Bare kind",
      // A non-string name is shown as a value, and only `property` carries a scope.
      "Data-quality weight of 5 changed from 1 to 2",
      "Data-quality weight of Field:x changed from 1 to 2",
    ]);
  });
});

describe("SecurityLogEntryDrawer — formatted cells", () => {
  it("renders a nested value inside a change as JSON", () => {
    renderDrawer(entry({ details: { config: { old: { a: 1 }, new: null } } }));
    const table = screen.getByTestId("security-details-diff");
    expect(within(table).getByText('{"a":1}')).toBeInTheDocument();
    expect(within(table).getByText(EMPTY)).toBeInTheDocument();
  });

  it("shows a colour swatch with its hex, a date, bytes, a language and a code", () => {
    renderDrawer(
      entry({
        details: {
          changes: {
            navbar_bg: { old: "#112233", new: "#aabbcc" },
            locked_until: { old: null, new: "2026-03-05T08:00:00Z" },
            cardinality: { old: "1:n", new: "n:m" },
          },
          context: { size_bytes: 2048, locale: "fr", mime: "image/png", config: '{"a":1}' },
        },
      }),
    );
    const table = screen.getByTestId("security-details-diff");
    const swatches = within(table).getAllByTestId("security-color-swatch");
    expect(swatches).toHaveLength(2);
    expect(swatches[0].parentElement).toHaveTextContent("#112233");
    expect(within(table).getByText("#aabbcc")).toBeInTheDocument();
    expect(within(table).getByText("DT[2026-03-05T08:00:00Z]")).toBeInTheDocument();
    expect(within(table).getByText("1:n")).toBeInTheDocument();
    expect(within(table).getByText(field("cardinality"))).toBeInTheDocument();
    const ctx = screen.getByTestId("security-details-context");
    expect(within(ctx).getByText("2 KB")).toBeInTheDocument();
    expect(within(ctx).getByText("Français")).toBeInTheDocument();
    expect(within(ctx).getByText("image/png")).toBeInTheDocument();
    expect(within(ctx).getByText('{"a":1}')).toBeInTheDocument();
    expect(mockApi.calls).toHaveLength(0);
  });
});

describe("SecurityLogEntryDrawer — permission descriptions", () => {
  const APP_SCHEMA = {
    inventory: { label: "Inventory", permissions: { "inventory.view": "View card lists" } },
    admin: { label: "Admin" },
  };

  it("fetches both schemas and shows a permission's description", async () => {
    mockApi.on("get", "/roles/permissions-schema", APP_SCHEMA);
    mockApi.on("get", "/stakeholder-roles/permissions-schema", { "card.edit": "Edit this card" });
    renderDrawer(
      entry({
        details: {
          items: [{ kind: "permission.granted", permission: "inventory.view" }],
          changes: { permissions: { old: [], new: ["card.edit", "card.unknown"] } },
        },
      }),
    );
    await waitFor(() => expect(items()).toEqual(["Permission granted: View card lists"]));
    const table = screen.getByTestId("security-details-diff");
    expect(within(table).getByText("Edit this card, card.unknown")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/roles/permissions-schema")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/stakeholder-roles/permissions-schema")).toHaveLength(1);
  });

  it("falls back to the key when the schemas cannot be read", async () => {
    mockApi.fail("get", "/roles/permissions-schema", 500);
    mockApi.fail("get", "/stakeholder-roles/permissions-schema", 500);
    renderDrawer(entry({ details: { context: { permission: "inventory.view" } } }));
    await waitFor(() => expect(mockApi.calls).toHaveLength(2));
    const ctx = screen.getByTestId("security-details-context");
    // The key is also the tooltip, so it stays readable once a description loads.
    expect(within(ctx).getByText("inventory.view")).toHaveAttribute("aria-label", "inventory.view");
  });

  it("flattens the app schema's groups", () => {
    expect(flattenAppSchema(APP_SCHEMA)).toEqual({ "inventory.view": "View card lists" });
    expect(flattenAppSchema(null)).toEqual({});
    expect(
      flattenAppSchema({ broken: null } as unknown as Parameters<typeof flattenAppSchema>[0]),
    ).toEqual({});
    expect(flattenAppSchema(undefined)).toEqual({});
  });
});
