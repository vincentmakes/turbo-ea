import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
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

function renderDialog(props: { open?: boolean; initialType?: string } = {}) {
  return render(
    <MemoryRouter>
      <CreateCardDialog
        open={props.open ?? true}
        onClose={onClose}
        onCreate={onCreate}
        initialType={props.initialType}
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

  it("surfaces a 409 sibling-name collision on the Name field, not as a dialog toast", async () => {
    // The backend's uniqueness check returns 409 with a human-readable
    // detail. The dialog must route it to the Name TextField's helperText
    // (so the user can correct in place) instead of the generic Alert.
    const { ApiError } = await import("@/api/client");
    const user = userEvent.setup();
    const detail =
      'A Application named "ERP" already exists at this level (existing card: abc-123).';
    onCreate.mockRejectedValueOnce(new ApiError(detail, 409, detail));

    renderDialog({ initialType: "Objective" });

    await user.type(screen.getByRole("textbox", { name: /name/i }), "ERP");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // The detail must appear in the form (as helperText), once.
    await waitFor(() => {
      expect(screen.getByText(detail)).toBeInTheDocument();
    });
    // And it must clear the moment the user edits the name.
    await user.type(screen.getByRole("textbox", { name: /name/i }), "2");
    expect(screen.queryByText(detail)).not.toBeInTheDocument();
  });

  it("renders required fields from schema", () => {
    renderDialog({ initialType: "Application" });

    // Application has a required costTotalAnnual field
    expect(screen.getByLabelText("Total Annual Cost")).toBeInTheDocument();
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
