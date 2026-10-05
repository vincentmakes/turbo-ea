import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TranslationDialog from "./TranslationDialog";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({
    enabledLocales: ["en", "de"],
    invalidateEnabledLocales: vi.fn(),
  }),
}));

import { api } from "@/api/client";

const CARD_TYPE = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  subtypes: [],
  fields_schema: [],
  built_in: true,
  is_hidden: false,
  translations: { label: { en: "Application", de: "Anwendung" } },
} as unknown as CardType;

function renderDialog(overrides: { cardType?: CardType } = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <TranslationDialog
      open
      cardType={overrides.cardType ?? CARD_TYPE}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { onSave, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue([]);
});

describe("TranslationDialog", () => {
  it("never sends translations: null — the column is NOT NULL", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog();

    // Clear every translation in every locale, which used to clean down to
    // `null` and violate the NOT NULL constraint.
    for (const name of [/English/, /Deutsch/]) {
      await user.click(await screen.findByRole("tab", { name }));
      for (const input of await screen.findAllByRole("textbox")) await user.clear(input);
    }
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = vi.mocked(api.patch).mock.calls[0][1] as { translations: unknown };
    expect(body.translations).not.toBeNull();
    expect(body.translations).toEqual({});
  });

  it("carries an English edit into the label column", async () => {
    // `translations.label.en` shadows the `label` column everywhere labels are
    // resolved, so editing English here without the column is the card-type
    // twin of #912.
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog();

    const englishTab = await screen.findByRole("tab", { name: /English/ });
    await user.click(englishTab);
    const input = (await screen.findAllByRole("textbox"))[0];
    await user.clear(input);
    await user.type(input, "Business System");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const body = vi.mocked(api.patch).mock.calls[0][1] as {
      label?: string;
      translations: Record<string, Record<string, string>>;
    };
    expect(body.label).toBe("Business System");
    expect(body.translations.label.en).toBe("Business System");
    expect(body.translations.label.de).toBe("Anwendung");
  });

  it("surfaces a failed save instead of swallowing it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce(new Error("Card type not found"));
    const { onSave, onClose } = renderDialog();

    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/Card type not found/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Hierarchy link types belong to the card type, so they are translated here —
 * alongside its subtypes, sections, fields and roles — and NOT from a second
 * button on the Relations tab. This dialog having no coverage of them is why
 * that duplicate shipped.
 */
describe("TranslationDialog hierarchy link types", () => {
  const withLinkTypes = {
    ...CARD_TYPE,
    has_hierarchy: true,
    hierarchy_labels: [
      { key: "commercial", label: "Commercial", translations: { en: "Commercial" } },
      { key: "sales", label: "Sales" },
    ],
  } as unknown as CardType;

  it("shows the English name as the reference, never the slug", async () => {
    renderDialog({ cardType: withLinkTypes });

    // `reference` doubles as the input placeholder, so it has to preview the
    // fallback — which is the name, not the key.
    expect(await screen.findByText("Commercial")).toBeInTheDocument();
    expect(screen.queryByText("commercial")).not.toBeInTheDocument();
    // An option with no `en` entry falls back to its `label` column.
    expect(screen.getByText("Sales")).toBeInTheDocument();
  });

  it("carries the vocabulary into the card type's own PATCH", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockResolvedValue({});
    renderDialog({ cardType: withLinkTypes });

    await user.click(await screen.findByRole("tab", { name: /Deutsch/ }));
    const inputs = await screen.findAllByRole("textbox");
    // The link-type rows sit after the type label (and description, if shown).
    const row = inputs[inputs.length - 2];
    await user.type(row, "Kommerziell");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [path, body] = vi.mocked(api.patch).mock.calls[0] as [
      string,
      { hierarchy_labels?: { key: string; translations?: Record<string, string> }[] },
    ];
    expect(path).toBe(`/metamodel/types/${withLinkTypes.key}`);
    // One PATCH carries the link types along with everything else on the type.
    expect(body.hierarchy_labels?.map((o) => o.key)).toEqual(["commercial", "sales"]);
  });
});

/**
 * Every translatable surface of a card type in one fixture: the description,
 * subtypes, the `__description` pseudo-section's fields, a regular section with
 * an option-bearing field, an empty section, and stakeholder roles.
 */
describe("TranslationDialog — full card type", () => {
  const RICH_TYPE = {
    ...CARD_TYPE,
    description: "Software that runs the business",
    subtypes: [
      { key: "businessApp", label: "Business Application", translations: { de: "Fachanwendung" } },
      { key: "microservice", label: "Microservice" },
    ],
    fields_schema: [
      {
        section: "__description",
        fields: [
          {
            key: "alias",
            label: "Alias",
            type: "single_select",
            options: [{ key: "short", label: "Short" }],
          },
        ],
      },
      {
        section: "Details",
        fields: [
          {
            key: "criticality",
            label: "Criticality",
            type: "single_select",
            options: [
              { key: "high", label: "High" },
              { key: "low", label: "Low" },
            ],
          },
          { key: "owner", label: "Owner", type: "text" },
        ],
      },
      { section: "Empty", fields: [] },
    ],
  } as unknown as CardType;

  const ROLES = [
    { key: "owner", label: "Owner", translations: { label: { de: "Eigentümer" } } },
    { key: "steward", label: "Steward" },
    { key: "retired", label: "Retired", is_archived: true },
  ];

  beforeEach(() => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/metamodel/types/Application/stakeholder-roles" ? ROLES : [],
    );
    vi.mocked(api.patch).mockResolvedValue({});
  });

  it("renders a row per translatable string, skipping archived roles and the __description section name", async () => {
    renderDialog({ cardType: RICH_TYPE });

    expect(await screen.findByText("Stakeholder Roles")).toBeInTheDocument();
    expect(screen.getByText("Subtypes")).toBeInTheDocument();
    expect(screen.getByText("Section Names")).toBeInTheDocument();
    expect(screen.getByText("Fields — Description")).toBeInTheDocument();
    expect(screen.getByText("Fields — Details")).toBeInTheDocument();
    // An empty section has a name row but no fields group.
    expect(screen.getByPlaceholderText("Empty")).toBeInTheDocument();
    expect(screen.queryByText("Fields — Empty")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("__description")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Retired")).not.toBeInTheDocument();
    for (const ref of ["Application.description", "businessApp", "alias", "short", "high", "low", "owner", "Steward"]) {
      expect(screen.getByPlaceholderText(ref)).toBeInTheDocument();
    }
    // 14 strings: label, description, 2 subtypes, alias + its option, the
    // Details name + 3 field-or-option rows + owner, the Empty name, 2 roles.
    // English has the label; German the label, one subtype and one role.
    expect(screen.getByRole("tab", { name: /English/ })).toHaveTextContent("1/14");
    expect(screen.getByRole("tab", { name: /Deutsch/ })).toHaveTextContent("3/14");
  });

  it("writes German edits into every level of the PATCH and the role PATCHes", async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderDialog({ cardType: RICH_TYPE });
    await screen.findByText("Stakeholder Roles");
    await user.click(screen.getByRole("tab", { name: /Deutsch/ }));

    const edits: [string, string][] = [
      ["Application.description", "Software des Geschäfts"],
      ["microservice", "Mikrodienst"],
      ["alias", "Alias-DE"],
      ["short", "Kurz"],
      ["Details", "Einzelheiten"],
      ["criticality", "Kritikalität"],
      ["high", "Hoch"],
      ["Steward", "Verwalter"],
    ];
    for (const [ref, value] of edits) {
      await user.type(screen.getByPlaceholderText(ref), value);
    }
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    const typePatch = vi.mocked(api.patch).mock.calls.find(
      ([path]) => path === "/metamodel/types/Application",
    )!;
    const body = typePatch[1] as {
      label?: string;
      description?: string;
      translations: Record<string, Record<string, string>>;
      subtypes: { key: string; translations?: Record<string, string> }[];
      fields_schema: {
        section: string;
        translations?: Record<string, string>;
        fields: { key: string; translations?: Record<string, string>; options?: { key: string; translations?: Record<string, string> }[] }[];
      }[];
    };
    // German edits never touch the English-shadowed columns.
    expect(body.label).toBeUndefined();
    expect(body.description).toBeUndefined();
    expect(body.translations.description).toEqual({ de: "Software des Geschäfts" });
    expect(body.subtypes[1].translations).toEqual({ de: "Mikrodienst" });
    expect(body.subtypes[0].translations).toEqual({ de: "Fachanwendung" });
    const [desc, details] = body.fields_schema;
    expect(desc.fields[0].translations).toEqual({ de: "Alias-DE" });
    expect(desc.fields[0].options?.[0].translations).toEqual({ de: "Kurz" });
    expect(details.translations).toEqual({ de: "Einzelheiten" });
    expect(details.fields[0].translations).toEqual({ de: "Kritikalität" });
    expect(details.fields[0].options?.[0].translations).toEqual({ de: "Hoch" });

    const rolePatches = vi.mocked(api.patch).mock.calls.filter(([path]) =>
      String(path).includes("/stakeholder-roles/"),
    );
    expect(rolePatches.map(([path]) => path)).toEqual([
      "/metamodel/types/Application/stakeholder-roles/owner",
      "/metamodel/types/Application/stakeholder-roles/steward",
    ]);
    expect(rolePatches[1][1]).toEqual({ translations: { label: { de: "Verwalter" } } });
  });

  it("carries English role and description edits into their columns", async () => {
    const user = userEvent.setup();
    renderDialog({ cardType: RICH_TYPE });
    await screen.findByText("Stakeholder Roles");

    await user.type(screen.getByPlaceholderText("Application.description"), "Runs the business");
    await user.type(screen.getByPlaceholderText("Steward"), "Data Steward");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(3));
    const typeBody = vi.mocked(api.patch).mock.calls[0][1] as { description?: string };
    expect(typeBody.description).toBe("Runs the business");
    const stewardBody = vi.mocked(api.patch).mock.calls.find(([path]) =>
      String(path).endsWith("/steward"),
    )![1] as { label?: string };
    expect(stewardBody.label).toBe("Data Steward");
  });

  it("marks a locale complete once every string is filled", async () => {
    const user = userEvent.setup();
    const small = {
      ...CARD_TYPE,
      subtypes: [{ key: "svc", label: "Service" }],
      fields_schema: [],
    } as unknown as CardType;
    vi.mocked(api.get).mockResolvedValue([]);
    renderDialog({ cardType: small });

    const de = await screen.findByRole("tab", { name: /Deutsch/ });
    // The tab exists before the roles request settles; wait for the final count.
    await waitFor(() => expect(de).toHaveTextContent("1/2"));
    await user.click(de);
    await user.type(screen.getByPlaceholderText("svc"), "Dienst");
    expect(de).toHaveTextContent("2/2");
    expect(de.querySelector(".MuiChip-colorSuccess")).not.toBeNull();
  });

  it("shows the description row once any locale has one, even without the column", async () => {
    const withDescTranslation = {
      ...CARD_TYPE,
      translations: { label: { en: "Application" }, description: { de: "Beschreibung" } },
    } as unknown as CardType;
    renderDialog({ cardType: withDescTranslation });
    expect(await screen.findByPlaceholderText("Application.description")).toBeInTheDocument();
  });

  it("treats a failing roles fetch as no roles", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("down"));
    renderDialog({ cardType: RICH_TYPE });
    await screen.findByText("Subtypes");
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText("Stakeholder Roles")).not.toBeInTheDocument();
  });
});

describe("TranslationDialog — closing and errors", () => {
  it("closes from Cancel and from the header icon without saving", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: /^close$/ }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("uses a generic message for a non-Error failure and lets the alert be dismissed", async () => {
    const user = userEvent.setup();
    vi.mocked(api.patch).mockRejectedValueOnce("boom");
    renderDialog();
    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    const alert = await screen.findByText("Could not save translations. Please try again.");
    expect(alert).toBeInTheDocument();
    await user.click(within(screen.getByRole("alert")).getByRole("button"));
    await waitFor(() =>
      expect(screen.queryByText("Could not save translations. Please try again.")).not.toBeInTheDocument(),
    );
  });

  it("renders nothing without a card type", () => {
    const { container } = render(
      <TranslationDialog open cardType={null} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(api.get).not.toHaveBeenCalled();
  });
});
