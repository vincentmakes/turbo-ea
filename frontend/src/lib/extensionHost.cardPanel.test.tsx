/**
 * UI SDK 1.37 — `sdk.CardDetailSidePanel` passes an extension's plain-data
 * `focus` through to core's side panel, so an extension page can open a card
 * on the field, section or relation group to fill.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));
// The real panel pulls the whole card-detail graph; this suite is about the
// SDK wrapper in front of it.
vi.mock("@/components/CardDetailSidePanel", () => ({
  default: (props: { cardId: string | null; open: boolean; focus?: unknown }) => (
    <div
      data-testid="panel"
      data-card={props.cardId ?? ""}
      data-open={String(props.open)}
      data-focus={props.focus === undefined ? "absent" : JSON.stringify(props.focus)}
    />
  ),
}));

import {
  ExtensionCardDetailSidePanel,
  initExtensionHost,
  resetExtensionHost,
} from "./extensionHost";

describe("sdk.CardDetailSidePanel focus (UI SDK 1.37)", () => {
  beforeEach(() => {
    resetExtensionHost();
    delete window.TurboEA;
  });

  it("is the wrapper the sdk hands out", () => {
    initExtensionHost();
    const sdk = window.TurboEA?.sdk as Record<string, unknown>;
    expect(sdk.CardDetailSidePanel).toBe(ExtensionCardDetailSidePanel);
  });

  it("forwards the focus to core's side panel", async () => {
    const focus = { field: "alphaCost", relation: { type: "relX", side: "target" as const } };
    render(<ExtensionCardDetailSidePanel cardId="c1" open onClose={() => {}} focus={focus} />);
    const panel = await screen.findByTestId("panel");
    expect(panel).toHaveAttribute("data-card", "c1");
    expect(panel).toHaveAttribute("data-open", "true");
    expect(panel).toHaveAttribute("data-focus", JSON.stringify(focus));
  });

  it("passes no focus when the extension asks for none", async () => {
    render(<ExtensionCardDetailSidePanel cardId="c1" open onClose={() => {}} />);
    expect(await screen.findByTestId("panel")).toHaveAttribute("data-focus", "absent");
  });
});
