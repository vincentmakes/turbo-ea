/**
 * Tests for the card-type detail drawer.
 *
 * The drawer is the orchestrator: it owns the header form, the subtype list,
 * the card-ID (`reference_config`) section and the tab strip, and delegates
 * everything else to children that carry their own suites. Those children are
 * stubbed to their props so this file tests exactly the wiring — what each
 * edit sends to `PATCH /metamodel/types/:key`, when `onRefresh` fires, and
 * which errors reach the alert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";

import type { CardType, FieldDef, RelationType } from "@/types";
import i18n, { LOCALE_LABELS } from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import {
  APPLICATION_TYPE,
  CARD_TYPES,
  HIDDEN_TYPE,
  RELATION_TYPES,
  REL_APP_TO_APP,
  REL_APP_TO_BC,
  REL_APP_TO_ITC,
  makeCardType,
  makeRelationType,
  makeField,
  makeSection,
} from "@/test/fixtures/metamodel";

import TypeDetailDrawer from "./TypeDetailDrawer";
import { invalidateCardTypeCategories } from "@/hooks/useCardTypeCategories";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

/* ------------------------------------------------------------------------- */
/*  Stubs — every child has its own suite; here they expose only their props  */
/* ------------------------------------------------------------------------- */

vi.mock("./FieldEditorDialog", () => ({
  default: ({
    open,
    field,
    isCalculated,
    saving,
    error,
    onSave,
    onClose,
  }: {
    open: boolean;
    field: FieldDef;
    isCalculated: boolean;
    saving?: boolean;
    error?: string | null;
    onSave: (f: FieldDef) => void;
    onClose: () => void;
  }) =>
    open ? (
      <div
        data-testid="field-editor"
        data-field-key={field.key}
        data-calculated={String(isCalculated)}
        data-saving={String(!!saving)}
      >
        {error && <div role="alert">{error}</div>}
        <button
          onClick={() =>
            onSave({ ...field, key: field.key || "newField", label: field.label || "New Field" })
          }
        >
          stub-save-field
        </button>
        <button onClick={onClose}>stub-close-field</button>
      </div>
    ) : null,
}));

vi.mock("./DeleteTypeDialog", () => ({
  default: ({
    open,
    cardType,
    onClose,
    onDeleted,
  }: {
    open: boolean;
    cardType: CardType | null;
    onClose: () => void;
    onDeleted: () => void;
  }) =>
    open ? (
      <div data-testid="delete-type-dialog" data-type={cardType?.key}>
        <button onClick={onDeleted}>stub-confirm-delete</button>
        <button onClick={onClose}>stub-close-delete</button>
      </div>
    ) : null,
}));

vi.mock("./DataQualityPanel", () => ({
  default: ({ cardType }: { cardType: CardType }) => (
    <div data-testid="dq-panel" data-type={cardType.key} />
  ),
}));

vi.mock("./StakeholderRolePanel", () => ({
  default: ({ typeKey, onError }: { typeKey: string; onError: (m: string) => void }) => (
    <div data-testid="stakeholder-panel" data-type={typeKey}>
      <button onClick={() => onError("role boom")}>stub-role-error</button>
    </div>
  ),
}));

vi.mock("./CardTypePermissionsPanel", () => ({
  default: ({ typeKey, onSaved }: { typeKey: string; onSaved: () => void }) => (
    <div data-testid="permissions-panel" data-type={typeKey}>
      <button onClick={onSaved}>stub-perm-saved</button>
    </div>
  ),
}));

vi.mock("./TranslationDialog", () => ({
  default: ({ open, onSave, onClose }: { open: boolean; onSave: () => void; onClose: () => void }) =>
    open ? (
      <div data-testid="translation-dialog">
        <button onClick={onSave}>stub-save-translations</button>
        <button onClick={onClose}>stub-close-translations</button>
      </div>
    ) : null,
}));

vi.mock("./RelationsTabContent", () => ({
  default: ({ scopeTypeKey }: { scopeTypeKey: string }) => (
    <div data-testid="relations-tab" data-scope={scopeTypeKey} />
  ),
}));

vi.mock("@/features/admin/CardLayoutEditor", () => ({
  default: (props: {
    cardType: CardType;
    calculatedFieldKeys: string[];
    openAddField: (si: number) => void;
    openEditField: (si: number, fi: number) => void;
    promptDeleteField: (si: number, fi: number) => void;
    promptDeleteSection?: (si: number) => void;
  }) => (
    <div
      data-testid="card-layout-editor"
      data-type={props.cardType.key}
      data-calculated={props.calculatedFieldKeys.join(",")}
    >
      <button onClick={() => props.openAddField(1)}>stub-add-field</button>
      <button onClick={() => props.openEditField(1, 0)}>stub-edit-field</button>
      <button onClick={() => props.promptDeleteField(1, 0)}>stub-delete-field</button>
      <button onClick={() => props.promptDeleteSection?.(1)}>stub-delete-section</button>
    </div>
  ),
}));

