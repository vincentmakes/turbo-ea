/**
 * TurboLens → Duplicates tab, both sub-tabs.
 *
 * Duplicates: the clusters from `GET /turbolens/duplicates` as cards (status,
 * type, domain, members, evidence, recommendation) with status / type filters
 * and the three triage actions (`PATCH /turbolens/duplicates/{id}/status`).
 * Modernization: `GET /turbolens/duplicates/modernizations` grouped by
 * priority with a per-type chip filter. Both "run" buttons POST and then hand
 * the run to the real `useAnalysisPolling`, which reloads the matching list
 * when the run settles or surfaces its error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import i18n from "@/i18n";
import type { TurboLensDuplicateCluster, TurboLensModernization } from "@/types";
import TurboLensDuplicates from "./TurboLensDuplicates";

const CLUSTERS_URL = "/turbolens/duplicates";
const MODS_URL = "/turbolens/duplicates/modernizations";
const DETECT_URL = "/turbolens/duplicates/analyse";
const MODERNIZE_URL = "/turbolens/duplicates/modernize";
const STATUS_URL = /^\/turbolens\/duplicates\/[^/]+\/status$/;

function cluster(
  overrides: Partial<TurboLensDuplicateCluster> & { id: string; cluster_name: string },
): TurboLensDuplicateCluster {
  return {
    card_type: "Application",
    functional_domain: null,
    card_ids: null,
    card_names: null,
    evidence: "",
    recommendation: "",
    status: "pending",
    analysed_at: null,
    ...overrides,
  };
}

function modernization(
  overrides: Partial<TurboLensModernization> & { id: string },
): TurboLensModernization {
  return {
    target_type: "Application",
    card_name: null,
    current_tech: "",
    modernization_type: "rehost",
    recommendation: "",
    effort: "medium",
    priority: "medium",
    status: "open",
    ...overrides,
  };
}

const CRM = cluster({
  id: "c1",
  cluster_name: "CRM overlap",
  functional_domain: "Sales",
  card_names: ["Salesforce", "HubSpot"],
  evidence: "Both manage leads",
  recommendation: "Consolidate on Salesforce",
});
const DB = cluster({
  id: "c2",
  cluster_name: "Database overlap",
  card_type: "ITComponent",
  card_names: ["Oracle", "Postgres", "Salesforce"],
  evidence: "Same RDBMS role",
  recommendation: "Standardise",
  status: "confirmed",
});
const DOCS = cluster({ id: "c3", cluster_name: "Doc tools", status: "dismissed" });
const CLUSTERS = [CRM, DB, DOCS];

const MODS = [
  modernization({
    id: "m1",
    card_name: "Legacy CRM",
    current_tech: "COBOL on z/OS",
    modernization_type: "rehost",
    recommendation: "Move to SaaS",
    effort: "high",
    priority: "critical",
  }),
  modernization({
    id: "m2",
    target_type: "ITComponent",
    modernization_type: "upgrade",
    recommendation: "Upgrade to v19",
    effort: "low",
    priority: "",
  }),
  modernization({ id: "m3", card_name: "Old ERP", priority: "high", recommendation: "Re-platform" }),
  modernization({ id: "m4", card_name: "Intranet", priority: "low", recommendation: "Retire" }),
  modernization({ id: "m5", card_name: "Wiki", priority: "low", recommendation: "Replace" }),
];

function renderTab() {
  return renderWithProviders(<TurboLensDuplicates />, { route: "/turbolens?tab=duplicates" });
}

function kpiValue(label: string): string | null {
  const tile = screen.getByText(label).closest(".MuiPaper-root") as HTMLElement;
  return tile.querySelector("h5")?.textContent ?? null;
}

function clusterCard(name: string): HTMLElement {
  return screen.getByText(name).closest(".MuiCard-root") as HTMLElement;
}

function clusterNames(): string[] {
  return Array.from(document.querySelectorAll(".MuiCard-root h6")).map((h) => h.textContent ?? "");
}

/** A triage action: the tooltip labels the wrapper span, the icon names the button. */
function action(card: HTMLElement, tooltip: string): HTMLElement {
  return within(within(card).getByLabelText(tooltip)).getByRole("button");
}

function closeAlert(text: string) {
  const alert = screen.getByText(text).closest(".MuiAlert-root") as HTMLElement;
  return within(alert).getByRole("button", { name: "Close" });
}

/** A Select's label: the floating InputLabel and the outline notch sized around it. */
function expectSelectLabel(text: string) {
  expect(screen.getByText(text, { selector: "label" })).toBeInTheDocument();
  expect(screen.getByText(text, { selector: "legend span" })).toBeInTheDocument();
}

