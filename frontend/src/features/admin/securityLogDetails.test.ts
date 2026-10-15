import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import {
  changeKindKey,
  classifyValue,
  describeDetails,
  describedValues,
  fieldLabelKey,
  formatBytes,
  formatTarget,
  hasPermissionValue,
  hasValueLabel,
  humanise,
  isChangePair,
  isEmptyDescription,
  isNameArg,
  rawTarget,
  settingLabelKey,
  splitTranslationProperty,
  targetTypeLabelKey,
  toSnake,
  translationScopeKey,
  valueFieldFor,
  valueLabelKey,
} from "./securityLogDetails";

const none = () => false;
const all = () => true;

describe("describeDetails — the four-key contract", () => {
  it("reads nothing from a missing or non-object payload", () => {
    for (const d of [null, undefined, "x", 3, ["a"]]) {
      expect(describeDetails(d)).toEqual({
        reason: null,
        items: [],
        changes: {},
        context: {},
        legacy: null,
      });
    }
  });

  it("splits reason, items, changes and context", () => {
    const d = describeDetails({
      reason: "bad_password",
      items: [{ kind: "field.added", field: "Criticality" }],
      changes: { role: { old: "viewer", new: "member" } },
      context: { count: 3, tags: ["a", "b"] },
    });
    expect(d).toEqual({
      reason: "bad_password",
      items: [{ kind: "field.added", field: "Criticality" }],
      changes: { role: { old: "viewer", new: "member" } },
      context: { count: 3, tags: ["a", "b"] },
      legacy: null,
    });
    expect(isEmptyDescription(d)).toBe(false);
  });

  it.each([
    ["a", true],
    ["bad_password", true],
    ["x1_2", true],
    ["a".repeat(40), true],
    ["a".repeat(41), false],
    ["Bad", false],
    ["two words", false],
    ["has-dash", false],
    ["", false],
  ])("treats reason %j as a code: %s", (reason, isCode) => {
    const d = describeDetails({ reason });
    expect(d.reason).toBe(isCode ? reason : null);
    if (isCode || reason === "") expect(d.context).toEqual({});
    else expect(d.context).toEqual({ reason });
  });

  it("keeps a non-string reason as context, and drops a null one", () => {
    expect(describeDetails({ reason: 42 }).context).toEqual({ reason: 42 });
    expect(describeDetails({ reason: null }).context).toEqual({});
    // toEqual ignores an undefined property, so ask for the key itself.
    expect("reason" in describeDetails({ reason: undefined }).context).toBe(false);
    expect("reason" in describeDetails({ reason: null }).context).toBe(false);
    expect(describeDetails({ reason: null }).reason).toBeNull();
  });

  it("drops malformed items into legacy and keeps the good ones", () => {
    const d = describeDetails({
      items: [{ kind: "a.b" }, { kind: "" }, { nokind: 1 }, "str", null, [1]],
    });
    expect(d.items).toEqual([{ kind: "a.b" }]);
    expect(d.legacy).toEqual({ items: [{ kind: "" }, { nokind: 1 }, "str", null, [1]] });
  });

  it("an all-valid item list leaves no legacy", () => {
    expect(describeDetails({ items: [{ kind: "x.y" }] }).legacy).toBeNull();
  });

  it("files a non-pair under `changes` and a nested value under `context` as legacy", () => {
    const d = describeDetails({
      changes: { a: { old: 1, new: 2 }, b: "flat" },
      context: {
        ok: "x",
        list: [1, "two", true, null],
        deep: { x: 1 },
        mixed: [{ a: 1 }],
        partly: [1, { a: 1 }],
        pair: { old: 1, new: 2 },
      },
    });
    expect(d.changes).toEqual({ a: { old: 1, new: 2 } });
    expect(d.context).toEqual({ ok: "x", list: [1, "two", true, null] });
    expect(d.legacy).toEqual({
      b: "flat",
      deep: { x: 1 },
      mixed: [{ a: 1 }],
      partly: [1, { a: 1 }],
      pair: { old: 1, new: 2 },
    });
  });

  it("reads a pre-contract row: pairs as changes, scalars as context, the rest as legacy", () => {
    const d = describeDetails({
      smtp_host: { old: "a", new: "b" },
      attempts: 3,
      provider: "google",
      domains: ["a.com"],
      nested: { a: [1, 2] },
      items: "not a list",
      changes: ["not", "an", "object"],
      context: "text",
    });
    expect(d.changes).toEqual({ smtp_host: { old: "a", new: "b" } });
    expect(d.context).toEqual({
      attempts: 3,
      provider: "google",
      domains: ["a.com"],
      items: "not a list",
      changes: ["not", "an", "object"],
      context: "text",
    });
    expect(d.legacy).toEqual({ nested: { a: [1, 2] } });
  });

  it("an empty payload is empty", () => {
    expect(isEmptyDescription(describeDetails({}))).toBe(true);
    expect(isEmptyDescription(describeDetails({ reason: "x", context: {} }))).toBe(true);
    expect(isEmptyDescription(describeDetails({ a: 1 }))).toBe(false);
    expect(isEmptyDescription(describeDetails({ a: { old: 1, new: 2 } }))).toBe(false);
    expect(isEmptyDescription(describeDetails({ items: [{ kind: "a.b" }] }))).toBe(false);
    expect(isEmptyDescription(describeDetails({ n: { x: 1 } }))).toBe(false);
  });

  it.each([
    [{ old: 1, new: 2 }, true],
    [{ old: null, new: null }, true],
    [{ old: 1 }, false],
    [{ new: 1 }, false],
    [null, false],
    [[1, 2], false],
    ["x", false],
  ])("isChangePair(%j) → %s", (v, out) => {
    expect(isChangePair(v)).toBe(out);
  });
});

