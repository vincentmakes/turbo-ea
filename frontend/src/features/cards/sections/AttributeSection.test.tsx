import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

// The vendor picker searches cards; a plain input stands in for it.
vi.mock("@/components/VendorField", () => ({
  default: ({ value }: { value: string }) => <input aria-label="Vendor" defaultValue={value} />,
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

describe("AttributeSection brings the section back into view after save", () => {
  // Mimics CardDetailContent.handleUpdate → setCard: the card prop gets a NEW
  // object identity after save, re-rendering the whole card. `topRef` is the
  // simulated viewport position of the section root.
  function renderHarness(topRef: { value: number }) {
    function Harness() {
      const [c, setC] = useState(card);
      return (
        <AttributeSection
          section={section}
          card={c}
          canEdit
          onSave={async () => {
            setC((prev) => ({ ...prev }) as typeof prev);
          }}
        />
      );
    }
    const { container } = render(<Harness />);
    const root = container.querySelector(".MuiAccordion-root") as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockImplementation(
      () => ({ top: topRef.value }) as unknown as DOMRect,
    );
    // jsdom has no scrollIntoView; simulate a "start" snap landing the header
    // at the root's scroll-margin offset (just below the fixed app bar).
    const scrollIntoView = vi.fn(() => {
      topRef.value = 72;
    });
    (root as HTMLElement & { scrollIntoView: typeof scrollIntoView }).scrollIntoView =
      scrollIntoView;
    return { scrollIntoView };
  }

  it("snaps a tall section (top scrolled above the viewport) back into view", async () => {
    // The realistic case: the Save button of a tall edit view sits at the
    // page bottom, so at save time the section's top is far ABOVE the
    // viewport. After the edit→read content swap shrinks the section (the
    // Accordion stays expanded) and the parent's card re-render settles, the
    // (now short) section must be scrolled back into view — not left parked
    // above the viewport.
    const top = { value: -1200 };
    const { scrollIntoView } = renderHarness(top);

    // Enter edit mode (the pencil IconButton renders the "edit" ligature).
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" }),
    );
    // The header lands at/near the viewport top (below the fixed app bar).
    expect(top.value).toBe(72);
  });

  it("does not yank the page when the section header is already visible", async () => {
    const top = { value: 300 }; // comfortably in view
    const { scrollIntoView } = renderHarness(top);

    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Save settles (section back in read mode) without any scroll.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(top.value).toBe(300);
  });
});

describe("AttributeSection preserves in-progress edits across a card refresh (#843)", () => {
  // Simulates CardDetailContent: saving another section replaces the whole card
  // object (new identity), which must NOT clobber this section's unsaved draft
  // while it is being edited.
  function DirtyHarness() {
    const [c, setC] = useState(card);
    return (
      <>
        <button
          type="button"
          onClick={() =>
            // New card + new attributes identity, value of `a` changed —
            // exactly what the server returns after an unrelated save.
            setC((prev) => ({
              ...prev,
              attributes: { ...(prev.attributes || {}), a: "server-value" },
            }) as typeof prev)
          }
        >
          ext-update
        </button>
        <AttributeSection section={section} card={c} canEdit onSave={async () => {}} />
      </>
    );
  }

  it("keeps the typed draft when the card prop is replaced mid-edit", () => {
    render(<DirtyHarness />);
    fireEvent.click(screen.getByText("edit"));

    const input = screen.getByDisplayValue("x");
    fireEvent.change(input, { target: { value: "typed-draft" } });
    expect(screen.getByDisplayValue("typed-draft")).toBeInTheDocument();

    // A parent card refresh lands (e.g. another section saved).
    fireEvent.click(screen.getByText("ext-update"));

    // Draft survives — it is NOT reset to the server value.
    expect(screen.getByDisplayValue("typed-draft")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("server-value")).not.toBeInTheDocument();
  });

  it("does resync from the card prop when the section is not editing", () => {
    render(<DirtyHarness />);
    // Read mode: a card refresh must reflect the new server value.
    fireEvent.click(screen.getByText("ext-update"));
    expect(screen.getByText("server-value")).toBeInTheDocument();
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

describe("AttributeSection — calculated fields in edit mode", () => {
  it("renders a calculated percentage read-only with the chip, never the editor", () => {
    const progressSection: SectionDef & { columns?: 1 | 2 } = {
      section: "Delivery",
      columns: 1,
      fields: [{ key: "progress", label: "Progress", type: "percentage" }],
    };
    const initiative = {
      id: "card-2",
      type: "Initiative",
      name: "Rollout",
      attributes: { progress: 40 },
    } as unknown as Card;
    render(
      <AttributeSection
        section={progressSection}
        card={initiative}
        canEdit
        calculatedFieldKeys={["progress"]}
        onSave={async () => {}}
      />,
    );
    fireEvent.click(screen.getByText("edit"));
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("calculated")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});

describe("AttributeSection — data-quality jump", () => {
  it("carries its slugged jump anchor and opens on a jump request", () => {
    const named = { ...section, section: "Digital Strategy" };
    const { container, rerender } = render(
      <AttributeSection section={named} card={card} onSave={async () => {}} initialExpanded={false} />,
    );
    const root = container.querySelector(".MuiAccordion-root")!;
    const summary = container.querySelector(".MuiAccordionSummary-root")!;
    expect(root.id).toBe("card-section-custom-digital-strategy");
    expect(summary.getAttribute("aria-expanded")).toBe("false");

    rerender(
      <AttributeSection
        section={named}
        card={card}
        onSave={async () => {}}
        initialExpanded={false}
        expandOn={1}
      />,
    );
    expect(summary.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("AttributeSection — a jump opens it in edit mode", () => {
  const request = (fieldKey?: string, nonce = 1) => ({
    anchor: "card-section-custom-digital",
    nonce,
    fieldKey,
  });
  const fieldInput = (container: HTMLElement, key: string) =>
    container.querySelector(`[data-field-key="${key}"] input`) as HTMLInputElement;

  it("enters edit mode on a jump and focuses the field, after resetting the badge filter", () => {
    const { container, rerender } = render(
      <AttributeSection section={section} card={card} onSave={async () => {}} />,
    );
    // The filter hides Alpha, the field the jump is about.
    fireEvent.click(screen.getByRole("button", { name: "Quick" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    rerender(
      <AttributeSection section={section} card={card} onSave={async () => {}} editOn={request("a")} />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    const input = fieldInput(container, "a");
    expect(input).toHaveValue("x");
    expect(document.activeElement).toBe(input);
    // Every edited field carries its wrapper.
    expect(
      Array.from(container.querySelectorAll("[data-field-key]")).map((el) =>
        el.getAttribute("data-field-key"),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("focuses the field the jump names, not the first one", () => {
    const { container } = render(
      <AttributeSection section={section} card={card} onSave={async () => {}} editOn={request("c")} />,
    );
    expect(document.activeElement).toBe(fieldInput(container, "c"));
  });

  it("enters edit mode without moving focus when the jump names no field", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    render(
      <AttributeSection section={section} card={card} onSave={async () => {}} editOn={request()} />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("stays read-only on a jump without edit rights", () => {
    const { container } = render(
      <AttributeSection
        section={section}
        card={card}
        onSave={async () => {}}
        canEdit={false}
        editOn={request("a")}
      />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(container.querySelector("[data-field-key]")).toBeNull();
  });

  it("acts once per jump: after Cancel the same jump does not reopen it, a new one does", () => {
    const first = request("a", 1);
    const { container, rerender } = render(
      <AttributeSection section={section} card={card} onSave={async () => {}} editOn={first} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    rerender(<AttributeSection section={section} card={card} onSave={async () => {}} editOn={first} />);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    rerender(
      <AttributeSection section={section} card={card} onSave={async () => {}} editOn={request("b", 2)} />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(document.activeElement).toBe(fieldInput(container, "b"));
  });

  it("wraps the vendor picker too, so a vendor slot focuses it", () => {
    const vendorSection: SectionDef & { columns?: 1 | 2 } = {
      section: "Digital",
      columns: 1,
      fields: [
        { key: "a", label: "Alpha", type: "text" },
        { key: "vendor", label: "Vendor", type: "text" },
      ],
    };
    render(
      <AttributeSection
        section={vendorSection}
        card={card}
        onSave={async () => {}}
        editOn={request("vendor")}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Vendor" }));
  });
});
