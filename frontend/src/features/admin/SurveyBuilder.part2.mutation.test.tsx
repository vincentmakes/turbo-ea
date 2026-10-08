/**
 * SurveyBuilder, the middle of the component (send, the section/relation
 * selection helpers, step navigation, the header and the Basics + Target
 * steps): what `SurveyBuilder.test.tsx` and `SurveyBuilder.branches.test.tsx`
 * reach but do not pin down.
 *
 * Built on the shared test kit with the real router. `CardPicker` is stubbed:
 * the builder only decides what it passes the picker (enabled, disabled, the
 * empty-list text, its label) and what it does with the list that comes back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

vi.mock("@/components/CardPicker", () => {
  const PICKS = [
    { id: "app-9", name: "Picked App", type: "Application" },
    { id: "org-9", name: "Picked Org", type: "Organization" },
    { id: "prov-9", name: "Picked Provider", type: "Provider" },
  ];
  return {
    default: (p: {
      label: string;
      value?: { id: string; name: string; type: string }[];
      onChange: (v: { id: string; name: string; type: string }[]) => void;
      enabled?: boolean;
      disabled?: boolean;
      noOptionsText?: string;
    }) => (
      <div
        data-testid={p.label === "Search cards by name..." ? "specific-picker" : "related-picker"}
        data-label={p.label}
        data-enabled={String(p.enabled)}
        data-disabled={String(p.disabled)}
        data-no-options={p.noOptionsText ?? ""}
      >
        {(p.value ?? []).map((v) => (
          <span key={v.id}>chip {v.name}</span>
        ))}
        {PICKS.map((c) => (
          <button key={c.id} onClick={() => p.onChange([...(p.value ?? []), c])}>
            pick {c.name}
          </button>
        ))}
      </div>
    ),
  };
});

import SurveyBuilder from "./SurveyBuilder";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
  makeTag,
  makeTagGroup,
} from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";

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
        makeField({ key: "owner", label: "Owner", type: "text" }),
      ],
    }),
    makeSection({
      section: "Assessment",
      fields: [
        makeField({ key: "timeModel", label: "Time Model", type: "text" }),
        makeField({ key: "risk", label: "Risk", type: "text" }),
      ],
    }),
  ],
});
const ORG = makeCardType({ key: "Organization", label: "Organization" });
const PROVIDER = makeCardType({ key: "Provider", label: "Provider" });
const SECRET = makeCardType({ key: "Secret", label: "Secret Type", is_hidden: true });

const ORG_OWNS_APP = makeRelationType({
  key: "relOrgToAppOwns",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
});
const APP_USED_BY_ORG = makeRelationType({
  key: "relAppToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
});
const APP_TO_PROVIDER = makeRelationType({
  key: "relAppToProvider",
  label: "is supplied by",
  reverse_label: "supplies",
  source_type_key: "Application",
  target_type_key: "Provider",
});

const ROLES = [
  { key: "responsible", label: "Business Owner", allowed_types: null, translations: {} },
  {
    key: "observer",
    label: "Observer",
    allowed_types: ["Application", "Organization"],
    translations: {},
    color: "#999999",
  },
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

function renderBuilder(route = "/admin/surveys/new") {
  return renderWithProviders(<SurveyBuilder />, {
    route,
    routes: [{ path: "/admin/surveys/new" }, { path: "/admin/surveys/:id" }],
  });
}

type User = ReturnType<typeof renderBuilder>["user"];

const nextButton = () => screen.getByRole("button", { name: /^Next/ });

/** The body of the most recent draft write, create or update. */
function lastDraft(): Record<string, unknown> {
  const writes = mockApi.calls.filter(
    (c) =>
      (c.method === "post" && c.path === "/surveys") ||
      (c.method === "patch" && c.path.startsWith("/surveys/")),
  );
  return writes[writes.length - 1].body as Record<string, unknown>;
}

function lastFilters(): Record<string, unknown> {
  return lastDraft().target_filters as Record<string, unknown>;
}

async function saveDraft(user: User) {
  const before = mockApi.calls.length;
  await user.click(screen.getByRole("button", { name: /Save Draft/ }));
  await waitFor(() =>
    expect(
      mockApi.calls
        .slice(before)
        .some((c) => (c.method === "post" && c.path === "/surveys") || c.method === "patch"),
    ).toBe(true),
  );
}

