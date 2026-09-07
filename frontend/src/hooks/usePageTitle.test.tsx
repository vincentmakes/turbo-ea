import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DocumentTitle from "@/components/DocumentTitle";

import { invalidateAppTitle } from "./useAppTitle";
import { resetPageTitle, usePageSection, usePageSubject } from "./usePageTitle";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn().mockResolvedValue({ app_title: "Turbo EA" }) },
}));

function Subject({ name }: { name?: string | null }) {
  usePageSubject(name);
  return null;
}

function Section({ label }: { label?: string | null }) {
  usePageSection(label);
  return null;
}

/** Mounts `<DocumentTitle />` alongside a route table, as `App.tsx` does. */
function renderAt(path: string, table: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DocumentTitle />
      <Routes>{table}</Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetPageTitle();
  invalidateAppTitle("Turbo EA");
  document.title = "";
});

describe("DocumentTitle", () => {
  it("shows the bare app title on a route that is bare on purpose", () => {
    renderAt("/", <Route path="/" element={null} />);
    expect(document.title).toBe("Turbo EA");
  });

  it("names the page on a titled route", () => {
    renderAt("/inventory", <Route path="/inventory" element={null} />);
    expect(document.title).toBe("Inventory | Turbo EA");
  });

  it("prefers a published subject over the route label", () => {
    renderAt("/cards/a", <Route path="/cards/:id" element={<Subject name="SAP S/4HANA" />} />);
    expect(document.title).toBe("SAP S/4HANA | Turbo EA");
  });

  it("falls back to the route label while the entity is still loading", () => {
    renderAt("/cards/a", <Route path="/cards/:id" element={<Subject name={null} />} />);
    expect(document.title).toBe("Card | Turbo EA");
  });

  it("follows a rename without a navigation", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/cards/a"]}>
        <DocumentTitle />
        <Routes>
          <Route path="/cards/:id" element={<Subject name="Old name" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.title).toBe("Old name | Turbo EA");

    rerender(
      <MemoryRouter initialEntries={["/cards/a"]}>
        <DocumentTitle />
        <Routes>
          <Route path="/cards/:id" element={<Subject name="New name" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.title).toBe("New name | Turbo EA");
  });

  it("drops the subject when the page unmounts", () => {
    const { unmount } = renderAt(
      "/cards/a",
      <Route path="/cards/:id" element={<Subject name="SAP S/4HANA" />} />,
    );
    expect(document.title).toBe("SAP S/4HANA | Turbo EA");
    unmount();

    renderAt("/inventory", <Route path="/inventory" element={null} />);
    expect(document.title).toBe("Inventory | Turbo EA");
  });

  /**
   * The regression this exists for: `CardDetail` does not clear `card` when
   * `:id` changes, so a card-to-card navigation leaves the previous card's name
   * published for the whole refetch. Path-keying must discard it.
   */
  it("never shows one card's name on another card's URL", () => {
    // The same subject value, published from the previous path.
    renderAt("/cards/a", <Route path="/cards/:id" element={<Subject name="Card A" />} />);
    expect(document.title).toBe("Card A | Turbo EA");

    renderAt("/cards/b", <Route path="/cards/:id" element={<Subject name={null} />} />);
    expect(document.title).toBe("Card | Turbo EA");
    expect(document.title).not.toContain("Card A");
  });

  it("qualifies the route label with an active tab", () => {
    renderAt("/grc", <Route path="/grc" element={<Section label="Risk Register" />} />);
    expect(document.title).toBe("GRC · Risk Register | Turbo EA");
  });

  it("carries both a subject and a tab on an entity page that has tabs", () => {
    renderAt(
      "/ppm/a",
      <Route
        path="/ppm/:id"
        element={
          <>
            <Subject name="Apollo Migration" />
            <Section label="Budget & Costs" />
          </>
        }
      />,
    );
    expect(document.title).toBe("Apollo Migration · Budget & Costs | Turbo EA");
  });

  it("uses the admin-configured application title", () => {
    invalidateAppTitle("Acme EA");
    renderAt("/inventory", <Route path="/inventory" element={null} />);
    expect(document.title).toBe("Inventory | Acme EA");
  });
});
