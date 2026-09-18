/**
 * The "Linked process" panel entry, rendered with the panel's own Preact.
 * `useService` is stubbed: the entry only ever asks it for `modeling`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { h, render } from "@bpmn-io/properties-panel/preact";

const updateProperties = vi.fn();
vi.mock("bpmn-js-properties-panel", () => ({
  useService: () => ({ updateProperties }),
}));

import CalledProcessEntry, { ENTRY_CLASS } from "./CalledProcessEntry";
import { PROCESS_REF_ATTR } from "./calledProcess";
import type { CalledProcessBridge } from "./calledProcessModule";

const UUID = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";

/** A call activity, whose reference lives in BPMN's own `calledElement`. */
function element(calledElement?: string) {
  const props: Record<string, unknown> = { $type: "bpmn:CallActivity", calledElement };
  return { id: "Activity_1", businessObject: { ...props, get: (n: string) => props[n] } };
}

/** A plain step, whose reference lives in the Turbo EA extension attribute. */
function task(processRef?: string) {
  const props: Record<string, unknown> = {
    $type: "bpmn:ServiceTask",
    [PROCESS_REF_ATTR]: processRef,
  };
  return { id: "Activity_2", businessObject: { ...props, get: (n: string) => props[n] } };
}

function bridge(names: Record<string, string> = {}): CalledProcessBridge {
  return {
    open: vi.fn(),
    openProcess: vi.fn(),
    names,
    labels: {
      group: "Linked process",
      choose: "Choose process…",
      open: "Open",
      clear: "Clear",
      noProcess: "No process linked",
      references: (ref) => `References ${ref}`,
      linkProcess: "Link process",
    },
  };
}

function mount(el: unknown, b: CalledProcessBridge) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  render(h(CalledProcessEntry, { id: "entry", element: el, bridge: b }), container);
  return container;
}

const buttons = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("button")).map((b) => b.textContent);

beforeEach(() => {
  updateProperties.mockClear();
  document.body.innerHTML = "";
});

describe("CalledProcessEntry", () => {
  it("shows the linked process with Open, Choose and Clear", () => {
    const b = bridge({ [UUID]: "Credit Check" });
    const el = element(UUID);
    const c = mount(el, b);
    expect(c.querySelector(`.${ENTRY_CLASS}-value`)?.textContent).toBe("Credit Check");
    expect(buttons(c)).toEqual(["Open", "Choose process…", "Clear"]);

    (c.querySelector(`.${ENTRY_CLASS}-open`) as HTMLButtonElement).click();
    expect(b.openProcess).toHaveBeenCalledWith(UUID);

    (c.querySelector(`.${ENTRY_CLASS}-clear`) as HTMLButtonElement).click();
    // `undefined` drops the attribute; "" would serialise calledElement="".
    expect(updateProperties).toHaveBeenCalledWith(el, {
      calledElement: undefined,
      [PROCESS_REF_ATTR]: undefined,
    });

    (c.querySelector(`.${ENTRY_CLASS}-choose`) as HTMLButtonElement).click();
    expect(b.open).toHaveBeenCalledWith(el);
  });

  it("falls back to the raw id when the name did not resolve", () => {
    const c = mount(element(UUID), bridge());
    expect(c.querySelector(`.${ENTRY_CLASS}-value`)?.textContent).toBe(UUID);
    expect(buttons(c)).toEqual(["Open", "Choose process…", "Clear"]);
  });

  it("offers only Choose when nothing is linked", () => {
    const c = mount(element(), bridge());
    expect(c.querySelector(`.${ENTRY_CLASS}-empty`)?.textContent).toBe("No process linked");
    expect(buttons(c)).toEqual(["Choose process…"]);
  });

  it("shows a foreign reference as a hint, with Choose to replace it", () => {
    const c = mount(element("Process_CreditCheck"), bridge());
    expect(c.querySelector(`.${ENTRY_CLASS}-foreign`)?.textContent).toBe(
      "References Process_CreditCheck",
    );
    expect(buttons(c)).toEqual(["Choose process…"]);
  });

  it("reads and clears a plain step's link through the extension attribute", () => {
    const b = bridge({ [UUID]: "Invoicing" });
    const el = task(UUID);
    const c = mount(el, b);
    expect(c.querySelector(`.${ENTRY_CLASS}-value`)?.textContent).toBe("Invoicing");

    (c.querySelector(`.${ENTRY_CLASS}-clear`) as HTMLButtonElement).click();
    expect(updateProperties).toHaveBeenCalledWith(el, {
      calledElement: undefined,
      [PROCESS_REF_ATTR]: undefined,
    });

    expect(mount(task(), bridge()).querySelector(`.${ENTRY_CLASS}-empty`)?.textContent).toBe(
      "No process linked",
    );
  });

  it("is a stock panel entry, keyed so the panel can find it", () => {
    const c = mount(element(), bridge());
    const entry = c.querySelector(".bio-properties-panel-entry");
    expect(entry?.getAttribute("data-entry-id")).toBe("entry");
    // The group header carries the heading; the entry does not repeat it.
    expect(c.querySelector(".bio-properties-panel-label")).toBeNull();
  });
});
