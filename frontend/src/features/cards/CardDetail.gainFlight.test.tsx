/**
 * The card page wires gamified data quality's flight (Part F): a save that
 * names its section mounts a `GainFlight` aimed at the pill — or at the sticky
 * bar's figure while the bar is open (the header has scrolled away) — and the
 * impact it reports reaches both. It also shows the full data-quality
 * breakdown (#1334) once the pill or the bar's score asks for it —
 * docked beside the page on a wide window, in a drawer below `md`, for
 * everyone, remembered per browser until closed. The content, the pill, the
 * bar, the breakdown host and the flight are stubs that expose what the page
 * hands them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ScoreGain } from "@/features/cards/gamification/scoreGain";
import type { DataQualityJumpTarget } from "@/features/cards/dataQualityJump";
import { DATA_QUALITY_PANEL_KEY } from "@/lib/dataQualityPanel";
import { setViewportWidth } from "@/test/matchMedia";

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
    onOpenBreakdown,
    breakdownOpen,
  }: {
    impactNonce?: number | null;
    onRootRef?: (el: HTMLElement | null) => void;
    onOpenBreakdown?: () => void;
    breakdownOpen?: boolean;
  }) => (
    <span
      ref={onRootRef}
      data-testid="pill"
      data-impact={String(impactNonce)}
      data-breakdown-open={String(breakdownOpen)}
    >
      <button type="button" onClick={onOpenBreakdown}>
        Open from pill
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
    onOpenBreakdown,
    breakdownOpen,
    rightInset,
  }: {
    open: boolean;
    impactNonce?: number | null;
    onFigureRef?: (el: HTMLElement | null) => void;
    onOpenBreakdown?: () => void;
    breakdownOpen?: boolean;
    rightInset?: number;
  }) => (
    <span
      ref={onFigureRef}
      data-testid="sticky-figure"
      data-open={String(open)}
      data-impact={String(impactNonce)}
      data-inset={String(rightInset)}
      data-breakdown-open={String(breakdownOpen)}
    >
      <button type="button" onClick={onOpenBreakdown}>
        Open from bar
      </button>
    </span>
  ),
}));
vi.mock("@/features/cards/sections/DataQualityBreakdownPanel", () => ({
  DATA_QUALITY_PANEL_WIDTH: 320,
}));
vi.mock("@/features/cards/sections/DataQualityBreakdownHost", () => ({
  DataQualityBreakdownHost: ({
    cardId,
    cardType,
    value,
    docked,
    onJump,
    onClose,
  }: {
    cardId: string;
    cardType?: string;
    value: number;
    docked: boolean;
    onJump?: (target: DataQualityJumpTarget) => void;
    onClose: () => void;
  }) => (
    <aside
      data-testid="breakdown"
      data-card={`${cardId}/${cardType}`}
      data-value={String(value)}
      data-docked={String(docked)}
    >
      <button type="button" onClick={() => onJump?.({ tab: "card", anchor: "card-section-tags" })}>
        Jump from breakdown
      </button>
      <button type="button" onClick={onClose}>
        Close breakdown
      </button>
    </aside>
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

/** The CSS rules (from emotion's style tags) that apply to `el`'s own classes. */
function rulesFor(el: HTMLElement): string {
  const classes = [...el.classList];
  return [...document.querySelectorAll("style")]
    .map((s) => s.textContent ?? "")
    .join("\n")
    .split("}")
    .filter((rule) => classes.some((c) => rule.includes(`.${c}{`) || rule.includes(`.${c} `)))
    .join("}");
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
    // Header in view: the bar is closed.
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "false");
  });

  it("aims at the sticky bar's figure while the header is off screen", async () => {
    gamification.offscreen = true;
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "true");
    // A jumped-to section clears the app bar (72) and the bar (44).
    expect(rulesFor(screen.getByTestId("card-detail-page"))).toContain(
      "--card-section-scroll-margin:116px",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));
    expect(screen.getByTestId("flight")).toHaveAttribute("data-target", "sticky-figure");
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
    // And the sections keep the plain app-bar clearance.
    expect(rulesFor(screen.getByTestId("card-detail-page"))).not.toContain(
      "--card-section-scroll-margin",
    );
  });
});

