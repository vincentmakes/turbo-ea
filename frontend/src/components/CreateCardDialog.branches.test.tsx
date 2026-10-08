/**
 * CreateCardDialog branches beyond `CreateCardDialog.test.tsx`: one required
 * field of every type, subtype-hidden fields, tags, the Provider relation's
 * direction and failure, end-of-life auto-search and linking, and AI
 * description suggestions.
 *
 * Built on the shared test kit. `EolLinkDialog`, `VendorField` and `TagPicker`
 * are stubbed down to the callbacks the dialog wires — each has its own tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const ai = vi.hoisted(() => ({
  status: { enabled: false, configured: false, enabled_types: [] as string[], running_models: [] },
}));
vi.mock("@/hooks/useAiStatus", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAiStatus")>("@/hooks/useAiStatus");
  return { ...actual, useAiStatus: () => ({ aiStatus: ai.status, loaded: true }) };
});

vi.mock("@/components/EolLinkSection", () => ({
  EolLinkDialog: ({
    open,
    onClose,
    onLink,
    initialProduct,
  }: {
    open: boolean;
    onClose: () => void;
    onLink: (product: string, cycle: string) => void;
    initialProduct?: string;
  }) =>
    open ? (
      <div data-testid="eol-dialog" data-product={initialProduct ?? ""}>
        <button onClick={() => onLink(initialProduct || "nodejs", "22")}>eol-link</button>
        <button onClick={onClose}>eol-close</button>
      </div>
    ) : null,
}));
vi.mock("@/components/VendorField", () => ({
  default: ({
    onProviderSelected,
    onChange,
  }: {
    onProviderSelected?: (p: { id: string; name: string } | null) => void;
    onChange: (v: string) => void;
  }) => (
    <div>
      <button onClick={() => onProviderSelected?.({ id: "prov-1", name: "Acme" })}>pick-provider</button>
      <button onClick={() => onChange("typed")}>type-vendor</button>
    </div>
  ),
}));
vi.mock("@/components/TagPicker", () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(["tag-1", "tag-2"])}>pick-tags</button>
  ),
}));

import CreateCardDialog from "./CreateCardDialog";
import { mockApi } from "@/test/apiMock";
import { hookState, withMetamodel } from "@/test/hooks";
import {
  makeCardType,
  makeField,
  makeOption,
  makeRelationType,
  makeSection,
  makeSubtype,
} from "@/test/fixtures/metamodel";
import { renderWithProviders } from "@/test/render";

const WIDGET = makeCardType({
  key: "Widget",
  label: "Widget",
  subtypes: [makeSubtype({ key: "lite", label: "Lite", hidden_fields: ["notes"] })],
  fields_schema: [
    makeSection({
      section: "Details",
      fields: [
        makeField({
          key: "tier",
          label: "Tier",
          type: "single_select",
          required: true,
          options: [
            makeOption({ key: "gold", label: "Gold", color: "#ffd700" }),
            makeOption({ key: "silver", label: "Silver" }),
          ],
        }),
        makeField({ key: "notes", label: "Notes", type: "text", required: true }),
        makeField({ key: "units", label: "Units", type: "number", required: true }),
        makeField({ key: "shared", label: "Shared", type: "boolean", required: true }),
        makeField({ key: "golive", label: "Go-live", type: "date", required: true }),
        makeField({ key: "done", label: "Done", type: "percentage", required: true }),
        makeField({
          key: "zones",
          label: "Zones",
          type: "multiple_select",
          required: true,
          options: [
            makeOption({ key: "eu", label: "Europe", color: "#003399" }),
            makeOption({ key: "us", label: "Americas" }),
          ],
        }),
        makeField({ key: "optional", label: "Optional", type: "text" }),
      ],
    }),
  ],
});

const ITC = makeCardType({ key: "ITComponent", label: "IT Component", has_hierarchy: false });
const APP = makeCardType({ key: "Application", label: "Application" });

const REL_ITC_TO_PROVIDER = makeRelationType({
  key: "relITCToProvider",
  label: "is supplied by",
  source_type_key: "ITComponent",
  target_type_key: "Provider",
  sort_order: 1,
});
const REL_ITC_TO_PROVIDER_LATER = makeRelationType({
  key: "relITCToProviderB",
  label: "is resold by",
  source_type_key: "ITComponent",
  target_type_key: "Provider",
  sort_order: 5,
});
const REL_PROVIDER_TO_APP = makeRelationType({
  key: "relProviderToApp",
  label: "offers",
  source_type_key: "Provider",
  target_type_key: "Application",
});

const onClose = vi.fn();
const onCreate = vi.fn(async () => "new-id");

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderDialog(props: { initialType?: string; initialAttributes?: Record<string, unknown> } = {}) {
  return renderWithProviders(
    <>
      <CreateCardDialog
        open
        onClose={onClose}
        onCreate={onCreate}
        initialType={props.initialType}
        initialAttributes={props.initialAttributes}
      />
      <LocationProbe />
    </>,
  );
}

const nameBox = () => screen.getByRole("textbox", { name: /^Name/ });

/** MUI's Select does not name its combobox after the InputLabel; go via the label. */
function select(label: RegExp): HTMLElement {
  const formControl = screen.getByText(label, { selector: "label" }).closest(".MuiFormControl-root");
  return within(formControl as HTMLElement).getByRole("combobox");
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  onClose.mockClear();
  onCreate.mockReset();
  onCreate.mockImplementation(async () => "new-id");
  ai.status = { enabled: false, configured: false, enabled_types: [], running_models: [] };
  withMetamodel(
    [WIDGET, ITC, APP],
    [REL_ITC_TO_PROVIDER_LATER, REL_ITC_TO_PROVIDER, REL_PROVIDER_TO_APP],
  );
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/eol\/products\/fuzzy/, []);
});


