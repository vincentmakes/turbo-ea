/**
 * RiskDetailPage — the TOGAF-shaped edit view of one risk.
 *
 * The heavy children (affected cards list, mitigation tasks panel, matrix,
 * card picker, extension slot) are stubbed with small escape hatches; every
 * assertion is about what the page itself sends to `/risks/{id}` and renders
 * back from the reply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import type { MitigationTask, Risk, RiskCardLink } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

vi.mock("./AffectedCardsList", () => ({
  default: ({ cards, onUnlink }: { cards: RiskCardLink[]; onUnlink?: (id: string) => void }) => (
    <ul data-testid="affected-cards" data-read-only={String(!onUnlink)}>
      {cards.map((c) => (
        <li key={c.card_id}>
          {c.card_name}
          {onUnlink && (
            <button type="button" data-testid={`unlink-${c.card_id}`} onClick={() => onUnlink(c.card_id)} />
          )}
        </li>
      ))}
    </ul>
  ),
}));

vi.mock("./RiskMatrix", () => ({
  default: ({ matrix, highlight }: { matrix: number[][]; highlight?: { probability: string; impact: string } }) => (
    <div
      data-testid="risk-matrix"
      data-matrix={JSON.stringify(matrix)}
      data-highlight={highlight ? `${highlight.probability}:${highlight.impact}` : ""}
    />
  ),
}));

vi.mock("@/components/CardPicker", () => ({
  default: ({
    onChange,
    excludeIds,
    disabled,
    placeholder,
  }: {
    onChange: (v: { id: string; name: string; type: string } | null) => void;
    excludeIds?: string[];
    disabled?: boolean;
    placeholder?: string;
  }) => (
    <div data-testid="card-picker" data-exclude={(excludeIds ?? []).join(",")} data-placeholder={placeholder}>
      <button
        type="button"
        data-testid="pick-card"
        disabled={disabled}
        onClick={() => onChange({ id: "card-new", name: "Billing", type: "Application" })}
      />
      <button type="button" data-testid="pick-nothing" disabled={disabled} onClick={() => onChange(null)} />
    </div>
  ),
}));

vi.mock("@/lib/extensionHost", async () => {
  const actual = await vi.importActual<typeof import("@/lib/extensionHost")>("@/lib/extensionHost");
  return {
    ...actual,
    ExtensionSlot: ({ name, context }: { name: string; context?: Record<string, unknown> }) => (
      <div data-testid="extension-slot" data-name={name} data-risk-id={String(context?.riskId)} />
    ),
  };
});

vi.mock("./mitigation/MitigationTasksPanel", () => ({
  default: ({
    riskId,
    riskClosed,
    currentUserId,
    onSummaryChange,
  }: {
    riskId: string;
    riskClosed: boolean;
    currentUserId: string | null;
    onSummaryChange?: (s: { total: number; open: number; done: number; skipped: number; overdue: number }) => void;
  }) => (
    <div
      data-testid="tasks-panel"
      data-risk-id={riskId}
      data-closed={String(riskClosed)}
      data-current-user={currentUserId ?? ""}
    >
      <div id="occurrence-occ1" data-testid="occurrence-anchor" />
      <button
        type="button"
        data-testid="emit-summary"
        onClick={() => onSummaryChange?.({ total: 3, open: 2, done: 1, skipped: 0, overdue: 1 })}
      />
      <button
        type="button"
        data-testid="emit-summary-clean"
        onClick={() => onSummaryChange?.({ total: 1, open: 0, done: 1, skipped: 0, overdue: 0 })}
      />
    </div>
  ),
}));

vi.mock("@/components/StakeholderHoverCard", () => ({
  default: ({ children, userId }: { children: React.ReactNode; userId: string }) => (
    <span data-testid="hover-card" data-user-id={userId}>
      {children}
    </span>
  ),
}));

vi.mock("./riskPrint", async () => {
  const actual = await vi.importActual<typeof import("./riskPrint")>("./riskPrint");
  return { ...actual, printRisk: vi.fn() };
});

vi.mock("@/lib/printDocument", async () => {
  const actual = await vi.importActual<typeof import("@/lib/printDocument")>("@/lib/printDocument");
  return { ...actual, openPrintWindow: vi.fn() };
});

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { USERS } from "@/test/fixtures/metamodel";
import { renderWithProviders, userWith } from "@/test/render";
import { openPrintWindow } from "@/lib/printDocument";
import { printRisk } from "./riskPrint";
import RiskDetailPage from "./RiskDetailPage";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`grc:${key}`, opts as never) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;
const td = (key: string) => i18n.t(`delivery:${key}`) as string;

/** A MUI button whose `startIcon` / `endIcon` is a Material Symbol carries
 *  the ligature word in its accessible name ("lock Close arrow_forward"); the
 *  label itself is matched whole so "Close" cannot catch the "Closed" step. */
