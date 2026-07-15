import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { FieldDef, Relation } from "@/types";

import {
  bucketRelationsBySubtype,
  CardIdPill,
  FieldEditor,
  FieldValue,
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
