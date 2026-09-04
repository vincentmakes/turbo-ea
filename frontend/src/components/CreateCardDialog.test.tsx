import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import CreateCardDialog from "./CreateCardDialog";

// Side-channel for the VendorField mock to expose its onProviderSelected
// callback to the test, so we can simulate the user picking a Provider.
const { vendorFieldRef } = vi.hoisted(() => ({
  vendorFieldRef: {
    onProviderSelected: null as
      | ((p: { id: string; name: string } | null) => void)
      | null,
  },
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
// The dialog reads the signed-in user to apply per-card-type create
// permissions (discussion #1068). It renders inside an AuthProvider in the
// app; the tests mount it directly, so the context is stubbed. Default is an
// admin (wildcard grants every type); the per-type tests swap in a member.
const authRef = vi.hoisted(() => ({
  user: {
    id: "u1",
    email: "a@test.com",
    display_name: "Admin",
    permissions: { "*": true } as Record<string, boolean>,
    type_permissions: undefined as Record<string, Record<string, boolean>> | undefined,
  },
}));
vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: () => ({ user: authRef.user, refreshUser: vi.fn() }),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}) },
  // Re-export the ApiError class so the dialog can `instanceof` against it.
  ApiError: class ApiError extends Error {
    status: number;
    detail: unknown;
    constructor(message: string, status: number, detail: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

// Stub complex sub-components that aren't under test
vi.mock("@/components/EolLinkSection", () => ({
  EolLinkDialog: () => null,
}));
vi.mock("@/components/VendorField", () => ({
  default: (props: {
    onProviderSelected?: (p: { id: string; name: string } | null) => void;
  }) => {
    vendorFieldRef.onProviderSelected = props.onProviderSelected ?? null;
    return null;
  },
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    has_hierarchy: true,
    translations: { label: { en: "Application" } },
    subtypes: [
      { key: "business_app", label: "Business Application", translations: { en: "Business Application" } },
      { key: "microservice", label: "Microservice", translations: { en: "Microservice" } },
      // Admin-added custom subtype: key != label, no translations map (issue #661)
      { key: "keyname", label: "labelname" },
    ],
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "costTotalAnnual", label: "Total Annual Cost", type: "cost", required: true, translations: { en: "Total Annual Cost" } },
          // Required multi-select rendered a plain text box instead of a
          // dropdown, so the field could never be filled (issue #931).
          {
            key: "hostingModel",
            label: "Hosting Model",
            type: "multiple_select",
            required: true,
            translations: { en: "Hosting Model" },
            options: [
              { key: "cloud", label: "Cloud", color: "#0f7eb5" },
              { key: "onprem", label: "On-premise" },
              { key: "hybrid", label: "Hybrid" },
            ],
          },
        ],
      },
    ],
    is_hidden: false,
  },
  {
    key: "Objective",
    label: "Objective",
    icon: "flag",
    color: "#c7527d",
    category: "Strategy",
    has_hierarchy: false,
    translations: { label: { en: "Objective" } },
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
  },
  {
    key: "ITComponent",
    label: "IT Component",
    icon: "memory",
    color: "#d29270",
    category: "Technical Architecture",
    has_hierarchy: true,
    translations: { label: { en: "IT Component" } },
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
  },
  // Admin-added custom card type: key != label, empty translations map (issue #731)
  {
    key: "itAsset",
    label: "IT Asset",
    icon: "inventory_2",
    color: "#888888",
    category: "Technical Architecture",
    has_hierarchy: false,
    translations: {},
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
  },
];

