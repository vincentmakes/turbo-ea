import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ApiError } from "@/api/client";
import { fieldLabel } from "@/hooks/useResolveLabel";
import { makeField, makeOption } from "@/test/fixtures/metamodel";
import { relationValueErrorCode, relationValueErrorMessage } from "./relationValueErrors";

const t = i18n.t.bind(i18n);
const labelOf = (e: Parameters<typeof fieldLabel>[0]) => fieldLabel(e, i18n.language);

const SCHEMA = [
  makeField({
    key: "usageType",
    label: "Usage",
    type: "single_select",
    translations: { de: "Nutzung" },
    options: [
      makeOption({ key: "creates", label: "Creates", translations: { de: "Erstellt" } }),
      makeOption({ key: "reads", label: "Reads" }),
    ],
  }),
];

const locked = (detail: Record<string, unknown>) =>
  new ApiError("Built-in relation value 'creates' cannot be edited", 403, {
    message: "Built-in relation value 'creates' cannot be edited",
    ...detail,
  });

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("relationValueErrorMessage", () => {
  it("names the value by its label, not its key", () => {
    const err = locked({ error: "relation_value_locked", attribute: "usageType", value: "creates" });
    expect(relationValueErrorCode(err)).toBe("relation_value_locked");
    expect(relationValueErrorMessage(err, t, SCHEMA, labelOf)).toBe(
      "The built-in value “Creates” cannot be edited. Hide it instead.",
    );
  });

  it("speaks the user's language, labels included", async () => {
    await i18n.changeLanguage("de");
    const err = locked({ error: "relation_value_locked", attribute: "usageType", value: "creates" });
    const msg = relationValueErrorMessage(err, t, SCHEMA, labelOf);
    expect(msg).toContain("Erstellt");
    expect(msg).not.toContain("Creates");
    expect(msg).toBe(
      t("admin:metamodel.relationValueErrors.relation_value_locked", { value: "Erstellt" }),
    );
  });

  it.each([
    ["relation_value_required", { value: "reads" }, "The built-in value “Reads” cannot be removed. Hide it instead."],
    ["relation_attribute_required", {}, "The built-in type “Usage” cannot be removed."],
    ["relation_attribute_locked", {}, "The built-in type “Usage” cannot be edited."],
  ])("translates %s", (code, extra, expected) => {
    const err = locked({ error: code, attribute: "usageType", ...extra });
    expect(relationValueErrorMessage(err, t, SCHEMA, labelOf)).toBe(expected);
  });

  it("falls back to the key when the schema does not hold the entry", () => {
    const err = locked({ error: "relation_value_locked", attribute: "gone", value: "vanished" });
    expect(relationValueErrorMessage(err, t, SCHEMA, labelOf)).toBe(
      "The built-in value “vanished” cannot be edited. Hide it instead.",
    );
    const noKeys = locked({ error: "relation_attribute_locked", attribute: 7 });
    expect(relationValueErrorMessage(noKeys, t, SCHEMA, labelOf)).toBe(
      "The built-in type “” cannot be edited.",
    );
  });

  it("names a value it cannot resolve by its key, or by nothing", () => {
    const numeric = locked({ error: "relation_value_locked", attribute: "usageType", value: 7 });
    expect(relationValueErrorMessage(numeric, t, SCHEMA, labelOf)).toBe(
      "The built-in value “” cannot be edited. Hide it instead.",
    );
    const missing = locked({ error: "relation_value_required", attribute: "usageType" });
    expect(relationValueErrorMessage(missing, t, SCHEMA, labelOf)).toBe(
      "The built-in value “” cannot be removed. Hide it instead.",
    );
    const noOptions = [makeField({ key: "usageType", label: "Usage", type: "single_select" })];
    const err = locked({ error: "relation_value_locked", attribute: "usageType", value: "creates" });
    expect(relationValueErrorMessage(err, t, noOptions, labelOf)).toBe(
      "The built-in value “creates” cannot be edited. Hide it instead.",
    );
  });

  it("shows a string detail as is", () => {
    const err = new ApiError("PATCH failed", 400, "Key already exists");
    expect(relationValueErrorCode(err)).toBeNull();
    expect(relationValueErrorMessage(err, t, SCHEMA, labelOf)).toBe("Key already exists");
  });

  it("falls back to the error's message for another code", () => {
    const err = new ApiError("Something else", 400, { error: "other" });
    expect(relationValueErrorCode(err)).toBeNull();
    expect(relationValueErrorMessage(err, t, SCHEMA, labelOf)).toBe("Something else");
  });

  it("falls back to the generic sentence for a non-error", () => {
    expect(relationValueErrorCode("nope")).toBeNull();
    expect(relationValueErrorCode({ detail: null })).toBeNull();
    expect(relationValueErrorMessage(null, t, SCHEMA, labelOf)).toBe(
      "Failed to save relation values",
    );
    expect(relationValueErrorMessage(new Error(""), t, SCHEMA, labelOf)).toBe(
      "Failed to save relation values",
    );
  });
});
