/**
 * CreateCardDialog — the behaviour the mutation run showed no test noticing:
 * the first paint before any effect runs, what a type switch and a
 * close/reopen reset (and what they keep), the per-card-type create gate,
 * every shape of a 409 on the name, the Provider relation-type pick, the EOL
 * auto-search's thresholds and request ordering, and the AI panel's loading
 * and dismiss paths.
 *
 * The EOL tests run on fake `setTimeout`s so the 600ms name debounce is
 * stepped explicitly instead of waited out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { createTheme, ThemeProvider } from "@mui/material/styles";
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

// The EOL picker always renders a probe carrying the props the dialog hands
// it, so the tests can read them whether or not it is open.
vi.mock("@/components/EolLinkSection", () => ({
  EolLinkDialog: ({
    open,
    onClose,
    onLink,
    initialProduct,
    cardName,
  }: {
    open: boolean;
    onClose: () => void;
    onLink: (product: string, cycle: string) => void;
    initialProduct?: string;
    cardName?: string;
  }) => (
    <div
      data-testid="eol-dialog"
      data-open={String(open)}
      data-product={initialProduct ?? ""}
      data-card-name={cardName === undefined ? "<none>" : String(cardName)}
    >
      {open && (
        <>
          <button
            onClick={() => {
              // The real picker closes itself once a cycle is chosen.
              onLink(initialProduct || "nodejs", "22");
              onClose();
            }}
          >
            eol-link
          </button>
          <button onClick={onClose}>eol-close</button>
        </>
      )}
    </div>
  ),
}));
vi.mock("@/components/VendorField", () => ({
  default: ({
    value,
    onProviderSelected,
  }: {
    value: string;
    onProviderSelected?: (p: { id: string; name: string } | null) => void;
  }) => (
    <div data-testid="vendor" data-value={value}>
      <button onClick={() => onProviderSelected?.({ id: "prov-1", name: "Acme" })}>
        pick-provider
      </button>
    </div>
  ),
}));
vi.mock("@/components/TagPicker", () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange(["tag-1"])}>pick-tags</button>
  ),
}));
vi.mock("@/components/CardPicker", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: { id: string } | null;
    onChange: (v: { id: string; name: string; type: string } | null) => void;
  }) => (
    <div data-testid="parent-picker" data-value={value?.id ?? ""}>
      <button onClick={() => onChange({ id: "parent-1", name: "Parent One", type: "Widget" })}>
        pick-parent
      </button>
    </div>
  ),
}));

import CreateCardDialog from "./CreateCardDialog";
import { ApiError } from "@/api/client";
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
import { makeUser, wrapWithProviders } from "@/test/render";
import type { User } from "@/types";

// ---------------------------------------------------------------------------
// Metamodel
// ---------------------------------------------------------------------------

const WIDGET = makeCardType({
  key: "Widget",
  label: "Widget",
  has_hierarchy: true,
  subtypes: [
    makeSubtype({ key: "lite", label: "Lite", hidden_fields: ["notes"] }),
    makeSubtype({ key: "pro", label: "Pro" }),
  ],
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
// Hierarchical, an empty subtype list, and a `notes` field of its own.
const GIZMO = makeCardType({
  key: "Gizmo",
  label: "Gizmo",
  has_hierarchy: true,
  subtypes: [],
  fields_schema: [
    makeSection({ fields: [makeField({ key: "notes", label: "Notes", type: "text", required: true })] }),
  ],
});
// No subtypes key, no fields, no hierarchy.
const PLAIN = makeCardType({ key: "Plain", label: "Plain" });
// Key and label differ, and it is not the first type in the list.
const KIT = makeCardType({ key: "Kit", label: "Toolkit" });
// Select fields an admin has not given options yet.
const LOOSE = makeCardType({
  key: "Loose",
  label: "Loose",
  fields_schema: [
    makeSection({
      fields: [
        makeField({ key: "choice", label: "Choice", type: "single_select", required: true }),
        makeField({ key: "labels", label: "Labels", type: "multiple_select", required: true }),
      ],
    }),
  ],
});
const ITC = makeCardType({
  key: "ITComponent",
  label: "IT Component",
  subtypes: [makeSubtype({ key: "saas", label: "SaaS" })],
});
const APP = makeCardType({ key: "Application", label: "Application" });
const TYPES = [WIDGET, GIZMO, PLAIN, KIT, LOOSE, ITC, APP];

// The two genuine Provider ↔ IT Component types come first: the lower sort
// order carries the LATER key, so only a sort on sort_order picks it.
const RELATION_TYPES = [
  makeRelationType({
    key: "relZITCToProvider",
    source_type_key: "ITComponent",
    target_type_key: "Provider",
    sort_order: 1,
  }),
  makeRelationType({
    key: "relAProviderSuppliesITC",
    source_type_key: "Provider",
    target_type_key: "ITComponent",
    sort_order: 5,
  }),
  // Decoys with a lower sort order that do NOT connect Provider and IT Component.
  makeRelationType({
    key: "relAppToITC",
    source_type_key: "Application",
    target_type_key: "ITComponent",
    sort_order: 0,
  }),
  makeRelationType({
    key: "relITCToTech",
    source_type_key: "ITComponent",
    target_type_key: "TechCategory",
    sort_order: 0,
  }),
  makeRelationType({
    key: "relAppToProvider",
    source_type_key: "Application",
    target_type_key: "Provider",
    sort_order: 0,
  }),
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const onClose = vi.fn();
const onCreate = vi.fn(async (_data: Record<string, unknown>): Promise<string> => "new-id");
let currentUser: User = makeUser();

interface DialogProps {
  open?: boolean;
  initialType?: string;
  initialSubtype?: string;
  initialAttributes?: Record<string, unknown>;
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function dialog(p: DialogProps) {
  return (
    <>
      <CreateCardDialog
        open={p.open ?? true}
        onClose={onClose}
        onCreate={onCreate}
        initialType={p.initialType}
        initialSubtype={p.initialSubtype}
        initialAttributes={p.initialAttributes}
      />
      <LocationProbe />
    </>
  );
}

function renderDialog(p: DialogProps = {}) {
  const user = userEvent.setup({ delay: null });
  const r = render(wrapWithProviders(dialog(p), { user: currentUser }));
  return { ...r, user, update: (next: DialogProps) => r.rerender(wrapWithProviders(dialog(next), { user: currentUser })) };
}

/** The first paint, before a single effect has run. */
function firstPaint(p: DialogProps): HTMLElement {
  // Dialog content sits in a portal, which renders nothing on the server.
  const theme = createTheme({ components: { MuiDialog: { defaultProps: { disablePortal: true } } } });
  const html = renderToStaticMarkup(
    <ThemeProvider theme={theme}>{wrapWithProviders(dialog(p), { user: currentUser })}</ThemeProvider>,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const nameBox = () => screen.getByRole("textbox", { name: /^Name/ });
const descriptionBox = () => screen.getByRole("textbox", { name: /^Description/ });
const createButton = () => screen.getByRole("button", { name: /^Create$/ });
const eolProps = () => screen.getByTestId("eol-dialog");
const fuzzyCalls = () => mockApi.callsOf("get", /^\/eol\/products\/fuzzy/).map((c) => c.path);
const fuzzyPath = (term: string) => `/eol/products/fuzzy?search=${encodeURIComponent(term)}&limit=5`;

function formControl(label: RegExp, root: HTMLElement = document.body): HTMLElement {
  return within(root).getByText(label, { selector: "label" }).closest(".MuiFormControl-root") as HTMLElement;
}
/** MUI's Select does not name its combobox after the InputLabel; go via the label. */
function select(label: RegExp): HTMLElement {
  return within(formControl(label)).getByRole("combobox");
}
/** The value a Select holds, read from the input it keeps in sync. */
function selectValue(label: RegExp, root: HTMLElement = document.body): string {
  return (formControl(label, root).querySelector("input.MuiSelect-nativeInput") as HTMLInputElement).value;
}
/** The text that sizes a Select's notched outline. */
function notchText(label: RegExp): string {
  return formControl(label).querySelector("fieldset legend")?.textContent ?? "";
}
function helperTextOf(input: HTMLElement): HTMLElement {
  return document.getElementById(input.getAttribute("aria-describedby") ?? "") as HTMLElement;
}
async function pickType(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(select(/^Type/));
  await user.click(await screen.findByRole("option", { name }));
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  hookState.reset();
  mockApi.reset();
  onClose.mockClear();
  onCreate.mockReset();
  onCreate.mockImplementation(async () => "new-id");
  currentUser = makeUser();
  ai.status = { enabled: false, configured: false, enabled_types: [], running_models: [] };
  withMetamodel(TYPES, RELATION_TYPES);
  mockApi.on("get", "/tag-groups", []);
  mockApi.on("get", /^\/eol\/products\/fuzzy/, []);
  mockApi.on("post", "/relations", {});
  mockApi.on("post", /^\/cards\/[^/]+\/tags$/, {});
});

// ---------------------------------------------------------------------------
// First paint
// ---------------------------------------------------------------------------


// Named by its visible label (WCAG 2.5.3); the tooltip only describes it.
const aiButton = () => screen.queryByRole("button", { name: /Suggest with AI/ });

describe("CreateCardDialog — first paint", () => {
  it("opens already showing the preset type, subtype and attribute values, with nothing else on", () => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    const host = firstPaint({
      initialType: "Widget",
      initialSubtype: "pro",
      initialAttributes: { notes: "Preset note" },
    });
    try {
      expect(selectValue(/^Type/, host)).toBe("Widget");
      expect(selectValue(/^Subtype/, host)).toBe("pro");
      expect(within(host).getByLabelText(/^Notes/)).toHaveValue("Preset note");
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(within(host).queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
    } finally {
      host.remove();
    }
  });

  it("starts with no subtype when the caller presets none", () => {
    const host = firstPaint({ initialType: "Widget" });
    try {
      expect(selectValue(/^Subtype/, host)).toBe("");
    } finally {
      host.remove();
    }
  });

  it("starts an EOL-eligible type idle: no search running, picker closed and unseeded", () => {
    const host = firstPaint({ initialType: "ITComponent" });
    try {
      expect(within(host).getByText("End-of-Life Tracking")).toBeInTheDocument();
      expect(within(host).queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
      const probe = within(host).getByTestId("eol-dialog");
      expect(probe).toHaveAttribute("data-open", "false");
      expect(probe).toHaveAttribute("data-product", "");
    } finally {
      host.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// Type picker and the Create gate
// ---------------------------------------------------------------------------

describe("CreateCardDialog — type picker and the Create gate", () => {
  it("keeps Create off until a type AND a non-blank name are given, and renders no stray fields", async () => {
    const { user } = renderDialog();
    expect(selectValue(/^Type/)).toBe("");
    expect(notchText(/^Type/)).toBe("Type");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(nameBox()).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(nameBox(), { target: { value: "Thing" } });
    expect(createButton()).toBeDisabled();

    await pickType(user, /Plain/);
    expect(selectValue(/^Type/)).toBe("Plain");
    // A type with no required fields adds no inputs.
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(createButton()).toBeEnabled();

    fireEvent.change(nameBox(), { target: { value: "   " } });
    expect(createButton()).toBeDisabled();
    fireEvent.change(nameBox(), { target: { value: "" } });
    expect(createButton()).toBeDisabled();
  });

  it("offers types added to the metamodel after the dialog mounted", async () => {
    withMetamodel([PLAIN], RELATION_TYPES);
    const { user, update } = renderDialog();
    await user.click(select(/^Type/));
    expect(await screen.findByRole("option", { name: /Plain/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Toolkit/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    withMetamodel([PLAIN, KIT], RELATION_TYPES);
    update({});
    await user.click(select(/^Type/));
    expect(await screen.findByRole("option", { name: /Toolkit/ })).toBeInTheDocument();
  });

  it("lets a role create a type its per-type cell allows, without a global grant", async () => {
    currentUser = makeUser({
      id: "00000000-0000-4000-8000-00000000c003",
      role: "member",
      permissions: { "inventory.view": true },
      type_permissions: { Plain: { "inventory.create": true } },
    });
    renderDialog({ initialType: "Plain" });
    fireEvent.change(nameBox(), { target: { value: "Allowed" } });
    expect(createButton()).toBeEnabled();
    // No explanation is attached to an enabled button.
    expect(createButton().parentElement?.getAttribute("aria-label") ?? "").toBe("");
  });

  it("refuses a type its per-type cell denies even with the global grant, and says why", () => {
    currentUser = makeUser({
      id: "00000000-0000-4000-8000-00000000c004",
      role: "member",
      permissions: { "inventory.view": true, "inventory.create": true },
      type_permissions: { Plain: { "inventory.create": false } },
    });
    renderDialog({ initialType: "Plain" });
    fireEvent.change(nameBox(), { target: { value: "Denied" } });
    expect(createButton()).toBeDisabled();
    expect(createButton().parentElement).toHaveAttribute(
      "aria-label",
      "You are not allowed to create cards of this type.",
    );
  });
});

// ---------------------------------------------------------------------------
// Subtypes
// ---------------------------------------------------------------------------

describe("CreateCardDialog — subtypes", () => {
  it("shows no subtype picker for a type whose subtype list is empty", () => {
    renderDialog({ initialType: "Gizmo" });
    expect(screen.queryByText(/^Subtype/, { selector: "label" })).not.toBeInTheDocument();
  });

  it("offers None and the type's subtypes, and hides only the fields the chosen subtype hides", async () => {
    const { user } = renderDialog({ initialType: "Widget" });
    expect(notchText(/^Subtype/)).toBe("Subtype");
    await user.click(select(/^Subtype/));
    expect(await screen.findByRole("option", { name: "None" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Pro" }));
    expect(selectValue(/^Subtype/)).toBe("pro");
    // "Pro" hides nothing; "Lite" hides Notes.
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toBeInTheDocument();
  });

  it("keeps a preset subtype while the metamodel is still loading", () => {
    withMetamodel([], RELATION_TYPES);
    const { update } = renderDialog({ initialType: "Widget", initialSubtype: "lite" });
    expect(nameBox()).toBeInTheDocument();

    withMetamodel(TYPES, RELATION_TYPES);
    update({ initialType: "Widget", initialSubtype: "lite" });
    expect(selectValue(/^Subtype/)).toBe("lite");
    expect(screen.queryByRole("textbox", { name: /^Notes/ })).not.toBeInTheDocument();
  });

  it("tolerates a preset subtype the type does not define", () => {
    renderDialog({ initialType: "Widget", initialSubtype: "ghost" });
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Required fields
// ---------------------------------------------------------------------------

describe("CreateCardDialog — required fields", () => {
  it("renders each preset value in its own kind of input", () => {
    renderDialog({
      initialType: "Widget",
      initialAttributes: { tier: "gold", golive: "2027-03-01", zones: ["us", 5, "eu"] },
    });
    expect(select(/^Tier/)).toHaveTextContent("Gold");
    const golive = screen.getByLabelText(/^Go-live/);
    expect(golive).toHaveAttribute("type", "date");
    expect(golive).toHaveValue("2027-03-01");
    expect(screen.getByRole("slider")).toBeInTheDocument();
    // Only the string keys become chips, in the stored order.
    const chips = Array.from(select(/^Zones/).querySelectorAll(".MuiChip-root")).map((c) => c.textContent);
    expect(chips).toEqual(["Americas", "Europe"]);
  });

  it("marks only coloured options with a dot, and leaves an emptied multi-select unset", async () => {
    const { user } = renderDialog({ initialType: "Widget" });
    expect(selectValue(/^Tier/)).toBe("");

    await user.click(select(/^Tier/));
    const gold = await screen.findByRole("option", { name: "Gold" });
    expect(gold.querySelector(":scope > div > div")).not.toBeNull();
    expect(screen.getByRole("option", { name: "Silver" }).querySelector(":scope > div > div")).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(select(/^Zones/));
    const europe = await screen.findByRole("option", { name: /Europe/ });
    expect(europe.querySelector(":scope > div > div")).not.toBeNull();
    expect(screen.getByRole("option", { name: /Americas/ }).querySelector(":scope > div > div")).toBeNull();
    await user.click(europe);
    await user.click(screen.getByRole("option", { name: /Europe/ }));
    await user.keyboard("{Escape}");

    fireEvent.change(nameBox(), { target: { value: "Emptied" } });
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].attributes).toEqual({ zones: undefined });
  });

  it("stores an autofilled multi-select value as a one-element list", async () => {
    const { user } = renderDialog({ initialType: "Widget" });
    const native = formControl(/^Zones/).querySelector("input.MuiSelect-nativeInput") as HTMLInputElement;
    fireEvent.change(native, { target: { value: "eu" } });
    fireEvent.change(nameBox(), { target: { value: "Autofilled" } });
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].attributes).toEqual({ zones: ["eu"] });
  });

  it("renders select fields that have no options yet", () => {
    renderDialog({ initialType: "Loose", initialAttributes: { labels: ["legacy"] } });
    expect(select(/^Choice/)).toBeInTheDocument();
    expect(select(/^Labels/).querySelectorAll(".MuiChip-root")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Type switch, close/reopen, and a prop change while open
// ---------------------------------------------------------------------------

describe("CreateCardDialog — what a type switch resets", () => {
  it("clears the presets, parent, subtype and tags when another type is picked", async () => {
    mockApi.on("get", "/tag-groups", [{ id: "g1", name: "Risk", mode: "multi", tags: [] }]);
    const { user } = renderDialog({
      initialType: "Widget",
      initialSubtype: "pro",
      initialAttributes: { notes: "Preset" },
    });
    await user.click(await screen.findByText("pick-tags"));
    await user.click(screen.getByText("pick-parent"));
    expect(screen.getByTestId("parent-picker")).toHaveAttribute("data-value", "parent-1");

    await pickType(user, /Gizmo/);
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toHaveValue("");
    expect(screen.getByTestId("parent-picker")).toHaveAttribute("data-value", "");

    fireEvent.change(nameBox(), { target: { value: "Thing" } });
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toEqual({
      type: "Gizmo",
      subtype: undefined,
      name: "Thing",
      description: undefined,
      parent_id: undefined,
      attributes: undefined,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", /\/tags$/)).toHaveLength(0);
  });

  it("drops an AI suggestion and a staged Provider when the type changes", async () => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    mockApi.on("post", "/ai/suggest", {
      suggestions: { description: { value: "A server.", confidence: 0.9 } },
      sources: [],
    });
    const { user } = renderDialog({ initialType: "ITComponent" });
    fireEvent.change(nameBox(), { target: { value: "Server" } });
    await user.click(screen.getByText("pick-provider"));
    await user.click(aiButton()!);
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();

    await pickType(user, /Application/);
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();

    await user.click(createButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
  });
});

describe("CreateCardDialog — closing and reopening", () => {
  it("comes back to the presets with everything the user did cleared", async () => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
    mockApi.on("get", "/tag-groups", [{ id: "g1", name: "Risk", mode: "multi", tags: [] }]);
    mockApi.on("post", "/ai/suggest", {
      suggestions: { description: { value: "Generated.", confidence: 0.9 } },
      sources: [],
    });
    const preset = { initialType: "Widget", initialSubtype: "pro", initialAttributes: { notes: "Preset" } };
    const { user, update } = renderDialog(preset);

    await user.click(select(/^Subtype/));
    await user.click(await screen.findByRole("option", { name: "None" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Notes/ }), { target: { value: "Edited" } });
    await user.click(screen.getByText("pick-parent"));
    await user.click(await screen.findByText("pick-tags"));
    fireEvent.change(nameBox(), { target: { value: "Thing" } });
    fireEvent.change(descriptionBox(), { target: { value: "Desc" } });
    await user.click(aiButton()!);
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    onCreate.mockImplementationOnce(() =>
      Promise.reject(
        new ApiError("conflict", 409, {
          code: "sibling_name_conflict",
          existing_card_id: "dup-1",
          existing_card_name: "Thing",
          type_key: "Widget",
        }),
      ),
    );
    await user.click(createButton());
    expect(await screen.findByRole("link", { name: "View existing card" })).toBeInTheDocument();

    update({ ...preset, open: false });
    update({ ...preset, open: true });

    expect(selectValue(/^Subtype/)).toBe("pro");
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toHaveValue("Preset");
    expect(nameBox()).toHaveValue("");
    expect(nameBox()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("link", { name: "View existing card" })).not.toBeInTheDocument();
    expect(descriptionBox()).toHaveValue("");
    expect(screen.getByTestId("parent-picker")).toHaveAttribute("data-value", "");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(eolProps()).toHaveAttribute("data-open", "false");
    expect(eolProps()).toHaveAttribute("data-product", "");
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("Generating description...")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();

    fireEvent.change(nameBox(), { target: { value: "Again" } });
    expect(createButton()).toBeEnabled();
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(onCreate.mock.calls[1][0]).toEqual({
      type: "Widget",
      subtype: "pro",
      name: "Again",
      description: undefined,
      parent_id: undefined,
      attributes: { notes: "Preset" },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", /\/tags$/)).toHaveLength(0);
  });

  it("forgets a picked subtype and a staged Provider when there was no preset", async () => {
    const { user, update } = renderDialog({ initialType: "ITComponent" });
    await user.click(select(/^Subtype/));
    await user.click(await screen.findByRole("option", { name: "SaaS" }));
    await user.click(screen.getByText("pick-provider"));

    update({ initialType: "ITComponent", open: false });
    update({ initialType: "ITComponent", open: true });

    fireEvent.change(nameBox(), { target: { value: "Python" } });
    // No search has run for this name yet, so nothing claims it found no match.
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].subtype).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
  });

  it("returns to no type when it was opened without one", async () => {
    const { user, update } = renderDialog();
    await pickType(user, /Plain/);
    update({ open: false });
    update({ open: true });
    expect(selectValue(/^Type/)).toBe("");
    fireEvent.change(nameBox(), { target: { value: "Thing" } });
    expect(createButton()).toBeDisabled();
  });

  it("follows a new initial type while open without wiping what was typed", () => {
    const { update } = renderDialog({ initialType: "Widget" });
    fireEvent.change(nameBox(), { target: { value: "Keep" } });
    update({ initialType: "Gizmo" });
    expect(selectValue(/^Type/)).toBe("Gizmo");
    expect(nameBox()).toHaveValue("Keep");
  });

  it("keeps what was typed on screen while the dialog fades out", async () => {
    const preset = { initialType: "Widget", initialAttributes: { notes: "Preset" } };
    const { update } = renderDialog(preset);
    fireEvent.change(nameBox(), { target: { value: "Thing" } });
    fireEvent.change(descriptionBox(), { target: { value: "Desc" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Notes/ }), { target: { value: "Edited" } });

    update({ ...preset, open: false });
    // Still mounted for the exit transition, and still showing the form as
    // the user left it rather than a blanked one.
    expect(screen.getByDisplayValue("Thing")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Desc")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Edited")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByDisplayValue("Thing")).not.toBeInTheDocument());

    update({ ...preset, open: true });
    expect(nameBox()).toHaveValue("");
    expect(descriptionBox()).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /^Notes/ })).toHaveValue("Preset");
  });

  it("opens on the initial type the caller holds when it opens, even one changed while closed", () => {
    const { update } = renderDialog({ initialType: "Widget" });
    update({ initialType: "Widget", open: false });
    update({ open: false });
    update({ open: true });
    expect(selectValue(/^Type/)).toBe("");

    update({ open: false });
    update({ initialType: "Gizmo", open: false });
    update({ initialType: "Gizmo", open: true });
    expect(selectValue(/^Type/)).toBe("Gizmo");
  });

  it("says when the tag groups could not be loaded instead of dropping the picker", async () => {
    mockApi.fail("get", "/tag-groups", 500);
    renderDialog({ initialType: "Widget" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tags could not be loaded: GET /tag-groups failed",
    );
    expect(screen.queryByText("pick-tags")).not.toBeInTheDocument();
  });

  it("keeps the tag picker and says so when reloading the groups fails on reopen", async () => {
    mockApi.on("get", "/tag-groups", [{ id: "g1", name: "Risk", mode: "multi", tags: [] }]);
    const { update } = renderDialog({ initialType: "Widget" });
    expect(await screen.findByText("pick-tags")).toBeInTheDocument();

    mockApi.reset();
    mockApi.fail("get", "/tag-groups", 503);
    update({ initialType: "Widget", open: false });
    update({ initialType: "Widget", open: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tags could not be loaded: GET /tag-groups failed",
    );
    expect(screen.getByText("pick-tags")).toBeInTheDocument();

    // A successful reload clears the warning.
    mockApi.reset();
    mockApi.on("get", "/tag-groups", [{ id: "g1", name: "Risk", mode: "multi", tags: [] }]);
    update({ initialType: "Widget", open: false });
    update({ initialType: "Widget", open: true });
    await waitFor(() => expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("pick-tags")).toBeInTheDocument();
  });

  it("uses a generic reason when the tag groups fail with something that is not an Error", async () => {
    mockApi.on("get", "/tag-groups", () => Promise.reject("nope"));
    renderDialog({ initialType: "Widget" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tags could not be loaded: Something went wrong",
    );
  });

  it("loads tag groups only while open, and again on every reopen", () => {
    const { update } = renderDialog({ open: false });
    expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(0);
    update({ open: true });
    expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(1);
    update({ open: false });
    update({ open: true });
    expect(mockApi.callsOf("get", "/tag-groups")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

describe("CreateCardDialog — submitting", () => {
  it("sends the trimmed name and posts no tags or relation that were not picked", async () => {
    const { user } = renderDialog({ initialType: "ITComponent" });
    fireEvent.change(nameBox(), { target: { value: "  Gadget  " } });
    await user.click(createButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].name).toBe("Gadget");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/cards/new-id"));
    expect(mockApi.callsOf("post", /\/tags$/)).toHaveLength(0);
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
  });

  it("sends the picked parent", async () => {
    const { user } = renderDialog({ initialType: "Gizmo" });
    await user.click(screen.getByText("pick-parent"));
    fireEvent.change(nameBox(), { target: { value: "Child" } });
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].parent_id).toBe("parent-1");
  });

  it("shows the staged Provider in the vendor field", async () => {
    const { user } = renderDialog({ initialType: "ITComponent" });
    expect(screen.getByTestId("vendor")).toHaveAttribute("data-value", "");
    await user.click(screen.getByText("pick-provider"));
    expect(screen.getByTestId("vendor")).toHaveAttribute("data-value", "Acme");
  });

  it("links the Provider through the lowest-sort type that really connects the two", async () => {
    const { user } = renderDialog({ initialType: "ITComponent" });
    await user.click(screen.getByText("pick-provider"));
    fireEvent.change(nameBox(), { target: { value: "Server" } });
    await user.click(createButton());
    await waitFor(() => expect(mockApi.callsOf("post", "/relations")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/relations")[0].body).toEqual({
      type: "relZITCToProvider",
      source_id: "new-id",
      target_id: "prov-1",
    });
  });

  it("still creates and closes when no relation type connects the Provider", async () => {
    withMetamodel(TYPES, []);
    const { user } = renderDialog({ initialType: "Application" });
    await user.click(screen.getByText("pick-provider"));
    fireEvent.change(nameBox(), { target: { value: "Portal" } });
    await user.click(createButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockApi.callsOf("post", "/relations")).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/cards/new-id"));
  });

  it("disables Create while saving, clears the last error, and recovers after each failure", async () => {
    const { user } = renderDialog({ initialType: "Plain" });
    fireEvent.change(nameBox(), { target: { value: "Thing" } });

    onCreate.mockImplementationOnce(() => Promise.reject(new ApiError("Server exploded", 500, "x")));
    await user.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
    expect(nameBox()).toHaveAttribute("aria-invalid", "false");
    await waitFor(() => expect(createButton()).toBeEnabled());

    const pending = deferred<string>();
    onCreate.mockImplementationOnce(() => pending.promise);
    await user.click(createButton());
    await waitFor(() => expect(createButton()).toBeDisabled());
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      pending.reject(
        new ApiError("conflict", 409, {
          code: "sibling_name_conflict",
          existing_card_id: "dup-1",
          existing_card_name: "Thing",
          type_key: "Plain",
        }),
      );
    });
    expect(await screen.findByRole("link", { name: "View existing card" })).toBeInTheDocument();
    await waitFor(() => expect(createButton()).toBeEnabled());

    onCreate.mockImplementationOnce(() => Promise.reject(new Error("Again")));
    await user.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Again");
    expect(nameBox()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("link", { name: "View existing card" })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A name collision (HTTP 409)
// ---------------------------------------------------------------------------

describe("CreateCardDialog — name collisions", () => {
  async function submitRejecting(err: unknown) {
    onCreate.mockImplementationOnce(() => Promise.reject(err));
    const r = renderDialog({ initialType: "Plain" });
    fireEvent.change(nameBox(), { target: { value: "Dup" } });
    await r.user.click(createButton());
    return r;
  }

  it("names the existing card's type by its label and links to it in-app", async () => {
    await submitRejecting(
      new ApiError("conflict", 409, {
        code: "sibling_name_conflict",
        existing_card_id: "dup-1",
        existing_card_name: "Dup",
        type_key: "Kit",
      }),
    );
    const link = await screen.findByRole("link", { name: "View existing card" });
    expect(nameBox()).toHaveAttribute("aria-invalid", "true");
    expect(helperTextOf(nameBox())).toHaveTextContent(
      'A card of type Toolkit named "Dup" already exists at this level. View existing card',
    );
    // The in-app navigation replaces the browser's.
    expect(fireEvent.click(link)).toBe(false);
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/cards/dup-1"));
  });

  it("shows a plain-string detail as it came", async () => {
    await submitRejecting(new ApiError("Conflict", 409, "Name taken here"));
    await waitFor(() => expect(helperTextOf(nameBox())).toHaveTextContent("Name taken here"));
    expect(nameBox()).toHaveAttribute("aria-invalid", "true");
  });

  it("falls back to the error message when the 409 carries no detail", async () => {
    await submitRejecting(new ApiError("Name already used", 409, null));
    await waitFor(() => expect(helperTextOf(nameBox())).toHaveTextContent("Name already used"));
  });

  it("does not read an unrelated structured 409 as a sibling-name conflict", async () => {
    await submitRejecting(new ApiError("Raw message", 409, { code: "other", message: "Detail message" }));
    await waitFor(() => expect(helperTextOf(nameBox())).toHaveTextContent("Raw message"));
    expect(screen.queryByText("Detail message")).not.toBeInTheDocument();
  });

  it("uses the conflict's own message when it names no existing card", async () => {
    await submitRejecting(
      new ApiError("Raw", 409, { code: "sibling_name_conflict", message: "Detail prose" }),
    );
    await waitFor(() => expect(helperTextOf(nameBox())).toHaveTextContent("Detail prose"));
  });
});

// ---------------------------------------------------------------------------
// AI suggestions
// ---------------------------------------------------------------------------

describe("CreateCardDialog — AI suggestions", () => {
  beforeEach(() => {
    ai.status = { enabled: true, configured: true, enabled_types: [], running_models: [] };
  });

  const suggestButton = aiButton;

  it("names the button by its visible label and keeps the tooltip as its description", async () => {
    const { user } = renderDialog({ initialType: "Widget" });
    fireEvent.change(nameBox(), { target: { value: "Gadget" } });
    const button = screen.getByRole("button", { name: /Suggest with AI/ });
    expect(button).not.toHaveAccessibleName(/Use AI to suggest/);
    await user.hover(button);
    await waitFor(() =>
      expect(button).toHaveAccessibleDescription("Use AI to suggest a description for this card"),
    );
  });

  it("offers the button from two trimmed characters on", () => {
    renderDialog({ initialType: "Widget" });
    fireEvent.change(nameBox(), { target: { value: "Go" } });
    expect(suggestButton()).toHaveTextContent("Suggest with AI");
    fireEvent.change(nameBox(), { target: { value: " S" } });
    expect(suggestButton()).not.toBeInTheDocument();
  });

  it("shows progress, sends the trimmed name, and dismisses the result", async () => {
    const reply = deferred<unknown>();
    mockApi.on("post", "/ai/suggest", () => reply.promise);
    const { user } = renderDialog({ initialType: "Widget" });
    fireEvent.change(nameBox(), { target: { value: "  Salesforce  " } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/ai/suggest")[0].body).toEqual({
      type_key: "Widget",
      subtype: undefined,
      name: "Salesforce",
    });

    await act(async () => {
      reply.resolve({ suggestions: { description: { value: "A CRM.", confidence: 0.9 } }, sources: [] });
    });
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
    expect(suggestButton()).toBeInTheDocument();
  });

  it("keeps the typed description when only field values are applied", async () => {
    mockApi.on("post", "/ai/suggest", {
      suggestions: { shared: { value: true, confidence: 0.8 } },
      sources: [],
    });
    const { user } = renderDialog({ initialType: "Widget" });
    fireEvent.change(descriptionBox(), { target: { value: "Keep me" } });
    fireEvent.change(nameBox(), { target: { value: "Gadget" } });
    await user.click(suggestButton()!);
    await user.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    await user.click(createButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ description: "Keep me", attributes: { shared: true } });
  });

  it("shows the AI panel while the metamodel is still loading", async () => {
    withMetamodel([], RELATION_TYPES);
    mockApi.on("post", "/ai/suggest", () => new Promise(() => undefined));
    const { user } = renderDialog({ initialType: "Widget" });
    fireEvent.change(nameBox(), { target: { value: "Gadget" } });
    await user.click(suggestButton()!);
    expect(await screen.findByText("Generating description...")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// End-of-life auto-search (fake timers: the name debounce is 600ms)
// ---------------------------------------------------------------------------

describe("CreateCardDialog — end-of-life auto-search", () => {
  /** Replies to the fuzzy search per search term, when the test says so. */
  let replies: Map<string, Deferred<unknown>>;
  const reply = (term: string) => {
    let d = replies.get(term);
    if (!d) {
      d = deferred<unknown>();
      replies.set(term, d);
    }
    return d;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    replies = new Map();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function deferFuzzy() {
    mockApi.on("get", /^\/eol\/products\/fuzzy/, (path: string) => {
      const term = new URLSearchParams(path.split("?")[1]).get("search") ?? "";
      return reply(term).promise;
    });
  }
  const typeName = (value: string) => fireEvent.change(nameBox(), { target: { value } });
  // Testing Library's async queries drain through setTimeout, which is fake
  // here; a real setImmediate turn lets every pending promise settle instead.
  const flush = () =>
    act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  const debounce = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await flush();
  };
  const settle = async (term: string, value: unknown) => {
    await act(async () => {
      reply(term).resolve(value);
    });
    await flush();
  };

  it("searches the trimmed name, shows progress, then offers matches to link", async () => {
    deferFuzzy();
    renderDialog({ initialType: "ITComponent" });
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(eolProps()).toHaveAttribute("data-open", "false");
    expect(eolProps()).toHaveAttribute("data-card-name", "<none>");

    typeName("  Python  ");
    // Nothing has been searched for this name yet.
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(eolProps()).toHaveAttribute("data-card-name", "Python");

    await debounce();
    expect(screen.getByText('Searching endoflife.date for "Python"...')).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Python")]);
    expect(mockApi.api.get).toHaveBeenCalledWith(fuzzyPath("Python"), {
      signal: expect.any(AbortSignal),
    });

    await settle("Python", [
      { name: "python", score: 0.92 },
      { name: "pypy", score: 0.4 },
    ]);
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByText("Suggested matches from endoflife.date:")).toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();

    // Picking a match opens the picker on it; nothing is linked until a cycle is chosen.
    fireEvent.click(screen.getByText("python"));
    expect(eolProps()).toHaveAttribute("data-open", "true");
    expect(eolProps()).toHaveAttribute("data-product", "python");
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("eol-close"));

    // A half-picked product does not stop the search for a new name.
    typeName("Node");
    await debounce();
    expect(fuzzyCalls()).toContain(fuzzyPath("Node"));
    await settle("Node", [{ name: "nodejs", score: 0.8 }]);
    expect(screen.getByText("nodejs")).toBeInTheDocument();

    // ...and is not submitted without its cycle.
    fireEvent.click(createButton());
    await flush();
    expect(onCreate).toHaveBeenCalled();
    expect(onCreate.mock.calls[0][0].attributes).toBeUndefined();
  });

  it("stops searching once linked, and lets the link be changed or removed", async () => {
    renderDialog({ initialType: "ITComponent" });
    fireEvent.click(screen.getByRole("button", { name: "Manual Search" }));
    fireEvent.click(screen.getByText("eol-link"));
    expect(screen.getByText(/Linked to/)).toHaveTextContent("Linked to nodejs 22");
    expect(eolProps()).toHaveAttribute("data-open", "false");

    typeName("Node");
    await debounce();
    expect(fuzzyCalls()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(eolProps()).toHaveAttribute("data-open", "true");
    fireEvent.click(screen.getByText("eol-close"));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
    expect(eolProps()).toHaveAttribute("data-product", "");
  });

  it("needs two characters to search, and says so only for the name it searched", async () => {
    renderDialog({ initialType: "ITComponent" });
    typeName("a");
    await debounce();
    expect(fuzzyCalls()).toEqual([]);

    typeName("Go");
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Go")]);
    expect(screen.getByText(/No EOL matches found/)).toBeInTheDocument();
    expect(screen.queryByText("Suggested matches from endoflife.date:")).not.toBeInTheDocument();

    typeName(" P");
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
  });

  it("does not search again when a suggested match is picked", async () => {
    deferFuzzy();
    renderDialog({ initialType: "ITComponent" });
    typeName("Python");
    await debounce();
    await settle("Python", [{ name: "python", score: 0.92 }]);
    expect(fuzzyCalls()).toEqual([fuzzyPath("Python")]);

    fireEvent.click(screen.getByText("python"));
    await flush();
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Python")]);
    // The picker opened on the match, and the matches are still offered.
    expect(eolProps()).toHaveAttribute("data-product", "python");
    fireEvent.click(screen.getByText("eol-close"));
    expect(screen.getByText("python")).toBeInTheDocument();
  });

  it("does not claim a name has no match before that name was searched", async () => {
    renderDialog({ initialType: "ITComponent" });
    typeName("Go");
    await debounce();
    expect(screen.getByText(/No EOL matches found/)).toBeInTheDocument();

    // The verdict was about "Go"; "Gox" is still waiting for its own search.
    typeName("Gox");
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Go"), fuzzyPath("Gox")]);
    expect(screen.getByText(/No EOL matches found/)).toBeInTheDocument();
  });

  it("does not search the previous name again when closed and reopened", async () => {
    const { update } = renderDialog({ initialType: "ITComponent" });
    typeName("Node");
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Node")]);
    fireEvent.click(screen.getByRole("button", { name: "Manual Search" }));
    fireEvent.click(screen.getByText("eol-link"));
    expect(screen.getByText(/Linked to/)).toBeInTheDocument();

    update({ initialType: "ITComponent", open: false });
    await flush();
    update({ initialType: "ITComponent", open: true });
    await flush();
    expect(nameBox()).toHaveValue("");
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();

    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Node")]);
    typeName("Python");
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Node"), fuzzyPath("Python")]);
  });

  it("drops a search still running when the dialog is closed and reopened", async () => {
    deferFuzzy();
    const { update } = renderDialog({ initialType: "ITComponent" });
    typeName("Node");
    await debounce();
    expect(screen.getByText('Searching endoflife.date for "Node"...')).toBeInTheDocument();

    update({ initialType: "ITComponent", open: false });
    update({ initialType: "ITComponent", open: true });
    await flush();
    expect(nameBox()).toHaveValue("");
    expect(screen.queryByText(/Searching endoflife\.date/)).not.toBeInTheDocument();

    // The old session's answer arriving late does not land in the new form.
    await settle("Node", [{ name: "nodejs", score: 0.9 }]);
    expect(screen.queryByText("nodejs")).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
  });

  it("never searches for a type that does not track end of life", async () => {
    renderDialog({ initialType: "Widget" });
    typeName("Python");
    await debounce();
    expect(fuzzyCalls()).toEqual([]);
  });

  it("lets only the latest search write its results", async () => {
    deferFuzzy();
    renderDialog({ initialType: "ITComponent" });
    typeName("Py");
    await debounce();
    typeName("Pyth");
    await debounce();
    // An older search finishing does not end the current one.
    await settle("Py", [{ name: "pygame", score: 0.9 }]);
    expect(screen.getByText('Searching endoflife.date for "Pyth"...')).toBeInTheDocument();

    typeName("Python");
    await debounce();
    await settle("Python", [{ name: "python", score: 0.9 }]);
    expect(screen.getByText("python")).toBeInTheDocument();
    // A superseded search landing late changes nothing.
    await settle("Pyth", [{ name: "pytorch", score: 0.9 }]);
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.queryByText("pytorch")).not.toBeInTheDocument();
    expect(screen.queryByText("pygame")).not.toBeInTheDocument();

    // While a new search runs, the previous matches are not offered.
    typeName("Pythons");
    await debounce();
    expect(screen.queryByText("python")).not.toBeInTheDocument();
    typeName("Python3");
    await debounce();
    await settle("Python3", [{ name: "python", score: 0.9 }]);
    expect(screen.getByText("python")).toBeInTheDocument();
    // A superseded search failing late changes nothing either.
    await act(async () => {
      reply("Pythons").reject(new Error("late"));
    });
    await flush();
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
  });

  it("drops the matches when the type changes", async () => {
    mockApi.on("get", /^\/eol\/products\/fuzzy/, [{ name: "python", score: 0.9 }]);
    const { update } = renderDialog({ initialType: "ITComponent" });
    typeName("Python");
    await debounce();
    expect(screen.getByText("python")).toBeInTheDocument();

    update({ initialType: "Application" });
    expect(selectValue(/^Type/)).toBe("Application");
    expect(screen.queryByText("python")).not.toBeInTheDocument();
    expect(screen.queryByText(/No EOL matches found/)).not.toBeInTheDocument();
  });

  it("shows no search error before a search or after one that finds matches", async () => {
    renderDialog({ initialType: "ITComponent" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    mockApi.on("get", /^\/eol\/products\/fuzzy/, [{ name: "python", score: 0.9 }]);
    typeName("Python");
    await debounce();
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed search's error, spaced, for a name typed with surrounding spaces", async () => {
    mockApi.on("get", /^\/eol\/products\/fuzzy/, () =>
      Promise.reject(new Error("endoflife.date unreachable")),
    );
    renderDialog({ initialType: "ITComponent" });
    typeName("  Python  ");
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Python")]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("endoflife.date unreachable");
  });

  it("says a name typed with surrounding spaces has no match", async () => {
    renderDialog({ initialType: "ITComponent" });
    typeName(" Go ");
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Go")]);
    expect(screen.getByText(/No EOL matches found/)).toBeInTheDocument();
  });

  it("does not show an earlier failure while a search for the same name runs", async () => {
    deferFuzzy();
    renderDialog({ initialType: "ITComponent" });
    typeName("Python");
    await debounce();
    await act(async () => {
      reply("Python").reject(new Error("endoflife.date unreachable"));
    });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("endoflife.date unreachable");

    // Another name starts a search; going back to the failed name while it
    // runs must not bring the old error back over the running search.
    typeName("Pythons");
    await debounce();
    typeName("Python");
    expect(screen.getByText('Searching endoflife.date for "Python"...')).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not search while the dialog is closed", async () => {
    const { update } = renderDialog({ initialType: "ITComponent" });
    typeName("Node");
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Node")]);

    update({ initialType: "ITComponent", open: false });
    await flush();
    await debounce();
    expect(fuzzyCalls()).toEqual([fuzzyPath("Node")]);
  });
});

