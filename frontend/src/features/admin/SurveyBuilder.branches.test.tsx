/**
 * SurveyBuilder branches beyond `SurveyBuilder.test.tsx`: step validation and
 * Back, the target filters (specific cards, related cards with the "via
 * relation" narrowing, attribute filters, a custom staleness unit, roles),
 * relation-field actions, save / preview / send failures and success, and an
 * opened draft hydrating its card chips and failing to load.
 *
 * Built on the shared test kit with the real router. `CardPicker` is stubbed:
 * the builder only cares what list of cards comes back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

vi.mock("@/components/CardPicker", () => ({
  default: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value?: { id: string; name: string; type: string }[];
    onChange: (v: { id: string; name: string; type: string }[]) => void;
  }) => {
    const pick = label.startsWith("Search cards by name")
      ? { id: "app-9", name: "Picked App", type: "Application" }
      : { id: "org-9", name: "Picked Org", type: "Organization" };
    return (
      <div data-testid={label.startsWith("Search cards by name") ? "specific-picker" : "related-picker"}>
        {(value ?? []).map((v) => (
          <span key={v.id}>{v.name}</span>
        ))}
        <button onClick={() => onChange([...(value ?? []), pick])}>pick {pick.name}</button>
        <button onClick={() => onChange([])}>clear {pick.name}</button>
      </div>
    );
  },
}));

import SurveyBuilder from "./SurveyBuilder";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import type { RelationType } from "@/types";

const APP = makeCardType({
  key: "Application",
  label: "Application",
  fields_schema: [
    makeSection({
      section: "General",
      fields: [
        makeField({
          key: "criticality",
          label: "Criticality",
          type: "single_select",
          options: [makeOption({ key: "high", label: "High" })],
        }),
        makeField({ key: "owner", label: "Owner", type: "text", readonly: true }),
      ],
    }),
  ],
});
const ORG = makeCardType({ key: "Organization", label: "Organization" });

const VIS = { source_visible: true, target_visible: true, source_mandatory: false, target_mandatory: false };
const ORG_OWNS_APP = makeRelationType({
  key: "relOrgToAppOwns",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  ...VIS,
} as Partial<RelationType> & { key: string });
const APP_USED_BY_ORG = makeRelationType({
  key: "relAppToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  ...VIS,
} as Partial<RelationType> & { key: string });

const ROLES = [
  { key: "responsible", label: "Business Owner", allowed_types: null, translations: {} },
  { key: "observer", label: "Observer", allowed_types: null, translations: {}, color: "#999999" },
];

const PREVIEW = {
  total_cards: 1,
  total_matched: 1,
  skipped: [],
  total_users: 1,
  total_requests: 1,
  targets: [
    {
      card_id: "c1",
      card_name: "CRM",
      card_type: "Application",
      users: [{ user_id: "u1", display_name: "Ada", email: "a@x", roles: [] }],
    },
  ],
};

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderBuilder(route = "/admin/surveys/new") {
  return renderWithProviders(
    <>
      <SurveyBuilder />
      <LocationProbe />
    </>,
    {
      route,
      routes: [
        { path: "/admin/surveys/new" },
        { path: "/admin/surveys/:id" },
        { path: "/admin/surveys", element: <LocationProbe /> },
        { path: "/admin/surveys/:id/results", element: <LocationProbe /> },
      ],
    },
  );
}

type User = ReturnType<typeof renderBuilder>["user"];

const nextButton = () => screen.getByRole("button", { name: /^Next/ });

/** The body of the most recent draft write, create or update. */
function lastDraft(): Record<string, unknown> {
  const writes = mockApi.calls.filter(
    (c) => (c.method === "post" && c.path === "/surveys") || (c.method === "patch" && c.path.startsWith("/surveys/")),
  );
  return writes[writes.length - 1].body as Record<string, unknown>;
}

async function toTarget(user: User) {
  await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
  await user.click(nextButton());
  await screen.findByText("Target Cards");
}

async function pickType(user: User) {
  await user.click(screen.getByRole("combobox", { name: /^Type/ }));
  await user.click(await screen.findByRole("option", { name: /Application/ }));
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ORG], [ORG_OWNS_APP, APP_USED_BY_ORG]);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/stakeholder-roles/, ROLES);
  mockApi.on("post", "/surveys", { id: "survey-1" });
  mockApi.on("patch", "/surveys/survey-1", {});
  mockApi.on("post", "/surveys/survey-1/preview", PREVIEW);
});