async function toTarget(user: User) {
  await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
  await user.click(nextButton());
  await screen.findByText("Target Cards");
}

async function pickType(user: User, name: RegExp = /Application$/) {
  await user.click(screen.getByRole("combobox", { name: /^Type/ }));
  await user.click(await screen.findByRole("option", { name }));
}

async function toFields(user: User) {
  await toTarget(user);
  await pickType(user);
  await user.click(await screen.findByRole("checkbox", { name: /Business Owner/ }));
  await user.click(nextButton());
  await screen.findByText("Select Fields");
}

/** The header row of a field section on the Fields step. */
const sectionRow = (label: string) => screen.getByText(label).closest("tr") as HTMLElement;

async function choose(user: User, combo: HTMLElement, option: string | RegExp) {
  await user.click(combo);
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ORG, PROVIDER, SECRET], [ORG_OWNS_APP, APP_USED_BY_ORG, APP_TO_PROVIDER]);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/stakeholder-roles/, ROLES);
  mockApi.on("post", "/surveys", { id: "survey-1" });
  mockApi.on("patch", "/surveys/survey-1", {});
  mockApi.on("post", "/surveys/survey-1/preview", PREVIEW);
});

describe("SurveyBuilder — header, stepper and step navigation", () => {
  it("shows a spinner, not the form, while an opened draft loads", async () => {
    let resolve: (v: unknown) => void = () => {};
    mockApi.on(
      "get",
      "/surveys/survey-7",
      () => new Promise((r) => {
        resolve = r;
      }),
    );
    renderBuilder("/admin/surveys/survey-7");

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("Edit Survey")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Survey Name/)).not.toBeInTheDocument();

    resolve({
      id: "survey-7",
      name: "Loaded",
      description: "",
      message: "",
      status: "draft",
      target_type_key: "Application",
      target_roles: [],
      target_filters: {},
      fields: [],
    });
    await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Loaded"));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("titles a new survey and shows the draft chip only once it has been saved", async () => {
    const { user } = renderBuilder();

    expect(await screen.findByText("New Survey")).toBeInTheDocument();
    expect(screen.queryByText("Edit Survey")).not.toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();

    await toTarget(user);
    await pickType(user);
    await saveDraft(user);

    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("survey-1")).not.toBeInTheDocument();
  });

  it("labels every step of the stepper", async () => {
    renderBuilder();
    await screen.findByLabelText(/Survey Name/);
    for (const label of ["Basics", "Target", "Fields", "Preview & Send"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders only the Basics step first, with its title and helper texts", async () => {
    const { user } = renderBuilder();
    await screen.findByLabelText(/Survey Name/);

    expect(screen.getByText("Survey Details")).toBeInTheDocument();
    expect(
      screen.getByText("Optional internal description (not shown to respondents)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This message will be shown to targeted users when they open the survey",
      ),
    ).toBeInTheDocument();
    // The Target step is not rendered alongside it.
    expect(screen.queryByText("Target Cards")).not.toBeInTheDocument();

    await toTarget(user);
    // …and Basics is gone once the Target step is showing.
    expect(screen.queryByText("Survey Details")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Survey Name/)).not.toBeInTheDocument();
  });

  it("refuses a name that is only whitespace", async () => {
    const { user } = renderBuilder();
    await user.type(await screen.findByLabelText(/Survey Name/), "   ");
    await user.click(nextButton());

    expect(await screen.findByText("Survey name is required")).toBeInTheDocument();
    expect(screen.queryByText("Target Cards")).not.toBeInTheDocument();
  });

  it("clears the error once the step validates", async () => {
    const { user } = renderBuilder();
    await user.click(await screen.findByRole("button", { name: /^Next/ }));
    expect(await screen.findByText("Survey name is required")).toBeInTheDocument();

    await toTarget(user);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the error when stepping back", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await user.click(nextButton());
    expect(await screen.findByText("Please select a target card type")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back$/ }));
    await screen.findByText("Survey Details");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SurveyBuilder — target step", () => {
  it("shows every filter's heading and hint", async () => {
    const { user } = renderBuilder();
    await toTarget(user);

    for (const text of [
      "Target Specific Cards (optional)",
      "Send the survey only to these specific cards. Leave empty to target all cards of the selected type (further narrowed by the filters below).",
      "Filter by Related Cards (optional)",
      "Only target cards that have a relation to one of these items (e.g., all Applications related to the Sales organization)",
      "Filter by Tags (optional)",
      "Filter by Attributes (optional)",
      "Only target cards where specific attributes match a condition (e.g., cost greater than 10000, TIME rating is missing)",
      "Only target cards nobody has changed for a while. Measured from the card's Modified date, the same one shown in the inventory and on the card's History tab.",
      "Target Stakeholder Roles",
      "Which roles should receive the survey for each matched card?",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("does not offer a hidden card type", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await user.click(screen.getByRole("combobox", { name: /^Type/ }));

    expect(await screen.findByRole("option", { name: /Application$/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Organization$/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Secret Type/ })).not.toBeInTheDocument();
  });

  it("keeps the specific-card picker off until a type is chosen", async () => {
    const { user } = renderBuilder();
    await toTarget(user);

    const specific = screen.getByTestId("specific-picker");
    expect(specific).toHaveAttribute("data-enabled", "false");
    expect(specific).toHaveAttribute("data-disabled", "true");
    expect(specific).toHaveAttribute("data-no-options", "Select a target type first");

    await pickType(user);
    await waitFor(() => expect(specific).toHaveAttribute("data-enabled", "true"));
    expect(specific).toHaveAttribute("data-disabled", "false");
    expect(specific).toHaveAttribute("data-no-options", "");
  });

  it("shows the picked specific cards as chips", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    const specific = screen.getByTestId("specific-picker");
    await user.click(within(specific).getByText("pick Picked App"));
    expect(await within(specific).findByText("chip Picked App")).toBeInTheDocument();
  });

  it("labels the related-card picker", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    expect(screen.getByTestId("related-picker")).toHaveAttribute("data-label", "Search cards...");
  });

  it("asks which relation only when more than one connects the picked cards", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    const related = screen.getByTestId("related-picker");
    // Application reaches a Provider through exactly one relation type.
    await user.click(within(related).getByText("pick Picked Provider"));
    expect(await within(related).findByText("chip Picked Provider")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Via relation/ })).not.toBeInTheDocument();

    // Adding an Organization brings two more, so the question is now worth asking.
    await user.click(within(related).getByText("pick Picked Org"));
    expect(await screen.findByRole("combobox", { name: /Via relation/ })).toBeInTheDocument();
  });

  it("offers only the tag groups that apply to the chosen type", async () => {
    const appGroup = makeTagGroup({ name: "App Group", restrict_to_types: ["Application"] });
    const orgGroup = makeTagGroup({ name: "Org Group", restrict_to_types: ["Organization"] });
    appGroup.tags = [makeTag({ name: "AppTag", tag_group_id: appGroup.id })];
    orgGroup.tags = [makeTag({ name: "OrgTag", tag_group_id: orgGroup.id })];
    mockApi.on("get", "/tag-groups", [appGroup, orgGroup]);

    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByLabelText("Select tags..."));
    expect(await screen.findByRole("option", { name: "AppTag" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "OrgTag" })).not.toBeInTheDocument();
  });
});

