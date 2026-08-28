import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CardLogoAvatar, { cardLogoUrl } from "./CardLogoAvatar";

const BASE = {
  cardId: "11111111-2222-3333-4444-555555555555",
  typeIcon: "apps",
  typeColor: "#0f7eb5",
};

describe("CardLogoAvatar", () => {
  it("renders the type icon alone when the card has no logo", () => {
    render(<CardLogoAvatar {...BASE} />);

    expect(screen.getByText("apps")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the type icon when the type has logos switched off", () => {
    // The backend withholds logo_updated_at for such types, so the component
    // needs no rule of its own — it simply sees no logo.
    render(<CardLogoAvatar {...BASE} logoUpdatedAt={null} />);

    expect(screen.getByText("apps")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the logo and keeps the type icon as a badge", () => {
    render(<CardLogoAvatar {...BASE} logoUpdatedAt="2026-08-28T10:00:00Z" />);

    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain(`/api/v1/cards/${BASE.cardId}/logo`);
    // Both identities readable at once — that is the point of the badge.
    expect(screen.getByText("apps")).toBeInTheDocument();
  });

  it("omits the badge when asked, for dense rows", () => {
    render(<CardLogoAvatar {...BASE} logoUpdatedAt="2026-08-28T10:00:00Z" badge={false} />);

    expect(document.querySelector("img")).not.toBeNull();
    expect(screen.queryByText("apps")).toBeNull();
  });

  it("falls back to the type icon when the image fails to load", () => {
    render(<CardLogoAvatar {...BASE} logoUpdatedAt="2026-08-28T10:00:00Z" />);

    const img = document.querySelector("img")!;
    fireEvent.error(img);

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("apps")).toBeInTheDocument();
  });

  it("retries after a failure once the logo is replaced", () => {
    const { rerender } = render(
      <CardLogoAvatar {...BASE} logoUpdatedAt="2026-08-28T10:00:00Z" />,
    );
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();

    // A replaced logo is a new URL; a past failure must not suppress it.
    rerender(<CardLogoAvatar {...BASE} logoUpdatedAt="2026-08-28T11:00:00Z" />);

    expect(document.querySelector("img")).not.toBeNull();
  });

  it("busts the cache on the logo timestamp", () => {
    const first = cardLogoUrl(BASE.cardId, "2026-08-28T10:00:00Z");
    const second = cardLogoUrl(BASE.cardId, "2026-08-28T11:00:00Z");

    expect(first).not.toEqual(second);
    // The timestamp is encoded — a raw ':' in a query value is asking for it.
    expect(first).toContain("v=2026-08-28T10%3A00%3A00Z");
  });
});
