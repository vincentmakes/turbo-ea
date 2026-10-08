/**
 * Behaviour pins for `TranslationDialog` that the original suite left open:
 * which locales get a tab, which locale a row edits, how the per-locale
 * completion chip counts every kind of string, that one edit touches exactly
 * one string in the PATCH, what the role PATCHes carry, and the saving /
 * error lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import TranslationDialog from "./TranslationDialog";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const locales = vi.hoisted(() => ({ enabled: [] as string[] }));

vi.mock("@/hooks/useEnabledLocales", () => ({
  useEnabledLocales: () => ({
    enabledLocales: locales.enabled,
    invalidateEnabledLocales: vi.fn(),
  }),
}));

import { api } from "@/api/client";

type Locale = (typeof SUPPORTED_LOCALES)[number];

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

function renderDialog(cardType: CardType = CARD_TYPE, open = true) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <TranslationDialog open={open} cardType={cardType} onClose={onClose} onSave={onSave} />,
  );
  const rerender = (next: { cardType?: CardType; open?: boolean }) =>
    view.rerender(
      <TranslationDialog
        open={next.open ?? true}
        cardType={next.cardType ?? cardType}
        onClose={onClose}
        onSave={onSave}
      />,
    );
  return { onSave, onClose, rerender };
}

function tabOf(locale: Locale): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(LOCALE_LABELS[locale]) });
}

/** The `filled/total` chip on a locale's tab. */
function countOf(locale: Locale): string | null {
  return within(tabOf(locale)).getByText(/^-?\d+\/-?\d+$/).textContent;
}

function isMarkedComplete(locale: Locale): boolean {
  return tabOf(locale).querySelector(".MuiChip-colorSuccess") !== null;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^save$/i });
}

/** The body of the PATCH to the card type itself. */
function typePatchBody(key = "Application"): Record<string, unknown> {
  const call = vi.mocked(api.patch).mock.calls.find(([path]) => path === `/metamodel/types/${key}`);
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  locales.enabled = [...SUPPORTED_LOCALES];
  vi.mocked(api.get).mockResolvedValue([]);
  vi.mocked(api.patch).mockResolvedValue({});
});

