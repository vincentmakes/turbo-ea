import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import RestoreDialog from "./RestoreDialog";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from "@/api/client";

// A card name is user-typed text. The confirm line is rendered through
// `dangerouslySetInnerHTML` (the translation carries `<strong>`), so the name
// must be HTML-escaped on interpolation or it becomes live markup.
const MALICIOUS_NAME = '<img src="x" onerror="window.__xss=1">';

describe("RestoreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the confirm line with the card name in bold", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ passengers: [] });
    render(
      <RestoreDialog
        open
        cardId="card-1"
        cardName="Billing App"
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Billing App")).toBeInTheDocument();
    });
    expect(screen.getByText("Billing App").tagName).toBe("STRONG");
    expect(api.get).toHaveBeenCalledWith("/cards/card-1/restore-impact");
  });

  it("escapes HTML in the card name instead of injecting it", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ passengers: [] });
    render(
      <RestoreDialog
        open
        cardId="card-1"
        cardName={MALICIOUS_NAME}
        onClose={() => {}}
        onConfirmed={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(MALICIOUS_NAME)).toBeInTheDocument();
    });
    // The name shows as literal text inside the translation's <strong>…
    expect(screen.getByText(MALICIOUS_NAME).tagName).toBe("STRONG");
    // …and no element was created from it (the dialog renders in a portal).
    expect(document.body.querySelector("img")).toBeNull();
  });
});