describe("label keys", () => {
  it.each([
    ["smtp_host", "smtp_host"],
    ["smtpHost", "smtp_host"],
    ["date-format", "date_format"],
    ["a.b c", "a_b_c"],
    ["a..b", "a_b"],
    ["isActive2", "is_active2"],
  ])("toSnake(%s) → %s", (k, out) => {
    expect(toSnake(k)).toBe(out);
  });

  it.each([
    ["smtp_host", "Smtp host"],
    ["isActive", "Is active"],
    ["date-format", "Date format"],
    ["__description", "Description"],
    ["field.added", "Field added"],
    ["x", "X"],
    ["___", "___"],
  ])("humanise(%s) → %s", (k, out) => {
    expect(humanise(k)).toBe(out);
  });

  it("names a field generically, and scoped to a target type first", () => {
    expect(fieldLabelKey("smtp_host")).toEqual(["securityLog.fields.smtp_host"]);
    expect(fieldLabelKey("smtpHost", null)).toEqual(["securityLog.fields.smtp_host"]);
    expect(fieldLabelKey("label", "role")).toEqual([
      "securityLog.fields.role.label",
      "securityLog.fields.label",
    ]);
  });

  it("sanitises a code into its value key", () => {
    expect(valueLabelKey("1:n")).toBe("securityLog.values.1_n");
    expect(valueLabelKey("N:M")).toBe("securityLog.values.n_m");
    expect(valueLabelKey("__description")).toBe("securityLog.values.__description");
    expect(valueLabelKey("snow_to_turbo")).toBe("securityLog.values.snow_to_turbo");
  });

  it("names target types, settings and change kinds", () => {
    expect(targetTypeLabelKey("card_type")).toBe("securityLog.targetTypes.card_type");
    expect(settingLabelKey("date-format")).toBe("securityLog.settings.date-format");
    expect(changeKindKey("field.added")).toBe("securityLog.changes.field_added");
    expect(changeKindKey("type_permission.changed")).toBe(
      "securityLog.changes.type_permission_changed",
    );
    expect(changeKindKey("more")).toBe("securityLog.changes.more");
  });

  it("knows which codes this build labels", () => {
    expect(hasValueLabel("1:n")).toBe(true);
    expect(hasValueLabel("single_select")).toBe(true);
    expect(hasValueLabel("not_a_code_at_all")).toBe(false);
  });
});

