import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: (n: number) => String(n), fmtShort: (n: number) => String(n), symbol: "$" }),
}));

import i18n from "@/i18n";
import type { Card, SectionDef } from "@/types";
import AttributeSection from "./AttributeSection";

const section: SectionDef & { columns?: 1 | 2 } = {
  section: "Digital",
  columns: 1,
  fields: [
    { key: "a", label: "Alpha", type: "text" },
    { key: "b", label: "Bravo", type: "text", badge: "Quick" },
    { key: "c", label: "Charlie", type: "text" },
  ],
};

const card = {
  id: "card-1",
  type: "Application",
  name: "Test",
  attributes: { a: "x", b: "y", c: "z" },
} as unknown as Card;

function renderSection() {
  return render(
    <AttributeSection section={section} card={card} onSave={async () => {}} canEdit={false} />,
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

describe("AttributeSection badge + filter", () => {
  it("renders a badge chip next to a badged field's label", () => {
    renderSection();
    // Both the field's chip and the filter toggle carry the text "Quick".
    expect(screen.getAllByText("Quick").length).toBeGreaterThanOrEqual(2);
    // The filter row exposes an "All" control.
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("filtering by a badge narrows the visible fields; All restores them", () => {
    renderSection();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quick" }));
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("shows no filter row when no field carries a badge", () => {
    render(
      <AttributeSection
        section={{ section: "Plain", columns: 1, fields: [{ key: "a", label: "Alpha", type: "text" }] }}
        card={card}
        onSave={async () => {}}
        canEdit={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
  });
});

describe("AttributeSection keeps the section in view after save", () => {
  it("restores the section's pre-save viewport position across the parent's card re-render", async () => {
    // Simulated viewport: the section header sits at top=400 before save. The
    // save triggers the parent's setCard re-render + the edit→read collapse,
    // which (in this simulation) shift the section to top=-800. scrollBy is
    // mocked to move the simulated viewport, so a correct compensation brings
    // the header back to exactly its pre-save position.
    let top = 400;
    const scrollBy = vi.fn((_x: number, y: number) => {
      top -= y; // scrolling down by y moves element tops up by y
    });
    vi.stubGlobal("scrollBy", scrollBy);

    function Harness() {
      // Mimics CardDetailContent.handleUpdate → setCard: the card prop gets a
      // NEW object identity after save, re-rendering the whole card.
      const [c, setC] = useState(card);
      return (
        <AttributeSection
          section={section}
          card={c}
          canEdit
          onSave={async () => {
            top = -800; // the post-save reflow moves the section off-screen
            setC((prev) => ({ ...prev }) as typeof prev);
          }}
        />
      );
    }

    const { container } = render(<Harness />);
    const root = container.querySelector(".MuiAccordion-root") as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockImplementation(
      () => ({ top }) as unknown as DOMRect,
    );

    // Enter edit mode (the pencil IconButton renders the "edit" ligature).
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The layout-effect compensation scrolls by (current - before) = -1200…
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith(0, -1200));
    // …which puts the header back at its pre-save viewport position.
    expect(top).toBe(400);
  });
});

describe("AttributeSection group header translation", () => {
  const groupedSection: SectionDef & { columns?: 1 | 2 } = {
    section: "Dimensions",
    columns: 1,
    groupTranslations: { "Dimension One": { de: "Dimension Eins" } },
    fields: [{ key: "d1", label: "D1", type: "text", group: "Dimension One" }],
  };

  it("resolves a group header via groupTranslations for a non-English locale", async () => {
    await i18n.changeLanguage("de");
    render(
      <AttributeSection section={groupedSection} card={card} onSave={async () => {}} canEdit={false} />,
    );
    expect(screen.getByText("Dimension Eins")).toBeInTheDocument();
    expect(screen.queryByText("Dimension One")).not.toBeInTheDocument();
  });

  it("falls back to the raw group name when no translation exists for the locale", () => {
    render(
      <AttributeSection section={groupedSection} card={card} onSave={async () => {}} canEdit={false} />,
    );
    // Default locale is English (no `en` entry) → raw group name.
    expect(screen.getByText("Dimension One")).toBeInTheDocument();
  });
});