/** The paragraph a bold "Evidence:" / "Recommendation:" lead-in opens. */
function leadIn(card: HTMLElement, label: string): string | null {
  return within(card).getByText(`${label}:`).parentElement?.textContent ?? null;
}

const DETECT = /Detect Duplicates$/;
const ASSESS = /Assess Modernization$/;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
});

describe("TurboLensDuplicates — overview", () => {
  it("summarises clusters and modernizations in the KPI tiles and tab labels", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, MODS);
    renderTab();

    expect(screen.getByRole("heading", { name: "Duplicate Detection & Modernization" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Detect functional duplicate cards and identify modernization opportunities across your landscape.",
      ),
    ).toBeInTheDocument();
    await screen.findByText("CRM overlap");
    expect(kpiValue("Duplicate Clusters")).toBe("3 (1 pending)");
    expect(kpiValue("Confirmed Duplicates")).toBe("1");
    // Salesforce appears in two clusters and is counted once.
    expect(kpiValue("Affected Cards")).toBe("4");
    expect(kpiValue("Mod. Opportunities")).toBe("5 (2 critical/high)");
    expect(screen.getByRole("tab", { name: "Duplicates (3)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Modernization (5)" })).toBeInTheDocument();
  });

  it("drops the pending and critical qualifiers when there are none", async () => {
    mockApi.on("get", CLUSTERS_URL, [DB]);
    mockApi.on("get", MODS_URL, [MODS[3]]);
    renderTab();

    await screen.findByText("Database overlap");
    expect(kpiValue("Duplicate Clusters")).toBe("1");
    expect(kpiValue("Mod. Opportunities")).toBe("1");
  });

  it("counts critical and high opportunities, each on its own", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    // Legacy CRM is critical, Old ERP high, Intranet low.
    mockApi.on("get", MODS_URL, [MODS[0], MODS[2], MODS[3]]);
    renderTab();

    await waitFor(() => expect(kpiValue("Mod. Opportunities")).toBe("3 (2 critical/high)"));
  });

  it("paints zero counts and a spinner before anything is requested", () => {
    // The very first render, before any effect has run.
    const html = renderToStaticMarkup(wrapWithProviders(<TurboLensDuplicates />));
    expect(html).toContain("Duplicates (0)");
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("No duplicate clusters found");
  });

  it("labels cluster types once the metamodel arrives after the clusters", async () => {
    withMetamodel([]);
    mockApi.on("get", CLUSTERS_URL, [DB]);
    mockApi.on("get", MODS_URL, []);
    const { rerender } = renderTab();

    await screen.findByText("Database overlap");
    expect(within(clusterCard("Database overlap")).getByText("ITComponent")).toBeInTheDocument();

    withMetamodel(CARD_TYPES);
    rerender(wrapWithProviders(<TurboLensDuplicates />, { route: "/turbolens?tab=duplicates" }));
    expect(within(clusterCard("Database overlap")).getByText("IT Component")).toBeInTheDocument();
  });
});