describe("classifyValue", () => {
  it.each([
    [null, "x", "empty"],
    [undefined, "x", "empty"],
    ["", "x", "empty"],
    [[], "x", "empty"],
    [true, "x", "bool"],
    [false, "x", "bool"],
    ["***", "smtp_password", "masked"],
    ["#1a2B3c", "color", "color"],
    ["#12345", "color", "text"],
    ["#1234567", "color", "text"],
    ["2026-03-02T10:00:00Z", "anything", "datetime"],
    ["2026-99-99T99:99", "anything", "text"],
    ["2026-03-02", "locked_until", "datetime"],
    ["2026-03-02", "expires_at", "datetime"],
    ["not a date", "locked_until", "text"],
    ["2026-03-02", "created", "text"],
    [2048, "size_bytes", "bytes"],
    [2048, "fileSize", "bytes"],
    [2048, "count", "number"],
    ["inventory.view", "permission", "permission"],
    ["card.*", "permissions", "permission"],
    ["inventory.view", "other", "text"],
    ["Not a key", "permission", "text"],
    ["de", "locale", "locale"],
    ["fr", "locales", "locale"],
    [["a"], "x", "list"],
    [{ a: 1 }, "x", "text"],
    [{ a: 1 }, "locale", "text"],
    [7, "locale", "number"],
    ["Free text", "x", "text"],
  ])("%j under %s → %s", (value, field, out) => {
    expect(classifyValue(value, field, none)).toBe(out);
  });

  it("reads a short token as a code only when it has a label", () => {
    expect(classifyValue("single", "mode", all)).toBe("code");
    expect(classifyValue("1:n", "cardinality", all)).toBe("code");
    expect(classifyValue("single", "mode", none)).toBe("text");
    expect(classifyValue("Two Words", "mode", all)).toBe("text");
    expect(classifyValue("a".repeat(41), "mode", all)).toBe("text");
    // The default lookup is this build's catalogue.
    expect(classifyValue("single_select", "type")).toBe("code");
    expect(classifyValue("no_such_code", "type")).toBe("text");
  });

  it("never reads a label, slug or email as a code — except the description section", () => {
    expect(classifyValue("lifecycle", "item")).toBe("code");
    for (const field of ["label", "slug", "section", "role", "email", "from_section"]) {
      expect(classifyValue("cards", field, all), field).toBe("text");
    }
    expect(classifyValue("__description", "section", none)).toBe("code");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [12 * 1024 + 300, "12 KB"],
    [1024 * 1024 - 1, "1024 KB"],
    [1024 * 1024, "1 MB"],
    [1.3 * 1024 * 1024, "1.3 MB"],
  ])("%d → %s", (n, out) => {
    expect(formatBytes(n)).toBe(out);
  });
});

describe("item arguments", () => {
  it("labels property and component everywhere, option and field only where they are names", () => {
    expect(isNameArg("field.changed", "property")).toBe(true);
    expect(isNameArg("quality_weight.changed", "component")).toBe(true);
    expect(isNameArg("portal_option.changed", "option")).toBe(true);
    expect(isNameArg("option.added", "option")).toBe(false);
    expect(isNameArg("user.changed", "field")).toBe(true);
    expect(isNameArg("field.added", "field")).toBe(false);
    expect(isNameArg("field.added", "section")).toBe(false);
  });

  it("classifies a change's old/new under what changed", () => {
    const fieldChange = { kind: "field.changed", property: "required", old: true, new: false };
    expect(valueFieldFor(fieldChange, "old")).toBe("required");
    expect(valueFieldFor(fieldChange, "new")).toBe("required");
    expect(valueFieldFor(fieldChange, "property")).toBe("property");
    const userChange = { kind: "user.changed", field: "locked_until", property: "x", old: 1 };
    expect(valueFieldFor(userChange, "old")).toBe("locked_until");
    expect(valueFieldFor({ kind: "section.renamed", old: "A", new: "B" }, "old")).toBe("old");
    expect(valueFieldFor({ kind: "x.changed", property: "", old: 1 }, "old")).toBe("old");
    expect(valueFieldFor({ kind: "x.changed", property: 3, old: 1 }, "old")).toBe("old");
  });

  it("splits a translation target property", () => {
    expect(splitTranslationProperty("field:Business criticality")).toEqual({
      scope: "field",
      name: "Business criticality",
    });
    expect(splitTranslationProperty("option:High")).toEqual({ scope: "option", name: "High" });
    expect(splitTranslationProperty("field_help:Owner")).toEqual({
      scope: "field_help",
      name: "Owner",
    });
    expect(splitTranslationProperty("section:A: B")).toEqual({ scope: "section", name: "A: B" });
    expect(splitTranslationProperty("label")).toBeNull();
    expect(splitTranslationProperty("field:")).toBeNull();
    expect(splitTranslationProperty("Field:a")).toBeNull();
    expect(splitTranslationProperty("x field:a")).toBeNull();
  });

  it("labels every translation scope the backend writes", () => {
    expect(translationScopeKey("field_help")).toBe("securityLog.values.translation_scope_field_help");
    for (const scope of [
      "section",
      "group",
      "field",
      "field_help",
      "field_badge",
      "option",
      "subtype",
      "hierarchy_label",
      "stakeholder_role",
    ]) {
      expect(i18n.exists(`admin:${translationScopeKey(scope)}`), scope).toBe(true);
    }
  });
});

