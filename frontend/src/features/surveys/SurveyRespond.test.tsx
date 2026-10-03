import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import {
  CARD_IDS,
  CARD_TYPES,
  CRITICALITY_OPTIONS,
  REGION_OPTIONS,
  RELATION_TYPES,
  REL_APP_TO_ITC,
  cardById,
} from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import type { SurveyRespondForm } from "@/types";

import SurveyRespond from "./SurveyRespond";

const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`admin:${key}`, { ...(opts ?? {}), interpolation: { escapeValue: false } } as never));
const tc = (key: string) => String(i18n.t(`common:${key}`));

type FormField = SurveyRespondForm["fields"][number];

const RESPOND_PATH = "/surveys/s1/respond/c1";

// One field per built-in control, split between the two survey actions.
const ALIAS: FormField = {
  key: "alias",
  section: "__description",
  label: "Alias",
  type: "text",
  action: "maintain",
  current_value: "ERP",
  help: "The short name people use in meetings.",
};
const CRITICALITY: FormField = {
  key: "businessCriticality",
  section: "Business Information",
  label: "Business Criticality",
  type: "single_select",
  options: CRITICALITY_OPTIONS,
  action: "confirm",
  current_value: "missionCritical",
};
const CLOUD: FormField = {
  key: "isCloud",
  section: "Business Information",
  label: "Cloud Hosted",
  type: "boolean",
  action: "maintain",
  current_value: false,
};
const GO_LIVE: FormField = {
  key: "goLiveDate",
  section: "Business Information",
  label: "Go-Live Date",
  type: "date",
  action: "maintain",
  current_value: "2020-06-01",
};
const COST: FormField = {
  key: "costTotalAnnual",
  section: "Business Information",
  label: "Total Annual Cost",
  type: "cost",
  action: "confirm",
  current_value: 250000,
};
const REGIONS: FormField = {
  key: "regions",
  section: "Business Information",
  label: "Regions",
  type: "multiple_select",
  options: REGION_OPTIONS,
  action: "maintain",
  current_value: ["emea"],
};
const COVERAGE: FormField = {
  key: "coverage",
  section: "Business Information",
  label: "Test Coverage",
  type: "percentage",
  action: "maintain",
  current_value: 75,
};
const NOTES: FormField = {
  key: "notes",
  section: "Business Information",
  label: "Notes",
  type: "multiline_text",
  action: "confirm",
  current_value: null,
};
/** A relation field whose stored label is stale: the live verb must win. */
const USES_ITC: FormField = {
  key: "rel:relAppToITC:outgoing",
  section: "",
  label: "stale stored label",
  type: "relation",
  kind: "relation",
  relation_type_key: REL_APP_TO_ITC.key,
  direction: "outgoing",
  related_type_key: "ITComponent",
  action: "maintain",
  current_value: [{ id: CARD_IDS.postgres, name: "PostgreSQL" }],
};

function formWith(fields: FormField[], overrides: Partial<SurveyRespondForm> = {}): SurveyRespondForm {
  return {
    response_id: "r1",
    response_status: "pending",
    survey: { id: "s1", name: "Q3 Application Review", message: "Guidance: https://wiki.example/ea-review" },
    card: { id: CARD_IDS.erp, name: "ERP Core", type: "Application", subtype: "businessApplication" },
    fields,
    existing_responses: {},
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(<SurveyRespond />, {
    route: RESPOND_PATH,
    routes: [
      { path: "/surveys/:surveyId/respond/:cardId" },
      { path: "/surveys", element: <div>my surveys</div> },
    ],
  });
}

/** The MUI Card wrapping one survey field, found by its label. */
function fieldCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest(".MuiCard-root");
  if (!card) throw new Error(`no field card for ${label}`);
  return card as HTMLElement;
}

/** The submit button; its accessible name also carries the icon glyph text. */
function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: (n) => n.includes(t("surveys.respond.submit")) });
}