describe("TranslationDialog — locale tabs", () => {
  it("renders one tab per enabled locale, in the supported-locale order", async () => {
    locales.enabled = ["ar", "fr", "en"];
    renderDialog();

    const expected = SUPPORTED_LOCALES.filter((l) => locales.enabled.includes(l)).map(
      (l) => LOCALE_LABELS[l],
    );
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+\/\d+$/, ""))).toEqual(expected);
  });

  it("offers every supported locale when all are enabled", async () => {
    renderDialog();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs).toHaveLength(SUPPORTED_LOCALES.length);
    expect(tabs.map((t) => t.textContent?.replace(/\d+\/\d+$/, ""))).toEqual(
      SUPPORTED_LOCALES.map((l) => LOCALE_LABELS[l]),
    );
  });

  it("selects the clicked tab and edits that locale's strings", async () => {
    const user = userEvent.setup();
    const everyLocale = {
      ...CARD_TYPE,
      translations: {
        label: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, `Application-${l}`])),
      },
    } as unknown as CardType;
    renderDialog(everyLocale);

    for (const locale of SUPPORTED_LOCALES) {
      await user.click(tabOf(locale));
      expect(tabOf(locale)).toHaveAttribute("aria-selected", "true");
      expect(screen.getByPlaceholderText("Application")).toHaveValue(`Application-${locale}`);
    }
  });

  it("opens on the first enabled locale when English is not enabled", async () => {
    locales.enabled = ["de", "fr"];
    renderDialog();

    expect(await screen.findByRole("tab", { name: /Deutsch/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByPlaceholderText("Application")).toHaveValue("Anwendung");
  });

  it("falls back to English when no locale is enabled", async () => {
    locales.enabled = [];
    renderDialog();

    expect(await screen.findByPlaceholderText("Application")).toHaveValue("Application");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("selects the first enabled tab when the locale it opened on is disabled later", async () => {
    // The dialog opened before the enabled-locale list arrived (all locales,
    // so English), and the list that arrived does not carry English.
    const { rerender } = renderDialog();
    await screen.findByRole("tab", { name: /English/ });

    locales.enabled = ["de", "fr"];
    rerender({});

    await waitFor(() => expect(tabOf("de")).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("tab", { name: /English/ })).not.toBeInTheDocument();
  });
});

describe("TranslationDialog — headings and groups", () => {
  it("titles the dialog with the type key and shows the type-info group", async () => {
    renderDialog();
    expect(await screen.findByText("Manage Translations — Application")).toBeInTheDocument();
    expect(screen.getByText("Type Info")).toBeInTheDocument();
  });

  it("renders no empty group for a type with nothing but a label", async () => {
    renderDialog();
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/metamodel/types/Application/stakeholder-roles"),
    );
    await screen.findByText("Type Info");
    expect(screen.queryByText("Subtypes")).not.toBeInTheDocument();
    expect(screen.queryByText("Hierarchy link types")).not.toBeInTheDocument();
    expect(screen.queryByText("Section Names")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Stakeholder Roles")).not.toBeInTheDocument());
    // No description column and no description translation → no description row.
    expect(screen.queryByPlaceholderText("Application.description")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("tolerates a type payload without subtypes or fields_schema", async () => {
    const bare = { ...CARD_TYPE } as Record<string, unknown>;
    delete bare.subtypes;
    delete bare.fields_schema;
    renderDialog(bare as unknown as CardType);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(await screen.findByText("Type Info")).toBeInTheDocument();
    expect(screen.queryByText("Subtypes")).not.toBeInTheDocument();
    expect(screen.queryByText("Section Names")).not.toBeInTheDocument();
    expect(countOf("en")).toBe("1/1");
  });

  it("hides the description-fields group when that section has no fields", async () => {
    const onlyEmptyDescription = {
      ...CARD_TYPE,
      fields_schema: [{ section: "__description", fields: [] }],
    } as unknown as CardType;
    renderDialog(onlyEmptyDescription);

    await screen.findByText("Type Info");
    expect(screen.queryByText("Fields — Description")).not.toBeInTheDocument();
    // `__description` is not a real section, so there is no section-name group.
    expect(screen.queryByText("Section Names")).not.toBeInTheDocument();
  });

  it("does not treat a regular section as the description section", async () => {
    const regularOnly = {
      ...CARD_TYPE,
      fields_schema: [{ section: "Details", fields: [{ key: "contact", label: "Contact", type: "text" }] }],
    } as unknown as CardType;
    renderDialog(regularOnly);

    expect(await screen.findByText("Fields — Details")).toBeInTheDocument();
    expect(screen.queryByText("Fields — Description")).not.toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("contact")).toHaveLength(1);
  });

  it("shows only the type info on first paint, before the type is copied in", () => {
    const rich = {
      ...CARD_TYPE,
      subtypes: [{ key: "svc", label: "Service" }],
      hierarchy_labels: [{ key: "commercial", label: "Commercial" }],
    } as unknown as CardType;
    // Render the dialog inline (no portal) so the server render captures it.
    const inline = createTheme({ components: { MuiDialog: { defaultProps: { disablePortal: true } } } });
    const html = renderToStaticMarkup(
      <ThemeProvider theme={inline}>
        <TranslationDialog open cardType={rich} onClose={vi.fn()} onSave={vi.fn()} />
      </ThemeProvider>,
    );

    expect(html).toContain("Type Info");
    expect(html).not.toContain("Subtypes");
    expect(html).not.toContain("Hierarchy link types");
    expect(html).not.toContain("Stakeholder Roles");
  });
});

describe("TranslationDialog — description row", () => {
  it("counts a description translated in any locale, even without the column", async () => {
    const withDesc = {
      ...CARD_TYPE,
      translations: {
        label: { en: "Application" },
        description: { de: "Beschreibung", fr: "   " },
      },
    } as unknown as CardType;
    renderDialog(withDesc);

    expect(await screen.findByPlaceholderText("Application.description")).toBeInTheDocument();
    await waitFor(() => expect(countOf("en")).toBe("1/2"));
    // German has the description but no label.
    expect(countOf("de")).toBe("1/2");
    // A whitespace-only description is not a translation.
    expect(countOf("fr")).toBe("0/2");
    for (const locale of SUPPORTED_LOCALES.filter((l) => !["en", "de"].includes(l))) {
      expect(countOf(locale)).toBe("0/2");
    }
  });

  it("ignores a whitespace-only description translation entirely", async () => {
    const blankDesc = {
      ...CARD_TYPE,
      translations: { label: { en: "Application" }, description: { de: "   " } },
    } as unknown as CardType;
    renderDialog(blankDesc);

    await screen.findByText("Type Info");
    expect(screen.queryByPlaceholderText("Application.description")).not.toBeInTheDocument();
    await waitFor(() => expect(countOf("en")).toBe("1/1"));
  });

  it("tolerates a null description translation", async () => {
    const nullDesc = {
      ...CARD_TYPE,
      translations: { label: { en: "Application" }, description: { de: null } },
    } as unknown as CardType;
    renderDialog(nullDesc);

    await screen.findByText("Type Info");
    expect(screen.queryByPlaceholderText("Application.description")).not.toBeInTheDocument();
    await waitFor(() => expect(countOf("en")).toBe("1/1"));
  });
});

describe("TranslationDialog — completion counts", () => {
  it("counts the type label only when it has non-blank text", async () => {
    const blankGerman = {
      ...CARD_TYPE,
      translations: { label: { en: "Application", de: "   " } },
    } as unknown as CardType;
    renderDialog(blankGerman);

    await waitFor(() => expect(countOf("en")).toBe("1/1"));
    expect(isMarkedComplete("en")).toBe(true);
    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== "en")) {
      expect(countOf(locale)).toBe("0/1");
      expect(isMarkedComplete(locale)).toBe(false);
    }
  });

  it("counts subtypes, link types, sections, fields, options and roles per locale", async () => {
    const counted = {
      ...CARD_TYPE,
      translations: { label: { en: "Application" } },
      subtypes: [{ key: "svc", label: "Service", translations: { de: "Dienst", fr: "  " } }],
      hierarchy_labels: [
        {
          key: "commercial",
          label: "Commercial",
          translations: { en: "Commercial", de: "Kommerziell", fr: "  " },
        },
        { key: "sales", label: "Sales" },
      ],
      fields_schema: [
        {
          section: "__description",
          fields: [{ key: "alias", label: "Alias", type: "text", translations: { de: "Alias-DE", fr: "  " } }],
        },
        {
          section: "Details",
          translations: { de: "Einzelheiten", fr: "  " },
          fields: [
            {
              key: "criticality",
              label: "Criticality",
              type: "single_select",
              translations: { de: "Kritikalität", fr: "  " },
              options: [{ key: "high", label: "High", translations: { de: "Hoch", fr: "  " } }],
            },
          ],
        },
      ],
    } as unknown as CardType;
    vi.mocked(api.get).mockResolvedValue([
      { key: "owner", label: "Owner", translations: { label: { de: "Eigentümer", fr: "  " } } },
    ]);
    renderDialog(counted);

    // 9 strings: label, 1 subtype, 2 link types, the alias field, the Details
    // name, its field and its option, and the role (`__description` has no name).
    await waitFor(() => expect(countOf("de")).toBe("7/9"));
    expect(countOf("en")).toBe("2/9");
    // French is whitespace everywhere: nothing counts.
    expect(countOf("fr")).toBe("0/9");
    for (const locale of SUPPORTED_LOCALES.filter((l) => !["en", "de"].includes(l))) {
      expect(countOf(locale)).toBe("0/9");
    }
    expect(isMarkedComplete("de")).toBe(false);

    // Link-type rows show the active locale's text, or nothing.
    expect(screen.getByText("Hierarchy link types")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Commercial")).toHaveValue("Commercial");
    expect(screen.getByPlaceholderText("Sales")).toHaveValue("");
  });
});

describe("TranslationDialog — edits land on exactly one string", () => {
  it("writes a link-type translation into that link type only", async () => {
    const user = userEvent.setup();
    const withLinkTypes = {
      ...CARD_TYPE,
      has_hierarchy: true,
      hierarchy_labels: [
        { key: "commercial", label: "Commercial", translations: { en: "Commercial" } },
        { key: "sales", label: "Sales" },
      ],
    } as unknown as CardType;
    const { onSave } = renderDialog(withLinkTypes);

    await user.click(await screen.findByRole("tab", { name: /Deutsch/ }));
    const row = screen.getByPlaceholderText("Commercial");
    await user.type(row, "Kommerziell");
    expect(row).toHaveValue("Kommerziell");
    expect(screen.getByPlaceholderText("Sales")).toHaveValue("");
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(typePatchBody().hierarchy_labels).toEqual([
      { key: "commercial", label: "Commercial", translations: { en: "Commercial", de: "Kommerziell" } },
      { key: "sales", label: "Sales" },
    ]);
  });

  it("keeps sections, fields, options and roles independent", async () => {
    const user = userEvent.setup();
    const fieldsSchema = [
      { section: "__description", fields: [{ key: "alias", label: "Alias", type: "text" }] },
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
          {
            key: "tier",
            label: "Tier",
            type: "single_select",
            options: [
              { key: "gold", label: "Gold" },
              { key: "silver", label: "Silver" },
            ],
          },
          { key: "contact", label: "Contact", type: "text" },
        ],
      },
      { section: "Other", fields: [{ key: "note", label: "Note", type: "text" }] },
    ];
    const typed = { ...CARD_TYPE, fields_schema: fieldsSchema } as unknown as CardType;
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/metamodel/types/Application/stakeholder-roles"
        ? [
            { key: "owner", label: "Owner", translations: { label: { de: "Eigentümer" } } },
            { key: "steward", label: "Steward" },
            {
              key: "approver",
              label: "Approver",
              translations: { label: { en: "Approver", de: "Genehmiger" } },
            },
            { key: "reviewer", label: "Reviewer", translations: { description: { de: "Prüft Änderungen" } } },
            { key: "observer", label: "Observer" },
            { key: "retired", label: "Retired", is_archived: true },
          ]
        : [],
    );
    const { onSave, onClose } = renderDialog(typed);
    await screen.findByText("Stakeholder Roles");
    await user.click(tabOf("de"));

    const edits: [string, string][] = [
      ["Details", "Einzelheiten"],
      ["criticality", "Kritikalität"],
      ["high", "Hoch"],
      ["silver", "Silber"],
      ["Steward", "Verwalter"],
    ];
    for (const [ref, value] of edits) {
      await user.type(screen.getByPlaceholderText(ref), value);
    }
    await user.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    const body = typePatchBody();
    // The English label matches the column, and no description was touched.
    expect(body).not.toHaveProperty("label");
    expect(body).not.toHaveProperty("description");
    expect(body.fields_schema).toEqual([
      {
        section: "__description",
        translations: undefined,
        fields: [{ key: "alias", label: "Alias", type: "text", translations: undefined, options: undefined }],
      },
      {
        section: "Details",
        translations: { de: "Einzelheiten" },
        fields: [
          {
            key: "criticality",
            label: "Criticality",
            type: "single_select",
            translations: { de: "Kritikalität" },
            options: [
              { key: "high", label: "High", translations: { de: "Hoch" } },
              { key: "low", label: "Low", translations: undefined },
            ],
          },
          {
            key: "tier",
            label: "Tier",
            type: "single_select",
            translations: undefined,
            options: [
              { key: "gold", label: "Gold", translations: undefined },
              { key: "silver", label: "Silver", translations: { de: "Silber" } },
            ],
          },
          { key: "contact", label: "Contact", type: "text", translations: undefined, options: undefined },
        ],
      },
      {
        section: "Other",
        translations: undefined,
        fields: [{ key: "note", label: "Note", type: "text", translations: undefined, options: undefined }],
      },
    ]);

    const rolePatches = vi
      .mocked(api.patch)
      .mock.calls.filter(([path]) => String(path).includes("/stakeholder-roles/"));
    expect(rolePatches.map(([path]) => path)).toEqual([
      "/metamodel/types/Application/stakeholder-roles/owner",
      "/metamodel/types/Application/stakeholder-roles/steward",
      "/metamodel/types/Application/stakeholder-roles/approver",
      "/metamodel/types/Application/stakeholder-roles/reviewer",
      "/metamodel/types/Application/stakeholder-roles/observer",
    ]);
    const bodies = Object.fromEntries(
      rolePatches.map(([path, roleBody]) => [String(path).split("/").pop(), roleBody]),
    );
    // No English text, or English equal to the column → no label column write.
    expect(bodies.owner).toStrictEqual({ translations: { label: { de: "Eigentümer" } } });
    expect(bodies.steward).toStrictEqual({ translations: { label: { de: "Verwalter" } } });
    expect(bodies.approver).toStrictEqual({
      translations: { label: { en: "Approver", de: "Genehmiger" } },
    });
    // A role with no label translations at all, or none at all, still saves.
    expect(bodies.reviewer).toStrictEqual({
      translations: { description: { de: "Prüft Änderungen" } },
    });
    expect(bodies.observer).toStrictEqual({ translations: {} });
  });

  it("saves a type whose translations carry a description but no label", async () => {
    const user = userEvent.setup();
    const descriptionOnly = {
      ...CARD_TYPE,
      translations: { description: { de: "Beschreibung" } },
    } as unknown as CardType;
    const { onSave } = renderDialog(descriptionOnly);

    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const body = typePatchBody();
    expect(body.translations).toEqual({ description: { de: "Beschreibung" } });
    expect(body).not.toHaveProperty("label");
    expect(body).not.toHaveProperty("description");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not rewrite the description column when English matches it", async () => {
    const user = userEvent.setup();
    const sameDescription = {
      ...CARD_TYPE,
      description: "Runs the business",
      translations: {
        label: { en: "Application" },
        description: { en: "Runs the business", de: "Betreibt das Geschäft" },
      },
    } as unknown as CardType;
    const { onSave } = renderDialog(sameDescription);

    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const body = typePatchBody();
    expect(body.translations).toEqual({
      label: { en: "Application" },
      description: { en: "Runs the business", de: "Betreibt das Geschäft" },
    });
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("label");
  });

  it("does not send a description column when English has none", async () => {
    const user = userEvent.setup();
    const columnOnly = {
      ...CARD_TYPE,
      description: "Runs the business",
      translations: { label: { en: "Application" }, description: { de: "Betreibt das Geschäft" } },
    } as unknown as CardType;
    const { onSave } = renderDialog(columnOnly);

    await user.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(typePatchBody()).not.toHaveProperty("description");
  });
});