describe("TurboLensDuplicates — duplicate clusters", () => {
  it("shows a spinner, then the empty state when nothing was found", async () => {
    let resolve: (v: TurboLensDuplicateCluster[]) => void = () => {};
    mockApi.on("get", CLUSTERS_URL, () => new Promise<TurboLensDuplicateCluster[]>((r) => (resolve = r)));
    mockApi.on("get", MODS_URL, []);
    renderTab();

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    resolve([]);
    expect(await screen.findByText("No duplicate clusters found")).toBeInTheDocument();
    expect(
      screen.getByText("Run duplicate detection to find functional overlaps in your portfolio."),
    ).toBeInTheDocument();
  });

  it("shows each list's load error, not its empty state, when it cannot be loaded", async () => {
    mockApi.fail("get", CLUSTERS_URL);
    mockApi.fail("get", MODS_URL);
    const { user } = renderTab();

    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${CLUSTERS_URL} failed`);
    expect(screen.queryByText("No duplicate clusters found")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Modernization/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${MODS_URL} failed`);
    expect(screen.queryByText("No modernization assessments yet")).not.toBeInTheDocument();
  });

  it("keeps the two lists' load errors apart, with a generic message when the error carries none", async () => {
    mockApi.on("get", CLUSTERS_URL, () => Promise.reject("offline"));
    mockApi.on("get", MODS_URL, []);
    const { user } = renderTab();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByText("No duplicate clusters found")).not.toBeInTheDocument();

    // The modernization list loaded: its empty state, no error.
    await user.click(screen.getByRole("tab", { name: /^Modernization/ }));
    expect(await screen.findByText("No modernization assessments yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names a modernization load that fails with no message of its own generically, apart from the clusters", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, () => Promise.reject("offline"));
    const { user } = renderTab();

    // The cluster list loaded: its empty state, no error.
    expect(await screen.findByText("No duplicate clusters found")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Modernization/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Something went wrong$/);
    expect(screen.queryByText("No modernization assessments yet")).not.toBeInTheDocument();
  });

  it("renders each cluster with its type, domain, members, evidence and recommendation", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    renderTab();

    await screen.findByText("CRM overlap");
    const crm = clusterCard("CRM overlap");
    expect(within(crm).getByText("Pending")).toBeInTheDocument();
    expect(within(crm).getByText("Application")).toBeInTheDocument();
    expect(within(crm).getByText("Sales")).toHaveClass("MuiChip-label");
    expect(within(crm).getByText("Members")).toBeInTheDocument();
    expect(within(crm).getByText("Salesforce")).toBeInTheDocument();
    expect(within(crm).getByText("HubSpot")).toBeInTheDocument();
    expect(leadIn(crm, "Evidence")).toBe("Evidence: Both manage leads");
    expect(leadIn(crm, "Recommendation")).toBe("Recommendation: Consolidate on Salesforce");

    // The type is labelled from the metamodel.
    expect(within(clusterCard("Database overlap")).getByText("IT Component")).toBeInTheDocument();

    // No members → no Members block; no domain → only the status and type chips.
    const docs = clusterCard("Doc tools");
    expect(within(docs).queryByText("Members")).not.toBeInTheDocument();
    expect(Array.from(docs.querySelectorAll(".MuiChip-root")).map((c) => c.textContent)).toEqual([
      "Dismissed",
      "Application",
    ]);

    // The action matching the current status is disabled.
    expect(action(crm, "Confirm duplicate")).toBeEnabled();
    expect(action(clusterCard("Database overlap"), "Confirm duplicate")).toBeDisabled();
    expect(action(clusterCard("Doc tools"), "Dismiss")).toBeDisabled();
  });

  it("filters clusters by status and by card type", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    expectSelectLabel("Status");
    expectSelectLabel("Type");
    const [statusSelect, typeSelect] = screen.getAllByRole("combobox");

    await user.click(statusSelect);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All",
      "Pending",
      "Confirmed",
      "Investigating",
      "Dismissed",
    ]);
    await user.click(screen.getByRole("option", { name: "Confirmed" }));
    expect(clusterNames()).toEqual(["Database overlap"]);

    await user.click(statusSelect);
    await user.click(screen.getByRole("option", { name: "Investigating" }));
    expect(screen.getByText("No duplicate clusters found")).toBeInTheDocument();

    await user.click(statusSelect);
    await user.click(screen.getByRole("option", { name: "All" }));
    await user.click(typeSelect);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All",
      "Application",
      "IT Component",
    ]);
    await user.click(screen.getByRole("option", { name: "Application" }));
    expect(clusterNames()).toEqual(["CRM overlap", "Doc tools"]);
  });

  it("confirms, investigates and dismisses a cluster", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    let finishPatch: () => void = () => {};
    mockApi.on("patch", STATUS_URL, () => new Promise<void>((r) => (finishPatch = r)));
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(action(clusterCard("CRM overlap"), "Confirm duplicate"));

    // While the PATCH is in flight the actions give way to a spinner.
    const crm = clusterCard("CRM overlap");
    expect(within(crm).getByRole("progressbar")).toBeInTheDocument();
    expect(within(crm).queryByLabelText("Confirm duplicate")).not.toBeInTheDocument();
    finishPatch();

    await waitFor(() => expect(within(clusterCard("CRM overlap")).getByText("Confirmed")).toBeInTheDocument());
    expect(mockApi.callsOf("patch", STATUS_URL)).toEqual([
      { method: "patch", path: "/turbolens/duplicates/c1/status", body: { status: "confirmed" } },
    ]);
    expect(action(clusterCard("CRM overlap"), "Confirm duplicate")).toBeDisabled();
    expect(kpiValue("Confirmed Duplicates")).toBe("2");
    expect(kpiValue("Duplicate Clusters")).toBe("3");

    mockApi.on("patch", STATUS_URL, undefined);
    await user.click(action(clusterCard("CRM overlap"), "Investigate"));
    await waitFor(() =>
      expect(within(clusterCard("CRM overlap")).getByText("Investigating")).toBeInTheDocument(),
    );
    await user.click(action(clusterCard("CRM overlap"), "Dismiss"));
    await waitFor(() => expect(within(clusterCard("CRM overlap")).getByText("Dismissed")).toBeInTheDocument());
    expect(mockApi.callsOf("patch", STATUS_URL).map((c) => c.body)).toEqual([
      { status: "confirmed" },
      { status: "investigating" },
      { status: "dismissed" },
    ]);
  });

  it("keeps the status and shows the error when the update fails", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    mockApi.fail("patch", STATUS_URL, 403, "Forbidden");
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(action(clusterCard("CRM overlap"), "Dismiss"));

    expect(await screen.findByText("PATCH /turbolens/duplicates/c1/status failed")).toBeInTheDocument();
    expect(within(clusterCard("CRM overlap")).getByText("Pending")).toBeInTheDocument();
    expect(action(clusterCard("CRM overlap"), "Dismiss")).toBeEnabled();

    await user.click(closeAlert("PATCH /turbolens/duplicates/c1/status failed"));
    expect(screen.queryByText(/status failed/)).not.toBeInTheDocument();
  });

  it("runs duplicate detection and reloads the clusters when the run completes", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", DETECT_URL, { run_id: "run-d" });
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", "/turbolens/analysis-runs/run-d", () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await screen.findByText("No duplicate clusters found");
    await user.click(screen.getByRole("button", { name: DETECT }));

    expect(await screen.findByText("Duplicate detection started")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", "/turbolens/analysis-runs/run-d")).toHaveLength(1));
    expect(screen.getByRole("button", { name: DETECT })).toBeDisabled();

    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    answerPoll({ id: "run-d", status: "completed", analysis_type: "duplicates" });
    expect(await screen.findByText("CRM overlap")).toBeInTheDocument();
    expect(mockApi.callsOf("get", CLUSTERS_URL)).toHaveLength(2);
    // Only the clusters are reloaded, not the modernizations.
    expect(mockApi.callsOf("get", MODS_URL)).toHaveLength(1);
    expect(screen.getByRole("button", { name: DETECT })).toBeEnabled();

    await user.click(closeAlert("Duplicate detection started"));
    expect(screen.queryByText("Duplicate detection started")).not.toBeInTheDocument();
  });

  it("shows the error when detection cannot be started", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    mockApi.fail("post", DETECT_URL, 409, "already running");
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(screen.getByRole("button", { name: DETECT }));
    expect(await screen.findByText(`POST ${DETECT_URL} failed`)).toBeInTheDocument();
    expect(screen.queryByText("Duplicate detection started")).not.toBeInTheDocument();
  });

  it("stringifies an error that is not an ApiError", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", DETECT_URL, () => {
      throw new Error("socket hang up");
    });
    mockApi.on("patch", STATUS_URL, () => {
      throw new Error("patch exploded");
    });
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(screen.getByRole("button", { name: DETECT }));
    expect(await screen.findByText("Error: socket hang up")).toBeInTheDocument();

    await user.click(action(clusterCard("CRM overlap"), "Confirm duplicate"));
    expect(await screen.findByText("Error: patch exploded")).toBeInTheDocument();
  });
});