const buttonName = (label: string) =>
  new RegExp(`^(?:[a-z_]+ )?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: [a-z_]+)?$`);
const button = (label: string) => screen.getByRole("button", { name: buttonName(label) });
const queryButton = (label: string) => screen.queryByRole("button", { name: buttonName(label) });

/** A `<Select>` labelled only through its `<InputLabel>` has no accessible
 *  name, so it is reached through its FormControl. `index` picks between the
 *  initial (0) and residual (1) assessment controls that share a label. */
function selectFor(label: string, index = 0): HTMLElement {
  const controls = Array.from(
    new Set(
      screen
        .getAllByText(label)
        .map((el) => el.closest(".MuiFormControl-root"))
        .filter((el): el is HTMLElement => el instanceof HTMLElement),
    ),
  );
  return within(controls[index]).getByRole("combobox");
}

/** The page error/info alerts share `role="alert"` with the residual-lock
 *  notice, so look for the message text. */
const findAlertText = (text: string | RegExp) => screen.findByText(text);

const RISK: Risk = {
  id: "r1",
  reference: "R-000001",
  title: "ERP outage",
  description: "The ERP can fall over.",
  category: "operational",
  source_type: "manual",
  source_ref: null,
  initial_probability: "high",
  initial_impact: "critical",
  initial_level: "critical",
  residual_probability: null,
  residual_impact: null,
  residual_level: null,
  owner_id: null,
  owner_name: null,
  target_resolution_date: null,
  status: "identified",
  acceptance_rationale: null,
  accepted_by: null,
  accepted_at: null,
  created_by: null,
  created_at: "2026-01-01T10:00:00Z",
  updated_at: "2026-02-01T10:00:00Z",
  cards: [
    { card_id: "c1", card_name: "ERP", card_type: "Application", role: "affected" },
    { card_id: "c2", card_name: "Postgres", card_type: "ITComponent", role: "affected" },
  ],
};

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location" data-search={loc.search} data-path={loc.pathname} />;
}

function RegisterMarker() {
  const loc = useLocation();
  return <div data-testid="register" data-search={loc.search} />;
}

function renderPage(opts: { route?: string; user?: ReturnType<typeof userWith> } = {}) {
  return renderWithProviders(
    <>
      <RiskDetailPage />
      <LocationProbe />
    </>,
    {
      route: opts.route ?? "/grc/risks/r1",
      routes: [{ path: "/grc/risks/:id" }, { path: "/grc", element: <RegisterMarker /> }],
      ...(opts.user ? { user: opts.user } : {}),
    },
  );
}

/** Script the risk and let PATCH / card link replies echo the change back. */
function scriptRisk(risk: Risk) {
  mockApi.on("get", `/risks/${risk.id}`, risk);
  mockApi.on("patch", `/risks/${risk.id}`, (_p, body) => ({ ...risk, ...(body as object) }));
  mockApi.on("post", `/risks/${risk.id}/cards`, (_p, body) => ({
    ...risk,
    cards: [
      ...risk.cards,
      ...(body as { card_ids: string[] }).card_ids.map((id) => ({
        card_id: id,
        card_name: "Billing",
        card_type: "Application",
        role: "affected" as const,
      })),
    ],
  }));
  mockApi.on("delete", new RegExp(`^/risks/${risk.id}/cards/`), (path) => ({
    ...risk,
    cards: risk.cards.filter((c) => !path.endsWith(`/${c.card_id}`)),
  }));
  mockApi.on("delete", `/risks/${risk.id}`, undefined);
  mockApi.on("get", `/risks/${risk.id}/mitigation-tasks`, []);
}

async function waitForLoaded(reference = RISK.reference) {
  await screen.findByRole("heading", { level: 6, name: reference });
}