describe("SurveyBuilder — attribute filters", () => {
  const fieldCombos = () => screen.getAllByRole("combobox", { name: /^Field/ });
  const opCombos = () => screen.getAllByRole("combobox", { name: /^Operator/ });
  const valueInputs = () => screen.getAllByLabelText(/^Value/);
  const addFilter = (user: User) =>
    user.click(screen.getByRole("button", { name: /Add Attribute Filter/ }));

  it("starts a new filter row empty, testing for equality", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await addFilter(user);

    await saveDraft(user);
    expect(lastFilters().attribute_filters).toEqual([{ key: "", op: "eq", value: "" }]);
  });

  it("lists every operator, and drops the value for 'is not empty'", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await addFilter(user);

    await user.click(opCombos()[0]);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "equals",
      "not equals",
      "greater than",
      "greater or equal",
      "less than",
      "less or equal",
      "contains",
      "is empty",
      "is not empty",
    ]);
    await user.click(screen.getByRole("option", { name: "is not empty" }));

    await waitFor(() => expect(screen.queryByLabelText(/^Value/)).not.toBeInTheDocument());
  });

  it("edits the second row without disturbing the first", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await addFilter(user);
    await choose(user, fieldCombos()[0], "Criticality");
    await user.type(valueInputs()[0], "a");

    await addFilter(user);
    await choose(user, fieldCombos()[1], "Owner");
    await choose(user, opCombos()[1], "not equals");
    await user.type(valueInputs()[1], "b");

    await saveDraft(user);
    expect(lastFilters().attribute_filters).toEqual([
      { key: "criticality", op: "eq", value: "a" },
      { key: "owner", op: "ne", value: "b" },
    ]);
  });

  it("removes the row whose close button was clicked", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await addFilter(user);
    await user.type(valueInputs()[0], "first");
    await addFilter(user);
    await user.type(valueInputs()[1], "second");

    const firstRow = screen.getByDisplayValue("first").closest(".MuiBox-root") as HTMLElement;
    await user.click(within(firstRow).getByRole("button", { name: /close/ }));

    await waitFor(() => expect(screen.queryByDisplayValue("first")).not.toBeInTheDocument());
    expect(screen.getByDisplayValue("second")).toBeInTheDocument();
  });
});