describe("SurveyBuilder — step validation and navigation", () => {
  it("refuses each step until its required input is there, and Back returns a step", async () => {
    const { user } = renderBuilder();

    await user.click(await screen.findByRole("button", { name: /^Next/ }));
    const nameError = await screen.findByText("Survey name is required");
    await user.click(within(nameError.closest("[role=alert]") as HTMLElement).getByRole("button"));
    expect(screen.queryByText("Survey name is required")).not.toBeInTheDocument();

    await toTarget(user);
    await user.click(nextButton());
    expect(await screen.findByText("Please select a target card type")).toBeInTheDocument();

    await pickType(user);
    await user.click(nextButton());
    expect(await screen.findByText("Please select at least one stakeholder role")).toBeInTheDocument();

    // Tick and untick a role: still nothing selected.
    await user.click(screen.getByRole("checkbox", { name: /Observer/ }));
    await user.click(screen.getByRole("checkbox", { name: /Observer/ }));
    await user.click(nextButton());
    expect(screen.getByText("Please select at least one stakeholder role")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Business Owner/ }));
    await user.click(nextButton());
    await screen.findByText("Select Fields");
    await user.click(nextButton());
    expect(await screen.findByText("Please select at least one field")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back$/ }));
    expect(await screen.findByText("Target Cards")).toBeInTheDocument();
    expect(screen.queryByText("Please select at least one field")).not.toBeInTheDocument();
  });

  it("leaves for the survey list from the back arrow", async () => {
    const { user } = renderBuilder();
    await user.click(await screen.findByRole("button", { name: "Back to Surveys" }));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/admin\/surveys$/);
  });
});

describe("SurveyBuilder — target filters", () => {
  it("saves specific cards, related cards and the relation that narrows them", async () => {
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/^Description/), "Internal note");
    await user.type(screen.getByLabelText(/Message to Respondents/), "Please review");
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByText("pick Picked App"));
    expect(screen.queryByLabelText(/Via relation/)).not.toBeInTheDocument();
    await user.click(screen.getByText("pick Picked Org"));

    // Two relation types connect Application and Organization: say which.
    await user.click(await screen.findByRole("combobox", { name: /Via relation/ }));
    expect(screen.getByRole("option", { name: "Any relation" })).toBeInTheDocument();
    // Each verb is read from the target type's side of its relation type.
    expect(screen.getByRole("option", { name: "is used by" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "is owned by" }));

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    const body = lastDraft();
    expect(body).toMatchObject({ description: "Internal note", message: "Please review" });
    expect(body.target_filters).toMatchObject({
      card_ids: ["app-9"],
      related_ids: ["org-9"],
      relation_type_key: "relOrgToAppOwns",
    });

    // Clearing the related cards drops a narrowing that no longer applies.
    await user.click(screen.getByText("clear Picked Org"));
    await waitFor(() => expect(screen.queryByLabelText(/Via relation/)).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/surveys/survey-1")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).relation_type_key).toBeUndefined();
  });

  it("builds, edits and removes attribute filters", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    expect(screen.getByRole("button", { name: /Add Attribute Filter/ })).toBeDisabled();
    await pickType(user);

    await user.click(screen.getByRole("button", { name: /Add Attribute Filter/ }));
    await user.click(screen.getByRole("combobox", { name: /^Field/ }));
    await user.click(await screen.findByRole("option", { name: "Criticality" }));

    // An emptiness test takes no value.
    await user.click(screen.getByRole("combobox", { name: /^Operator/ }));
    await user.click(await screen.findByRole("option", { name: "is empty" }));
    expect(screen.queryByLabelText(/^Value/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /^Operator/ }));
    await user.click(await screen.findByRole("option", { name: "contains" }));
    await user.type(screen.getByLabelText(/^Value/), "hi");

    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).attribute_filters).toEqual([
      { key: "criticality", op: "contains", value: "hi" },
    ]);

    // A second row, then remove the first.
    await user.click(screen.getByRole("button", { name: /Add Attribute Filter/ }));
    expect(screen.getAllByRole("combobox", { name: /^Operator/ })).toHaveLength(2);
    const firstRow = screen.getByDisplayValue("hi").closest(".MuiBox-root") as HTMLElement;
    await user.click(within(firstRow).getByRole("button", { name: /close/ }));
    expect(screen.getAllByRole("combobox", { name: /^Operator/ })).toHaveLength(1);
  });

  it("re-validates a custom staleness window when its unit changes, and ignores re-clicking the active preset", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByRole("button", { name: "Any" }));
    expect(screen.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /Custom/ }));
    const value = screen.getByLabelText(/Not updated for/);
    await user.clear(value);
    await user.type(value, "400");
    // 400 days is fine…
    expect(screen.queryByText(/whole number/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /^Unit/ }));
    await user.click(await screen.findByRole("option", { name: "months" }));
    // …400 months is not.
    expect(await screen.findByText(/whole number/i)).toBeInTheDocument();

    await user.clear(value);
    await user.type(value, "3");
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    await waitFor(() => expect(mockApi.callsOf("post", "/surveys")).toHaveLength(1));
    expect((lastDraft().target_filters as Record<string, unknown>).not_updated_for).toEqual({
      value: 3,
      unit: "months",
    });
  });
});