/** The last body `POST` to the respond endpoint. */
function postedResponses(): Record<string, { confirmed: boolean; new_value: unknown }> {
  const calls = mockApi.callsOf("post", RESPOND_PATH);
  const body = calls[calls.length - 1]?.body as { responses: Record<string, { confirmed: boolean; new_value: unknown }> };
  return body.responses;
}

beforeEach(() => {
  mockApi.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
  mockApi.on("post", RESPOND_PATH, {});
});

describe("SurveyRespond — loading", () => {
  it("renders the survey, the card and its type and subtype resolved from the metamodel", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS, CRITICALITY]));
    renderPage();

    expect(await screen.findByText("Q3 Application Review")).toBeInTheDocument();
    expect(screen.getByText("ERP Core")).toBeInTheDocument();
    expect(screen.getByText("Application")).toBeInTheDocument();
    expect(screen.getByText("Business Application")).toBeInTheDocument();
    // The survey message is linkified, never rendered as raw text.
    const link = screen.getByRole("link", { name: "https://wiki.example/ea-review" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(submitButton()).toBeEnabled();
  });

  it("falls back to the wire translations for a card type the metamodel does not know", async () => {
    withMetamodel([], []);
    mockApi.on(
      "get",
      RESPOND_PATH,
      formWith([ALIAS], {
        card: {
          id: "c1",
          name: "Legacy Thing",
          type: "Mainframe",
          subtype: "batch",
          type_translations: { label: { en: "Mainframe System" } },
          subtype_translations: { en: "Batch Job" },
        },
      }),
    );
    renderPage();

    expect(await screen.findByText("Mainframe System")).toBeInTheDocument();
    expect(screen.getByText("Batch Job")).toBeInTheDocument();
  });

  it("shows the load error in place of the form", async () => {
    mockApi.fail("get", RESPOND_PATH, 403, "forbidden");
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(`GET ${RESPOND_PATH} failed`);
    expect(screen.queryByRole("button", { name: (n) => n.includes(t("surveys.respond.submit")) })).not.toBeInTheDocument();
  });

  it("shows the not-found copy, not a TypeError, when the server returns an empty body (2.157.0)", async () => {
    // The loader used to call `setForm(data)` and then read `data.fields`,
    // so a null body threw a TypeError that landed in the error alert
    // verbatim.
    mockApi.on("get", RESPOND_PATH, null);
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t("surveys.respond.notFound"));
    expect(alert).not.toHaveTextContent(/null/);
  });

  it("opens straight on the thank-you screen for an already completed response", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS], { response_status: "completed" }));
    const { user } = renderPage();

    expect(await screen.findByText(t("surveys.respond.success"))).toBeInTheDocument();
    expect(screen.getByText("ERP Core", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: (n) => n.includes(t("surveys.respond.submit")) })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("surveys.respond.backToSurveys") }));
    expect(await screen.findByText("my surveys")).toBeInTheDocument();
  });

  it("restores previously saved answers", async () => {
    mockApi.on(
      "get",
      RESPOND_PATH,
      formWith([ALIAS, CRITICALITY], {
        existing_responses: {
          alias: { current_value: "ERP", new_value: "ERP v2", confirmed: false },
          // A confirm field answered with a proposal comes back un-confirmed, input open.
          businessCriticality: { current_value: "missionCritical", new_value: "businessCritical", confirmed: false },
        },
      }),
    );
    renderPage();

    expect(await screen.findByDisplayValue("ERP v2")).toBeInTheDocument();
    const crit = fieldCard("Business Criticality");
    expect(within(crit).getByText(t("surveys.respond.proposeChange"))).toBeInTheDocument();
    expect(within(crit).getByRole("combobox")).toHaveTextContent("Business Critical");
  });

  it("goes back to the survey list from the header", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    await user.click(screen.getByRole("button", { name: t("surveys.respond.backTooltip") }));
    expect(await screen.findByText("my surveys")).toBeInTheDocument();
  });
});

