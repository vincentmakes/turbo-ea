/**
 * The Business Process row, rendered with the panel's own Preact.
 *
 * Its read rule is the interesting part: the value comes from the *server's*
 * view of the draft (which already merged the draft's links with the
 * diagram's reference), and the live diagram reference is only the fallback
 * for a shape the server has not seen yet. That is what makes a process
 * linked in a table show up here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { h, render } from "@bpmn-io/properties-panel/preact";

import CalledProcessEntry, { ENTRY_CLASS } from "./CalledProcessEntry";
import { LINK_KIND_ORDER, PROCESS_REF_ATTR, emptyLinks } from "./calledProcess";
import type { ElementLinks } from "./calledProcess";
import type { LinkBridge, LinkLabels } from "./calledProcessModule";

const UUID = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";
const OTHER = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** A call activity, whose diagram reference lives in `calledElement`. */
function element(calledElement?: string, id = "call_1") {
  const props: Record<string, unknown> = { $type: "bpmn:CallActivity", calledElement };
  return { id, businessObject: { ...props, get: (n: string) => props[n] } };
}

/** A plain step, whose diagram reference is the Turbo EA attribute. */
function task(processRef?: string, id = "task_1") {
  const props: Record<string, unknown> = {
    $type: "bpmn:ServiceTask",
    [PROCESS_REF_ATTR]: processRef,
  };
  return { id, businessObject: { ...props, get: (n: string) => props[n] } };
}

function bridge(
  opts: { names?: Record<string, string>; links?: Record<string, ElementLinks> } = {},
): LinkBridge {
  const kinds = Object.fromEntries(
    LINK_KIND_ORDER.map((kind) => [
      kind,
      { label: `Label:${kind}`, choose: "Choose process…", none: "No process linked" },
    ]),
  ) as LinkLabels["kinds"];
  kinds.process.label = "Business Process";
  return {
    openPicker: vi.fn(),
    clearLink: vi.fn(),
    openCard: vi.fn(),
    names: opts.names ?? {},
    links: opts.links ?? {},
    canLinkCards: true,
    labels: {
      group: "Linked cards",
      open: "Open",
      clear: "Clear",
      references: (ref) => `References ${ref}`,
      linkCards: "Link cards",
      kinds,
    },
  };
}

function mount(el: unknown, b: LinkBridge) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(h(CalledProcessEntry, { id: "entry", element: el, bridge: b }), container);
  return container;
}

const buttons = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("button")).map((b) => b.textContent);
const valueOf = (c: HTMLElement) => c.querySelector(`.${ENTRY_CLASS}-value`)?.textContent;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("CalledProcessEntry", () => {
  it("shows the process the server resolved, with Open, Choose and Clear", () => {
    const b = bridge({
      links: { call_1: { ...emptyLinks(), business_process: { id: UUID, name: "Credit Check" } } },
    });
    const el = element(UUID);
    const c = mount(el, b);
    expect(valueOf(c)).toBe("Credit Check");
    expect(buttons(c)).toEqual(["Open", "Choose process…", "Clear"]);

    (c.querySelector(`.${ENTRY_CLASS}-open`) as HTMLButtonElement).click();
    expect(b.openCard).toHaveBeenCalledWith(UUID, "process");

    (c.querySelector(`.${ENTRY_CLASS}-clear`) as HTMLButtonElement).click();
    // The React side owns the write: it clears the diagram *and* the draft.
    expect(b.clearLink).toHaveBeenCalledWith(el, "process");

    (c.querySelector(`.${ENTRY_CLASS}-choose`) as HTMLButtonElement).click();
    expect(b.openPicker).toHaveBeenCalledWith(el, "process");
  });

  it("shows a link the diagram knows nothing about — one made in a table", () => {
    // The whole point of reading the server's view: no `calledElement`, no
    // `processRef`, and the row is still linked.
    const b = bridge({
      links: { task_1: { ...emptyLinks(), business_process: { id: UUID, name: "Invoicing" } } },
    });
    const c = mount(task(undefined), b);
    expect(valueOf(c)).toBe("Invoicing");
    expect(buttons(c)).toEqual(["Open", "Choose process…", "Clear"]);
  });

  it("prefers the server's value over a stale diagram reference", () => {
    const b = bridge({
      links: { call_1: { ...emptyLinks(), business_process: { id: OTHER, name: "Invoicing" } } },
      names: { [UUID]: "Credit Check" },
    });
    const c = mount(element(UUID), b);
    expect(valueOf(c)).toBe("Invoicing");
  });

  it("reads the live diagram reference for a shape not yet saved", () => {
    // Placed since the last autosave, so the server has never seen it: the
    // element id is absent from the links map entirely.
    const b = bridge({ names: { [UUID]: "Credit Check" } });
    const c = mount(element(UUID), b);
    expect(valueOf(c)).toBe("Credit Check");
    expect(buttons(c)).toEqual(["Open", "Choose process…", "Clear"]);
  });

  it("falls back to the raw id when the name did not resolve", () => {
    const c = mount(element(UUID), bridge());
    expect(valueOf(c)).toBe(UUID);
  });

  it("offers only Choose when nothing is linked", () => {
    const b = bridge({ links: { call_1: emptyLinks() } });
    const c = mount(element(), b);
    expect(c.querySelector(`.${ENTRY_CLASS}-empty`)?.textContent).toBe("No process linked");
    expect(buttons(c)).toEqual(["Choose process…"]);
  });

  it("reads a cleared link as cleared, not as the diagram still says", () => {
    // The user unlinked the step in this draft; the diagram's own reference
    // must not put it back.
    const b = bridge({ links: { call_1: emptyLinks() }, names: { [UUID]: "Credit Check" } });
    const c = mount(element(UUID), b);
    expect(c.querySelector(`.${ENTRY_CLASS}-empty`)).not.toBeNull();
    expect(buttons(c)).toEqual(["Choose process…"]);
  });

  it("shows a foreign reference as a hint, with Choose to replace it", () => {
    const c = mount(element("Process_CreditCheck"), bridge());
    expect(c.querySelector(`.${ENTRY_CLASS}-foreign`)?.textContent).toBe(
      "References Process_CreditCheck",
    );
    expect(buttons(c)).toEqual(["Choose process…"]);
  });

  it("is a stock panel entry, keyed and labelled so the panel can place it", () => {
    const c = mount(element(), bridge());
    const entry = c.querySelector(".bio-properties-panel-entry");
    expect(entry?.getAttribute("data-entry-id")).toBe("entry");
    // One group holds five rows now, so each names its own card type.
    expect(c.querySelector(".bio-properties-panel-label")?.textContent).toBe("Business Process");
  });
});