// The AI button is found by its visible label. Its accessible name currently
// comes from the tooltip ("Use AI to suggest…"), a label-in-name mismatch
// (WCAG 2.5.3) that a role+name query would pin.
const aiButton = () => screen.queryByText("Suggest with AI")?.closest("button") ?? null;

describe("CreateCardDialog — required fields of every type", () => {
  it("renders each field type, and submits what was entered", async () => {
    const { user } = renderDialog({ initialType: "Widget" });

    // single_select, with a colour dot on the coloured option.
    await user.click(select(/^Tier/));
    const gold = await screen.findByRole("option", { name: "Gold" });
    expect(gold.querySelector("div div")).not.toBeNull();
    await user.click(gold);
    // Re-pick the empty option and then Silver: "" stores undefined.
    await user.click(select(/^Tier/));
    await user.click(await screen.findByRole("option", { name: "None" }));
    await user.click(select(/^Tier/));
    await user.click(await screen.findByRole("option", { name: "Silver" }));

    await user.type(screen.getByRole("textbox", { name: /^Notes/ }), "Hello");
    const units = screen.getByRole("spinbutton", { name: /^Units/ });
    await user.type(units, "7");
    await user.click(screen.getByRole("checkbox", { name: "Shared" }));

    const golive = screen.getByLabelText(/^Go-live/);
    fireEvent.focus(golive);
    fireEvent.change(golive, { target: { value: "2027-03-01" } });
    fireEvent.blur(golive);

    await user.type(screen.getByRole("spinbutton", { name: /^Done/ }), "40");

    await user.click(select(/^Zones/));
    await user.click(await screen.findByRole("option", { name: /Europe/ }));
    await user.click(screen.getByRole("option", { name: /Americas/ }));
    await user.keyboard("{Escape}");
    // The optional field is not rendered at create time.
    expect(screen.queryByRole("textbox", { name: /^Optional/ })).not.toBeInTheDocument();

    await user.type(nameBox(), "Gadget");
    await user.type(screen.getByRole("textbox", { name: /^Description/ }), "  A gadget  ");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toEqual({
      type: "Widget",
      subtype: undefined,
      name: "Gadget",
      description: "A gadget",
      parent_id: undefined,
      attributes: {
        tier: "silver",
        notes: "Hello",
        units: 7,
        shared: true,
        golive: "2027-03-01",
        done: 40,
        zones: ["eu", "us"],
      },
    });
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/cards/new-id"));
  });

  it("clears a number field back to undefined and removes a multi-select chip", async () => {
    const { user } = renderDialog({
      initialType: "Widget",
      initialAttributes: { zones: ["eu", "us"], units: 3 },
    });

    const units = screen.getByRole("spinbutton", { name: /^Units/ });
    expect(units).toHaveValue(3);
    await user.clear(units);

    // Deleting the last chips leaves the field unset rather than [].
    const zones = select(/^Zones/);
    const europe = within(zones).getByText("Europe").closest(".MuiChip-root") as HTMLElement;
    await user.click(within(europe).getByTestId("CancelIcon"));
    const americas = within(zones).getByText("Americas").closest(".MuiChip-root") as HTMLElement;
    await user.click(within(americas).getByTestId("CancelIcon"));

    await user.type(nameBox(), "Cleared");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    // Both keys were emptied, so neither carries a value.
    expect(onCreate.mock.calls[0][0].attributes).toEqual({ zones: undefined, units: undefined });
  });

  it("shows a type's required fields once it is picked from the type list", async () => {
    const { user } = renderDialog();
    expect(screen.queryByRole("textbox", { name: /^Notes/ })).not.toBeInTheDocument();
    await user.click(select(/^Type/));
    await user.click(await screen.findByRole("option", { name: /Widget/ }));
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toBeInTheDocument();
  });

  it("drops a required field the chosen subtype hides", async () => {
    const { user } = renderDialog({ initialType: "Widget" });
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toBeInTheDocument();

    await user.click(select(/^Subtype/));
    await user.click(await screen.findByRole("option", { name: "Lite" }));
    expect(screen.queryByRole("textbox", { name: /^Notes/ })).not.toBeInTheDocument();
  });
});

