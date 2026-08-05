import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  RelationTypeValuesDialog: () => <div data-testid="relation-type-values-dialog" />,
  RelationTranslationDialog: () => <div data-testid="relation-translation-dialog" />,
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

  it("shows an error and keeps the dialog open when creating a relation type fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockRejectedValueOnce(
      new Error("A relation type from 'Application' to 'Objective' already exists."),
    );
    renderMetamodel();

    // Open the create-relation dialog.
    await user.click(screen.getByRole("tab", { name: /relation types/i }));
    await user.click(await screen.findByRole("button", { name: /new relation/i }));
    expect(await screen.findByText("Create Relation Type")).toBeInTheDocument();

    // Pick source + target types. MUI renders Select as a combobox with an
    // empty accessible name, so select by position: [source, target, cardinality].
    const sourceSelect = screen.getAllByRole("combobox")[0];
    await user.click(sourceSelect);
    await user.click(await screen.findByRole("option", { name: /application/i }));
    const targetSelect = screen.getAllByRole("combobox")[1];
    await user.click(targetSelect);
    await user.click(await screen.findByRole("option", { name: /objective/i }));

    // Provide a valid (lowercase) key and a label so Create is enabled. Set the
    // key directly (selecting the target auto-fills an uppercase key the mock
    // KeyInput rejects, and the controlled fallback fights clear()+type()).
    fireEvent.change(screen.getByTestId("key-input"), { target: { value: "owns" } });
    await user.type(screen.getByRole("textbox", { name: /label \(verb/i }), "owns");

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // Error surfaces and the dialog stays open (no silent failure).
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByText("Create Relation Type")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Locale-aware relation verbs (#912)
//
// `translations[property][locale]` SHADOWS the raw `label` / `reverse_label`
// columns everywhere relation verbs render (`relationLabel` in
// useResolveLabel.ts), and every seeded relation type carries an `en` entry.
// Editing only the column therefore renamed nothing a user could see.
// ---------------------------------------------------------------------------

describe("MetamodelAdmin — locale-aware relation verbs (#912)", () => {
  // A relation type whose stored English translation has drifted from the
  // column — exactly the state a pre-fix rename left behind.
  const DRIFTED = [
    {
      ...MOCK_RELATION_TYPES[0],
      label: "enables",
      reverse_label: "is enabled by",
      translations: {
        label: { en: "supports", fr: "soutient" },
        reverse_label: { en: "is supported by", fr: "est soutenu par" },
      },
    },
  ];

  function renderDrifted() {
    vi.mocked(useMetamodel).mockReturnValue({
      types: MOCK_TYPES,
      relationTypes: DRIFTED,
      loading: false,
      getType: (key: string) => MOCK_TYPES.find((t) => t.key === key),
      getRelationsForType: () => [],
      invalidateCache: vi.fn(),
    });
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.includes("/metamodel/types")) return Promise.resolve(MOCK_TYPES);
      if (path.includes("/metamodel/relation-types")) return Promise.resolve(DRIFTED);
      return Promise.resolve({});
    });
    return render(<MetamodelAdmin />);
  }

  async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: /relation types/i }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(await screen.findByText("Edit Relation Type")).toBeInTheDocument();
  }

  it("renders the resolved verb in the list, not the raw column", async () => {
    const user = userEvent.setup();
    renderDrifted();

    await user.click(screen.getByRole("tab", { name: /relation types/i }));

    expect(await screen.findByText("supports")).toBeInTheDocument();
    expect(screen.queryByText("enables")).not.toBeInTheDocument();
  });

  it("seeds the edit dialog from the current locale's translation", async () => {
    const user = userEvent.setup();
    renderDrifted();
    await openEditDialog(user);

    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("supports");
    expect(screen.getByRole("textbox", { name: /^Reverse Label/ })).toHaveValue(
      "is supported by",
    );
  });

  it("writes a rename to both the column and translations[locale]", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValueOnce({});
    renderDrifted();
    await openEditDialog(user);

    const nameField = screen.getByRole("textbox", { name: /^Name/ });
    await user.clear(nameField);
    await user.type(nameField, "consumes");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.patch).mock.calls[0] as [
      string,
      { label: string; translations: Record<string, Record<string, string>> },
    ];
    expect(path).toBe("/metamodel/relation-types/app_to_objective");
    expect(body.label).toBe("consumes");
    // The English translation moves with the column; other locales survive.
    expect(body.translations.label).toEqual({ en: "consumes", fr: "soutient" });
    expect(body.translations.reverse_label).toEqual({
      en: "is supported by",
      fr: "est soutenu par",
    });
  });

  it("never sends translations: null (the column is NOT NULL)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValueOnce({});
    render(<MetamodelAdmin />); // stock mock — no translations at all

    await user.click(screen.getByRole("tab", { name: /relation types/i }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByText("Edit Relation Type");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.patch).mock.calls[0][1] as { translations: unknown };
    expect(body.translations).not.toBeNull();
  });
});