describe("SurveyRespond — current values", () => {
  it("formats every field type's current value for display", async () => {
    mockApi.on(
      "get",
      RESPOND_PATH,
      formWith([CRITICALITY, CLOUD, REGIONS, NOTES, { ...COST, current_value: null }, USES_ITC]),
    );
    renderPage();
    await screen.findByText("Q3 Application Review");

    expect(within(fieldCard("Business Criticality")).getByText("Mission Critical")).toBeInTheDocument();
    expect(within(fieldCard("Cloud Hosted")).getByText(tc("labels.no"), { selector: "p" })).toBeInTheDocument();
    expect(within(fieldCard("Regions")).getByText("EMEA", { selector: "p" })).toBeInTheDocument();
    // Empty values are a dash, for a confirm field and a maintain field alike.
    expect(within(fieldCard("Notes")).getByText("—")).toBeInTheDocument();
    expect(within(fieldCard("Total Annual Cost")).getByText("—")).toBeInTheDocument();
    // A relation's current links are chips, and its label is the live verb.
    const rel = fieldCard(REL_APP_TO_ITC.label);
    // Once as the current-value chip, once as the picker's selected tag.
    expect(within(rel).getAllByText("PostgreSQL")).toHaveLength(2);
    expect(screen.queryByText("stale stored label")).not.toBeInTheDocument();
    expect(
      within(rel).getByText(
        t("surveys.respond.relationMaintainInstruction", { card: "ERP Core", related: "IT Component" }),
      ),
    ).toBeInTheDocument();
  });

  it("labels each field with its action and section, and offers the help text", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS, CRITICALITY]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const alias = fieldCard("Alias");
    expect(within(alias).getByText(t("surveys.respond.maintain"))).toBeInTheDocument();
    expect(within(fieldCard("Business Criticality")).getByText(t("surveys.respond.confirmLabel"))).toBeInTheDocument();
    expect(within(fieldCard("Business Criticality")).getByText("Business Information")).toBeInTheDocument();

    // Help is mounted inside a Collapse that stays shut until asked for.
    const collapse = screen.getByText("The short name people use in meetings.").closest(".MuiCollapse-root");
    expect(collapse).toHaveClass("MuiCollapse-hidden");
    await user.click(within(alias).getByRole("button", { name: /help/i }));
    await waitFor(() => expect(collapse).toHaveClass("MuiCollapse-entered"));
  });
});

describe("SurveyRespond — maintain fields", () => {
  it("shows the text input at once and hides it behind the no-change toggle", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const alias = fieldCard("Alias");
    const input = within(alias).getByDisplayValue("ERP");
    expect(within(alias).getByText(t("surveys.respond.updatedValue"))).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "ERP Core v2");
    await user.click(submitButton());

    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().alias).toEqual({ confirmed: false, new_value: "ERP Core v2" });
  });

  it("confirming a maintain field drops the typed value", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const alias = fieldCard("Alias");
    await user.type(within(alias).getByDisplayValue("ERP"), "X");
    await user.click(within(alias).getByRole("checkbox", { name: t("surveys.respond.noChangeNeeded") }));
    expect(within(alias).queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().alias).toEqual({ confirmed: true, new_value: null });
  });

  it("edits a boolean, a date, a multi-select and a percentage", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([CLOUD, GO_LIVE, REGIONS, COVERAGE]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    // Boolean: the switch labelled with the current answer.
    const cloud = fieldCard("Cloud Hosted");
    await user.click(within(cloud).getByRole("checkbox", { name: tc("labels.no") }));
    expect(within(cloud).getByRole("checkbox", { name: tc("labels.yes") })).toBeChecked();

    // Date: the native input commits on change / blur.
    const date = within(fieldCard("Go-Live Date")).getByDisplayValue("2020-06-01");
    fireEvent.change(date, { target: { value: "2021-03-15" } });
    fireEvent.blur(date);

    // Multi-select: add a second region.
    const regions = fieldCard("Regions");
    await user.click(within(regions).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Americas" }));
    await user.keyboard("{Escape}");

    // Percentage: the exact-value box.
    const pct = within(fieldCard("Test Coverage")).getByRole("spinbutton");
    expect(pct).toHaveValue(75);
    await user.clear(pct);
    await user.type(pct, "90");

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    const posted = postedResponses();
    expect(posted.isCloud).toEqual({ confirmed: false, new_value: true });
    expect(posted.goLiveDate).toEqual({ confirmed: false, new_value: "2021-03-15" });
    expect(posted.regions).toEqual({ confirmed: false, new_value: ["emea", "amer"] });
    expect(posted.coverage).toEqual({ confirmed: false, new_value: 90 });
  });

  it("clearing the percentage box stores null, not an empty string", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([COVERAGE]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    await user.clear(within(fieldCard("Test Coverage")).getByRole("spinbutton"));
    await user.click(submitButton());

    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().coverage).toEqual({ confirmed: false, new_value: null });
  });
});

