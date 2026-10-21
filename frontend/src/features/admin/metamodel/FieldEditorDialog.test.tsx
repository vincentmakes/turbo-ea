import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FieldEditorDialog from "./FieldEditorDialog";
import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { FieldDef } from "@/types";

// The dialog only calls the API for option-usage checks on removal, which this
// test never triggers. Stub it so nothing reaches the network.
vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ card_count: 0 }) },
}));


describe("FieldEditorDialog — new select option color", () => {
  it("seeds a default color on a newly-added option even when the picker is never touched", async () => {
    // Regression test for issue #718: adding a 6th option to an existing
    // single-select field and saving without clicking the color swatch used to
    // persist the option with no `color`, so its color dot never rendered. The
    // ColorPicker shows a #1976d2 fallback for display only, so the stored value
    // must now match that default WYSIWYG.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Option/ }));

    // The newly-added option row is the last "Key"/"Label" pair. (The field's
    // own label input reads as "Label (English)", so it is not matched here.)
    const keyInputs = screen.getAllByLabelText("Key");
    const labelInputs = screen.getAllByLabelText("Label");
    await user.type(keyInputs[keyInputs.length - 1], "newopt");
    await user.type(labelInputs[labelInputs.length - 1], "New Opt");

    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as FieldDef;
    const lastOption = saved.options![saved.options!.length - 1];
    expect(lastOption.key).toBe("newopt");
    expect(lastOption.color).toBe("#1976d2");
  });

  it("normalizes an existing colorless option to the default on save (issue #718)", async () => {
    // The reporter's option was saved (in an earlier version) with no `color`.
    // Re-opening the field and clicking Save — without touching any picker —
    // must now persist the displayed default so its dot finally renders.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [
        { key: "first", label: "First", color: "#ff0000" },
        { key: "sixth", label: "Sixth" }, // no color — the bug scenario
      ],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as FieldDef;
    expect(saved.options![0].color).toBe("#ff0000"); // explicit color preserved
    expect(saved.options![1].color).toBe("#1976d2"); // colorless option filled
  });

  it("blocks saving an option that has a label but no key (issue #718 follow-up)", async () => {
    // An option with an empty key would render in the card-detail dropdown but
    // select to value "" — never displayed, never saved. Save must stay disabled
    // until every new option carries a valid key.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Option/ }));

    // Fill only the label of the new option, leaving its key blank.
    const labelInputs = screen.getAllByLabelText("Label");
    await user.type(labelInputs[labelInputs.length - 1], "Keyless");

    // Save is disabled (and cannot be clicked) while the new option has no key.
    const saveButton = screen.getByRole("button", { name: /^Save$/ });
    expect(saveButton).toBeDisabled();

    // Providing a valid key unblocks Save.
    const keyInputs = screen.getAllByLabelText("Key");
    await user.type(keyInputs[keyInputs.length - 1], "keyless");
    expect(saveButton).toBeEnabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flags a new option's key red only once its label is typed", async () => {
    const user = userEvent.setup();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add Option/ }));

    const newKey = () => screen.getAllByLabelText("Key").at(-1)!;
    const newLabel = () => screen.getAllByLabelText("Label").at(-1)!;

    // Fresh row: key is empty but the label has not been started — no red.
    expect(newKey()).toHaveAttribute("aria-invalid", "false");

    // Start typing the label → the still-empty key turns red.
    await user.type(newLabel(), "In Progress");
    expect(newKey()).toHaveAttribute("aria-invalid", "true");

    // Filling the key clears the red.
    await user.type(newKey(), "inProgress");
    expect(newKey()).toHaveAttribute("aria-invalid", "false");
  });

  it("does not lock a new option whose key matches an existing key — flags it as duplicate instead", async () => {
    // Regression: the key lock was keyed on value-match, so typing a new
    // option's key equal to an existing one auto-locked the new row (blocking
    // the user and hiding the collision). It must stay editable and be flagged.
    const user = userEvent.setup();
    const onSave = vi.fn();

    const initial: FieldDef = {
      key: "myField",
      label: "My Field",
      type: "single_select",
      options: [{ key: "first", label: "First", color: "#ff0000" }],
    };

    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="myField"
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    // The pre-existing option's key is locked (cannot be renamed).
    const firstKey = () => screen.getAllByLabelText("Key")[0];
    expect(firstKey()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Add Option/ }));
    const newKey = () => screen.getAllByLabelText("Key").at(-1)!;
    const newLabel = () => screen.getAllByLabelText("Label").at(-1)!;
    await user.type(newLabel(), "Duplicate");
    await user.type(newKey(), "first"); // collides with the existing option

    // The new row stays editable (NOT locked) and is flagged as a duplicate.
    expect(newKey()).toBeEnabled();
    expect(newKey()).toHaveAttribute("aria-invalid", "true");

    // Save is blocked while the duplicate exists.
    const saveButton = screen.getByRole("button", { name: /^Save$/ });
    expect(saveButton).toBeDisabled();

    // Changing the key to a unique value clears the duplicate and unblocks Save.
    await user.clear(newKey());
    await user.type(newKey(), "second");
    expect(newKey()).toHaveAttribute("aria-invalid", "false");
    expect(saveButton).toBeEnabled();
  });
});

