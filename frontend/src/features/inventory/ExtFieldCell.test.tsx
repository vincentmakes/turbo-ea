import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import ExtFieldCell from "./ExtFieldCell";
import { registerExtension, resetExtensionHost } from "@/lib/extensionHost";
import type { FieldDef } from "@/types";

const FIELD: FieldDef = {
  key: "score",
  label: "Score",
  type: "ext.sample.score",
  weight: 0,
};

describe("ExtFieldCell", () => {
  beforeEach(() => {
    resetExtensionHost();
  });

  it("renders the registered field-type display component", () => {
    registerExtension("sample", {
      key: "sample",
      sdkVersion: "1.18",
      fieldTypes: [
        {
          type: "ext.sample.score",
          label: "Score",
          display: ({ value }) => <div data-testid="ext-display">{String(value)}%</div>,
        },
      ],
    });
    render(<ExtFieldCell field={FIELD} value={75} />);
    expect(screen.getByTestId("ext-display")).toHaveTextContent("75%");
  });

  it("degrades to the plain value when no display is registered", () => {
    render(<ExtFieldCell field={FIELD} value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders nothing for an empty value without a registered display", () => {
    const { container } = render(<ExtFieldCell field={FIELD} value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