describe("TurboLensDuplicates — modernization", () => {
  async function openModernization(user: ReturnType<typeof renderTab>["user"], count: number) {
    await user.click(await screen.findByRole("tab", { name: `Modernization (${count})` }));
  }

  it("shows a spinner, then the empty state when there are no assessments", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    let resolve: (v: TurboLensModernization[]) => void = () => {};
    mockApi.on("get", MODS_URL, () => new Promise<TurboLensModernization[]>((r) => (resolve = r)));
    const { user } = renderTab();

    await openModernization(user, 0);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    resolve([]);
    expect(await screen.findByText("No modernization assessments yet")).toBeInTheDocument();
    expect(
      screen.getByText("Run a modernization assessment to identify upgrade opportunities."),
    ).toBeInTheDocument();
  });

  it("groups opportunities by priority, critical first", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    const { user } = renderTab();

    await openModernization(user, 5);
    const headers = screen.getAllByText(/^(CRITICAL|HIGH|MEDIUM|LOW)$/);
    expect(headers.map((h) => h.textContent)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect(screen.getAllByText("1 opportunity")).toHaveLength(3);
    expect(screen.getByText("2 opportunities")).toBeInTheDocument();

    const legacy = screen.getByText("Legacy CRM").closest(".MuiCard-root") as HTMLElement;
    expect(within(legacy).getByText("High")).toBeInTheDocument(); // effort
    expect(within(legacy).getByText("Critical")).toBeInTheDocument(); // priority
    expect(within(legacy).getByText("rehost")).toBeInTheDocument();
    expect(within(legacy).getByText("COBOL on z/OS")).toBeInTheDocument();
    expect(within(legacy).getByText("Move to SaaS")).toBeInTheDocument();

    // No priority → the MEDIUM group; no card name → a dash; no current tech → no code line.
    const unnamed = screen.getByText("Upgrade to v19").closest(".MuiCard-root") as HTMLElement;
    expect(within(unnamed).getByText("-")).toBeInTheDocument();
    expect(within(unnamed).queryByText("COBOL on z/OS")).not.toBeInTheDocument();
    const medium = screen.getByText("MEDIUM").closest(".MuiBox-root") as HTMLElement;
    expect(within(medium).getByText("Upgrade to v19")).toBeInTheDocument();
  });

  it("filters by target type with the chip row", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    const { user } = renderTab();

    await openModernization(user, 5);
    expect(screen.getByRole("button", { name: "All (5)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Application (4)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "IT Component (1)" }));
    expect(screen.getByText("Upgrade to v19")).toBeInTheDocument();
    expect(screen.queryByText("Legacy CRM")).not.toBeInTheDocument();
    expect(screen.queryByText("CRITICAL")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All (5)" }));
    expect(screen.getByText("Legacy CRM")).toBeInTheDocument();
  });

  it("assesses the chosen target type and reloads the opportunities when the run completes", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", MODERNIZE_URL, { run_id: "run-m" });
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", "/turbolens/analysis-runs/run-m", () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await openModernization(user, 0);
    await screen.findByText("No modernization assessments yet");

    // Target types are labelled from the metamodel; unknown keys stay raw.
    await user.click(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Application",
      "IT Component",
      "Interface",
      "DataObject",
      "System",
    ]);
    await user.click(screen.getByRole("option", { name: "IT Component" }));
    await user.click(screen.getByRole("button", { name: ASSESS }));

    expect(await screen.findByText("Modernization assessment started")).toBeInTheDocument();
    expect(mockApi.callsOf("post", MODERNIZE_URL)[0].body).toEqual({ target_type: "ITComponent" });
    await waitFor(() => expect(mockApi.callsOf("get", "/turbolens/analysis-runs/run-m")).toHaveLength(1));
    expect(screen.getByRole("button", { name: ASSESS })).toBeDisabled();

    mockApi.on("get", MODS_URL, MODS);
    answerPoll({ id: "run-m", status: "completed", analysis_type: "modernization" });
    expect(await screen.findByText("Legacy CRM")).toBeInTheDocument();
    expect(mockApi.callsOf("get", MODS_URL)).toHaveLength(2);
    expect(mockApi.callsOf("get", CLUSTERS_URL)).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Modernization (5)" })).toBeInTheDocument();
  });

  it("surfaces a failed assessment run and a failure to start one", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", MODERNIZE_URL, { run_id: "run-m" });
    mockApi.on("get", "/turbolens/analysis-runs/run-m", {
      id: "run-m",
      status: "failed",
      analysis_type: "modernization",
      error_message: "Model returned invalid JSON",
    });
    const { user } = renderTab();

    await openModernization(user, 0);
    await user.click(screen.getByRole("button", { name: ASSESS }));
    expect(await screen.findByText("Model returned invalid JSON")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: ASSESS })).toBeEnabled());

    mockApi.fail("post", MODERNIZE_URL, 400, "bad type");
    await user.click(screen.getByRole("button", { name: ASSESS }));
    expect(await screen.findByText(`POST ${MODERNIZE_URL} failed`)).toBeInTheDocument();
    expect(screen.queryByText("Model returned invalid JSON")).not.toBeInTheDocument();

    mockApi.on("post", MODERNIZE_URL, () => {
      throw new Error("offline");
    });
    await user.click(screen.getByRole("button", { name: ASSESS }));
    expect(await screen.findByText("Error: offline")).toBeInTheDocument();
  });

  it("assesses Application by default", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", MODERNIZE_URL, { run_id: "run-m" });
    mockApi.on("get", "/turbolens/analysis-runs/run-m", () => new Promise(() => {}));
    const { user } = renderTab();

    await openModernization(user, 0);
    expectSelectLabel("Target Type");
    expect(screen.getByRole("combobox")).toHaveTextContent("Application");
    await user.click(screen.getByRole("button", { name: ASSESS }));
    await waitFor(() => expect(mockApi.callsOf("post", MODERNIZE_URL)).toHaveLength(1));
    expect(mockApi.callsOf("post", MODERNIZE_URL)[0].body).toEqual({ target_type: "Application" });
  });

  it("orders the type chips alphabetically and marks the active one", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, [MODS[1], MODS[0]]);
    const { user } = renderTab();

    await openModernization(user, 2);
    const chips = () =>
      ["All (2)", "Application (1)", "IT Component (1)"].map((name) =>
        screen.getByRole("button", { name }),
      );
    expect(
      screen
        .getAllByRole("button")
        .map((b) => b.textContent)
        .filter((t) => /\(\d+\)$/.test(t ?? "")),
    ).toEqual(["All (2)", "Application (1)", "IT Component (1)"]);

    let [all, app, itc] = chips();
    expect(all).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
    expect(app).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    expect(itc).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");

    await user.click(itc);
    [all, app, itc] = chips();
    expect(all).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    expect(app).toHaveClass("MuiChip-outlined", "MuiChip-colorDefault");
    expect(itc).toHaveClass("MuiChip-filled", "MuiChip-colorPrimary");
  });

  it("sets the current technology apart as a code line, and leaves it out when empty", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    const { user } = renderTab();

    await openModernization(user, 5);
    const legacy = screen.getByText("Legacy CRM").closest(".MuiCard-root") as HTMLElement;
    expect(within(legacy).getByText("COBOL on z/OS")).toHaveClass("MuiTypography-caption");
    const unnamed = screen.getByText("Upgrade to v19").closest(".MuiCard-root") as HTMLElement;
    expect(unnamed.querySelectorAll(".MuiTypography-caption")).toHaveLength(0);
  });

  it("disables the button while the request is in flight and clears earlier notices", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", MODERNIZE_URL, { run_id: "run-m" });
    mockApi.on("get", "/turbolens/analysis-runs/run-m", {
      id: "run-m",
      status: "failed",
      analysis_type: "modernization",
      error_message: "Model returned invalid JSON",
    });
    const { user } = renderTab();

    await openModernization(user, 0);
    await user.click(screen.getByRole("button", { name: ASSESS }));
    expect(await screen.findByText("Model returned invalid JSON")).toBeInTheDocument();
    expect(screen.getByText("Modernization assessment started")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: ASSESS })).toBeEnabled());

    let answerPost: (v: { run_id: string }) => void = () => {};
    mockApi.on("post", MODERNIZE_URL, () => new Promise<{ run_id: string }>((r) => (answerPost = r)));
    mockApi.on("get", "/turbolens/analysis-runs/run-m2", () => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: ASSESS }));

    // Both the old error and the old notice go at once, and the button locks.
    expect(screen.queryByText("Model returned invalid JSON")).not.toBeInTheDocument();
    expect(screen.queryByText("Modernization assessment started")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: ASSESS })).toBeDisabled();
    answerPost({ run_id: "run-m2" });
    expect(await screen.findByText("Modernization assessment started")).toBeInTheDocument();
  });

  it("shows the error instead of the opportunities when the reload after a run fails", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    mockApi.on("post", MODERNIZE_URL, { run_id: "run-m" });
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", "/turbolens/analysis-runs/run-m", () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await openModernization(user, 5);
    await user.click(screen.getByRole("button", { name: ASSESS }));
    await waitFor(() => expect(mockApi.callsOf("get", "/turbolens/analysis-runs/run-m")).toHaveLength(1));

    mockApi.fail("get", MODS_URL);
    answerPoll({ id: "run-m", status: "completed", analysis_type: "modernization" });
    expect(await screen.findByText(`GET ${MODS_URL} failed`)).toBeInTheDocument();
    expect(screen.queryByText("No modernization assessments yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy CRM")).not.toBeInTheDocument();

    // The next successful reload clears the error.
    mockApi.on("get", MODS_URL, MODS);
    mockApi.on("get", "/turbolens/analysis-runs/run-m2", { id: "run-m2", status: "completed" });
    mockApi.on("post", MODERNIZE_URL, { run_id: "run-m2" });
    await waitFor(() => expect(screen.getByRole("button", { name: ASSESS })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: ASSESS }));
    expect(await screen.findByText("Legacy CRM")).toBeInTheDocument();
    expect(screen.queryByText(`GET ${MODS_URL} failed`)).not.toBeInTheDocument();
  });
});

