import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

import { registerExtension, resetExtensionHost, UI_SDK_VERSION } from "@/lib/extensionHost";
import type { FieldDef } from "@/types";

import { FieldEditor, FieldValue } from "./cardDetailUtils";

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
