/**
 * The brand-icon picker.
 *
 * What is worth pinning is the search contract, because it is the one thing
 * that would silently regress: the pack is server-searched, so a debounce that
 * stopped applying would fire a request per keystroke over several thousand
 * icons, and a client-side re-sort would make the order jump when a response
 * landed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import BrandIconPicker, { brandIconUrl } from "./BrandIconPicker";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));

const ICONS = [
  { slug: "sap", title: "SAP", hex: "0FAAFF" },
  { slug: "gsap", title: "GSAP", hex: "88CE02" },
  { slug: "whatsapp", title: "WhatsApp", hex: "25D366" },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(api.get).mockResolvedValue({ items: ICONS, total: 3453 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function open(onPick = vi.fn()) {
  render(<BrandIconPicker open onClose={vi.fn()} onPick={onPick} />);
  return onPick;
}

describe("BrandIconPicker", () => {
  it("renders each result as its actual artwork, not a coloured placeholder", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("SAP")).toBeInTheDocument());
    const img = screen.getByLabelText("SAP").querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/v1/card-logos/brand-icons/sap.png");
  });

  it("keeps the server's ranking rather than re-sorting", async () => {
    // Exact before prefix before contains is computed server-side, mirroring
    // card search. Re-sorting here would make the order change the moment a
    // response landed mid-typing.
    open();
    await waitFor(() => expect(screen.getByLabelText("SAP")).toBeInTheDocument());
    const labels = Array.from(document.querySelectorAll("[aria-label]")).map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["SAP", "GSAP", "WhatsApp"]);
  });

  it("debounces the server query instead of firing one per keystroke", async () => {
    open();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    vi.mocked(api.get).mockClear();

    const box = screen.getByPlaceholderText("Search brands");
    fireEvent.change(box, { target: { value: "s" } });
    fireEvent.change(box, { target: { value: "sa" } });
    fireEvent.change(box, { target: { value: "sap" } });
    expect(api.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.get).mock.calls[0][0]).toContain("search=sap");
  });

  it("hands the caller the slug, and never uploads bytes itself", async () => {
    // The whole point of the pack: the image is resolved server-side, so
    // picking one transfers a word rather than a few thousand characters.
    const onPick = open();
    await waitFor(() => expect(screen.getByLabelText("SAP")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("SAP"));
    expect(onPick).toHaveBeenCalledWith("sap");
  });

  it("fetches nothing at all while closed", () => {
    render(<BrandIconPicker open={false} onClose={vi.fn()} onPick={vi.fn()} />);
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("brandIconUrl", () => {
  it("escapes a slug rather than interpolating it raw", () => {
    expect(brandIconUrl("a/b")).toBe("/api/v1/card-logos/brand-icons/a%2Fb.png");
  });
});