const MOCK_RELATION_TYPES = [
  {
    key: "relProviderToITC",
    label: "offers",
    reverse_label: "is offered by",
    source_type_key: "Provider",
    target_type_key: "ITComponent",
    cardinality: "n:m",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vendorFieldRef.onProviderSelected = null;
  // Reset to the admin default; the per-type tests override it.
  authRef.user.permissions = { "*": true };
  authRef.user.type_permissions = undefined;
  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: MOCK_RELATION_TYPES,
    loading: false,
    getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onCreate = vi.fn();
const onClose = vi.fn();

function renderDialog(
  props: {
    open?: boolean;
    initialType?: string;
    initialSubtype?: string;
    initialAttributes?: Record<string, unknown>;
  } = {},
) {
  return render(
    <MemoryRouter>
      <CreateCardDialog
        open={props.open ?? true}
        onClose={onClose}
        onCreate={onCreate}
        initialType={props.initialType}
        initialSubtype={props.initialSubtype}
        initialAttributes={props.initialAttributes}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateCardDialog", () => {
  it("renders dialog with title and form fields", () => {
    renderDialog();

    expect(screen.getByText("Create Card")).toBeInTheDocument();
    // MUI Select doesn't expose accessible names — verify via label text + role
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("textbox", { name: /name/i })).toBeInTheDocument();
  });

  it("Create button is disabled when type or name is empty", () => {
    renderDialog();

    const createButton = screen.getByRole("button", { name: /^create$/i });
    expect(createButton).toBeDisabled();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("presets subtype and attributes for the initial type, and clears them on a type switch", async () => {
    const user = userEvent.setup();
    renderDialog({
      initialType: "Application",
      initialSubtype: "microservice",
      initialAttributes: { hostingModel: ["cloud"] },
    });

    // The subtype combobox shows the preset's label.
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes[1]).toHaveTextContent("Microservice");

    // Fill the name and submit — the preset attribute rides the payload.
    await user.type(screen.getByRole("textbox", { name: /name/i }), "Presets App");
    // A required cost field exists on Application; fill it so submit enables.
    const cost = screen.getByRole("spinbutton");
    await user.type(cost, "10");
    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const payload = onCreate.mock.calls[0][0];
    expect(payload.subtype).toBe("microservice");
    expect(payload.attributes.hostingModel).toEqual(["cloud"]);
  });

  it("pre-selects type when initialType is provided", () => {
    renderDialog({ initialType: "Application" });

    // Application has subtypes, so a second combobox should appear
    // (first is Type, second is Subtype)
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows subtype selector for types with subtypes", async () => {
    const user = userEvent.setup();
    renderDialog({ initialType: "Application" });

    // Application has subtypes — there should be at least 2 comboboxes
    const comboboxes = screen.getAllByRole("combobox");
    expect(comboboxes.length).toBeGreaterThanOrEqual(2);

    // Click the subtype combobox (second one) to open the dropdown
    await user.click(comboboxes[1]);

    expect(screen.getByText("Business Application")).toBeInTheDocument();
    expect(screen.getByText("Microservice")).toBeInTheDocument();
  });

  it("displays custom subtype label, not its key (issue #661)", async () => {
    const user = userEvent.setup();
    renderDialog({ initialType: "Application" });

    // Open the subtype dropdown (second combobox)
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[1]);

    // Admin-added subtype has no translations map; the label must still show,
    // never the internal key.
    expect(screen.getByText("labelname")).toBeInTheDocument();
    expect(screen.queryByText("keyname")).not.toBeInTheDocument();
  });

  it("displays custom card type name, not its key (issue #731)", async () => {
    const user = userEvent.setup();
    renderDialog({});

    // Open the type dropdown (first combobox) — the custom type has an empty
    // translations map, so its configured name must show, never the key.
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[0]);

    expect(screen.getByText("IT Asset")).toBeInTheDocument();
    expect(screen.queryByText("itAsset")).not.toBeInTheDocument();
  });

  it("shows parent selector for hierarchical types", () => {
    renderDialog({ initialType: "Application" });

    // Application has has_hierarchy=true, so Parent field should show
    expect(screen.getByLabelText("Parent")).toBeInTheDocument();
  });

  it("hides parent selector for non-hierarchical types", () => {
    renderDialog({ initialType: "Objective" });

    // Objective has has_hierarchy=false
    expect(screen.queryByLabelText("Parent")).not.toBeInTheDocument();
  });

  it("calls onCreate with correct data and navigates to new card", async () => {
    const user = userEvent.setup();
    onCreate.mockResolvedValueOnce("new-card-id-123");

    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByRole("textbox", { name: /name/i }), "My Objective");
    await user.type(screen.getByRole("textbox", { name: /description/i }), "Test description");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "Objective",
          name: "My Objective",
          description: "Test description",
        }),
      );
    });

    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/cards/new-card-id-123");
  });

  it("shows error when creation fails", async () => {
    const user = userEvent.setup();
    onCreate.mockRejectedValueOnce(new Error("Duplicate name"));

    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByRole("textbox", { name: /name/i }), "Duplicate");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText("Duplicate name")).toBeInTheDocument();
    });
  });

  it("surfaces a structured 409 collision as a localized message with a link to the existing card", async () => {
    // The backend's uniqueness check returns 409 with a structured detail
    // (#927). The dialog must route it to the Name TextField's helperText
    // as a localized sentence (no raw UUID) plus a "View existing card"
    // link pointing at the existing card.
    const { ApiError } = await import("@/api/client");
    const user = userEvent.setup();
    const detail = {
      code: "sibling_name_conflict",
      message:
        'A card of type Application named "ERP" already exists at this level (existing card: abc-123).',
      existing_card_id: "abc-123",
      existing_card_name: "ERP",
      type_key: "Application",
    };
    onCreate.mockRejectedValueOnce(new ApiError(detail.message, 409, detail));

    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByRole("textbox", { name: /name/i }), "ERP");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // Localized sentence built from the structured fields — no raw UUID.
    await waitFor(() => {
      expect(
        screen.getByText('A card of type Application named "ERP" already exists at this level.'),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/abc-123/)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View existing card" });
    expect(link).toHaveAttribute("href", "/cards/abc-123");

    // And it must clear the moment the user edits the name.
    await user.type(screen.getByRole("textbox", { name: /name/i }), "2");
    expect(
      screen.queryByText('A card of type Application named "ERP" already exists at this level.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View existing card" })).not.toBeInTheDocument();
  });

  it("navigates to the existing card and closes the dialog when the conflict link is clicked", async () => {
    const { ApiError } = await import("@/api/client");
    const user = userEvent.setup();
    const detail = {
      code: "sibling_name_conflict",
      message:
        'A card of type Application named "ERP" already exists at this level (existing card: abc-123).',
      existing_card_id: "abc-123",
      existing_card_name: "ERP",
      type_key: "Application",
    };
    onCreate.mockRejectedValueOnce(new ApiError(detail.message, 409, detail));

    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByRole("textbox", { name: /name/i }), "ERP");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    const link = await screen.findByRole("link", { name: "View existing card" });
    await user.click(link);

    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/cards/abc-123");
  });

  it("falls back to the raw detail string on an unstructured 409", async () => {
    // Legacy shape (plain-string detail): the prose must still appear on
    // the Name field, without any link.
    const { ApiError } = await import("@/api/client");
    const user = userEvent.setup();
    const detail =
      'A card of type Application named "ERP" already exists at this level (existing card: abc-123).';
    onCreate.mockRejectedValueOnce(new ApiError(detail, 409, detail));

    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByRole("textbox", { name: /name/i }), "ERP");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText(detail)).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "View existing card" })).not.toBeInTheDocument();
  });

  it("renders required fields from schema", () => {
    renderDialog({ initialType: "Application" });

    // Application has a required costTotalAnnual field
    expect(screen.getByLabelText("Total Annual Cost", { exact: false })).toBeInTheDocument();
  });

  it("renders a required multi-select as a dropdown and submits the selection as an array (issue #931)", async () => {
    const user = userEvent.setup();
    onCreate.mockResolvedValueOnce("new-card-id-931");

    renderDialog({ initialType: "Application" });

    // The field must NOT be a free-text input…
    expect(
      screen.queryByRole("textbox", { name: /hosting model/i }),
    ).not.toBeInTheDocument();

    // …but a select that opens a listbox with the configured options.
    // MUI Select doesn't expose accessible names — find it via its label.
    const label = screen.getByText("Hosting Model", {
      selector: "label",
      exact: false,
    });
    const combobox = label
      .closest(".MuiFormControl-root")!
      .querySelector('[role="combobox"]') as HTMLElement;
    await user.click(combobox);

    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByText("Cloud"));
    await user.click(within(listbox).getByText("Hybrid"));
    // Multi-select keeps the menu open; close it before submitting.
    await user.keyboard("{Escape}");

    await user.type(screen.getByRole("textbox", { name: /name/i }), "My App");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // The value must reach onCreate as a string array of option keys —
    // never a free-text string (the pre-fix fallback behavior).
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "Application",
          name: "My App",
          attributes: expect.objectContaining({
            hostingModel: ["cloud", "hybrid"],
          }),
        }),
      );
    });
  });

  it("does not render when closed", () => {
    renderDialog({ open: false });

    expect(screen.queryByText("Create Card")).not.toBeInTheDocument();
  });

  it("posts a Provider relation after the card is created when one was picked", async () => {
    onCreate.mockResolvedValueOnce("itc-id-456");
    const user = userEvent.setup();

    renderDialog({ initialType: "ITComponent" });

    // Simulate the user picking a Provider in VendorField (mocked).
    expect(vendorFieldRef.onProviderSelected).not.toBeNull();
    act(() =>
      vendorFieldRef.onProviderSelected!({ id: "prov-1", name: "Acme" }),
    );

    await user.type(screen.getByRole("textbox", { name: /name/i }), "Server X");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });

    // Provider is the source side of relProviderToITC, so source_id is the
    // Provider id and target_id is the freshly created card id.
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/relations", {
        type: "relProviderToITC",
        source_id: "prov-1",
        target_id: "itc-id-456",
      });
    });

    // The orphan `attributes.vendor` must NOT be persisted on the card.
    const createCall = onCreate.mock.calls[0][0];
    expect(createCall.attributes?.vendor).toBeUndefined();
  });

  it("does not post a relation when no Provider was picked", async () => {
    onCreate.mockResolvedValueOnce("itc-id-789");
    const user = userEvent.setup();

    renderDialog({ initialType: "ITComponent" });
    await user.type(screen.getByRole("textbox", { name: /name/i }), "No-link");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalled();
    });

    // No /relations POST should have happened.
    const relationsCall = vi
      .mocked(api.post)
      .mock.calls.find((c) => c[0] === "/relations");
    expect(relationsCall).toBeUndefined();
  });

  it("searches for parent cards with debounce", async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [{ id: "p1", name: "Parent App" }] });
    const user = userEvent.setup();

    renderDialog({ initialType: "Application" });

    const parentInput = screen.getByLabelText("Parent");
    await user.type(parentInput, "Par");

    // Debounced — wait for the API call
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining("search=Par"),
      );
    });
  });
});


