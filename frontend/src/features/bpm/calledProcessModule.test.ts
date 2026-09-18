/**
 * The didi module: three doors to one bridge. The providers are exercised
 * against hand-rolled bpmn-js services — what matters is *which link kinds*
 * each door offers for a given shape, and that the pad opens the menu rather
 * than a picker of its own.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@bpmn-io/properties-panel", () => ({ Group: () => null }));
// The entry's `useService` hook comes from the panel's dist bundle, which
// drags the whole bpmn-js label-editing graph in; the providers under test
// never render the entries, so the hook is irrelevant here.
vi.mock("bpmn-js-properties-panel", () => ({ useService: vi.fn() }));

import CalledProcessEntry from "./CalledProcessEntry";
import CardLinkEntry from "./CardLinkEntry";
import { LINK_KIND_ORDER, PROCESS_REF_ATTR, emptyLinks } from "./calledProcess";
import {
  CALLED_PROCESS_GROUP_ID,
  LINK_MENU_ID,
  LINK_PAD_ENTRY,
  createCalledProcessModule,
} from "./calledProcessModule";
import type { LinkBridge, LinkLabels } from "./calledProcessModule";

const UUID = "3f2c9a1e-7b4d-4c6e-9a1f-0d2e5b7c8a90";

const FLOW_NODES = new Set([
  "bpmn:Task",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:SubProcess",
  "bpmn:CallActivity",
  "bpmn:StartEvent",
  "bpmn:ExclusiveGateway",
]);

/** A bpmn-js element with just enough moddle for `is()` / `$instanceOf` / `get()`. */
function element(
  type: string,
  props: { calledElement?: string; processRef?: string; id?: string } = {},
  extra: { labelTarget?: unknown } = {},
) {
  const values: Record<string, unknown> = {
    calledElement: props.calledElement,
    [PROCESS_REF_ATTR]: props.processRef,
  };
  return {
    id: props.id ?? "el",
    ...extra,
    businessObject: {
      $type: type,
      $instanceOf: (t: string) => t === type || (t === "bpmn:FlowNode" && FLOW_NODES.has(type)),
      calledElement: props.calledElement,
      get: (n: string) => values[n],
    },
  };
}

