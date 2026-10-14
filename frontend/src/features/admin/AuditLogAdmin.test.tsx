/**
 * Container test for Admin → Settings → Audit log: two sub-tabs, Changes and
 * Security & admin, the active one carried in the URL as `?view=security`.
 * Both tabs are stubbed — each has its own page test
 * (`AuditLogChangesTab.test.tsx`, `SecurityLogAdmin.test.tsx`).
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router";

import i18n from "@/i18n";
import { renderWithProviders } from "@/test/render";

vi.mock("./AuditLogChangesTab", () => ({ default: () => <div data-testid="changes-tab" /> }));
vi.mock("./SecurityLogAdmin", () => ({ default: () => <div data-testid="security-tab" /> }));

import AuditLogAdmin from "./AuditLogAdmin";

const t = (key: string) => i18n.t(`admin:${key}`) as string;
/** MUI tabs with an icon carry the icon's ligature text in their accessible name. */
const named = (label: string) => (name: string) => name === label || name.endsWith(` ${label}`);

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="search">{loc.search}</span>;
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <AuditLogAdmin />
      <LocationProbe />
    </>,
    { route },
  );
}

describe("AuditLogAdmin — sub-tabs", () => {
  it("opens on Changes when the URL names no view", () => {
    renderAt("/admin/settings?tab=audit-log");
    expect(screen.getByTestId("changes-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("security-tab")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: named(t("auditLog.subtabs.changes")) })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: named(t("auditLog.subtabs.security")) }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("?view=security selects the Security & admin tab", () => {
    renderAt("/admin/settings?tab=audit-log&view=security");
    expect(screen.getByTestId("security-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("changes-tab")).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: named(t("auditLog.subtabs.security")) }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("an unknown view falls back to Changes", () => {
    renderAt("/admin/settings?tab=audit-log&view=nope");
    expect(screen.getByTestId("changes-tab")).toBeInTheDocument();
  });

  it("clicking a tab writes the view into the URL and keeps the other params", async () => {
    const { user } = renderAt("/admin/settings?tab=audit-log");
    await user.click(screen.getByRole("tab", { name: named(t("auditLog.subtabs.security")) }));
    expect(screen.getByTestId("security-tab")).toBeInTheDocument();
    const after = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(after.get("view")).toBe("security");
    expect(after.get("tab")).toBe("audit-log");

    await user.click(screen.getByRole("tab", { name: named(t("auditLog.subtabs.changes")) }));
    expect(screen.getByTestId("changes-tab")).toBeInTheDocument();
    const back = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(back.has("view")).toBe(false);
    expect(back.get("tab")).toBe("audit-log");
  });
});