describe("SurveyRespond — confirm fields", () => {
  it("starts confirmed and reveals the select only when a change is proposed", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([CRITICALITY]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const crit = fieldCard("Business Criticality");
    const toggle = within(crit).getByRole("checkbox", { name: t("surveys.respond.confirmCorrect") });
    expect(toggle).toBeChecked();
    expect(within(crit).queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(within(crit).getByText(t("surveys.respond.proposedValue"))).toBeInTheDocument();
    const select = within(crit).getByRole("combobox");
    expect(select).toHaveTextContent("Mission Critical");

    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: tc("labels.none") })).toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: "Business Critical" }));

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().businessCriticality).toEqual({ confirmed: false, new_value: "businessCritical" });
  });

  it("submits an untouched confirm field as confirmed", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([CRITICALITY]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().businessCriticality).toEqual({ confirmed: true, new_value: null });
  });

  it("proposes a number for a cost field and a text for a multiline field", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([COST, NOTES]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const cost = fieldCard("Total Annual Cost");
    await user.click(within(cost).getByRole("checkbox", { name: t("surveys.respond.confirmCorrect") }));
    const number = within(cost).getByRole("spinbutton");
    expect(number).toHaveValue(250000);
    // Replaced in one change: see the clearing test below for why a clear
    // followed by typing would append instead.
    fireEvent.change(number, { target: { value: "300000" } });

    const notes = fieldCard("Notes");
    await user.click(within(notes).getByRole("checkbox", { name: t("surveys.respond.confirmCorrect") }));
    await user.type(within(notes).getByRole("textbox"), "Needs review");

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().costTotalAnnual).toEqual({ confirmed: false, new_value: 300000 });
    expect(postedResponses().notes).toEqual({ confirmed: false, new_value: "Needs review" });
  });

  it("keeps a cleared number box empty and posts null for it (2.157.0)", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([COST]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const cost = fieldCard("Total Annual Cost");
    await user.click(within(cost).getByRole("checkbox", { name: t("surveys.respond.confirmCorrect") }));
    const number = within(cost).getByRole("spinbutton");
    await user.clear(number);
    // An empty box used to be stored as `null`, which the input read as
    // "untouched" and fell back to the current value, so the display
    // snapped back to 250000 and the next digit appended to it.
    expect(number).toHaveValue(null);

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().costTotalAnnual).toEqual({ confirmed: false, new_value: null });
  });

  it("starts a new number after clearing the box", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([COST]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const cost = fieldCard("Total Annual Cost");
    await user.click(within(cost).getByRole("checkbox", { name: t("surveys.respond.confirmCorrect") }));
    const number = within(cost).getByRole("spinbutton");
    await user.clear(number);
    await user.type(number, "3");
    expect(number).toHaveValue(3);

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses().costTotalAnnual).toEqual({ confirmed: false, new_value: 3 });
  });
});