const patches = () => mockApi.callsOf("patch", "/risks/r1");
const lastPatchBody = () => patches().at(-1)!.body;

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/users", USERS);
  mockApi.on("get", "/auth/me", { id: USERS[0].id });
  scriptRisk(RISK);
  vi.mocked(openPrintWindow).mockReset();
  vi.mocked(printRisk).mockReset();
  window.location.hash = "";
});

describe("RiskDetailPage — loading", () => {
  it("shows a spinner, then the risk header, sections and audit stamps", async () => {
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await waitForLoaded();

    expect(screen.getByRole("heading", { level: 5, name: RISK.title })).toBeInTheDocument();
    // Status chip + stepper label.
    expect(screen.getAllByText(t("risks.status.identified"))).toHaveLength(2);
    expect(screen.getAllByText(t("risks.level.critical")).length).toBeGreaterThan(0);
    // A manual risk carries no source chip.
    expect(screen.queryByText(t("risks.source.manual"))).not.toBeInTheDocument();
    expect(screen.getByText(RISK.created_at!)).toBeInTheDocument();
    expect(screen.getByText(RISK.updated_at!)).toBeInTheDocument();
    expect(screen.queryByText(t("risks.field.acceptedAt"))).not.toBeInTheDocument();

    expect(screen.getByTestId("affected-cards")).toHaveTextContent("ERP");
    expect(screen.getByTestId("card-picker")).toHaveAttribute("data-exclude", "c1,c2");
    expect(screen.getByTestId("card-picker")).toHaveAttribute(
      "data-placeholder",
      t("risks.cards.linkPlaceholder"),
    );
    expect(screen.getByTestId("tasks-panel")).toHaveAttribute("data-risk-id", "r1");
    expect(screen.getByTestId("tasks-panel")).toHaveAttribute("data-current-user", USERS[0].id);
    expect(screen.getByTestId("extension-slot")).toHaveAttribute("data-name", "risk.detail.panel");
    expect(screen.getByTestId("extension-slot")).toHaveAttribute("data-risk-id", "r1");
    // The initial matrix carries one mark at the chosen probability × impact.
    expect(screen.getByTestId("risk-matrix")).toHaveAttribute("data-highlight", "high:critical");
    expect(JSON.parse(screen.getByTestId("risk-matrix").getAttribute("data-matrix")!)).toEqual([
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    // Residual is locked until mitigation is planned.
    expect(screen.getByText(t("risks.residual.lockedUntilMitigation"))).toBeInTheDocument();
    expect(screen.getByText(t("risks.residual.noneYet"))).toBeInTheDocument();
  });

  it("names the source and the owner when the risk carries them", async () => {
    scriptRisk({
      ...RISK,
      source_type: "compliance",
      owner_id: USERS[1].id,
      owner_name: USERS[1].display_name,
      accepted_at: "2026-03-01T10:00:00Z",
    });
    renderPage();
    await waitForLoaded();
    expect(screen.getByText(t("risks.source.compliance"))).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("hover-card")).toHaveAttribute("data-user-id", USERS[1].id),
    );
    expect(screen.getByText(t("risks.field.acceptedAt"))).toBeInTheDocument();
  });

  it("renders the not-found state when the risk cannot be read", async () => {
    mockApi.fail("get", "/risks/r1", 404, "nope");
    renderPage();
    // The fallback is the shared not-found copy, not a hardcoded string (2.157.0).
    expect(await findAlertText(i18n.t("common:errors.notFound"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 6 })).not.toBeInTheDocument();
  });

  it("keeps rendering without users or a signed-in identity", async () => {
    mockApi.fail("get", "/users", 403);
    mockApi.fail("get", "/auth/me", 401);
    renderPage();
    await waitForLoaded();
    expect(screen.getByTestId("tasks-panel")).toHaveAttribute("data-current-user", "");
  });
});

