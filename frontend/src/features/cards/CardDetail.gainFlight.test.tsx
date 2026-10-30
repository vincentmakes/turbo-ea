/**
 * The card page wires gamified data quality's flight (Part F): a save that
 * names its section mounts a `GainFlight` aimed at the pill — or at the sticky
 * bar's figure while the bar is open (the header has scrolled away, or the
 * reader pinned the bar) — and the impact it reports reaches both. The
 * content, the pill, the bar and the flight are stubs that expose what the
 * page hands them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ScoreGain } from "@/features/cards/gamification/scoreGain";
import type { DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { STICKY_SCORE_PIN_KEY } from "@/lib/stickyScorePin";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: { "*": true } } }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, permissions: { "*": true } }),
}));
vi.mock("@/hooks/usePpmEnabled", () => ({ usePpmEnabled: () => ({ ppmEnabled: false }) }));

const gamification = vi.hoisted(() => ({ enabled: true, offscreen: false }));
vi.mock("@/hooks/useGamificationEnabled", () => ({
  useGamificationEnabled: () => gamification.enabled,
}));
vi.mock("@/features/cards/gamification/useHeaderOffscreen", () => ({
  useHeaderOffscreen: () => gamification.offscreen,
}));

vi.mock("@/features/cards/CardDetailContent", () => ({
  default: ({
    card,
    onCardUpdate,
    onSaveOrigin,
    focusTarget,
  }: {
    card: { data_quality: number };
    onCardUpdate: (c: unknown) => void;
    onSaveOrigin?: (anchor: string) => void;
    focusTarget?: { target: unknown } | null;
  }) => (
    <div>
      <span data-testid="focus-target">{JSON.stringify(focusTarget?.target ?? null)}</span>
      <button
        type="button"
        onClick={() => {
          onSaveOrigin?.("card-section-tags");
          onCardUpdate({ ...card, data_quality: card.data_quality + 10 });
        }}
      >
        Save tags
      </button>
      <button
        type="button"
        onClick={() => onCardUpdate({ ...card, data_quality: card.data_quality + 5 })}
      >
        Save header
      </button>
    </div>
  ),
}));
vi.mock("@/features/cards/sections", () => ({
  CardIdPill: () => null,
  DataQualityPill: ({
    impactNonce,
    onRootRef,
    onJump,
  }: {
    impactNonce?: number | null;
    onRootRef?: (el: HTMLElement | null) => void;
    onJump?: (target: DataQualityJumpTarget) => void;
  }) => (
    <span ref={onRootRef} data-testid="pill" data-impact={String(impactNonce)}>
      <button
        type="button"
        onClick={() =>
          onJump?.({ tab: "card", anchor: "card-section-lifecycle", sectionAnchor: "card-section-lifecycle" })
        }
      >
        Jump from pill
      </button>
    </span>
  ),
}));
vi.mock("@/features/cards/gamification/StickyScoreBar", () => ({
  STICKY_SCORE_BAR_HEIGHT: 44,
  StickyScoreBar: ({
    open,
    impactNonce,
    onFigureRef,
    cardId,
    cardType,
    onJump,
  }: {
    open: boolean;
    impactNonce?: number | null;
    onFigureRef?: (el: HTMLElement | null) => void;
    cardId?: string;
    cardType?: string;
    onJump?: (target: DataQualityJumpTarget) => void;
  }) => (
    <span
      ref={onFigureRef}
      data-testid="sticky-figure"
      data-open={String(open)}
      data-card={`${cardId}/${cardType}`}
      data-impact={String(impactNonce)}
    >
      <button type="button" onClick={() => onJump?.({ tab: "stakeholders" })}>
        Jump from bar
      </button>
    </span>
  ),
}));
vi.mock("@/features/cards/gamification/GainFlight", () => ({
  GainFlight: ({
    gain,
    targetEl,
    onImpact,
  }: {
    gain: ScoreGain;
    targetEl: HTMLElement | null;
    onImpact: (nonce: number) => void;
  }) => (
    <button
      type="button"
      data-testid="flight"
      data-origin={gain.originAnchor ?? ""}
      data-target={targetEl?.getAttribute("data-testid") ?? "none"}
      onClick={() => onImpact(gain.nonce)}
    >
      Land
    </button>
  ),
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import CardDetail from "./CardDetail";

const CARD = {
  id: "card-1",
  name: "My Application",
  type: "Application",
  subtype: null,
  status: "ACTIVE",
  approval_status: "DRAFT",
  data_quality: 50,
  lifecycle: {},
  attributes: {},
  tags: [],
  stakeholders: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  gamification.enabled = true;
  gamification.offscreen = false;
  vi.mocked(useMetamodel).mockReturnValue({
    types: [{ key: "Application", label: "Application", fields_schema: [], section_config: {} }],
    relationTypes: [],
    loading: false,
    getType: () => ({ key: "Application", label: "Application", fields_schema: [] }),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  vi.mocked(api.get).mockImplementation((path: string) =>
    Promise.resolve(path.includes("/my-permissions") ? { effective: { can_edit: true } } : CARD),
  );
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/cards/card-1"]}>
      <Routes>
        <Route path="/cards/:id" element={<CardDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CardDetail — the gain's flight", () => {
  it("flies a section's gain to the pill and passes the impact to the pill and the bar", async () => {
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));
    const flight = screen.getByTestId("flight");
    expect(flight).toHaveAttribute("data-origin", "card-section-tags");
    expect(flight).toHaveAttribute("data-target", "pill");
    expect(screen.getByTestId("pill")).toHaveAttribute("data-impact", "null");

    await userEvent.click(flight);
    expect(screen.getByTestId("pill")).toHaveAttribute("data-impact", "1");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-impact", "1");
    // Header in view, nothing pinned: the bar is closed and takes no room.
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "false");
    expect(screen.queryByTestId("sticky-score-spacer")).not.toBeInTheDocument();
  });

  it("aims at the sticky bar's figure while the header is off screen", async () => {
    gamification.offscreen = true;
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "true");
    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));
    expect(screen.getByTestId("flight")).toHaveAttribute("data-target", "sticky-figure");
  });

  it("keeps a pinned bar open with the header in view, makes room for it, and aims at it", async () => {
    window.localStorage.setItem(STICKY_SCORE_PIN_KEY, "true");
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("sticky-score-spacer")).toHaveStyle({ height: "44px" });
    expect(screen.getByTestId("sticky-score-spacer")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));
    expect(screen.getByTestId("flight")).toHaveAttribute("data-target", "sticky-figure");
  });

  it("hands the bar the card and the same jump the pill uses", async () => {
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-card", "card-1/Application");
    expect(screen.getByTestId("focus-target")).toHaveTextContent(/^null$/);
    await userEvent.click(screen.getByRole("button", { name: "Jump from bar" }));
    expect(screen.getByTestId("focus-target")).toHaveTextContent(/^\{"tab":"stakeholders"\}$/);
    await userEvent.click(screen.getByRole("button", { name: "Jump from pill" }));
    expect(screen.getByTestId("focus-target")).toHaveTextContent(
      /^\{"tab":"card","anchor":"card-section-lifecycle","sectionAnchor":"card-section-lifecycle"\}$/,
    );
  });

  it("flies nothing for a save that names no section", async () => {
    renderPage();
    await screen.findByTestId("pill");
    await userEvent.click(screen.getByRole("button", { name: "Save header" }));
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();
  });

  it("flies nothing with gamification off", async () => {
    gamification.enabled = false;
    renderPage();
    await screen.findByTestId("pill");
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save tags" }));
    });
    expect(screen.queryByTestId("flight")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sticky-figure")).not.toBeInTheDocument();
  });

  it("reserves no room for a pin while gamification is off", async () => {
    gamification.enabled = false;
    window.localStorage.setItem(STICKY_SCORE_PIN_KEY, "true");
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.queryByTestId("sticky-score-spacer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sticky-figure")).not.toBeInTheDocument();
  });
});
