/**
 * Page test for the survey results page (`/admin/surveys/:id/results`).
 */
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import { CARD_TYPES, RELATION_TYPES, REL_APP_TO_ITC } from "@/test/fixtures/metamodel";
import { adminUser, renderWithProviders } from "@/test/render";
import type { Survey, SurveyField, SurveyResponseDetail } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
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

import SurveyResults from "./SurveyResults";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SURVEY_ID = "s1";

const FIELDS: SurveyField[] = [
  {
    key: "criticality",
    section: "Details",
    label: "Criticality",
    type: "single_select",
    options: [
      { key: "high", label: "High" },
      { key: "low", label: "Low" },
    ],
    action: "maintain",
  },
  { key: "isPci", section: "Details", label: "PCI relevant", type: "boolean", action: "confirm" },
  {
    key: "regions",
    section: "Details",
    label: "Regions",
    type: "multiple_select",
    options: [
      { key: "emea", label: "EMEA" },
      { key: "apac", label: "APAC" },
    ],
    action: "maintain",
  },
  { key: "notes", section: "Details", label: "Notes", type: "text", action: "maintain" },
  { key: "aliases", section: "Details", label: "Aliases", type: "text", action: "maintain" },
  {
    key: "rel_relAppToITC_out",
    section: "Relations",
    label: "stale snapshot label",
    type: "relation",
    kind: "relation",
    relation_type_key: REL_APP_TO_ITC.key,
    direction: "outgoing",
    related_type_key: "ITComponent",
    action: "maintain",
  },
  {
    key: "rel_relAppToITC_in",
    section: "Relations",
    label: "incoming snapshot",
    type: "relation",
    kind: "relation",
    relation_type_key: REL_APP_TO_ITC.key,
    direction: "incoming",
    related_type_key: "ITComponent",
    action: "maintain",
  },
];

function survey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: SURVEY_ID,
    name: "Q3 application review",
    description: "Please review https://wiki.example.com/q3 before answering.",
    message: "",
    status: "active",
    target_type_key: "Application",
    target_filters: {},
    target_roles: ["owner"],
    fields: FIELDS,
    ...overrides,
  };
}

const ITC_1 = { id: "11111111-0000-4000-8000-000000000001", name: "PostgreSQL" };
const ITC_2 = { id: "11111111-0000-4000-8000-000000000002", name: "Redis" };

function response(overrides: Partial<SurveyResponseDetail> & { id: string }): SurveyResponseDetail {
  return {
    survey_id: SURVEY_ID,
    card_id: `card-${overrides.id}`,
    card_name: `Card ${overrides.id}`,
    card_type: "Application",
    user_id: `user-${overrides.id}`,
    user_display_name: `Person ${overrides.id}`,
    user_email: `${overrides.id}@test.local`,
    status: "pending",
    responses: {},
    applied: false,
    ...overrides,
  };
}

/** Completed with real changes, not yet applied. */
const CHANGED = response({
  id: "r1",
  card_name: "Billing Engine",
  user_display_name: "Dana Lee",
  status: "completed",
  responded_at: "2026-03-02T10:00:00Z",
  responses: {
    criticality: { current_value: "low", new_value: "high", confirmed: false },
    isPci: { current_value: false, new_value: null, confirmed: true },
    regions: { current_value: ["emea"], new_value: ["emea", "apac"], confirmed: false },
    notes: { current_value: null, new_value: null, confirmed: false },
    aliases: { current_value: ["be", "billing"], new_value: null, confirmed: true },
    rel_relAppToITC_out: { current_value: [ITC_1], new_value: [ITC_1, ITC_2], confirmed: false },
    rel_relAppToITC_in: { current_value: [], new_value: null, confirmed: true },
  },
});
/** Completed, everything confirmed, already applied. */
const APPLIED = response({
  id: "r2",
  status: "completed",
  applied: true,
  responded_at: "2026-03-01T10:00:00Z",
  applied_at: "2026-03-01T11:00:00Z",
  responses: {
    criticality: { current_value: "low", new_value: null, confirmed: true },
    isPci: { current_value: true, new_value: null, confirmed: true },
  },
});
/** Not answered yet; the card name is missing so the id shows. */
const PENDING = response({ id: "r3", card_name: undefined });

const RESPONSES = [CHANGED, APPLIED, PENDING];

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;

/** MUI buttons with a `startIcon` carry the icon's ligature text in their accessible name. */
const named = (label: string) => (name: string) => name === label || name.endsWith(` ${label}`);

