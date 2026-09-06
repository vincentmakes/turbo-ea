import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderReleaseNotes } from "./releaseNotesMarkdown";

function renderNotes(markdown: string) {
  return render(<div>{renderReleaseNotes(markdown)}</div>);
}

describe("renderReleaseNotes", () => {
  it("renders headings and groups consecutive bullets into one list", () => {
    const { container } = renderNotes(
      ["### Added", "- first thing", "- second thing", "", "### Fixed", "- third thing"].join("\n"),
    );

    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
    expect(container.querySelectorAll("ul")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("renders bold, italic and code inline", () => {
    const { container } = renderNotes("- **bold** and *italic* and `code`");

    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("code")).toHaveTextContent("code");
  });

  it("does not mistake a bold run for two italic runs", () => {
    const { container } = renderNotes("- **stakeholders** count once");

    expect(container.querySelector("strong")).toHaveTextContent("stakeholders");
    expect(container.querySelector("em")).toBeNull();
  });

  it("renders an http link as a new-tab anchor", () => {
    renderNotes("- see [the docs](https://turbo-ea.org/admin)");

    const link = screen.getByRole("link", { name: "the docs" });
    expect(link).toHaveAttribute("href", "https://turbo-ea.org/admin");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("refuses to turn a non-http scheme into a link", () => {
    // The body comes off a remote feed; a javascript: href must stay inert text.
    const { container } = renderNotes("- [click me](javascript:alert(1))");

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/click me/)).toBeInTheDocument();
  });

  it("never emits raw HTML from the source", () => {
    const { container } = renderNotes("- <img src=x onerror=alert(1)> done");

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)> done");
  });

  it("falls back to literal text for unsupported markdown", () => {
    const { container } = renderNotes("| a | b |\n| - | - |");

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("| a | b |");
  });

  it("joins a hard-wrapped bullet into one item, bold applied across the wrap", () => {
    // An extension changelog is wrapped at ~90 columns; the bullet must read
    // as one sentence and the bold run that straddles the wrap must render.
    const { container } = renderNotes(
      [
        "### Added",
        "- **The Rules and Runs tables remember how",
        "  you set them up.** Column widths, sort order and",
        "  which columns are shown all come back after a reload.",
        "- **Pause a rule** from the right-click menu.",
      ].join("\n"),
    );

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(items[0].querySelector("strong")).toHaveTextContent(
      "The Rules and Runs tables remember how you set them up.",
    );
    expect(items[0]).toHaveTextContent(
      "Column widths, sort order and which columns are shown all come back after a reload.",
    );
    expect(container.textContent).not.toContain("**");
  });

  it("gathers consecutive prose lines into one paragraph, blank line separates", () => {
    const { container } = renderNotes(
      ["First sentence that was", "wrapped by the editor.", "", "A second paragraph."].join("\n"),
    );

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("First sentence that was wrapped by the editor.");
    expect(paragraphs[1]).toHaveTextContent("A second paragraph.");
  });

  it("a heading or blank line closes a wrapped bullet", () => {
    const { container } = renderNotes(
      ["- one line", "  continued", "### Fixed", "- other", "", "trailing prose"].join("\n"),
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("li")[0]).toHaveTextContent("one line continued");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")).toHaveTextContent("trailing prose");
  });

  it("renders nothing for an empty body", () => {
    const { container } = renderNotes("");
    expect(container.textContent).toBe("");
  });
});
