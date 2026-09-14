import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RelationTranslationDialog from "./RelationTranslationDialog";
import type { CardType, RelationType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({
    enabledLocales: ["en", "de", "fr"],
    invalidateEnabledLocales: vi.fn(),
  }),
}));

import { api } from "@/api/client";

const TYPES = [
  { key: "Provider", label: "Provider" },
  { key: "Application", label: "Application" },
] as unknown as CardType[];

const RELATIONS = [
  {
    key: "relProviderToApp",
    label: "offers",
    reverse_label: "is offered by",
    source_type_key: "Provider",
    target_type_key: "Application",
    cardinality: "n:m",
    built_in: true,
    is_hidden: false,
    attributes_schema: [],
    translations: {
      label: { en: "offers", fr: "propose" },
      reverse_label: { en: "is offered by", fr: "est proposé par" },
    },
  },
  {
    key: "relAppToApp",
    label: "depends on",
    source_type_key: "Application",
    target_type_key: "Application",
    cardinality: "n:m",
    built_in: false,
    is_hidden: false,
    attributes_schema: [],
    translations: {},
  },
] as unknown as RelationType[];

function renderDialog(overrides: Partial<React.ComponentProps<typeof RelationTranslationDialog>> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <RelationTranslationDialog
      open
      relationTypes={RELATIONS}
      types={TYPES}
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onSaved, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RelationTranslationDialog", () => {
  // English is the `label` / `reverse_label` column, edited on the relation
  // itself. Offering an English tab here is what would let the column and the
  // translation drift apart again (#912).
  it("offers no English tab", async () => {
    renderDialog();

    expect(await screen.findByRole("tab", { name: /Deutsch/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Français/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /English/ })).not.toBeInTheDocument();
  });

  it("shows the English verb as the translation reference", async () => {
    renderDialog();

    expect(await screen.findByText("offers")).toBeInTheDocument();
    expect(screen.getByText("is offered by")).toBeInTheDocument();
    // A relation with no reverse verb contributes only one row.
    expect(screen.getByText("depends on")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });

  it("counts completeness per locale, ignoring English", async () => {
    renderDialog();

    // French has 2 of the 3 verbs translated; German none.
    expect(await screen.findByRole("tab", { name: /Français.*2\/3/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Deutsch.*0\/3/ })).toBeInTheDocument();
  });

  it("saves only the relations whose translations changed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    const { onSaved, onClose } = renderDialog();

    const inputs = await screen.findAllByRole("textbox");
    await user.type(inputs[0], "bietet an");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.patch).mock.calls[0] as [
      string,
      { translations: Record<string, Record<string, string>> },
    ];
    expect(path).toBe("/metamodel/relation-types/relProviderToApp");
    // The edited locale lands; every other locale survives untouched.
    expect(body.translations.label).toEqual({ en: "offers", fr: "propose", de: "bietet an" });
    expect(body.translations.reverse_label).toEqual({
      en: "is offered by",
      fr: "est proposé par",
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("never sends translations: null (the column is NOT NULL)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog();

    // Clear the only French verb on the second relation's row.
    const inputs = await screen.findAllByRole("textbox");
    await user.click(screen.getByRole("tab", { name: /Français/ }));
    const frenchInputs = await screen.findAllByRole("textbox");
    await user.clear(frenchInputs[0]);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = vi.mocked(api.patch).mock.calls[0][1] as { translations: unknown };
    expect(body.translations).not.toBeNull();
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("surfaces a failed save and keeps the dialog open", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("Relation type not found"));
    const { onSaved, onClose } = renderDialog();

    const inputs = await screen.findAllByRole("textbox");
    await user.type(inputs[0], "bietet an");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/Relation type not found/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Hierarchy link types are translated in the same pass as the relation verbs
 * (they are the other metamodel label the Relations tab owns), but they live on
 * the CARD TYPE, so they are their own section and their own PATCH.
 */
describe("RelationTranslationDialog hierarchy link types", () => {
  const ORG = {
    key: "Organization",
    label: "Organization",
    has_hierarchy: true,
    hierarchy_labels: [
      { key: "commercial", label: "Commercial", translations: { en: "Commercial" } },
      { key: "sales", label: "Sales", translations: { en: "Sales", fr: "Ventes" } },
    ],
  } as unknown as CardType;

  it("leads with the link types, matching the tab that opens it", async () => {
    renderDialog({ hierarchyTypes: [ORG] });

    // The tab lists Hierarchy link types above the relation list, so the
    // dialog must too — two orderings of the same two groups is what made the
    // dialog read as a different page from the tab it belongs to.
    const hierarchy = await screen.findByText("Commercial");
    const verb = screen.getByText("offers");
    expect(hierarchy.compareDocumentPosition(verb)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("lists each vocabulary under its own card type and counts it", async () => {
    renderDialog({ hierarchyTypes: [ORG] });

    expect(await screen.findByText("Commercial")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    // 3 verbs + 2 link types; French has "propose", "est proposé par", "Ventes".
    expect(screen.getByRole("tab", { name: /Français.*3\/5/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Deutsch.*0\/5/ })).toBeInTheDocument();
  });

  it("patches the card type, leaving the relation types alone", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog({ hierarchyTypes: [ORG] });

    // The link-type rows lead, so the first input is "Commercial".
    const inputs = await screen.findAllByRole("textbox");
    await user.type(inputs[0], "Kommerziell");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Only the card type changed, so only one request goes out.
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [path, body] = vi.mocked(api.patch).mock.calls[0] as [
      string,
      { hierarchy_labels: { key: string; translations: Record<string, string> }[] },
    ];
    expect(path).toBe("/metamodel/types/Organization");
    expect(body.hierarchy_labels[0].translations).toEqual({
      en: "Commercial",
      de: "Kommerziell",
    });
    // The untouched option keeps every locale it already had.
    expect(body.hierarchy_labels[1].translations).toEqual({ en: "Sales", fr: "Ventes" });
  });

  it("renders no such section when no type has a vocabulary", async () => {
    renderDialog();
    await screen.findByText("offers");
    expect(screen.queryByText("Commercial")).not.toBeInTheDocument();
  });
});