describe("RiskDetailPage — editing fields", () => {
  it("patches the title on blur and shows the reply", async () => {
    const { user } = renderPage();
    await waitForLoaded();

    const title = screen.getByRole("textbox", { name: t("risks.field.title") });
    await user.clear(title);
    await user.type(title, "Renamed");
    expect(patches()).toHaveLength(0);
    await user.tab();
    await waitFor(() => expect(lastPatchBody()).toEqual({ title: "Renamed" }));
    expect(await screen.findByRole("heading", { level: 5, name: "Renamed" })).toBeInTheDocument();
  });

  it("patches the description on blur", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    const desc = screen.getByRole("textbox", { name: t("risks.field.description") });
    await user.type(desc, " More.");
    await user.tab();
    await waitFor(() =>
      expect(lastPatchBody()).toEqual({ description: `${RISK.description} More.` }),
    );
  });

  it("patches category, probability and impact from the selects", async () => {
    const { user } = renderPage();
    await waitForLoaded();

    await user.click(selectFor(t("risks.field.category")));
    await user.click(await screen.findByRole("option", { name: t("risks.category.security") }));
    await waitFor(() => expect(lastPatchBody()).toEqual({ category: "security" }));

    await user.click(selectFor(t("risks.field.probability"), 0));
    await user.click(await screen.findByRole("option", { name: t("risks.probability.low") }));
    await waitFor(() => expect(lastPatchBody()).toEqual({ initial_probability: "low" }));
    await waitFor(() =>
      expect(screen.getByTestId("risk-matrix")).toHaveAttribute("data-highlight", "low:critical"),
    );

    await user.click(selectFor(t("risks.field.impact"), 0));
    await user.click(await screen.findByRole("option", { name: t("risks.impact.medium") }));
    await waitFor(() => expect(lastPatchBody()).toEqual({ initial_impact: "medium" }));
  });

  it("patches the owner from the user picker", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    const owner = screen.getByRole("combobox", { name: t("risks.field.owner") });
    await user.click(owner);
    await user.click(
      await screen.findByRole("option", { name: `${USERS[1].display_name} (${USERS[1].email})` }),
    );
    await waitFor(() => expect(lastPatchBody()).toEqual({ owner_id: USERS[1].id }));
    await waitFor(() =>
      expect(screen.getByTestId("hover-card")).toHaveAttribute("data-user-id", USERS[1].id),
    );
  });

  it("patches the target date from the date field", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    const date = screen.getByLabelText(t("risks.field.targetDate"));
    await user.type(date, "2027-06-30");
    await user.tab();
    await waitFor(() => expect(lastPatchBody()).toEqual({ target_resolution_date: "2027-06-30" }));
  });

  it("surfaces a failed patch as an error alert and keeps the form usable", async () => {
    mockApi.fail("patch", "/risks/r1", 500, "boom");
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(selectFor(t("risks.field.category")));
    await user.click(await screen.findByRole("option", { name: t("risks.category.security") }));
    expect(await findAlertText(/PATCH \/risks\/r1 failed/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: t("risks.field.title") })).toBeEnabled();
  });

  it("unlocks the residual assessment once mitigation is planned", async () => {
    scriptRisk({ ...RISK, status: "mitigation_planned" });
    const { user } = renderPage();
    await waitForLoaded();
    expect(screen.queryByText(t("risks.residual.lockedUntilMitigation"))).not.toBeInTheDocument();

    await user.click(selectFor(t("risks.field.probability"), 1));
    await user.click(await screen.findByRole("option", { name: t("risks.probability.low") }));
    await waitFor(() => expect(lastPatchBody()).toEqual({ residual_probability: "low" }));

    await user.click(selectFor(t("risks.field.impact"), 1));
    await user.click(await screen.findByRole("option", { name: t("risks.impact.low") }));
    await waitFor(() => expect(lastPatchBody()).toEqual({ residual_impact: "low" }));

    // The empty option clears the residual value.
    await user.click(selectFor(t("risks.field.impact"), 1));
    await user.click(await screen.findByRole("option", { name: "—" }));
    await waitFor(() => expect(lastPatchBody()).toEqual({ residual_impact: null }));
  });

  it("shows the residual level chip when the backend derived one", async () => {
    scriptRisk({
      ...RISK,
      status: "in_progress",
      residual_probability: "low",
      residual_impact: "low",
      residual_level: "low",
    });
    renderPage();
    await waitForLoaded();
    expect(screen.queryByText(t("risks.residual.noneYet"))).not.toBeInTheDocument();
    // Header chip uses the residual level once it exists.
    expect(screen.getAllByText(t("risks.level.low")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("RiskDetailPage — affected cards", () => {
  it("links a picked card and drops it from the picker's exclusions afterwards", async () => {
    const { user } = renderPage();
    await waitForLoaded();

    await user.click(screen.getByTestId("pick-card"));
    await waitFor(() =>
      expect(mockApi.callsOf("post", "/risks/r1/cards")[0].body).toEqual({ card_ids: ["card-new"] }),
    );
    await waitFor(() => expect(screen.getByTestId("affected-cards")).toHaveTextContent("Billing"));
    expect(screen.getByTestId("card-picker")).toHaveAttribute("data-exclude", "c1,c2,card-new");

    // Clearing the picker links nothing.
    await user.click(screen.getByTestId("pick-nothing"));
    expect(mockApi.callsOf("post", "/risks/r1/cards")).toHaveLength(1);
  });

  it("unlinks a card", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(screen.getByTestId("unlink-c1"));
    await waitFor(() => expect(mockApi.callsOf("delete", "/risks/r1/cards/c1")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("affected-cards")).not.toHaveTextContent("ERP"));
    expect(screen.getByTestId("card-picker")).toHaveAttribute("data-exclude", "c2");
  });

  it("reports a failed link and a failed unlink", async () => {
    mockApi.fail("post", "/risks/r1/cards", 409, "dup");
    mockApi.fail("delete", /^\/risks\/r1\/cards\//, 500);
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(screen.getByTestId("pick-card"));
    expect(await findAlertText(/POST \/risks\/r1\/cards failed/)).toBeInTheDocument();
    await user.click(screen.getByTestId("unlink-c2"));
    expect(await findAlertText(/DELETE \/risks\/r1\/cards\/c2 failed/)).toBeInTheDocument();
    expect(screen.queryByText(/POST \/risks\/r1\/cards failed/)).not.toBeInTheDocument();
  });

  it("explains an empty card list", async () => {
    scriptRisk({ ...RISK, cards: [] });
    renderPage();
    await waitForLoaded();
    expect(screen.getByText(t("risks.cards.none"))).toBeInTheDocument();
    expect(screen.queryByTestId("affected-cards")).not.toBeInTheDocument();
  });
});

describe("RiskDetailPage — status workflow", () => {
  it("advances to the next sequential status from the primary button", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    expect(screen.getByText(t("risks.action.nextStep"))).toBeInTheDocument();

    await user.click(button(t("risks.action.analyse")));
    await waitFor(() => expect(lastPatchBody()).toEqual({ status: "analysed" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent === t("risks.status.analysed"))).toBe(true);
    // The next primary step follows the new status, and the success note closes.
    expect(button(t("risks.action.plan_mitigation"))).toBeInTheDocument();
    const note = alerts.find((a) => a.textContent === t("risks.status.analysed"))!;
    await user.click(within(note).getByRole("button"));
    expect(screen.queryByText(t("risks.status.analysed"), { selector: ".MuiAlert-message" })).not.toBeInTheDocument();
  });

  it("drives each lifecycle state to its primary successor", async () => {
    const chain: Array<[Risk["status"], string, Risk["status"]]> = [
      ["analysed", "plan_mitigation", "mitigation_planned"],
      ["mitigation_planned", "start_mitigation", "in_progress"],
      ["in_progress", "mark_mitigated", "mitigated"],
      ["mitigated", "start_monitoring", "monitoring"],
      ["monitoring", "close", "closed"],
    ];
    for (const [from, labelKey, to] of chain) {
      mockApi.reset();
      mockApi.on("get", "/users", USERS);
      mockApi.on("get", "/auth/me", { id: USERS[0].id });
      scriptRisk({ ...RISK, status: from });
      const { user, unmount } = renderPage();
      await waitForLoaded();
      await user.click(button(t(`risks.action.${labelKey}`)));
      await waitFor(() => expect(lastPatchBody()).toEqual({ status: to }));
      unmount();
    }
  });

  it("only enables the stepper buttons the transition table allows", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    const stepButton = (status: string) =>
      screen.getAllByRole("button", { name: t(`risks.status.${status}`) })[0];
    // The current step stays clickable but is a no-op.
    expect(stepButton("identified")).toBeEnabled();
    await user.click(stepButton("identified"));
    expect(patches()).toHaveLength(0);
    expect(stepButton("analysed")).toBeEnabled();
    expect(stepButton("mitigation_planned")).toBeDisabled();
    expect(stepButton("closed")).toBeDisabled();

    await user.click(stepButton("analysed"));
    await waitFor(() => expect(lastPatchBody()).toEqual({ status: "analysed" }));
  });

  it("requires a rationale to accept, then records it", async () => {
    const { user } = renderPage();
    await waitForLoaded();

    await user.click(button(t("risks.action.accept")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("risks.action.acceptConfirm"))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: t("risks.action.acceptSubmit") }));
    expect(await findAlertText(t("risks.action.rationaleRequired"))).toBeInTheDocument();
    expect(patches()).toHaveLength(0);

    // Paste rather than type: one input event instead of 36 keystrokes
    // through a dialog on a heavy page keeps this test well under budget.
    await user.click(within(dialog).getByRole("textbox", { name: t("risks.action.acceptRationale") }));
    await user.paste("Cost of fixing exceeds the exposure.");
    await user.click(within(dialog).getByRole("button", { name: t("risks.action.acceptSubmit") }));
    await waitFor(() =>
      expect(lastPatchBody()).toEqual({
        status: "accepted",
        acceptance_rationale: "Cost of fixing exceeds the exposure.",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Accepted: the rationale is shown, no primary step, reopen + close side actions.
    expect(screen.getByText("Cost of fixing exceeds the exposure.")).toBeInTheDocument();
    expect(screen.queryByText(t("risks.action.nextStep"))).not.toBeInTheDocument();
    expect(button(t("risks.action.reopen"))).toBeInTheDocument();
    expect(button(t("risks.action.close"))).toBeInTheDocument();
  });

  it("cancels the accept dialog without patching", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(t("risks.action.accept")));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches()).toHaveLength(0);
  });

  it("pre-fills the rationale from an already accepted risk", async () => {
    scriptRisk({ ...RISK, status: "monitoring", acceptance_rationale: "Previously accepted." });
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(t("risks.action.accept")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: t("risks.action.acceptRationale") })).toHaveValue(
      "Previously accepted.",
    );
  });

  it("offers resume + close-now on a mitigated risk", async () => {
    scriptRisk({ ...RISK, status: "mitigated" });
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(t("risks.action.close_now")));
    await waitFor(() => expect(lastPatchBody()).toEqual({ status: "closed" }));
  });

  it("locks every input on a closed risk and reopens from the banner", async () => {
    scriptRisk({ ...RISK, status: "closed" });
    const { user } = renderPage();
    await waitForLoaded();

    expect(screen.getByText(t("risks.closed.readOnlyBanner"))).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: t("risks.field.title") })).toBeDisabled();
    expect(screen.getByTestId("pick-card")).toBeDisabled();
    expect(screen.getByTestId("affected-cards")).toHaveAttribute("data-read-only", "true");
    expect(screen.getByTestId("tasks-panel")).toHaveAttribute("data-closed", "true");
    expect(screen.queryByText(t("risks.action.nextStep"))).not.toBeInTheDocument();

    // Two Reopen buttons — banner action and side action — both work.
    const reopens = screen.getAllByRole("button", { name: new RegExp(t("risks.action.reopen")) });
    expect(reopens).toHaveLength(2);
    await user.click(reopens[0]);
    await waitFor(() => expect(lastPatchBody()).toEqual({ status: "in_progress" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: t("risks.field.title") })).toBeEnabled(),
    );
  });

  it("shows the mitigation task summary chips beside the residual block", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    expect(screen.queryByText(t("risks.tasks.summary.open", { open: 2, total: 3 }))).not.toBeInTheDocument();

    await user.click(screen.getByTestId("emit-summary"));
    expect(screen.getByText(t("risks.tasks.summary.open", { open: 2, total: 3 }))).toBeInTheDocument();
    expect(screen.getByText(t("risks.tasks.summary.overdue", { count: 1 }))).toBeInTheDocument();

    await user.click(screen.getByTestId("emit-summary-clean"));
    expect(screen.getByText(t("risks.tasks.summary.open", { open: 0, total: 1 }))).toBeInTheDocument();
    expect(screen.queryByText(t("risks.tasks.summary.overdue", { count: 1 }))).not.toBeInTheDocument();
  });
});

