/**
 * The card preview drawer is modal by default — every caller (and the
 * extension SDK) relies on that — and non-modal on request. The Inventory asks
 * for the non-modal form so the grid and filter sidebar beside the panel stay
 * usable while a card is previewed (#1289).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import CardDetailSidePanel from "./CardDetailSidePanel";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ getType: () => undefined, types: [], relationTypes: [] }),
}));
vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({ aiStatus: { enabled: false, configured: false, enabled_types: [] } }),
  aiSuggestEnabledFor: () => false,
}));
// The real content drags in the whole card-detail graph; this suite is about
// the drawer around it.
vi.mock("@/features/cards/CardDetailContent", () => ({
  default: ({ card }: { card: { name: string } }) => (
    <div data-testid="card-content">{card.name}</div>
  ),
}));
vi.mock("@/features/cards/sections", () => ({
  DataQualityPill: () => null,
}));

import { api } from "@/api/client";

const CARD = {
  id: "c1",
  name: "SAP ERP",
  type: "Application",
  subtype: null,
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 50,
  lifecycle: {},
  attributes: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.style.overflow = "";
  vi.mocked(api.get).mockImplementation((path: string) =>
    path.endsWith("/my-permissions")
      ? Promise.resolve({ effective: {} })
      : Promise.resolve(CARD),
  );
});

function mount(props: { nonModal?: boolean; open?: boolean } = {}) {
  const onClose = vi.fn();
  const onPage = vi.fn();
  const view = (open: boolean) => (
    <MemoryRouter>
      <button type="button" onClick={onPage}>
        Page behind
      </button>
      <CardDetailSidePanel cardId="c1" open={open} onClose={onClose} nonModal={props.nonModal} />
    </MemoryRouter>
  );
  const utils = render(view(props.open ?? true));
  return { ...utils, onClose, onPage, rerenderOpen: (open: boolean) => utils.rerender(view(open)) };
}

const backdrop = () => document.querySelector(".MuiBackdrop-root");
const panel = () => document.querySelector(".MuiDrawer-paper") as HTMLElement;
const closeButton = () => panel().querySelector("button") as HTMLButtonElement;

describe("CardDetailSidePanel — modal by default", () => {
  it("renders a backdrop, locks the page scroll and hides the page from assistive tech", async () => {
    mount();
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(backdrop()).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    // The Modal marks the page aria-hidden — the very reason the Inventory
    // cannot use this form.
    expect(screen.queryByRole("button", { name: "Page behind" })).toBeNull();
  });

  it("closes from the close button and from Escape", async () => {
    const { onClose } = mount();
    await screen.findByTestId("card-content");
    await userEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("CardDetailSidePanel — nonModal", () => {
  it("renders no backdrop and no scroll lock", async () => {
    mount({ nonModal: true });
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(backdrop()).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("does not take focus, and leaves the page reachable and clickable without closing", async () => {
    const { onClose, onPage } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    expect(panel().contains(document.activeElement)).toBe(false);

    const behind = screen.getByRole("button", { name: "Page behind" });
    await userEvent.click(behind);
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(behind);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape inside the panel and from the close button", async () => {
    const { onClose } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    closeButton().focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores an Escape typed in the page, or one a nested control already consumed", async () => {
    const { onClose } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    screen.getByRole("button", { name: "Page behind" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    closeButton().dispatchEvent(consumed);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores every key but Escape inside the panel", async () => {
    const { onClose } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    closeButton().focus();
    await userEvent.keyboard("a{Tab}{ArrowDown}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("unmounts its content once closed, as the modal drawer does", async () => {
    const { rerenderOpen } = mount({ nonModal: true });
    await screen.findByTestId("card-content");
    rerenderOpen(false);
    await waitFor(() => expect(screen.queryByTestId("card-content")).toBeNull());
  });

  it("does not fetch while closed", () => {
    mount({ nonModal: true, open: false });
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("card-content")).toBeNull();
  });
});
