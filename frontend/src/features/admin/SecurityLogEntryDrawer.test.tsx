/**
 * The Security & admin entry drawer: read-only metadata plus the `details`
 * payload, rendered as a field/old/new table for a diff and as JSON otherwise.
 */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";

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

import SecurityLogEntryDrawer, { formatDetailValue } from "./SecurityLogEntryDrawer";
import { isFieldDiff, type SecurityLogEntry } from "./SecurityLogTypes";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const EMPTY = "—";

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

  it("renders a field diff as an old/new table", () => {
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
          tags: { old: ["x"], new: true },
        },
      }),
    );
    const table = screen.getByTestId("security-details-diff");
    expect(within(table).getByText(t("securityLog.entry.field"))).toBeInTheDocument();
    expect(within(table).getByText(t("securityLog.entry.old"))).toBeInTheDocument();
    expect(within(table).getByText(t("securityLog.entry.new"))).toBeInTheDocument();
    expect(within(table).getByText("smtp_host")).toBeInTheDocument();
    expect(within(table).getByText("a.example")).toBeInTheDocument();
    expect(within(table).getByText("b.example")).toBeInTheDocument();
    expect(within(table).getAllByText("***")).toHaveLength(2);
    expect(within(table).getByText("25")).toBeInTheDocument();
    expect(within(table).getByText(EMPTY)).toBeInTheDocument();
    expect(within(table).getByText('["x"]')).toBeInTheDocument();
    expect(within(table).getByText("true")).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
    expect(screen.getByText("setting · smtp")).toBeInTheDocument();
    expect(screen.queryByTestId("security-reason")).not.toBeInTheDocument();
  });

  it("falls back to formatted JSON when the details are not a diff", () => {
    renderDrawer(
      entry({
        details: { reason: "unknown_user", provider: "google", attempts: 3 },
        target_id: "abc",
        impersonated_role: "viewer",
      }),
    );
    const pre = screen.getByTestId("security-details-json");
    expect(pre.textContent).toBe(JSON.stringify({ provider: "google", attempts: 3 }, null, 2));
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

describe("formatDetailValue", () => {
  it.each([
    [null, EMPTY],
    [undefined, EMPTY],
    ["text", "text"],
    [0, "0"],
    [false, "false"],
    [{ a: 1 }, '{"a":1}'],
  ])("%j → %s", (v, out) => {
    expect(formatDetailValue(v)).toBe(out);
  });
});

describe("isFieldDiff", () => {
  it.each([
    [null, false],
    [{}, false],
    [{ a: { old: 1, new: 2 } }, true],
    [{ a: { old: 1, new: 2 }, b: "x" }, false],
    [{ a: { old: 1 } }, false],
    [{ a: null }, false],
    [{ a: [1, 2] }, false],
  ])("%j → %s", (v, out) => {
    expect(isFieldDiff(v as Record<string, unknown> | null)).toBe(out);
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
    expect(metaValue("securityLog.columns.target")).toHaveTextContent(/^setting · smtp$/);
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
    [{ target_type: "user", target_id: "abc", target_label: null }, "user · abc"],
    [{ target_type: null, target_id: null, target_label: "smtp" }, "smtp"],
    [{ target_type: "setting", target_id: "abc", target_label: "smtp" }, "setting · smtp"],
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
      ["role", "viewer", "member"],
      ["is_active", "true", "false"],
    ]);
    expect(screen.queryByText(t("securityLog.entry.noDetails"))).not.toBeInTheDocument();
  });

  it("keeps the reason out of the diff table and shows it as the reason", () => {
    renderDrawer(
      entry({ details: { reason: "locked", attempts: { old: 4, new: 5 } } }),
    );
    expect(bodyRows()).toEqual([["attempts", "4", "5"]]);
    expect(screen.getByTestId("security-reason").textContent).toBe(
      `${t("securityLog.reasons.locked")} (locked)`,
    );
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
  });

  it("renders a placeholder for a missing side of a change", () => {
    renderDrawer(entry({ details: { email: { old: null, new: "x@example.com" } } }));
    expect(bodyRows()).toEqual([["email", EMPTY, "x@example.com"]]);
  });

  it("renders non-diff details as pretty JSON without the reason", () => {
    renderDrawer(
      entry({ details: { reason: "bad_password", nested: { a: [1, 2] }, attempts: 3 } }),
    );
    const pre = screen.getByTestId("security-details-json");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe(JSON.stringify({ nested: { a: [1, 2] }, attempts: 3 }, null, 2));
    expect(pre.textContent).not.toContain("reason");
    expect(screen.queryByTestId("security-details-diff")).not.toBeInTheDocument();
    expect(screen.queryByText(t("securityLog.entry.noDetails"))).not.toBeInTheDocument();
  });

  it("a mixed payload (one diff, one scalar) is JSON, not a table", () => {
    renderDrawer(entry({ details: { role: { old: "a", new: "b" }, note: "x" } }));
    expect(screen.getByTestId("security-details-json").textContent).toBe(
      JSON.stringify({ role: { old: "a", new: "b" }, note: "x" }, null, 2),
    );
  });

  it("empty details read as no details", () => {
    renderDrawer(entry({ details: {} }));
    expect(screen.getByText(t("securityLog.entry.noDetails"))).toBeInTheDocument();
    expect(screen.queryByTestId("security-details-json")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-details-diff")).not.toBeInTheDocument();
  });
});

describe("formatDetailValue — more shapes", () => {
  it.each([
    [true, "true"],
    [1.5, "1.5"],
    ["", ""],
    [[1, "a"], '[1,"a"]'],
  ])("%j → %s", (v, out) => {
    expect(formatDetailValue(v)).toBe(out);
  });
});