describe("RiskDetailPage — delete, print, navigation", () => {
  it("deletes after confirmation and returns to the register", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await waitForLoaded();

    await user.click(button(t("risks.deleteRisk")));
    expect(confirm).toHaveBeenCalledWith(t("risks.confirmDelete", { reference: RISK.reference }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/risks/r1")).toHaveLength(1));
    expect(await screen.findByTestId("register")).toHaveAttribute("data-search", "?tab=risk");
    confirm.mockRestore();
  });

  it("does nothing when the delete confirmation is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(t("risks.deleteRisk")));
    expect(mockApi.callsOf("delete", "/risks/r1")).toHaveLength(0);
    expect(screen.queryByTestId("register")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("reports a failed delete", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi.fail("delete", "/risks/r1", 403, "no");
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(t("risks.deleteRisk")));
    expect(await findAlertText(/DELETE \/risks\/r1 failed/)).toBeInTheDocument();
    expect(screen.queryByTestId("register")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("navigates back to the register", async () => {
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(t("risks.backToRegister")));
    expect(await screen.findByTestId("register")).toHaveAttribute("data-search", "?tab=risk");
  });

  it("opens the print window before fetching the tasks, then prints into it", async () => {
    const win = { close: vi.fn() } as unknown as Window;
    vi.mocked(openPrintWindow).mockReturnValue(win);
    const tasks = [{ id: "t1", reference: "T-000001" }] as unknown as MitigationTask[];
    mockApi.on("get", "/risks/r1/mitigation-tasks", tasks);
    const { user } = renderPage();
    await waitForLoaded();

    await user.click(button(td("editor.pdf")));
    expect(openPrintWindow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(printRisk).toHaveBeenCalledTimes(1));
    expect(vi.mocked(printRisk).mock.calls[0]).toEqual([
      expect.objectContaining({ id: "r1" }),
      tasks,
      win,
    ]);
    expect(win.close).not.toHaveBeenCalled();
  });

  it("closes the print window and reports when the tasks cannot be fetched", async () => {
    const win = { close: vi.fn() } as unknown as Window;
    vi.mocked(openPrintWindow).mockReturnValue(win);
    mockApi.fail("get", "/risks/r1/mitigation-tasks", 500);
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(td("editor.pdf")));
    expect(await findAlertText(/mitigation-tasks failed/)).toBeInTheDocument();
    expect(win.close).toHaveBeenCalledTimes(1);
    expect(printRisk).not.toHaveBeenCalled();
  });

  it("gives up quietly when a pop-up blocker swallows the print window", async () => {
    vi.mocked(openPrintWindow).mockReturnValue(null);
    const { user } = renderPage();
    await waitForLoaded();
    await user.click(button(td("editor.pdf")));
    expect(mockApi.callsOf("get", "/risks/r1/mitigation-tasks")).toHaveLength(0);
    expect(printRisk).not.toHaveBeenCalled();
  });

  it("strips the ?task= deep link and scrolls to the hash anchor", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.location.hash = "#occurrence-occ1";
    renderPage({ route: "/grc/risks/r1?task=t1" });
    await waitForLoaded();

    await waitFor(() => expect(screen.getByTestId("location")).toHaveAttribute("data-search", ""));
    expect(screen.getByTestId("location")).toHaveAttribute("data-path", "/grc/risks/r1");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("leaves an ordinary URL alone", async () => {
    renderPage({ route: "/grc/risks/r1?other=1" });
    await waitForLoaded();
    await act(async () => {});
    expect(screen.getByTestId("location")).toHaveAttribute("data-search", "?other=1");
  });
});

describe("RiskDetailPage — permissions", () => {
  it("renders the record read-only for a user holding only risks.view (2.157.0)", async () => {
    // The page used to read no permission, so a viewer saw an enabled Delete
    // button, editable fields and the workflow buttons; only the backend's
    // 403 stopped the write.
    renderPage({ user: userWith("risks.view") });
    await waitForLoaded();
    expect(queryButton(t("risks.deleteRisk"))).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: t("risks.field.title") })).toBeDisabled();
    expect(button(t("risks.action.analyse"))).toBeDisabled();
    expect(queryButton(t("risks.action.accept"))).toBeDisabled();
    // The record itself still renders.
    expect(screen.getByRole("heading", { level: 5 })).toHaveTextContent(RISK.title);
  });

  it("keeps every write control for a user holding risks.manage", async () => {
    renderPage({ user: userWith("risks.view", "risks.manage") });
    await waitForLoaded();
    expect(button(t("risks.deleteRisk"))).toBeEnabled();
    expect(screen.getByRole("textbox", { name: t("risks.field.title") })).toBeEnabled();
    expect(button(t("risks.action.analyse"))).toBeEnabled();
    expect(queryButton(t("risks.action.accept"))).toBeEnabled();
  });
});