describe("TurboLensDuplicates — more cluster cases", () => {
  it("orders the type filter alphabetically, whatever the load order", async () => {
    mockApi.on("get", CLUSTERS_URL, [DB, CRM]);
    mockApi.on("get", MODS_URL, []);
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(screen.getAllByRole("combobox")[1]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All",
      "Application",
      "IT Component",
    ]);
  });

  it("hides the Members block for an empty member list, and locks Investigate while investigating", async () => {
    mockApi.on("get", CLUSTERS_URL, [
      cluster({ id: "c9", cluster_name: "Under review", status: "investigating", card_names: [] }),
    ]);
    mockApi.on("get", MODS_URL, []);
    renderTab();

    const card = (await screen.findByText("Under review")).closest(".MuiCard-root") as HTMLElement;
    expect(within(card).queryByText("Members")).not.toBeInTheDocument();
    expect(action(card, "Investigate")).toBeDisabled();
    expect(action(card, "Confirm duplicate")).toBeEnabled();
    expect(action(card, "Dismiss")).toBeEnabled();
  });

  it("surfaces a failed detection run", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", DETECT_URL, { run_id: "run-d" });
    mockApi.on("get", "/turbolens/analysis-runs/run-d", {
      id: "run-d",
      status: "failed",
      analysis_type: "duplicates",
      error_message: "Embedding service down",
    });
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(screen.getByRole("button", { name: DETECT }));
    expect(await screen.findByText("Embedding service down")).toBeInTheDocument();
  });

  it("disables the button while detection is starting and clears earlier notices", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", DETECT_URL, { run_id: "run-d" });
    mockApi.on("get", "/turbolens/analysis-runs/run-d", {
      id: "run-d",
      status: "failed",
      analysis_type: "duplicates",
      error_message: "Embedding service down",
    });
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(screen.getByRole("button", { name: DETECT }));
    expect(await screen.findByText("Embedding service down")).toBeInTheDocument();
    expect(screen.getByText("Duplicate detection started")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: DETECT })).toBeEnabled());

    let answerPost: (v: { run_id: string }) => void = () => {};
    mockApi.on("post", DETECT_URL, () => new Promise<{ run_id: string }>((r) => (answerPost = r)));
    mockApi.on("get", "/turbolens/analysis-runs/run-d2", () => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: DETECT }));

    expect(screen.queryByText("Embedding service down")).not.toBeInTheDocument();
    expect(screen.queryByText("Duplicate detection started")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: DETECT })).toBeDisabled();
    answerPost({ run_id: "run-d2" });
    expect(await screen.findByText("Duplicate detection started")).toBeInTheDocument();
  });

  it("shows the error instead of the clusters when the reload after a run fails", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    mockApi.on("post", DETECT_URL, { run_id: "run-d" });
    let answerPoll: (run: unknown) => void = () => {};
    mockApi.on("get", "/turbolens/analysis-runs/run-d", () => new Promise((r) => (answerPoll = r)));
    const { user } = renderTab();

    await screen.findByText("CRM overlap");
    await user.click(screen.getByRole("button", { name: DETECT }));
    await waitFor(() => expect(mockApi.callsOf("get", "/turbolens/analysis-runs/run-d")).toHaveLength(1));

    mockApi.fail("get", CLUSTERS_URL);
    answerPoll({ id: "run-d", status: "completed", analysis_type: "duplicates" });
    expect(await screen.findByText(`GET ${CLUSTERS_URL} failed`)).toBeInTheDocument();
    expect(screen.queryByText("No duplicate clusters found")).not.toBeInTheDocument();
    expect(screen.queryByText("CRM overlap")).not.toBeInTheDocument();

    // The next successful reload clears the error.
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", "/turbolens/analysis-runs/run-d2", { id: "run-d2", status: "completed" });
    mockApi.on("post", DETECT_URL, { run_id: "run-d2" });
    await waitFor(() => expect(screen.getByRole("button", { name: DETECT })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: DETECT }));
    expect(await screen.findByText("CRM overlap")).toBeInTheDocument();
    expect(screen.queryByText(`GET ${CLUSTERS_URL} failed`)).not.toBeInTheDocument();
  });
});

