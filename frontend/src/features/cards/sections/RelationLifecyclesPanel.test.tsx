/**
 * Card detail's "Relation lifecycles" panel: the card's dated relations on
 * one time axis inside the Lifecycle section. "Today" is pinned to
 * 2026-07-01 (UTC), so the states below hold.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: (e: unknown) => (e as { name?: string } | null)?.name === "AbortError",
}));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useDateFormat", () => import("@/test/hooks").then((m) => m.useDateFormatModule()));

import { api } from "@/api/client";
import { hookState, withMetamodel } from "@/test/hooks";
import { makeCardType, makeRelationType } from "@/test/fixtures/metamodel";
import type { Relation } from "@/types";
import RelationLifecyclesPanel from "./RelationLifecyclesPanel";

const NOW = Date.parse("2026-07-01T12:00:00.000Z");

const APP = makeCardType({ key: "Application", label: "Application" });
const ITC = makeCardType({ key: "ITComponent", label: "IT Component" });
const ORG = makeCardType({ key: "Organization", label: "Organization" });
const RUNS_ON = makeRelationType({
  key: "runsOn",
  label: "runs on",
  reverse_label: "hosts",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  lifecycle_enabled: true,
});
const USES = makeRelationType({
  key: "uses",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
});
const FEEDS = makeRelationType({
  key: "feeds",
  label: "feeds",
  reverse_label: "is fed by",
  source_type_key: "Application",
  target_type_key: "Application",
  lifecycle_enabled: true,
});

const ME = { id: "me", name: "Me", type: "Application" };
const CURRENT = { active: "2025-01-01", endOfLife: "2030-01-01" };
const PLANNED = { plan: "2026-01-01", active: "2028-01-01" };
const ENDED = { active: "2019-01-01", endOfLife: "2024-01-01" };

let seq = 0;
function rel(
  type: string,
  source: { id: string; name: string; type: string },
  target: { id: string; name: string; type: string },
  lifecycle?: Record<string, string>,
): Relation {
  seq += 1;
  return { id: `r${seq}`, type, source_id: source.id, target_id: target.id, source, target, lifecycle };
}
const itc = (id: string, name: string) => ({ id, name, type: "ITComponent" });
const app = (id: string, name: string) => ({ id, name, type: "Application" });

const BOX = rel("runsOn", ME, itc("box", "Box Server"), CURRENT);
const NEXT = rel("runsOn", ME, itc("next", "Next Server"), PLANNED);
const OLD = rel("runsOn", ME, itc("old", "Old Server"), ENDED);
const ORG_USES = rel("uses", { id: "org", name: "Acme Org", type: "Organization" }, ME, CURRENT);
const FEEDS_OUT = rel("feeds", ME, app("bill", "Billing"), PLANNED);
const FEEDS_IN = rel("feeds", app("crm", "CRM"), ME, CURRENT);
const UNDATED = rel("runsOn", ME, itc("plain", "Plain Server"));

const CARD_LC = { active: "2024-01-01", endOfLife: "2029-01-01" };

function renderPanel(props: Partial<Parameters<typeof RelationLifecyclesPanel>[0]> = {}) {
  const onChanged = vi.fn();
  const utils = render(
    <MemoryRouter>
      <RelationLifecyclesPanel
        cardId="me"
        cardTypeKey="Application"
        cardLifecycle={CARD_LC}
        canManageRelations
        onChanged={onChanged}
        {...props}
      />
    </MemoryRouter>,
  );
  return { ...utils, onChanged };
}

const panel = () => screen.findByTestId("relation-lifecycles", undefined, { timeout: 2000 });
const names = () =>
  Array.from(document.querySelectorAll("[data-relation-lifecycle-row]")).map(
    (r) => r.querySelector(".MuiListItemText-primary")?.textContent,
  );
const headings = () =>
  Array.from(document.querySelectorAll("[data-relation-group]")).map((h) => h.textContent);
const leftOf = (el: Element) => parseFloat(getComputedStyle(el).left);
const widthOf = (el: Element) => parseFloat(getComputedStyle(el).width);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.clearAllMocks();
  hookState.reset();
  withMetamodel([APP, ITC, ORG], [RUNS_ON, USES, FEEDS]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RelationLifecyclesPanel", () => {
  it("renders nothing when no relation carries dates", async () => {
    vi.mocked(api.get).mockResolvedValue([UNDATED, { ...UNDATED, id: "x", lifecycle: {} }] as never);
    const { container } = renderPanel();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/relations?card_id=me", expect.anything()));
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the load fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));
    const { container } = renderPanel();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("groups the dated relations under each side's verb, the undated ones left out", async () => {
    vi.mocked(api.get).mockResolvedValue([NEXT, UNDATED, ORG_USES, BOX, FEEDS_IN, FEEDS_OUT] as never);
    renderPanel();
    await panel();
    // Read from this card's side: it is used BY the organisation; the
    // self-referencing type is two blocks, outgoing then incoming.
    // Ordered like the Relations section: by the other end's first appearance.
    expect(headings()).toEqual(["runs on", "is used by", "feeds", "is fed by"]);
    expect(names()).toEqual(["Box Server", "Next Server", "Acme Org", "Billing", "CRM"]);
    expect(screen.queryByText("Plain Server")).toBeNull();
    // Each name opens its card.
    expect(screen.getByRole("link", { name: /Billing/ })).toHaveAttribute("href", "/cards/bill");
  });

  it("counts the relations by state in the header", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, NEXT, OLD, FEEDS_IN] as never);
    renderPanel();
    const root = await panel();
    expect(within(root).getByText("Relation lifecycles")).toBeInTheDocument();
    expect(within(root).getByText("2 in effect")).toBeInTheDocument();
    expect(within(root).getByText("1 planned")).toBeInTheDocument();
    expect(within(root).getByText("1 ended")).toBeInTheDocument();
  });

  it("leaves out a state with no relation in it", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX] as never);
    renderPanel();
    const root = await panel();
    expect(within(root).getByText("1 in effect")).toBeInTheDocument();
    expect(within(root).queryByText(/planned$/)).toBeNull();
    expect(within(root).queryByText(/ended$/)).toBeNull();
  });

  it("draws each relation and the card on one axis with one Today line", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, NEXT] as never);
    renderPanel();
    await panel();
    // 2024-01-01 (the card) … 2030-01-01 (Box ends): whole UTC years, to 2031.
    const min = Date.UTC(2024, 0, 1);
    const range = Date.UTC(2031, 0, 1) - min;
    const pct = (iso: string) => ((Date.parse(iso) - min) / range) * 100;
    const box = screen.getByLabelText("Box Server · Active: 2025-01-01");
    expect(leftOf(box)).toBeCloseTo(pct("2025-01-01"), 6);
    expect(widthOf(box)).toBeCloseTo(pct("2030-01-01") - pct("2025-01-01"), 6);
    expect(leftOf(screen.getByLabelText("Box Server · End of Life: 2030-01-01"))).toBeCloseTo(
      pct("2030-01-01"),
      6,
    );
    // The card's own bar, as the reference row.
    const own = screen.getByLabelText("This card · Active: 2024-01-01");
    expect(leftOf(own)).toBe(0);
    const today = screen.getByTestId("relation-lifecycles-today");
    expect(leftOf(today)).toBeCloseTo(((Date.UTC(2026, 6, 1) - min) / range) * 100, 6);
    expect(screen.getByText("Today")).toBeInTheDocument();
    const ticks = Array.from(
      screen.getByTestId("relation-lifecycles-timeline").firstElementChild!.children,
    ).map((c) => c.textContent);
    expect(ticks).toEqual(["2024", "2026", "2028", "2030"]);
  });

  it("says when the card has no dates of its own", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX] as never);
    renderPanel({ cardLifecycle: {} });
    await panel();
    expect(screen.getByText("No dates")).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/^This card \u00B7/)).toHaveLength(0);
  });

  it("does not say so when the card has dates", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX] as never);
    renderPanel();
    await panel();
    expect(screen.queryByText("No dates")).toBeNull();
    expect(screen.getByText("This card")).toBeInTheDocument();
  });

  it("carries each relation's phase chip", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, NEXT] as never);
    renderPanel();
    await panel();
    expect(screen.getByText("Until 2030-01-01")).toBeInTheDocument();
    expect(screen.getByText("Planned · from 2028-01-01")).toBeInTheDocument();
  });

  it("keeps ended relations behind the toggle, muted once shown", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, OLD] as never);
    renderPanel();
    await panel();
    expect(names()).toEqual(["Box Server"]);
    fireEvent.click(screen.getByRole("button", { name: /Show ended \(1\)/ }));
    expect(names()).toEqual(["Box Server", "Old Server"]);
    expect(screen.getByText("Ended 2024-01-01")).toBeInTheDocument();
    const rows = document.querySelectorAll("[data-relation-lifecycle-row]");
    expect(getComputedStyle(rows[1]).opacity).toBe("0.6");
    expect(getComputedStyle(rows[0]).opacity).toBe("1");
    expect(getComputedStyle(screen.getByLabelText("Old Server · Active: 2019-01-01").closest("[style], div")!.parentElement!.parentElement!.parentElement!).opacity).toBe("0.5");
    fireEvent.click(screen.getByRole("button", { name: /Hide ended/ }));
    expect(names()).toEqual(["Box Server"]);
  });

  it("shows only ended relations' toggle when nothing else is dated", async () => {
    vi.mocked(api.get).mockResolvedValue([OLD] as never);
    renderPanel();
    await panel();
    expect(names()).toEqual([]);
    expect(screen.getByRole("button", { name: /Show ended \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("caps a long list at eight with Show all and Show fewer", async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      rel("runsOn", ME, itc(`s${i}`, `Server ${String(i).padStart(2, "0")}`), CURRENT),
    );
    vi.mocked(api.get).mockResolvedValue(many as never);
    renderPanel();
    await panel();
    expect(names()).toHaveLength(8);
    expect(screen.queryByRole("button", { name: "Show fewer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 10" }));
    expect(names()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "Show all 10" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(names()).toHaveLength(8);
  });

  it("offers no cap buttons on a short list", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, NEXT] as never);
    renderPanel();
    await panel();
    expect(screen.queryByRole("button", { name: /Show all|Show fewer|Show ended/ })).toBeNull();
  });

  it("offers the clock only on a tracked type to someone who may manage relations", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, ORG_USES] as never);
    const { unmount } = renderPanel();
    await panel();
    // `uses` does not track lifecycle: its dates came by import.
    expect(screen.getAllByRole("button", { name: "Edit relation dates" })).toHaveLength(1);
    unmount();
    renderPanel({ canManageRelations: false });
    await panel();
    expect(screen.queryByRole("button", { name: "Edit relation dates" })).toBeNull();
  });

  it("flags a relation still in effect after the card's End of Life", async () => {
    const after = rel("runsOn", ME, itc("late", "Late Server"), { active: "2025-01-01" });
    const before = rel("runsOn", ME, itc("early", "Early Server"), { active: "2025-01-01", endOfLife: "2028-01-01" });
    vi.mocked(api.get).mockResolvedValue([after, before, OLD] as never);
    renderPanel();
    await panel();
    const flag = screen.getAllByRole("img", {
      name: "Still in effect after this card's End of Life (2029-01-01)",
    });
    expect(flag).toHaveLength(1);
    const lateRow = screen.getByText("Late Server").closest("[data-relation-lifecycle-row]")!;
    expect(lateRow).toContainElement(flag[0]);
    // An ended relation is never flagged, even once shown.
    fireEvent.click(screen.getByRole("button", { name: /Show ended \(1\)/ }));
    expect(screen.getAllByRole("img", { name: /Still in effect/ })).toHaveLength(1);
  });

  it("saves new dates through the clock, merges the row and reports the change", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX, NEXT] as never);
    vi.mocked(api.patch).mockResolvedValue({
      id: BOX.id,
      type: "runsOn",
      source_id: "me",
      target_id: "box",
      lifecycle: { active: "2025-01-01", endOfLife: "2031-06-01" },
    } as never);
    const { onChanged } = renderPanel();
    await panel();
    const boxRow = screen.getByText("Box Server").closest("[data-relation-lifecycle-row]") as HTMLElement;
    fireEvent.click(within(boxRow).getByRole("button", { name: "Edit relation dates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith(`/relations/${BOX.id}`, { lifecycle: CURRENT });
    // The row keeps its card (the PATCH answer carries none) with the new end.
    expect(await screen.findByText("Until 2031-06-01")).toBeInTheDocument();
    expect(names()).toEqual(["Box Server", "Next Server"]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("closes the clock without saving on cancel", async () => {
    vi.mocked(api.get).mockResolvedValue([BOX] as never);
    const { onChanged } = renderPanel();
    await panel();
    fireEvent.click(screen.getByRole("button", { name: "Edit relation dates" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    expect(api.patch).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reloads on a new refresh key and ignores a reply that lands late", async () => {
    let resolveFirst: (v: Relation[]) => void = () => {};
    vi.mocked(api.get)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r as never)) as never)
      .mockResolvedValueOnce([NEXT] as never);
    const { rerender } = renderPanel({ refreshKey: 0 });
    rerender(
      <MemoryRouter>
        <RelationLifecyclesPanel
          cardId="me"
          cardTypeKey="Application"
          cardLifecycle={CARD_LC}
          canManageRelations
          refreshKey={1}
        />
      </MemoryRouter>,
    );
    await panel();
    expect(names()).toEqual(["Next Server"]);
    await act(async () => resolveFirst([BOX]));
    expect(names()).toEqual(["Next Server"]);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