describe("FieldEditorDialog — locale-aware option labels (issue #857 follow-up)", () => {
  // Seeded built-in options carry a fully-populated translations map. Renaming
  // one used to write only `label`, so the stale translation for the admin's
  // current locale kept shadowing the new name everywhere option labels are
  // resolved (translations[locale] || label). The label input must read and
  // write the current locale's translation alongside the base label — the same
  // contract the field label input already honours.
  const initial: FieldDef = {
    key: "processType",
    label: "Process Type",
    type: "single_select",
    options: [
      {
        key: "management",
        label: "Management",
        color: "#9c27b0",
        translations: { en: "Management", fr: "Gestion" },
      },
    ],
  };

  const renderDialog = (onSave = vi.fn()) => {
    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="BusinessProcess"
        fieldKey="processType"
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    return onSave;
  };

  it("displays the current locale's translation when one exists", () => {
    renderDialog();
    // Tests run with locale "en"; translations.en wins over the base label.
    expect(screen.getAllByLabelText("Label").at(-1)).toHaveValue("Management");
  });

  it("writes a rename to both label and translations[locale], preserving other locales", async () => {
    const user = userEvent.setup();
    const onSave = renderDialog();

    const optionLabel = screen.getAllByLabelText("Label").at(-1)!;
    await user.clear(optionLabel);
    await user.type(optionLabel, "Strategic");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as FieldDef;
    const opt = saved.options![0];
    expect(opt.label).toBe("Strategic");
    expect(opt.translations).toEqual({ en: "Strategic", fr: "Gestion" });
  });
});

describe("FieldEditorDialog — extension-contributed field types", () => {
  const baseField: FieldDef = { key: "score", label: "Score", type: "text" };

  const renderDialog = () =>
    render(
      <FieldEditorDialog
        open
        field={baseField}
        typeKey="Gadget"
        fieldKey="score"
        onClose={() => {}}
        onSave={vi.fn()}
      />,
    );

  beforeEach(() => {
    resetExtensionHost();
  });

  it("lists extension-contributed field types in the Type dropdown", async () => {
    const user = userEvent.setup();
    registerExtension("plus", {
      key: "plus",
      sdkVersion: UI_SDK_VERSION,
      fieldTypes: [{ type: "ext.plus.rating", label: "Rating (Plus)", display: () => null }],
    });
    renderDialog();
    // Open the Type select; the custom type appears as an option.
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Rating (Plus)")).toBeInTheDocument();
  });
});