describe("TranslationDialog — reloading from the card type", () => {
  it("discards unsaved edits when the dialog is reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();
    const input = await screen.findByPlaceholderText("Application");
    await user.clear(input);
    await user.type(input, "Changed");
    expect(screen.getByPlaceholderText("Application")).toHaveValue("Changed");

    rerender({ open: false });
    rerender({ open: true });

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Application")).toHaveValue("Application"),
    );
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("switches to the new type's strings and drops roles whose reload failed", async () => {
    const dataObject = {
      ...CARD_TYPE,
      key: "DataObject",
      label: "Data Object",
      translations: { label: { en: "Data Object" } },
      subtypes: [{ key: "master", label: "Master" }],
    } as unknown as CardType;
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === "/metamodel/types/Application/stakeholder-roles") {
        return [{ key: "owner", label: "Owner", translations: {} }];
      }
      throw new Error("roles unavailable");
    });
    const { rerender } = renderDialog();
    expect(await screen.findByText("Stakeholder Roles")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Owner")).toBeInTheDocument();

    rerender({ cardType: dataObject });

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith("/metamodel/types/DataObject/stakeholder-roles"),
    );
    expect(await screen.findByPlaceholderText("master")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("DataObject")).toHaveValue("Data Object");
    await waitFor(() => expect(screen.queryByText("Stakeholder Roles")).not.toBeInTheDocument());
    expect(screen.queryByPlaceholderText("Owner")).not.toBeInTheDocument();
  });
});

describe("TranslationDialog — saving state", () => {
  it("shows progress while saving, recovers from a failure and clears the error on retry", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (e: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    vi.mocked(api.patch)
      .mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const { onSave, onClose } = renderDialog();

    await user.click(await screen.findByRole("button", { name: /^save$/i }));
    const busy = await screen.findByRole("button", { name: /Saving…/ });
    expect(busy).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();

    await act(async () => rejectFirst(new Error("Conflict on save")));
    expect(await screen.findByText("Conflict on save")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Saving…/ })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    // Retrying clears the old error straight away.
    await user.click(saveButton());
    await waitFor(() => expect(screen.queryByText("Conflict on save")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Saving…/ })).toBeDisabled();

    await act(async () => resolveSecond({}));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
