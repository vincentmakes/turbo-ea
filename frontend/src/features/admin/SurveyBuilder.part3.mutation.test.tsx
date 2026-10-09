/**
 * SurveyBuilder — the Fields and Preview & Send steps and the wizard's
 * navigation bar, pinned from both sides of each condition they render on:
 *
 * - Fields: the section tickbox's unchecked / partial / checked states and
 *   what clicking it does in each, which row a selection belongs to, the
 *   required and inactive-extension markers, and the empty states of a type
 *   with no fields or relations and of a draft whose type has been removed.
 * - Preview & Send: the in-flight spinner, the tiles and breakdown, the
 *   "no matches" warning (which must stay quiet when the matches exist but
 *   nobody can be asked), the field chips, and Send's busy state.
 * - Navigation: Back on the first step, when Save Draft is offered, and its
 *   busy label.
 *
 * Built on the shared test kit with the real router, like
 * `SurveyBuilder.branches.test.tsx`. `CardPicker` is stubbed out: the card
 * filters are not under test here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));
vi.mock("@/components/CardPicker", () => ({ default: () => null }));

import SurveyBuilder from "./SurveyBuilder";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeRelationType,
  makeSection,
} from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";
import type { SurveyPreviewResult } from "@/types";

const APP = makeCardType({
  key: "Application",
  label: "Application",
  fields_schema: [
    makeSection({
      section: "General",
      fields: [
        makeField({ key: "website", label: "Website", type: "url" }),
        // No extension registers this type in the test, so it is inactive.
        makeField({ key: "fitScore", label: "Fit Score", type: "ext.acme.score" }),
      ],
    }),
    makeSection({
      section: "Assessment",
      fields: [
        makeField({
          key: "businessCriticality",
          label: "Business Criticality",
          type: "single_select",
          required: true,
        }),
        makeField({ key: "timeModel", label: "TIME Model", type: "single_select" }),
      ],
    }),
  ],
});
const ORG = makeCardType({ key: "Organization", label: "Organization" });
// No fields and no relation types touch it.
const VEHICLE = makeCardType({ key: "Vehicle", label: "Vehicle" });

// Application sits at the target end, so it is offered as the incoming
// "is owned by" side — mandatory there.
const ORG_OWNS_APP = makeRelationType({
  key: "relOrgToAppOwns",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  target_mandatory: true,
});

const ROLES = [{ key: "responsible", label: "Business Owner", allowed_types: null, translations: {} }];

const INACTIVE_EXT = /extension that isn't installed and active/;

// The preview is requested from a timer after the step changes, behind a draft
// write; give it room on a loaded runner.
const PREVIEW_WAIT = { timeout: 3000 };

function preview(over: Partial<SurveyPreviewResult> = {}): SurveyPreviewResult {
  return {
    total_cards: 2,
    total_matched: 5,
    skipped: [],
    total_users: 3,
    total_requests: 4,
    targets: [
      {
        card_id: "c1",
        card_name: "CRM",
        card_type: "Application",
        users: [
          // A blank role key must not leave a dangling separator behind.
          { user_id: "u1", display_name: "Ada", email: "a@x", roles: ["responsible", ""] },
        ],
      },
    ],
    ...over,
  } as SurveyPreviewResult;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
        { path: "/admin/surveys/:id/results", element: <LocationProbe /> },
      ],
    },
  );
}

type User = ReturnType<typeof renderBuilder>["user"];

const nextButton = () => screen.getByRole("button", { name: /^Next/ });
const backButton = () => screen.getByRole("button", { name: /Back$/ });
const sendButton = () => screen.getByRole("button", { name: /Send(ing\.\.\.| Survey)/ });

async function toTarget(user: User) {
  await user.type(await screen.findByLabelText(/Survey Name/), "Owner check");
  await user.click(nextButton());
  await screen.findByText("Target Cards");
}

async function pickType(user: User, label: RegExp) {
  await user.click(screen.getByRole("combobox", { name: /^Type/ }));
  await user.click(await screen.findByRole("option", { name: label }));
}

async function toFields(user: User, type = /Application/) {
  await toTarget(user);
  await pickType(user, type);
  await user.click(await screen.findByRole("checkbox", { name: /Business Owner/ }));
  await user.click(nextButton());
  await screen.findByText("Select Fields");
}

/** The table row holding `text`. */
const rowOf = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

