/**
 * A line label's text: its wrapped lines under one another, centred, or
 * nothing at all when there is no text.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import LdvEdgeLabelText from "./LdvEdgeLabelText";

describe("LdvEdgeLabelText", () => {
  it("draws each line under the one before it, centred", () => {
    const { container } = render(
      <LdvEdgeLabelText lines={["is supported by", "[Create · Read · Update · Delete]"]} />,
    );
    const span = container.querySelector("span")!;
    // white-space: pre turns the newline into a line break, and keeps the
    // spaces either side of each "·".
    expect(span.textContent).toBe("is supported by\n[Create · Read · Update · Delete]");
    expect(span).toHaveStyle({ whiteSpace: "pre", textAlign: "center" });
  });

  it("draws a single line as it is", () => {
    const { container } = render(<LdvEdgeLabelText lines={["uses"]} />);
    expect(container.querySelector("span")!.textContent).toBe("uses");
  });

  it("draws nothing when there is no text", () => {
    const { container } = render(<LdvEdgeLabelText lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