describe("describedValues / hasPermissionValue", () => {
  it("walks items, changes and context, flattening lists", () => {
    const d = describeDetails({
      items: [{ kind: "field.changed", property: "required", old: true, new: false }],
      changes: { tags: { old: ["a"], new: ["a", "b"] } },
      context: { count: 2 },
    });
    expect(describedValues(d)).toEqual([
      { value: "required", field: "property" },
      { value: true, field: "required" },
      { value: false, field: "required" },
      { value: "a", field: "tags" },
      { value: "a", field: "tags" },
      { value: "b", field: "tags" },
      { value: 2, field: "count" },
    ]);
  });

  it.each([
    [{ items: [{ kind: "permission.granted", permission: "inventory.view" }] }, true],
    [{ changes: { permissions: { old: [], new: ["card.edit"] } } }, true],
    [{ context: { permission: "admin.users" } }, true],
    [{ context: { permission: "Not a key" } }, false],
    [{ context: { role: "admin.users" } }, false],
    [{ items: [{ kind: "permission.wildcard", granted: true }] }, false],
    [{}, false],
  ])("%j → %s", (details, out) => {
    expect(hasPermissionValue(describeDetails(details))).toBe(out);
  });
});

describe("formatTarget / rawTarget", () => {
  const t = (key: string, opts: { defaultValue: string }) =>
    key === "securityLog.targetTypes.role"
      ? "Role"
      : key === "securityLog.settings.date-format"
        ? "Date format"
        : opts.defaultValue;

  it.each([
    [{ target_type: null, target_id: null, target_label: null }, null, null],
    [{ target_type: "role", target_id: null, target_label: null }, null, null],
    [{ target_type: null, target_id: "abc", target_label: null }, "abc", "abc"],
    [{ target_type: "role", target_id: "viewer", target_label: "Viewer" }, "Role · Viewer", "role · Viewer"],
    [{ target_type: "role", target_id: "viewer", target_label: null }, "Role · viewer", "role · viewer"],
    // Only a setting is named through the setting labels, even when its id matches a slug.
    [
      { target_type: "role", target_id: "date-format", target_label: "Viewer" },
      "Role · Viewer",
      "role · Viewer",
    ],
    [
      { target_type: "brand_new", target_id: "x", target_label: "X" },
      "Brand new · X",
      "brand_new · X",
    ],
    [
      { target_type: "setting", target_id: "date-format", target_label: "date-format" },
      "Setting · Date format",
      "setting · date-format",
    ],
    [
      { target_type: "setting", target_id: null, target_label: "date-format" },
      "Setting · Date format",
      "setting · date-format",
    ],
    [
      { target_type: "setting", target_id: "unknown-slug", target_label: "Shown" },
      "Setting · Shown",
      "setting · Shown",
    ],
  ])("%j → %s", (entry, formatted, raw) => {
    expect(formatTarget(entry, t)).toBe(formatted);
    expect(rawTarget(entry)).toBe(raw);
  });
});