/** The table whose header carries `column`. */
const tableWith = (column: string) =>
  screen.getByRole("columnheader", { name: column }).closest("table") as HTMLElement;

/** The preview tile whose big number is `count`. */
const tileWith = (count: string) =>
  screen.getByRole("heading", { level: 4, name: count }).closest(".MuiCard-root") as HTMLElement;

/** Mount a saved draft and step from Basics to the Fields step. */
async function openDraftAtFields(user: User) {
  await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).not.toHaveValue(""));
  await user.click(nextButton());
  await screen.findByText("Target Cards");
  await user.click(nextButton());
  await screen.findByText("Select Fields");
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  withMetamodel([APP, ORG, VEHICLE], [ORG_OWNS_APP]);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/stakeholder-roles/, ROLES);
  mockApi.on("post", "/surveys", { id: "survey-1" });
  mockApi.on("patch", "/surveys/survey-1", {});
  mockApi.on("post", "/surveys/survey-1/preview", preview());
});

describe("SurveyBuilder — navigation bar", () => {
  it("offers Back only after the first step, and Save Draft only once a name and a type exist", async () => {
    const { user } = renderBuilder();
    const name = await screen.findByLabelText(/Survey Name/);

    // The first step is Basics alone: no later step's card leaks into it.
    expect(backButton()).toBeDisabled();
    expect(screen.queryByText("Select Fields")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Draft" })).not.toBeInTheDocument();

    // A name alone is not enough to save.
    await user.type(name, "Owner check");
    expect(screen.queryByRole("button", { name: "Save Draft" })).not.toBeInTheDocument();

    await user.click(nextButton());
    await screen.findByText("Target Cards");
    expect(backButton()).toBeEnabled();
    await pickType(user, /Application/);
    expect(await screen.findByRole("button", { name: "Save Draft" })).toBeInTheDocument();

    // A name of only spaces is no name.
    await user.click(backButton());
    const again = await screen.findByLabelText(/Survey Name/);
    await user.clear(again);
    await user.type(again, "   ");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save Draft" })).not.toBeInTheDocument(),
    );
  });

  it("labels Save Draft as saving while the write is in flight", async () => {
    const save = deferred<{ id: string }>();
    mockApi.on("post", "/surveys", () => save.promise);
    const { user } = renderBuilder();
    await toTarget(user);
    await pickType(user, /Application/);

    await user.click(await screen.findByRole("button", { name: "Save Draft" }));
    const busy = await screen.findByRole("button", { name: "Saving..." });
    expect(busy).toBeDisabled();

    save.resolve({ id: "survey-1" });
    expect(await screen.findByRole("button", { name: "Save Draft" })).toBeEnabled();
  });
});