describe("SurveyRespond — relation fields", () => {
  it("searches the related type on open and adds a picked card to the linked set", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([USES_ITC]));
    mockApi.on("get", "/cards?type=ITComponent&search=&page_size=20", {
      items: [cardById(CARD_IDS.postgres), cardById(CARD_IDS.linux)],
    });
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const rel = fieldCard(REL_APP_TO_ITC.label);
    const input = within(rel).getByPlaceholderText(t("surveys.respond.searchRelated"));
    await user.click(input);

    // The already-linked card is not offered again; the other one is.
    const option = await screen.findByRole("option", { name: "Ubuntu LTS" });
    expect(screen.queryByRole("option", { name: "PostgreSQL" })).not.toBeInTheDocument();
    await user.click(option);
    await user.keyboard("{Escape}");

    expect(mockApi.callsOf("get", "/cards*")[0].path).toBe("/cards?type=ITComponent&search=&page_size=20");

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses()["rel:relAppToITC:outgoing"]).toEqual({
      confirmed: false,
      new_value: [
        { id: CARD_IDS.postgres, name: "PostgreSQL" },
        { id: CARD_IDS.linux, name: "Ubuntu LTS" },
      ],
    });
  });

  it("refines the search as the respondent types, debounced", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([USES_ITC]));
    mockApi.on("get", "/cards*", { items: [cardById(CARD_IDS.linux)] });
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const input = within(fieldCard(REL_APP_TO_ITC.label)).getByPlaceholderText(t("surveys.respond.searchRelated"));
    await user.click(input);
    await screen.findByRole("option", { name: "Ubuntu LTS" });
    await user.type(input, "ubu");

    await waitFor(() =>
      expect(mockApi.callsOf("get", "/cards*").map((c) => c.path)).toContain(
        "/cards?type=ITComponent&search=ubu&page_size=20",
      ),
    );
  });

  it("confirms a relation without opening the picker", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([{ ...USES_ITC, action: "confirm" }]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    const rel = fieldCard(REL_APP_TO_ITC.label);
    expect(
      within(rel).getByText(
        t("surveys.respond.relationConfirmInstruction", { card: "ERP Core", related: "IT Component" }),
      ),
    ).toBeInTheDocument();
    expect(within(rel).queryByPlaceholderText(t("surveys.respond.searchRelated"))).not.toBeInTheDocument();

    await user.click(submitButton());
    await waitFor(() => expect(mockApi.callsOf("post", RESPOND_PATH)).toHaveLength(1));
    expect(postedResponses()["rel:relAppToITC:outgoing"]).toEqual({ confirmed: true, new_value: null });
    expect(mockApi.callsOf("get", "/cards*")).toHaveLength(0);
  });

  it("keeps the stored label when the relation type is gone and shows a dash with no links", async () => {
    withMetamodel(CARD_TYPES, []);
    mockApi.on("get", RESPOND_PATH, formWith([{ ...USES_ITC, current_value: [] }]));
    renderPage();
    await screen.findByText("Q3 Application Review");

    const rel = fieldCard("stale stored label");
    expect(within(rel).getByText("—")).toBeInTheDocument();
  });
});

describe("SurveyRespond — submitting", () => {
  it("shows the thank-you screen after a successful submit", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS]));
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    await user.click(submitButton());

    expect(await screen.findByText(t("surveys.respond.success"))).toBeInTheDocument();
    expect(screen.getByText("ERP Core", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: (n) => n.includes(t("surveys.respond.submit")) })).not.toBeInTheDocument();
  });

  it("keeps the form and shows the error when the submit fails, dismissable", async () => {
    mockApi.on("get", RESPOND_PATH, formWith([ALIAS]));
    mockApi.fail("post", RESPOND_PATH, 500, "boom");
    const { user } = renderPage();
    await screen.findByText("Q3 Application Review");

    await user.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`POST ${RESPOND_PATH} failed`);
    expect(submitButton()).toBeEnabled();
    expect(screen.getByDisplayValue("ERP")).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