describe("FieldEditorDialog — type-aware config editor", () => {
  const RATING = "ext.daaf.rating";
  const registerRating = () =>
    registerExtension("daaf", {
      key: "daaf",
      sdkVersion: UI_SDK_VERSION,
      fieldTypes: [
        {
          type: RATING,
          label: "Rating",
          defaultConfig: { levels: ["low", "mid", "high"], rubric: { en: "How good?" } },
        },
      ],
    });

  const renderWith = (field: FieldDef, onSave = vi.fn()) => {
    render(
      <FieldEditorDialog
        open
        field={field}
        typeKey="Application"
        fieldKey={field.key}
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    return onSave;
  };

  beforeEach(() => {
    resetExtensionHost();
  });

  it("renders type-aware editors for array/object config — never [object Object]", () => {
    registerRating();
    renderWith({ key: "score", label: "Score", type: RATING, config: { levels: ["low", "mid"], rubric: { en: "Q" } } });
    // Array of scalars → editable rows with the values (not "[object Object]").
    expect(screen.getByDisplayValue("low")).toBeInTheDocument();
    expect(screen.getByDisplayValue("mid")).toBeInTheDocument();
    // Nested object → "Edit…" affordance.
    expect(screen.getByRole("button", { name: /Edit…/ })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("[object Object]")).not.toBeInTheDocument();
  });

  it("round-trips an object config edited through the JSON dialog", async () => {
    const user = userEvent.setup();
    const onSave = renderWith({
      key: "score",
      label: "Score",
      type: RATING,
      config: { levels: ["low"], rubric: { en: "Q" } },
    });
    await user.click(screen.getByRole("button", { name: /Edit…/ }));
    const jsonBox = screen.getByDisplayValue(/"en": "Q"/);
    await user.clear(jsonBox);
    await user.type(jsonBox, '{{"en":"Better?"}');
    const dialogs = screen.getAllByRole("dialog");
    await user.click(within(dialogs[dialogs.length - 1]).getByRole("button", { name: /^Save$/ }));
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as FieldDef).config!.rubric).toEqual({ en: "Better?" });
  });

  it("shows an error for invalid JSON", async () => {
    const user = userEvent.setup();
    renderWith({ key: "score", label: "Score", type: RATING, config: { rubric: { en: "Q" } } });
    await user.click(screen.getByRole("button", { name: /Edit…/ }));
    const jsonBox = screen.getByDisplayValue(/"en": "Q"/);
    await user.clear(jsonBox);
    await user.type(jsonBox, "{{not json");
    const dialogs = screen.getAllByRole("dialog");
    await user.click(within(dialogs[dialogs.length - 1]).getByRole("button", { name: /^Save$/ }));
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
  });

  it("renders an extension-owned field's config read-only with a Managed-by caption", () => {
    registerRating();
    renderWith({
      key: "score",
      label: "Score",
      type: RATING,
      ext: "daaf",
      config: { levels: ["low", "mid"], rubric: { en: "Q" } },
    });
    expect(screen.getByDisplayValue("low")).toBeDisabled();
    // No editing affordances for owned config (view-only for the object).
    expect(screen.queryByRole("button", { name: /Edit…/ })).not.toBeInTheDocument();
    // Once under the config and once under the (read-only) help input.
    expect(screen.getAllByText("Managed by daaf")).toHaveLength(2);
  });
});