describe("SurveyBuilder — fields step", () => {
  it("names the type, labels its columns and marks required and inactive-extension fields", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    expect(
      screen.getByText(
        "Choose which fields respondents should maintain or confirm for each Application.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Please select a card type first.")).not.toBeInTheDocument();
    expect(screen.queryByText("This type has no configurable fields.")).not.toBeInTheDocument();

    const fields = tableWith("Field");
    expect(within(fields).getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(within(fields).getByRole("columnheader", { name: "Action" })).toBeInTheDocument();

    expect(within(rowOf("Business Criticality")).getByLabelText("Required")).toBeInTheDocument();
    expect(within(rowOf("TIME Model")).queryByLabelText("Required")).not.toBeInTheDocument();

    // Only the field whose extension is missing carries the warning.
    expect(within(rowOf("Fit Score")).getByLabelText(INACTIVE_EXT)).toBeInTheDocument();
    expect(within(rowOf("Website")).queryByLabelText(INACTIVE_EXT)).not.toBeInTheDocument();

    expect(
      screen.getByText(
        "Choose which relationships respondents should maintain or confirm for each card.",
      ),
    ).toBeInTheDocument();
    const relations = tableWith("Relationship");
    expect(within(relations).getByRole("columnheader", { name: "Related Type" })).toBeInTheDocument();
    expect(within(relations).getByRole("columnheader", { name: "Action" })).toBeInTheDocument();
    expect(within(rowOf("is owned by")).getByLabelText("Required")).toBeInTheDocument();
  });

  it("shows a section's tickbox empty, partial and full, and clears a full section", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    const header = () => rowOf("Assessment");
    const tick = () => within(header()).getByRole("checkbox");
    const sectionAction = () => within(header()).getByRole("combobox");

    expect(tick()).not.toBeChecked();
    expect(tick()).toHaveAttribute("data-indeterminate", "false");
    // Nothing picked, nothing to set an action on.
    expect(sectionAction()).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByText("TIME Model"));
    await waitFor(() => expect(within(header()).getByText("1/2")).toBeInTheDocument());
    expect(within(rowOf("TIME Model")).getByRole("checkbox")).toBeChecked();
    expect(within(rowOf("Business Criticality")).getByRole("checkbox")).not.toBeChecked();
    expect(tick()).not.toBeChecked();
    expect(tick()).toHaveAttribute("data-indeterminate", "true");
    expect(sectionAction()).not.toHaveAttribute("aria-disabled");
    // A field pick does not tick a relation.
    const relation = rowOf("is owned by");
    expect(within(relation).getByRole("checkbox")).not.toBeChecked();
    expect(within(relation).queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(tick());
    await waitFor(() => expect(within(header()).getByText("2/2")).toBeInTheDocument());
    expect(tick()).toBeChecked();
    expect(tick()).toHaveAttribute("data-indeterminate", "false");

    // Ticking a full section clears it.
    await user.click(tick());
    await waitFor(() => expect(within(header()).getByText("0/2")).toBeInTheDocument());
    expect(tick()).not.toBeChecked();
    expect(screen.queryByText(/field\(s\) selected/)).not.toBeInTheDocument();
  });

  it("switches one field to Confirm from its own row", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    await user.click(screen.getByText("Website"));
    await user.click(await within(rowOf("Website")).findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Confirm" }));

    expect(
      await screen.findByText("1 field(s) selected (0 maintain, 1 confirm)"),
    ).toBeInTheDocument();
  });

  it("adds a relation as Maintain", async () => {
    const { user } = renderBuilder();
    await toFields(user);

    await user.click(screen.getByText("is owned by"));
    const action = await within(rowOf("is owned by")).findByRole("combobox");
    expect(action).toHaveTextContent("Maintain");
  });

  it("says so when the type has no fields and no relations", async () => {
    const { user } = renderBuilder();
    await toFields(user, /Vehicle/);

    expect(
      screen.getByText("Choose which fields respondents should maintain or confirm for each Vehicle."),
    ).toBeInTheDocument();
    expect(screen.getByText("This type has no configurable fields.")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Field" })).not.toBeInTheDocument();
    expect(screen.getByText("This type has no configurable relationships.")).toBeInTheDocument();
    expect(screen.queryByText("Please select a card type first.")).not.toBeInTheDocument();
  });

  it("asks for a type on the Target step when a draft's type has since been removed", async () => {
    mockApi.on("get", "/surveys/survey-8", {
      id: "survey-8",
      name: "Old draft",
      description: "",
      message: "",
      status: "draft",
      target_type_key: "Retired",
      target_roles: ["responsible"],
      target_filters: {},
      fields: [],
    });
    mockApi.on("patch", "/surveys/survey-8", {});
    // The Target step's type select holds a value it has no option for, which
    // is the situation under test; MUI says so on the console.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { user } = renderBuilder("/admin/surveys/survey-8");
      await waitFor(() => expect(screen.getByLabelText(/Survey Name/)).toHaveValue("Old draft"));
      await user.click(nextButton());
      await screen.findByText("Target Cards");

      // The select shows no type, so the step does not pass on the stale key.
      await user.click(nextButton());
      expect(await screen.findByText("Please select a target card type")).toBeInTheDocument();
      expect(screen.getByText("Target Cards")).toBeInTheDocument();
      expect(screen.queryByText("Select Fields")).not.toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("SurveyBuilder — preview & send step", () => {
  async function toPreview(user: User) {
    await toFields(user);
    await user.click(screen.getByText("Website"));
    await user.click(nextButton());
  }

  it("spins while the preview loads, then lays it out and sends", async () => {
    const pending = deferred<SurveyPreviewResult>();
    mockApi.on("post", "/surveys/survey-1/preview", () => pending.promise);
    const sending = deferred<Record<string, never>>();
    mockApi.on("post", "/surveys/survey-1/send", () => sending.promise);
    const { user } = renderBuilder();
    await toPreview(user);

    expect(await screen.findByRole("progressbar", {}, PREVIEW_WAIT)).toBeInTheDocument();
    // While one is loading, a second is not offered.
    expect(screen.queryByRole("button", { name: "Load Preview" })).not.toBeInTheDocument();
    pending.resolve(preview());
    expect(await screen.findByText("CRM")).toBeInTheDocument();

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preview & Send" })).toBeInTheDocument();

    expect(within(tileWith("2")).getByText("Cards")).toBeInTheDocument();
    // One field was picked.
    expect(within(tileWith("1")).getByText("Fields")).toBeInTheDocument();

    // 5 matched, 2 reachable: the three left out are explained, not reported
    // as "nothing matched".
    expect(screen.getByText(/They match your filters, but no one holds/)).toBeInTheDocument();
    expect(screen.queryByText(/No cards matched your filters/)).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Target Breakdown" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Card" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByText("Ada (Business Owner)")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Message Preview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fields" })).toBeInTheDocument();

    expect(sendButton()).toBeEnabled();
    expect(within(sendButton()).queryByRole("progressbar")).not.toBeInTheDocument();

    await user.click(sendButton());
    await waitFor(() => expect(sendButton()).toHaveTextContent("Sending..."));
    expect(sendButton()).toBeDisabled();
    expect(within(sendButton()).getByRole("progressbar")).toBeInTheDocument();

    sending.resolve({});
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/admin/surveys/survey-1/results"),
    );
  });

  it("warns when nothing matched at all, and will not send", async () => {
    mockApi.on(
      "post",
      "/surveys/survey-1/preview",
      preview({ total_cards: 0, total_matched: 0, total_users: 0, total_requests: 0, targets: [] }),
    );
    const { user } = renderBuilder();
    await toPreview(user);

    expect(
      await screen.findByText(
        "No cards matched your filters, or no stakeholders were found with the selected roles. Go back and adjust your targeting criteria.",
        {},
        PREVIEW_WAIT,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Target Breakdown")).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("does not claim nothing matched when matches exist but nobody can be asked", async () => {
    mockApi.on(
      "post",
      "/surveys/survey-1/preview",
      preview({ total_cards: 0, total_matched: 3, total_users: 0, total_requests: 0, targets: [] }),
    );
    const { user } = renderBuilder();
    await toPreview(user);

    expect(
      await screen.findByText("3 matching cards have nobody to ask", {}, PREVIEW_WAIT),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No cards matched your filters/)).not.toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("names a relation field by its live verb, not the label stored with the draft", async () => {
    mockApi.on("get", "/surveys/survey-7", {
      id: "survey-7",
      name: "Saved",
      description: "",
      message: "",
      status: "draft",
      target_type_key: "Application",
      target_roles: ["responsible"],
      target_filters: {},
      fields: [
        { key: "website", section: "General", label: "Website", type: "url", action: "confirm" },
        {
          key: "rel:relOrgToAppOwns:incoming",
          section: "",
          // Stored when the draft was built; the verb has been renamed since.
          label: "was owned by",
          type: "relation",
          kind: "relation",
          relation_type_key: "relOrgToAppOwns",
          direction: "incoming",
          related_type_key: "Organization",
          action: "maintain",
        },
      ],
    });
    mockApi.on("patch", "/surveys/survey-7", {});
    mockApi.on("post", "/surveys/survey-7/preview", preview());
    const { user } = renderBuilder("/admin/surveys/survey-7");
    await openDraftAtFields(user);
    await user.click(nextButton());

    expect(await screen.findByText("is owned by (maintain)", {}, PREVIEW_WAIT)).toBeInTheDocument();
    expect(screen.queryByText("was owned by (maintain)")).not.toBeInTheDocument();
    // An ordinary field keeps its own label.
    expect(screen.getByText("Website (confirm)")).toBeInTheDocument();
  });
});
