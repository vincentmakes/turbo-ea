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