describe("SurveyBuilder — last-update window", () => {
  const valueInput = () => screen.getByLabelText(/Not updated for/);

  it("keeps a preset when its active button is clicked again", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByRole("button", { name: "6 months" }));
    await user.click(screen.getByRole("button", { name: "6 months" }));
    expect(screen.getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");

    await saveDraft(user);
    expect(lastFilters().not_updated_for).toEqual({ value: 6, unit: "months" });
  });

  it("switching to Custom applies the draft value straight away", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByRole("button", { name: /Custom/ }));
    expect(valueInput()).toHaveValue(180);
    expect(valueInput()).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByText(/Cards last changed before/)).toBeInTheDocument();

    await saveDraft(user);
    expect(lastFilters().not_updated_for).toEqual({ value: 180, unit: "days" });
  });

  it("leaves the custom row when a preset is picked", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(screen.getByRole("button", { name: /Custom/ }));
    expect(valueInput()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "30 days" }));

    await waitFor(() =>
      expect(screen.queryByLabelText(/Not updated for/)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Custom/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("bounds the number input and flags only an out-of-range value", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByRole("button", { name: /Custom/ }));

    expect(valueInput()).toHaveAttribute("min", "1");
    expect(valueInput()).toHaveAttribute("max", "3650");
    // The unit starts on days.
    expect(screen.getByRole("combobox", { name: /^Unit/ })).toHaveTextContent("days");

    // A valid value is not an error.
    expect(valueInput()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(/whole number/)).not.toBeInTheDocument();

    // Nor is an empty field mid-edit.
    await user.clear(valueInput());
    expect(valueInput()).toHaveValue(null);
    expect(valueInput()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(/whole number/)).not.toBeInTheDocument();

    // Out of range is, and says what the range is.
    await user.type(valueInput(), "99999");
    await waitFor(() => expect(valueInput()).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText("Enter a whole number from 1 to 3650.")).toBeInTheDocument();
  });

  it("keeps a valid value when the unit changes", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);
    await user.click(screen.getByRole("button", { name: /Custom/ }));

    await user.clear(valueInput());
    await user.type(valueInput(), "45");
    await choose(user, screen.getByRole("combobox", { name: /^Unit/ }), "months");

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /^Unit/ })).toHaveTextContent("months"),
    );
    expect(valueInput()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByText(/whole number/)).not.toBeInTheDocument();

    await saveDraft(user);
    expect(lastFilters().not_updated_for).toEqual({ value: 45, unit: "months" });
  });
});