describe("CreateCardDialog — errors and closing", () => {
  it("closes from the header icon", async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a non-Error failure generically and lets it be dismissed", async () => {
    onCreate.mockImplementation(() => Promise.reject("nope"));
    const { user } = renderDialog({ initialType: "Application" });
    await user.type(nameBox(), "Broken");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to create card");
    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the dialog usable when tag groups cannot be loaded", async () => {
    mockApi.fail("get", "/tag-groups", 500);
    renderDialog({ initialType: "Application" });
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(1));
    expect(screen.queryByText("pick-tags")).not.toBeInTheDocument();
  });

  it("lets a modified click on the duplicate link through without closing", async () => {
    const { ApiError } = await import("@/api/client");
    onCreate.mockImplementation(() =>
      Promise.reject(
        new ApiError("conflict", 409, {
          code: "sibling_name_conflict",
          existing_card_id: "dup-1",
          existing_card_name: "Dup",
          type_key: "Application",
        }),
      ),
    );
    const { user } = renderDialog({ initialType: "Application" });
    await user.type(nameBox(), "Dup");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    const link = await screen.findByRole("link", { name: "View existing card" });
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link, { ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
    // Typing clears the conflict.
    await user.type(nameBox(), "2");
    expect(screen.queryByRole("link", { name: "View existing card" })).not.toBeInTheDocument();
  });
});

describe("CreateCardDialog — tags and Provider", () => {
  it("assigns picked tags after creating, and tolerates a failing tag write", async () => {
    mockApi.on("get", "/tag-groups", [{ id: "g1", name: "Risk", mode: "multi", tags: [] }]);
    mockApi.fail("post", "/cards/new-id/tags", 500);
    const { user } = renderDialog({ initialType: "Application" });

    await user.click(await screen.findByText("pick-tags"));
    await user.type(nameBox(), "Tagged");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", "/cards/new-id/tags")[0].body).toEqual(["tag-1", "tag-2"]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/cards/new-id"));
  });

  it("links the Provider through the lowest-sort relation type, with the card as source", async () => {
    mockApi.on("post", "/relations", {});
    const { user } = renderDialog({ initialType: "ITComponent" });

    await user.click(screen.getByText("type-vendor"));
    await user.click(screen.getByText("pick-provider"));
    await user.type(nameBox(), "Server");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: "relITCToProvider",
      source_id: "new-id",
      target_id: "prov-1",
    });
    // The vendor text never rides along as an attribute.
    expect(onCreate.mock.calls[0][0].attributes).toBeUndefined();
  });

  it("puts the Provider at the source end when the relation type runs from it, and survives a failure", async () => {
    mockApi.fail("post", "/relations", 500);
    const { user } = renderDialog({ initialType: "Application" });

    await user.click(screen.getByText("pick-provider"));
    await user.type(nameBox(), "Portal");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: "relProviderToApp",
      source_id: "prov-1",
      target_id: "new-id",
    });
  });
});