function renderPage(route = `/admin/surveys/${SURVEY_ID}/results`) {
  return renderWithProviders(<SurveyResults />, {
    route,
    routes: [
      { path: "/admin/surveys/:id/results" },
      { path: "/admin/surveys", element: <div data-testid="surveys-list" /> },
      { path: "/cards/:id", element: <div data-testid="card-page" /> },
    ],
    user: adminUser(),
  });
}

async function loaded() {
  await screen.findByRole("heading", { name: "Q3 application review" });
}

const dataRows = () =>
  within(screen.getAllByRole("table")[0])
    .getAllByRole("row")
    .slice(1);

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  mockApi.reset();
  mockApi.on("get", `/surveys/${SURVEY_ID}`, survey());
  mockApi.on("get", `/surveys/${SURVEY_ID}/responses`, () => RESPONSES.map((r) => ({ ...r })));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

describe("SurveyResults — load", () => {
  it("resolves the survey from the route param and renders header, stats, tabs and rows", async () => {
    renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await loaded();

    expect(mockApi.callsOf("get", `/surveys/${SURVEY_ID}`)).toHaveLength(1);
    expect(mockApi.callsOf("get", `/surveys/${SURVEY_ID}/responses`)).toHaveLength(1);

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("admin:surveyResults.closeSurvey") })).toBeInTheDocument();
    // The description is linkified.
    expect(screen.getByRole("link", { name: "https://wiki.example.com/q3" })).toHaveAttribute("target", "_blank");

    expect(screen.getByText(t("admin:surveyResults.stats.totalTargets"))).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.all", { count: 3 }) })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.completed", { count: 2 }) })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.pending", { count: 1 }) })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.applied", { count: 1 }) })).toBeInTheDocument();
    // 2 of 3 completed → 67%.
    expect(screen.getAllByRole("progressbar").at(-1)).toHaveAttribute("aria-valuenow", "67");

    const rows = dataRows();
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Billing Engine")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Dana Lee")).toBeInTheDocument();
    expect(within(rows[0]).getByText("r1@test.local")).toBeInTheDocument();
    expect(within(rows[0]).getByText(t("admin:surveyResults.hasChanges"))).toBeInTheDocument();
    expect(within(rows[0]).getByText("D[2026-03-02T10:00:00Z]")).toBeInTheDocument();
    expect(within(rows[1]).getByText(t("admin:surveyResults.allConfirmed"))).toBeInTheDocument();
    // A pending row shows its card id when the name is missing, no change chip, no details button.
    expect(within(rows[2]).getByText("card-r3")).toBeInTheDocument();
    expect(within(rows[2]).getByText(t("common:status.pending"))).toBeInTheDocument();
    expect(within(rows[2]).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rows[2]).getByRole("checkbox")).toBeDisabled();
    // Already applied rows cannot be selected again.
    expect(within(rows[1]).getByRole("checkbox")).toBeDisabled();
    expect(within(rows[0]).getByRole("checkbox")).toBeEnabled();
  });

  it("reads the id from a different route param value", async () => {
    mockApi.on("get", "/surveys/other", survey({ id: "other", name: "Other survey", description: "" }));
    mockApi.on("get", "/surveys/other/responses", []);
    renderPage("/admin/surveys/other/results");
    await screen.findByRole("heading", { name: "Other survey" });
    expect(mockApi.callsOf("get", "/surveys/other")).toHaveLength(1);
    expect(screen.getByText(t("admin:surveyResults.noResponses"))).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the API error when the fetch fails, and «Survey not found» only when it did not (2.156.2)", async () => {
    // The page used to record the API message in `error` and then render the
    // not-found alert whenever `survey` was null, so a server failure read as
    // a missing survey.
    mockApi.fail("get", `/surveys/${SURVEY_ID}`, 500, "boom");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(`GET /surveys/${SURVEY_ID} failed`);
    expect(screen.queryByText(t("admin:surveyResults.notFound"))).not.toBeInTheDocument();
  });

  it("filters by tab and shows the empty state for a tab with nothing in it", async () => {
    mockApi.on("get", `/surveys/${SURVEY_ID}/responses`, [CHANGED, PENDING]);
    const { user } = renderPage();
    await loaded();
    expect(dataRows()).toHaveLength(2);

    await user.click(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.completed", { count: 1 }) }));
    expect(dataRows()).toHaveLength(1);
    expect(within(dataRows()[0]).getByText("Billing Engine")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.pending", { count: 1 }) }));
    expect(within(dataRows()[0]).getByText("card-r3")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: t("admin:surveyResults.tabs.applied", { count: 0 }) }));
    expect(screen.getByText(t("admin:surveyResults.noResponses"))).toBeInTheDocument();
  });

  it("navigates to the card and back to the survey list", async () => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByText("Billing Engine"));
    expect(await screen.findByTestId("card-page")).toBeInTheDocument();
  });

  it("navigates back to the surveys list", async () => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: t("admin:surveyResults.backToSurveys") }));
    expect(await screen.findByTestId("surveys-list")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

describe("SurveyResults — apply", () => {
  it("applies the selected responses in bulk and refetches", async () => {
    mockApi.on("post", `/surveys/${SURVEY_ID}/apply`, { applied: 1, errors: [] });
    const { user } = renderPage();
    await loaded();
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();

    await user.click(within(dataRows()[0]).getByRole("checkbox"));
    const apply = screen.getByRole("button", { name: named(t("admin:surveyResults.applyResponses", { count: 1 })) });
    await user.click(apply);

    await waitFor(() => expect(mockApi.callsOf("post", `/surveys/${SURVEY_ID}/apply`)).toHaveLength(1));
    expect(mockApi.callsOf("post", `/surveys/${SURVEY_ID}/apply`)[0].body).toEqual({ response_ids: ["r1"] });
    await waitFor(() => expect(mockApi.callsOf("get", `/surveys/${SURVEY_ID}/responses`)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("selects every applicable row from the header checkbox and toggles it off again", async () => {
    const { user } = renderPage();
    await loaded();
    const header = screen.getAllByRole("checkbox")[0];

    await user.click(header);
    expect(screen.getByRole("button", { name: named(t("admin:surveyResults.applyResponses", { count: 1 })) })).toBeInTheDocument();
    expect(within(dataRows()[0]).getByRole("checkbox")).toBeChecked();
    expect(header).toBeChecked();

    await user.click(header);
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();

    // Toggling a row off again drops it from the selection.
    await user.click(within(dataRows()[0]).getByRole("checkbox"));
    await user.click(within(dataRows()[0]).getByRole("checkbox"));
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  });

  it("reports a partial apply and a failed apply", async () => {
    mockApi.on("post", `/surveys/${SURVEY_ID}/apply`, {
      applied: 0,
      errors: [{ response_id: "r1", error: "card archived" }],
    });
    const { user } = renderPage();
    await loaded();
    await user.click(within(dataRows()[0]).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: named(t("admin:surveyResults.applyResponses", { count: 1 })) }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      t("admin:surveyResults.applyPartial", { applied: 0, errorCount: 1, errors: "card archived" }),
    );
    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    mockApi.fail("post", `/surveys/${SURVEY_ID}/apply`, 500, "boom");
    await user.click(within(dataRows()[0]).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: named(t("admin:surveyResults.applyResponses", { count: 1 })) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`POST /surveys/${SURVEY_ID}/apply failed`);
  });

  it("closes the survey and reports a failed close", async () => {
    mockApi.on("post", `/surveys/${SURVEY_ID}/close`, survey({ status: "closed" }));
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: t("admin:surveyResults.closeSurvey") }));
    await waitFor(() => expect(mockApi.callsOf("post", `/surveys/${SURVEY_ID}/close`)).toHaveLength(1));
    expect(mockApi.callsOf("post", `/surveys/${SURVEY_ID}/close`)[0].body).toEqual({});
    expect(await screen.findByText("Closed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("admin:surveyResults.closeSurvey") })).not.toBeInTheDocument();
  });

  it("keeps the survey active when the close fails", async () => {
    mockApi.fail("post", `/surveys/${SURVEY_ID}/close`, 500, "boom");
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: t("admin:surveyResults.closeSurvey") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`POST /surveys/${SURVEY_ID}/close failed`);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Detail dialog
// ---------------------------------------------------------------------------

describe("SurveyResults — response detail", () => {
  async function openDetail(user: ReturnType<typeof renderPage>["user"], rowIndex: number) {
    await user.click(within(dataRows()[rowIndex]).getByRole("button", { name: t("admin:surveyResults.viewDetails") }));
    return screen.findByRole("dialog");
  }

  it("renders every field's current value, response and status, resolving labels from the metamodel", async () => {
    const { user } = renderPage();
    await loaded();
    const dialog = await openDetail(user, 0);

    expect(
      within(dialog).getByText(t("admin:surveyResults.detail.title", { card: "Billing Engine", user: "Dana Lee" })),
    ).toBeInTheDocument();
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(FIELDS.length);

    // single_select: option labels, the new value emphasised, status Changed.
    expect(within(rows[0]).getByText("Criticality")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Low")).toBeInTheDocument();
    expect(within(rows[0]).getByText("High")).toBeInTheDocument();
    expect(within(rows[0]).getByText(t("admin:surveyResults.detail.changed"))).toBeInTheDocument();
    // boolean confirmed: both columns show the current value.
    expect(within(rows[1]).getAllByText(t("admin:surveyResults.boolFalse"))).toHaveLength(2);
    expect(within(rows[1]).getByText(t("admin:surveyResults.detail.confirmed"))).toBeInTheDocument();
    // multiple_select: option labels joined.
    expect(within(rows[2]).getByText("EMEA")).toBeInTheDocument();
    expect(within(rows[2]).getByText("EMEA, APAC")).toBeInTheDocument();
    // empty text, nothing entered.
    expect(within(rows[3]).getAllByText("—")).toHaveLength(2);
    expect(within(rows[3]).getByText(t("admin:surveyResults.detail.noInput"))).toBeInTheDocument();
    // a list without options is joined as-is.
    expect(within(rows[4]).getAllByText("be, billing")).toHaveLength(2);
    // relation: the verb comes from the live metamodel, the pills carry card names.
    expect(within(rows[5]).getByText(REL_APP_TO_ITC.label)).toBeInTheDocument();
    expect(within(rows[5]).getAllByText("PostgreSQL")).toHaveLength(2);
    expect(within(rows[5]).getByText("Redis")).toBeInTheDocument();
    expect(within(rows[6]).getByText(REL_APP_TO_ITC.reverse_label!)).toBeInTheDocument();
    expect(within(rows[6]).getAllByText("—")).toHaveLength(2);

    expect(within(dialog).getByRole("button", { name: t("admin:surveyResults.detail.applyChanges") })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t("common:actions.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("applies one response from the dialog and refetches", async () => {
    mockApi.on("post", `/surveys/${SURVEY_ID}/apply`, { applied: 1, errors: [] });
    const { user } = renderPage();
    await loaded();
    const dialog = await openDetail(user, 0);
    await user.click(within(dialog).getByRole("button", { name: t("admin:surveyResults.detail.applyChanges") }));

    await waitFor(() => expect(mockApi.callsOf("post", `/surveys/${SURVEY_ID}/apply`)).toHaveLength(1));
    expect(mockApi.callsOf("post", `/surveys/${SURVEY_ID}/apply`)[0].body).toEqual({ response_ids: ["r1"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(mockApi.callsOf("get", `/surveys/${SURVEY_ID}/responses`)).toHaveLength(2));
  });

  it("keeps the dialog open and shows the error when applying from it fails", async () => {
    mockApi.fail("post", `/surveys/${SURVEY_ID}/apply`, 500, "boom");
    const { user } = renderPage();
    await loaded();
    const dialog = await openDetail(user, 0);
    await user.click(within(dialog).getByRole("button", { name: t("admin:surveyResults.detail.applyChanges") }));
    expect(await screen.findByText(`POST /surveys/${SURVEY_ID}/apply failed`)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers no apply button for an applied, all-confirmed response and skips unanswered fields", async () => {
    const { user } = renderPage();
    await loaded();
    const dialog = await openDetail(user, 1);
    expect(within(dialog).queryByRole("button", { name: t("admin:surveyResults.detail.applyChanges") })).not.toBeInTheDocument();
    // Only the two answered fields render; the others are skipped.
    expect(within(dialog).getAllByRole("row").slice(1)).toHaveLength(2);
    expect(within(dialog).getAllByText(t("admin:surveyResults.boolTrue"))).toHaveLength(2);
  });

  it("falls back to the stored label and grey pills when the relation type is unknown", async () => {
    withMetamodel([], []);
    const { user } = renderPage();
    await loaded();
    const dialog = await openDetail(user, 0);
    expect(within(dialog).getByText("stale snapshot label")).toBeInTheDocument();
    expect(within(dialog).getByText("incoming snapshot")).toBeInTheDocument();
    expect(within(dialog).getByText("Redis")).toBeInTheDocument();
  });
});