describe("FieldEditorDialog — help text is core (#1297)", () => {
  const renderWith = (field: FieldDef, onSave = vi.fn()) => {
    render(
      <FieldEditorDialog
        open
        field={field}
        typeKey="Application"
        fieldKey={field.key}
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    return onSave;
  };

  beforeEach(() => resetExtensionHost());

  it("shows the Help text input with no extension installed", () => {
    renderWith({ key: "owner", label: "Owner", type: "text" });
    expect(screen.getByLabelText(/Help text/i)).toBeEnabled();
  });

  it("saves typed help as both the base string and the current locale's translation", async () => {
    const user = userEvent.setup();
    const onSave = renderWith({
      key: "owner",
      label: "Owner",
      type: "text",
      helpTranslations: { fr: "Qui en répond" },
    });
    await user.type(screen.getByLabelText(/Help text/i), "  Who answers for it  ");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    const saved = onSave.mock.calls[0][0] as FieldDef;
    expect(saved.help).toBe("Who answers for it");
    expect(saved.helpTranslations).toEqual({ fr: "Qui en répond", en: "Who answers for it" });
  });

  it("clears help that was emptied", async () => {
    const user = userEvent.setup();
    const onSave = renderWith({
      key: "owner",
      label: "Owner",
      type: "text",
      help: "Old",
      helpTranslations: { en: "Old" },
    });
    await user.clear(screen.getByLabelText(/Help text/i));
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    const saved = onSave.mock.calls[0][0] as FieldDef;
    expect(saved.help).toBeUndefined();
    expect(saved.helpTranslations).toBeUndefined();
  });

  it("keeps an extension-owned field's help read-only and saves it unchanged", async () => {
    const user = userEvent.setup();
    const onSave = renderWith({
      key: "owner",
      label: "Owner",
      type: "text",
      ext: "daaf",
      help: "From the manifest",
      helpTranslations: { en: "From the manifest", de: "Aus dem Manifest" },
    });
    const help = screen.getByLabelText(/Help text/i);
    expect(help).toBeDisabled();
    expect(help).toHaveValue("From the manifest");
    expect(screen.getByText("Managed by daaf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    const saved = onSave.mock.calls[0][0] as FieldDef;
    expect(saved.help).toBe("From the manifest");
    expect(saved.helpTranslations).toEqual({ en: "From the manifest", de: "Aus dem Manifest" });
  });
});

describe("FieldEditorDialog — reordering options (#1292)", () => {
  const initial: FieldDef = {
    key: "tier",
    label: "Tier",
    type: "single_select",
    options: [
      { key: "gold", label: "Gold", color: "#ffd700" },
      { key: "silver", label: "Silver", color: "#c0c0c0" },
      { key: "bronze", label: "Bronze", color: "#cd7f32" },
    ],
  };

  const renderDialog = (onSave = vi.fn()) => {
    render(
      <FieldEditorDialog
        open
        field={initial}
        typeKey="Application"
        fieldKey="tier"
        onClose={() => {}}
        onSave={onSave}
      />,
    );
    return onSave;
  };

  const savedKeys = (onSave: ReturnType<typeof vi.fn>) =>
    (onSave.mock.calls[0][0] as FieldDef).options!.map((o) => o.key);

  it("disables Move up on the first row and Move down on the last", () => {
    renderDialog();
    const ups = screen.getAllByRole("button", { name: "Move option up" });
    const downs = screen.getAllByRole("button", { name: "Move option down" });
    expect(ups.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, false, false]);
    expect(downs.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, true]);
  });

  it("moves an option down and saves the new order", async () => {
    const user = userEvent.setup();
    const onSave = renderDialog();
    await user.click(screen.getAllByRole("button", { name: "Move option down" })[0]);
    expect(screen.getAllByLabelText("Label").slice(-3).map((i) => (i as HTMLInputElement).value)).toEqual([
      "Silver",
      "Gold",
      "Bronze",
    ]);
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(savedKeys(onSave)).toEqual(["silver", "gold", "bronze"]);
  });

  it("moves an option up and keeps each option's own colour and lock", async () => {
    const user = userEvent.setup();
    const onSave = renderDialog();
    await user.click(screen.getAllByRole("button", { name: "Move option up" })[2]);
    // Every pre-existing key stays locked wherever it moved to.
    expect(screen.getAllByLabelText("Key").slice(-3).every((i) => (i as HTMLInputElement).disabled)).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    const saved = (onSave.mock.calls[0][0] as FieldDef).options!;
    expect(saved.map((o) => o.key)).toEqual(["gold", "bronze", "silver"]);
    expect(saved[1].color).toBe("#cd7f32");
    // The editor's transient row markers never reach the saved field.
    expect(saved.some((o) => "_rowId" in o || "_original" in o)).toBe(false);
  });

  it("moves a new, unsaved option above an existing one", async () => {
    const user = userEvent.setup();
    const onSave = renderDialog();
    await user.click(screen.getByRole("button", { name: /Add Option/ }));
    await user.type(screen.getAllByLabelText("Key").at(-1)!, "platinum");
    await user.type(screen.getAllByLabelText("Label").at(-1)!, "Platinum");
    for (let i = 0; i < 3; i++) {
      const ups = screen.getAllByRole("button", { name: "Move option up" });
      await user.click(ups[ups.length - 1 - i]);
    }
    // The new row is still editable at the top; the moved-down rows stay locked.
    const keys = screen.getAllByLabelText("Key").slice(-4) as HTMLInputElement[];
    expect(keys.map((k) => k.disabled)).toEqual([false, true, true, true]);
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(savedKeys(onSave)).toEqual(["platinum", "gold", "silver", "bronze"]);
  });
});

describe("FieldEditorDialog — while the parent saves", () => {
  const FIELD: FieldDef = { key: "myField", label: "My Field", type: "text" };

  function renderSaving(props: { saving?: boolean; error?: string | null } = {}) {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const utils = render(
      <FieldEditorDialog
        open
        field={FIELD}
        typeKey="Application"
        fieldKey="myField"
        onClose={onClose}
        onSave={onSave}
        {...props}
      />,
    );
    return { ...utils, onSave, onClose };
  }

  it("locks Save and Cancel, says it is saving, and cannot be dismissed", async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderSaving({ saving: true });
    const save = screen.getByRole("button", { name: "Saving..." });
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument();
    // A disabled button takes no pointer events, so dispatch the click directly.
    fireEvent.click(save);
    await user.keyboard("{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is Save and dismissible again once the parent is done", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSaving({ saving: false });
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the parent's failed save inside the dialog", () => {
    renderSaving({ error: "rescore failed" });
    expect(screen.getByRole("alert")).toHaveTextContent("rescore failed");
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeEnabled();
  });
});
