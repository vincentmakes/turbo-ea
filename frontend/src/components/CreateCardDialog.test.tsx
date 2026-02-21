import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CreateCardDialog from "./CreateCardDialog";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

// Stub complex sub-components that aren't under test
vi.mock("@/components/EolLinkSection", () => ({
  EolLinkDialog: () => null,
}));
vi.mock("@/components/VendorField", () => ({
  default: () => null,
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
    subtypes: [
      { key: "business_app", label: "Business Application" },
      { key: "microservice", label: "Microservice" },
    ],
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "costTotalAnnual", label: "Total Annual Cost", type: "cost", required: true },
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
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: [],
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

  it("renders required fields from schema", () => {
    renderDialog({ initialType: "Application" });

    // Application has a required costTotalAnnual field
    expect(screen.getByLabelText("Total Annual Cost")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderDialog({ open: false });

    expect(screen.queryByText("Create Card")).not.toBeInTheDocument();
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