describe("SurveyBuilder — fields, preview and send", () => {
  async function toFields(user: User) {
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByRole("checkbox", { name: /Business Owner/ }));
    await user.click(nextButton());
    await screen.findByText("Select Fields");
  }

  it("selects a relation, switches it to Confirm and drops it again", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    const row = screen.getByText("is owned by").closest("tr") as HTMLElement;
    await user.click(row);
    await waitFor(() => expect(within(row).getByRole("combobox")).toBeInTheDocument());
    await user.click(within(row).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Confirm" }));
    expect(screen.getByText(/1 field\(s\) selected \(0 maintain, 1 confirm\)/)).toBeInTheDocument();

    await user.click(within(row).getByRole("checkbox"));
    expect(screen.queryByText(/field\(s\) selected/)).not.toBeInTheDocument();
  });

  it("previews and sends, landing on the results page", async () => {
    mockApi.on("post", "/surveys/survey-1/send", {});
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/Message to Respondents/), "See https://example.com");
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(nextButton());

    expect(await screen.findByText("CRM")).toBeInTheDocument();
    // A user with no resolvable role is listed by name alone.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com" })).toBeInTheDocument();
    expect(screen.getByText("Criticality (maintain)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Send Survey/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/surveys/survey-1/results"));
  });

  it("surfaces a failed send and stays on the step", async () => {
    mockApi.fail("post", "/surveys/survey-1/send", 409, "already sent");
    const { user } = renderBuilder();
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(nextButton());
    await screen.findByText("CRM");

    await user.click(screen.getByRole("button", { name: /Send Survey/ }));
    expect(await screen.findByText("POST /surveys/survey-1/send failed")).toBeInTheDocument();
    expect(screen.getByText("(No message set)")).toBeInTheDocument();
  });

  it("offers a manual preview after a failed one, and keeps Send disabled until it works", async () => {
    let fail = true;
    mockApi.on("post", "/surveys/survey-1/preview", () => {
      if (fail) throw new Error("preview down");
      return PREVIEW;
    });
    const { user } = renderBuilder();
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(nextButton());

    expect(await screen.findByText("preview down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send Survey/ })).toBeDisabled();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Load Preview" }));
    expect(await screen.findByText("CRM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send Survey/ })).toBeEnabled();
  });

  it("shows a failed draft save and does not preview", async () => {
    mockApi.on("post", "/surveys", () => Promise.reject("db down"));
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByRole("button", { name: /Save Draft/ }));
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(mockApi.callsOf("post", /preview/)).toHaveLength(0);
  });
});

describe("SurveyBuilder — opening a saved draft", () => {
  it("hydrates the card chips from their ids and restores a custom window", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      id: "survey-7",
      name: "Saved",
      description: "",
      message: "",
      status: "draft",
      target_type_key: "Application",
      target_roles: ["responsible"],
      target_filters: {
        card_ids: ["app-1", "app-gone"],
        related_ids: ["org-1"],
        not_updated_for: { value: 45, unit: "days" },
      },
      fields: [],
    });
    mockApi.on("get", "/cards/app-1", { id: "app-1", name: "Hydrated App", type: "Application" });
    mockApi.fail("get", "/cards/app-gone", 404);
    mockApi.on("get", "/cards/org-1", { id: "org-1", name: "Hydrated Org", type: "Organization" });
    const { user } = renderBuilder("/admin/surveys/survey-7");

    expect(await screen.findByText("Edit Survey")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Saved"));
    await user.click(nextButton());

    expect(await screen.findByText("Hydrated App")).toBeInTheDocument();
    expect(screen.getByText("Hydrated Org")).toBeInTheDocument();
    expect(screen.getByLabelText(/Not updated for/)).toHaveValue(45);
    expect(screen.getByRole("button", { name: /Custom/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the load error for a draft that cannot be read", async () => {
    mockApi.fail("get", "/surveys/missing", 404);
    renderBuilder("/admin/surveys/missing");
    expect(await screen.findByText("GET /surveys/missing failed")).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-Error load failure", async () => {
    mockApi.on("get", "/surveys/odd", () => Promise.reject("weird"));
    renderBuilder("/admin/surveys/odd");
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});