describe("TurboLensDuplicates — every counted opportunity is listed", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("lists an opportunity whose priority is not one of the four, after the known groups", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, [
      modernization({ id: "u1", card_name: "Mainframe", priority: "urgent", recommendation: "Escalate" }),
      ...MODS,
      modernization({ id: "u2", card_name: "Fax server", priority: "urgent", recommendation: "Switch off" }),
      modernization({ id: "a1", card_name: "Wiki", priority: "asap", recommendation: "Migrate" }),
    ]);
    const { user } = renderTab();

    await user.click(await screen.findByRole("tab", { name: "Modernization (8)" }));
    expect(screen.getByRole("button", { name: "All (8)" })).toBeInTheDocument();
    // Eight counted, eight listed.
    expect(document.querySelectorAll(".MuiCard-root")).toHaveLength(8);
    // The other priorities follow the known four, alphabetically.
    const headers = screen.getAllByText(/^(CRITICAL|HIGH|MEDIUM|LOW|URGENT|ASAP)$/);
    expect(headers.map((h) => h.textContent)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "ASAP", "URGENT"]);
    const urgent = screen.getByText("URGENT").closest(".MuiBox-root") as HTMLElement;
    expect(within(urgent).getByText("Escalate")).toBeInTheDocument();
    expect(within(urgent).getByText("Switch off")).toBeInTheDocument();
    expect(within(urgent).getByText("2 opportunities")).toBeInTheDocument();
  });

  it("counts each group's opportunities in the user's language", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    const { user } = renderTab();

    await user.click(await screen.findByRole("tab", { name: "Modernization (5)" }));
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(await screen.findAllByText("1 Möglichkeit")).toHaveLength(3);
    expect(screen.getByText("2 Möglichkeiten")).toBeInTheDocument();
    expect(screen.queryByText(/opportunit/)).not.toBeInTheDocument();
  });
});

