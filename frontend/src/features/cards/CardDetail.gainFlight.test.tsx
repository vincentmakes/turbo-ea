/**
 * The card page wires gamified data quality's flight (Part F): a save that
 * names its section mounts a `GainFlight` aimed at the pill — or at the sticky
 * bar's figure once the header has scrolled away — and the impact it reports
 * reaches both. The content, the pill, the bar and the flight are stubs that
 * expose what the page hands them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ScoreGain } from "@/features/cards/gamification/scoreGain";

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
  }: {
    card: { data_quality: number };
    onCardUpdate: (c: unknown) => void;
    onSaveOrigin?: (anchor: string) => void;
  }) => (
    <div>
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
  }: {
    impactNonce?: number | null;
    onRootRef?: (el: HTMLElement | null) => void;
  }) => <span ref={onRootRef} data-testid="pill" data-impact={String(impactNonce)} />,
}));
vi.mock("@/features/cards/gamification/StickyScoreBar", () => ({
  StickyScoreBar: ({
    impactNonce,
    onFigureRef,
  }: {
    impactNonce?: number | null;
    onFigureRef?: (el: HTMLElement | null) => void;
  }) => <span ref={onFigureRef} data-testid="sticky-figure" data-impact={String(impactNonce)} />,
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
  });

  it("aims at the sticky bar's figure while the header is off screen", async () => {
    gamification.offscreen = true;
    renderPage();
    await screen.findByTestId("pill");
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
  });
});
