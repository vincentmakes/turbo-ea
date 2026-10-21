import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { FieldDef, Relation } from "@/types";
import { BOOLEAN_COLORS } from "@/theme/tokens";

import {
  bucketBySubtype,
  bucketRelationsBySubtype,
  CardIdPill,
  FieldEditor,
  FieldValue,
  isEmptyAttrValue,
  isEnforcedRequiredField,
  missingRequiredFields,
  NO_SUBTYPE_KEY,
  shouldGroupBySubtype,
} from "./cardDetailUtils";

function registerRating() {
  registerExtension("plus", {
    key: "plus",
    sdkVersion: UI_SDK_VERSION,
    fieldTypes: [
      {
        type: "ext.plus.rating",
        label: "Rating",
        display: ({ value }) => <span>rated-{String(value)}</span>,
        editor: ({ value, onChange }) => (
          <button onClick={() => onChange(5)}>editor-{String(value)}</button>
        ),
      },
    ],
  });
}

const ratingField: FieldDef = { key: "score", label: "Score", type: "ext.plus.rating" };

describe("custom field type rendering", () => {
  beforeEach(() => resetExtensionHost());

  it("FieldValue uses the extension display when the type is registered", () => {
    registerRating();
    render(<FieldValue field={ratingField} value={4} />);
    expect(screen.getByText("rated-4")).toBeInTheDocument();
  });

  it("FieldEditor uses the extension editor when the type is registered", () => {
    registerRating();
    render(<FieldEditor field={ratingField} value={3} onChange={() => {}} />);
    expect(screen.getByText("editor-3")).toBeInTheDocument();
  });

  it("degrades to a read-only text rendering when the extension is absent", () => {
    // No extension registered → the custom type is unknown → the stored value
    // still renders (never blank, never lost).
    render(<FieldValue field={ratingField} value={4} />);
    expect(screen.queryByText("rated-4")).not.toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

describe("collapsible field help", () => {
  beforeEach(() => resetExtensionHost());

  it("renders help toggle and guidance under an editable field", () => {
    render(
      <FieldEditor
        field={{ key: "name", label: "Name", type: "text", help: "Enter the legal name." }}
        value=""
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Help")).toBeInTheDocument();
    // Toggling does not throw and the guidance is present in the DOM.
    fireEvent.click(screen.getByText("Help"));
    expect(screen.getByText("Enter the legal name.")).toBeInTheDocument();
  });

  it("opens and closes the guidance from the toggle", () => {
    // fireEvent, not userEvent.setup(): setup() replaces navigator.clipboard
    // with a getter-only stub, which breaks the CardIdPill copy test below.
    render(
      <FieldEditor
        field={{ key: "name", label: "Name", type: "text", help: "Enter the legal name." }}
        value=""
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Help/ });
    expect(within(toggle).getByText("expand_more")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(toggle).getByText("expand_less")).toBeInTheDocument();
    expect(screen.getByText("Enter the legal name.")).toBeVisible();
    fireEvent.click(toggle);
    expect(within(toggle).getByText("expand_more")).toBeInTheDocument();
  });

  it("underlines only the caption on hover, never the icons", () => {
    render(
      <FieldEditor
        field={{ key: "name", label: "Name", type: "text", help: "Enter the legal name." }}
        value=""
        onChange={() => {}}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Help/ });
    const caption = within(toggle).getByText("Help");
    const icons = [within(toggle).getByText("help"), within(toggle).getByText("expand_more")];
    // The caption is its own element, a direct child of the button, which is
    // what the `button:hover > &` rule needs; the icons are its siblings.
    expect(caption.parentElement).toBe(toggle);
    for (const icon of icons) expect(icon.parentElement).toBe(toggle);

    // Emotion injects each rule as text; read them back.
    const css = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    const rulesFor = (el: Element) =>
      Array.from(el.classList)
        .filter((c) => c.startsWith("css-"))
        .flatMap((c) => css.split("}").filter((rule) => rule.includes(`.${c}`)));
    const captionRules = rulesFor(caption);
    expect(
      captionRules.some((r) => /button:hover\s*>\s*\.css-/.test(r) && /text-decoration:\s*underline/.test(r)),
    ).toBe(true);
    // The button itself carries no underline any more, so nothing under the
    // icons can inherit one.
    expect(rulesFor(toggle).some((r) => /underline/.test(r))).toBe(false);
    for (const icon of icons) {
      expect(rulesFor(icon).some((r) => /underline/.test(r))).toBe(false);
      expect((icon as HTMLElement).style.textDecoration).toBe("");
    }
  });

  it("shows no help affordance when the field has none", () => {
    render(
      <FieldEditor field={{ key: "name", label: "Name", type: "text" }} value="" onChange={() => {}} />,
    );
    expect(screen.queryByText("Help")).not.toBeInTheDocument();
  });
});

// ── Subtype bucketing (#792) ────────────────────────────────────
const FS = "self";
let relSeq = 0;
function rel(subtype: string | undefined, name: string): Relation {
  relSeq += 1;
  return {
    id: `r${relSeq}`,
    type: "app_to_org",
    source_id: FS,
    target_id: `t${relSeq}`,
    target: { id: `t${relSeq}`, type: "Organization", name, subtype },
  };
}

describe("bucketRelationsBySubtype", () => {
  const order = ["businessUnit", "region", "team"];

  it("emits buckets in metamodel order, skipping empty subtypes", () => {
    const rels = [
      rel("team", "Alpha Team"),
      rel("businessUnit", "Europe BU"),
      rel("team", "Beta Team"),
    ];
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    expect(buckets.map((b) => b.key)).toEqual(["businessUnit", "team"]);
    expect(buckets.map((b) => b.rels.length)).toEqual([1, 2]);
  });

  it("sorts cards alphabetically by name within a bucket", () => {
    const rels = [rel("team", "Zeta"), rel("team", "alpha"), rel("team", "Mid")];
    const [bucket] = bucketRelationsBySubtype(rels, FS, order);
    const names = bucket.rels.map((r) => r.target?.name);
    expect(names).toEqual(["alpha", "Mid", "Zeta"]);
  });

  it("collects falsy and stale-key subtypes into a trailing no-subtype bucket", () => {
    const rels = [
      rel("businessUnit", "Europe BU"),
      rel(undefined, "Unclassified"),
      rel("legacyKey", "Stale Subtype"),
    ];
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    expect(buckets.map((b) => b.key)).toEqual(["businessUnit", NO_SUBTYPE_KEY]);
    const noSub = buckets[buckets.length - 1];
    expect(noSub.isNoSubtype).toBe(true);
    expect(noSub.rels.map((r) => r.target?.name)).toEqual(["Stale Subtype", "Unclassified"]);
  });

  it("omits the no-subtype bucket when every card is classified", () => {
    const rels = [rel("team", "A"), rel("region", "B")];
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    expect(buckets.some((b) => b.isNoSubtype)).toBe(false);
  });

  it("resolves the 'other' card via source when the viewed card is the target", () => {
    const incoming: Relation = {
      id: "in1",
      type: "app_to_org",
      source_id: "src1",
      target_id: FS,
      source: { id: "src1", type: "Organization", name: "Inbound", subtype: "region" },
    };
    const [bucket] = bucketRelationsBySubtype([incoming], FS, order);
    expect(bucket.key).toBe("region");
    expect(bucket.rels[0].source?.name).toBe("Inbound");
  });
});

describe("bucketBySubtype", () => {
  type Item = { name: string; st?: string | null };
  const items: Item[] = [
    { name: "beta", st: "b" },
    { name: "Alpha", st: "b" },
    { name: "zed", st: "a" },
    { name: "none" },
    { name: "Stale", st: "gone" },
  ];
  const run = (order: string[]) =>
    bucketBySubtype(items, (i) => i.st, (i) => i.name, order, "en");

  it("emits buckets in metamodel order, skipping empty ones, then No subtype", () => {
    const buckets = run(["a", "unused", "b"]);
    expect(buckets.map((b) => [b.key, b.isNoSubtype])).toEqual([
      ["a", false],
      ["b", false],
      [NO_SUBTYPE_KEY, true],
    ]);
  });

  it("sorts each bucket by name, case-insensitively", () => {
    const buckets = run(["a", "b"]);
    expect(buckets[1].items.map((i) => i.name)).toEqual(["Alpha", "beta"]);
    expect(buckets[2].items.map((i) => i.name)).toEqual(["none", "Stale"]);
  });

  it("collects missing and stale subtypes in the trailing bucket", () => {
    const buckets = run(["a", "b"]);
    expect(buckets[2].items).toHaveLength(2);
    expect(buckets.reduce((n, b) => n + b.items.length, 0)).toBe(items.length);
  });

  it("returns no buckets for no items", () => {
    expect(bucketBySubtype<Item>([], (i) => i.st, (i) => i.name, ["a"])).toEqual([]);
  });
});

describe("shouldGroupBySubtype", () => {
  const order = ["businessUnit", "region", "team"];
  const many = (n: number, subtype: string) =>
    Array.from({ length: n }, (_, i) => rel(subtype, `${subtype}-${i}`));

  it("groups when there are >=2 subtypes and the total meets the threshold", () => {
    const rels = [...many(4, "team"), ...many(4, "region")];
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    expect(shouldGroupBySubtype(buckets, rels.length)).toBe(true);
  });

  it("does not group a single-subtype section however large", () => {
    const rels = many(20, "team");
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    expect(shouldGroupBySubtype(buckets, rels.length)).toBe(false);
  });

  it("does not group below the count threshold even with multiple subtypes", () => {
    const rels = [...many(2, "team"), ...many(2, "region")];
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    expect(shouldGroupBySubtype(buckets, rels.length)).toBe(false);
  });

  it("ignores the no-subtype bucket when counting real subtype groups", () => {
    const rels = [...many(7, "team"), rel(undefined, "Unclassified")];
    const buckets = bucketRelationsBySubtype(rels, FS, order);
    // Only one real subtype ("team") → no grouping even though total >= 8.
    expect(shouldGroupBySubtype(buckets, rels.length)).toBe(false);
  });
});

describe("CardIdPill (#811)", () => {
  it("renders nothing when there is no reference", () => {
    const { container } = render(<CardIdPill reference={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the reference when present", () => {
    render(<CardIdPill reference="APP-10000" typeColor="#0f7eb5" />);
    expect(screen.getByText("APP-10000")).toBeInTheDocument();
  });

  it("copies the reference to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CardIdPill reference="APP-10000" typeColor="#0f7eb5" />);
    fireEvent.click(screen.getByText("APP-10000"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("APP-10000"));
  });
});

describe("mandatory-field helpers", () => {
  const typeConfig = {
    fields_schema: [
      {
        section: "Details",
        fields: [
          { key: "criticality", label: "Criticality", type: "text", required: true },
          {
            key: "hosting",
            label: "Hosting",
            type: "multiple_select",
            required: true,
            options: [{ key: "cloud", label: "Cloud" }],
          },
          { key: "gdpr", label: "GDPR", type: "boolean", required: true },
          { key: "score2", label: "Score", type: "number", required: true, readonly: true },
          { key: "notes", label: "Notes", type: "text" },
        ] as FieldDef[],
      },
    ],
    subtypes: [{ key: "micro", label: "Micro", hidden_fields: ["criticality"] }],
  };

  it("isEmptyAttrValue treats null/undefined/empty-string/empty-array as empty", () => {
    expect(isEmptyAttrValue(null)).toBe(true);
    expect(isEmptyAttrValue(undefined)).toBe(true);
    expect(isEmptyAttrValue("")).toBe(true);
    expect(isEmptyAttrValue([])).toBe(true);
    expect(isEmptyAttrValue(0)).toBe(false);
    expect(isEmptyAttrValue(false)).toBe(false);
    expect(isEmptyAttrValue(["x"])).toBe(false);
    expect(isEmptyAttrValue("x")).toBe(false);
  });

  it("isEnforcedRequiredField exempts boolean and readonly fields", () => {
    const fields = typeConfig.fields_schema[0].fields;
    expect(isEnforcedRequiredField(fields[0])).toBe(true); // text
    expect(isEnforcedRequiredField(fields[1])).toBe(true); // multiple_select
    expect(isEnforcedRequiredField(fields[2])).toBe(false); // boolean
    expect(isEnforcedRequiredField(fields[3])).toBe(false); // readonly
    expect(isEnforcedRequiredField(fields[4])).toBe(false); // not required
  });

  it("missingRequiredFields lists empty enforced-required fields", () => {
    const missing = missingRequiredFields(typeConfig, null, { hosting: [] });
    expect(missing.map((f) => f.key)).toEqual(["criticality", "hosting"]);
  });

  it("missingRequiredFields respects subtype hidden fields", () => {
    const missing = missingRequiredFields(typeConfig, "micro", {});
    expect(missing.map((f) => f.key)).toEqual(["hosting"]);
  });

  it("missingRequiredFields is empty once everything is filled", () => {
    expect(
      missingRequiredFields(typeConfig, null, { criticality: "high", hosting: ["cloud"] }),
    ).toEqual([]);
  });

  it("missingRequiredFields handles a missing type config", () => {
    expect(missingRequiredFields(undefined, null, {})).toEqual([]);
  });
});


describe("percentage field type", () => {
  const progress: FieldDef = { key: "progress", label: "Progress", type: "percentage" };

  it("FieldValue draws a bar and the rounded number", () => {
    render(<FieldValue field={progress} value={42.4} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("FieldValue shows a dash for a blank", () => {
    render(<FieldValue field={progress} value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("FieldEditor offers a slider and a number box that write the same value", () => {
    const onChange = vi.fn();
    render(<FieldEditor field={progress} value={20} onChange={onChange} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "20");
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "65" } });
    expect(onChange).toHaveBeenLastCalledWith(65);
  });
});

describe("boolean field type (#1266)", () => {
  const flag: FieldDef = { key: "commercial", label: "Commercial Application", type: "boolean" };

  it("FieldValue shows true as a green Yes pill", () => {
    render(<FieldValue field={flag} value={true} />);
    const chip = screen.getByText("Yes").closest(".MuiChip-root");
    expect(chip).toHaveStyle({ backgroundColor: BOOLEAN_COLORS.true });
    expect(screen.queryByText("No")).not.toBeInTheDocument();
  });

  it("FieldValue shows false as a blue No pill, not an empty mark", () => {
    render(<FieldValue field={flag} value={false} />);
    const chip = screen.getByText("No").closest(".MuiChip-root");
    expect(chip).toHaveStyle({ backgroundColor: BOOLEAN_COLORS.false });
  });

  it("FieldValue reads a legacy string as the pill it means", () => {
    render(<FieldValue field={flag} value="yes" />);
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it.each([null, "", "maybe"])("FieldValue shows a dash for an unset value (%j)", (value) => {
    render(<FieldValue field={flag} value={value} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(document.querySelector(".MuiChip-root")).toBeNull();
  });

  it("FieldEditor is a Yes / No dropdown with Not set to clear", async () => {
    const onChange = vi.fn();
    render(<FieldEditor field={flag} value={undefined} onChange={onChange} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: /Commercial Application/ }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Not set",
      "Yes",
      "No",
    ]);
    await userEvent.click(within(listbox).getByRole("option", { name: "No" }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("FieldEditor clears a set value through Not set", async () => {
    const onChange = vi.fn();
    render(<FieldEditor field={flag} value={true} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Yes");
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Not set" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("FieldEditor shows the error message under a boolean", () => {
    render(<FieldEditor field={flag} value={null} onChange={() => {}} error="Pick a value" />);
    expect(screen.getByText("Pick a value")).toBeInTheDocument();
  });
});

describe("links in free text (FieldValue)", () => {
  const notes: FieldDef = { key: "notes", label: "Notes", type: "multiline_text" };
  const plain: FieldDef = { key: "plain", label: "Plain", type: "text" };
  const site: FieldDef = { key: "site", label: "Site", type: "url" };

  it("turns an address in a multi-line field into a new-tab link and keeps pre-wrap", () => {
    render(<FieldValue field={notes} value={"see https://a.io/doc.\nnext line"} />);
    const link = screen.getByRole("link", { name: "https://a.io/doc" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText(/next line/)).toHaveStyle({ whiteSpace: "pre-wrap" });
  });

  it("links a plain text field too, and never a javascript: scheme", () => {
    render(<FieldValue field={plain} value="go https://b.io now" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://b.io");
    const { container } = render(<FieldValue field={plain} value="javascript:alert(1)" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders a url-typed value as one link, mailto included", () => {
    render(<FieldValue field={site} value="mailto:ops@a.io" />);
    expect(screen.getByRole("link", { name: "mailto:ops@a.io" })).toHaveAttribute(
      "href",
      "mailto:ops@a.io",
    );
  });
});

describe("multiple_select chips follow the option order (#1292)", () => {
  const tiers: FieldDef = {
    key: "tiers",
    label: "Tiers",
    type: "multiple_select",
    options: [
      { key: "gold", label: "Gold", color: "#ffd700" },
      { key: "silver", label: "Silver", color: "#c0c0c0" },
      { key: "bronze", label: "Bronze", color: "#cd7f32" },
    ],
  };

  const chipOrder = (labels: string[]) =>
    labels
      .map((l) => ({ l, el: screen.getByText(l) }))
      .sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      .map((x) => x.l);

  it("FieldValue renders stored values in option order, unknown keys last", () => {
    render(<FieldValue field={tiers} value={["bronze", "legacy", "gold"]} />);
    expect(chipOrder(["Bronze", "legacy", "Gold"])).toEqual(["Gold", "Bronze", "legacy"]);
  });

  it("FieldEditor's selected chips use the same order", () => {
    render(<FieldEditor field={tiers} value={["bronze", "silver"]} onChange={() => {}} />);
    expect(chipOrder(["Bronze", "Silver"])).toEqual(["Silver", "Bronze"]);
  });
});