vi.mock("@/components/ColorPicker", () => ({
  default: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (c: string) => void;
    label?: string;
  }) => (
    <input
      data-testid="color-picker"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("@/components/IconPicker", () => ({
  default: ({ value, onChange }: { value: string; onChange: (i: string) => void }) => (
    <input data-testid="icon-picker" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

/* ------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* ------------------------------------------------------------------------- */

const ta = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;
const tc = (key: string) => i18n.t(`common:${key}`) as string;

/**
 * `MaterialSymbol` renders the icon's name as text, so a button with a leading
 * icon is named "add Add Subtype" and a dialog titled with one "tune Subtype
 * Template: …". Match the human text at the end of the accessible name.
 */
const endsWith = (text: string) => new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

const LABEL_FIELD = `${ta("metamodel.typeDrawer.label")} (${LOCALE_LABELS.en})`;
const DESCRIPTION_FIELD = `${ta("metamodel.typeDrawer.description")} (${LOCALE_LABELS.en})`;

/** Application with a stored English label and a default colour to reset to. */
const APP_WITH_EN: CardType = {
  ...APPLICATION_TYPE,
  description: "Runs the business.",
  default_color: "#123456",
  translations: {
    label: { en: "App (EN)", de: "Anwendung" },
    description: { de: "Beschreibung" },
  },
};

/** Application with card-ID generation already switched on and saved. */
const APP_WITH_IDS: CardType = {
  ...APPLICATION_TYPE,
  reference_config: { mode: "auto", prefix: "APP-", start: 1, padding: 5 },
};

/** A type with two custom sections and a stored section order. */
const TWO_SECTIONS: CardType = makeCardType({
  key: "Vehicle",
  label: "Vehicle",
  fields_schema: [
    makeSection({ section: "__description", fields: [makeField({ key: "alias" })] }),
    makeSection({ section: "Engine", fields: [makeField({ key: "cylinders", type: "number" })] }),
    makeSection({ section: "Body", fields: [] }),
  ],
  section_config: {
    __order: ["description", "custom:0", "custom:1", "relations"],
    "custom:0": { defaultExpanded: true },
  } as CardType["section_config"],
});

function renderDrawer(
  typeKey: string | null = "Application",
  types: CardType[] = CARD_TYPES,
  overrides: { open?: boolean; withOnDeleted?: boolean; relationTypes?: RelationType[] } = {},
) {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  const onDeleted = vi.fn();
  const utils = renderWithProviders(
    <TypeDetailDrawer
      open={overrides.open ?? true}
      typeKey={typeKey}
      types={types}
      relationTypes={overrides.relationTypes ?? RELATION_TYPES}
      onClose={onClose}
      onRefresh={onRefresh}
      onDeleted={overrides.withOnDeleted === false ? undefined : onDeleted}
    />,
  );
  return { ...utils, onClose, onRefresh, onDeleted };
}

/** The last PATCH body sent to the type endpoint. */
function lastPatchBody(): Record<string, unknown> {
  const calls = mockApi.callsOf("patch", /^\/metamodel\/types\//);
  return calls[calls.length - 1].body as Record<string, unknown>;
}

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/calculations/calculated-fields", { Application: ["vendorScore"] });
  mockApi.on("get", /\/metamodel\/types\/[^/]+\/reference-usage$/, { locked: false, missing: 3 });
  mockApi.on("patch", /^\/metamodel\/types\/[^/]+$/, {});
  mockApi.on("post", /\/generate-references$/, { generated: 3 });
  mockApi.on("get", /\/field-usage\?/, { card_count: 2 });
  mockApi.on("get", /\/section-usage\?/, { card_count: 0 });
});

/* ------------------------------------------------------------------------- */
/*  Header                                                                    */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — header prefill", () => {
  it("renders nothing when the type key does not resolve", () => {
    renderDrawer("DoesNotExist");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("seeds every field from the type, preferring the locale translation", async () => {
    renderDrawer("Application", [APP_WITH_EN]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "App (EN)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: LABEL_FIELD })).toHaveValue("App (EN)");
    expect(screen.getByRole("textbox", { name: DESCRIPTION_FIELD })).toHaveValue(
      "Runs the business.",
    );
    expect(screen.getByRole("combobox", { name: ta("metamodel.typeDrawer.category") })).toHaveValue(
      "Application & Data",
    );
    expect(screen.getByTestId("color-picker")).toHaveValue("#0f7eb5");
    expect(screen.getByTestId("icon-picker")).toHaveValue("apps");
    expect(screen.getByLabelText(ta("metamodel.typeDrawer.supportsHierarchy"))).toBeChecked();
    expect(screen.getByLabelText(ta("metamodel.typeDrawer.supportsSuccessors"))).toBeChecked();
    expect(screen.getByLabelText(ta("metamodel.typeDrawer.allowCardLogo"))).toBeChecked();
    // Card IDs are off until the admin opts in.
    expect(screen.getByLabelText(ta("metamodel.typeDrawer.cardId.label"))).not.toBeChecked();
  });

  it("falls back to the raw label when the locale has no translation", async () => {
    renderDrawer("Provider");
    expect(await screen.findByRole("textbox", { name: LABEL_FIELD })).toHaveValue("Provider");
    expect(screen.getByLabelText(ta("metamodel.typeDrawer.supportsHierarchy"))).not.toBeChecked();
  });

  it("fetches the calculated-field map and the reference usage on open", async () => {
    renderDrawer();
    await waitFor(() => {
      expect(mockApi.callsOf("get", "/calculations/calculated-fields")).toHaveLength(1);
      expect(mockApi.callsOf("get", "/metamodel/types/Application/reference-usage")).toHaveLength(1);
    });
    // The map is handed to the layout editor so it can badge calculated fields.
    await waitFor(() =>
      expect(screen.getByTestId("card-layout-editor")).toHaveAttribute("data-calculated", "vendorScore"),
    );
  });

  it("offers a reset to the default colour only while the colour differs", async () => {
    const { user } = renderDrawer("Application", [APP_WITH_EN]);
    const reset = await screen.findByRole("button", { name: ta("metamodel.typeDrawer.resetColor") });
    await user.click(reset);
    expect(screen.getByTestId("color-picker")).toHaveValue("#123456");
    expect(
      screen.queryByRole("button", { name: ta("metamodel.typeDrawer.resetColor") }),
    ).not.toBeInTheDocument();
  });

  it("closes through the header close button", async () => {
    const { user, onClose } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- */
/*  Save                                                                      */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — save", () => {
  it("PATCHes every header edit and refreshes", async () => {
    const { user, onRefresh } = renderDrawer("Application", [APP_WITH_EN]);
    await screen.findByRole("dialog");

    const labelField = screen.getByRole("textbox", { name: LABEL_FIELD });
    await user.clear(labelField);
    await user.type(labelField, "Software");
    fireEvent.change(screen.getByTestId("color-picker"), { target: { value: "#ff0000" } });
    fireEvent.change(screen.getByTestId("icon-picker"), { target: { value: "memory" } });
    await user.click(screen.getByLabelText(ta("metamodel.typeDrawer.supportsHierarchy")));
    await user.click(screen.getByLabelText(ta("metamodel.typeDrawer.allowCardLogo")));

    // The header title follows the draft label before anything is saved.
    expect(screen.getByRole("heading", { name: "Software" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: tc("actions.save") }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const calls = mockApi.callsOf("patch", "/metamodel/types/Application");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      label: "Software",
      description: "Runs the business.",
      category: "Application & Data",
      color: "#ff0000",
      icon: "memory",
      has_hierarchy: false,
      has_successors: true,
      allow_card_logo: false,
      reference_config: { mode: "off" },
    });
    // The locale's translation moves with the label; other locales survive.
    const body = calls[0].body as { translations: Record<string, Record<string, string>> };
    expect(body.translations.label).toEqual({ en: "Software", de: "Anwendung" });
    expect(body.translations.description).toEqual({ de: "Beschreibung", en: "Runs the business." });
    expect(await screen.findByText(ta("metamodel.typeDrawer.typeSaved"))).toBeInTheDocument();
  });

  it("sends a cleared description, with an empty translation for it", async () => {
    const { user } = renderDrawer("Application", [APP_WITH_EN]);
    await screen.findByRole("dialog");
    await user.clear(screen.getByRole("textbox", { name: DESCRIPTION_FIELD }));
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    const body = lastPatchBody() as { description?: string; translations: Record<string, Record<string, string>> };
    expect(body.description).toBe("");
    expect(body.translations.description.en).toBe("");
  });

  it("moves a built-in type into another category through the combobox", async () => {
    invalidateCardTypeCategories([
      {
        id: "c1",
        key: "Application & Data",
        label: "Application & Data",
        color: "#0f7eb5",
        sort_order: 0,
        built_in: true,
        translations: {},
      },
      {
        id: "c2",
        key: "Security",
        label: "Security Layer",
        color: "#ff0000",
        sort_order: 1,
        built_in: false,
        translations: {},
      },
    ]);
    try {
      const { user } = renderDrawer();
      await screen.findByRole("dialog");
      const combo = screen.getByRole("combobox", { name: ta("metamodel.typeDrawer.category") });
      // The field stays editable on a built-in type: moving it is the point.
      expect(combo).toBeEnabled();
      await user.click(combo);
      await user.click(await screen.findByRole("option", { name: "Security Layer" }));
      await user.click(screen.getByRole("button", { name: tc("actions.save") }));
      await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
      expect(lastPatchBody().category).toBe("Security");
    } finally {
      invalidateCardTypeCategories([]);
    }
  });

  it("translates an unknown-category refusal", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 400, {
      error: "unknown_category",
      message: "Unknown category",
      category: "Typo",
    });
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      ta("metamodel.categories.errors.unknown_category", { category: "Typo" }),
    );
  });

  it("surfaces a failed save in the alert and does not refresh", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500, "boom");
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PATCH /metamodel/types/Application failed");
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText(ta("metamodel.typeDrawer.typeSaved"))).not.toBeInTheDocument();

    // The alert is dismissible.
    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Subtypes                                                                  */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — subtypes", () => {
  it("lists the subtypes as chips, or says there are none", async () => {
    renderDrawer();
    await screen.findByRole("dialog");
    expect(screen.getByText("Business Application (businessApplication)")).toBeInTheDocument();
    expect(screen.getByText("Microservice (microservice)")).toBeInTheDocument();

    renderDrawer("Provider");
    expect(await screen.findByText(ta("metamodel.typeDrawer.noSubtypes"))).toBeInTheDocument();
  });

  it("adds a subtype and appends it to the saved list", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.addSubtype")) }));
    const addButton = screen.getByRole("button", { name: tc("actions.add") });
    expect(addButton).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.key") }), "saas");
    await user.type(screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.label") }), "SaaS");
    expect(addButton).toBeEnabled();
    await user.click(addButton);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({
      subtypes: [
        { key: "businessApplication", label: "Business Application" },
        { key: "microservice", label: "Microservice" },
        { key: "saas", label: "SaaS", hidden_fields: [] },
      ],
    });
    // The inline form closes again.
    expect(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.addSubtype")) })).toBeInTheDocument();
  });

  it("keeps Add disabled on an invalid key and cancels the inline form", async () => {
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.addSubtype")) }));
    // KeyInput coerces "9x" to a digit-led key, which `isValidKey` rejects.
    await user.type(screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.key") }), "9x");
    await user.type(screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.label") }), "Nine");
    expect(screen.getByRole("button", { name: tc("actions.add") })).toBeDisabled();

    // The close icon beside the form is the second "close" button (the header's is first).
    const closes = screen.getAllByRole("button", { name: "close" });
    await user.click(closes[closes.length - 1]);
    expect(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.addSubtype")) })).toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("removes a subtype through the chip's delete icon", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    const chip = screen.getByText("Microservice (microservice)").closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({
      subtypes: [{ key: "businessApplication", label: "Business Application" }],
    });
  });

  it("reports a failed removal", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500, "boom");
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    const chip = screen.getByText("Microservice (microservice)").closest(".MuiChip-root")!;
    await user.click(chip.querySelector(".MuiChip-deleteIcon")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("failed");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("edits a subtype's hidden fields through the template dialog", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByText("Business Application (businessApplication)"));

    const dialog = await screen.findByRole("dialog", {
      name: endsWith(ta("metamodel.typeDrawer.subtypeTemplate", { name: "Business Application" })),
    });
    // Every field is visible by default; "__description" fields sit under the Description heading.
    expect(within(dialog).getByText(ta("metamodel.typeDrawer.descriptionSection"))).toBeInTheDocument();
    expect(within(dialog).getByText("Business Information")).toBeInTheDocument();
    const aliasSwitch = within(dialog).getByLabelText(/^Alias/);
    expect(aliasSwitch).toBeChecked();
    await user.click(aliasSwitch);
    expect(aliasSwitch).not.toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({
      subtypes: [
        {
          key: "businessApplication",
          label: "Business Application",
          hidden_fields: ["alias"],
          optional_relations: [],
        },
        { key: "microservice", label: "Microservice" },
      ],
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: endsWith(ta("metamodel.typeDrawer.subtypeTemplate", { name: "Business Application" })),
        }),
      ).not.toBeInTheDocument(),
    );
  });

  describe("rename (#1291)", () => {
    const renameButton = (name: string) =>
      screen.getByRole("button", { name: ta("metamodel.typeDrawer.renameSubtypeNamed", { name }) });
    const labelInput = () => screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.label") });

    /** Application whose Microservice subtype carries translations and hidden fields. */
    const WITH_TRANSLATIONS: CardType = {
      ...APPLICATION_TYPE,
      subtypes: [
        { key: "businessApplication", label: "Business Application" },
        {
          key: "microservice",
          label: "Microservice",
          hidden_fields: ["alias"],
          translations: { de: "Mikroservice", fr: "Microservice" },
        },
      ],
    };

    it("saves the new label on Enter, keeping the key, hidden fields and translations", async () => {
      const { user, onRefresh } = renderDrawer("Application", [WITH_TRANSLATIONS]);
      await screen.findByRole("dialog");
      await user.click(renameButton("Microservice"));
      expect(labelInput()).toHaveValue("Microservice");
      expect(
        screen.getByText(ta("metamodel.typeDrawer.subtypeKeyKept", { key: "microservice" })),
      ).toBeInTheDocument();

      await user.clear(labelInput());
      await user.type(labelInput(), "  Service  {Enter}");

      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      expect(mockApi.callsOf("patch")).toHaveLength(1);
      expect(lastPatchBody()).toEqual({
        subtypes: [
          { key: "businessApplication", label: "Business Application" },
          {
            key: "microservice",
            label: "Service",
            hidden_fields: ["alias"],
            translations: { de: "Mikroservice", fr: "Microservice" },
          },
        ],
      });
      // Back to the chip list.
      expect(screen.queryByRole("textbox", { name: ta("metamodel.typeDrawer.label") })).not.toBeInTheDocument();
    });

    it("saves on blur too", async () => {
      const { user, onRefresh } = renderDrawer();
      await screen.findByRole("dialog");
      await user.click(renameButton("Business Application"));
      await user.clear(labelInput());
      await user.type(labelInput(), "Line-of-business App");
      fireEvent.blur(labelInput());
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      expect(lastPatchBody()).toEqual({
        subtypes: [
          { key: "businessApplication", label: "Line-of-business App" },
          { key: "microservice", label: "Microservice" },
        ],
      });
    });

    it("cancels on Escape without saving or closing the drawer", async () => {
      const { user, onClose } = renderDrawer();
      await screen.findByRole("dialog");
      await user.click(renameButton("Microservice"));
      await user.clear(labelInput());
      await user.type(labelInput(), "Nope{Escape}");
      expect(screen.queryByRole("textbox", { name: ta("metamodel.typeDrawer.label") })).not.toBeInTheDocument();
      expect(screen.getByText("Microservice (microservice)")).toBeInTheDocument();
      expect(mockApi.callsOf("patch")).toHaveLength(0);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("refuses an empty label: Enter keeps the field open with an error, blur abandons", async () => {
      const { user } = renderDrawer();
      await screen.findByRole("dialog");
      await user.click(renameButton("Microservice"));
      await user.clear(labelInput());
      await user.type(labelInput(), "   {Enter}");
      expect(labelInput()).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText(ta("metamodel.typeDrawer.subtypeLabelRequired"))).toBeInTheDocument();
      expect(mockApi.callsOf("patch")).toHaveLength(0);

      fireEvent.blur(labelInput());
      expect(screen.getByText("Microservice (microservice)")).toBeInTheDocument();
      expect(mockApi.callsOf("patch")).toHaveLength(0);
    });

    it("sends nothing when the label is unchanged", async () => {
      const { user } = renderDrawer();
      await screen.findByRole("dialog");
      await user.click(renameButton("Microservice"));
      await user.type(labelInput(), "{Enter}");
      expect(screen.getByText("Microservice (microservice)")).toBeInTheDocument();
      expect(mockApi.callsOf("patch")).toHaveLength(0);
    });

    it("reports a failed rename", async () => {
      mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500, "boom");
      const { user, onRefresh } = renderDrawer();
      await screen.findByRole("dialog");
      await user.click(renameButton("Microservice"));
      await user.type(labelInput(), "s{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("failed");
      expect(onRefresh).not.toHaveBeenCalled();
    });
  });

  it("says so when the type has no mandatory relation to exempt", async () => {
    // The shared fixture marks only BusinessCapability's side of relAppToBC.
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByText("Business Application (businessApplication)"));
    const list = await screen.findByTestId("subtype-optional-relations");
    expect(within(list).getByText(ta("metamodel.typeDrawer.optionalRelations"))).toBeInTheDocument();
    expect(within(list).getByText(ta("metamodel.typeDrawer.noMandatoryRelations"))).toBeInTheDocument();
    expect(within(list).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("lists only the mandatory relation sides and saves the ticked ones as optional_relations", async () => {
    // Application: relAppToITC mandatory at its source (Application) end;
    // relAppToApp, a self-pair, mandatory at its TARGET end only; relAppToBC
    // mandatory only at the BusinessCapability end; a hidden mandatory type.
    const relationTypes = [
      { ...REL_APP_TO_ITC, source_mandatory: true },
      { ...REL_APP_TO_APP, target_mandatory: true },
      REL_APP_TO_BC,
      makeRelationType({
        key: "relAppHidden",
        label: "is shadowed by",
        source_type_key: "Application",
        target_type_key: "ITComponent",
        source_mandatory: true,
        is_hidden: true,
      }),
    ];
    const withExisting: CardType = {
      ...APPLICATION_TYPE,
      subtypes: [
        {
          key: "businessApplication",
          label: "Business Application",
          optional_relations: ["relAppToApp__in", "relNoLongerMandatory"],
        },
      ],
    };
    const { user, onRefresh } = renderDrawer("Application", [withExisting, ...CARD_TYPES.slice(1)], {
      relationTypes,
    });
    await screen.findByRole("dialog");
    await user.click(screen.getByText("Business Application (businessApplication)"));
    const list = await screen.findByTestId("subtype-optional-relations");
    expect(within(list).getByText(ta("metamodel.typeDrawer.optionalRelationsHelp"))).toBeInTheDocument();

    const boxes = within(list).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    // The verb is read from this type's side: forward at the source end,
    // reverse at the target end of the self-pair.
    const uses = within(list).getByRole("checkbox", { name: /^uses/ });
    const received = within(list).getByRole("checkbox", { name: /^receives data from/ });
    expect(within(list).getByText("IT Component")).toBeInTheDocument();
    expect(within(list).queryByText(/is shadowed by|supports|is supported by/)).toBeNull();
    expect(uses).not.toBeChecked();
    expect(received).toBeChecked();

    await user.click(uses);
    await user.click(received);
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({
      subtypes: [
        {
          key: "businessApplication",
          label: "Business Application",
          hidden_fields: [],
          // A stored key the dialog no longer lists is kept, inert.
          optional_relations: ["relNoLongerMandatory", "relAppToITC"],
        },
      ],
    });
  });

  it("disables the dialog while the template saves, so a second click cannot send twice", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    const { user, onRefresh } = renderDrawer("Application", [
      { ...APPLICATION_TYPE, subtypes: [{ key: "saas", label: "SaaS" }] },
      ...CARD_TYPES.slice(1),
    ]);
    await screen.findByRole("dialog");
    await user.click(screen.getByText("SaaS (saas)"));
    const dialog = (await screen.findByTestId("subtype-optional-relations")).closest(
      '[role="dialog"]',
    ) as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: tc("actions.save") }));

    // The PATCH is in flight: both buttons are locked and Save says so.
    const saving = within(dialog).getByRole("button", { name: ta("metamodel.typeDrawer.saving") });
    expect(saving).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: tc("actions.cancel") })).toBeDisabled();
    // A disabled button takes no pointer events, so dispatch the click directly.
    fireEvent.click(saving);
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);

    resolvePatch({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("subtype-optional-relations")).toBeNull());
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);
  });

  it("shows a failed template save inside the dialog and keeps it open", async () => {
    mockApi.on("patch", /^\/metamodel\/types\/[^/]+$/, () => {
      throw new Error("rescore failed");
    });
    const { user, onRefresh } = renderDrawer("Application", [
      { ...APPLICATION_TYPE, subtypes: [{ key: "saas", label: "SaaS" }] },
      ...CARD_TYPES.slice(1),
    ]);
    await screen.findByRole("dialog");
    await user.click(screen.getByText("SaaS (saas)"));
    const dialog = (await screen.findByTestId("subtype-optional-relations")).closest(
      '[role="dialog"]',
    ) as HTMLElement;
    await user.click(within(dialog).getByRole("button", { name: tc("actions.save") }));

    expect(await within(dialog).findByText("rescore failed")).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: tc("actions.save") })).toBeEnabled();
  });

  it("locks Add while a new subtype saves, so it cannot be added twice", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.addSubtype")) }));
    await user.type(screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.key") }), "saas");
    await user.type(screen.getByRole("textbox", { name: ta("metamodel.typeDrawer.label") }), "SaaS");
    await user.click(screen.getByRole("button", { name: tc("actions.add") }));

    const saving = screen.getByRole("button", { name: ta("metamodel.typeDrawer.saving") });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);

    resolvePatch({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.addSubtype")) })).toBeEnabled(),
    );
  });

  it("refuses a second subtype removal while the first is saving, and locks the other type-level controls", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    const deleteIconOf = (text: string) =>
      screen.getByText(text).closest(".MuiChip-root")!.querySelector(".MuiChip-deleteIcon")!;
    await user.click(deleteIconOf("Microservice (microservice)"));

    expect(screen.getByRole("progressbar", { name: ta("metamodel.typeDrawer.saving") })).toBeInTheDocument();
    fireEvent.click(deleteIconOf("Business Application (businessApplication)"));
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);
    expect(lastPatchBody()).toEqual({
      subtypes: [{ key: "businessApplication", label: "Business Application" }],
    });
    // The other writes on the type wait for this one.
    expect(screen.getByRole("button", { name: ta("metamodel.typeDrawer.hideType") })).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: ta("metamodel.typeDrawer.renameSubtypeNamed", { name: "Microservice" }),
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: tc("actions.save") })).toBeDisabled();

    resolvePatch({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ta("metamodel.typeDrawer.hideType") })).toBeEnabled(),
    );
    expect(screen.queryByRole("progressbar", { name: ta("metamodel.typeDrawer.saving") })).toBeNull();
  });

  it("shows the hidden-field count on the chip", async () => {
    const withHidden: CardType = {
      ...APPLICATION_TYPE,
      subtypes: [{ key: "microservice", label: "Microservice", hidden_fields: ["alias", "notes"] }],
    };
    renderDrawer("Application", [withHidden]);
    await screen.findByRole("dialog");
    expect(screen.getByText(ta("metamodel.typeDrawer.hiddenFieldCount", { count: 2 }))).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Card IDs (#811)                                                           */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — card IDs", () => {
  it("suggests a prefix when switched on, previews the first ID and asks to save first", async () => {
    const { user } = renderDrawer();
    await screen.findByRole("dialog");

    await user.click(screen.getByLabelText(ta("metamodel.typeDrawer.cardId.label")));

    expect(screen.getByText("APP-")).toBeInTheDocument();
    expect(screen.getByText("APP-00001")).toBeInTheDocument();
    expect(screen.getByText(ta("metamodel.typeDrawer.cardId.oneTimeSetup"))).toBeInTheDocument();
    // The format is unsaved, so generation waits.
    expect(screen.getByText(ta("metamodel.typeDrawer.cardId.saveFirst"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.cardId.generateN", { count: 3 })) }),
    ).toBeDisabled();

    // Start / min-digits feed the example, and the prefix is editable via the pencil.
    const start = screen.getByRole("spinbutton", { name: ta("metamodel.typeDrawer.cardId.start") });
    await user.clear(start);
    await user.type(start, "10");
    const padding = screen.getByRole("spinbutton", { name: ta("metamodel.typeDrawer.cardId.padding") });
    await user.clear(padding);
    await user.type(padding, "3");
    expect(screen.getByText("APP-010")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: tc("actions.edit") }));
    const prefixInput = screen.getByDisplayValue("APP-");
    await user.clear(prefixInput);
    await user.type(prefixInput, "SW-{Enter}");
    expect(screen.queryByDisplayValue("SW-")).not.toBeInTheDocument();
    expect(screen.getByText("SW-010")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect(lastPatchBody().reference_config).toEqual({
      mode: "auto",
      prefix: "SW-",
      start: 10,
      padding: 3,
    });
  });

  it("generates IDs for the cards still missing one after a confirmation", async () => {
    const { user } = renderDrawer("Application", [APP_WITH_IDS]);
    await screen.findByRole("dialog");

    const generate = await screen.findByRole("button", {
      name: endsWith(ta("metamodel.typeDrawer.cardId.generateN", { count: 3 })),
    });
    await waitFor(() => expect(generate).toBeEnabled());
    expect(screen.queryByText(ta("metamodel.typeDrawer.cardId.saveFirst"))).not.toBeInTheDocument();

    // The second usage read (after generation) reports nothing left to do.
    mockApi.on("get", /\/reference-usage$/, { locked: true, missing: 0 });

    await user.click(generate);
    const confirm = await screen.findByRole("dialog", {
      name: ta("metamodel.typeDrawer.cardId.generateConfirmTitle"),
    });
    expect(confirm).toHaveTextContent(ta("metamodel.typeDrawer.cardId.generateConfirmBody", { count: 3 }));
    expect(confirm).toHaveTextContent("APP-00001");

    await user.click(
      within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.cardId.generateConfirmAction") }),
    );

    await waitFor(() =>
      expect(mockApi.callsOf("post", "/metamodel/types/Application/generate-references")).toHaveLength(1),
    );
    expect(await screen.findByText(ta("metamodel.typeDrawer.cardId.generated", { count: 3 }))).toBeInTheDocument();
    // Usage was re-read, the format is now locked and the button has nothing to do.
    expect(mockApi.callsOf("get", /\/reference-usage$/)).toHaveLength(2);
    expect(
      await screen.findByRole("button", { name: endsWith(ta("metamodel.typeDrawer.cardId.generateNone")) }),
    ).toBeDisabled();
    expect(screen.getByText(ta("metamodel.typeDrawer.cardId.locked"))).toBeInTheDocument();
  });

  it("cancels the confirmation without generating", async () => {
    const { user } = renderDrawer("Application", [APP_WITH_IDS]);
    const generate = await screen.findByRole("button", {
      name: endsWith(ta("metamodel.typeDrawer.cardId.generateN", { count: 3 })),
    });
    await waitFor(() => expect(generate).toBeEnabled());
    await user.click(generate);
    const confirm = await screen.findByRole("dialog", {
      name: ta("metamodel.typeDrawer.cardId.generateConfirmTitle"),
    });
    await user.click(within(confirm).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    expect(mockApi.callsOf("post")).toHaveLength(0);
  });

  it("reports a failed generation", async () => {
    mockApi.fail("post", /\/generate-references$/, 500, "boom");
    const { user } = renderDrawer("Application", [APP_WITH_IDS]);
    const generate = await screen.findByRole("button", {
      name: endsWith(ta("metamodel.typeDrawer.cardId.generateN", { count: 3 })),
    });
    await waitFor(() => expect(generate).toBeEnabled());
    await user.click(generate);
    const confirm = await screen.findByRole("dialog", {
      name: ta("metamodel.typeDrawer.cardId.generateConfirmTitle"),
    });
    await user.click(
      within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.cardId.generateConfirmAction") }),
    );
    // The one-time-setup warning is an alert too, so look for the message itself.
    const message = await screen.findByText(/generate-references failed/);
    expect(message.closest(".MuiAlert-standardError")).not.toBeNull();
  });

  it("freezes the format once cards carry IDs", async () => {
    mockApi.on("get", /\/reference-usage$/, { locked: true, missing: 0 });
    renderDrawer("Application", [APP_WITH_IDS]);
    expect(await screen.findByText(ta("metamodel.typeDrawer.cardId.locked"))).toBeInTheDocument();
    expect(screen.queryByText(ta("metamodel.typeDrawer.cardId.oneTimeSetup"))).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: ta("metamodel.typeDrawer.cardId.start") })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: ta("metamodel.typeDrawer.cardId.padding") })).toBeDisabled();
    expect(screen.queryByRole("button", { name: tc("actions.edit") })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: endsWith(ta("metamodel.typeDrawer.cardId.generateNone")) })).toBeDisabled();
  });

  it("treats a failed usage read as unlocked with nothing to generate", async () => {
    mockApi.fail("get", /\/reference-usage$/, 500);
    renderDrawer("Application", [APP_WITH_IDS]);
    expect(
      await screen.findByRole("button", { name: endsWith(ta("metamodel.typeDrawer.cardId.generateNone")) }),
    ).toBeDisabled();
    expect(screen.getByText(ta("metamodel.typeDrawer.cardId.oneTimeSetup"))).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Tabs                                                                      */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — tabs", () => {
  it("switches between the five panels and scopes each to the type", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    expect(screen.getByTestId("card-layout-editor")).toHaveAttribute("data-type", "Application");

    await user.click(screen.getByRole("tab", { name: ta("metamodel.typeDrawer.relations") }));
    expect(screen.getByTestId("relations-tab")).toHaveAttribute("data-scope", "Application");
    expect(screen.queryByTestId("card-layout-editor")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: ta("metamodel.stakeholderPanel.title") }));
    expect(screen.getByTestId("stakeholder-panel")).toHaveAttribute("data-type", "Application");

    await user.click(screen.getByRole("tab", { name: ta("metamodel.permissionsPanel.title") }));
    expect(screen.getByTestId("permissions-panel")).toHaveAttribute("data-type", "Application");
    await user.click(screen.getByRole("button", { name: "stub-perm-saved" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: ta("metamodel.dataQuality.title") }));
    expect(screen.getByTestId("dq-panel")).toHaveAttribute("data-type", "Application");

    await user.click(screen.getByRole("tab", { name: ta("metamodel.typeDrawer.tabMain") }));
    expect(screen.getByTestId("card-layout-editor")).toBeInTheDocument();
  });

  it("surfaces a child panel's error in the drawer alert", async () => {
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("tab", { name: ta("metamodel.stakeholderPanel.title") }));
    await user.click(screen.getByRole("button", { name: "stub-role-error" }));
    expect(screen.getByRole("alert")).toHaveTextContent("role boom");
  });

  it("returns to the main tab when a different type is opened", async () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn();
    const props = { open: true, types: CARD_TYPES, relationTypes: RELATION_TYPES, onClose, onRefresh };
    const { user, rerender } = renderWithProviders(<TypeDetailDrawer {...props} typeKey="Application" />);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("tab", { name: ta("metamodel.typeDrawer.relations") }));
    expect(screen.getByTestId("relations-tab")).toBeInTheDocument();

    rerender(<TypeDetailDrawer {...props} typeKey="Provider" />);
    // `rerender` from renderWithProviders re-wraps in fresh providers; the
    // drawer itself is the same element tree so its state survives.
    expect(await screen.findByRole("heading", { name: "Provider" })).toBeInTheDocument();
    expect(screen.getByTestId("card-layout-editor")).toHaveAttribute("data-type", "Provider");
    expect(screen.queryByTestId("relations-tab")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Hide / translations                                                       */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — visibility and translations", () => {
  it("hides a visible type", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: ta("metamodel.typeDrawer.hideType") }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({ is_hidden: true });
  });

  it("unhides a hidden type", async () => {
    const { user, onRefresh } = renderDrawer("Secret", [HIDDEN_TYPE]);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: ta("metamodel.typeDrawer.hideType") })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ta("metamodel.typeDrawer.unhideType") }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({ is_hidden: false });
  });

  it("offers permanent deletion on a custom type and relays the outcome", async () => {
    const { user, onDeleted, onRefresh } = renderDrawer("Secret", [HIDDEN_TYPE]);
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("delete-type-dialog")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: ta("metamodel.typeDrawer.deleteType") });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(screen.getByTestId("delete-type-dialog")).toHaveAttribute("data-type", "Secret");
    await user.click(screen.getByRole("button", { name: "stub-confirm-delete" }));
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delete-type-dialog")).not.toBeInTheDocument();
  });

  it("closes the deletion dialog without deleting", async () => {
    const { user, onDeleted } = renderDrawer("Secret", [HIDDEN_TYPE]);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: ta("metamodel.typeDrawer.deleteType") }));
    await user.click(screen.getByRole("button", { name: "stub-close-delete" }));
    expect(screen.queryByTestId("delete-type-dialog")).not.toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("falls back to onRefresh when no onDeleted handler is given", async () => {
    const { user, onRefresh } = renderDrawer("Secret", [HIDDEN_TYPE], { withOnDeleted: false });
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: ta("metamodel.typeDrawer.deleteType") }));
    await user.click(screen.getByRole("button", { name: "stub-confirm-delete" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("locks deletion on a built-in type, which can only be hidden", async () => {
    renderDrawer();
    await screen.findByRole("dialog");
    // Application is built in: the button is rendered, but disabled, so the
    // dialog can never open from it.
    expect(screen.getByRole("button", { name: ta("metamodel.typeDrawer.deleteType") })).toBeDisabled();
    expect(screen.queryByTestId("delete-type-dialog")).not.toBeInTheDocument();
  });

  it("locks the visibility toggle while it saves, so a double click sends once", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    const hide = screen.getByRole("button", { name: ta("metamodel.typeDrawer.hideType") });
    await user.click(hide);
    expect(hide).toBeDisabled();
    fireEvent.click(hide);
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);
    resolvePatch({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hide).toBeEnabled());
  });

  it("reports a failed visibility change", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500);
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: ta("metamodel.typeDrawer.hideType") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("failed");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("opens the translation dialog and refreshes after it saves", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("translation-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ta("metamodel.translationDialog.manage") }));
    await user.click(await screen.findByRole("button", { name: "stub-save-translations" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(ta("metamodel.translationDialog.saved"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "stub-close-translations" }));
    expect(screen.queryByTestId("translation-dialog")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------- */
/*  Fields and sections (driven through the layout editor's callbacks)       */
/* ------------------------------------------------------------------------- */

describe("TypeDetailDrawer — fields and sections", () => {
  it("appends a new field to the chosen section", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-add-field" }));
    const editor = screen.getByTestId("field-editor");
    expect(editor).toHaveAttribute("data-field-key", "");
    expect(editor).toHaveAttribute("data-calculated", "false");

    await user.click(screen.getByRole("button", { name: "stub-save-field" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const body = lastPatchBody() as { fields_schema: { section: string; fields: FieldDef[] }[] };
    const section = body.fields_schema[1];
    expect(section.section).toBe("Business Information");
    expect(section.fields).toHaveLength(APPLICATION_TYPE.fields_schema[1].fields.length + 1);
    expect(section.fields[section.fields.length - 1]).toMatchObject({
      key: "newField",
      label: "New Field",
      type: "text",
      weight: 1,
    });
    // The description section is untouched.
    expect(body.fields_schema[0]).toEqual(APPLICATION_TYPE.fields_schema[0]);
    await waitFor(() => expect(screen.queryByTestId("field-editor")).not.toBeInTheDocument());
  });

  it("replaces an edited field in place and flags a calculated one", async () => {
    mockApi.on("get", "/calculations/calculated-fields", { Application: ["businessCriticality"] });
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await waitFor(() =>
      expect(screen.getByTestId("card-layout-editor")).toHaveAttribute("data-calculated", "businessCriticality"),
    );
    await user.click(screen.getByRole("button", { name: "stub-edit-field" }));
    const editor = screen.getByTestId("field-editor");
    expect(editor).toHaveAttribute("data-field-key", "businessCriticality");
    expect(editor).toHaveAttribute("data-calculated", "true");

    await user.click(screen.getByRole("button", { name: "stub-save-field" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const body = lastPatchBody() as { fields_schema: { fields: FieldDef[] }[] };
    expect(body.fields_schema[1].fields).toHaveLength(APPLICATION_TYPE.fields_schema[1].fields.length);
    expect(body.fields_schema[1].fields[0].key).toBe("businessCriticality");
  });

  it("closes the field editor without saving", async () => {
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-add-field" }));
    await user.click(screen.getByRole("button", { name: "stub-close-field" }));
    expect(screen.queryByTestId("field-editor")).not.toBeInTheDocument();
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("reports a failed field save inside the field editor, which stays open", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500);
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-add-field" }));
    await user.click(screen.getByRole("button", { name: "stub-save-field" }));
    const editor = screen.getByTestId("field-editor");
    expect(await within(editor).findByRole("alert")).toHaveTextContent("failed");
    expect(editor).toHaveAttribute("data-saving", "false");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("locks the field editor while the field saves, so it cannot be sent twice or closed", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-add-field" }));
    expect(screen.getByTestId("field-editor")).toHaveAttribute("data-saving", "false");
    await user.click(screen.getByRole("button", { name: "stub-save-field" }));

    await waitFor(() => expect(screen.getByTestId("field-editor")).toHaveAttribute("data-saving", "true"));
    expect(screen.getByRole("progressbar", { name: ta("metamodel.typeDrawer.saving") })).toBeInTheDocument();
    // A second save and a close are both refused while the first is in flight.
    await user.click(screen.getByRole("button", { name: "stub-save-field" }));
    await user.click(screen.getByRole("button", { name: "stub-close-field" }));
    expect(screen.getByTestId("field-editor")).toBeInTheDocument();
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);

    resolvePatch({});
    await waitFor(() => expect(screen.queryByTestId("field-editor")).not.toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);
    expect(screen.queryByRole("progressbar", { name: ta("metamodel.typeDrawer.saving") })).toBeNull();
  });

  it("clears a failed field save's message when the editor is opened again", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500);
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-add-field" }));
    await user.click(screen.getByRole("button", { name: "stub-save-field" }));
    await within(screen.getByTestId("field-editor")).findByRole("alert");
    await user.click(screen.getByRole("button", { name: "stub-close-field" }));
    await user.click(screen.getByRole("button", { name: "stub-edit-field" }));
    expect(within(screen.getByTestId("field-editor")).queryByRole("alert")).toBeNull();
  });

  it("confirms a field deletion with its usage count before removing it", async () => {
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-field" }));

    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteField") });
    expect(confirm).toHaveTextContent("Business Criticality");
    expect(confirm).toHaveTextContent("businessCriticality");
    // Two cards carry data for it, so the warning shows and the button unlocks.
    expect(await within(confirm).findByText(/2 card\(s\)/)).toBeInTheDocument();
    expect(
      mockApi.callsOf("get", "/metamodel/types/Application/field-usage?field_key=businessCriticality"),
    ).toHaveLength(1);

    await user.click(within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteField") }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const body = lastPatchBody() as { fields_schema: { fields: FieldDef[] }[] };
    expect(body.fields_schema[1].fields.map((f) => f.key)).not.toContain("businessCriticality");
    expect(body.fields_schema[1].fields).toHaveLength(APPLICATION_TYPE.fields_schema[1].fields.length - 1);
  });

  it("says a field is safe to delete when nothing uses it, and cancels", async () => {
    mockApi.on("get", /\/field-usage\?/, { card_count: 0 });
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-field" }));
    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteField") });
    expect(await within(confirm).findByText(ta("metamodel.typeDrawer.fieldSafeToDelete"))).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    expect(mockApi.callsOf("patch")).toHaveLength(0);
  });

  it("treats a failed usage read as zero cards", async () => {
    mockApi.fail("get", /\/field-usage\?/, 500);
    const { user } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-field" }));
    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteField") });
    expect(await within(confirm).findByText(ta("metamodel.typeDrawer.fieldSafeToDelete"))).toBeInTheDocument();
  });

  it("deletes a section with fields and re-indexes the stored order", async () => {
    mockApi.on("get", /\/section-usage\?/, { card_count: 4 });
    const { user, onRefresh } = renderDrawer("Vehicle", [TWO_SECTIONS]);
    await screen.findByRole("dialog");
    // The stub asks to delete fields_schema[1] — "Engine", i.e. custom:0.
    await user.click(screen.getByRole("button", { name: "stub-delete-section" }));

    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteSection") });
    expect(confirm).toHaveTextContent("Engine");
    expect(await within(confirm).findByText(/4 card\(s\)/)).toBeInTheDocument();
    expect(
      mockApi.callsOf("get", "/metamodel/types/Vehicle/section-usage?field_keys=cylinders"),
    ).toHaveLength(1);

    await user.click(within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteSection") }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({
      fields_schema: [TWO_SECTIONS.fields_schema[0], TWO_SECTIONS.fields_schema[2]],
      section_config: {
        __order: ["description", "custom:0", "relations"],
        "custom:0": { defaultExpanded: true },
      },
    });
  });

  it("skips the usage read for an empty section", async () => {
    const emptyLast: CardType = {
      ...TWO_SECTIONS,
      fields_schema: [TWO_SECTIONS.fields_schema[0], TWO_SECTIONS.fields_schema[2]],
    };
    const { user } = renderDrawer("Vehicle", [emptyLast]);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-section" }));
    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteSection") });
    expect(within(confirm).getByText(ta("metamodel.typeDrawer.sectionNoFields"))).toBeInTheDocument();
    expect(mockApi.callsOf("get", /\/section-usage\?/)).toHaveLength(0);
    expect(within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteSection") })).toBeEnabled();
  });

  it("refuses to delete the description section", async () => {
    // fields_schema[1] of this type IS the description section.
    const descLast: CardType = makeCardType({
      key: "Vehicle",
      fields_schema: [
        makeSection({ section: "Engine", fields: [] }),
        makeSection({ section: "__description", fields: [] }),
      ],
    });
    const { user } = renderDrawer("Vehicle", [descLast]);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-section" }));
    expect(
      screen.queryByRole("dialog", { name: ta("metamodel.typeDrawer.deleteSection") }),
    ).not.toBeInTheDocument();
  });

  it("reports a failed section deletion", async () => {
    mockApi.fail("patch", /^\/metamodel\/types\/[^/]+$/, 500);
    const { user } = renderDrawer("Vehicle", [TWO_SECTIONS]);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-section" }));
    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteSection") });
    await within(confirm).findByText(ta("metamodel.typeDrawer.sectionSafeToDelete"));
    await user.click(within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteSection") }));
    // The failure shows in the confirmation, which stays open for a retry.
    expect(await within(confirm).findByText(/failed/)).toBeInTheDocument();
    expect(confirm).toBeInTheDocument();
    expect(
      within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteSection") }),
    ).toBeEnabled();
  });

  it("keeps the section confirmation open and locked while the deletion saves", async () => {
    let resolvePatch: (v: unknown) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    const { user, onRefresh } = renderDrawer("Vehicle", [TWO_SECTIONS]);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-section" }));
    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteSection") });
    await within(confirm).findByText(ta("metamodel.typeDrawer.sectionSafeToDelete"));
    await user.click(within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteSection") }));

    const saving = within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.saving") });
    expect(saving).toBeDisabled();
    expect(within(confirm).getByRole("button", { name: tc("actions.cancel") })).toBeDisabled();
    fireEvent.click(saving);
    await user.keyboard("{Escape}");
    expect(confirm).toBeInTheDocument();
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);

    resolvePatch({});
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the field confirmation open and locked while the deletion saves, and shows a failure there", async () => {
    let rejectPatch: (e: Error) => void = () => {};
    mockApi.on(
      "patch",
      /^\/metamodel\/types\/[^/]+$/,
      () => new Promise((_resolve, reject) => (rejectPatch = reject)),
    );
    const { user, onRefresh } = renderDrawer();
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "stub-delete-field" }));
    const confirm = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteField") });
    await within(confirm).findByText(/2 card\(s\)/);
    await user.click(within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteField") }));

    const saving = within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.saving") });
    expect(saving).toBeDisabled();
    expect(within(confirm).getByRole("button", { name: tc("actions.cancel") })).toBeDisabled();
    fireEvent.click(saving);
    await user.keyboard("{Escape}");
    expect(confirm).toBeInTheDocument();
    expect(mockApi.callsOf("patch", /^\/metamodel\/types\//)).toHaveLength(1);

    rejectPatch(new Error("rescore failed"));
    expect(await within(confirm).findByText("rescore failed")).toBeInTheDocument();
    expect(
      within(confirm).getByRole("button", { name: ta("metamodel.typeDrawer.deleteField") }),
    ).toBeEnabled();
    expect(onRefresh).not.toHaveBeenCalled();

    // Cancelling and asking again starts from a clean confirmation.
    await user.click(within(confirm).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "stub-delete-field" }));
    const again = await screen.findByRole("dialog", { name: ta("metamodel.typeDrawer.deleteField") });
    expect(within(again).queryByText("rescore failed")).toBeNull();
  });
});