describe("CardDetail — the data-quality breakdown", () => {
  const frame = () => screen.getByTestId("card-detail-page-frame");
  const fab = () => document.querySelector<HTMLElement>(".MuiFab-root");

  it("opens docked from the pill, remembers it, and makes room for it", async () => {
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.queryByTestId("breakdown")).not.toBeInTheDocument();
    expect(screen.getByTestId("pill")).toHaveAttribute("data-breakdown-open", "false");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-breakdown-open", "false");
    expect(frame()).toHaveStyle({ paddingRight: "0px" });
    expect(frame()).toContainElement(screen.getByTestId("card-detail-page"));
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-inset", "0");
    expect(fab()).toHaveStyle({ right: "24px" });

    await userEvent.click(screen.getByRole("button", { name: "Open from pill" }));
    const breakdown = screen.getByTestId("breakdown");
    expect(breakdown).toHaveAttribute("data-docked", "true");
    expect(breakdown).toHaveAttribute("data-card", "card-1/Application");
    expect(breakdown).toHaveAttribute("data-value", "50");
    expect(window.localStorage.getItem(DATA_QUALITY_PANEL_KEY)).toBe("true");
    expect(screen.getByTestId("pill")).toHaveAttribute("data-breakdown-open", "true");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-breakdown-open", "true");
    expect(frame()).toHaveStyle({ paddingRight: "320px" });
    // The bar ends where the panel starts, and opening it does not open the bar.
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-inset", "320");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "false");
    expect(fab()).toHaveStyle({ right: "344px" });
    // The orb still lands on the pill while the header is in view.
    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));
    expect(screen.getByTestId("flight")).toHaveAttribute("data-target", "pill");
    expect(screen.getByTestId("breakdown")).toHaveAttribute("data-value", "60");
  });

  it("opens from the sticky bar's score too", async () => {
    gamification.offscreen = true;
    renderPage();
    await screen.findByTestId("pill");
    await userEvent.click(screen.getByRole("button", { name: "Open from bar" }));
    expect(screen.getByTestId("breakdown")).toHaveAttribute("data-docked", "true");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-inset", "320");
  });

  it("hands the breakdown the page's jump and stays open through it", async () => {
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.getByTestId("focus-target")).toHaveTextContent(/^null$/);
    await userEvent.click(screen.getByRole("button", { name: "Open from pill" }));
    await userEvent.click(screen.getByRole("button", { name: "Jump from breakdown" }));
    expect(screen.getByTestId("focus-target")).toHaveTextContent(
      /^\{"tab":"card","anchor":"card-section-tags"\}$/,
    );
    expect(screen.getByTestId("breakdown")).toBeInTheDocument();
    expect(window.localStorage.getItem(DATA_QUALITY_PANEL_KEY)).toBe("true");
  });

  it("closes: the breakdown goes, the browser forgets it, the page takes its room back", async () => {
    window.localStorage.setItem(DATA_QUALITY_PANEL_KEY, "true");
    renderPage();
    await screen.findByTestId("breakdown");
    await userEvent.click(screen.getByRole("button", { name: "Close breakdown" }));
    expect(screen.queryByTestId("breakdown")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DATA_QUALITY_PANEL_KEY)).toBeNull();
    expect(screen.getByTestId("pill")).toHaveAttribute("data-breakdown-open", "false");
    expect(frame()).toHaveStyle({ paddingRight: "0px" });
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-inset", "0");
    expect(fab()).toHaveStyle({ right: "24px" });
  });

  it("shows a breakdown the browser remembers open as soon as the card loads", async () => {
    window.localStorage.setItem(DATA_QUALITY_PANEL_KEY, "true");
    renderPage();
    const breakdown = await screen.findByTestId("breakdown");
    expect(breakdown).toHaveAttribute("data-card", "card-1/Application");
    expect(breakdown).toHaveAttribute("data-docked", "true");
    expect(frame()).toHaveStyle({ paddingRight: "320px" });
  });

  it("works with TurboRPG off, where there is no bar", async () => {
    gamification.enabled = false;
    renderPage();
    await screen.findByTestId("pill");
    expect(screen.queryByTestId("sticky-figure")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open from pill" }));
    expect(screen.getByTestId("breakdown")).toHaveAttribute("data-docked", "true");
    expect(frame()).toHaveStyle({ paddingRight: "320px" });
  });

  it("below md opens in a drawer and leaves the page its full width", async () => {
    setViewportWidth(800);
    renderPage();
    await screen.findByTestId("pill");
    await userEvent.click(screen.getByRole("button", { name: "Open from pill" }));
    expect(screen.getByTestId("breakdown")).toHaveAttribute("data-docked", "false");
    expect(frame()).toHaveStyle({ paddingRight: "0px" });
    expect(screen.getByTestId("sticky-figure")).toHaveAttribute("data-inset", "0");
    expect(fab()).toHaveStyle({ right: "24px" });
    // Widened, the same open breakdown docks.
    act(() => setViewportWidth(1280));
    expect(screen.getByTestId("breakdown")).toHaveAttribute("data-docked", "true");
    expect(frame()).toHaveStyle({ paddingRight: "320px" });
  });
});
