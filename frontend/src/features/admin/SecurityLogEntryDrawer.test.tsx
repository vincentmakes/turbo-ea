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
