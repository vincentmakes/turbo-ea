import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import i18n from "@/i18n";
import RevisionStrip, {
  decisionRevisionItems,
  showsRevisionStrip,
  soawRevisionItems,
  type RevisionStripItem,
} from "./RevisionStrip";

const t = i18n.getFixedT("en", "delivery");

const ITEMS: RevisionStripItem[] = [
  { id: "r1", label: "Rev 1", status: "signed", standing: "superseded" },
  { id: "r2", label: "Rev 2", status: "signed", standing: "in_force", signedAt: "2026-03-04" },
  { id: "r3", label: "Rev 3", status: "draft" },
];

describe("RevisionStrip", () => {
  it("renders nothing for a single revision", () => {
    const { container } = render(<RevisionStrip items={[ITEMS[0]]} activeId="r1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("highlights the active revision, tags the current one and links the others", () => {
    render(
      <MemoryRouter>
        <RevisionStrip
          items={ITEMS}
          activeId="r1"
          currentId="r2"
          hrefFor={(id) => `/ea-delivery/adr/${id}`}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Revisions" })).toBeInTheDocument();
    const active = screen.getByTestId("revision-r1");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.tagName).not.toBe("A");
    expect(active.className).toContain("MuiChip-colorPrimary");

    const current = screen.getByTestId("revision-r2");
    expect(current.tagName).toBe("A");
    expect(current).toHaveAttribute("href", "/ea-delivery/adr/r2");
    expect(current).toHaveTextContent("Rev 2· Current");
    expect(current).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("revision-r3")).toHaveAttribute("href", "/ea-delivery/adr/r3");
    expect(screen.getByTestId("revision-r3")).not.toHaveTextContent("Current");
  });

  it("calls onOpen when no href is given, never for the active one", async () => {
    const onOpen = vi.fn();
    render(<RevisionStrip items={ITEMS} activeId="r2" onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId("revision-r3"));
    expect(onOpen).toHaveBeenCalledWith("r3");
    await userEvent.click(screen.getByTestId("revision-r2"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("explains each revision in a tooltip", async () => {
    render(<RevisionStrip items={ITEMS} activeId="r1" onOpen={() => {}} />);
    await userEvent.hover(screen.getByTestId("revision-r2"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Signed · In force · Signed on 2026-03-04",
    );
  });
});

describe("showsRevisionStrip", () => {
  it("is true for a chain of two or more only", () => {
    expect(showsRevisionStrip([])).toBe(false);
    expect(showsRevisionStrip([ITEMS[0]])).toBe(false);
    expect(showsRevisionStrip(ITEMS.slice(0, 2))).toBe(true);
    expect(showsRevisionStrip(ITEMS)).toBe(true);
  });
});

describe("revision item builders", () => {
  it("maps a decision chain", () => {
    expect(
      decisionRevisionItems(
        [
          {
            id: "a",
            reference_number: "ADR-001",
            revision_number: 2,
            title: "T",
            status: "signed",
            standing: "revoked",
          },
        ],
        t,
      ),
    ).toEqual([{ id: "a", label: "Rev 2", status: "signed", standing: "revoked" }]);
  });

  it("maps a SoAW chain", () => {
    expect(
      soawRevisionItems(
        [
          { id: "s1", name: "S", revision_number: 1, status: "approved" },
          { id: "s2", name: "S", revision_number: 2, status: "signed", signed_at: "2026-01-01" },
        ],
        t,
      ),
    ).toEqual([
      { id: "s1", label: "Rev 1", status: "approved", signedAt: null },
      { id: "s2", label: "Rev 2", status: "signed", signedAt: "2026-01-01" },
    ]);
  });
});
