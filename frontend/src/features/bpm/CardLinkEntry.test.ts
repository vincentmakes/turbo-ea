/**
 * The four card-link rows, rendered with the panel's own Preact.
 *
 * These have no diagram half at all: they render `bridge.links` — the draft's
 * element links, the same rows the pre-link table edits — and every action
 * goes back through the bridge for the React side to persist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { h, render } from "@bpmn-io/properties-panel/preact";

import CardLinkEntry from "./CardLinkEntry";
import { ENTRY_CLASS } from "./linkEntryDom";
import { LINK_KIND_ORDER, emptyLinks } from "./calledProcess";
import type { CardLinkKind, ElementLinks } from "./calledProcess";
import type { LinkBridge, LinkLabels } from "./calledProcessModule";

const UUID = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";

function step(id = "task_1") {
  return { id, businessObject: { $type: "bpmn:ServiceTask", get: () => undefined } };
}

function bridge(links: Record<string, ElementLinks> = {}): LinkBridge {
  const kinds = Object.fromEntries(
    LINK_KIND_ORDER.map((kind) => [
      kind,
      { label: `Label:${kind}`, choose: `Choose:${kind}`, none: `None:${kind}` },
    ]),
  ) as LinkLabels["kinds"];
  return {
    openPicker: vi.fn(),
    clearLink: vi.fn(),
    openCard: vi.fn(),
    names: {},
    links,
    canLinkCards: true,
    labels: {
      group: "Linked cards",
      open: "Open",
      clear: "Clear",
      references: (r) => r,
      linkCards: "Link cards",
      kinds,
    },
  };
}

function mount(el: unknown, b: LinkBridge, kind: CardLinkKind) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(h(CardLinkEntry, { id: `entry-${kind}`, element: el, bridge: b, kind }), container);
  return container;
}

const buttons = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("button")).map((b) => b.textContent);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("CardLinkEntry", () => {
  const singles: CardLinkKind[] = ["application", "data_object", "it_component"];

  it.each(singles)("shows the linked card with Open, Choose and Clear (%s)", (kind) => {
    const b = bridge({ task_1: { ...emptyLinks(), [kind]: { id: UUID, name: "SAP S/4HANA" } } });
    const el = step();
    const c = mount(el, b, kind);
    expect(c.querySelector(`.${ENTRY_CLASS}-value`)?.textContent).toBe("SAP S/4HANA");
    expect(buttons(c)).toEqual(["Open", `Choose:${kind}`, "Clear"]);

    (c.querySelector(`.${ENTRY_CLASS}-open`) as HTMLButtonElement).click();
    expect(b.openCard).toHaveBeenCalledWith(UUID, kind);

    (c.querySelector(`.${ENTRY_CLASS}-choose`) as HTMLButtonElement).click();
    expect(b.openPicker).toHaveBeenCalledWith(el, kind);

    (c.querySelector(`.${ENTRY_CLASS}-clear`) as HTMLButtonElement).click();
    expect(b.clearLink).toHaveBeenCalledWith(el, kind);
  });

  it.each(singles)("offers only Choose when nothing is linked (%s)", (kind) => {
    const c = mount(step(), bridge({ task_1: emptyLinks() }), kind);
    expect(c.querySelector(`.${ENTRY_CLASS}-empty`)?.textContent).toBe(`None:${kind}`);
    expect(buttons(c)).toEqual([`Choose:${kind}`]);
  });

  it("reads each kind from its own field, never another's", () => {
    const b = bridge({ task_1: { ...emptyLinks(), application: { id: UUID, name: "SAP" } } });
    const c = mount(step(), b, "data_object");
    expect(c.querySelector(`.${ENTRY_CLASS}-empty`)).not.toBeNull();
  });

  it("is empty for a shape the server has not seen yet", () => {
    // No entry in the map at all — a step placed since the last autosave.
    const c = mount(step("brand_new"), bridge(), "application");
    expect(c.querySelector(`.${ENTRY_CLASS}-empty`)).not.toBeNull();
    expect(buttons(c)).toEqual(["Choose:application"]);
  });

  it("lists every organization as a chip, with Choose and Clear", () => {
    const orgs = [
      { id: "o1", name: "Sales" },
      { id: "o2", name: "Finance" },
    ];
    const b = bridge({ task_1: { ...emptyLinks(), organizations: orgs } });
    const el = step();
    const c = mount(el, b, "organization");
    const chips = Array.from(c.querySelectorAll(`.${ENTRY_CLASS}-chip`)).map((n) => n.textContent);
    expect(chips).toEqual(["Sales", "Finance"]);
    // M:N, so there is nothing single to Open — the basket replaces the set.
    expect(buttons(c)).toEqual(["Choose:organization", "Clear"]);

    (c.querySelector(`.${ENTRY_CLASS}-clear`) as HTMLButtonElement).click();
    expect(b.clearLink).toHaveBeenCalledWith(el, "organization");
  });

  it("offers only Choose when no organization is linked", () => {
    const c = mount(step(), bridge({ task_1: emptyLinks() }), "organization");
    expect(c.querySelectorAll(`.${ENTRY_CLASS}-chip`)).toHaveLength(0);
    expect(buttons(c)).toEqual(["Choose:organization"]);
  });

  it("keys the row and names its card type, so the panel can place it", () => {
    const c = mount(step(), bridge(), "it_component");
    const entry = c.querySelector(".bio-properties-panel-entry");
    expect(entry?.getAttribute("data-entry-id")).toBe("entry-it_component");
    expect(c.querySelector(".bio-properties-panel-label")?.textContent).toBe("Label:it_component");
  });

  it("reads the label shape's target, so a label never carries its own link", () => {
    const b = bridge({ task_1: { ...emptyLinks(), application: { id: UUID, name: "SAP" } } });
    const label = { id: "label_1", labelTarget: { id: "task_1" }, businessObject: {} };
    const c = mount(label, b, "application");
    expect(c.querySelector(`.${ENTRY_CLASS}-value`)?.textContent).toBe("SAP");
  });
});