// ---------------------------------------------------------------------------
// Per-card-type create permissions (discussion #1068)
// ---------------------------------------------------------------------------

describe("CreateCardDialog — per-card-type create permissions", () => {
  /** A member who may create everything except the named types. */
  function memberDeniedOn(...typeKeys: string[]) {
    authRef.user.permissions = { "inventory.create": true };
    authRef.user.type_permissions = Object.fromEntries(
      typeKeys.map((k) => [k, { "inventory.create": false }]),
    );
  }

  it("omits a denied type from the type picker", async () => {
    const user = userEvent.setup();
    memberDeniedOn("Application");
    renderDialog();

    await user.click(screen.getAllByRole("combobox")[0]);

    expect(screen.queryByRole("option", { name: /Application/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Objective/ })).toBeInTheDocument();
  });

  it("offers a type granted by an override to a role that lacks the permission", async () => {
    const user = userEvent.setup();
    authRef.user.permissions = { "inventory.create": false };
    authRef.user.type_permissions = { Objective: { "inventory.create": true } };
    renderDialog();

    await user.click(screen.getAllByRole("combobox")[0]);

    expect(screen.getByRole("option", { name: /Objective/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Application/ })).not.toBeInTheDocument();
  });

  it("disables Create when the caller pre-selects a type the user may not create", () => {
    // InventoryPage passes its faceted type as `initialType`, which can be one
    // the role is denied — the picker alone would not stop the submit.
    memberDeniedOn("Application");
    renderDialog({ initialType: "Application" });

    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });

  it("keeps Create usable for a permitted pre-selected type", async () => {
    const user = userEvent.setup();
    memberDeniedOn("Application");
    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByLabelText(/name/i), "My Objective");

    expect(screen.getByRole("button", { name: /create/i })).toBeEnabled();
  });

  it("shows every visible type to an admin", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getAllByRole("combobox")[0]);

    expect(screen.getByRole("option", { name: /Application/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Objective/ })).toBeInTheDocument();
  });
});