describe("TurboLensDuplicates — statuses, priorities and efforts in the user's language", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  function chipTexts(card: HTMLElement): string[] {
    return Array.from(card.querySelectorAll(".MuiChip-root")).map((c) => c.textContent ?? "");
  }

  it("shows a status outside the known ones as it came, and never a key path", async () => {
    mockApi.on("get", CLUSTERS_URL, [
      cluster({ id: "c7", cluster_name: "Archived pair", status: "archived" }),
      cluster({ id: "c8", cluster_name: "Statusless pair", status: "" }),
    ]);
    mockApi.on("get", MODS_URL, []);
    renderTab();

    await screen.findByText("Archived pair");
    expect(chipTexts(clusterCard("Archived pair"))[0]).toBe("archived");
    expect(clusterCard("Statusless pair").textContent).not.toMatch(/turbolens_/);
  });

  it("labels a cluster's status chip in the user's language", async () => {
    mockApi.on("get", CLUSTERS_URL, CLUSTERS);
    mockApi.on("get", MODS_URL, []);
    renderTab();

    await screen.findByText("CRM overlap");
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(await within(clusterCard("CRM overlap")).findByText("Ausstehend")).toBeInTheDocument();
    expect(within(clusterCard("Database overlap")).getByText("Bestätigt")).toBeInTheDocument();
    expect(within(clusterCard("Doc tools")).getByText("Abgelehnt")).toBeInTheDocument();
    expect(screen.queryByText(/^(pending|confirmed|dismissed)$/)).not.toBeInTheDocument();
  });

  it("labels each opportunity's priority group, priority and effort in the user's language", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    const { user } = renderTab();

    await user.click(await screen.findByRole("tab", { name: "Modernization (5)" }));
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    const headers = await screen.findAllByText(/^(KRITISCH|HOCH|MITTEL|NIEDRIG)$/);
    expect(headers.map((h) => h.textContent)).toEqual(["KRITISCH", "HOCH", "MITTEL", "NIEDRIG"]);
    expect(screen.queryByText(/^(CRITICAL|HIGH|MEDIUM|LOW)$/i)).not.toBeInTheDocument();

    // Effort first, then priority.
    const legacy = screen.getByText("Legacy CRM").closest(".MuiCard-root") as HTMLElement;
    expect(chipTexts(legacy).slice(0, 2)).toEqual(["Hoch", "Kritisch"]);
    const wiki = screen.getByText("Wiki").closest(".MuiCard-root") as HTMLElement;
    expect(chipTexts(wiki).slice(0, 2)).toEqual(["Mittel", "Niedrig"]);
  });

  it("gives an opportunity with no priority the priority of the group it is listed under", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, MODS);
    const { user } = renderTab();

    await user.click(await screen.findByRole("tab", { name: "Modernization (5)" }));
    const unnamed = screen.getByText("Upgrade to v19").closest(".MuiCard-root") as HTMLElement;
    expect(chipTexts(unnamed).slice(0, 2)).toEqual(["Low", "Medium"]);
    expect(within(unnamed).getByText("Medium").closest(".MuiChip-root")).toHaveClass("MuiChip-colorWarning");
  });

  it("shows a priority or effort outside the known ones as the AI returned it, and no chip for a missing effort", async () => {
    mockApi.on("get", CLUSTERS_URL, []);
    mockApi.on("get", MODS_URL, [
      modernization({ id: "u1", card_name: "Mainframe", priority: "urgent", effort: "huge", modernization_type: "" }),
      modernization({ id: "u2", card_name: "Fax server", priority: "low", effort: "", modernization_type: "" }),
    ]);
    const { user } = renderTab();

    await user.click(await screen.findByRole("tab", { name: "Modernization (2)" }));
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(await screen.findByText("URGENT")).toBeInTheDocument();
    const mainframe = screen.getByText("Mainframe").closest(".MuiCard-root") as HTMLElement;
    expect(chipTexts(mainframe).slice(0, 2)).toEqual(["huge", "urgent"]);
    const fax = screen.getByText("Fax server").closest(".MuiCard-root") as HTMLElement;
    expect(chipTexts(fax)[0]).toBe("Niedrig");
    expect(fax.textContent).not.toMatch(/turbolens_/);
    expect(mainframe.textContent).not.toMatch(/turbolens_/);
  });
});