describe("CreateCardDialog — end-of-life tracking", () => {
  it("auto-searches by name, links a suggestion and submits the link", async () => {
    mockApi.on("get", /^\/eol\/products\/fuzzy/, [
      { name: "python", score: 0.92 },
      { name: "pypy", score: 0.4 },
    ]);
    const { user } = renderDialog({ initialType: "ITComponent" });
    expect(screen.getByText("End-of-Life Tracking")).toBeInTheDocument();

    await user.type(nameBox(), "Python");
    expect(await screen.findByText("Suggested matches from endoflife.date:", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(mockApi.callsOf("get", /fuzzy/)[0].path).toBe("/eol/products/fuzzy?search=Python&limit=5");

    await user.click(screen.getByText("python"));
    const dialog = await screen.findByTestId("eol-dialog");
    expect(dialog).toHaveAttribute("data-product", "python");
    await user.click(screen.getByText("eol-link"));
    expect(screen.getByText(/Linked to/)).toHaveTextContent("Linked to python 22");

    // Change re-opens the picker; closing it keeps the link.
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(await screen.findByText("eol-close"));
    expect(screen.queryByTestId("eol-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].attributes).toEqual({ eol_product: "python", eol_cycle: "22" });
  });

  it("unlinks with Remove and links manually from the search button", async () => {
    const { user } = renderDialog({ initialType: "ITComponent" });

    await user.click(screen.getByRole("button", { name: "Manual Search" }));
    await user.click(await screen.findByText("eol-link"));
    expect(screen.getByText(/Linked to/)).toHaveTextContent("nodejs 22");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manual Search" })).toBeInTheDocument();
  });

  it("says so when the search finds nothing or fails", async () => {
    mockApi.fail("get", /^\/eol\/products\/fuzzy/, 502);
    const { user } = renderDialog({ initialType: "ITComponent" });
    await user.type(nameBox(), "Obscure thing");
    expect(
      await screen.findByText(/No EOL matches found/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

describe("CreateCardDialog — AI suggestions", () => {
  beforeEach(() => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
  });

  it("offers a suggestion once the name is long enough and applies it", async () => {
    mockApi.on("post", "/ai/suggest", {
      suggestions: { description: { value: "A CRM platform.", confidence: 0.9 } },
      sources: [],
    });
    const { user } = renderDialog({ initialType: "Application" });

    await user.type(nameBox(), "S");
    expect(aiButton()).not.toBeInTheDocument();
    await user.type(nameBox(), "alesforce");
    await user.click(aiButton()!);

    expect(mockApi.callsOf("post", "/ai/suggest")[0].body).toEqual({
      type_key: "Application",
      subtype: undefined,
      name: "Salesforce",
    });
    await user.click(await screen.findByRole("button", { name: /Apply description/ }));
    expect(screen.getByRole("textbox", { name: /^Description/ })).toHaveValue("A CRM platform.");
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
  });

  it("applies suggested field values alongside the description", async () => {
    mockApi.on("post", "/ai/suggest", {
      suggestions: {
        description: { value: "Gadget desc", confidence: 0.6 },
        shared: { value: true, confidence: 0.8 },
      },
      sources: [],
    });
    const { user } = renderDialog({ initialType: "Widget" });
    await user.type(nameBox(), "Gadget");
    await user.click(aiButton()!);
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    expect(screen.getByRole("checkbox", { name: "Shared" })).toBeChecked();
  });

  it("applies field values even without a description suggestion", async () => {
    mockApi.on("post", "/ai/suggest", {
      suggestions: { shared: { value: true, confidence: 0.8 } },
      sources: [],
    });
    const { user } = renderDialog({ initialType: "Widget" });
    await user.type(nameBox(), "Gadget");
    await user.click(aiButton()!);
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    expect(screen.getByRole("textbox", { name: /^Description/ })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Shared" })).toBeChecked();
  });

  it("shows a failed suggestion and dismisses it", async () => {
    mockApi.fail("post", "/ai/suggest", 503);
    const { user } = renderDialog({ initialType: "Application" });
    await user.type(nameBox(), "Salesforce");
    await user.click(aiButton()!);

    expect(await screen.findByText("AI Suggestion Failed")).toBeInTheDocument();
    expect(screen.getByText("POST /ai/suggest failed")).toBeInTheDocument();
    // The panel's own Close (the dialog header's is an icon labelled "Close").
    await user.click(screen.getByText("Close", { selector: "button" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(aiButton()!).toBeInTheDocument();
  });

  it("uses a generic message for a non-Error AI failure", async () => {
    mockApi.on("post", "/ai/suggest", () => Promise.reject("x"));
    const { user } = renderDialog({ initialType: "Application" });
    await user.type(nameBox(), "Salesforce");
    await user.click(aiButton()!);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});
