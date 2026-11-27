/**
 * The card preview drawer is modal by default — every caller (and the
 * extension SDK) relies on that — and non-modal on request. The Inventory asks
 * for the non-modal form so the grid and filter sidebar beside the panel stay
 * usable while a card is previewed (#1289).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import CardDetailSidePanel from "./CardDetailSidePanel";

vi.mock("@/api/client", async () => ({
  // The real error class: applying an AI suggestion tells a refusal by it.
  ApiError: (await vi.importActual<typeof import("@/api/client")>("@/api/client")).ApiError,
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
// The card type the metamodel resolves: none by default, a small schema for
// the focus suite (which resolves fields and relation types against it).
const metamodel = vi.hoisted(() => ({
  type: undefined as unknown,
  relationTypes: [] as unknown[],
}));
vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: () => metamodel.type,
    types: [],
    relationTypes: metamodel.relationTypes,
  }),
}));
// AI suggestions are off unless a suite switches them on.
const ai = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/hooks/useAiStatus", () => ({
  useAiStatus: () => ({ aiStatus: { enabled: false, configured: false, enabled_types: [] } }),
  aiSuggestEnabledFor: () => ai.enabled,
}));
// The real content drags in the whole card-detail graph; this suite is about
// the drawer around it.
vi.mock("@/features/cards/CardDetailContent", () => ({
  default: ({
    card,
    onCardUpdate,
    onSaveOrigin,
    onDirtyChange,
    focusTarget,
    onAiSuggest,
    beforeTabs,
  }: {
    card: { name: string; data_quality: number; description?: string };
    onCardUpdate: (c: unknown) => void;
    onSaveOrigin?: (anchor: string) => void;
    onDirtyChange?: (dirty: boolean) => void;
    focusTarget?: {
      target: { tab: string; anchor?: string; fieldKey?: string };
      nonce: number;
    } | null;
    onAiSuggest?: () => void;
    beforeTabs?: import("react").ReactNode;
  }) => (
    <div
      data-testid="card-content"
      data-focus-anchor={focusTarget ? (focusTarget.target.anchor ?? "") : "none"}
      data-focus-field={focusTarget?.target.fieldKey ?? ""}
      data-focus-nonce={focusTarget ? String(focusTarget.nonce) : "none"}
    >
      {card.name}
      {card.description && <p>{card.description}</p>}
      {beforeTabs}
      {onAiSuggest && (
        <button type="button" onClick={onAiSuggest}>
          AI suggest
        </button>
      )}
      <button type="button" onClick={() => onDirtyChange?.(true)}>
        Edit
      </button>
      <button type="button" onClick={() => onDirtyChange?.(false)}>
        Saved
      </button>
      <button type="button" onClick={() => onCardUpdate({ ...card, data_quality: 60 })}>
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          onSaveOrigin?.("card-section-lifecycle");
          onCardUpdate({ ...card, data_quality: 40 });
        }}
      >
        Clear lifecycle
      </button>
    </div>
  ),
}));
vi.mock("@/features/cards/gamification/GainFlight", () => ({
  GainFlight: ({
    gain,
    targetEl,
    onImpact,
  }: {
    gain: { nonce: number; delta: number; originAnchor: string | null };
    targetEl: HTMLElement | null;
    onImpact: (nonce: number) => void;
  }) => (
    <button
      type="button"
      data-testid="flight"
      data-origin={gain.originAnchor ?? ""}
      data-delta={String(gain.delta)}
      data-target={targetEl?.getAttribute("data-testid") ?? "none"}
      onClick={() => onImpact(gain.nonce)}
    >
      Land
    </button>
  ),
}));
vi.mock("@/features/cards/sections", () => ({
  DataQualityPill: ({
    value,
    animate,
    gain,
    impactNonce,
    onRootRef,
  }: {
    value: number;
    animate?: boolean;
    gain?: { delta: number } | null;
    impactNonce?: number | null;
    onRootRef?: (el: HTMLElement | null) => void;
  }) => (
    <span
      ref={onRootRef}
      data-impact={String(impactNonce)}
      data-testid="dq-pill"
      data-value={value}
      data-animate={String(!!animate)}
      data-gain={gain ? String(gain.delta) : ""}
    />
  ),
}));
const gamification = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/hooks/useGamificationEnabled", () => ({
  useGamificationEnabled: () => gamification.enabled,
}));

import { api, ApiError } from "@/api/client";

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
const OTHER = { ...CARD, id: "c2", name: "Salesforce" };

beforeEach(() => {
  vi.clearAllMocks();
  gamification.enabled = false;
  ai.enabled = false;
  metamodel.type = undefined;
  metamodel.relationTypes = [];
  document.body.style.overflow = "";
  vi.mocked(api.get).mockImplementation((path: string) =>
    path.endsWith("/my-permissions")
      ? Promise.resolve({ effective: {} })
      : Promise.resolve(path === "/cards/c2" ? OTHER : CARD),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(props: { nonModal?: boolean; open?: boolean; cardId?: string | null } = {}) {
  const onClose = vi.fn();
  const onPage = vi.fn();
  const onKeepCard = vi.fn();
  const view = (open: boolean, cardId: string | null) => (
    <MemoryRouter>
      <button type="button" onClick={onPage}>
        Page behind
      </button>
      <CardDetailSidePanel
        cardId={cardId}
        open={open}
        onClose={onClose}
        onKeepCard={onKeepCard}
        nonModal={props.nonModal}
      />
    </MemoryRouter>
  );
  const initialId = props.cardId === undefined ? "c1" : props.cardId;
  const utils = render(view(props.open ?? true, initialId));
  return {
    ...utils,
    onClose,
    onPage,
    onKeepCard,
    rerenderOpen: (open: boolean) => utils.rerender(view(open, initialId)),
    rerenderWith: (cardId: string | null, open = true) => utils.rerender(view(open, cardId)),
  };
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

describe("CardDetailSidePanel — gamified data quality", () => {
  it("hands the pill the save's gain when the toggle is on", async () => {
    gamification.enabled = true;
    mount();
    await screen.findByTestId("card-content");
    const pill = screen.getByTestId("dq-pill");
    expect(pill).toHaveAttribute("data-animate", "true");
    expect(pill).toHaveAttribute("data-gain", "");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-value", "60");
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-gain", "10");
  });

  it("flies a section's change off the pill and hands the pill the impact", async () => {
    gamification.enabled = true;
    mount();
    await screen.findByTestId("card-content");
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear lifecycle" }));
    const flight = screen.getByTestId("flight");
    expect(flight).toHaveAttribute("data-origin", "card-section-lifecycle");
    expect(flight).toHaveAttribute("data-delta", "-10");
    expect(flight).toHaveAttribute("data-target", "dq-pill");
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-impact", "null");

    await userEvent.click(flight);
    expect(screen.getByTestId("dq-pill")).toHaveAttribute("data-impact", "1");
  });

  it("flies nothing for a save that names no section", async () => {
    gamification.enabled = true;
    mount();
    await screen.findByTestId("card-content");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();
  });

  it("animates nothing when the toggle is off", async () => {
    mount();
    await screen.findByTestId("card-content");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const pill = screen.getByTestId("dq-pill");
    expect(pill).toHaveAttribute("data-value", "60");
    expect(pill).toHaveAttribute("data-animate", "false");
    expect(pill).toHaveAttribute("data-gain", "");
    await userEvent.click(screen.getByRole("button", { name: "Clear lifecycle" }));
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();
  });
});

describe("CardDetailSidePanel — unsaved edits (#1397)", () => {
  const MESSAGE = "You have unsaved changes. Leave without saving?";
  const cardFetches = (id: string) =>
    vi.mocked(api.get).mock.calls.filter(([path]) => path === `/cards/${id}`).length;

  async function dirtyPanel(props: { nonModal?: boolean } = { nonModal: true }) {
    const utils = mount(props);
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    return utils;
  }

  it("keeps the card and its edits when the user declines switching to another card", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith, onKeepCard } = await dirtyPanel();

    rerenderWith("c2");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(onKeepCard).toHaveBeenCalledTimes(1);
    expect(onKeepCard).toHaveBeenCalledWith("c1");
    expect(cardFetches("c2")).toBe(0);
    expect(screen.getByTestId("card-content")).toHaveTextContent("SAP ERP");
  });

  it("does not ask twice for a request already declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith, onKeepCard } = await dirtyPanel();

    rerenderWith("c2");
    rerenderWith(null, false);
    rerenderWith("c2");
    // A fresh request after the decline is asked again; repeating it is not.
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(onKeepCard).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("card-content")).toHaveTextContent("SAP ERP");
  });

  it("asks once under StrictMode, whose double effects must not prompt twice", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onKeepCard = vi.fn();
    const view = (cardId: string) => (
      <StrictMode>
        <MemoryRouter>
          <CardDetailSidePanel
            cardId={cardId}
            open
            onClose={() => {}}
            onKeepCard={onKeepCard}
            nonModal
          />
        </MemoryRouter>
      </StrictMode>
    );
    const { rerender } = render(view("c1"));
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    rerender(view("c2"));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onKeepCard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("card-content")).toHaveTextContent("SAP ERP");
  });

  it("asks again for the same card once the parent restored its state", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith } = await dirtyPanel();

    rerenderWith("c2");
    rerenderWith("c1"); // the parent's onKeepCard put its state back
    expect(confirm).toHaveBeenCalledTimes(1);
    rerenderWith("c2");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(cardFetches("c2")).toBe(0);
  });

  it("switches to the new card when the user agrees to discard the edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { rerenderWith, onKeepCard } = await dirtyPanel();

    rerenderWith("c2");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(onKeepCard).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Salesforce"));
    expect(cardFetches("c2")).toBe(1);
    expect(screen.queryByText(/SAP ERP/)).toBeNull();

    // The edits went with the old card: the next switch asks nothing.
    rerenderWith("c1");
    await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("SAP ERP"));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("switches without asking when nothing is unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith, onKeepCard } = mount({ nonModal: true });
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");

    rerenderWith("c2");

    await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Salesforce"));
    expect(confirm).not.toHaveBeenCalled();
    expect(onKeepCard).not.toHaveBeenCalled();
  });

  it("switches without asking once the edits were saved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith } = await dirtyPanel();
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));

    rerenderWith("c2");

    await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Salesforce"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stays open when the parent closes it and the user keeps the edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith, onKeepCard } = await dirtyPanel();

    rerenderWith(null, false);

    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(onKeepCard).toHaveBeenCalledWith("c1");
    expect(panel()).toHaveClass("MuiPaper-root");
    expect(screen.getByTestId("card-content")).toHaveTextContent("SAP ERP");
  });

  it("closes when the parent closes it and the user discards the edits", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { rerenderWith, onKeepCard } = await dirtyPanel();

    rerenderWith(null, false);

    expect(onKeepCard).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("card-content")).toBeNull());
  });

  it("asks before the close button closes a panel with edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose, rerenderWith } = await dirtyPanel();

    await userEvent.click(closeButton());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(closeButton());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);

    // The parent closing in response is the same answer — no second prompt.
    rerenderWith(null, false);
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId("card-content")).toBeNull());
  });

  it("asks before Escape closes a non-modal panel with edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose } = await dirtyPanel();

    closeButton().focus();
    await userEvent.keyboard("{Escape}");
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.keyboard("{Escape}");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before the backdrop closes a modal panel with edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose } = await dirtyPanel({});

    await userEvent.click(backdrop() as HTMLElement);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(backdrop() as HTMLElement);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes a panel the parent already closed once the user discards the kept edits", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose, rerenderWith } = await dirtyPanel();
    rerenderWith(null, false); // declined: the panel stays, the parent is closed

    confirm.mockReturnValue(true);
    await userEvent.click(closeButton());

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("card-content")).toBeNull());
  });

  it("closes without asking once the edits were saved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose } = await dirtyPanel();
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));

    await userEvent.click(closeButton());

    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before the open-full-page button leaves for the card page", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await dirtyPanel();
    const buttons = panel().querySelectorAll("button");
    // Header: close, then open-full-page.
    await userEvent.click(buttons[1] as HTMLButtonElement);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(screen.getByTestId("card-content")).toHaveTextContent("SAP ERP");
  });
});

describe("CardDetailSidePanel — focus (UI SDK 1.37)", () => {
  type Focus = Parameters<typeof CardDetailSidePanel>[0]["focus"];

  beforeEach(() => {
    metamodel.type = {
      key: "Application",
      icon: "apps",
      fields_schema: [
        { section: "Run Costs", fields: [{ key: "alphaCost", label: "Alpha", type: "number" }] },
      ],
    };
    metamodel.relationTypes = [
      { key: "relAppToThing", source_type_key: "Application", target_type_key: "Thing" },
    ];
  });

  function mountFocused(focus: Focus, opts: { cardId?: string; open?: boolean } = {}) {
    const onKeepCard = vi.fn();
    const view = (f: Focus, cardId: string, open: boolean) => (
      <MemoryRouter>
        <CardDetailSidePanel
          cardId={cardId}
          open={open}
          onClose={() => {}}
          onKeepCard={onKeepCard}
          nonModal
          focus={f}
        />
      </MemoryRouter>
    );
    const utils = render(view(focus, opts.cardId ?? "c1", opts.open ?? true));
    return {
      ...utils,
      onKeepCard,
      rerenderWith: (f: Focus, cardId = "c1", open = true) =>
        utils.rerender(view(f, cardId, open)),
    };
  }

  const content = () => screen.getByTestId("card-content");
  const nonce = () => content().getAttribute("data-focus-nonce");
  const anchor = () => content().getAttribute("data-focus-anchor");

  it("hands no focus target to the content when no focus is asked for", async () => {
    mountFocused(undefined);
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(content()).toHaveAttribute("data-focus-nonce", "none");
  });

  it("jumps to the field's section once the card has loaded, naming the field", async () => {
    mountFocused({ field: "alphaCost" });
    await waitFor(() => expect(anchor()).toBe("card-section-custom-run-costs"));
    expect(content()).toHaveAttribute("data-focus-field", "alphaCost");
    expect(nonce()).toBe("1");
  });

  it("jumps to a relation group and to a built-in section", async () => {
    const { rerenderWith } = mountFocused({ relation: { type: "relAppToThing" } });
    await waitFor(() => expect(anchor()).toBe("card-relation-relAppToThing-source"));
    rerenderWith({ section: "lifecycle" });
    await waitFor(() => expect(anchor()).toBe("card-section-lifecycle"));
    expect(nonce()).toBe("2");
  });

  it("opens the card as usual for a focus that does not resolve", async () => {
    mountFocused({ field: "noSuchField" });
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(content()).toHaveAttribute("data-focus-nonce", "none");
  });

  it("jumps again to a place asked for after a place the card does not have", async () => {
    const { rerenderWith } = mountFocused({ field: "alphaCost" });
    await waitFor(() => expect(nonce()).toBe("1"));
    rerenderWith({ field: "noSuchField" });
    expect(nonce()).toBe("1");
    rerenderWith({ field: "alphaCost" });
    await waitFor(() => expect(nonce()).toBe("2"));
    expect(anchor()).toBe("card-section-custom-run-costs");
  });

  it("jumps once the metamodel arrives for a card that loaded before it", async () => {
    const schema = metamodel.type;
    metamodel.type = undefined;
    const { rerenderWith } = mountFocused({ field: "alphaCost" });
    expect(await screen.findByTestId("card-content")).toHaveTextContent("SAP ERP");
    expect(nonce()).toBe("none");
    metamodel.type = schema;
    rerenderWith({ field: "alphaCost" });
    await waitFor(() => expect(nonce()).toBe("1"));
    rerenderWith({ field: "alphaCost" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(nonce()).toBe("1");
  });

  it("does not jump again for an equal focus passed as a fresh object", async () => {
    const { rerenderWith } = mountFocused({ field: "alphaCost" });
    await waitFor(() => expect(nonce()).toBe("1"));
    rerenderWith({ field: "alphaCost" });
    rerenderWith({ field: "alphaCost" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(nonce()).toBe("1");
  });

  it("jumps again when the focus changes, and after it was cleared and asked again", async () => {
    const { rerenderWith } = mountFocused({ field: "alphaCost" });
    await waitFor(() => expect(nonce()).toBe("1"));
    rerenderWith({ section: "tags" });
    await waitFor(() => expect(nonce()).toBe("2"));
    expect(anchor()).toBe("card-section-tags");
    rerenderWith(null);
    await waitFor(() => expect(nonce()).toBe("none"));
    rerenderWith({ section: "tags" });
    await waitFor(() => expect(nonce()).toBe("3"));
  });

  it("jumps again on another card and when the panel is re-opened", async () => {
    const { rerenderWith } = mountFocused({ section: "tags" });
    await waitFor(() => expect(nonce()).toBe("1"));
    rerenderWith({ section: "tags" }, "c2");
    await waitFor(() => expect(content()).toHaveTextContent("Salesforce"));
    await waitFor(() => expect(nonce()).toBe("2"));
    rerenderWith({ section: "tags" }, "c2", false);
    await waitFor(() => expect(screen.queryByTestId("card-content")).toBeNull());
    rerenderWith({ section: "tags" }, "c2", true);
    await waitFor(() => expect(nonce()).toBe("3"));
  });

  it("never applies another card's focus to a card whose edits the user kept", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerenderWith, onKeepCard } = mountFocused({ section: "tags" });
    await waitFor(() => expect(nonce()).toBe("1"));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    rerenderWith({ field: "alphaCost" }, "c2");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onKeepCard).toHaveBeenCalledWith("c1");
    expect(content()).toHaveTextContent("SAP ERP");
    expect(nonce()).toBe("1");
    expect(anchor()).toBe("card-section-tags");

    // The parent puts its own state back: the place already jumped to.
    rerenderWith({ section: "tags" }, "c1");
    expect(nonce()).toBe("1");
  });
});


describe("CardDetailSidePanel — AI suggestions", () => {
  const SUGGESTION = {
    suggestions: {
      description: { value: "An ERP suite.", confidence: 0.9 },
      shared: { value: true, confidence: 0.7 },
    },
    sources: [],
  };

  beforeEach(() => {
    ai.enabled = true;
    metamodel.type = {
      key: "Application",
      icon: "apps",
      fields_schema: [
        { section: "Info", fields: [{ key: "shared", label: "Shared", type: "boolean" }] },
      ],
      subtypes: [{ key: "micro", label: "Micro", hidden_fields: ["shared"] }],
    };
    vi.mocked(api.get).mockImplementation((path: string) =>
      path.endsWith("/my-permissions")
        ? Promise.resolve({ effective: { can_edit: true } })
        : Promise.resolve(path === "/cards/c2" ? OTHER : CARD),
    );
    vi.mocked(api.post).mockResolvedValue(SUGGESTION);
  });

  async function suggestAndApply() {
    await userEvent.click(await screen.findByRole("button", { name: "AI suggest" }));
    await userEvent.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
  }

  it("asks in the UI language and saves the description and values together", async () => {
    vi.mocked(api.patch).mockImplementation(async (_path, body) => ({
      ...CARD,
      ...(body as object),
    }));
    mount();
    await suggestAndApply();
    // The suggestion panel shows the same text until it closes: wait for it to
    // close, then read the description the save wrote.
    await waitFor(() => expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument());
    expect(await screen.findByText("An ERP suite.")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith("/ai/suggest", {
      type_key: "Application",
      subtype: undefined,
      name: "SAP ERP",
      locale: "en",
    });
    expect(vi.mocked(api.patch).mock.calls).toEqual([
      ["/cards/c1", { description: "An ERP suite.", attributes: { shared: true } }],
    ]);
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText(/Description applied\./)).not.toBeInTheDocument();
  });

  it("applies the description alone and says so when the values are refused", async () => {
    vi.mocked(api.patch).mockImplementation(async (_path, body) => {
      if ("attributes" in (body as object)) {
        throw new ApiError("Invalid option for Shared", 422, null);
      }
      return { ...CARD, ...(body as object) };
    });
    mount();
    await suggestAndApply();
    const warning = await screen.findByText(
      "Description applied. The other suggested values could not be saved: Invalid option for Shared",
    );
    expect(screen.getByText("An ERP suite.")).toBeInTheDocument();
    expect(vi.mocked(api.patch).mock.calls.map((c) => c[1])).toEqual([
      { description: "An ERP suite.", attributes: { shared: true } },
      { description: "An ERP suite." },
    ]);
    await userEvent.click(
      (warning.closest('[role="alert"]') as HTMLElement).querySelector("button")!,
    );
    expect(screen.queryByText(/Description applied\./)).not.toBeInTheDocument();
  });

  it("drops the warning when another card is shown", async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError("Refused", 422, null));
    vi.mocked(api.patch).mockResolvedValueOnce({ ...CARD, description: "An ERP suite." });
    const { rerenderWith } = mount();
    await suggestAndApply();
    expect(await screen.findByText(/Description applied\./)).toBeInTheDocument();
    rerenderWith("c2");
    await waitFor(() => expect(screen.queryByText(/Description applied\./)).toBeNull());
  });

  it("keeps the panel open with the reason when the save fails", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("Network down"));
    mount();
    await suggestAndApply();
    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(screen.getByText("Could not apply the suggestion")).toBeInTheDocument();
    expect(screen.getByText("AI Suggestions")).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});

describe("CardDetailSidePanel — AI requests that settle after a switch", () => {
  const SKIPPED = /Description applied\./;
  const SUGGESTION = {
    suggestions: {
      description: { value: "An ERP suite.", confidence: 0.9 },
      shared: { value: true, confidence: 0.7 },
    },
    sources: [],
  };

  beforeEach(() => {
    ai.enabled = true;
    metamodel.type = {
      key: "Application",
      icon: "apps",
      fields_schema: [
        { section: "Info", fields: [{ key: "shared", label: "Shared", type: "boolean" }] },
      ],
      subtypes: [{ key: "micro", label: "Micro", hidden_fields: ["shared"] }],
    };
    vi.mocked(api.get).mockImplementation((path: string) =>
      path.endsWith("/my-permissions")
        ? Promise.resolve({ effective: { can_edit: true } })
        : Promise.resolve(path === "/cards/c2" ? OTHER : CARD),
    );
  });

  const showC2 = async (rerenderWith: (id: string | null) => void) => {
    rerenderWith("c2");
    await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Salesforce"));
  };

  it("ignores a suggestion that arrives after another card is shown", async () => {
    let answer: (v: unknown) => void = () => {};
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { rerenderWith } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "AI suggest" }));
    await showC2(rerenderWith);
    await act(async () => answer(SUGGESTION));
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI suggest" })).toBeInTheDocument();
  });

  it("ignores a failed suggestion that arrives after another card is shown", async () => {
    let fail: (e: unknown) => void = () => {};
    vi.mocked(api.post).mockImplementation(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    const { rerenderWith } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "AI suggest" }));
    await showC2(rerenderWith);
    await act(async () => fail(new Error("late failure")));
    expect(screen.queryByText("late failure")).not.toBeInTheDocument();
  });

  it("does not paint an apply that lands after the switch onto the next card", async () => {
    vi.mocked(api.post).mockResolvedValue(SUGGESTION);
    let land: () => void = () => {};
    vi.mocked(api.patch).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          land = () => reject(new ApiError("Refused", 422, null));
        }),
    );
    vi.mocked(api.patch).mockResolvedValueOnce({ ...CARD, description: "An ERP suite." });
    const { rerenderWith } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "AI suggest" }));
    await userEvent.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    await showC2(rerenderWith);
    await act(async () => land());
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("card-content")).toHaveTextContent("Salesforce");
    expect(screen.queryByText("An ERP suite.")).not.toBeInTheDocument();
    expect(screen.queryByText(SKIPPED)).not.toBeInTheDocument();
  });

  it("clears the warning when a new suggestion is asked for", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(SUGGESTION);
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError("Refused", 422, null));
    vi.mocked(api.patch).mockResolvedValueOnce({ ...CARD, description: "An ERP suite." });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "AI suggest" }));
    await userEvent.click(await screen.findByRole("button", { name: /Apply suggestions/ }));
    expect(await screen.findByText(SKIPPED)).toBeInTheDocument();
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "AI suggest" }));
    expect(screen.queryByText(SKIPPED)).not.toBeInTheDocument();
  });

  it("does not offer a value for a field the card's subtype hides", async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      path.endsWith("/my-permissions")
        ? Promise.resolve({ effective: { can_edit: true } })
        : Promise.resolve({ ...CARD, subtype: "micro" }),
    );
    vi.mocked(api.post).mockResolvedValue(SUGGESTION);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "AI suggest" }));
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply description/ })).toBeInTheDocument();
  });
});

describe("CardDetailSidePanel — the AI panel's states", () => {
  const SUGGESTION = {
    suggestions: {
      description: { value: "An ERP suite.", confidence: 0.9 },
      shared: { value: true, confidence: 0.7 },
    },
    sources: [],
  };
  const SEARCHING = "Generating description...";

  beforeEach(() => {
    ai.enabled = true;
    metamodel.type = {
      key: "Application",
      icon: "apps",
      fields_schema: [
        { section: "Info", fields: [{ key: "shared", label: "Shared", type: "boolean" }] },
      ],
      subtypes: [],
    };
    vi.mocked(api.get).mockImplementation((path: string) =>
      path.endsWith("/my-permissions")
        ? Promise.resolve({ effective: { can_edit: true } })
        : Promise.resolve(path === "/cards/c2" ? OTHER : CARD),
    );
  });

  const suggestButton = () => screen.findByRole("button", { name: "AI suggest" });

  it("shows the panel while the suggestion is being made", async () => {
    vi.mocked(api.post).mockImplementation(() => new Promise(() => {}));
    mount();
    await userEvent.click(await suggestButton());
    expect(await screen.findByText(SEARCHING)).toBeInTheDocument();
  });

  it("shows a failed suggestion's reason in the panel", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("Model offline"));
    mount();
    await userEvent.click(await suggestButton());
    expect(await screen.findByText("Model offline")).toBeInTheDocument();
    expect(screen.getByText("AI Suggestion Failed")).toBeInTheDocument();
    expect(screen.queryByText(SEARCHING)).not.toBeInTheDocument();
  });

  it("keeps the new card's suggestion busy when the old card's one settles late", async () => {
    let answerA: (v: unknown) => void = () => {};
    vi.mocked(api.post).mockImplementationOnce(
      () => new Promise((resolve) => (answerA = resolve)),
    );
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(() => {}));
    const { rerenderWith } = mount();
    await userEvent.click(await suggestButton());
    expect(await screen.findByText(SEARCHING)).toBeInTheDocument();
    rerenderWith("c2");
    await waitFor(() => expect(screen.getByTestId("card-content")).toHaveTextContent("Salesforce"));
    await userEvent.click(await suggestButton());
    expect(await screen.findByText(SEARCHING)).toBeInTheDocument();
    await act(async () => answerA(SUGGESTION));
    expect(screen.getByText(SEARCHING)).toBeInTheDocument();
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("closes the panel on Dismiss and offers the suggest button again", async () => {
    vi.mocked(api.post).mockResolvedValue(SUGGESTION);
    mount();
    await userEvent.click(await suggestButton());
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI suggest" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI suggest" })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("clears a failed suggestion's reason on Close, and asking again shows no stale one", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Model offline"));
    mount();
    await userEvent.click(await suggestButton());
    expect(await screen.findByText("Model offline")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Model offline")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Suggestion Failed")).not.toBeInTheDocument();
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "AI suggest" }));
    expect(await screen.findByText(SEARCHING)).toBeInTheDocument();
    expect(screen.queryByText("Model offline")).not.toBeInTheDocument();
  });

  it("suggests and applies on a card whose type the metamodel does not know", async () => {
    metamodel.type = undefined;
    vi.mocked(api.post).mockResolvedValue(SUGGESTION);
    vi.mocked(api.patch).mockImplementation(async (_path, body) => ({
      ...CARD,
      ...(body as object),
    }));
    mount();
    await userEvent.click(await suggestButton());
    expect(await screen.findByText("AI Suggestions")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Apply suggestions/ }));
    // As above: the panel shows the same text until it closes.
    await waitFor(() => expect(screen.queryByText("AI Suggestions")).not.toBeInTheDocument());
    expect(await screen.findByText("An ERP suite.")).toBeInTheDocument();
    expect(vi.mocked(api.patch).mock.calls).toEqual([
      ["/cards/c1", { description: "An ERP suite.", attributes: { shared: true } }],
    ]);
  });
});
