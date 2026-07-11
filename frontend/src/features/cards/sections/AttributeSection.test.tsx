import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("@/hooks/useCurrency", () => ({
  useCurrency: () => ({ fmt: (n: number) => String(n), fmtShort: (n: number) => String(n), symbol: "$" }),
}));

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
    // All three fields visible initially.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();

    // Select the "Quick" badge filter → only the badged field remains.
    fireEvent.click(screen.getByRole("button", { name: "Quick" }));
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();

    // "All" clears the filter → every field is back.
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