describe("SurveyBuilder — stakeholder roles", () => {
  it("marks a coloured role with a swatch and names the types a role is limited to", async () => {
    const { user } = renderBuilder();
    await toTarget(user);

    const observer = await screen.findByText("Observer");
    expect(observer.previousElementSibling).not.toBeNull();
    expect(screen.getByText("Business Owner").previousElementSibling).toBeNull();

    expect(screen.getByText("Only for: Application, Organization")).toBeInTheDocument();
    expect(screen.getAllByText(/^Only for:/)).toHaveLength(1);
  });

  it("unticking one role keeps the others", async () => {
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user);

    await user.click(await screen.findByRole("checkbox", { name: /Business Owner/ }));
    await user.click(screen.getByRole("checkbox", { name: /Observer/ }));
    await user.click(screen.getByRole("checkbox", { name: /Observer/ }));

    expect(screen.getByRole("checkbox", { name: /Observer/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Business Owner/ })).toBeChecked();

    await saveDraft(user);
    expect(lastDraft().target_roles).toEqual(["responsible"]);
  });
});

describe("SurveyBuilder — fields and relations selection", () => {
  it("counts each section's selection on its own", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    await user.click(screen.getByText("Criticality"));
    await waitFor(() => expect(within(sectionRow("General")).getByText("1/2")).toBeInTheDocument());
    expect(within(sectionRow("Assessment")).getByText("0/2")).toBeInTheDocument();
  });

  it("ticking and clearing a section leaves other sections' fields alone", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    await user.click(screen.getByText("Criticality"));
    await user.click(within(sectionRow("Assessment")).getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByText(/^3 field\(s\) selected/)).toBeInTheDocument(),
    );

    await user.click(within(sectionRow("Assessment")).getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByText("1 field(s) selected (1 maintain, 0 confirm)")).toBeInTheDocument(),
    );
    expect(within(sectionRow("Assessment")).getByText("0/2")).toBeInTheDocument();
    expect(within(sectionRow("General")).getByText("1/2")).toBeInTheDocument();
  });

  it("ticking a section keeps the action a field already had", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    await user.click(screen.getByText("Time Model"));
    const row = screen.getByText("Time Model").closest("tr") as HTMLElement;
    await waitFor(() => expect(within(row).getByRole("combobox")).toBeInTheDocument());
    await choose(user, within(row).getByRole("combobox"), "Confirm");

    await user.click(within(sectionRow("Assessment")).getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByText("2 field(s) selected (1 maintain, 1 confirm)")).toBeInTheDocument(),
    );
  });

  it("adds a relation beside a selected field, saves its shape and drops only it", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    await user.click(screen.getByText("Criticality"));
    await waitFor(() => expect(screen.getByText(/^1 field\(s\) selected/)).toBeInTheDocument());

    await user.click(screen.getByText("is owned by"));
    await waitFor(() =>
      expect(screen.getByText("2 field(s) selected (2 maintain, 0 confirm)")).toBeInTheDocument(),
    );

    await saveDraft(user);
    const fields = lastDraft().fields as Record<string, unknown>[];
    expect(fields.find((f) => f.key === "rel:relOrgToAppOwns:incoming")).toEqual({
      key: "rel:relOrgToAppOwns:incoming",
      section: "",
      label: "is owned by",
      type: "relation",
      kind: "relation",
      relation_type_key: "relOrgToAppOwns",
      direction: "incoming",
      related_type_key: "Organization",
      action: "maintain",
    });

    await user.click(screen.getByText("is owned by"));
    await waitFor(() =>
      expect(screen.getByText("1 field(s) selected (1 maintain, 0 confirm)")).toBeInTheDocument(),
    );
  });
});

describe("SurveyBuilder — sending", () => {
  it("recovers from a failed send that carries no message", async () => {
    mockApi.on("post", "/surveys/survey-1/send", () => Promise.reject("nope"));
    const { user } = renderBuilder();
    await toFields(user);
    await user.click(screen.getByText("Criticality"));
    await user.click(nextButton());
    expect(await screen.findByText("CRM", undefined, { timeout: 3000 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Send Survey/ }));
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    // The button comes back, so the send can be retried.
    await waitFor(() => expect(screen.getByRole("button", { name: /Send Survey/ })).toBeEnabled());
    expect(screen.queryByText("Sending...")).not.toBeInTheDocument();
  });
});