function bridge(canLinkCards = true): LinkBridge {
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
    links: {},
    canLinkCards,
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

type Ctor = new (...args: unknown[]) => unknown;

/** Instantiate the module's services the way didi would, with fakes. */
function boot(b: LinkBridge) {
  const mod = createCalledProcessModule(b) as unknown as Record<string, [string, unknown]>;
  const registered: { priority: number; provider: any }[] = [];
  const padProviders: any[] = [];
  const menuProviders: Record<string, any> = {};
  const handlers: Record<string, (e: unknown) => void> = {};
  const popupMenu = {
    registerProvider: (id: string, provider: unknown) => (menuProviders[id] = provider),
    open: vi.fn(),
    close: vi.fn(),
  };
  const services: Record<string, unknown> = {
    propertiesPanel: {
      registerProvider: (priority: number, provider: unknown) =>
        registered.push({ priority, provider }),
    },
    contextPad: { registerProvider: (p: unknown) => padProviders.push(p) },
    popupMenu,
    canvas: {
      getContainer: () => ({
        querySelector: () => ({ getBoundingClientRect: () => ({ left: 10, bottom: 40 }) }),
      }),
    },
    eventBus: { on: (name: string, cb: (e: unknown) => void) => (handlers[name] = cb) },
    turboCalledProcess: b,
  };
  for (const name of mod.__init__ as unknown as string[]) {
    const [kind, Klass] = mod[name];
    expect(kind).toBe("type");
    const deps = ((Klass as { $inject: string[] }).$inject ?? []).map((d) => services[d]);
    new (Klass as Ctor)(...deps);
  }
  return { registered, padProviders, menuProviders, handlers, popupMenu };
}

const ids = (groups: { id: string }[]) => groups.map((g) => g.id);
const entryIds = (group: { entries: { id: string }[] }) => group.entries.map((e) => e.id);

describe("createCalledProcessModule", () => {
  it("exposes the bridge as the turboCalledProcess value service", () => {
    const b = bridge();
    const mod = createCalledProcessModule(b) as unknown as Record<string, unknown>;
    expect(mod.turboCalledProcess).toEqual(["value", b]);
  });

  it("appends one Linked cards group with a row per link kind, after the stock groups", () => {
    const b = bridge();
    const { registered } = boot(b);
    expect(registered).toHaveLength(1);
    // Below the built-in provider's 1000, so the group renders last.
    expect(registered[0].priority).toBe(500);
    const provider = registered[0].provider;

    const stock = [{ id: "general" }];
    const groups = provider.getGroups(element("bpmn:UserTask"))(stock);
    expect(ids(groups)).toEqual(["general", CALLED_PROCESS_GROUP_ID]);

    const group = groups[1];
    expect(group.label).toBe("Linked cards");
    expect(entryIds(group)).toEqual([
      `${CALLED_PROCESS_GROUP_ID}-process`,
      `${CALLED_PROCESS_GROUP_ID}-application`,
      `${CALLED_PROCESS_GROUP_ID}-data_object`,
      `${CALLED_PROCESS_GROUP_ID}-it_component`,
      `${CALLED_PROCESS_GROUP_ID}-organization`,
    ]);
    // The process row keeps its own component (it reads the diagram too); the
    // four card rows share one, told apart by `kind`.
    expect(group.entries[0].component).toBe(CalledProcessEntry);
    expect(group.entries[1].component).toBe(CardLinkEntry);
    expect(group.entries[1].kind).toBe("application");
    // The bridge rides on every entry: `Group` spreads it into the component.
    for (const entry of group.entries) expect(entry.bridge).toBe(b);
  });

  it("offers a data artefact the Data Object row only, like the steps table", () => {
    const { registered } = boot(bridge());
    const provider = registered[0].provider;
    const groups = provider.getGroups(element("bpmn:DataObjectReference"))([{ id: "general" }]);
    expect(entryIds(groups[1])).toEqual([`${CALLED_PROCESS_GROUP_ID}-data_object`]);
    expect(groups[1].entries[0].kind).toBe("data_object");
  });

  it("offers the process row alone without a draft — the card links have nowhere to go", () => {
    const { registered } = boot(bridge(false));
    const provider = registered[0].provider;
    const stock = [{ id: "general" }];
    expect(entryIds(provider.getGroups(element("bpmn:UserTask"))(stock)[1])).toEqual([
      `${CALLED_PROCESS_GROUP_ID}-process`,
    ]);
    // …and an artefact, whose only link is a card link, gets no group at all.
    expect(provider.getGroups(element("bpmn:DataObjectReference"))(stock)).toBe(stock);
  });

  it("leaves the stock groups alone for a pool, a flow and a label", () => {
    const { registered } = boot(bridge());
    const provider = registered[0].provider;
    const stock = [{ id: "general" }];
    expect(provider.getGroups(element("bpmn:Participant"))(stock)).toBe(stock);
    expect(provider.getGroups(element("bpmn:SequenceFlow"))(stock)).toBe(stock);
    const label = element("bpmn:StartEvent", {}, { labelTarget: { id: "event" } });
    expect(provider.getGroups(label)(stock)).toBe(stock);
  });

  it("adds one context-pad entry that opens the link menu under the pad", () => {
    const b = bridge();
    const { padProviders, popupMenu } = boot(b);
    expect(padProviders).toHaveLength(1);
    const provider = padProviders[0];

    expect(provider.getContextPadEntries(element("bpmn:Participant"))).toEqual({});

    const el = element("bpmn:UserTask");
    const entry = provider.getContextPadEntries(el)[LINK_PAD_ENTRY];
    expect(entry.group).toBe("edit");
    expect(entry.title).toBe("Link cards");
    expect(entry.html).toContain("<svg");

    entry.action.click({ x: 1, y: 2 }, el);
    // Anchored to the open pad, with the cursor kept as diagram-js's hint.
    expect(popupMenu.open).toHaveBeenCalledWith(
      el,
      LINK_MENU_ID,
      { x: 10, y: 45, cursor: { x: 1, y: 2 } },
      { title: "Link cards", width: "240px" },
    );
  });

  it("offers the pad entry on an artefact too — it has one link to make", () => {
    const { padProviders } = boot(bridge());
    const entries = padProviders[0].getContextPadEntries(element("bpmn:DataStoreReference"));
    expect(entries).toHaveProperty(LINK_PAD_ENTRY);
  });

  it("lists the shape's link kinds in the menu, and closes it before picking", () => {
    const b = bridge();
    const { menuProviders, popupMenu } = boot(b);
    const provider = menuProviders[LINK_MENU_ID];
    expect(provider).toBeDefined();

    const el = element("bpmn:ServiceTask");
    const entries = provider.getPopupMenuEntries(el);
    expect(Object.keys(entries)).toEqual([
      "link-process",
      "link-application",
      "link-data_object",
      "link-it_component",
      "link-organization",
    ]);
    expect(entries["link-application"].label).toBe("Label:application");

    entries["link-application"].action();
    // The menu does not close itself on trigger — diagram-js only runs the
    // action — and a dialog under an open menu is a trap.
    expect(popupMenu.close).toHaveBeenCalled();
    expect(b.openPicker).toHaveBeenCalledWith(el, "application");
  });

  it("lists only what the shape offers", () => {
    const { menuProviders } = boot(bridge());
    const provider = menuProviders[LINK_MENU_ID];
    expect(Object.keys(provider.getPopupMenuEntries(element("bpmn:DataObjectReference")))).toEqual([
      "link-data_object",
    ]);
    expect(provider.getPopupMenuEntries(element("bpmn:Participant"))).toEqual({});

    const noDraft = boot(bridge(false)).menuProviders[LINK_MENU_ID];
    expect(Object.keys(noDraft.getPopupMenuEntries(element("bpmn:Task")))).toEqual(["link-process"]);
  });

  it("asks which process a freshly placed call activity calls — unless it already knows", () => {
    const b = bridge();
    const { handlers } = boot(b);
    const onCreate = handlers["commandStack.shape.create.postExecuted"];
    expect(onCreate).toBeTypeOf("function");

    const fresh = element("bpmn:CallActivity");
    onCreate({ context: { shape: fresh } });
    expect(b.openPicker).toHaveBeenCalledWith(fresh, "process");

    (b.openPicker as ReturnType<typeof vi.fn>).mockClear();
    // A paste (or a replace that kept either attribute) is left alone…
    onCreate({ context: { shape: element("bpmn:CallActivity", { calledElement: UUID }) } });
    onCreate({ context: { shape: element("bpmn:CallActivity", { processRef: UUID }) } });
    // …and dropping a plain step never prompts, however linkable it is.
    onCreate({ context: { shape: element("bpmn:Task") } });
    onCreate({ context: { shape: element("bpmn:StartEvent") } });
    onCreate({ context: {} });
    expect(b.openPicker).not.toHaveBeenCalled();
  });

  it("does not prompt for a call activity already linked in the draft", () => {
    // The XML carries no reference — the link was made in a table — so the
    // prompt must read the bridge, not just the shape.
    const b = bridge();
    b.links = { call_1: { ...emptyLinks(), business_process: { id: UUID, name: "Credit Check" } } };
    const { handlers } = boot(b);
    handlers["commandStack.shape.create.postExecuted"]({
      context: { shape: element("bpmn:CallActivity", { id: "call_1" }) },
    });
    expect(b.openPicker).not.toHaveBeenCalled();
  });
});
