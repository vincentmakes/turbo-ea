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

  it("renders nothing for an empty body", () => {
    const { container } = renderNotes("");
    expect(container.textContent).toBe("");
  });
});
