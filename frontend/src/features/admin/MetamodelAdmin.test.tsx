import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MetamodelAdmin from "./MetamodelAdmin";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

// Stub complex sub-components
vi.mock("./metamodel", () => ({
  TypeDetailDrawer: () => <div data-testid="type-detail-drawer" />,
  MetamodelGraph: () => <div data-testid="metamodel-graph" />,
}));

vi.mock("./metamodel/constants", () => ({
  CATEGORIES: ["Application & Data", "Business Architecture", "Strategy & Transformation", "Technical Architecture"],
  CARDINALITY_OPTIONS: ["1:1", "1:n", "n:m"],
}));

vi.mock("@/features/admin/CalculationsAdmin", () => ({
  default: () => <div data-testid="calculations-admin" />,
}));

vi.mock("@/features/admin/TagsAdmin", () => ({
  default: () => <div data-testid="tags-admin" />,
}));

vi.mock("@/components/ColorPicker", () => ({
  default: () => <div data-testid="color-picker" />,
}));

vi.mock("@/components/KeyInput", () => {
  const KeyInput = (props: { label: string; value: string; onChange: (v: string) => void; [k: string]: unknown }) => (
    <input
      data-testid="key-input"
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
  return {
    default: KeyInput,
    isValidKey: (key: string) => /^[a-z][a-z0-9_]*$/.test(key),
  };
});

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
    subtypes: [{ key: "business_app", label: "Business Application" }],
    fields_schema: [
      { section: "Details", fields: [{ key: "costTotalAnnual", label: "Cost", type: "cost" }] },
    ],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
  },
  {
    key: "Objective",
    label: "Objective",
    icon: "flag",
    color: "#c7527d",
    category: "Strategy & Transformation",
    has_hierarchy: false,
    subtypes: [],
    fields_schema: [],
    built_in: true,
    is_hidden: false,
    sort_order: 1,
  },
];

const MOCK_RELATION_TYPES = [
  {
    key: "app_to_objective",
    label: "supports",
    reverse_label: "is supported by",
    source_type_key: "Application",
    target_type_key: "Objective",
    cardinality: "n:m",
    built_in: true,
    is_hidden: false,
    attributes_schema: [],
  },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(useMetamodel).mockReturnValue({
    types: MOCK_TYPES,
    relationTypes: MOCK_RELATION_TYPES,
    loading: false,
    getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.includes("/metamodel/types")) return Promise.resolve(MOCK_TYPES);
    if (path.includes("/metamodel/relation-types")) return Promise.resolve(MOCK_RELATION_TYPES);
    return Promise.resolve({});
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMetamodel() {
  return render(<MetamodelAdmin />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MetamodelAdmin", () => {
  it("renders the page title", async () => {
    renderMetamodel();
    expect(screen.getByText("Metamodel Configuration")).toBeInTheDocument();
  });

  it("renders 5 tabs", async () => {
    renderMetamodel();
    expect(screen.getByRole("tab", { name: /card types/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /relation types/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /calculations/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /tags/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /metamodel graph/i })).toBeInTheDocument();
  });

  it("renders card type cards on the Card Types tab", async () => {
    renderMetamodel();

    await waitFor(() => {
      expect(screen.getByText("Application")).toBeInTheDocument();
      expect(screen.getByText("Objective")).toBeInTheDocument();
    });
  });

  it("shows field, subtype, and relation counts for types", async () => {
    renderMetamodel();

    await waitFor(() => {
      expect(screen.getByText("1 field")).toBeInTheDocument(); // Application has 1 field
      expect(screen.getByText("1 subtype")).toBeInTheDocument(); // Application has 1 subtype
      // Both types have 1 relation each (app_to_objective)
      const relationTexts = screen.getAllByText("1 relation");
      expect(relationTexts.length).toBe(2);
    });
  });

  it("shows Built-in chip for built-in types", async () => {
    renderMetamodel();

    await waitFor(() => {
      const chips = screen.getAllByText("Built-in");
      expect(chips.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Hierarchy chip for hierarchical types", async () => {
    renderMetamodel();

    await waitFor(() => {
      expect(screen.getByText("Hierarchy")).toBeInTheDocument();
    });
  });

  it("shows New Type button", async () => {
    renderMetamodel();
    expect(screen.getByRole("button", { name: /new type/i })).toBeInTheDocument();
  });

  it("opens Create Card Type dialog when New Type is clicked", async () => {
    const user = userEvent.setup();
    renderMetamodel();

    await user.click(screen.getByRole("button", { name: /new type/i }));

    await waitFor(() => {
      expect(screen.getByText("Create Card Type")).toBeInTheDocument();
    });
  });

  it("shows Show hidden types toggle", async () => {
    renderMetamodel();
    expect(screen.getByText("Show hidden types")).toBeInTheDocument();
  });

  it("switches to Relation Types tab", async () => {
    const user = userEvent.setup();
    renderMetamodel();

    await user.click(screen.getByRole("tab", { name: /relation types/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /new relation/i })).toBeInTheDocument();
    });
  });

  it("shows relation type entries on Relation Types tab", async () => {
    const user = userEvent.setup();
    renderMetamodel();

    await user.click(screen.getByRole("tab", { name: /relation types/i }));

    await waitFor(() => {
      expect(screen.getByText("supports")).toBeInTheDocument();
      expect(screen.getByText("n:m")).toBeInTheDocument();
    });
  });

  it("switches to Calculations tab", async () => {
    const user = userEvent.setup();
    renderMetamodel();

    await user.click(screen.getByRole("tab", { name: /calculations/i }));

    await waitFor(() => {
      expect(screen.getByTestId("calculations-admin")).toBeInTheDocument();
    });
  });

  it("switches to Tags tab", async () => {
    const user = userEvent.setup();
    renderMetamodel();

    await user.click(screen.getByRole("tab", { name: /tags/i }));

    await waitFor(() => {
      expect(screen.getByTestId("tags-admin")).toBeInTheDocument();
    });
  });

  it("switches to Metamodel Graph tab", async () => {
    const user = userEvent.setup();
    renderMetamodel();

    await user.click(screen.getByRole("tab", { name: /metamodel graph/i }));

    await waitFor(() => {
      expect(screen.getByTestId("metamodel-graph")).toBeInTheDocument();
    });
  });

  it("fetches types and relation types on mount", async () => {
    renderMetamodel();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/metamodel/types?include_hidden=true");
      expect(api.get).toHaveBeenCalledWith("/metamodel/relation-types?include_hidden=true");
    });
  });
});
